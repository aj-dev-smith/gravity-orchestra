import * as THREE from "three";
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SONGS } from './songs/index.js';
import { G, UP, UPY, ROLL_T, solveLaunch, arcPos, arcVel, padOffset } from './engine.js';
import * as audio from './audio.js';
import { glowTex, initJuice, spawnBurst, spawnTrail, spawnRipple, updateJuice } from './juice.js';
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
let muted = false;                                      // sound toggle (mute button)
let songTime = 0, prevT = 0;                            // the timeline; clock only supplies deltas
let playRate = 1, skipStrikes = false, dbg = null;      // ?debug scrub: rate + jump suppression
let recState = 'idle', recorder = null;                 // idle | armed | rec — transitions at the seam
const recEl = document.getElementById('rec');
const CAMCOLORS = {auto:'#ffe9c9', all:'#cfd6e6', lead:'#ffaa55', alto:'#c08bff', bass:'#66aaff'};
const camsEl = document.getElementById('cams');
function renderCamButtons(){
  camsEl.innerHTML = '';
  if (tracks.length < 2){ camsEl.style.display = 'none'; camMode = 'auto'; return; }
  camsEl.style.display = 'flex';
  ['auto', 'all', ...tracks.map(t => t.role)].forEach(m => {
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
const rigs = [
  makeRig({r:.26, body:0xffc488, emissive:0xff9233, glow:0xffaa55}),  // lead
  makeRig({r:.36, body:0xa8d4ff, emissive:0x3d7dff, glow:0x66aaff}),  // bass
  makeRig({r:.21, body:0xe2c8ff, emissive:0x9a4dff, glow:0xc08bff}),  // alto
];

initJuice(scene);                                       // build trail / ripple / spark / dust pools
let trailTick = 0;                                      // gates trail spawns to every .022s
let shakeAmp = 0, expoKick = 0;                         // camera punch & exposure pop

/* ---------------- world builder ----------------
   Solver per track: v0 = (ΔP − ½·g·dt²)/dt — exact, no drift.
   Descent is proportional to time, so parallel tracks fall together. */
function buildTrack(melody, zBase, role, rig, delayBeats = 0, deep = false){
  const isBass = role === 'bass';
  const voiceDeep = isBass || deep;
  const padScale = isBass ? 1.4 : (role === 'alto' ? .85 : 1);
  const rollT = ROLL_T + delayBeats * BEAT;             // late entry = lazy roll
  const pads = []; let t = 0;
  {
    let p = new THREE.Vector3(0, -2.2 * delayBeats * BEAT, zBase), dir = isBass ? -1 : 1;
    melody.forEach(([note, beats], i) => {
      const dt = beats * BEAT;
      pads.push({pos: p.clone(), note, dt, t});
      t += dt;
      if (i % 4 === 3) dir *= -1;                       // weave
      p = p.clone().add(new THREE.Vector3(
        dir * (0.9 + dt * 2.0),
        -dt * 2.2,                                      // time-proportional drop
        Math.sin(i * (isBass ? 1.1 : 1.3)) * (isBass ? 1.0 : 1.4)
      ));
    });
  }
  const arcs = [];
  for (let i = 0; i < pads.length; i++){
    const a = pads[i];
    const target = (i === pads.length-1)
      ? a.pos.clone().add(new THREE.Vector3(0,-9,0))
      : pads[i+1].pos.clone();
    const dt = a.dt;
    arcs.push(solveLaunch(a.pos, target, dt));
  }

  // intro rail aimed along the launch direction
  const launchDir = arcs[0].clone().normalize();
  const p0 = pads[0].pos;
  const rail = new THREE.CatmullRomCurve3([
    p0.clone().addScaledVector(launchDir,-9).add(new THREE.Vector3(0, 7.5, 1.5)),
    p0.clone().addScaledVector(launchDir,-6.5).add(new THREE.Vector3(0, 4.6,-1.2)),
    p0.clone().addScaledVector(launchDir,-4).add(new THREE.Vector3(0, 2.2, .6)),
    p0.clone().addScaledVector(launchDir,-1.6).add(new THREE.Vector3(0, .55, 0)),
    p0.clone()
  ]);
  {
    const frames = rail.computeFrenetFrames(120, false);
    const samples = rail.getSpacedPoints(120);
    const w = isBass ? .3 : .22;
    [-w, w].forEach(off => {
      const pts = samples.map((pt,i)=> pt.clone().addScaledVector(frames.binormals[i], off).add(new THREE.Vector3(0,-.16,0)));
      world.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 120, .06, 10), chrome));
    });
    for (let i=4;i<118;i+=9){
      const s = new THREE.Mesh(new THREE.CylinderGeometry(.04,.04,isBass?.78:.62,8), chrome);
      s.position.copy(samples[i]).y -= .2;
      s.rotation.z = Math.PI/2;
      s.lookAt(samples[i+1].x, s.position.y, samples[i+1].z);
      s.rotateOnAxis(new THREE.Vector3(0,1,0), Math.PI/2);
      world.add(s);
    }
  }

  // pads: normal bisects incoming & outgoing velocity
  const padObjs = pads.map((pad, i) => {
    const prev = (i-1+pads.length) % pads.length;
    const vin = arcVel(arcs[prev], pads[prev].dt);
    const n = arcs[i].clone().normalize().sub(vin.clone().normalize()).normalize();
    if (n.y < .2) n.set(0,1,0);
    const g = new THREE.Group();
    g.position.copy(pad.pos).y -= .12;
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), n);
    g.scale.setScalar(padScale);
    const body = new THREE.Mesh(padGeo, new THREE.MeshStandardMaterial({
      color: isBass ? 0x7e8db0 : 0x9aa6bd, metalness:1, roughness:.18, envMap, envMapIntensity:1.2}));
    const rim = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
      color: new THREE.Color().setHSL(hueOf(pad.note), .8, .55),
      transparent:true, opacity:.18}));
    rim.rotation.x = Math.PI/2; rim.position.y = .09;
    g.add(body, rim); world.add(g);
    return {g, rim, body, flash:0, hue:hueOf(pad.note),
            base: g.position.clone(), n: n.clone(),
            amp: THREE.MathUtils.clamp(arcs[i].dot(n)*.07, .05, 1.6)};
  });

  // landing pool
  const poolPos = pads[pads.length-1].pos.clone().add(new THREE.Vector3(0,-8.6,0));
  const pool = new THREE.Mesh(new THREE.CircleGeometry(isBass?2.6:2.2, 40),
    new THREE.MeshBasicMaterial({color: rig.glow.getHex(), transparent:true, opacity:.10}));
  pool.rotation.x = -Math.PI/2; pool.position.copy(poolPos); world.add(pool);

  rig.group.visible = true;
  return {pads, arcs, rail, padObjs, poolPos, pool, rig, role, isBass, deep:voiceDeep, rollT, lastIdx:-1, total:t};
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
      if (o.material && o.material !== chrome) o.material.dispose();
    });
  }
  world = new THREE.Group(); scene.add(world);
  rigs.forEach(r => r.group.visible = false);

  tracks = [ buildTrack(S.melody, 0, 'lead', rigs[0]) ];
  if (S.alto){
    const d = Array.isArray(S.alto) ? {notes:S.alto, delay:0} : S.alto;
    tracks.push( buildTrack(d.notes, -3.4, 'alto', rigs[2], d.delay, d.deep) );
  }
  if (S.bass){
    const d = Array.isArray(S.bass) ? {notes:S.bass, delay:0} : S.bass;
    tracks.push( buildTrack(d.notes, 4.2, 'bass', rigs[1], d.delay) );
  }
  LOOP_T = tracks[0].total + 1.2;

  audio.setBeat(BEAT);
  if (camMode !== 'all' && camMode !== 'auto' && !tracks.some(t => t.role === camMode)) camMode = 'auto';
  renderCamButtons();
  audio.rebuildBank(tracks);
  songTime = 0; prevT = 0;
  if (started) clock.start();                           // restart from the rails
}

