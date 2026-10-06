import * as THREE from "three";
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SONGS } from './songs/index.js';
import { G, UP, UPY, ROLL_T, DESCENT, solveLaunch, arcPos, arcVel, padOffset, beltPhase, deployPose, PAD_R, padRadius, layoutPads } from './engine.js';
import * as audio from './audio.js';
import { glowTex, initJuice, spawnBurst, spawnTrail, spawnRipple, updateJuice } from './juice.js';
import { makeConveyorShop, BELT_DEPTH } from './conveyor.js';
import { makeMarbleDrums } from './marbledrums.js';
import { makeCameraRig } from './camera.js';
import { INSTRUMENTS, instrumentByKey } from './instruments/index.js';
import { stationFor } from './instruments/stations.js';
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
const BELT_REACH = 16;                                  // half-height of the belt: drums sit at band ± this
const PAD_CULL = BELT_REACH - .2;                       // pads ride to just shy of the drum, then tuck behind the
                                                        // cowl and vanish unseen (well under any song's half-period)
// STOWED pose: disc lying flat & flush on the belt (its "up" faces the camera, +z), the
// pose a pad pops in/out at. The belt loop slerps qFlat → po.qN as the pad unfolds on entry.
const Q_FLAT = new THREE.Quaternion().setFromUnitVectors(UPY, new THREE.Vector3(0, 0, 1));
const _qn = new THREE.Vector3();                        // scratch: live pad normal during unfold
const FULL_DEPLOY = { extend: 1, tilt: 1 };             // reduced-motion: pads just appear, fully deployed
const FADE_TAIL = 1.0;                                  // seconds a plunged ball lingers before recycle
const BIRTH_DROP = 10;                                  // world-u a newborn FREE-FALLS in (honest G, fixed height)
const BIRTH_FALL = Math.sqrt(2 * BIRTH_DROP / -G.y);    // time that drop takes under real gravity (≈1.17s) —
                                                        // fixed, so delayed voices just hold longer, then drop identically
const LEAD_IN = 2.4;                                    // seconds of count-in BEFORE the marble spawns (songTime starts
                                                        // negative): the machine runs solo so songs don't snap straight
                                                        // in. A pickup fill (negative drum beats) rides the marble's
                                                        // roll-in just ahead of the downbeat — see convert.js step 12.
const RIG_POOL = 3;                                     // rigs per role — ≤2 balls alive at the seam, 3 is slack
let recState = 'idle', recorder = null;                 // idle | armed | rec — transitions at the seam
const recEl = document.getElementById('rec');
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

/* every way of looking at the static stage — director / fixed / free-fly / follow —
   lives in the camera rig. It owns the camera object, the cam-button row, the orbit
   + WASD/QE fly controls, and the per-frame framing. main just feeds it the live
   marbles each frame and the tracks on each song change. */
const cam = makeCameraRig({ stageY: STAGE_Y, fixedZMax: FIXED_ZMAX,
                            dom: renderer.domElement, camsEl: document.getElementById('cams') });
const camera = cam.camera;

scene.add(new THREE.AmbientLight(0x223, 1.6));
/* gentle global fill: cool from the ceiling, dim warm bounce from the floor — lifts
   the room and the matte instrument bodies a touch without flattening the bloom mood */
scene.add(new THREE.HemisphereLight(0x4a5a8c, 0x161420, .45));
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

/* --- greybox dev room: a grid-walled box around the static band. PURE STAGING —
   no engine reach. Persistent (added to scene, not the per-song world). The grid is
   procedural; an emissiveMap of the same grid self-lights the lines so they read in
   the dark room (and feed bloom a touch). Existing fog fades the far walls into haze,
   which conveniently keeps the conveyor wrap / ball death hidden. Toggle R. */
