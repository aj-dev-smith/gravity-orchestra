import * as THREE from "three";
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { makePerfGovernor } from './perfgov.js';
import { singlePassFlats } from './perftune.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SONGS, DEFAULT_SONG, defaultSongKey } from './songs/index.js';
import { fillSongMenu, addSongOption, isRuntimeSong } from './songmenu.js';
import { G, UP, UPY, ROLL_T, DESCENT, solveLaunch, arcPos, arcVel, padOffset, beltPhase, deployPose, PAD_R, padRadius, layoutPads, noteHz } from './engine.js';
import * as audio from './audio.js';
import { glowTex, initJuice, spawnBurst, spawnTrail, spawnRipple, updateJuice } from './juice.js';
import { makePaternosterShop, makeToneBarParts, PT, BAR } from './paternoster.js';
import { planCrane, plateField, plateEdge, plateDeploy, craneBall, segAt, hopLayout } from './crane.js';
import { makeMarbleDrums, KIT_SOLO, KIT_ROOM, kitAnchor } from './marbledrums.js';
import { makeCameraRig } from './camera.js';
import { makeRoomHost } from './rooms/index.js';
import { INSTRUMENTS, instrumentByKey } from './instruments/index.js';
import { stationFor, layoutStations, HANG_CLEAR, hangPlace } from './instruments/stations.js';
import { eventTimes, wrapP } from './instruments/clock.js';
import { normalizeHit } from './drumkit.js';
import { encodeSong, decodeSong } from './share.js';
import { parseMidi } from './midi/parse.js';
import { convertToSong } from './midi/convert.js';
import { recSupported, startRecording } from './record.js';
import { spatialize } from './spatial.js';
import { mergeStatic, watchFrozen, pruneFrozen, frozenStats } from './mergestatic.js';
import { makeEditor } from './editor/index.js';
import { planEdit, shotAt, signatureOf } from './directorplan.js';
import { RIDE, ridePose, rideMoments, rideWindowAt } from './ridecam.js';
import { makeFollow, solveShots as solveShotsIn, resolveRoom, solidBox, roomSolids } from './shotrig.js';
import { makeXR } from './xr.js';
import { U_PER_M } from './xrplan.js';
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
let drumGroup = null;                                   // the drum machine's group (dev layout probe)
let stageWall = new THREE.Box3();                       // the belt machines' world box this song (staging + the wide fit)
let curBuild = null;                                    // this song's staging inputs (stage edit re-anchors from them: restage)
let lastLayout = null, lastWide = null, lastShots = [], devMarbles = [], lastSolve = null;                                  // dev: the last room solve (__dev.layout)
let kitSlot = KIT_SOLO;                                 // where the drum machine stands this song (marbledrums.js)
const FIXED_ZMAX = 30;                                  // FIXED cam: cap the pull-back. Past ~30 the FogExp2 eats
                                                        // the chrome to black; better to let a very wide field
                                                        // overflow the frame edges than fade the whole scene out.
let muted = false;                                      // sound toggle (mute button)
let songTime = 0;                                       // the timeline; clock only supplies deltas
let playRate = 1, skipStrikes = false, dbg = null;      // ?debug scrub: rate + jump suppression
let devStrikes = null;                                   // ?debug sound sweep: strikes per machine (+ ids with no baked voice)
let loopIndex = -1;                                     // floor(songTime / P); ticks once per loop → spawns balls
/* CONVEYOR: the world no longer falls. Each pad RECIRCULATES — it rises to the
   static band exactly at its strike (beltPhase) then wraps away off-screen. Each
   marble is MORTAL — born once per loop, it juggles in the band via a per-ball
   render lift = DESCENT·τ, then plunges out the bottom and is recycled. The two
   mechanisms share no state; they meet at the band, at strikes, by construction.
   Physics is untouched — this is all render-time framing. */
const STAGE_Y = DESCENT * ROLL_T;                       // the static strike band (~5.7) every pad rises to meet
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
/* XR (src/xr.js): a headset's projection layer only gets 4× MSAA when the canvas asks for it
   (WebXRManager: samples = antialias ? 4 : 0) — chrome rails + chains shimmer without. Only on a
   headset browser (or ?xr / ?xremu): in 2D the canvas MSAA is pure cost (see the post chain). */
const XR_LIKELY = /OculusBrowser|Quest/i.test(navigator.userAgent) || /[?&](xr|xremu)(=|&|$)/.test(location.search);
const renderer = new THREE.WebGLRenderer({antialias: XR_LIKELY});
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;     // applied by OutputPass at the end of the chain
renderer.toneMappingExposure = 1.15;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.matrixAutoUpdate = false;                         // the scene root never moves (PERF: no forced whole-tree matrix pass)
const _pbRay = new THREE.Raycaster(), _pbDir = new THREE.Vector3();
scene.background = new THREE.Color(0x07060e);
scene.fog = new THREE.FogExp2(0x07060e, 0.026);

/* every way of looking at the static stage — director / fixed / free-fly / follow —
   lives in the camera rig. It owns the camera object, the cam-button row, the orbit
   + WASD/QE fly controls, and the per-frame framing. main just feeds it the live
   marbles each frame and the tracks on each song change. */
const cam = makeCameraRig({ stageY: STAGE_Y, fixedZMax: FIXED_ZMAX,
                            dom: renderer.domElement, camsEl: document.getElementById('cams'), pathBlocked, ridePose: rideCam });
/* does the straight line a → b pass through any drawn machine part? (the director asks once
   per cut: a glide that would dolly through geometry becomes a hard cut) */
function pathBlocked(a, b){
  if (!world) return false;
  const d = _pbDir.subVectors(b, a), L = d.length();
  if (L < .5) return false;
  _pbRay.set(a, d.divideScalar(L)); _pbRay.far = L; _pbRay.camera = cam.camera;   // (sprites need a camera)
  return _pbRay.intersectObject(world, true).some(h => (h.object.isMesh || h.object.isInstancedMesh) && drawn(h.object));
}
/* is o actually drawn — itself AND every ancestor visible (a hidden parent hides its children) */
function drawn(o){ for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; }
const camera = cam.camera;

const ambient = new THREE.AmbientLight(0x223, 1.6); scene.add(ambient);   // rooms may re-tint (rooms/index.js mood)
/* gentle global fill: cool from the ceiling, dim warm bounce from the floor — lifts
   the room and the matte instrument bodies a touch without flattening the bloom mood */
const hemi = new THREE.HemisphereLight(0x4a5a8c, 0x161420, .45); scene.add(hemi);
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

/* --- ROOMS (src/rooms/): the environment the instruments stand in — greybox /
   cathedral / studio / void / off. PURE STAGING, no engine reach. ?room=<key> picks
   one, R cycles. ROOM.FLOOR is the same in every room (the floor contract), so the
   legs/stands planted on it at build stay honest across a swap — no world rebuild. */
const rooms = makeRoomHost({ scene, envMap, renderer, lights: { ambient, hemi } });
const ROOM = rooms.frame;                                 // the instrument legs/stands plant on ROOM.FLOOR

/* --- post chain: render → bloom → tonemap/sRGB out ---
   Real bloom on the emissive cores; the sprite halos stay as the soft
   wide base (bloom alone is too tight to replace their reach). */
/* ANTIALIASING lives HERE, not on the canvas: the scene is drawn into the composer's target, so
   a multisampled canvas (antialias:true) only ever smoothed the final full-screen quad — pure cost.
   A 1× screen gets a 4× MSAA scene target (crisp rails + chains); a ≥1.5× screen (phones, retina)
   is dense enough that its pixels hide the stair-steps, and skips the multisample bandwidth. */
const MSAA = Math.min(devicePixelRatio, 2) < 1.5 ? 4 : 0;
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: MSAA }));
composer.setPixelRatio(Math.min(devicePixelRatio, 2));
composer.setSize(innerWidth, innerHeight);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), .12, .3, .9);
/* halos predate bloom and were tuned to BE the glow — with real bloom they
   drop to a faint wide base or the two stack into giant blobs */
const HALO_A = .12, EMI = 1.2;
/* …but a headset gets NO post chain (EffectComposer can't render XR): the halos + emissive cores
   step back up toward their pre-bloom job while presenting (main's xrSession swaps them) */
const XR_HALO_A = .34, XR_EMI = 2.1;
let haloA = HALO_A, emi = EMI;
const xrLit = []; let xrLitAge = 0, xrSaved = new Float32Array(0);   // (xrRender: the lights it re-scales)
composer.addPass(bloom);
composer.addPass(new OutputPass());
/* PERF GOVERNOR (src/perfgov.js): a device that can't hold the frame at its pixel ratio steps
   down a ladder of ratios (bloom chain a notch coarser on the last rungs); a fast one never moves */
let bloomScale = 1;
const _bloomSize = bloom.setSize.bind(bloom);
bloom.setSize = (w, h) => _bloomSize(Math.max(1, Math.round(w * bloomScale)), Math.max(1, Math.round(h * bloomScale)));
const gov = makePerfGovernor({ screen: () => ({ maxPR: Math.min(devicePixelRatio, 2), msaa: Math.min(devicePixelRatio, 2) < 1.5 ? 4 : 0 }), apply(q){
  bloomScale = q.bloomScale;
  for (const rt of [composer.renderTarget1, composer.renderTarget2]) if (rt.samples !== q.msaa){ rt.samples = q.msaa; rt.dispose(); }
  renderer.setPixelRatio(q.pr); composer.setPixelRatio(q.pr);   // (both re-size their targets)
  rooms.resize(innerWidth, innerHeight, q.pr); } });

const chrome = new THREE.MeshStandardMaterial({color:0xd8dde8, metalness:1, roughness:.12, envMap, envMapIntensity:1.4});

/* The visible machine: the PATERNOSTER (src/paternoster.js) — open roller chains on
   toothed sprockets carrying tuned tone-plates, a magnet crane in the top housing.
   beltSpeed = DESCENT is the honesty hook: plates rise at DESCENT, chains scroll at
   DESCENT → slip-free, no state. Built per track in buildWorld, lives under tr.stage.
   (It replaced the original solid belt WALL, conveyor.js — in git history before 3579606.) */
const shop = makePaternosterShop({ envMap, beltSpeed: DESCENT, bandY: STAGE_Y, floorY: ROOM.FLOOR });
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
const STRIKE_LIGHTS = 4;                                // shared pool, CONSTANT size → no shader recompiles (each point light is
                                                        // shaded in EVERY lit fragment: 4 round-robin ~.2 s flashes are plenty)
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
let convDbgOn = false;                                   // dev HUD — G toggles it; ships OFF
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
addEventListener('keydown', e => { if (e.key === 'r' || e.key === 'R') rooms.cycle(); });   // cycle rooms (incl. off)
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
  // (a gap too long for a free arc is a CRANE HOP — crane.js — so its step stops growing with dt)
  const pads = layoutPads(melody, {zBase, isBass, delayBeats, beat: BEAT, radOf, ...hopLayout(-G.y)});
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

  const bar = makeToneBarParts({ envMap });           // tone-plate parts, per track
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
    // a tuned steel tone-plate on brass node pins, wearing a glowing hue frame
    const body = new THREE.Mesh(bar.barGeo, new THREE.MeshStandardMaterial({
        color: isBass ? 0xb4c0da : 0xe2e7f0, metalness:.7, roughness:.24, envMap, envMapIntensity:1.7}));
    const rim = new THREE.Mesh(bar.rimGeo, new THREE.MeshBasicMaterial({
        color: new THREE.Color().setHSL(hueOf(pad.note), .9, .62).multiplyScalar(1.35),   // reads from the stage shot
        transparent:true, opacity:.18, depthWrite:false}));
      rim.position.y = .062;
      g.add(new THREE.Mesh(bar.pinGeo, bar.brass));
    g.add(body, rim); stage.add(g);
    return {g, rim, body, flash:0, hue:hueOf(pad.note),
            base: g.position.clone(), n: n.clone(), qN: g.quaternion.clone(),
            amp: THREE.MathUtils.clamp(arcs[i].dot(n)*.07, .05, 1.6)};
  });

  return {stage, origin:new THREE.Vector3(), pads, arcs, padObjs, role, isBass, deep:voiceDeep, rollT, total, balls:[], active:null};
}

