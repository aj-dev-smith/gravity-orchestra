import * as THREE from "three";
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SONGS } from './songs/index.js';
import { G, UP, UPY, ROLL_T, DESCENT, solveLaunch, arcPos, arcVel, padOffset, beltPhase, PAD_R, padRadius, layoutPads } from './engine.js';
import * as audio from './audio.js';
import { glowTex, initJuice, spawnBurst, spawnTrail, spawnRipple, updateJuice } from './juice.js';
import { makeConveyorShop } from './conveyor.js';
import { encodeSong, decodeSong } from './share.js';
import { parseMidi } from './midi/parse.js';
import { convertToSong } from './midi/convert.js';
import { recSupported, startRecording } from './record.js';
/* ============================================================
   CASCADE — melody-driven marble run, now multi-track.
   A song is one or more tracks of [note, beats-until-next-hit].
   Every track gets its own solved pad chain, rail, and marble;
   they share the clock, so harmony is geometry.
   The pure physics/music primitives live in engine.js.
   ============================================================ */

/* ---- mutable song state, filled by buildWorld() ---- */
let BEAT = .7, SCALE = [];
let tracks = [], LOOP_T = 0, world = null;
let camMode = 'auto';
let autoWant = 'all', lastCut = 0;
let stageView = {cx: 0, halfW: 8};                      // x-centre + half-width of the pad field (FIXED cam framing)
const FIXED_ZMAX = 30;                                  // FIXED cam: cap the pull-back. Past ~30 the FogExp2 eats
                                                        // the chrome to black; better to let a very wide field
                                                        // overflow the frame edges than fade the whole scene out.
let muted = false;                                      // sound toggle (mute button)
let songTime = 0;                                       // the timeline; clock only supplies deltas
let playRate = 1, skipStrikes = false, dbg = null;      // ?debug scrub: rate + jump suppression
let loopIndex = -1;                                     // floor(songTime / P); ticks once per loop → spawns balls
/* CONVEYOR: the world no longer falls. Each pad RECIRCULATES — it rises to the
   static band exactly at its strike (beltPhase) then wraps away off-screen. Each
   marble is MORTAL — born once per loop, it juggles in the band via a per-ball
   render lift = DESCENT·τ, then plunges out the bottom and is recycled. The two
   mechanisms share no state; they meet at the band, at strikes, by construction.
   Physics is untouched — this is all render-time framing. */
const STAGE_Y = DESCENT * ROLL_T;                       // the static strike band (~5.7) every pad rises to meet
const FADE_TAIL = 1.0;                                  // seconds a plunged ball lingers before recycle
const DROP_IN = 9;                                      // height (world u) a newborn ball falls in from
const RIG_POOL = 3;                                     // rigs per role — ≤2 balls alive at the seam, 3 is slack
let recState = 'idle', recorder = null;                 // idle | armed | rec — transitions at the seam
const recEl = document.getElementById('rec');
const CAMCOLORS = {auto:'#ffe9c9', fixed:'#7fe3c8', all:'#cfd6e6', lead:'#ffaa55', alto:'#c08bff', bass:'#66aaff'};
const camsEl = document.getElementById('cams');
function renderCamButtons(){
  camsEl.innerHTML = '';
  if (tracks.length < 2){ camsEl.style.display = 'none'; camMode = 'auto'; return; }
  camsEl.style.display = 'flex';
  ['auto', 'fixed', 'all', ...tracks.map(t => t.role)].forEach(m => {
    const b = document.createElement('button');
    b.className = 'camb' + (camMode === m ? ' on' : '');
    if (camMode === m) b.style.color = CAMCOLORS[m];
    b.textContent = m.toUpperCase();
    b.addEventListener('click', () => { camMode = m; renderCamButtons(); });
    camsEl.appendChild(b);
  });
}
const hueOf = n => Math.max(0, SCALE.indexOf(n.replace(/\d/,''))) / Math.max(1, SCALE.length);

/* ---------------- renderer / scene ---------------- */
const renderer = new THREE.WebGLRenderer({antialias:true});
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;     // applied by OutputPass at the end of the chain
renderer.toneMappingExposure = 1.15;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07060e);
scene.fog = new THREE.FogExp2(0x07060e, 0.026);

const camera = new THREE.PerspectiveCamera(55, innerWidth/innerHeight, .1, 200);

scene.add(new THREE.AmbientLight(0x223, 1.4));
const key = new THREE.DirectionalLight(0x8899ff, .5);
key.position.set(-6, 10, 4); scene.add(key);
/* a soft fill aimed from the camera side at the belt wall — reveals the slat
   texture on the matte belts without putting a hotspot on the chrome marbles */
const beltFill = new THREE.DirectionalLight(0xaab8e0, .35);
beltFill.position.set(0, STAGE_Y + 2, 14);
beltFill.target.position.set(0, STAGE_Y, -3); scene.add(beltFill, beltFill.target);