function gridTex(){
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d');
  x.fillStyle = '#0a0b15'; x.fillRect(0,0,S,S);
  const N = 4, step = S/N;                                // 4 minor cells per tile
  x.strokeStyle = 'rgba(86,120,205,.5)'; x.lineWidth = 1;
  for (let i=1;i<N;i++){ const p = i*step;
    x.beginPath(); x.moveTo(p,0); x.lineTo(p,S); x.stroke();
    x.beginPath(); x.moveTo(0,p); x.lineTo(S,p); x.stroke(); }
  x.strokeStyle = 'rgba(130,180,255,.9)'; x.lineWidth = 3; // bright major line at the tile edge
  x.strokeRect(0,0,S,S);
  return new THREE.CanvasTexture(c);
}
/* one source of truth for the room box — the instrument legs/stands plant on ROOM.FLOOR */
const ROOM = { HW:38, FLOOR:-22, CEIL:36, BACK:-34, FRONT:42 };
function makeRoom(){
  const g = new THREE.Group();
  const base = gridTex();
  const TILE = 8;                                         // world-u per grid tile → 2u minor cells
  const panel = (w, h) => {
    const t = base.clone(); t.needsUpdate = true;
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(w/TILE, h/TILE);
    const m = new THREE.MeshStandardMaterial({
      map:t, emissive:0x33508c, emissiveMap:t, emissiveIntensity:.55,
      roughness:.9, metalness:.05, side:THREE.DoubleSide });
    return new THREE.Mesh(new THREE.PlaneGeometry(w,h), m);
  };
  const { HW, FLOOR, CEIL, BACK, FRONT } = ROOM;
  const W = HW*2, D = FRONT-BACK, H = CEIL-FLOOR, MZ = (FRONT+BACK)/2, MY = (CEIL+FLOOR)/2;
  const add = (m, rx, ry, x, y, z) => { m.rotation.x = rx; m.rotation.y = ry; m.position.set(x,y,z); g.add(m); };
  add(panel(W, D), -Math.PI/2, 0, 0, FLOOR, MZ);         // floor
  add(panel(W, D),  Math.PI/2, 0, 0, CEIL,  MZ);         // ceiling
  add(panel(W, H), 0, 0,        0, MY, BACK);            // back wall
  add(panel(W, H), 0, Math.PI,  0, MY, FRONT);           // front wall (behind the camera)
  add(panel(D, H), 0,  Math.PI/2, -HW, MY, MZ);          // left wall
  add(panel(D, H), 0, -Math.PI/2,  HW, MY, MZ);          // right wall
  return g;
}
const room = makeRoom();
scene.add(room);
let roomOn = true;                                        // key R toggles the dev room

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
const shop = makeConveyorShop({ chrome, envMap, beltSpeed: DESCENT, bandY: STAGE_Y, reach: BELT_REACH, cull: PAD_CULL, floorY: ROOM.FLOOR });
let machinesOn = true;                                  // key M toggles the whole machine for A/B

/* The marble drum machine — one immortal ball per drum, dribbling on its own head,
   pistons for force, magnets for long rests (src/marbledrums.js). Rebuilt per song
   under `world`; every frame is a pure function of songTime. */
const drumKit = makeMarbleDrums({ envMap, glowTex });

/* ---- INSTRUMENT PLUGINS (src/instruments/<key>/) — every folder is picked up by
   the registry; main only runs the generic loop: build the song's part into the
   instrument's STATION (origin + yaw, render-time placement), update it each frame
   as a pure fn of songTime, and turn its strikes into sparks + a light + its voice.
   See src/instruments/README.md for the contract. ---- */