/* World-space bounds of what is actually DRAWN under `root` (hidden parts — a parked ball,
   a stowed pad — don't count; sprites/halos don't either). `ignoreRoot`: measure a group
   even while it is toggled off (the M key hides the belt machines). */
const _vb = new THREE.Box3();
function visBox(root, ignoreRoot = false){
  const out = new THREE.Box3();
  root.updateWorldMatrix(true, true);                   // parents too: a fresh bay's stage hasn't rendered yet
  (function walk(o){
    if (!o.visible && !(ignoreRoot && o === root)) return;
    if (o.isInstancedMesh){ if (o.count){ o.computeBoundingBox(); out.union(_vb.copy(o.boundingBox).applyMatrix4(o.matrixWorld)); } }
    else if ((o.isMesh || o.isLine) && o.geometry){
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      out.union(_vb.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld));
    }
    for (const c of o.children) walk(c);
  })(root);
  return out;
}
/* the underside of a HUNG station: the lowest drawn mesh that isn't anchored to the floor
   (its footprint ring lies on ROOM.FLOOR — anything whose box reaches that low is floor-marking) */
function hangLow(root){
  let low = Infinity;
  root.updateWorldMatrix(true, true);
  root.traverse(o => {
    if (!(o.isMesh || o.isLine) || !o.geometry) return;
    for (let p = o; p && p !== root; p = p.parent) if (!p.visible) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    _vb.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
    if (_vb.min.y > ROOM.FLOOR + 1) low = Math.min(low, _vb.min.y);
  });
  return low;
}
/* every ADDITIVE, opacity-driven material under root (glows, flashes, halos, trails) — the
   ones that are invisible at opacity 0 (shader materials draw by their own uniforms: skipped) */
let fadeMats = [], fadeWarm = 0, fadeTick = 0, perfOff = false;
const NO_MERGE = new URLSearchParams(location.search).has('nomerge');
let mergeStats = null;                                  // dev: what the static merge baked (__dev.merge)
function collectFadeMats(root){
  const out = new Set();
  root.traverse(o => { for (const m of [].concat(o.material || []))
    if (m.transparent && m.blending === THREE.AdditiveBlending && !m.isShaderMaterial && !m.userData.noFadeGate && !o.userData.noFadeGate) out.add(m); });
  return [...out];
}
function disposeTree(root){
  root.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    for (const m of [].concat(o.material || [])) if (m !== chrome){ if (m.map) m.map.dispose(); m.dispose(); }
  });
}