/* --- one-shot procedural environment map → real chrome --- */
function makeEnv(){
  const envScene = new THREE.Scene();
  const grad = (() => {
    const c = document.createElement('canvas'); c.width = 4; c.height = 256;
    const g = c.getContext('2d').createLinearGradient(0,0,0,256);
    g.addColorStop(0,'#3a4d8f'); g.addColorStop(.45,'#0c0d1d');
    g.addColorStop(.75,'#05040a'); g.addColorStop(1,'#000');
    const x = c.getContext('2d'); x.fillStyle = g; x.fillRect(0,0,4,256);
    return new THREE.CanvasTexture(c);
  })();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50,16,16),
    new THREE.MeshBasicMaterial({map:grad, side:THREE.BackSide})));
  for (let i=0;i<5;i++){
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(30, 2.2),
      new THREE.MeshBasicMaterial({color: i%2 ? 0xffc890 : 0x9fb8ff, side:THREE.DoubleSide}));
    strip.position.set(Math.sin(i*2.4)*18, 6+i*4, Math.cos(i*2.4)*18);
    strip.lookAt(0,8,0);
    envScene.add(strip);
  }
  const rt = new THREE.WebGLCubeRenderTarget(256, {generateMipmaps:true, minFilter:THREE.LinearMipmapLinearFilter});
  new THREE.CubeCamera(.1, 100, rt).update(renderer, envScene);
  return rt.texture;
}
const envMap = makeEnv();

/* --- post chain: render → bloom → tonemap/sRGB out ---
   Real bloom on the emissive cores; the sprite halos stay as the soft
   wide base (bloom alone is too tight to replace their reach). */
const composer = new EffectComposer(renderer);
composer.setPixelRatio(Math.min(devicePixelRatio, 2));
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), .12, .3, .9);
/* halos predate bloom and were tuned to BE the glow — with real bloom they
   drop to a faint wide base or the two stack into giant blobs */
const HALO_A = .12, EMI = 1.2;
composer.addPass(bloom);
composer.addPass(new OutputPass());

const chrome = new THREE.MeshStandardMaterial({color:0xd8dde8, metalness:1, roughness:.12, envMap, envMapIntensity:1.4});
const ringGeo = new THREE.TorusGeometry(.55,.03,10,40);
const padGeo  = new THREE.CylinderGeometry(.5,.56,.13,28);

/* The visible belt machine. beltSpeed = DESCENT is the honesty hook: pads rise at
   DESCENT, slats scroll at DESCENT → slip-free, no state. reach=16 covers the ±14
   cull band for every song. Built per track in buildWorld, lives under tr.stage. */
const shop = makeConveyorShop({ chrome, envMap, beltSpeed: DESCENT, bandY: STAGE_Y, reach: 16 });
let machinesOn = true;                                  // key M toggles the whole machine for A/B

/* ---------------- marble rigs (lead = amber, bass = ice-blue) ---------- */
function makeRig(opt){
  const group = new THREE.Group();
  const core = new THREE.Mesh(new THREE.SphereGeometry(opt.r, 32, 32),
    new THREE.MeshStandardMaterial({color:opt.body, emissive:opt.emissive, emissiveIntensity:EMI,
      metalness:.3, roughness:.25, envMap}));
  const deform = new THREE.Group();                     // squash & stretch happens here
  deform.add(core);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({map:glowTex, color:opt.glow,
    blending:THREE.AdditiveBlending, depthWrite:false, transparent:true, opacity:HALO_A}));
  halo.scale.set(opt.r*5, opt.r*5, 1);
  const lamp = new THREE.PointLight(opt.glow, 3.5, 10, 2);  // physical units since r155
  group.add(deform, halo, lamp);
  group.visible = false;
  scene.add(group);
  return {group, core, deform, halo, lamp, glow:new THREE.Color(opt.glow), squash:0};
}
/* A POOL of rigs per role: the spawner checks one out for each newborn ball and
   returns it on death. Sized RIG_POOL (3) — only the youngest ball strikes; the
   others are the previous loops' marbles plunging away during the seam overlap. */
const RIG_OPT = {
  lead: {r:.26, body:0xffc488, emissive:0xff9233, glow:0xffaa55},
  bass: {r:.36, body:0xa8d4ff, emissive:0x3d7dff, glow:0x66aaff},
  alto: {r:.21, body:0xe2c8ff, emissive:0x9a4dff, glow:0xc08bff},
};
const rigPool = {};
for (const role of ['lead', 'bass', 'alto']){
  rigPool[role] = Array.from({length: RIG_POOL}, () => {
    const rg = makeRig(RIG_OPT[role]); rg.busy = false; return rg;
  });
}
function checkoutRig(role){
  const rg = rigPool[role].find(r => !r.busy);
  if (rg){ rg.busy = true; rg.squash = 0; rg.lamp.intensity = 3.5; }
  return rg;                                            // null only if pool exhausted (shouldn't happen)
}
function checkinRig(rig){ rig.busy = false; rig.group.visible = false; }

initJuice(scene);                                       // build trail / ripple / spark / dust pools

/* ---- conveyor debug: static world rulers + height-over-time graph (toggle G) ---- */
let convDbgOn = true;
const convRulers = new THREE.Group();                   // fixed in WORLD — never lifted, the static horizon
{
  const mat = new THREE.LineBasicMaterial({color:0x2a4870, transparent:true, opacity:.55});
  for (let yy = -15; yy <= 25; yy += 5){
    const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-34,yy,0), new THREE.Vector3(34,yy,0)]);
    convRulers.add(new THREE.Line(g, mat));
  }
  scene.add(convRulers);
}
const convCv = document.createElement('canvas');
convCv.width = 280; convCv.height = 150;
Object.assign(convCv.style, {position:'fixed', left:'8px', top:'8px', zIndex:60,
  background:'rgba(4,4,12,.72)', border:'1px solid #2a3550', borderRadius:'6px'});