const instRigs = INSTRUMENTS.map(I => ({ I, inst: I.make({ envMap, glowTex, THREE }), station: null }));
let instLive = [];                                      // rigs with a part in the current song
const STRIKE_LIGHTS = 6;                                // shared pool, CONSTANT size → no shader recompiles
const strikeLights = Array.from({ length: STRIKE_LIGHTS }, () => {
  const l = new THREE.PointLight(0xffffff, 0, 9, 2); scene.add(l); return { l, age: 9, peak: 0 };
});
let strikeLightIdx = 0;
const _sp = new THREE.Vector3();

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
addEventListener('keydown', e => { if (e.key === 'r' || e.key === 'R'){    // A/B the greybox dev room
  roomOn = !roomOn; room.visible = roomOn; }});
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
let expoKick = 0;                                       // exposure pop on lead strikes (camera shake lives in the rig)

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
            base: g.position.clone(), n: n.clone(), qN: g.quaternion.clone(),
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
  const stageView = {cx: (minX + maxX) / 2, halfW: Math.max(6, (maxX - minX) / 2)};

  // marble drums: built song-level, placed right of the wall, added under world (so it
  // disposes with the world on the next song change). Aligned to the lead's timeline;
  // `start` arms every ball on its magnet for the count-in.
  world.add(drumKit.build(S.drums, { rollT: ROLL_T, beat: BEAT, P: ROLL_T + LOOP_T, cx: stageView.cx, start: -LEAD_IN }));

  // instrument plugins: each part builds inside its station (render-time placement only)
  const voices = [];
  instLive = [];
  instRigs.forEach((rig, i) => {
    const part = S.parts?.[rig.I.key];
    if (!part || !part.length) return;
    const st = stationFor(rig.I.key, i);
    const station = new THREE.Group();
    station.position.set(stageView.cx + st.x, st.y, st.z);
    station.rotation.y = st.yaw;
    station.add(rig.inst.build(part, { rollT: ROLL_T, beat: BEAT, P: ROLL_T + LOOP_T, start: -LEAD_IN,
      station: st, floorY: ROOM.FLOOR - st.y, loopBeats: S.melody.reduce((a, n) => a + n[1], 0) }));
    world.add(station);
    station.updateMatrixWorld(true);
    rig.station = station;
    instLive.push(rig);
    const ids = rig.I.voiceIds ? rig.I.voiceIds(part) : [...new Set(part.map(e => e[1]))];
    ids.forEach(id => voices.push({ key: `inst:${rig.I.key}:${id}`, wet: !!rig.I.wet, render: () => rig.I.voice(id) }));
  });

  audio.setBeat(BEAT);
  cam.syncTracks(tracks, stageView);                    // reframe + rebuild the cam-button row for the new song
  audio.rebuildBank(tracks, S.drums ? Object.keys(S.drums) : [], voices);
  // start in the loop's TAIL: songTime < 0 means no ball has spawned yet (li stays
  // -1), so the machine + any tail/pickup drums play as a count-in, then the marble
  // spawns at songTime 0 and rolls into the downbeat. skipStrikes guards the first
  // frame from retro-firing every drum edge it lands on (same as a scrub jump).
  songTime = -LEAD_IN; loopIndex = -1; skipStrikes = true;
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
    cam.addShake(.04 + pad.dt*.05);                       // micro camera punch on lead strikes
    expoKick = 1;
  }
  if (audio.isReady() && !muted){
    try { audio.playNote(pad.note, tr.deep); } catch(e){ /* audio must never break the run */ }
  }
}

/* A drum ball reaching its head: sparks + the percussion voice (the head ripple,
   flash, piston and strike light are the machine's own). The KICK hits the room:
   the cannonball landing shakes the camera and punches the exposure. */
function drumStrike(hit){
  const c = hit.drum.contact, v = hit.vel ?? 1;
  spawnBurst(c.clone().add(UP), new THREE.Color(hit.drum.style.ball),
             Math.round(5 + 7 * v), 3.0);
  if (hit.lane === 'kick'){
    cam.addShake(.05 + .05 * v);
    expoKick = Math.max(expoKick, .8 * v);
  }
  if (audio.isReady() && !muted){
    try { audio.playDrum(hit.lane, hit.vel ?? 1); } catch(e){ /* audio must never break the run */ }
  }
}

/* Frame the free camera on an instrument's station: from out front of it (its local
   +z, through the station's yaw), a little above, looking at its middle. dist/up are
   in world units. Used by ?solo and window.__dev.station(key). */
function lookAtStation(key, dist = 15, up = 5){
  const rig = instLive.find(r => r.I.key === key);
  if (!rig) return false;
  const st = rig.station, h = rig.I.lookHeight ?? 3;
  const tgt = st.localToWorld(new THREE.Vector3(0, h, 0));
  const eye = st.localToWorld(new THREE.Vector3(0, h + up, dist));
  cam.camera.position.copy(eye); cam.target.copy(tgt); cam.orbit.target.copy(tgt); cam.orbit.update();
  return true;
}

/* An instrument plugin's strike: sparks + a shared strike light at the contact (its
   local pos → world through the station), an optional camera punch, and its voice.
   hit = { note, vel, pos (Vector3, instrument-local), color, dur (s), shake, sparks } */