function buildWorld(keyName){
  if (recState !== 'idle') abortRec();                  // a rebuilt world invalidates the take
  const S = editor.song(keyName);                       // (the creation tools' instrument MAP may re-route it — src/editor)
  BEAT = 60 / S.bpm; SCALE = S.scale;
  document.getElementById('songsub').textContent = S.sub;

  if (world){
    scene.remove(world);
    world.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material && o.material !== chrome){
        if (o.material.map) o.material.map.dispose();   // per-song belt CanvasTextures — don't leak
        o.material.dispose();
      }
    });
  }
  world = new THREE.Group(); world.matrixAutoUpdate = false; scene.add(world);   // (never moves: lets still stations skip matrix work)
  pruneFrozen();
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
  tracks.forEach(planTrackCrane);     // conserved marble: solve each voice's magnet crane
  const GAP = PT.GAP;
  let cursor = 0;
  tracks.forEach(tr => {
    const xs = tr.padObjs.map(po => po.base.x);
    const lo = Math.min(...xs), hi = Math.max(...xs);
    tr.origin.set(cursor - lo, 0, 0);                   // shift the field's left edge to the cursor
    cursor += (hi - lo) + GAP;
  });
  const wallW = cursor - GAP;                           // centre the whole wall on x=0
  tracks.forEach(tr => {
    tr.origin.x -= wallW/2; tr.stage.position.copy(tr.origin); tr.stage.name = 'belt:' + tr.role; world.add(tr.stage);
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

  // ---- STAGING. Everything is built at its BASE slot first, then the room is SOLVED from
  //      what was really built (stations.js layoutStations: the wings ride out with the
  //      belt's edges, overlapping footprints are pushed apart) and moved into place — a
  //      rigid translation of solved worlds, render-time only. ----
  const wallBox = stageWall.makeEmpty();
  tracks.forEach(tr => {                                // pose the machine once (its chains + carriers are placed by
    tr.padObjs.forEach(po => { po.beltY ??= STAGE_Y; }); //  update(), not at build) — the animate loop re-poses it anyway
    tr.machine.update(0, 0);
    wallBox.union(visBox(tr.machine.group, true));
  });
  const full = !!(S.parts && Object.keys(S.parts).some(k => S.parts[k]?.length));
  const P0 = ROLL_T + LOOP_T, loopBeats = S.melody.reduce((a, n) => a + n[1], 0);

  // marble drums: built song-level, added under world (so it disposes with the world on the
  // next song change). Aligned to the lead's timeline; `start` arms every ball on its magnet
  // for the count-in. The kit moves to the front-right tier when the room is full of plugin
  // stations; the solve may slide it further (then it is rebuilt there: its contacts are world).
  kitSlot = editor.kitSlot(full ? KIT_ROOM : KIT_SOLO);  // (a user-placed kit — stage edit — is pinned there)
  // (posed once at the count-in instant: an un-posed ball parked at the origin would make the
  //  measured footprint reach across the room)
  const POSE0 = { started: false, skipStrikes: true, onStrike(){} };
  const buildKit = () => { const g = drumKit.build(S.drums, { rollT: ROLL_T, beat: BEAT, P: P0, cx: stageView.cx, start: -LEAD_IN, slot: kitSlot });
    drumKit.update(-LEAD_IN, P0, 0, POSE0); return g; };
  drumGroup = buildKit();
  world.add(drumGroup);

  // instrument plugins: each part builds inside its station (render-time placement only)
  const voices = [];
  instLive = [];
  instRigs.forEach((rig, i) => {
    const part = S.parts?.[rig.I.key];
    if (!part || !part.length) return;
    const st = editor.slot(rig.I.key, stationFor(rig.I.key, i));   // a user-placed station (stage edit): pinned x/z/yaw
    const station = new THREE.Group(); station.name = rig.I.key;   // (names: perf/debug probes)
    // a HUNG station (the ricochet chandelier) is a crown over the belt: centred on the wall,
    // its LOWEST part (plate, stem, the knot's wire) HANG_CLEAR above the paternoster's top
    // housing — never across the strike band, never reading as resting on the housing
    const hung = st.hang && !wallBox.isEmpty();
    let y = hung ? wallBox.max.y + HANG_CLEAR : st.y;
    const z = hung ? (wallBox.min.z + wallBox.max.z) / 2 + st.z : st.z;
    station.position.set(stageView.cx + st.x, y, z);
    station.rotation.y = st.yaw;
    const buildAt = () => rig.inst.build(part, { rollT: ROLL_T, beat: BEAT, P: P0, start: -LEAD_IN,
      station: st, floorY: ROOM.FLOOR - y, ceilY: ROOM.CEIL - y, loopBeats });
    let body = buildAt();
    station.add(body);
    world.add(station);
    rig.inst.update(-LEAD_IN, P0, 0, POSE0);              // posed at the count-in, before it is measured
    station.updateMatrixWorld(true);
    if (hung){                                          // measure the BUILT sculpture's underside…
      const low = hangLow(station);
      if (Number.isFinite(low) && Math.abs(wallBox.max.y + HANG_CLEAR - low) > .02){
        y += wallBox.max.y + HANG_CLEAR - low;          // …and rehang it (rebuilt: its floor ring + ceiling rods are world-anchored)
        station.remove(body); disposeTree(body);
        station.position.y = y; station.updateMatrixWorld(true);
        body = buildAt(); station.add(body); rig.inst.update(-LEAD_IN, P0, 0, POSE0); station.updateMatrixWorld(true);
      }
      // an OFF-CENTRE hung station (the volley court) rides out with its wing / flies forward
      // past a wide belt (stations.js hangPlace) — measured from its built footprint
      const b = visBox(station), p = station.position;
      if (!b.isEmpty() && Math.abs(st.x) > 4){
        const at = hangPlace(st, [b.min.x - p.x, b.max.x - p.x, b.min.z - p.z, b.max.z - p.z],
          [wallBox.min.x, wallBox.max.x, wallBox.min.z, wallBox.max.z],
          { x0: -ROOM.HW + 2.5, x1: ROOM.HW - 2.5, z0: ROOM.BACK + 2.5, z1: 31 }, { cx: stageView.cx });
        station.position.x = at.x; station.position.z = at.z; station.updateMatrixWorld(true);
      }
    }
    rig.station = station; rig.slot = { ...st, y };
    // the room solve may raise a floor station onto the rear GALLERY (stations.js): rebuilt at
    // its new deck height — its legs are world-anchored to the room floor (floorY)
    rig.raise = ny => {
      y = ny; station.remove(body); disposeTree(body);
      station.position.y = y; station.updateMatrixWorld(true);
      body = buildAt(); station.add(body); rig.inst.update(-LEAD_IN, P0, 0, POSE0); station.updateMatrixWorld(true);
      rig.slot.y = y;
    };
    rig.cue = eventTimes(part, { rollT: ROLL_T, beat: BEAT }).map(e => ({ t: e.t, w: e.vel, id: String(e.note) }));   // (id: what it played — the director reads a hook's variety)
    rig.mix = partMix(S, rig.I.key);
    instLive.push(rig);
    // (voiceIds gets the tempo: a plugin may bucket its voices by a note's length in SECONDS)
    const ids = rig.I.voiceIds ? rig.I.voiceIds(part, { beat: BEAT, bpm: S.bpm, rollT: ROLL_T, P: P0, loopBeats }) : [...new Set(part.map(e => e[1]))];
    ids.forEach(id => voices.push({ key: `inst:${rig.I.key}:${id}`, wet: !!rig.I.wet, hz: voiceHzOf(rig.I, id),
      render: () => mixRender(rig.I.voice(id), rig.mix.base) }));
  });

  // the SOLVE: floor stations + the kit (a hung station floats over everyone — not in it)
  let tops = {}, bots = {};
  const relBox = (o, ox, oz, key) => { const b = visBox(o); if (b.isEmpty()) return null; tops[key] = b.max.y; bots[key] = b.min.y;
    return [b.min.x - ox, b.max.x - ox, b.min.z - oz, b.max.z - oz]; };
  const items = [];
  instLive.forEach(r => { if (r.slot.hang) return;
    const p = r.station.position, box = relBox(r.station, p.x, p.z, r.I.key);
    if (box) items.push({ key: r.I.key, x: p.x, z: p.z, box, top: tops[r.I.key], deck: p.y, rig: r, pin: r.slot.pin }); });
  // (the HUNG stations' world footprints: a gallery deck keeps clear of them — the organ loft's
  //  chassis and the chandelier's crown stand where a gallery machine would)
  const hungBoxes = instLive.filter(r => r.slot.hang).map(r => visBox(r.station)).filter(b => !b.isEmpty()).map(b => [b.min.x, b.max.x, b.min.z, b.max.z]);
  const kx0 = stageView.cx + kitSlot.x, kz0 = kitSlot.z;
  if (S.drums){ const box = relBox(drumGroup, kx0, kz0, 'drums'); if (box) items.push({ key: 'drums', x: kx0, z: kz0, box, top: tops.drums, pin: kitSlot.pin }); }
  if (items.length && !wallBox.isEmpty()){
    const solved = layoutStations(items,
      [wallBox.min.x, wallBox.max.x, wallBox.min.z, wallBox.max.z],
      { x0: -ROOM.HW + 2.5, x1: ROOM.HW - 2.5, z0: ROOM.BACK + 2.5, z1: 31 },
      { cx: stageView.cx, bandY: STAGE_Y - 1.5, eyeY: 20, wallTop: wallBox.max.y, hung: hungBoxes });   // (band − 1.5: the pads rising INTO the band read too)
    lastLayout = { items: items.map(({ key, x, z, box, top, deck }) => ({ key, x, z, box, top, y0: bots[key], deck })), wall: wallBox.clone(), solved, cx: stageView.cx, bandY: STAGE_Y - 1.5, hung: hungBoxes };
    items.forEach(it => {
      const { x, y, z } = solved[it.key];
      if (it.rig){
        if (y !== undefined && Math.abs(y - it.rig.station.position.y) > 1e-6) it.rig.raise(y);   // up onto the gallery
        it.rig.station.position.x = x; it.rig.station.position.z = z; it.rig.station.updateMatrixWorld(true);
      }
      else if (Math.abs(x - kx0) + Math.abs(z - kz0) > 1e-6){       // the kit moved: rebuild it at its solved slot
        world.remove(drumGroup); disposeTree(drumGroup);
        kitSlot = { x: x - stageView.cx, z };
        drumGroup = buildKit(); world.add(drumGroup);
      }
    });
  }

  // PERF: bake each station's provably-still parts into one mesh per material (mergestatic.js —
  // posed across the whole loop first: a part that ever moves or blinks is left alone).
  // ?nomerge skips it (A/B).
  if (!NO_MERGE){
    const times = Array.from({ length: 48 }, (_, k) => -LEAD_IN + (k + .37) / 48 * (P0 + LEAD_IN));
    mergeStats = { merged: 0, removed: 0 };
    mergeStats.frozen = 0;
    const add = r => { mergeStats.merged += r.merged; mergeStats.removed += r.removed; mergeStats.frozen += r.frozen || 0; };
    const RUN = { started: true, skipStrikes: true, onStrike(){} };   // (started: the LIVE pose — !started is the armed hold)
    // (the last arg re-poses for the count-in; parts still across the sweep AND that pose stop auto-updating their matrices)
    instLive.forEach(r => add(mergeStatic(r.station, t => r.inst.update(t, P0, 0, RUN), times, () => r.inst.update(-LEAD_IN, P0, 0, POSE0))));
    if (drumGroup) add(mergeStatic(drumGroup, t => drumKit.update(t, P0, 0, RUN), times, () => drumKit.update(-LEAD_IN, P0, 0, POSE0)));
  }

  // a full room is deep: thin the haze so the back tier still reads from the wide shot
  // (FogExp2 .026 at ~50 u ≈ 18 % visible; .016 ≈ 45 %)
  scene.fog.density = instLive.length ? .016 : .026;
  rooms.suggest(S.room);                                // a song may name its room (data); a viewer's pick wins
  // the song's weather for the room (data): storm = beats that flash lightning, sky = [[beat,
  // 'night'|'dawn'], …] — the room reads them as pure fns of songTime (a room may ignore them)
  rooms.cue({ storm: Array.isArray(S.storm) ? S.storm.filter(Number.isFinite) : null,
              sky: Array.isArray(S.sky) ? S.sky.filter(c => Array.isArray(c) && Number.isFinite(c[0]) && typeof c[1] === 'string') : null,
              rollT: ROLL_T, beat: BEAT, P: ROLL_T + LOOP_T,
              drums: S.drums || null, melody: S.melody, loopBeats, start: -LEAD_IN });   // (the arena solves its pyro cues from these)
  curBuild = { S, view: stageView, wallW, P0, buildKit };
  placeRoom();

  audio.setBeat(BEAT);
  cam.syncTracks(tracks, stageView);                    // reframe + rebuild the cam-button row for the new song
  syncDirector(S, stageView);
  fadeMats = collectFadeMats(world); fadeWarm = 3;
  audio.rebuildBank(tracks, S.drums ? Object.keys(S.drums) : [], voices);
  gov.hold(90);                                         // a rebuild's hitch + compiles are not the device's pace
  singlePassFlats(scene);                               // PERF (perftune.js): no 2-pass draw for flat/additive see-through parts
  // start in the loop's TAIL: songTime < 0 means no ball has spawned yet (li stays
  // -1), so the machine + any tail/pickup drums play as a count-in, then the marble
  // spawns at songTime 0 and rolls into the downbeat. skipStrikes guards the first
  // frame from retro-firing every drum edge it lands on (same as a scrub jump).
  songTime = -LEAD_IN; loopIndex = -1; skipStrikes = true;
  tracks.forEach(tr => spawnBall(tr, 0));   // the count-in: marble hangs ARMED on its magnet
  if (started) clock.start();
  editor.built();
}
/* anchor points for the room (the Void grows a plinth + light pillar under each) */
function placeRoom(){
  const { S, view, wallW } = curBuild;
  rooms.place([
    { x: view.cx, z: -2.25, w: wallW + 4, d: 6, yaw: 0, y: STAGE_Y - 9.6 },   // the paternoster bays (housing bottom)
    ...(S.drums ? [kitAnchor(view.cx, kitSlot)] : []),
    ...instLive.filter(r => !r.slot.hang).map(r => ({ x: r.station.position.x, z: r.station.position.z, yaw: r.station.rotation.y,
      w: r.slot.w, d: r.slot.d, y: r.slot.y })),
  ]);
}
/* STAGE EDIT moved a station (src/editor/stage-edit.js moved its group: a rigid render-time move
   of an already-solved world — supports already reach the flat floor). Re-anchor the room and
   re-solve the director's shots from where things now stand. A dragged KIT is rebuilt at its new
   slot (its contacts are world-space). No re-solve of any physics; songTime runs on. */
function restage(){
  if (!curBuild) return;
  const { S, view, P0, buildKit } = curBuild;
  if (drumGroup && (drumGroup.position.x || drumGroup.position.z)){
    kitSlot = { x: kitSlot.x + drumGroup.position.x, z: kitSlot.z + drumGroup.position.z, pin: true };
    world.remove(drumGroup); disposeTree(drumGroup);
    drumGroup = buildKit(); world.add(drumGroup);
    if (!NO_MERGE){
      const times = Array.from({ length: 48 }, (_, k) => -LEAD_IN + (k + .37) / 48 * (P0 + LEAD_IN));
      mergeStatic(drumGroup, t => drumKit.update(t, P0, 0, { started: true, skipStrikes: true, onStrike(){} }), times);
    }
    drumKit.update(songTime, P0, 0, { started, skipStrikes: true, onStrike(){} });
  }
  instLive.forEach(r => r.station.updateMatrixWorld(true));
  placeRoom();
  syncDirector(S, view);
  fadeMats = collectFadeMats(world); fadeWarm = 3;
}

/* PATERNOSTER: the marble is CONSERVED, and the MAGNET CRANE flies every gap a free arc
   can't (src/crane.js): any gap longer than dtFree — and the loop seam — is a CRANE HOP
   (an APEX KISS — a real arc the magnet takes at its apex and glides level — or straight up
   to the magnet, carried, dropped onto the next pad on its beat). The plan is choreographed
   around the voice's own tone-plates (plateField; a plate in the way stows early / unfolds
   late — its edge is in the plan, the render reads it). Then every pad's tilt is re-aimed to
   bisect its REAL in/out (the plan's vOut/vIn). The free arcs themselves are untouched. */
function planTrackCrane(tr){
  const P = ROLL_T + LOOP_T, n = tr.pads.length, g = -G.y;
  const padT = tr.pads.map(p => tr.rollT + p.t);
  const clear = plateField({ padT, P, plate: BAR, stowZ: PT.STOW_Z, inner: PT.INNER, cull: PT.CULL,
    plates: tr.padObjs.map(po => ({ x: po.base.x, z: po.base.z, s: po.g.scale.x })) });
  tr.crane = planCrane({ g, P, rollT: tr.rollT, r: RIG_OPT[tr.role].r, clear,
    pads: tr.pads.map(p => ({ t: p.t, dt: p.dt, x: p.pos.x, z: p.pos.z })) });
  if (tr.crane.warnings.length) console.warn(`cascade crane (${tr.role}):\n  ` + tr.crane.warnings.join('\n  '));
  const hopOf = i => tr.crane.hopAt[i] >= 0 ? tr.crane.hops[tr.crane.hopAt[i]] : null;
  // falling-frame velocities (the band frame minus the belt's DESCENT)
  // (a hop's launch/arrival are the plan's own: straight up/down, or an apex kiss's ballistic in/out)
  const vOut = i => { const h = hopOf(i); return h ? new THREE.Vector3(h.vOut.x, h.vOut.y - DESCENT, h.vOut.z) : tr.arcs[i].clone(); };
  const vIn = i => { const k = (i - 1 + n) % n, h = hopOf(k);
    return h ? new THREE.Vector3(h.vIn.x, h.vIn.y - DESCENT, h.vIn.z) : arcVel(tr.arcs[k], tr.pads[k].dt); };
  tr.padObjs.forEach((po, i) => {
    const vout = vOut(i), nn = vout.clone().normalize().sub(vIn(i).normalize()).normalize();
    if (nn.y < .2) nn.set(0, 1, 0);
    po.n.copy(nn); po.qN.setFromUnitVectors(UPY, nn); po.g.quaternion.copy(po.qN);
    po.amp = THREE.MathUtils.clamp(vout.dot(nn) * .07, .05, 1.6);
  });
}

/* SPATIAL AUDIO: where a strike sounds = where it is relative to the CAMERA at that
   instant (src/spatial.js: pan by FRAME position, distance relative to the shot's focus,
   farther = wetter). Audio-only — as the director cuts, the next strike follows the shot. */
const _spv = new THREE.Vector3();
function placeAt(worldPos){
  if (xr.presenting){ const h = xr.ear(worldPos); return spatialize(h.x, h.y, h.z, { tanH: h.tanH, focus: h.focus }); }   // the HEAD is the camera
  camera.updateMatrixWorld();
  _spv.copy(worldPos).applyMatrix4(camera.matrixWorldInverse);
  const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * camera.aspect;
  return spatialize(_spv.x, _spv.y, _spv.z, { tanH, focus: camera.position.distanceTo(cam.target) });
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
    try { audio.playNote(pad.note, tr.deep, placeAt(padR)); } catch(e){ /* audio must never break the run */ }
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
    try { audio.playDrum(hit.lane, hit.vel ?? 1, placeAt(c)); } catch(e){ /* audio must never break the run */ }
  }
}

/* ---- the room DIRECTOR's inputs: one shot per station (instrument plugins + the
   drum machine) and a wide stage shot, plus each station's CUE — its hits as
   loop-local times. The song is data, so the whole loop's EDIT is solved here, once
   (directorplan.js: what's special about each machine, beat by beat → a shot list);
   the rig just plays it back as a pure function of songTime. ---- */