document.body.appendChild(convCv);
const convX = convCv.getContext('2d');
const convHist = []; const CONV_N = 300;
addEventListener('keydown', e => { if (e.key === 'g' || e.key === 'G'){
  convDbgOn = !convDbgOn; convCv.style.display = convDbgOn ? 'block' : 'none'; convRulers.visible = convDbgOn; }});
addEventListener('keydown', e => { if (e.key === 'm' || e.key === 'M'){    // A/B the visible machine
  machinesOn = !machinesOn; tracks.forEach(tr => { if (tr.machine) tr.machine.group.visible = machinesOn; }); }});
function convDebug(markerY, camY){
  if (!convDbgOn) return;
  convHist.push({m:markerY, c:camY});
  if (convHist.length > CONV_N) convHist.shift();
  const W = convCv.width, H = convCv.height, top = 4, gh = H - 32;
  let lo = Infinity, hi = -Infinity;
  convHist.forEach(s => { lo = Math.min(lo,s.m,s.c); hi = Math.max(hi,s.m,s.c); });
  if (!isFinite(lo) || hi-lo < 1) hi = lo + 1;
  const Y = v => top + gh * (1 - (v-lo)/(hi-lo));
  convX.clearRect(0,0,W,H);
  convX.font = '9px monospace'; convX.lineWidth = 1;
  for (let yy = Math.ceil(lo); yy <= Math.floor(hi); yy++){           // integer world-y gridlines
    const py = Y(yy); convX.strokeStyle = '#1e2a40'; convX.beginPath();
    convX.moveTo(26,py); convX.lineTo(W-4,py); convX.stroke();
    convX.fillStyle = '#4a5d80'; convX.fillText(yy.toFixed(0), 4, py+3);
  }
  const plot = (k,color) => { convX.strokeStyle = color; convX.beginPath();
    convHist.forEach((s,i) => { const px = 26 + (W-30)*(i/(CONV_N-1)), py = Y(s[k]);
      i ? convX.lineTo(px,py) : convX.moveTo(px,py); }); convX.stroke(); };
  plot('m','#4cff9a');                                  // green = marble rendered height
  plot('c','#ffb24c');                                  // amber = camera height
  let blo = Infinity, bhi = -Infinity;                  // marble band spread over the window
  convHist.forEach(s => { blo = Math.min(blo,s.m); bhi = Math.max(bhi,s.m); });
  const last = convHist[convHist.length-1];
  convX.font = '10px monospace';
  convX.fillStyle = '#7dffb0';
  convX.fillText(`marble y ${last.m.toFixed(1)}  band ${blo.toFixed(1)}…${bhi.toFixed(1)} (Δ${(bhi-blo).toFixed(1)})`, 4, H-15);
  convX.fillStyle = '#ffc87d';
  const nBalls = tracks.reduce((s, t) => s + t.balls.length, 0);
  convX.fillText(`cam y ${last.c.toFixed(1)}  loop ${loopIndex}  balls ${nBalls}  (G to hide)`, 4, H-4);
}
let trailTick = 0;                                      // gates trail spawns to every .022s
let shakeAmp = 0, expoKick = 0;                         // camera punch & exposure pop

/* ---------------- world builder ----------------
   Solver per track: v0 = (ΔP − ½·g·dt²)/dt — exact, no drift.
   Descent is proportional to time, so parallel tracks fall together. */
function buildTrack(melody, zBase, role, delayBeats = 0, deep = false){
  const isBass = role === 'bass';
  const voiceDeep = isBass || deep;
  const stage = new THREE.Group();                      // the track's LOCAL frame; buildWorld places it via tr.origin
  const rollT = ROLL_T + delayBeats * BEAT;             // late entry = lazy drop-in
  // pad size encodes register, per voice (smaller = higher) — a pure fn of the note.
  // hue carries pitch class; this adds the octave hue throws away. Same note → same size.
  const radOf = padRadius(melody, role);                // world radius, layout-invariant
  // layout spaces pads apart so fast runs clear — gravity & vertical drop untouched.
  const pads = layoutPads(melody, {zBase, isBass, delayBeats, beat: BEAT, radOf});
  const total = pads.reduce((s, p) => s + p.dt, 0);
  const arcs = [];
  for (let i = 0; i < pads.length; i++){
    const a = pads[i];
    const target = (i === pads.length-1)
      ? a.pos.clone().add(new THREE.Vector3(0,-9,0))
      : pads[i+1].pos.clone();
    const dt = a.dt;
    arcs.push(solveLaunch(a.pos, target, dt));
  }
  // No rail, no landing pool: on the conveyor the marble is born dropping in
  // above pad 0 and dies plunging out the bottom (see ballPos / the ball loop).

  // pads: normal bisects incoming & outgoing velocity
  const padObjs = pads.map((pad, i) => {
    const prev = (i-1+pads.length) % pads.length;
    const vin = arcVel(arcs[prev], pads[prev].dt);
    const n = arcs[i].clone().normalize().sub(vin.clone().normalize()).normalize();
    if (n.y < .2) n.set(0,1,0);
    const g = new THREE.Group();
    g.position.copy(pad.pos).y -= .12;
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), n);
    g.scale.setScalar(radOf(pad.note) / PAD_R);          // same source of truth as the layout
    const body = new THREE.Mesh(padGeo, new THREE.MeshStandardMaterial({
      color: isBass ? 0x7e8db0 : 0x9aa6bd, metalness:1, roughness:.18, envMap, envMapIntensity:1.2}));
    const rim = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
      color: new THREE.Color().setHSL(hueOf(pad.note), .8, .55),
      transparent:true, opacity:.18}));
    rim.rotation.x = Math.PI/2; rim.position.y = .09;
    g.add(body, rim); stage.add(g);
    return {g, rim, body, flash:0, hue:hueOf(pad.note),
            base: g.position.clone(), n: n.clone(),
            amp: THREE.MathUtils.clamp(arcs[i].dot(n)*.07, .05, 1.6)};
  });

  return {stage, origin:new THREE.Vector3(), pads, arcs, padObjs, role, isBass, deep:voiceDeep, rollT, total, balls:[], active:null};
}