function instStrike(rig, hit){
  const v = hit.vel ?? 1;
  const p = rig.station.localToWorld(_sp.copy(hit.pos || new THREE.Vector3()));
  const col = new THREE.Color(hit.color ?? 0xffffff);
  if (hit.sparks !== 0) spawnBurst(p.clone(), col, hit.sparks ?? Math.round(4 + 6 * v), 2.6);
  const L = strikeLights[strikeLightIdx++ % STRIKE_LIGHTS];
  L.l.color.copy(col); L.l.position.copy(p).add(new THREE.Vector3(0, .6, .4));
  L.age = 0; L.peak = 8 * (.35 + .65 * v) * (hit.light ?? 1);
  if (hit.shake) cam.addShake(hit.shake * v);
  if (audio.isReady() && !muted){
    try { audio.playVoice(`inst:${rig.I.key}:${hit.note}`, v, { dur: hit.dur || 0 }); } catch(e){ /* audio must never break the run */ }
  }
}

/* ---------------- timeline ---------------- */
const clock = new THREE.Clock(); clock.autoStart = false;
let started = false;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const sel = document.getElementById('song');
/* ?solo=<key> — an instrument's own demo (its descriptor's `demo`), on a minimal low
   melodic spine (the engine needs one to drive loop length / timeline-zero). Dev tool
   for building an instrument in isolation; the real songs ignore it. */
const soloKey = new URLSearchParams(location.search).get('solo');
const soloI = soloKey && instrumentByKey(soloKey);
if (soloI && soloI.demo){
  const { bpm = 100, beats = 16, part, scale } = soloI.demo;
  SONGS['solo-' + soloKey] = { label: `${soloI.label} (solo)`, sub: 'instrument demo', bpm,
    scale: scale || ['C','D','E','F','G','A','B'],
    melody: Array.from({ length: Math.round(beats / 4) }, (_, i) => [i % 2 ? 'G3' : 'C3', 4]),
    parts: { [soloKey]: part } };
}
Object.entries(SONGS).forEach(([k, s]) => {
  const o = document.createElement('option');
  o.value = k; o.textContent = s.label;
  sel.appendChild(o);
});
if (soloI && SONGS['solo-' + soloKey]) sel.value = 'solo-' + soloKey;
buildWorld(sel.value);
if (soloI) lookAtStation(soloKey);
/* the machine runs from first paint — only AUDIO waits for a gesture.
   (reduced-motion users keep the old behavior: stillness until they opt in) */
if (!reduceMotion){ clock.start(); started = true; }

/* A mortal ball's state at LOCAL time τ (seconds since its birth). Pure: no wrap,
   no strike side-effect — it just reports where the ball is and which pad index
   it's on (idx). The caller adds the per-ball render lift DESCENT·τ and fires the
   strike when idx advances. Positions are WORLD (un-lifted); the +UP marble lift
   off the pad is baked in on the arc segments. */