let cues = [];                                          // [{key, owner, cue:[{t,w}]}]
function syncDirector(S, view){
  const shots = [], P = ROLL_T + LOOP_T;
  cues = []; script = [];
  instLive.forEach(rig => {
    // a song may re-frame a station's shot for its room (song.director.shots.<key> = {x, up, dist})
    const st = rig.station, h = rig.I.lookHeight ?? 3, c = { ...(rig.I.camera || {}), ...(S.director?.shots?.[rig.I.key] || {}) };
    const ck = rig.I.cameraKey ?? rig.I.key;            // the shot key (a station may not share a belt role's name)
    // a HUNG station is shot from just under its lowest plate, looking up into it: the air
    // between the sculpture and the belt's housing reads in profile (from above, the plates
    // would sit visually ON the housing — the clearance foreshortens to nothing)
    // (a hung station with a DECK — camera.overDeck, the volley court — is shot from above it instead)
    const under = rig.slot.hang && !c.overDeck;
    const eyeY = under ? hangLow(st) - st.position.y + .6 : h + (c.up ?? 5);
    const hk = under ? 1.15 : 1;                         // (and from a step further back: the canopy stays in frame)
    shots.push({ key: ck, owner: rig.I.key, color: rig.I.color, self: st,
      aim: st.localToWorld(new THREE.Vector3(0, h + (rig.slot.hang ? 1 : 0), 0)),
      eye: st.localToWorld(new THREE.Vector3(c.x ?? 0, eyeY, (c.dist ?? 15) * hk)) });
    cues.push({ key: ck, owner: rig.I.key, cue: rig.cue });
  });
  if (S.drums){
    const kx = view.cx + kitSlot.x, kz = kitSlot.z;     // the kit's slot this song (marbledrums.js)
    // eye a touch right of the kit's centre + aim raised: keeps the belt wall's edge
    // rail (a bloom streak at the old angle) out of the top-left of the frame
    // (the eye rides ABOVE the kit's magnet rail: from rail height the chrome bar slices the frame)
    shots.push({ key: 'drums', owner: 'drums', color: '#ff8a3d', self: drumGroup, aim: new THREE.Vector3(kx, 3.6, kz - 2.5), eye: new THREE.Vector3(kx + 1, 11.5, kz + 12.5) });
    const cue = [];
    Object.entries(S.drums).forEach(([lane, hits]) => hits.map(normalizeHit).forEach(h =>
      cue.push({ t: wrapP(ROLL_T + h.beat * BEAT, P), w: h.vel, id: lane })));
    cues.push({ key: 'drums', owner: 'drums', cue, perc: true });
  }
  // A CHORD is one moment, not N: simultaneous hits on one station merge into one (the
  // loudest + a little for the rest) — or a pad that strikes 4-note chords reads as 4× busy
  for (const c of cues){
    const byT = new Map();
    for (const e of c.cue){ const k = Math.round(e.t * 500); const g = byT.get(k); if (g) g.push(e); else byT.set(k, [e]); }
    c.cue = [...byT.entries()].sort((a, b) => a[0] - b[0]).map(([k, es]) => {
      const ws = es.map(e => e.w), mx = Math.max(...ws), sum = ws.reduce((a, b) => a + b, 0);
      // (the chord's id: its pitch heads, sorted — a riff's E5 power chord and its palm-muted chug are one shape)
      const id = [...new Set(es.map(e => String(e.id ?? '').replace(/[:|].*$/, '')))].sort().join('+');
      return { t: k / 500, w: mx + .3 * (sum - mx), id };
    });
  }
  // ENSEMBLE MOMENTS (pure song data, solved up front): every instant where ≥ 2 voices
  // land together, with how many DISTINCT machines (stations + the lead belt) hit within
  // ±.15 s. The edit goes WIDE for the big ones (the whole room on one downbeat) and the
  // room's exposure flares with them.
  const lead = tracks[0], ev = [];
  cues.forEach(c => c.cue.forEach(e => ev.push({ t: e.t, key: c.key })));
  lead.pads.forEach(pd => ev.push({ t: wrapP(lead.rollT + pd.t, P), key: 'lead' }));
  ev.sort((a, b) => a.t - b.t);
  moments = [];
  for (let i = 0; i < ev.length; i++){
    if (i && ev[i].t - ev[i - 1].t < .02) continue;     // one moment per instant
    const keys = new Set();
    for (const e of ev) if (Math.abs(wrapP(e.t - ev[i].t + P / 2, P) - P / 2) <= .15) keys.add(e.key);
    if (keys.size >= 2) moments.push({ t: ev[i].t, n: keys.size });
  }
  seamFrom = lead.rollT + lead.total - .7;              // the engine's loop seam (no music, no lead marble), entered just after the last note lands
  // SCRIPTED CUTS (song.director.at = [[beat, shot, holdBeats?], …]): the story beats a
  // density vote can't see — a moonlit establishing shot, the soloist, the dawn bell. shot =
  // 'stage', a station key, or a belt role ('lead'/'alto'/'bass'); unknown keys are dropped.
  // Held for holdBeats (≥ .35 s): fixed points the solved edit builds around.
  const known = new Set(['stage', ...shots.map(sh => sh.key), ...tracks.map(t => t.role)]);
  for (const c of (Array.isArray(S.director?.at) ? S.director.at : []))
    if (Array.isArray(c) && Number.isFinite(c[0]) && known.has(c[1]))
      script.push({ t: wrapP(ROLL_T + c[0] * BEAT, P), key: c[1], hold: Math.max(.35, (Number.isFinite(c[2]) ? c[2] : 0) * BEAT) });
  // THE EDIT: every machine (the belt is one of them, no protagonist floor) scored beat by beat
  // for what's SPECIAL — above its own norm, an entrance, a crescendo, a solo — then cut into
  // shots (≥ 3 s, on the beat, shares capped, every machine that plays seen once a loop).
  // The belt's hits: every pad, a long lob or a skim counting for more (its own spectacle).
  const beltHits = [];
  tracks.forEach(tr => tr.pads.forEach(pd => beltHits.push({ t: wrapP(tr.rollT + pd.t, P),
    w: .5 + Math.min(1.5, Math.max(0, pd.dt - 1) * .6) + (pd.dt <= .15 ? .4 : 0) })));
  // RIDES: the long, tall flights the camera may ride (ridecam.js) — sparingly, and never for a
  // reduced-motion viewer (the manual RIDE button stays theirs to pick)
  rides = reduceMotion ? [] : rideMoments(flightsOf(P));
  const voices = [...cues.map(c => ({ key: c.key, hits: c.cue, weight: dirWeight(S, c.owner), ...(c.perc ? { perc: true } : {}) })),   // (the song's pull only:
                  // salience is relative to each machine's own norm, so sparse voices need no boost)
                  { key: 'belt', belt: true, hits: beltHits, weight: dirWeight(S, 'belt') }];
  // song.barBeats: the meter's bar length in beats (Mars is 5/4) — the edit prefers cuts on bar lines
  const grid = { t0: ROLL_T, beat: BEAT, end: seamFrom, bar: Number.isInteger(S.barBeats) && S.barBeats >= 2 && S.barBeats <= 16 ? S.barBeats : 4 };
  // THE SIGNATURE (directorplan signatureOf): the machine the song is about earns the edit's
  // biggest share. song.director.signature names it (a station key or its shot key) or false
  // for none; an IMPORT (no curator: staging 'auto') reads it off the song data — the hook.
  const sigCfg = S.director?.signature;
  const sig = typeof sigCfg === 'string' ? cues.find(c => c.key === sigCfg || c.owner === sigCfg)?.key ?? null
            : sigCfg === false || S.staging !== 'auto' ? null : signatureOf(voices, grid);
  voices.forEach(v => { if (v.key === sig) v.signature = true; });
  plan = planEdit(planIn = {
    voices, grid,
    fixed: script.map(c => ({ t: c.t, len: c.hold, key: c.key })),
    wides: moments.filter(m => m.n >= ENSEMBLE_N).map(m => m.t),
    rides,
  });
  rideWins = plan.rides; rideEvery = plan.rideEvery;    // (the windows it chose — fixed points of the edit — and
                                                        //  on which loop passes: a short loop rides every k-th one)
  // the wide STAGE shot. A full room (instrument plugins on stage): a LOW front-left
  // three-quarter view (the angle the room reads as a machine-hall, not a floor plan) —
  // bowls + drums in the foreground, the belt and the back tier behind — and the song
  // OPENS on it (the reveal). Belt + drums only: the closer view that frames just those two.
  const full = instLive.length > 0;
  // The full room's wide is FITTED to what this song actually staged (stageFrame): the belt,
  // the chandelier over it, every wing — the front row may crop at the bottom corners (a
  // foreground frame, the way a concert film shoots past the nearest players).
  // The direction is SEARCHED (searchWide): the hand-picked angle first, then its neighbours —
  // the first that keeps every subject in frame with the eye inside the room and the strike
  // band clear of other machines wins (else the least-cropped, least-blocked one).
  const wide = full
    ? { ...searchWide(stageFrame(), WIDE_DIRS, 1.6, .94, 0), fov: WIDE_FOV, fitMax: 1,
        // a phone held upright can't fit the room's width — so it frames the PROTAGONISTS (the
        // belt band → top housing, the chandelier, the turntable's record) down a diagonal, with
        // the title/song-select block's height kept clear at the top (PORTRAIT_INSET); the wings
        // enter from the frame edges as context
        portrait: { ...searchWide(stageFrame(true), PORTRAIT_DIRS, .5, .92, PORTRAIT_INSET), fov: WIDE_FOV, fitMax: 1 } }
    : { aim: new THREE.Vector3(view.cx, 4, 2), eye: new THREE.Vector3(view.cx + 4, 15, 39) };
  lastWide = wide;
  // every station's eye is SOLVED from its designer's preferred framing (shotsolve.js); a narrow
  // (portrait) frame pulls each station shot back along its own line (camera.js) — fitMax caps
  // that pull so the eye never leaves the room box, nor walks back into another machine
  const follow = solveShots(shots);
  // the opening reveal holds through the count-in and the first two beats (songTime-based,
  // so a page idling in auto before the play tap can't spend it)
  lastShots = shots;
  cam.syncStations(shots, wide, { auto: !soloKey, openWide: full && !soloKey, openUntil: ROLL_T + 2 * BEAT, follow, bounds: eyeRoom(),
                   plan: { at: now => shotAt(plan, wrapP(now, P), seamFrom) } });
  xrAnchors();
}
/* ---- RIDE THE BALL (ridecam.js): every belt flight's launch, duration and apex (the render
   height it climbs above the higher of its two ends — a crane hop's lob to the magnet counts),
   sampled from ballPos, the source of truth. Static song data: solved once per song. ---- */
let rides = [], rideWins = [], rideEvery = 1, rideDbg = null;          // (rideDbg: __dev.ride — the last pose's raw solve)
function flightsOf(P){
  const out = [];
  tracks.forEach(tr => tr.pads.forEach((pd, i) => {
    if (pd.dt < RIDE.DT_MIN || i === tr.pads.length - 1) return;   // (the last pad's flight is the seam)
    const t0 = tr.rollT + pd.t, n = 16;
    let top = -Infinity, y0 = 0, y1 = 0;
    for (let k = 0; k <= n; k++){
      const tau = t0 + pd.dt * k / n, y = ballPos(tr, tau, 0).pos.y + DESCENT * tau;
      if (k === 0) y0 = y; if (k === n) y1 = y; top = Math.max(top, y);
    }
    out.push({ t: wrapP(t0, P), dt: pd.dt, apex: top - Math.max(y0, y1), role: tr.role });
  }));
  return out;
}
/* The ride pose at songTime st — a pure fn of it. directed: inside a planned ride window only
   (eased in/out of the chase); else the manual RIDE mode on the lead. The marble path is this
   loop's ball, clamped to its life on screen (from its visible birth fall — or, on a crane belt,
   its magnet hang — to its last landing; the plunge / seam hop are held, and the new loop's first
   frame is a cut). Guarded: never inside a tone-plate, a machine, or out through the room. */