function buildWorld(keyName){
  if (recState !== 'idle') abortRec();                  // a rebuilt world invalidates the take
  const S = SONGS[keyName];
  BEAT = 60 / S.bpm; SCALE = S.scale;
  document.getElementById('songsub').textContent = S.sub + ' — falling';

  if (world){
    scene.remove(world);
    world.traverse(o => {
      if (o.geometry && o.geometry !== ringGeo && o.geometry !== padGeo) o.geometry.dispose();
      if (o.material && o.material !== chrome){
        if (o.material.map) o.material.map.dispose();   // per-song belt CanvasTextures — don't leak
        o.material.dispose();
      }
    });
  }
  world = new THREE.Group(); scene.add(world);
  Object.values(rigPool).flat().forEach(checkinRig);   // recall every marble from the old song

  // Each track now builds in its OWN local frame (zBase = 0 — the z-weave still
  // wiggles ±~1.4 around 0, keeping arc depth; it's just no longer pushed onto a
  // private z-plane). Placement is the bay layout below.
  tracks = [ buildTrack(S.melody, 0, 'lead') ];
  if (S.alto){
    const d = Array.isArray(S.alto) ? {notes:S.alto, delay:0} : S.alto;
    tracks.push( buildTrack(d.notes, 0, 'alto', d.delay, d.deep) );
  }
  if (S.bass){
    const d = Array.isArray(S.bass) ? {notes:S.bass, delay:0} : S.bass;
    tracks.push( buildTrack(d.notes, 0, 'bass', d.delay) );
  }
  LOOP_T = tracks[0].total + 1.2;

  // BAY LAYOUT — side-by-side machines on a common wall (lead, alto, bass, left→right).
  // tr.origin is a real placement transform (the seed of user-placed instruments).
  // Sliding a track in x is a rigid translation; gravity is vertical, so the solved
  // physics is untouched — we add tr.origin only at render time. Common wall ⇒ z=0,y=0.
  const GAP = 3;
  let cursor = 0;
  tracks.forEach(tr => {
    const xs = tr.padObjs.map(po => po.base.x);
    const lo = Math.min(...xs), hi = Math.max(...xs);
    tr.origin.set(cursor - lo, 0, 0);                   // shift the field's left edge to the cursor
    cursor += (hi - lo) + GAP;
  });
  const wallW = cursor - GAP;                           // centre the whole wall on x=0
  tracks.forEach(tr => {
    tr.origin.x -= wallW/2; tr.stage.position.copy(tr.origin); world.add(tr.stage);
    tr.machine = shop.buildMachine(tr);                 // visible belt machine, in the track's local frame
    tr.machine.group.visible = machinesOn;
    tr.stage.add(tr.machine.group);                     // under the stage → inherits the bay placement for free
  });

  // FIXED-cam framing: x-centre + half-width of the whole WALL (world x = base.x + origin.x)
  let minX = Infinity, maxX = -Infinity;
  tracks.forEach(tr => tr.padObjs.forEach(po => {
    const x = po.base.x + tr.origin.x;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
  }));
  stageView = {cx: (minX + maxX) / 2, halfW: Math.max(6, (maxX - minX) / 2)};

  audio.setBeat(BEAT);
  const FIXED_OK = new Set(['all', 'auto', 'fixed']);
  if (!FIXED_OK.has(camMode) && !tracks.some(t => t.role === camMode)) camMode = 'auto';
  renderCamButtons();
  audio.rebuildBank(tracks);
  songTime = 0; loopIndex = -1;                         // next frame respawns the loop's balls
  if (started) clock.start();
}

const noteEl = document.getElementById('note');
function strike(tr, i, rig){
  const pad = tr.pads[i], po = tr.padObjs[i];
  po.flash = 1;
  rig.lamp.intensity = 7;                               // strike flash
  if (tr.role === 'lead') noteEl.innerHTML = `<b>${pad.note}</b>&nbsp; ·&nbsp; ${'·'.repeat(Math.min(i, 40))}`;
  const padR = new THREE.Vector3(pad.pos.x, STAGE_Y, pad.pos.z).add(tr.origin);   // every pad strikes at the band, in its bay
  spawnRipple(padR, po.g.quaternion, po.hue, tr.isBass, po.amp);
  // JUICE: sparks, squash, punch
  const sparkColor = new THREE.Color().setHSL(po.hue, .85, .62);
  spawnBurst(padR.clone().add(UP), sparkColor,
             Math.min(5 + Math.round(pad.dt*7), 16),
             2.4 + Math.min(pad.dt*1.6, 3));
  rig.squash = 1;
  if (tr.role === 'lead'){
    shakeAmp = Math.min(shakeAmp + .04 + pad.dt*.05, .15);
    expoKick = 1;
  }
  if (audio.isReady() && !muted){
    try { audio.playNote(pad.note, tr.deep); } catch(e){ /* audio must never break the run */ }
  }
}