function ballPos(tr, tau){
  if (tau < tr.rollT){                                  // birth: free-FALL onto pad 0 under HONEST gravity
    const p0 = tr.pads[0].pos;
    // Wait in the mouth (longer for delayed voices), then free-fall a fixed BIRTH_DROP so the
    // marble accelerates exactly like every other arc — no more anti-gravity float. Lands on pad 0
    // moving (a real strike the pad flips), continuous with the first arc at tau=rollT.
    const hold = tr.rollT - BIRTH_FALL;                 // off-screen hold absorbs the variable roll budget
    const s = Math.max(0, tau - hold);                  // seconds into the actual fall
    const fallY = .5 * G.y * s * s;                      // ½·g·s²: starts at rest, accelerates (−BIRTH_DROP at s=FALL)
    const yRender = STAGE_Y + UP.y + BIRTH_DROP + fallY; // mouth → band; render re-adds DESCENT·tau, so subtract it here
    const appear = THREE.MathUtils.clamp((s + .2) / .35, 0, 1);   // fade in as it's released (hidden during the hold)
    return {pos: new THREE.Vector3(p0.x, yRender - DESCENT*tau, p0.z),
            vel: new THREE.Vector3(0, G.y*s - DESCENT, 0),
            plunge:false, idx:-1, nextIdx:0, prog: THREE.MathUtils.clamp(s/BIRTH_FALL, 0, 1),
            curDt:9, nextDt: tr.pads[0].dt, appear};
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
  const T = started ? ((songTime % P) + P) % P : 0;     // loop-local time (always ≥0, even during the lead-in) — display + scrub
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
  const cullDist = Math.min(PAD_CULL, DESCENT * P * .5 - .5);  // ride to the drum; never past the half-period
  const cullC = cullDist / DESCENT;                      // …same edge, in belt-phase units
  const innerC = cullC * .64;                            // fully deployed within this band — strike zone never animates
                                                         // (higher = a tighter, snappier unfold nearer the edge)
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

      const show = (1 - fade) * (r.appear ?? 1);        // appear<1 only during the newborn's pre-fall hold
      rig.halo.material.opacity = HALO_A * show;
      rig.core.material.emissiveIntensity = EMI * show + .1;
      rig.group.visible = show > .002;
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

      if (started && trailTick > .022 && playRate && fade < .5 && show > .5)
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
      po.beltY = STAGE_Y - .12 + DESCENT * c;           // un-nudged belt height — the bracket spine roots here
      // entrance/exit unfold: at the screen edges the pad lies flat & flush on the belt,
      // then telescopes out to rest depth and tips up into catch position — sequenced
      // (extend → tilt) and confined to the edges, so the strike zone stays rock-solid.
      const dep = reduceMotion ? FULL_DEPLOY : deployPose(c, innerC, cullC);
      po.g.quaternion.copy(Q_FLAT).slerp(po.qN, dep.tilt);
      _qn.copy(UPY).applyQuaternion(po.g.quaternion);   // live normal (for the flipper nudge as it unfolds)
      const z = THREE.MathUtils.lerp(BELT_DEPTH + .15, po.base.z, dep.extend);   // belt-flush → rest depth
      po.g.position.set(po.base.x, po.beltY, z)
        .addScaledVector(_qn, padOffset(started ? c : 0, po.amp));
    });

    // ---- the visible machine: scroll the belt in lock-step with the rising pads ----
    if (machinesOn) tr.machine.update(reduceMotion ? 0 : dt);
  });

  // ---- marble drums: one ball per drum, dribbling its solved arcs ----
  drumKit.update(songTime, P, dt, { started, skipStrikes, onStrike: drumStrike });

  // ---- instrument plugins: pure fns of songTime, strikes routed through instStrike ----
  for (const rig of instLive)
    rig.inst.update(songTime, P, dt, { started, skipStrikes, onStrike: hit => instStrike(rig, hit) });
  for (const L of strikeLights){ L.age += dt; L.l.intensity = L.peak * Math.exp(-L.age * 11); }

  if (trailTick > .022) trailTick = 0;
  trailTick += dt;
  skipStrikes = false;                                  // scrub jumps suppress strikes for one frame only
  updateJuice(dt);

  // exposure pop
  expoKick *= (1 - dt*6);
  renderer.toneMappingExposure = 1.15 + expoKick*.12;

  // CAMERA: the rig decides the pose (director / fixed / free-fly / follow) from the
  // live marbles. main just hands it the frame's state; physics stays untouched.
  cam.update({ dt, time: clock.elapsedTime, tracks, marblePts, leadRender, reduceMotion, started });

  if (convDbgOn) convDebug(leadRender ? leadRender.y : cam.target.y, camera.position.y);
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
  cam.resize();
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
  // dev handle for driving the scene from DevTools (look at a station, scrub, slow-mo)
  window.__dev = {
    look(px, py, pz, tx, ty, tz){ cam.camera.position.set(px, py, pz); cam.target.set(tx, ty, tz); cam.orbit.target.set(tx, ty, tz); cam.orbit.update(); },
    get t(){ return songTime; }, set t(v){ songTime = v; skipStrikes = true; },
    set rate(r){ playRate = r; },
    song(k){ sel.value = k; sel.dispatchEvent(new Event('change')); },
    station(key, dist, up){ return lookAtStation(key, dist, up); },
    instruments: () => instLive.map(r => r.I.key),
  };
  dbg = { update(T){
    if (!held) bar.value = Math.round(T / (ROLL_T + LOOP_T) * 1000);
    time.textContent = `T ${T.toFixed(2)} ×${playRate}`;
  }};
}