const _rE = new THREE.Vector3(), _rA = new THREE.Vector3(), _rP = new THREE.Vector3(), _rd = new THREE.Vector3();
const _ride = { eye: new THREE.Vector3(), aim: new THREE.Vector3(), fov: RIDE.FOV };
function rideCam(st, directed){
  if (!started || st < 0 || !tracks.length) return null;
  const P = ROLL_T + LOOP_T, now = wrapP(st, P), base = st - now;
  let win = null, tr = tracks[0];
  if (directed){
    const w = rideWindowAt(rideWins, now); if (!w || Math.round(base / P) % rideEvery) return null;
    win = { t0: base + w.t0, t1: base + w.t1 }; tr = tracks.find(t => t.role === w.role) || tr;
  }
  const lo = base + (tr.crane ? 0 : tr.rollT - BIRTH_FALL + .3), hi = base + tr.rollT + tr.total - .05;   // (from its visible fall / magnet hang)
  const path = s => { const tau = Math.min(hi, Math.max(lo, s)) - base, p = ballPos(tr, tau, base).pos;
    return [p.x + tr.origin.x, p.y + DESCENT * tau + tr.origin.y, p.z + tr.origin.z]; };
  const r = ridePose(path, st, win, RIDE, camera.aspect);
  rideDbg = { raw: r, ball: path(st), tr: tr.role, win };
  const eye = _rE.fromArray(r.eye), aim = _rA.fromArray(r.aim);
  // the tone-plates keep moving (they rise through the band): a soft push off any plate the eye nears
  for (const po of tr.padObjs){
    if (!po.g.visible) continue;
    po.g.getWorldPosition(_rP); const d = eye.distanceTo(_rP), R = 2.1;
    if (d < R) eye.addScaledVector(_rd.subVectors(eye, _rP).normalize(), R - d);
  }
  // never inside a machine (step toward the marble until clear) nor out through the room
  const inBox = () => followRig.boxes.some(b => eye.x > b[0] - .6 && eye.x < b[1] + .6 && eye.y > b[2] - .6 && eye.y < b[3] + .6 && eye.z > b[4] - .6 && eye.z < b[5] + .6);
  for (let k = 0; k < 8 && inBox(); k++) eye.lerp(aim, .25);
  const rm = eyeRoom();
  eye.set(Math.min(rm.x1, Math.max(rm.x0, eye.x)), Math.min(rm.y1, Math.max(rm.y0, eye.y)), Math.min(rm.z1, Math.max(rm.z0, eye.z)));
  _ride.eye.copy(eye); _ride.aim.copy(aim);
  return _ride;
}
/* VR teleport pads (src/xrplan.js): every solved shot eye + the wide + one per belt bay, kept
   clear of every machine's box. Cheap (no rays) — re-run whenever the director re-solves. */
function xrAnchors(){
  xrLitAge = 0;                                         // (a new world: re-collect its lights for xrRender)
  const box = o => { const b = visBox(o); return b.isEmpty() ? null : [b.min.x, b.max.x, b.min.y, b.max.y, b.min.z, b.max.z]; };
  const belts = tracks.map(tr => { const b = box(tr.machine.group) || box(tr.stage);
    return b && { role: tr.role, x: (b[0] + b[1]) / 2, z0: b[4], z1: b[5], bandY: STAGE_Y }; }).filter(Boolean);
  const solids = [...instLive.map(r => box(r.station)), drumGroup && box(drumGroup), ...tracks.map(tr => box(tr.machine.group))].filter(Boolean);
  xr.setAnchors({ wide: lastWide, belts, solids, room: { x0: -ROOM.HW, x1: ROOM.HW, y0: ROOM.FLOOR, y1: ROOM.CEIL, z0: ROOM.BACK, z1: ROOM.FRONT },
    shots: lastShots.map(s => ({ key: s.key, eye: s.eye, aim: s.aim, color: s.color,
      label: s.owner === 'drums' ? 'drums' : (instrumentByKey(s.owner)?.label || s.key) })) });
}
/* SOLVED SHOT EYES (src/shotrig.js over the pure shotsolve.js): each station's hand-tuned framing
   is only its PREFERRED eye — the solve keeps the first candidate that stays in the room, stands in
   clear air and SEES its station past every other machine AND the room's standing geometry (the
   real meshes, raycast); the belt's follow offsets are solved the same way, both aspect classes. */
const eyeRoom = () => ({ x0: -ROOM.HW + 1.5, x1: ROOM.HW - 1.5, y0: ROOM.FLOOR + 1.5, y1: ROOM.CEIL - 1.5, z0: ROOM.BACK + 1.5, z1: ROOM.FRONT - 1.5 });
const followRig = makeFollow();
let solvedRoom = null;
function shotCtx(){
  const w = stageWall;
  return { world, roomGroup: rooms.group, belts: new Set(tracks.map(t => t.stage)), stageY: STAGE_Y, room: eyeRoom(), camera, drawn,
           wall: w.isEmpty() ? null : [w.min.x, w.max.x, w.min.y, w.max.y, w.min.z, w.max.z], follow: followRig };
}
function solveShots(shots){
  solvedRoom = rooms.key;
  lastSolve = { ...solveShotsIn(shots, shotCtx()), follow: followRig };
  return followRig;
}
/* The points the WIDE shot must hold: the belt wall (band → top housing), a hung station's
   plates + canopy, every floor station from its deck up (a GALLERY machine from its raised
   deck) — and the front row to FRONT_KEEP of its front half (its whole width: a front-CORNER
   machine is never cut in half; only its nearest lip may graze the bottom of the frame, the way
   a concert film shoots past the nearest players). From the built geometry, per song. */
const FRONT_KEEP = .25;
function stageFrame(core = false){
  const pts = [], add = (x0, x1, y0, y1, z0, z1) => { for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) pts.push(new THREE.Vector3(x, y, z)); };
  if (!stageWall.isEmpty()) add(stageWall.min.x, stageWall.max.x, STAGE_Y - 3, stageWall.max.y, stageWall.min.z, stageWall.max.z);
  if (core){                                             // portrait: the belt, the hung plates, the record
    instLive.forEach(r => {
      if (!r.slot.hang && r.I.key !== 'turntable') return;
      const b = visBox(r.station), p = r.station.position;
      if (b.isEmpty()) return;
      if (r.slot.hang) add(b.min.x, b.max.x, hangLow(r.station), Math.min(b.max.y, p.y + 13), b.min.z, b.max.z);
      else add(b.min.x, b.max.x, p.y, p.y + 1, b.min.z, (b.min.z + b.max.z) / 2);
    });
    return pts;
  }
  const front = 13;                                      // a footprint centred past this z is the front row
  const floorBox = (b, deckY) => {
    const y0 = Math.max(b.min.y, deckY - 1.5), zc = (b.min.z + b.max.z) / 2;
    add(b.min.x, b.max.x, y0, b.max.y, b.min.z, zc > front ? zc + FRONT_KEEP * (b.max.z - zc) : b.max.z);
  };
  instLive.forEach(r => {
    const b = visBox(r.station), p = r.station.position;
    if (b.isEmpty()) return;
    if (r.slot.hang) add(b.min.x, b.max.x, p.y + 1, Math.min(b.max.y, p.y + 13), b.min.z, b.max.z);   // plates + canopy, not the rods
    else floorBox(b, p.y);
  });
  if (drumGroup){ const b = visBox(drumGroup); if (!b.isEmpty()) floorBox(b, 1); }
  return pts;
}
/* Fit a shot to `pts`: look along −dir (dir = unit aim→eye), centre the points in frame and
   back off just far enough that all of them fit `fill` of the frame at `aspect` — then pull
   in so the eye stays inside the room (whatever then falls outside crops). */
const WIDE_FOV = 68;                                    // the wide's lens (camera.js eases into it)
const dirOf = (x, y, z) => new THREE.Vector3(x, y, z).normalize();
/* the wide's candidate directions (unit aim → eye), preferred first: a LOW front-left three-
   quarter (the hall reads as a machine-hall, not a floor plan), then steeper / squarer */
const WIDE_DIRS = [[-.15, .43, .89], [-.08, .5, .89], [-.22, .5, .86], [0, .55, .85], [-.15, .62, .8], [.1, .55, .85], [-.3, .58, .8]].map(d => dirOf(...d));
const PORTRAIT_DIRS = [[.45, .36, .82], [.3, .4, .87], [.6, .33, .74], [.15, .42, .9], [-.2, .42, .89], [.45, .5, .76], [0, .5, .87], [-.4, .42, .82]].map(d => dirOf(...d));
const PORTRAIT_INSET = .13;                             // the top of a phone frame belongs to the title + song select
const _occRay = new THREE.Raycaster();
/* fit each candidate direction; score = how much the room clamp crops (1 − k) + how much of
   the strike band other machines hide from the eye. First candidate that is clean wins. */
function searchWide(pts, dirs, aspect, fill, inset){
  const band = [];
  if (!stageWall.isEmpty()) for (let i = 0; i <= 6; i++) for (const dy of [0, 2.5])
    band.push(new THREE.Vector3(THREE.MathUtils.lerp(stageWall.min.x + 1.5, stageWall.max.x - 1.5, i / 6), STAGE_Y + dy, (stageWall.min.z + stageWall.max.z) / 2));
  const belt = new Set(tracks.map(t => t.stage));
  const top = o => { while (o.parent && o.parent !== world) o = o.parent; return o; };
  const shown = o => { for (let p = o; p && p !== world; p = p.parent) if (!p.visible) return false; return true; };
  let best = null;
  dirs.forEach((d, i) => {
    const f = fitShot(pts, d, aspect, fill, WIDE_FOV, inset);
    let blocked = 0;
    for (const q of band){
      const v = q.clone().sub(f.eye), L = v.length();
      _occRay.set(f.eye, v.divideScalar(L)); _occRay.far = L - .5; _occRay.camera = camera;
      if (_occRay.intersectObject(world, true).some(h => (h.object.isMesh || h.object.isInstancedMesh) && shown(h.object) && !belt.has(top(h.object)))) blocked++;
    }
    const score = (1 - f.k) * 3 + (band.length ? blocked / band.length : 0) * 2 + i * .02;
    if (!best || score < best.score) best = { ...f, score, dir: i, blocked };
  });
  return best;
}
function fitShot(pts, dir, aspect, fill = .94, fov = camera.fov, inset = 0){
  dir = dir.clone();
  const R = new THREE.Vector3().crossVectors(dir.clone().negate(), _Yup).normalize();
  const U = new THREE.Vector3().crossVectors(R, dir.clone().negate()).normalize();
  // (an inset frame: the subject fills the lower 1 − inset of the frame's height)
  const tanV0 = Math.tan(THREE.MathUtils.degToRad(fov / 2)), tanV = tanV0 * fill * (1 - inset), tanH = tanV0 * fill * aspect;
  const aim = new THREE.Vector3();
  pts.forEach(p => aim.add(p)); aim.divideScalar(Math.max(1, pts.length));
  const q = new THREE.Vector3();
  let D = 10;
  for (let it = 0; it < 6; it++){
    D = 0;
    for (const p of pts){ q.subVectors(p, aim); const f = q.dot(dir);
      D = Math.max(D, f + Math.abs(q.dot(R)) / tanH, f + Math.abs(q.dot(U)) / tanV); }
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of pts){ q.subVectors(p, aim); const dep = D - q.dot(dir), sx = q.dot(R) / dep, sy = q.dot(U) / dep;
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy); }
    aim.addScaledVector(R, (x0 + x1) / 2 * D * .9).addScaledVector(U, ((y0 + y1) / 2 + tanV0 * inset) * D * .9);
  }
  // keep the eye inside the room box (the smallest room's walls — STAGE), with room for the
  // director's slow orbit drift (camera.js sways a held shot ±.12 rad about its aim)
  const pad = 1.5; let k = 1;
  const lim = (a, v, lo, hi) => { if (v > 1e-6) k = Math.min(k, (hi - a) / v); else if (v < -1e-6) k = Math.min(k, (lo - a) / v); };
  for (const th of [-.13, 0, .13]){
    const r = dir.clone().applyAxisAngle(_Yup, th).multiplyScalar(D);
    lim(aim.x, r.x, -ROOM.HW + pad, ROOM.HW - pad);
    lim(aim.y, r.y, ROOM.FLOOR + pad, ROOM.CEIL - pad);
    lim(aim.z, r.z, ROOM.BACK + pad, ROOM.FRONT - pad);
  }
  return { aim, eye: aim.clone().addScaledVector(dir, D * Math.max(.3, k)), k };
}
const _Yup = new THREE.Vector3(0, 1, 0);
/* song.director — optional per-machine pull for THIS song ({ bowls: 2.2, belt: .5 }): a hint
   to the solved edit (applied as √weight) when a song showcases one machine. Clamped; absent → 1. */