/* ---------------- timeline ---------------- */
const clock = new THREE.Clock(); clock.autoStart = false;
let started = false;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const sel = document.getElementById('song');
Object.entries(SONGS).forEach(([k, s]) => {
  const o = document.createElement('option');
  o.value = k; o.textContent = s.label;
  sel.appendChild(o);
});
buildWorld(sel.value);
/* the machine runs from first paint — only AUDIO waits for a gesture.
   (reduced-motion users keep the old behavior: stillness until they opt in) */
if (!reduceMotion){ clock.start(); started = true; }
const camTarget = new THREE.Vector3(0, STAGE_Y + .6, 0);   // the static band centre
const camPos = new THREE.Vector3(4.5, STAGE_Y + 3.4, 9.5);
camera.position.copy(camPos); camera.lookAt(camTarget);

/* A mortal ball's state at LOCAL time τ (seconds since its birth). Pure: no wrap,
   no strike side-effect — it just reports where the ball is and which pad index
   it's on (idx). The caller adds the per-ball render lift DESCENT·τ and fires the
   strike when idx advances. Positions are WORLD (un-lifted); the +UP marble lift
   off the pad is baked in on the arc segments. */
function ballPos(tr, tau){
  if (tau < tr.rollT){                                  // birth: drop straight in above pad 0
    const u = THREE.MathUtils.clamp(tau / tr.rollT, 0, 1);
    const p0 = tr.pads[0].pos;
    const drop = DROP_IN * (1-u)*(1-u);                 // eased fall, arrives at the band at u=1
    return {pos: new THREE.Vector3(p0.x, STAGE_Y + UP.y + drop - DESCENT*tau, p0.z),
            vel: new THREE.Vector3(0, -2*DROP_IN*(1-u)/tr.rollT - DESCENT, 0),
            plunge:false, idx:-1, nextIdx:0, prog:u, curDt:9, nextDt: tr.pads[0].dt};
  }
  let at = tau - tr.rollT, i = 0;
  while (i < tr.pads.length && at >= tr.pads[i].dt){ at -= tr.pads[i].dt; i++; }
  if (i >= tr.pads.length){                             // tail: ride the last arc down and out
    const a = tr.pads[tr.pads.length-1];
    const t2 = a.dt + (tau - (tr.rollT + a.t + a.dt));
    const lastArc = tr.arcs[tr.arcs.length-1];
    return {pos: arcPos(a.pos, lastArc, t2), vel: arcVel(lastArc, t2),
            plunge:true, idx:tr.pads.length, nextIdx:-1, prog:0, curDt:9, nextDt:9};
  }
  return {pos: arcPos(tr.pads[i].pos, tr.arcs[i], at).add(UP),
          vel: arcVel(tr.arcs[i], at),
          plunge:false, idx:i,
          nextIdx: i+1 < tr.pads.length ? i+1 : -1,
          prog: at / tr.pads[i].dt,
          curDt: tr.pads[i].dt,
          nextDt: i+1 < tr.pads.length ? tr.pads[i+1].dt : 9};
}
/* Born once per loop; one strike per pad per loop. */
function spawnBall(tr, birthT){
  const rig = checkoutRig(tr.role);
  if (!rig) return;                                     // pool exhausted — drop the ball, never crash
  tr.balls.push({rig, birthT, lastIdx:-1, splashed:false});
}