const noteEl = document.getElementById('note');
function strike(tr, i){
  const pad = tr.pads[i], po = tr.padObjs[i];
  po.flash = 1;
  tr.rig.lamp.intensity = 7;                            // strike flash
  if (tr.role === 'lead') noteEl.innerHTML = `<b>${pad.note}</b>&nbsp; ·&nbsp; ${'·'.repeat(Math.min(i, 40))}`;
  spawnRipple(pad.pos, po.g.quaternion, po.hue, tr.isBass, po.amp);
  // JUICE: sparks, squash, punch
  const sparkColor = new THREE.Color().setHSL(po.hue, .85, .62);
  spawnBurst(pad.pos.clone().add(UP), sparkColor,
             Math.min(5 + Math.round(pad.dt*7), 16),
             2.4 + Math.min(pad.dt*1.6, 3));
  tr.rig.squash = 1;
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
const startPos = tracks[0].rail.getPointAt(0).add(UP);
const camTarget = startPos.clone();
const camPos = startPos.clone().add(new THREE.Vector3(4.5, 2.6, 9.5));
camera.position.copy(camPos); camera.lookAt(camTarget);

/* position+velocity of a track's marble at loop-time T; fires strikes */
function trackPos(tr, T){
  if (T < tr.rollT){
    const u = T / tr.rollT;
    const e = Math.min(u*u*(3-2*u)*.65 + u*.35, 1);
    return {pos: tr.rail.getPointAt(e).add(UP),
            vel: tr.rail.getTangentAt(Math.min(e,.999)).multiplyScalar(6),
            plunge:false, nextIdx:0, prog:u, curDt:9, nextDt: tr.pads[0].dt};
  }
  let at = T - tr.rollT, i = 0;
  while (i < tr.pads.length && at >= tr.pads[i].dt){ at -= tr.pads[i].dt; i++; }
  if (i >= tr.pads.length){                             // tail: continue last arc
    const a = tr.pads[tr.pads.length-1];
    const t2 = a.dt + (T - (tr.rollT + a.t + a.dt));
    const lastArc = tr.arcs[tr.arcs.length-1];
    return {pos: arcPos(a.pos, lastArc, t2), vel: arcVel(lastArc, t2),
            plunge:true, nextIdx:-1, prog:0, curDt:9, nextDt:9};
  }
  if (i !== tr.lastIdx){ tr.lastIdx = i; if (!skipStrikes) strike(tr, i); }
  return {pos: arcPos(tr.pads[i].pos, tr.arcs[i], at).add(UP),
          vel: arcVel(tr.arcs[i], at),
          plunge:false,
          nextIdx: i+1 < tr.pads.length ? i+1 : -1,
          prog: at / tr.pads[i].dt,
          curDt: tr.pads[i].dt,
          nextDt: i+1 < tr.pads.length ? tr.pads[i+1].dt : 9};
}

function animate(){
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), .05);
  songTime += dt * playRate;
  const T = started ? songTime % (ROLL_T + LOOP_T) : 0;
  if (started && T < prevT){                            // loop wrap / backward scrub
    tracks.forEach(tr => { tr.lastIdx = -1; tr.splashed = false; });
    if (recState === 'armed') beginRec();               // seam-to-seam: end state = start state,
    else if (recState === 'rec') finishRec();           // so the video loops seamlessly
  }
  prevT = T;
  if (dbg && started) dbg.update(T);
  if (recState === 'armed')
    recEl.textContent = `● IN ${(ROLL_T + LOOP_T - T).toFixed(1)}S${muted ? ' · SILENT' : ''}`;
  else if (recState === 'rec')
    recEl.textContent = `● ${T.toFixed(1)}/${(ROLL_T + LOOP_T).toFixed(0)}S`;

  let leadPos = null;
  const marblePts = [];
  tracks.forEach(tr => {
    const rig = tr.rig;
    const r = started ? trackPos(tr, T)
                      : {pos: tr.rail.getPointAt(0).add(UP),
                         vel: tr.rail.getTangentAt(0), plunge:false, nextIdx:0, prog:0};
    marblePts.push({p: r.pos, w: tr.role === 'lead' ? 1.7 : 1, role: tr.role});
    tr._st = {dt: r.curDt, next: r.nextDt, prog: r.prog};
    if (tr.role === 'lead') leadPos = r.pos;
    let visible = true;
    if (r.plunge){
      const fade = THREE.MathUtils.clamp((tr.poolPos.y + 1 - r.pos.y), 0, 1);
      rig.halo.material.opacity = HALO_A * (1-fade);
      rig.core.material.emissiveIntensity = EMI*(1-fade)+.1;
      tr.pool.material.opacity = .10 + fade*.3;
      if (!tr.splashed && r.pos.y < tr.poolPos.y + .4){
        tr.splashed = true;
        spawnBurst(tr.poolPos.clone().add(UP), rig.glow, 22, 5);
      }
      if (r.pos.y < tr.poolPos.y) visible = false;
    } else {
      rig.halo.material.opacity = HALO_A;
      rig.core.material.emissiveIntensity = EMI;
      tr.pool.material.opacity += (.10 - tr.pool.material.opacity)*.05;
    }
    rig.group.visible = visible;
    rig.group.position.copy(r.pos);
    rig.core.rotation.x += dt*6; rig.core.rotation.z += dt*3.4;
    rig.lamp.intensity += (3.5 - rig.lamp.intensity) * dt * 8;

    // squash & stretch along velocity
    const speed = r.vel.length();
    if (speed > .01) rig.deform.quaternion.setFromUnitVectors(UPY, r.vel.clone().normalize());
    rig.squash *= (1 - dt*9);
    const sq = rig.squash;
    const stretch = 1 + Math.min(speed*.014, .4);
    const sy = stretch*(1-sq) + .55*sq;
    const sxz = (1/Math.sqrt(stretch))*(1-sq) + 1.3*sq;
    rig.deform.scale.set(sxz, sy, sxz);

    if (started && visible && trailTick > .022 && playRate)
      spawnTrail(r.pos, rig.glow, tr.isBass);
    tr.padObjs.forEach((po, idx) => {
      po.flash *= (1 - dt*4);
      const pre = (idx === r.nextIdx) ? r.prog*r.prog : 0;   // anticipation glow
      po.rim.material.opacity = .08 + po.flash*.5 + pre*.3;
      po.rim.scale.setScalar(1 + pre*.22 + po.flash*.12);
      po.body.material.emissive.setHSL(po.hue, .7, po.flash*.32 + pre*.07);
      const phase = (started ? T : 0) - (tr.rollT + tr.pads[idx].t);
      po.g.position.copy(po.base).addScaledVector(po.n, padOffset(phase, po.amp));
    });
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

  // camera: follow the chosen marble, or frame them all
  const sway = reduceMotion ? 0 : Math.sin(clock.elapsedTime*.21);
  const followed = effMode !== 'all' ? marblePts.find(m => m.role === effMode) : null;
  const focus = new THREE.Vector3();
  let back = Math.max(1, 1.3 / Math.min(camera.aspect, 1.3));
  if (followed){
    focus.copy(followed.p);
    back *= .92;                                        // tight, personal chase
  } else {
    let wSum = 0;
    marblePts.forEach(m => { focus.addScaledVector(m.p, m.w); wSum += m.w; });
    focus.divideScalar(wSum);
    let spread = 0;
    marblePts.forEach(m => spread = Math.max(spread, m.p.distanceTo(focus)));
    back *= (1 + Math.min(spread * .075, .7));
  }
  const ideal = focus.clone().add(new THREE.Vector3((4.5 + sway*2.2)*back, 2.6*back, (9.5 - sway*1.4)*back));
  camPos.lerp(ideal, 1 - Math.pow(.0015, dt));
  camTarget.lerp(focus, 1 - Math.pow(.0008, dt));
  camera.position.copy(camPos);
  shakeAmp *= (1 - dt*7);
  if (!reduceMotion && shakeAmp > .002){
    camera.position.x += (Math.random()-.5)*shakeAmp;
    camera.position.y += (Math.random()-.5)*shakeAmp;
  }
  camera.lookAt(camTarget);

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