function dirWeight(S, key){ const w = S.director?.[key]; return Number.isFinite(w) ? Math.max(0, Math.min(4, w)) : 1; }
const ENSEMBLE_N = 7;                                   // ≥ this many machines on one downbeat: a WIDE moment for the edit
let moments = [], script = [], seamFrom = Infinity, plan = null, planIn = null;   // filled by syncDirector (static song data)
let ensFlare = 0, lastNow = 0;                          // the room's exposure flare on ensemble moments
/* The room's exposure FLARE as a big ensemble moment (≥ 5 machines on one downbeat) passes. */
function roomFlare(){
  const P = ROLL_T + LOOP_T, now = wrapP(songTime, P), passed = wrapP(now - lastNow, P);
  if (!skipStrikes && passed < .5) for (const m of moments)
    if (m.n >= 5 && wrapP(m.t - lastNow, P) <= passed) ensFlare = Math.max(ensFlare, (m.n - 4) / 3);   // 5 → .33 … 7 → 1
  lastNow = now;
}

/* Frame the free camera on an instrument's station: from out front of it (its local
   +z, through the station's yaw), a little above, looking at its middle. dist/up are
   in world units. Used by ?solo and window.__dev.station(key). */
function lookAtStation(key, dist = 15, up = 5){
  const rig = instLive.find(r => r.I.key === key);
  if (!rig) return false;
  const st = rig.station, h = rig.I.lookHeight ?? 3;
  if (cam.mode !== 'free') cam.mode = 'free';           // framing by hand = free-look (the director would override)
  const tgt = st.localToWorld(new THREE.Vector3(0, h, 0));
  const eye = st.localToWorld(new THREE.Vector3(0, h + up, dist));
  cam.camera.position.copy(eye); cam.target.copy(tgt); cam.orbit.target.copy(tgt); cam.orbit.update();
  return true;
}

/* song.mix — an AUDIO-ONLY level per plugin part: { <partKey>: gain | [[beat, gain], …] }.
   Velocity stays DYNAMICS (it also drives the strike light, sparks, a voice's velocity
   layer and the director's cue weight), so a song can stage its gain without dimming
   its tutti. A number is baked into the voice render, so it holds on the iOS sample
   path too; a step envelope bakes its loudest step and scales each hit by step/loudest
   on the webaudio path (iOS plays every sample full — §5). No `mix` → unity, unchanged. */
function partMix(S, key){
  const m = S.mix?.[key], g01 = v => Math.max(0, Math.min(1, v));   // share links are untrusted: clamp, never amplify
  if (Number.isFinite(m)) return { base: g01(m), at: () => 1 };
  if (!Array.isArray(m) || !m.length || !m.every(s => Array.isArray(s) && Number.isFinite(s[0]) && Number.isFinite(s[1])))
    return { base: 1, at: () => 1 };
  const base = g01(Math.max(...m.map(s => s[1])));
  return { base, at: beat => { let g = m[0][1]; for (const [b, v] of m) if (beat >= b) g = v; return base > 0 ? g01(g) / base : 0; } };
}
function mixRender(r, g){ return g === 1 ? r : { sr: r.sr, samples: r.samples.map(x => x * g) }; }
/* a voice's pitch (Hz) for the spatial pan width (low voices sit near the centre): the plugin's own
   voiceHz(id) when it has one (a chord id, a tiered id), else the FIRST pitch in the id ('E2+B2:m',
   'C4|choir', 'stab:D4', 'C4:e:p' — ids list chord notes low → high), else 0 (full width) */