function animate(){
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), .05);
  songTime += dt * playRate;
  const P = ROLL_T + LOOP_T;                             // loop period (per song)
  const T = started ? songTime % P : 0;                 // loop-local time — display + scrub only
  if (started){                                         // spawn one ball per track at each loop boundary
    const li = Math.floor(songTime / P);
    if (li > loopIndex){
      loopIndex = li;
      tracks.forEach(tr => spawnBall(tr, li * P));
      if (recState === 'armed') beginRec();             // seam-to-seam: the loop boundary is the cut point
      else if (recState === 'rec') finishRec();
    }
  }
  if (dbg && started) dbg.update(T);
  if (recState === 'armed')
    recEl.textContent = `● IN ${(P - T).toFixed(1)}S${muted ? ' · SILENT' : ''}`;
  else if (recState === 'rec')
    recEl.textContent = `● ${T.toFixed(1)}/${P.toFixed(0)}S`;

  let leadRender = null;
  const marblePts = [];
  const cullDist = Math.min(14, DESCENT * P * .5 - .5);  // pads wrap off-screen beyond the band
  tracks.forEach(tr => {
    // ---- mortal balls: render each, strike on the youngest, recycle the dead ----
    let active = null;                                   // youngest live ball drives camera + anticipation
    for (let bi = tr.balls.length - 1; bi >= 0; bi--){   // newest first
      const ball = tr.balls[bi];
      const tau = songTime - ball.birthT;
      const r = ballPos(tr, tau);
      const rpos = r.pos.clone(); rpos.y += DESCENT * tau;   // per-ball render lift → juggles in the band
      rpos.add(tr.origin);                                   // …in its track's bay (rigs live in scene, not the stage)
      const rig = ball.rig;

      // strike when the ball reaches a fresh, valid pad (dying balls overrun the end → never strike)
      if (r.idx >= 0 && r.idx < tr.pads.length && r.idx !== ball.lastIdx){
        ball.lastIdx = r.idx;
        if (!skipStrikes) strike(tr, r.idx, rig);
      }

      // plunge fade + recycle
      let fade = 0;
      if (r.plunge){
        fade = THREE.MathUtils.clamp((STAGE_Y - 1.5 - rpos.y) / 6, 0, 1);
        if (!ball.splashed && rpos.y < STAGE_Y - 2){
          ball.splashed = true;
          spawnBurst(rpos.clone().add(UP), rig.glow, 18, 4.5);
        }
      }
      if (tau > P + FADE_TAIL || fade >= 1){ checkinRig(rig); tr.balls.splice(bi, 1); continue; }

      rig.halo.material.opacity = HALO_A * (1 - fade);
      rig.core.material.emissiveIntensity = EMI * (1 - fade) + .1;
      rig.group.visible = true;
      rig.group.position.copy(rpos);
      rig.core.rotation.x += dt*6; rig.core.rotation.z += dt*3.4;
      rig.lamp.intensity += (3.5 - rig.lamp.intensity) * dt * 8;

      // squash & stretch along velocity
      const speed = r.vel.length();
      if (speed > .01) rig.deform.quaternion.setFromUnitVectors(UPY, r.vel.clone().normalize());
      rig.squash *= (1 - dt*9);
      const sq = rig.squash, stretch = 1 + Math.min(speed*.014, .4);
      const sxz = (1/Math.sqrt(stretch))*(1-sq) + 1.3*sq;
      rig.deform.scale.set(sxz, stretch*(1-sq) + .55*sq, sxz);

      if (started && trailTick > .022 && playRate && fade < .5)
        spawnTrail(rpos, rig.glow, tr.isBass);

      if (!active){ active = {r, rpos}; }                // first live one we hit is the youngest
    }
    tr.active = active;
    if (active){
      marblePts.push({p: active.rpos.clone(), w: tr.role === 'lead' ? 1.7 : 1, role: tr.role});
      tr._st = {dt: active.r.curDt, next: active.r.nextDt, prog: active.r.prog};
      if (tr.role === 'lead') leadRender = active.rpos;
    } else tr._st = null;

    // ---- recirculating belt: each pad rises to the band at its strike, wraps off-screen ----
    tr.padObjs.forEach((po, idx) => {
      const c = beltPhase(songTime, tr.rollT + tr.pads[idx].t, P);
      if (started && Math.abs(DESCENT * c) > cullDist){ po.g.visible = false; return; }
      po.g.visible = true;
      po.flash *= (1 - dt*4);
      const pre = (active && idx === active.r.nextIdx) ? active.r.prog*active.r.prog : 0;
      po.rim.material.opacity = .08 + po.flash*.5 + pre*.3;
      po.rim.scale.setScalar(1 + pre*.22 + po.flash*.12);
      po.body.material.emissive.setHSL(po.hue, .7, po.flash*.32 + pre*.07);
      po.g.position.set(po.base.x, STAGE_Y - .12 + DESCENT * c, po.base.z)
        .addScaledVector(po.n, padOffset(started ? c : 0, po.amp));
    });

    // ---- the visible machine: scroll the belt in lock-step with the rising pads ----
    if (machinesOn) tr.machine.update(reduceMotion ? 0 : dt);
  });
  if (trailTick > .022) trailTick = 0;
  trailTick += dt;
  skipStrikes = false;                                  // scrub jumps suppress strikes for one frame only
  updateJuice(dt);

  // exposure pop
  expoKick *= (1 - dt*6);
  renderer.toneMappingExposure = 1.15 + expoKick*.12;

  // DIRECTOR: the timeline is known, so cut to the action before it happens
  let effMode = camMode;
  if (camMode === 'auto'){
    let want = 'all', score = 1.0;
    tracks.forEach(tr => {
      const s = tr._st; if (!s) return;
      // a big moment = a long arc in progress, or one about to launch
      const m = Math.max(s.dt < 8 ? s.dt : 0, (s.prog > .55 && s.next < 8) ? s.next : 0);
      if (m >= 1.05 && m > score){ score = m; want = tr.role; }
    });
    if (want === 'all' && tracks[0]._st && tracks[0]._st.dt <= .33) want = 'lead';  // shred cam
    if (want !== autoWant && clock.elapsedTime - lastCut > 2.2){
      autoWant = want; lastCut = clock.elapsedTime;
    }
    effMode = autoWant;
  }

  // camera: hold a fixed stage view, follow the chosen marble, or frame them all
  const sway = (reduceMotion || camMode === 'fixed') ? 0 : Math.sin(clock.elapsedTime*.21);
  let ideal, aim;
  if (camMode === 'fixed'){
    // STATIONARY WORLD CAM: a held pose that frames the whole pad field — no chase,
    // no sway, no shake. Glides into place once (shared lerp below) then holds dead still.
    const margin = 4;                                   // world-unit breathing room around the field
    const zFit = (stageView.halfW + margin) /
      (Math.tan(THREE.MathUtils.degToRad(camera.fov/2)) * Math.min(camera.aspect, 1.7));
    const z = THREE.MathUtils.clamp(zFit, 16, FIXED_ZMAX);   // fit the width, but never pull back into the fog
    ideal = new THREE.Vector3(stageView.cx + z*0.22, STAGE_Y + 5, z);   // gentle 3/4, slightly above the band
    aim   = new THREE.Vector3(stageView.cx, STAGE_Y + 1.5, 0);
  } else {
    const followed = effMode !== 'all' ? marblePts.find(m => m.role === effMode) : null;
    const focus = new THREE.Vector3();
    let back = Math.max(1, 1.3 / Math.min(camera.aspect, 1.3));
    if (!marblePts.length){
      focus.set(0, STAGE_Y, 0);                         // pre-start (or between balls): frame the band
    } else if (followed){
      focus.copy(followed.p);
      back *= .92;                                      // tight, personal chase
    } else {
      let wSum = 0;
      marblePts.forEach(m => { focus.addScaledVector(m.p, m.w); wSum += m.w; });
      focus.divideScalar(wSum);
      let spread = 0;
      marblePts.forEach(m => spread = Math.max(spread, m.p.distanceTo(focus)));
      back *= (1 + Math.min(spread * .075, .7));
    }
    // VERTICAL IS PINNED: the band is static now, so the camera never cranes up/down.
    // x/z still follow the marble (with sway + spread-dolly); height is locked to the stage plane.
    ideal = focus.clone().add(new THREE.Vector3((4.5 + sway*2.2)*back, 0, (9.5 - sway*1.4)*back));
    ideal.y = STAGE_Y + 3.4;                            // constant eye height — no spread-driven bob
    aim = focus.clone(); aim.y = STAGE_Y + .6;          // look at the band centre, not the bobbing marble
  }
  camPos.lerp(ideal, 1 - Math.pow(.0015, dt));
  camTarget.lerp(aim, 1 - Math.pow(.0008, dt));
  camera.position.copy(camPos);
  shakeAmp *= (1 - dt*7);
  if (!reduceMotion && camMode !== 'fixed' && shakeAmp > .002){
    camera.position.x += (Math.random()-.5)*shakeAmp;
    camera.position.y += (Math.random()-.5)*shakeAmp;
  }
  camera.lookAt(camTarget);

  if (convDbgOn) convDebug(leadRender ? leadRender.y : camTarget.y, camera.position.y);
  composer.render();
}
animate();

/* ---------------- controls ---------------- */
const overlay = document.getElementById('overlay');
function enterSound(){
  if (overlay.classList.contains('gone')) return;
  overlay.classList.add('gone');
  if (!started){ clock.start(); started = true; }       // reduced-motion path starts here
  try { audio.initAudio(); } catch(e){ audio.setStatus('audio: failed'); }
  if (recSupported(renderer.domElement)) recEl.hidden = false;
  keepAwake();
}
overlay.addEventListener('click', enterSound);          // the whole veil is the button

/* ---------------- record one perfect loop ---------------- */
recEl.addEventListener('click', () => {
  if (recState === 'idle'){ recState = 'armed'; recEl.classList.add('live'); }
  else if (recState === 'armed') abortRec();            // second tap cancels
  else finishRec();                                     // early stop: partial loop, still delivered
});
function beginRec(){
  recorder = startRecording(renderer.domElement, muted ? null : audio.captureStream());
  recState = 'rec';
}
function finishRec(){
  const r = recorder; recorder = null;
  resetRecUI();
  r.stop().then(showRecCard);
}
function abortRec(){
  if (recorder){ recorder.stop(); recorder = null; }    // stop and discard
  resetRecUI();
}
function resetRecUI(){
  recState = 'idle';
  recEl.textContent = '● REC';
  recEl.classList.remove('live');
}
function showRecCard(blob){
  const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
  const file = new File([blob], `cascade-${sel.value}.${ext}`, {type: blob.type});
  const url = URL.createObjectURL(blob);
  const card = document.createElement('div'); card.id = 'reccard';
  const vid = document.createElement('video');
  Object.assign(vid, {src: url, controls: true, loop: true, muted: true, autoplay: true, playsInline: true});
  const cap = document.createElement('span');
  cap.textContent = `ONE LOOP · ${ext.toUpperCase()} · ${(blob.size/1e6).toFixed(1)} MB`;
  const row = document.createElement('div'); row.className = 'row';
  const mk = (txt, fn) => { const b = document.createElement('button');
    b.className = 'camb'; b.textContent = txt; b.addEventListener('click', fn); row.appendChild(b); };
  mk('DOWNLOAD', () => { const a = document.createElement('a'); a.href = url; a.download = file.name; a.click(); });
  if (navigator.canShare?.({files: [file]}))
    mk('SHARE', () => navigator.share({files: [file]}).catch(() => {}));
  mk('CLOSE', () => { URL.revokeObjectURL(url); card.remove(); });
  card.append(vid, cap, row);
  document.body.appendChild(card);
}
/* every tap: prime samples, retry/rebuild the context (gesture context!) */
['touchend','pointerdown'].forEach(ev => addEventListener(ev, () => {
  if (!started) return;
  audio.gestureRetry();
}, {passive:true}));
let wakeLock = null;
async function keepAwake(){
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch(e){}
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && started) keepAwake();
});
sel.addEventListener('change', () => {
  buildWorld(sel.value);
  audio.primeSamples();                                 // change event is a gesture: unlock new bank
  audio.showState();
  shareEl.hidden = !DYNAMIC.has(sel.value);
  if (!DYNAMIC.has(sel.value)) history.replaceState(null, '', location.pathname + location.search);
});