function voiceHzOf(I, id){
  try {
    if (I.voiceHz){ const h = I.voiceHz(id); if (Number.isFinite(h) && h > 0) return h; }
    const m = /([A-G]#?)(-?\d)/.exec(String(id));
    return m ? noteHz(m[1] + m[2]) : 0;
  } catch (e){ return 0; }
}

/* An instrument plugin's strike: sparks + a shared strike light at the contact (its
   local pos → world through the station), an optional camera punch, and its voice.
   hit = { note, vel, pos (Vector3, instrument-local), color, dur (s), shake, sparks } */
let voiceWarned = false;
function instStrike(rig, hit){
  const v = hit.vel ?? 1;
  const p = rig.station.localToWorld(_sp.copy(hit.pos || new THREE.Vector3()));
  const col = new THREE.Color(hit.color ?? 0xffffff);
  if (hit.sparks !== 0) spawnBurst(p.clone(), col, hit.sparks ?? Math.round(4 + 6 * v), 2.6);
  // the shared strike-light pool is small (STRIKE_LIGHTS): a faint accent (a strum's inner strings,
  // light < .2) doesn't take a slot — it would overwrite another machine's real flash
  if ((hit.light ?? 1) >= .2){
    const L = strikeLights[strikeLightIdx++ % STRIKE_LIGHTS];
    L.l.color.copy(col); L.l.position.copy(p).add(new THREE.Vector3(0, .6, .4));
    L.age = 0; L.peak = 8 * (.35 + .65 * v) * (hit.light ?? 1);
  }
  if (hit.shake) cam.addShake(hit.shake * v);
  if (devStrikes){ const k = rig.I.key, d = devStrikes[k] ||= { n: 0, ids: {}, unbaked: [] };
    d.n++; d.ids[hit.note] = (d.ids[hit.note] || 0) + 1;
    if (!audio.hasVoice(`inst:${k}:${hit.note}`) && !d.unbaked.includes(hit.note)) d.unbaked.push(hit.note); }
  if (audio.isReady() && !muted){
    const beat = (wrapP(songTime, ROLL_T + LOOP_T) - ROLL_T) / BEAT;   // loop-local beat (song.mix envelope)
    try { audio.playVoice(`inst:${rig.I.key}:${hit.note}`, v * (rig.mix ? rig.mix.at(beat) : 1), { dur: hit.dur || 0, sp: placeAt(p) }); } catch(e){ if (!voiceWarned){ voiceWarned = true; console.warn('cascade: instrument voice failed', rig.I.key, e); } }   /* audio must never break the run — but say so, once */
  }
}

/* ---------------- timeline ---------------- */
/* the song clock: THREE.Timer (THREE.Clock is deprecated) wearing Clock's old contract —
   getDelta() is 0 until start(), and start() re-zeroes elapsedTime */
const clock = (() => { const tm = new THREE.Timer(); let on = false, el = 0;
  return { start(){ tm.reset(); on = true; el = 0; },
           getDelta(){ if (!on) return 0; const d = tm.update().getDelta(); el += d; return d; },
           get elapsedTime(){ return el; } }; })();
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
fillSongMenu(sel, SONGS, isRuntimeSong);              // shelved <optgroup>s (songmenu.js)
{ // opening song: ?song=<key> > the seasonal house song (songs/index.js) — pinned under ?debug
  const q = new URLSearchParams(location.search), want = q.get('song');
  sel.value = SONGS[want] ? want : q.has('debug') ? DEFAULT_SONG : defaultSongKey();
}
if (soloI && SONGS['solo-' + soloKey]) sel.value = 'solo-' + soloKey;
/* CREATION TOOLS (src/editor/): the instrument MAP (who plays what) + STAGE EDIT (where it
   stands). Data over the song — main asks it for the effective song + each station's slot. */
const editor = makeEditor({ THREE, scene, cam, dom: renderer.domElement, songs: SONGS,
  machines: INSTRUMENTS.map(I => ({ key: I.key, label: I.label, color: I.color })),
  host: {
    key: () => sel.value,
    rebuild(keepTime){ const t = songTime; buildWorld(sel.value); if (keepTime && started){ songTime = t; skipStrikes = true; }
      audio.primeSamples(); audio.showState(); },        // (called from a tap/change: a gesture — §5)
    restage,
    pieces: () => [
      ...instLive.filter(r => !r.slot.hang).map(r => ({ key: r.I.key, label: r.I.label, color: r.I.color, obj: r.station, kind: 'station', canRotate: true })),
      ...(drumGroup && curBuild?.S.drums ? [{ key: 'drums', label: 'Drum Machine', color: '#ff8a3d', obj: drumGroup, kind: 'kit', canRotate: false,
        deckY: kitAnchor(0, kitSlot).y }] : []),
    ],
    wall: () => stageWall, cx: () => curBuild?.view.cx ?? 0,
    kitPivot: () => ({ x: (curBuild?.view.cx ?? 0) + kitSlot.x + (drumGroup?.position.x || 0), z: kitSlot.z + (drumGroup?.position.z || 0) }),
    visBox: o => visBox(o),
    room: { x0: -ROOM.HW + 2.5, x1: ROOM.HW - 2.5, z0: ROOM.BACK + 2.5, z1: 31 },
    roomBox: { y1: ROOM.CEIL - 2, z1: ROOM.FRONT - 2 },
    roomGroup: () => rooms.group,                         // (stage edit's plan view may lift the ceiling)
  } });
/* WebXR (src/xr.js): ENTER VR appears only where navigator.xr supports a session — the 2D page is
   otherwise untouched. While presenting: the head is the camera (no rig, no composer, no governor),
   halos + emissive step up for the missing bloom, the marble lamps go dark (a constant light set →
   one recompile, behind the entry blink), and every strike is placed against the head pose. */
const xr = makeXR({ renderer, scene, camera, envMap, glowTex,
  enterSound: () => enterSound(), gestureRetry: () => { if (started) audio.gestureRetry(); },
  getTime: () => songTime, setTime: v => { songTime = v; skipStrikes = true; },
  getRate: () => playRate, setRate: r => { playRate = r; },
  nextSong(){ sel.selectedIndex = (sel.selectedIndex + 1) % sel.options.length; sel.dispatchEvent(new Event('change')); },
  songLabel: () => SONGS[sel.value]?.label,
  shotAt: now => shotAt(plan, wrapP(now, ROLL_T + LOOP_T), seamFrom),
  onSession: xrSession });
let xrPrev = null;
function xrSession(on, mode){
  haloA = on ? XR_HALO_A : HALO_A; emi = on ? XR_EMI : EMI;
  for (const role in rigPool) for (const rg of rigPool[role]) rg.lamp.visible = !on;   // XR quality: the marble lamps go dark
  if (mode === 'ar'){                                   // passthrough: no room, no sky, no fog over the camera feed
    if (on){ xrPrev = { room: rooms.key, bg: scene.background, fog: scene.fog.density, alpha: renderer.getClearAlpha() };
      rooms.set('off'); scene.background = null; scene.fog.density = 0; renderer.setClearAlpha(0); }
    else if (xrPrev){ rooms.set(xrPrev.room); scene.background = xrPrev.bg; scene.fog.density = xrPrev.fog; renderer.setClearAlpha(xrPrev.alpha); xrPrev = null; }
  }
  if (!on){                                             // back to 2D: re-sync every target to the window
    cam.resize(); renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
    rooms.resize(innerWidth, innerHeight, renderer.getPixelRatio()); gov.hold(90);
  }
}
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
function ballPos(tr, tau, birthT = 0){
  const pl = tr.crane;
  if (pl){                                              // PATERNOSTER: hang / drop / rise / ride the magnet
    const c = craneBall(pl, tau, birthT);
    if (c){
      const lift = STAGE_Y + UP.y - DESCENT * tau;      // contact level, minus the render lift main re-adds
      const h = pl.hops[c.hop], seamTail = h.seam && c.seg >= 0;   // the seam's rise/ride belongs to the old ball
      const prog = c.seg >= 0 && h.mode === 'kiss' ? THREE.MathUtils.clamp((tau - h.s) / h.gap, 0, 1)   // a kiss reads as one arc
                 : c.mode === 'rise' ? 0 : THREE.MathUtils.clamp((tau - (c.seg < 0 ? pl.rel0 : h.carryEnd)) /
                   ((c.seg < 0 ? pl.rollT : h.land) - (c.seg < 0 ? pl.rel0 : h.carryEnd)), 0, 1);
      return {pos: new THREE.Vector3(c.x, c.y + lift, c.z), vel: new THREE.Vector3(c.vx, c.vy, c.vz),
              plunge:false, idx: c.seg, nextIdx: c.seg < 0 ? 0 : seamTail ? -1 : h.j,
              prog: seamTail ? 0 : prog, curDt: c.seg < 0 || seamTail ? 9 : h.gap,
              nextDt: seamTail ? 9 : tr.pads[c.seg < 0 ? 0 : h.j].dt, crane: c.mode, hop: c.hop};
    }
  }
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
  // the free solved arc the ball is on: O(log n) lookup of the last struck pad
  let i, at;
  if (pl){ i = segAt(pl, tau); at = tau - pl.padT[i]; }
  else { at = tau - tr.rollT; i = 0; while (i < tr.pads.length && at >= tr.pads[i].dt){ at -= tr.pads[i].dt; i++; } }
  if (i >= tr.pads.length || (pl && i === tr.pads.length - 1 && at >= tr.pads[i].dt)){   // tail: ride the last arc down and out
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
  if (tr.crane && tr.balls.some(b => b.birthT === birthT)) return;   // armed early for the count-in
  const rig = checkoutRig(tr.role);
  if (!rig) return;                                     // pool exhausted — drop the ball, never crash
  tr.balls.push({rig, birthT, lastIdx:-1, splashed:false});
}

function animate(){
  const frameT0 = performance.now();
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
  const cullDist = Math.min(PT.CULL, DESCENT * P * .5 - .5);  // ride to the drum; never past the half-period
  const cullC = cullDist / DESCENT;                      // …same edge, in belt-phase units
  const innerC = PT.INNER / DESCENT;   // fully deployed within this band — strike zone never animates
                                                         // (higher = a tighter, snappier unfold nearer the edge)
  tracks.forEach(tr => {
    // ---- mortal balls: render each, strike on the youngest, recycle the dead ----
    let active = null;                                   // youngest live ball drives camera + anticipation
    for (let bi = tr.balls.length - 1; bi >= 0; bi--){   // newest first
      const ball = tr.balls[bi];
      const tau = songTime - ball.birthT;
      const r = ballPos(tr, tau, ball.birthT);
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
      if (tr.crane ? tau >= tr.crane.retireT : (tau > P + FADE_TAIL || fade >= 1)){ checkinRig(rig); tr.balls.splice(bi, 1); continue; }
      // PATERNOSTER hand-off: a newborn stays hidden while its predecessor still rides the magnet
      // (they share one position at the release instant, so only one marble is ever seen)
      const hidden = tr.crane && r.crane === 'hang' &&
        tr.balls.some(b => b.birthT < ball.birthT && songTime - b.birthT < tr.crane.retireT);
      if (tr.crane && r.crane === 'docked' && ball.dockHop !== r.hop){   // the CLACK: docking on the electromagnet
        ball.dockHop = r.hop;
        if (!skipStrikes){
          spawnBurst(rpos.clone().add(new THREE.Vector3(0, RIG_OPT[tr.role].r, 0)), new THREE.Color(0xff7a3a), 10, 2.2);
          rig.squash = .6; rig.lamp.intensity = 6;
        }
      }

      const show = hidden ? 0 : (1 - fade) * (r.appear ?? 1);   // appear<1 only during the newborn's pre-fall hold
      rig.halo.material.opacity = haloA * show;
      rig.core.material.emissiveIntensity = emi * show + .1;
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

      if (!active && !hidden){ active = {r, rpos, show}; }                // first live one we hit is the youngest
    }
    tr.active = active;
    if (active){
      marblePts.push({p: active.rpos.clone(), w: tr.role === 'lead' ? 1.7 : 1, role: tr.role, vis: active.show > .5});
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
      po.rim.material.opacity = .55 + po.flash*.5 + pre*.3;   // tone-plates wear a lit hue frame
      po.rim.scale.setScalar(1 + pre*.22 + po.flash*.12);
      po.body.material.emissive.setHSL(po.hue, .7, .06 + po.flash*.32 + pre*.07);   // a lit floor: the hero never goes dark
      po.beltY = STAGE_Y - .12 + DESCENT * c;           // un-nudged belt height — the bracket spine roots here
      // entrance/exit unfold: at the screen edges the pad lies flat & flush on the belt,
      // then telescopes out to rest depth and tips up into catch position — sequenced
      // (extend → tilt) and confined to the edges, so the strike zone stays rock-solid.
      // (a plate the crane needs out of the way unfolds later / stows sooner — its own edge, planned)
      const dep = reduceMotion ? FULL_DEPLOY : (tr.crane ? plateDeploy(c, innerC, Math.min(cullC, plateEdge(tr.crane, idx, c))) : deployPose(c, innerC, cullC));
      po.g.quaternion.copy(Q_FLAT).slerp(po.qN, dep.tilt);
      _qn.copy(UPY).applyQuaternion(po.g.quaternion);   // live normal (for the flipper nudge as it unfolds)
      const z = THREE.MathUtils.lerp(PT.STOW_Z, po.base.z, dep.extend);   // belt-flush → rest depth
      po.g.position.set(po.base.x, po.beltY, z)
        .addScaledVector(_qn, padOffset(started ? c : 0, po.amp));
    });

    // ---- the visible machine: scroll the belt in lock-step with the rising pads ----
    if (machinesOn) tr.machine.update(reduceMotion ? 0 : dt, songTime);
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
  ensFlare *= Math.exp(-dt / .6);                       // the room's flare on an ensemble downbeat (~.6 s decay)
  renderer.toneMappingExposure = 1.15 + expoKick*.12 + ensFlare*.2;

  // CAMERA: the rig decides the pose (director / fixed / free-fly / follow) from the
  // live marbles. main just hands it the frame's state; physics stays untouched.
  // (the director's edit was solved at song load; the ensemble flare runs in every mode)
  if (cues.length) roomFlare();
  devMarbles = marblePts;                               // (dev: __dev.marbles — the staging audit's frame check)
  if (xr.presenting) xr.update(dt, songTime);           // a headset: the HEAD is the camera (teleport pads, tour, scrub)
  else cam.update({ dt, time: clock.elapsedTime, songTime, tracks, marblePts, leadRender, reduceMotion, started });

  if (solvedRoom !== null && rooms.key !== solvedRoom){ solvedRoom = rooms.key; lastSolve = { ...resolveRoom(lastShots, shotCtx()), follow: followRig }; }   // the room changed: re-check every eye against it
  rooms.update(dt, songTime, xr.presenting ? xr.viewer : camera, expoKick + ensFlare);         // room ambience (pure fn of songTime + the music's kick)
  // PERF: an additive glow at opacity 0 still costs a full draw call. Every machine keeps
  // dozens of flash halos parked dark between strikes (~260 in a full room), so skip them
  // via material.visible — no program change, and the owner's own .visible logic is untouched.
  // (the first frames after a build draw them all, so every program compiles up front —
  // never a shader-compile hitch on a machine's first flash)
  if (perfOff){ for (const m of fadeMats) m.visible = true;   // dev A/B (__dev.perfOff): draw every idle glow, as before
    scene.children.forEach(c => { if (c.isSprite || (c.isMesh && c.geometry?.type === 'RingGeometry')) c.visible = true; }); }
  else if (fadeWarm > 0) fadeWarm--;
  else {
    // (re-collected every ~2 s: a plugin that makes or swaps a glow material after build — an
    //  async solve, a material swap — joins the gate instead of drawing dark forever)
    if (++fadeTick % 120 === 0){ fadeMats = collectFadeMats(world); singlePassFlats(scene); }   // (+ late-built rooms/parts)
    for (let i = 0; i < fadeMats.length; i++){ const m = fadeMats[i]; m.visible = m.opacity > .002; }
  }
  if (convDbgOn) convDebug(leadRender ? leadRender.y : cam.target.y, camera.position.y);
  editor.update();                                      // stage edit: name tags follow their machines
  watchFrozen();                                        // re-check a slice of the frozen still parts (mergestatic.js)
  if (xr.presenting) xrRender();                        // XR: straight to the headset (no composer; ACES still applies)
  else {
    composer.render();
    gov.frame(frameT0, started && playRate > 0 && document.visibilityState === 'visible');   // adaptive resolution (perfgov.js)
  }
  for (let i = frameTaps.length - 1; i >= 0; i--) if (frameTaps[i]()) frameTaps.splice(i, 1);   // (dev: renderInfo counts frames HERE — XR has no window rAF)
}
const frameTaps = [];
/* XR SCALE HONESTY: the rig is scaled U_PER_M, so the VIEW space three lights + fogs in is METRES,
   not world units — every Point/SpotLight would read U^decay (≈2.2×) brighter and reach U farther,
   and the fog would thin by U. Undo that for the headset render only: owners keep setting their
   intensities per frame, so the scaled values are restored right after (nothing persists). */
function xrRender(){
  if (xrLitAge-- <= 0){
    xrLit.length = 0; scene.traverse(o => { if (o.isPointLight || o.isSpotLight) xrLit.push(o); });
    if (xrSaved.length < xrLit.length * 2) xrSaved = new Float32Array(xrLit.length * 4);
    xrLitAge = 60;                                      // re-collect ~once a second (+ on every director re-solve)
  }
  for (let i = 0; i < xrLit.length; i++){ const l = xrLit[i];
    xrSaved[2 * i] = l.intensity; xrSaved[2 * i + 1] = l.distance;
    l.intensity /= Math.pow(U_PER_M, l.decay); l.distance /= U_PER_M; }
  const f = scene.fog, fd = f?.density, fn = f?.near, ff = f?.far;
  if (f?.isFogExp2) f.density *= U_PER_M; else if (f?.isFog){ f.near /= U_PER_M; f.far /= U_PER_M; }
  renderer.render(scene, camera);
  for (let i = 0; i < xrLit.length; i++){ xrLit[i].intensity = xrSaved[2 * i]; xrLit[i].distance = xrSaved[2 * i + 1]; }
  if (f?.isFogExp2) f.density = fd; else if (f?.isFog){ f.near = fn; f.far = ff; }
}
animate();
renderer.setAnimationLoop(animate);                     // (not window rAF: a headset session drives its own frame loop)
setTimeout(() => rooms.prewarm(camera), 1200);    // build + compile the other rooms in idle time (no first-swap stall)

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
  shareEl.hidden = !DYNAMIC.has(sel.value) && !editor.custom;   // (a re-mapped / re-placed song can be shared too)
  if (!DYNAMIC.has(sel.value)){                         // address bar = the song on screen (drops a stale #s=)
    const u = new URL(location.href), d = u.searchParams.has('debug') ? DEFAULT_SONG : defaultSongKey();
    if (isRuntimeSong(sel.value) || sel.value === d) u.searchParams.delete('song'); else u.searchParams.set('song', sel.value);
    history.replaceState(null, '', u.pathname + u.search.replace(/=(?=&|$)/g, ''));   // keep a bare '?debug' bare
  }
});

/* ---------------- dynamic songs (MIDI import / share links) ---------------- */
const DYNAMIC = new Set(['imported', 'shared']);   // SHARE LINK shows for these — narrower than isRuntimeSong (a ?solo demo isn't shareable song data)
const shareEl = document.getElementById('share');
function registerSong(key, song){
  SONGS[key] = song;
  addSongOption(sel, key, song.label);                  // the 'Yours' shelf, top of the menu
  sel.value = key;
  buildWorld(key);
  shareEl.hidden = false;
}
shareEl.addEventListener('click', async () => {
  const url = `${location.origin}${location.pathname}#s=${await encodeSong(editor.shareable(sel.value))}`;   // (+ the map + stage layout)
  history.replaceState(null, '', url);
  try { await navigator.clipboard.writeText(url); shareEl.textContent = 'COPIED'; }
  catch(e){ shareEl.textContent = 'LINK IN URL BAR'; }
  setTimeout(() => { shareEl.textContent = 'SHARE LINK'; }, 1600);
});
(async () => {                                          // boot: a share link IS the song
  const m = location.hash.match(/^#s=(.+)$/);
  if (!m || new URLSearchParams(location.search).has('midi')) return;   // ?midi= wins (it loads the song)
  try { registerSong('shared', await decodeSong(m[1])); }
  catch(e){ console.warn('cascade: ignoring bad share link —', e.message); }
})();

/* ---------------- MIDI import: drop a .mid anywhere ---------------- */
const subEl = document.getElementById('songsub');
addEventListener('dragover', e => e.preventDefault());
addEventListener('dragenter', () => { subEl.textContent = 'drop a .mid — the solver does the rest'; });
addEventListener('dragleave', e => {
  if (!e.relatedTarget) subEl.textContent = SONGS[sel.value].sub;
});
addEventListener('drop', async e => {
  e.preventDefault();
  const file = [...(e.dataTransfer?.files || [])].find(f => /\.midi?$/i.test(f.name));
  if (!file){ subEl.textContent = SONGS[sel.value].sub; return; }
  try {
    importMidi(new Uint8Array(await file.arrayBuffer()), file.name, true);
  } catch(err){
    subEl.textContent = `couldn't read ${file.name}: ${err.message}`;
  }
});
/* The one MIDI import path (drop + ?midi=). `gesture` = called from a user gesture
   (drop): only then may audio be built/unlocked (§5 — a context born outside a gesture
   is a zombie). The ?midi boot just registers the song; the veil tap starts sound. */
function importMidi(bytes, name, gesture){
  const parsed = parseMidi(bytes), label = name.replace(/^.*\//, '').replace(/\.midi?$/i, '');
  const { song, warnings, phrase } = convertToSong(parsed, {label});   // a long song loops its best phrase (src/midi/phrase.js)
  editor.midiLoaded(parsed, label, warnings, phrase);   // the instrument MAP opens on it (src/editor) — LOOP / WHOLE SONG there
  if (gesture) enterSound();                            // a drop is a gesture: veil off, audio up
  registerSong('imported', song);
  if (gesture){
    audio.primeSamples();                               // drop is a gesture: unlock the new bank
    audio.showState();
  }
  if (warnings.length){
    console.warn('cascade midi import:\n  ' + warnings.join('\n  '));
    subEl.textContent = `${song.sub} · ${warnings.length} import note(s) in console`;
  }
}
/* ?midi=<url> — dev hook: fetch + import a MIDI on boot (e.g. /?midi=/midi/canon-in-d.mid) */
const midiUrl = new URLSearchParams(location.search).get('midi');
if (midiUrl) (async () => {
  try {
    const res = await fetch(midiUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    importMidi(new Uint8Array(await res.arrayBuffer()), midiUrl, false);
  } catch(err){ subEl.textContent = `couldn't load ${midiUrl}: ${err.message}`; }
})();
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
  if (xr.presenting) return;                            // three refuses size changes mid-session; xrSession re-syncs at the end
  cam.resize();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  rooms.resize(innerWidth, innerHeight, renderer.getPixelRatio());
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
    cam(m){ cam.mode = m; }, get shot(){ return cam.shot; },
    ride(t = songTime, directed = true){ const p = rideCam(t, directed); return p && { eye: p.eye.toArray(), aim: p.aim.toArray(), ...rideDbg }; },
    // room layout probe: world-space XZ boxes of every station, the drum machine and the belt bays
    boxes(deep){
      const bx = o => { const b = visBox(o, true); return b.isEmpty() ? null : [b.min, b.max].map(v => [+v.x.toFixed(1), +v.y.toFixed(1), +v.z.toFixed(1)]); };
      const out = {};
      instLive.forEach(r => out[r.I.key] = bx(r.station));
      if (drumGroup) out.drums = bx(drumGroup);
      if (deep && drumGroup) drumGroup.children.forEach((c, i) => out[`drums.${i}:${c.type}`] = bx(c));
      tracks.forEach(tr => out['belt:' + tr.role] = bx(tr.machine.group));
      return out;
    },
    director(){ const B = t => +((t - ROLL_T) / BEAT).toFixed(2);   // the room director's static cues, in beats
      return { rides: rideWins.map(w => [+w.t0.toFixed(2), +w.t1.toFixed(2), w.role]), rideEvery, cuts: plan ? plan.cuts.map(c => [B(c.t), c.key]) : [], signature: planIn?.voices.find(v => v.signature)?.key ?? null, shares: plan ? Object.fromEntries(Object.entries(plan.shares).map(([k, v]) => [k, +v.toFixed(3)])) : {},
               wide: moments.filter(m => m.n >= ENSEMBLE_N).map(m => B(m.t)),
               script: script.map(c => [c.key, B(c.t), +(c.hold / BEAT).toFixed(2)]), seamFrom: B(seamFrom) }; },
    get planIn(){ return planIn; },                   // (dev: the edit solve's inputs — tune directorplan.js offline)
    orbitMax(d){ cam.orbit.maxDistance = d; cam.orbit.maxPolarAngle = Math.PI; },
    room(k){ return k === undefined ? rooms.key : rooms.set(k); },
    audioProbe: () => audio.probe(),                   // mix-bus gain reduction + reverb-return peak
    // sound sweep: count every plugin strike from now on ({key: {n, ids, unbaked}}; reset → strikes(true))
    strikes(reset){ if (reset || !devStrikes) devStrikes = {}; return devStrikes; },
    audioPath: () => document.getElementById('astate')?.textContent ?? null,   // the status readout (state · clock · path)
    bank: () => audio.bankStats(),                     // iOS sample bank: count, WAV bytes, build ms
    // perf probe: draw calls / triangles per FRAME (summed over every composer pass, averaged
    // over n frames), live lights, compiled programs, and the scene's mesh count
    get scene(){ return scene; }, get renderer(){ return renderer; }, gov, set perfOff(v){ perfOff = !!v; },
    // occlusion probe: for every director shot (+ the wide), cast a 5×3 grid of rays from the
    // eye through the frame's middle and report which OTHER machine is hit before the subject
    occlusion(){
      const owner = o => { while (o.parent && o.parent !== world) o = o.parent; return o; };
      const name = g => g === drumGroup ? 'drums' : instLive.find(r => r.station === g)?.I.key || (tracks.find(t => t.stage === g) ? 'belt:' + tracks.find(t => t.stage === g).role : g.type);
      const rc = new THREE.Raycaster(), out = {}; rc.camera = camera;
      const test = (key, eye, aim) => {
        const fwd = aim.clone().sub(eye).normalize(), R = new THREE.Vector3().crossVectors(fwd, _Yup).normalize(), U = new THREE.Vector3().crossVectors(R, fwd);
        const dist = eye.distanceTo(aim), hits = {};
        for (const sx of [-.3, -.15, 0, .15, .3]) for (const sy of [-.15, 0, .15]){
          const dir = fwd.clone().addScaledVector(R, sx).addScaledVector(U, sy).normalize();
          rc.set(eye, dir); rc.far = dist * .9;
          const h = rc.intersectObject(world, true).find(i => i.object.visible && i.object.isMesh);
          if (h){ const n = name(owner(h.object)); hits[n] = (hits[n] || 0) + 1; }
        }
        out[key] = hits;
      };
      lastShots.forEach(sh => test(sh.key, sh.eye, sh.aim));
      if (lastWide?.eye) test('stage', lastWide.eye, lastWide.aim);
      return out;
    },
    get layout(){ return lastLayout; }, get wide(){ return lastWide; }, get merge(){ return mergeStats; }, frozen: () => frozenStats(),
    get editor(){ return editor; }, xr: xr.dev,                    // creation tools: .openMap() .toggleEdit() .stage.state() .stage.select(k)
    // staging-audit handles (scripts/staging-audit.mjs): the live camera, the song's world, the live marbles
    get three(){ return THREE; }, get camera(){ return camera; }, get world(){ return world; }, get marbles(){ return devMarbles; }, get P(){ return ROLL_T + LOOP_T; },
    get shots(){ return lastShots.map(s => ({ key: s.key, owner: s.owner, eye: s.eye.toArray(), aim: s.aim.toArray(), pref: s.pref?.toArray(), rays: s.rays, fg: s.fg, fitMax: s.fitMax, portrait: s.portrait?.eye.toArray() })); },
    get solve(){ const f = lastSolve?.follow; return lastSolve && { ms: lastSolve.ms, split: lastSolve.split, kept: lastSolve.kept, solids: lastSolve.solids, room: solvedRoom, follow: lastShots.length && f?.land ? { land: f.land, portrait: f.portrait, rays: f.rays } : null }; },
    get follow(){ return followRig; }, shotCtx: () => shotCtx(),
    roomSolids: () => roomSolids(rooms.group).map(s => s.box),   // the room's standing geometry, as the shot solve sees it
    hung: () => instLive.filter(r => r.slot.hang).map(r => ({ key: r.I.key, box: solidBox(r.station, drawn) })),   // (solid: the merged cable/glow batches aren't bulk)
    hang: () => instLive.filter(r => r.slot.hang).map(r => ({ key: r.I.key, wallTop: +stageWall.max.y.toFixed(2), low: +hangLow(r.station).toFixed(2), y: +r.station.position.y.toFixed(2) })),
    renderInfo(n = 10){
      return new Promise(res => {
        const I = renderer.info; I.autoReset = false; I.reset();
        let k = 0; const tick = () => { if (++k < n) return false;
          let meshes = 0, lights = 0; scene.traverseVisible(o => { if (o.isMesh || o.isSprite || o.isPoints || o.isLine) meshes++; if (o.isLight) lights++; });
          const out = { calls: Math.round(I.render.calls / n), tris: Math.round(I.render.triangles / n), programs: I.programs.length,
                        geometries: I.memory.geometries, textures: I.memory.textures, visibleObjs: meshes, lights };
          I.autoReset = true; I.reset(); res(out); return true; };
        frameTaps.push(tick);
      });
    },
  };
  dbg = { update(T){
    if (!held) bar.value = Math.round(T / (ROLL_T + LOOP_T) * 1000);
    time.textContent = `T ${T.toFixed(2)} ×${playRate}`;
  }};
}