/* ---------------- dynamic songs (MIDI import / share links) ---------------- */
const DYNAMIC = new Set(['imported', 'shared']);
const shareEl = document.getElementById('share');
function registerSong(key, song){
  SONGS[key] = song;
  let o = [...sel.options].find(x => x.value === key);
  if (!o){ o = document.createElement('option'); o.value = key; sel.appendChild(o); }
  o.textContent = song.label;
  sel.value = key;
  buildWorld(key);
  shareEl.hidden = false;
}
shareEl.addEventListener('click', async () => {
  const url = `${location.origin}${location.pathname}#s=${await encodeSong(SONGS[sel.value])}`;
  history.replaceState(null, '', url);
  try { await navigator.clipboard.writeText(url); shareEl.textContent = 'COPIED'; }
  catch(e){ shareEl.textContent = 'LINK IN URL BAR'; }
  setTimeout(() => { shareEl.textContent = 'SHARE LINK'; }, 1600);
});
(async () => {                                          // boot: a share link IS the song
  const m = location.hash.match(/^#s=(.+)$/);
  if (!m) return;
  try { registerSong('shared', await decodeSong(m[1])); }
  catch(e){ console.warn('cascade: ignoring bad share link —', e.message); }
})();

/* ---------------- MIDI import: drop a .mid anywhere ---------------- */
const subEl = document.getElementById('songsub');
addEventListener('dragover', e => e.preventDefault());
addEventListener('dragenter', () => { subEl.textContent = 'drop a .mid — the solver does the rest'; });
addEventListener('dragleave', e => {
  if (!e.relatedTarget) subEl.textContent = SONGS[sel.value].sub + ' — falling';
});
addEventListener('drop', async e => {
  e.preventDefault();
  const file = [...(e.dataTransfer?.files || [])].find(f => /\.midi?$/i.test(f.name));
  if (!file){ subEl.textContent = SONGS[sel.value].sub + ' — falling'; return; }
  try {
    const parsed = parseMidi(new Uint8Array(await file.arrayBuffer()));
    const { song, warnings } = convertToSong(parsed, {label: file.name.replace(/\.midi?$/i, '')});
    enterSound();                                       // a drop is a gesture: veil off, audio up
    registerSong('imported', song);
    audio.primeSamples();                               // drop is a gesture: unlock the new bank
    audio.showState();
    if (warnings.length){
      console.warn('cascade midi import:\n  ' + warnings.join('\n  '));
      subEl.textContent = `${song.sub} · ${warnings.length} import note(s) in console — falling`;
    }
  } catch(err){
    subEl.textContent = `couldn't read ${file.name}: ${err.message}`;
  }
});
document.getElementById('mute').addEventListener('click', e => {
  muted = !muted;
  e.target.textContent = muted ? 'SOUND OFF' : 'SOUND ON';
  if (!muted){
    audio.resumeOrBuild();
    audio.primeSamples();
    try { audio.playNote('E5', false); } catch(e){}     // E5 exists in every song
  }
  audio.showState();
});
addEventListener('resize', () => {
  camera.aspect = innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});

/* ---------------- ?debug scrub bar (dev tooling, not a feature) ----------------
   Time is the only state, so scrubbing is just assigning songTime.
   skipStrikes keeps a jump from machine-gunning every note it crosses. */
if (new URLSearchParams(location.search).has('debug')){
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;bottom:84px;left:50%;transform:translateX(-50%);' +
    'display:flex;gap:10px;align-items:center;z-index:6;color:#5a6178;font-size:10px;' +
    'letter-spacing:.12em;background:rgba(7,6,14,.55);border:1px solid rgba(90,97,120,.45);' +
    'border-radius:999px;padding:6px 14px';
  const bar = document.createElement('input');
  bar.type = 'range'; bar.min = 0; bar.max = 1000; bar.value = 0;
  bar.style.width = '34vw';
  let held = false;
  bar.addEventListener('pointerdown', () => held = true);
  addEventListener('pointerup', () => held = false);
  bar.addEventListener('input', () => {
    songTime = (bar.value/1000) * (ROLL_T + LOOP_T);
    skipStrikes = true;
  });
  const time = document.createElement('span');
  time.style.cssText = 'min-width:11ch;text-align:right';
  const rates = document.createElement('span');
  [['⏸',0],['¼',.25],['1×',1]].forEach(([txt, r]) => {
    const b = document.createElement('button');
    b.textContent = txt;
    b.style.cssText = 'background:none;border:none;color:inherit;font:inherit;cursor:pointer;padding:2px 6px';
    b.addEventListener('click', () => { playRate = r; });
    rates.appendChild(b);
  });
  box.append(bar, time, rates);
  document.body.appendChild(box);
  dbg = { update(T){
    if (!held) bar.value = Math.round(T / (ROLL_T + LOOP_T) * 1000);
    time.textContent = `T ${T.toFixed(2)} ×${playRate}`;
  }};
}
