import * as THREE from "three";
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { makePerfGovernor } from './perfgov.js';
import { singlePassFlats } from './perftune.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SONGS, DEFAULT_SONG, defaultSongKey } from './songs/index.js';
import { fillSongMenu, addSongOption, isRuntimeSong } from './songmenu.js';
import { G, UP, ROLL_T, DESCENT, noteHz } from './engine.js';
import * as audio from './audio.js';
import { glowTex, initJuice, spawnBurst, spawnRipple, updateJuice } from './juice.js';
import { layoutJuggler, solveJuggler, assembleJuggler, unpackSolve, packSolve, ballAt as jBallAt } from './juggle.js';
import JUGGLE_BAKED from './juggle-baked.json';
import JuggleWorker from './juggle.worker.js?worker&inline';
import { planInWorkers } from './jugglejobs.js';
import { makeJuggleCache } from './jugglecache.js';
import { advance, spinTime, spinFor, ARM_AT } from './transport.js';
import { makeJugglerShop } from './jugglebelt.js';
import { makeMarbleDrums, KIT_SOLO, KIT_ROOM, KIT_STAND, kitAnchor } from './marbledrums.js';
import { makeCameraRig } from './camera.js';
import { makeRoomHost, ROOMS } from './rooms/index.js';
import { groundOf, clampLift, FOOT } from './rooms/footing.js';
import { INSTRUMENTS, instrumentByKey } from './instruments/index.js';
import { stationFor, layoutStations, soloStar, loneTurn, kitRiseAt, HANG_CLEAR, hangPlace } from './instruments/stations.js';
import { eventTimes, wrapP } from './instruments/clock.js';
import { splitBucket } from './instruments/sustain.js';
import { nextVoiceEpoch, voiceEpoch, sweepVoiceCaches } from './instruments/voicecache.js';
import { normalizeHit } from './drumkit.js';
import { encodeSong, decodeSong } from './share.js';
import { parseMidi } from './midi/parse.js';
import { convertToSong } from './midi/convert.js';
import { recSupported, startRecording } from './record.js';
import { spatialize } from './spatial.js';
import { velLook } from './dynamics.js';
import { mergeStatic, watchFrozen, pruneFrozen, frozenStats } from './mergestatic.js';
import { installRayBVH, rayBVHStats } from './raybvh.js';
if (!/[?&]nobvh(=|&|$)/.test(location.search)) installRayBVH();   // PERF (raybvh.js): the build's shot solves raycast big meshes through a BVH — same hits (?nobvh: A/B)
import { makeEditor } from './editor/index.js';
import { planEdit, shotAt, signatureOf } from './directorplan.js';
import { RIDE, ridePose, rideMoments, rideWindowAt } from './ridecam.js';
import { makeFollow, solveShots as solveShotsIn, resolveRoom, solidBox, roomSolids, glowy } from './shotrig.js';
import { fitWide, screenSize, UI_BOTTOM } from './shotsolve.js';
import { makeXR } from './xr.js';
import { U_PER_M } from './xrplan.js';
import { makeXRDetail, collectGlow, XR_DETAIL } from './xrdetail.js';
import { makeXRBatch } from './xrbatch.js';
/* ============================================================
   GRAVITY ORCHESTRA (née Cascade) — melody-driven marble run, now multi-track.
   A song is one or more tracks of [note, beats-until-next-hit].
   Every track is a voice of ONE juggling machine (the belt: src/juggle.js
   plans every throw, src/jugglebelt.js draws it); they share the clock,
   so harmony is geometry. The pure physics/music primitives live in engine.js.
   ============================================================ */

/* ---- mutable song state, filled by buildWorld() ---- */
let BEAT = .7, SCALE = [];
let tracks = [], LOOP_T = 0, world = null;
let drumGroup = null;                                   // the drum machine's group (dev layout probe)
/* THE BELT: the multiball JUGGLER — one machine for every belt voice (src/juggle.js plans it,
   src/jugglebelt.js draws it) */
let jug = null, jplan = null;                           // the belt machine + its plan, this song
let stageWall = new THREE.Box3();                       // the belt machines' world box this song (staging + the wide fit)
let curBuild = null;                                    // this song's staging inputs (stage edit re-anchors from them: restage)
let lastLayout = null, lastWide = null, lastShots = [], devMarbles = [], lastSolve = null;                                  // dev: the last room solve (__dev.layout)
let kitSlot = KIT_SOLO;                                 // where the drum machine stands this song (marbledrums.js; + y: its deck)
let kitLoc = null;                                      // the kit's solid box over the loop — its pistons at their deepest —
                                                        // relative to its origin (buildWorld)
/* RCT-style HEIGHTS set from outside the layout (rooms/footing.js): __dev.lift(key, u), seeded by
   ?lift=marimba:4,drums:2.5 — u above the machine's ground, per machine key, for every song of this
   page (a layout entry's own lift wins) */
const devLift = Object.fromEntries((new URLSearchParams(location.search).get('lift') || '').split(',')
  .map(e => e.split(':')).filter(([k, v]) => k && v !== undefined && Number.isFinite(+v)).map(([k, v]) => [k, clampLift(+v)]));
let lastAnchors = [];                                   // what the room was last told stands where (placeRoom; __dev.anchors)
const kitLift = () => clampLift(Number.isFinite(kitSlot.lift) ? kitSlot.lift : kitSlot.rise);   // the kit's height: the user's lift, else the room solve's DRUM RISER (stations.js)
const kitDeck = () => groundOf(KIT_STAND, ROOM.FLOOR) + kitLift();   // the kit's deck: its slab on the floor's plinth, or lifted
const FIXED_ZMAX = 30;                                  // FIXED cam: cap the pull-back. Past ~30 the FogExp2 eats
                                                        // the chrome to black; better to let a very wide field
                                                        // overflow the frame edges than fade the whole scene out.
let muted = false;                                      // sound toggle (mute button)
let songTime = 0;                                       // the timeline; clock only supplies deltas
let playRate = 1, skipStrikes = false, dbg = null;      // ?debug scrub: rate + jump suppression
let playing = true;                                     // the transport (STOP / START): a stopped song is a frozen frame
let devStrikes = null;                                   // ?debug sound sweep: strikes per machine (+ ids with no baked voice)
let voiceCacheStat = null;                              // dev: what the last build's voice-cache sweep kept/dropped (__dev.bank)
let devMute = null;                                     // ?debug sound sweep: machines kept SILENT ('belt', 'drums', plugin keys) — solo levels
let loopIndex = -1;                                     // floor(songTime / P); ticks once per loop → spawns balls
/* THE STATIC BAND: the world never falls. Every plate rides its lane's chain up to the strike
   line exactly at its strike (beltPhase) and wraps away off-screen; the balls fly their solved
   arcs between strikes, held over the long gaps by the magnet carriages (src/juggle.js).
   Physics is untouched — this is all render-time framing. */
const STAGE_Y = DESCENT * ROLL_T;                       // the static strike band (~5.7) every plate rises to meet
const LEAD_IN = 2.4;                                    // seconds of count-in BEFORE the downbeat (songTime starts
                                                        // negative): the machine spins up so songs don't snap straight
                                                        // in. A pickup fill (negative drum beats) rides the roll-in
                                                        // just ahead of the downbeat — see convert.js step 12.
let recState = 'idle', recorder = null;                 // idle | armed | rec — transitions at the seam
const recEl = document.getElementById('rec');
const playEl = document.getElementById('playstop'), restartEl = document.getElementById('restart');   // the transport (STOP / START · RESTART)
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
  return _pbRay.intersectObject(world, true).some(h => (h.object.isMesh || h.object.isInstancedMesh) && drawn(h.object))
      || _pbRay.intersectObject(rooms.footGroup, true).some(h => drawn(h.object) && !glowy(h.object.material));   // (a tower the machines stand on)
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
/* the VR DETAIL PROFILE (src/xrdetail.js): fine parts the headset can't resolve, dim glows, the
   no-bloom glow boost, the rooms' lighter XR variants. ?xrdetail=full = the un-reduced A/B. */
const xrLite = new URLSearchParams(location.search).get('xrdetail') !== 'full';
const xrDetail = makeXRDetail(), xrBatch = makeXRBatch();
/* FLAT BATCH (2D): the same mirror as the headset's (src/xrbatch.js) — every opaque machine part
   that shares a look is copied into one BatchedMesh per look right before the screen render and
   hidden for that one render. Same parts, same matrices, same materials: the picture is the same,
   in about half the draw calls. OPT-IN (?batch=1) — measured in headless Chrome (desktop and a
   4×-throttled phone profile) the mirror's own per-frame copy + per-instance culling cost what the
   saved calls did (CPU ms per frame unchanged, ±1 ms), so it stays off until a real phone GPU driver
   says otherwise. __dev.batchAB() proves a frame against the originals (scripts/batch-ab.mjs). */
let BATCH_2D = new URLSearchParams(location.search).get('batch') === '1';
const flatBatch = makeXRBatch();
let xrOn = false, xrMode = null;                                       // (presenting — xrSession keeps it; buildWorld re-applies plugin xr hooks)
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

let machinesOn = true;                                  // key M toggles the belt's machine for A/B (plates + balls stay)

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

/* ---------------- the belt voices' looks (lead = amber, bass = ice-blue, alto = violet) ---------- */
const RIG_OPT = {
  lead: {r:.26, body:0xffc488, emissive:0xff9233, glow:0xffaa55},
  bass: {r:.36, body:0xa8d4ff, emissive:0x3d7dff, glow:0x66aaff},
  alto: {r:.21, body:0xe2c8ff, emissive:0x9a4dff, glow:0xc08bff},
};
/* the juggler's machine shop (one machine per song; its balls wear these looks) */
const jugShop = makeJugglerShop({ envMap, floorY: ROOM.FLOOR - (STAGE_Y + UP.y),
  rig: Object.fromEntries(Object.entries(RIG_OPT).map(([k, v]) => [k, { ...v, glowTex }])) });
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
  background:'rgba(4,4,12,.72)', border:'1px solid #2a3550', borderRadius:'6px',
  display: convDbgOn ? 'block' : 'none'});               // (OFF means hidden: an empty panel over the HUD dimmed the title/song pick)
convRulers.visible = convDbgOn;
document.body.appendChild(convCv);
const convX = convCv.getContext('2d');
const convHist = []; const CONV_N = 300;
addEventListener('keydown', e => { if (e.key === 'g' || e.key === 'G'){
  convDbgOn = !convDbgOn; convCv.style.display = convDbgOn ? 'block' : 'none'; convRulers.visible = convDbgOn; }});
addEventListener('keydown', e => { if (e.key === 'm' || e.key === 'M'){    // A/B the visible machine
  machinesOn = !machinesOn; if (jug) jug.frame.visible = machinesOn; }});
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
  const nBalls = jplan?.voices.reduce((s, V) => s + (V.balls || 0), 0) ?? 0;
  convX.fillText(`cam y ${last.c.toFixed(1)}  loop ${loopIndex}  balls ${nBalls}  (G to hide)`, 4, H-4);
}
let expoKick = 0;                                       // exposure pop on lead strikes (camera shake lives in the rig)

/* World-space bounds of what is actually DRAWN under `root` (hidden parts — a parked ball,
   a stowed pad — don't count; sprites/halos don't either). `ignoreRoot`: measure a group
   even while it is toggled off (the M key hides the belt's machine). */
const _vb = new THREE.Box3();
function visBox(root, ignoreRoot = false){
  const out = new THREE.Box3();
  root.updateWorldMatrix(true, true);                   // parents too: a fresh machine hasn't rendered yet
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
/* A FLOOR machine's SOLID box in its OWN frame (station-local: y 0 = its deck) over the loop: the
   count-in pose (rest) + LOW_N samples of the running loop (pose) + any moments it names (`at`: the
   kit's pistons at their deepest — a dip lasts a fraction of a second) — a part that swings below the
   base mid-song counts. Solid = solidBox's rules (shotrig.js): no glows, no unlit wire / LED
   batches. Its min.y is the machine's LOW — where it sits on the floor (rooms/footing.js groundOf);
   its x/z, the footprint the room plants a plinth under. Leaves the machine in the count-in pose.
   Each part (each instance) counts as its turned bounding box ∩ its bounding sphere's: a turned
   box alone grows by up to √2 (the bow wheel's rim, a quarter turn in, reached 1.6 u under its
   real underside), a sphere never does — both hold the part, so their intersection does too. */
const LOW_N = 12, _li = new THREE.Matrix4(), _lm = new THREE.Matrix4(), _im = new THREE.Matrix4();
const _ls = new THREE.Sphere(), _pb = new THREE.Box3();
let lowMs = 0;                                          // dev: what the low sweeps cost this build (__dev.stage)
function partBox(geo, m, out){
  _pb.copy(geo.boundingBox).applyMatrix4(m);
  _ls.copy(geo.boundingSphere).applyMatrix4(m);
  const c = _ls.center, r = _ls.radius;
  _pb.min.set(Math.max(_pb.min.x, c.x - r), Math.max(_pb.min.y, c.y - r), Math.max(_pb.min.z, c.z - r));
  _pb.max.set(Math.min(_pb.max.x, c.x + r), Math.min(_pb.max.y, c.y + r), Math.min(_pb.max.z, c.z + r));
  out.union(_pb);
}
function solidLocal(root, pose, rest, P, at = []){
  const t0 = performance.now(), out = new THREE.Box3();
  const take = () => {
    root.updateMatrixWorld(true);
    _li.copy(root.matrixWorld).invert();
    root.traverse(o => {
      if (!(o.isMesh || o.isInstancedMesh) || !o.geometry?.attributes.position) return;
      for (let p = o; p && p !== root; p = p.parent) if (!p.visible) return;
      const m = [].concat(o.material)[0];
      if (!m || glowy(m) || m.isMeshBasicMaterial) return;
      const g = o.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      if (!g.boundingSphere) g.computeBoundingSphere();
      if (g.boundingBox.isEmpty()) return;
      _lm.multiplyMatrices(_li, o.matrixWorld);
      if (!o.isInstancedMesh) partBox(g, _lm, out);
      else for (let i = 0; i < o.count; i++){ o.getMatrixAt(i, _im); partBox(g, _im.premultiply(_lm), out); }
    });
  };
  rest(); take();
  for (let k = 0; k < LOW_N; k++){ pose((k + .5) / LOW_N * P); take(); }
  for (const t of at){ pose(t); take(); }
  rest(); root.updateMatrixWorld(true);
  lowMs += performance.now() - t0;
  return out;
}
/* An OPEN stand (a descriptor's `stand` hint — the turntable rests on its feet, its resonator rank
   hanging below): in the station's own frame at the count-in pose, every solid part resting ON the
   stand plane — its FEET [u, v, r], about the footprint's centre — and the u/v extent of everything that
   hangs below the plane (HANG [u0, u1, v0, v1]). The room's open footing posts each foot and keeps its
   beams out of the hang (rooms/footing3d.js). L: its solidLocal box (the footprint). */
const _sb = new THREE.Box3();
function standParts(root, stand, L){
  const cx = (L.min.x + L.max.x) / 2, cz = (L.min.z + L.max.z) / 2, feet = [], hang = new THREE.Box3();
  root.updateMatrixWorld(true);
  _li.copy(root.matrixWorld).invert();
  const part = (g, m) => {
    _sb.makeEmpty(); partBox(g, m, _sb);
    const hx = (_sb.max.x - _sb.min.x) / 2, hz = (_sb.max.z - _sb.min.z) / 2;
    if (Math.abs(_sb.min.y - stand) < .06 && _sb.max.y > stand + .05){
      // (a FOOT is a compact part on the plane — not a rail or a rod that happens to end there)
      if (Math.min(hx, hz) >= .15 && Math.max(hx, hz) <= 1.5) feet.push([(_sb.min.x + _sb.max.x) / 2 - cx, (_sb.min.z + _sb.max.z) / 2 - cz, Math.max(hx, hz)]);
    }
    else if (_sb.min.y < stand - .05) hang.union(_sb);
  };
  root.traverse(o => {
    if (!(o.isMesh || o.isInstancedMesh) || !o.geometry?.attributes.position) return;
    for (let p = o; p && p !== root; p = p.parent) if (!p.visible) return;
    const m = [].concat(o.material)[0];
    if (!m || glowy(m) || m.isMeshBasicMaterial) return;
    const g = o.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    if (!g.boundingSphere) g.computeBoundingSphere();
    if (g.boundingBox.isEmpty()) return;
    _lm.multiplyMatrices(_li, o.matrixWorld);
    if (!o.isInstancedMesh) part(g, _lm);
    else for (let i = 0; i < o.count; i++){ o.getMatrixAt(i, _im); part(g, _im.premultiply(_lm)); }
  });
  return { feet, hang: hang.isEmpty() ? null : [hang.min.x - cx, hang.max.x - cx, hang.min.z - cz, hang.max.z - cz] };
}
/* a local box (solidLocal) where `o` now stands: its world AABB [x0, x1, y0, y1, z0, z1] */
const _wb = new THREE.Box3();
function worldBox(L, o){
  o.updateWorldMatrix(true, false);
  _wb.copy(L).applyMatrix4(o.matrixWorld);
  return [_wb.min.x, _wb.max.x, _wb.min.y, _wb.max.y, _wb.min.z, _wb.max.z];
}
/* every ADDITIVE, opacity-driven material under root (glows, flashes, halos, trails) — the
   ones that are invisible at opacity 0 (shader materials draw by their own uniforms: skipped) */
let fadeMats = [], fadeWarm = 0, fadeTick = 0, perfOff = false;
const NO_MERGE = new URLSearchParams(location.search).has('nomerge');
const RIGID = new URLSearchParams(location.search).has('norigid') ? { rigid: false, groups: false } : { rigid: true, groups: true };   // ?norigid: A/B — the merge as it was (no carriage merge, no multi-group parts)
const AUDIT_N = +new URLSearchParams(location.search).get('mergeaudit') || 0;   // dev: re-prove every bake over a dense sweep (scripts/merge-audit.mjs)
let mergeStats = null, mergeAudit = null;                                  // dev: what the static merge baked (__dev.merge)
function collectFadeMats(root){
  const out = new Set();
  root.traverse(o => { for (const m of [].concat(o.material || []))
    if (m.transparent && m.blending === THREE.AdditiveBlending && !m.isShaderMaterial && !m.userData.noFadeGate && !o.userData.noFadeGate) out.add(m); });
  return [...out];
}
function disposeTree(root){
  root.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    for (const m of [].concat(o.material || [])) if (m !== chrome){ if (m.map) m.map.dispose(); if (m.emissiveMap) m.emissiveMap.dispose(); m.dispose(); }
  });
}

/* THE BELT — the JUGGLER: ONE machine for every belt voice (src/jugglebelt.js), its whole loop
   planned up front (src/juggle.js — who strikes what, on which hand, when the cranes catch and
   release). `tracks` are thin VIEWS of the plan's voices (role, pads, rollT, total, deep): the
   camera's buttons, the director, the audio bank and the rides read them.
   The plan's SEARCH takes up to seconds, so it never runs here: the catalog's solves are baked
   (src/juggle-baked.json, scripts/juggle-bake.mjs — keyed by the belt's notes + tempo), a plan this
   page solved before is remembered (src/jugglecache.js); anything else (an import, a share link, a
   MAP re-route) is solved by workers (src/jugglejobs.js) while the machine stands ready but empty
   and the count-in runs — the song never starts before it is in (transport.js) — then swapped in
   (jugglerSolved). Returns the FIXED-cam framing + its width. */
function buildJuggler(S, wallBox){
  const t0 = performance.now();
  let L = layoutJuggler(S);
  const baked = JUGGLE_BAKED.plans[L.key], cached = !baked && jugCache.get(L.key);   // (the key holds the solver's version too)
  if (baked){ assembleJuggler(L, unpackSolve(baked.voices)); L.from = 'bake'; }
  else if (cached) L = fromCache(S, L, cached);
  jplan = L;
  if (!L.solved) solveJugglerAsync(S, L);
  LOOP_T = L.P - ROLL_T;
  tracks = L.voices.map((V, vi) => {
    const rollT = ROLL_T + V.delay * BEAT;
    return { role: V.role, deep: V.deep, isBass: V.role === 'bass', V, vi, rollT,
             total: V.notes.reduce((a, q) => a + q.dt, 0),
             pads: V.notes.map(q => ({ t: q.s - rollT, dt: q.dt, note: q.note, vel: q.vel })),
             stage: null, machine: { group: null }, _st: null };   // (stage / machine.group: the juggler's — mountJuggler)
  });
  mountJuggler(L, -LEAD_IN);
  wallBox.union(visBox(jug.frame, true));
  L.ms = Math.round(performance.now() - t0);
  return { stageView: { cx: 0, halfW: Math.max(6, jug.width / 2) }, wallW: jug.width };
}
/* build the machine for plan L (solved, or a layout still being solved) and hang it in the world */
function mountJuggler(L, t){
  if (jug){ world.remove(jug.group); jug.dispose(); }
  if (L.solved && L.warnings.length) console.warn('cascade juggler:\n  ' + L.warnings.join('\n  '));
  jug = jugShop.build(L, { hueOf });
  jug.group.position.set(0, STAGE_Y + UP.y, 0);           // its band frame: y 0 = a ball's centre at a strike
  jug.frame.visible = machinesOn;
  world.add(jug.group);
  tracks.forEach(tr => { tr.stage = jug.group; tr.machine.group = jug.frame; });
  if (L.solved) jugSpin = spinFor(t, jugBreath(L), LEAD_IN);
  jug.update(L.solved ? jugTime(t) : 0, 0, { skipStrikes: true });   // posed before anything measures it (pending: standing still)
  jug.group.updateMatrixWorld(true);
  if (xrOn) jug.xr(true);
}
/* THE COUNT-IN, juggler: the machine SPINS UP (transport.js spinTime). Before songTime 0 its clock
   runs slow — at rest R s before it, full speed (C1) at 0 — covering only d s of the plan, all of
   it after the last ball docked. So the count-in shows the plan's own breath (every ball home,
   nothing struck) — never the loop's last bar (Canon's would be 9 notes). A pure fn of songTime
   (scrub-exact); the chains and their plates slow together, slip-free. A build's plan spins up over
   the whole count-in (R = LEAD_IN); a worker's, landing mid-count-in, over what is left of it. */
let jugSpin = { R: LEAD_IN, d: 1.2 };
const jugTime = t => spinTime(t, jugSpin);
/* the voice's ball with the most time in the air per loop (what a manual RIDE follows) */
function busiestBall(V){
  if (V._busy == null){ const air = new Array(V.balls).fill(0); for (const q of V.segs) air[q.ball] += q.t1 - q.t0; V._busy = air.indexOf(Math.max(...air)); }
  return V._busy;
}
/* the plan's BREATH: the time before songTime 0 with every ball home (what a spin-up may cover) */
function jugBreath(L){
  const home = L.P - Math.max(...L.voices.map(V => V.dockT?.length ? V.dockT[V.dockT.length - 1] : -Infinity));
  return Math.max(.05, home - .15);
}
const jugCache = makeJuggleCache();
/* a plan this page solved before (jugglecache.js), assembled like a baked one; an entry that won't
   assemble is dropped and the song solved again, on a fresh layout (assembling mutates one) */
function fromCache(S, L, packed){
  try { assembleJuggler(L, unpackSolve(packed)); L.from = 'cache'; return L; }
  catch (err){ jugCache.drop(L.key); console.warn('cascade juggler: a remembered plan would not assemble — solving it again', err); return layoutJuggler(S); }
}
/* the SEARCH, off the main thread: every (voice, beam width) job in a worker of its own, a few at
   once (jugglejobs.js — exactly solveJuggler's plan); no workers → here, after a paint */
const JUG_WORKERS = Math.min(3, Math.max(1, (navigator.hardwareConcurrency || 4) - 1));
let jugJobs = null, jugReq = 0;
function solveJugglerAsync(S, L){
  const id = ++jugReq, mine = () => id === jugReq && jplan === L;
  noteEl.textContent = 'planning the juggle…';            // (the count-in waits for it — transport.js)
  const failed = err => { console.error('cascade juggler: the plan failed', err); noteEl.textContent = 'the juggle could not be planned'; };
  const local = () => setTimeout(() => {
    if (!mine()) return;
    try { jugglerSolved(L, solveJuggler(L)); L.from = 'main'; } catch (err){ failed(err); }
  }, 50);
  jugJobs?.cancel();                                      // a stale search must not delay this one
  jugJobs = planInWorkers(L, S, { makeWorker: () => new JuggleWorker(), cap: JUG_WORKERS,
    onDone: solved => {
      if (!mine()) return;
      try { jugglerSolved(L, solved); L.from = 'workers'; }
      catch (err){ console.warn('cascade juggler: the workers\' plan would not assemble — solving here', err); local(); }
    },
    onError: err => { if (mine()){ console.warn('cascade juggler: workers failed —', err?.message || err, '— solving here'); local(); } } });
}
/* the plan is in: assemble it onto THIS build's layout, remember it (jugglecache.js) and swap the
   empty machine for the full one. The count-in runs on — the belt spinning up over what is left of
   it — and the director re-plans its rides from the new flights */
function jugglerSolved(L, solved){
  assembleJuggler(L, solved);
  jugCache.put(L.key, packSolve(solved, L));
  noteEl.textContent = '';
  mountJuggler(L, songTime);
  if (curBuild) syncDirector(curBuild.S, curBuild.view);
  fadeMats = collectFadeMats(world); fadeWarm = 3;
  singlePassFlats(scene);
}

function buildWorld(keyName){
  if (recState !== 'idle') abortRec();                  // a rebuilt world invalidates the take
  const S = editor.song(keyName);                       // (the creation tools' instrument MAP may re-route it — src/editor)
  nextVoiceEpoch();                                     // the plugin voice caches now belong to THIS build (voicecache.js)
  BEAT = 60 / S.bpm; SCALE = S.scale;
  document.getElementById('songsub').textContent = S.sub;

  if (jug){ jug.dispose(); jug = null; jplan = null; }   // (a pending solve for the old song is dropped: jplan moved on)
  if (world){
    scene.remove(world);
    world.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material && o.material !== chrome){
        if (o.material.map) o.material.map.dispose();   // per-song belt CanvasTextures — don't leak
        if (o.material.emissiveMap) o.material.emissiveMap.dispose();   // (the belt housings' warm wash)
        o.material.dispose();
      }
    });
  }
  world = new THREE.Group(); world.matrixAutoUpdate = false; scene.add(world);   // (never moves: lets still stations skip matrix work)
  pruneFrozen();

  // ---- STAGING. Everything is built at its BASE slot first, then the room is SOLVED from
  //      what was really built (stations.js layoutStations: the wings ride out with the
  //      belt's edges, overlapping footprints are pushed apart) and moved into place — a
  //      rigid translation of solved worlds, render-time only. ----
  // THE BELT: the JUGGLER — ONE machine, every voice's balls (src/juggle.js plans, src/jugglebelt.js draws)
  const wallBox = stageWall.makeEmpty();
  const { stageView, wallW } = buildJuggler(S, wallBox);
  const full = !!(S.parts && Object.keys(S.parts).some(k => S.parts[k]?.length));
  const P0 = ROLL_T + LOOP_T, loopBeats = S.melody.reduce((a, n) => a + n[1], 0);

  // marble drums: built song-level, added under world (so it disposes with the world on the
  // next song change). Aligned to the lead's timeline; `start` (ARM_AT, like every station's —
  // transport.js) arms every ball on its magnet for the count-in. The kit moves to the
  // front-right tier when the room is full of plugin stations; the solve may slide it further
  // (then it is rebuilt there: its contacts are world). It stands ON THE FLOOR — its deck slab
  // (KIT_STAND) on the room's plinth (rooms/footing.js) — or as high as the user lifted it (a layout
  // entry's lift). Its pistons stroke deeper than the slab, briefly: into the WELL its base keeps
  // (the solid box below is measured where each one bottoms out).
  kitSlot = { ...editor.kitSlot(full ? KIT_ROOM : KIT_SOLO) };  // (a user-placed kit — stage edit — is pinned there)
  if (!Number.isFinite(kitSlot.lift) && devLift.drums !== undefined) kitSlot.lift = devLift.drums;
  kitSlot.y = kitDeck();
  // (posed once at the count-in instant: an un-posed ball parked at the origin would make the
  //  measured footprint reach across the room)
  const POSE0 = { started: false, skipStrikes: true, onStrike(){} };
  const RUN0 = { started: true, skipStrikes: true, onStrike(){} };   // (a pose of the running loop: the low sweep)
  const buildKit = () => { const g = drumKit.build(S.drums, { rollT: ROLL_T, beat: BEAT, P: P0, cx: stageView.cx, start: ARM_AT, slot: kitSlot });
    drumKit.update(-LEAD_IN, P0, 0, POSE0); return g; };
  drumGroup = buildKit();
  world.add(drumGroup);
  kitLoc = null; lowMs = 0;
  if (S.drums && Object.keys(S.drums).length){          // (its group sits at the origin: its box is the kit's, in world)
    const L = solidLocal(drumGroup, t => drumKit.update(t, P0, 0, RUN0), () => drumKit.update(-LEAD_IN, P0, 0, POSE0), P0, drumKit.lowTimes());
    const K = kitOrigin(stageView.cx);
    if (!L.isEmpty()) kitLoc = L.clone().translate(new THREE.Vector3(-K.x, -K.y, -K.z));   // (the kit is the same at any deck: it builds round K)
  }

  // instrument plugins: each part builds inside its station (render-time placement only)
  const voices = [];
  instLive = [];
  instRigs.forEach((rig, i) => {
    const part = S.parts?.[rig.I.key];
    if (!part || !part.length) return;
    const st = editor.slot(rig.I.key, stationFor(rig.I.key, i));   // a user-placed station (stage edit): pinned x/z/yaw
    const station = new THREE.Group(); station.name = rig.I.key;   // (names: perf/debug probes)
    // a HUNG station (the ricochet chandelier) is a crown over the belt: centred on the wall,
    // its LOWEST part (plate, stem, the knot's wire) HANG_CLEAR above the belt's top housing —
    // never across the strike band, never reading as resting on the housing
    const hung = st.hang && !wallBox.isEmpty();
    // a FLOOR machine is built at deck 0 with NO supports (floorY 0: every plugin's legs / riser /
    // pedestal is gated on it) and then SET IN THE ROOM below — on the floor's plinth at its ground,
    // or lifted (rooms/footing.js): a rigid move, so a height change never rebuilds it
    let y = hung ? wallBox.max.y + HANG_CLEAR : 0;
    const z = hung ? (wallBox.min.z + wallBox.max.z) / 2 + st.z : st.z;
    station.position.set(stageView.cx + st.x, y, z);
    station.rotation.y = st.yaw;
    const buildAt = () => rig.inst.build(part, { rollT: ROLL_T, beat: BEAT, P: P0, start: ARM_AT,
      station: st, floorY: hung ? ROOM.FLOOR - y : 0, ceilY: ROOM.CEIL - y, loopBeats });
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
    // its HEIGHT (rooms/footing.js): ground = where it sits on the floor's plinth (its lowest solid
    // part over the loop — solidLocal); deck = ground + lift. A lift — the user's (a layout entry), or
    // the room solve raising it onto the rear GALLERY (stations.js) — is a rigid move: no legs to regrow
    rig.lift = 0; rig.ground = y; rig.low = 0; rig.loc = null; rig.stand = null;
    rig.setLift = u => { rig.lift = u; y = rig.ground + u; station.position.y = y; station.updateMatrixWorld(true); rig.slot.y = y; };
    if (!hung){
      const L = solidLocal(station, t => rig.inst.update(t, P0, 0, RUN0), () => rig.inst.update(-LEAD_IN, P0, 0, POSE0), P0);
      if (!L.isEmpty()){ rig.loc = L; rig.low = L.min.y; }
      if (rig.loc && Number.isFinite(rig.I.stand) && rig.low < rig.I.stand - .05) rig.stand = standParts(station, rig.I.stand, rig.loc);
      rig.ground = groundOf(rig.low, ROOM.FLOOR);
      const set = Number.isFinite(st.lift) ? st.lift : devLift[rig.I.key];   // (a user's height: the gallery solve leaves it alone)
      if (set !== undefined) rig.slot.lift = clampLift(set);
      rig.setLift(clampLift(rig.slot.lift));
    }
    rig.cue = eventTimes(part, { rollT: ROLL_T, beat: BEAT }).map(e => ({ t: e.t, w: e.vel, id: String(e.note) }));   // (id: what it played — the director reads a hook's variety)
    rig.mix = partMix(S, rig.I.key);
    instLive.push(rig);
    // (voiceIds gets the tempo: a plugin may bucket its voices by a note's length in SECONDS)
    const ids = rig.I.voiceIds ? rig.I.voiceIds(part, { beat: BEAT, bpm: S.bpm, rollT: ROLL_T, P: P0, loopBeats }) : [...new Set(part.map(e => e[1]))];
    // (gain: the song.mix level — applied as the bank wraps the render (AudioBuffer / WAV), never a
    //  scaled copy of it: the plugin's cached render IS the bank's source, no second Float32 array)
    // (t0: the machine's first strike — the bank bakes soonest machine first, src/audio.js BAKE_SYNC_MS)
    const t0 = rig.cue.reduce((m, c) => Math.min(m, wrapP(c.t - ARM_AT, P0)), Infinity);
    ids.forEach(id => voices.push({ key: `inst:${rig.I.key}:${id}`, wet: !!rig.I.wet, hz: voiceHzOf(rig.I, id),
      render: () => rig.I.voice(id), gain: rig.mix.base, t0 }));
    // a DURATION-BUCKET id ('C4~1', src/instruments/sustain.js) carries its release baked in for the
    // iOS <audio> path; the live path plays its BASE and releases at `dur` exactly — so a base no
    // strike fires bare is baked LIVE-ONLY (the Float32 source, no <audio> element / WAV)
    const idSet = new Set(ids);
    new Set(ids.filter(id => String(id).includes('~')).map(id => splitBucket(id).base)).forEach(b => { if (!idSet.has(b))
      voices.push({ key: `inst:${rig.I.key}:${b}`, wet: !!rig.I.wet, hz: voiceHzOf(rig.I, b), live: true,
        render: () => rig.I.voice(b), gain: rig.mix.base, t0 }); });
  });

  // the SOLVE: floor stations + the kit (a hung station floats over everyone — not in it)
  let tops = {}, bots = {};
  const relBox = (o, ox, oz, key) => { const b = visBox(o); if (b.isEmpty()) return null; tops[key] = b.max.y; bots[key] = b.min.y;
    return [b.min.x - ox, b.max.x - ox, b.min.z - oz, b.max.z - oz]; };
  const items = [];
  // a LONE STAR (the song's signature alone on the floor — Piano Man's grand) turns a three-quarter
  // (stations.js loneTurn) before it is measured: a rigid spin, render-time only (a user's yaw wins)
  { const keys = instLive.filter(r => !r.slot.hang).map(r => r.I.key).concat(S.drums && drumGroup ? ['drums'] : []);
    const lone = keys.length === 1 && instLive.find(r => r.I.key === keys[0]), turn = lone && !lone.slot.pin ? loneTurn(keys, stageStar(S)) : 0;
    if (turn){ lone.station.rotation.y += turn; lone.station.updateMatrixWorld(true); } }
  instLive.forEach(r => { if (r.slot.hang) return;
    const p = r.station.position, box = relBox(r.station, p.x, p.z, r.I.key);
    if (box) items.push({ key: r.I.key, x: p.x, z: p.z, box, top: tops[r.I.key], deck: p.y, rig: r, pin: r.slot.pin,
      ...(Number.isFinite(r.slot.lift) ? { lift: r.slot.lift } : {}) }); });   // (the USER's height: 0 = on the floor — it never climbs)
  // (the HUNG stations' world footprints: a gallery deck keeps clear of them — the organ loft's
  //  chassis and the chandelier's crown stand where a gallery machine would)
  const hungBoxes = instLive.filter(r => r.slot.hang).map(r => visBox(r.station)).filter(b => !b.isEmpty()).map(b => [b.min.x, b.max.x, b.min.z, b.max.z]);
  const kx0 = stageView.cx + kitSlot.x, kz0 = kitSlot.z;
  if (S.drums){ const box = relBox(drumGroup, kx0, kz0, 'drums'); if (box) items.push({ key: 'drums', x: kx0, z: kz0, box, top: tops.drums, deck: kitSlot.y, pin: kitSlot.pin,
    ...(Number.isFinite(kitSlot.lift) ? { lift: kitSlot.lift } : {}) }); }   // (the USER's height: it never takes the riser)
  lastLayout = null;                                    // (dev: a song with no floor machine has no solve — never the last song's)
  if (items.length && !wallBox.isEmpty()){
    // THE STAR (the song's signature machine — the one the director will name) stands front and centre
    const star = stageStar(S) ?? soloStar(items);
    const solved = layoutStations(items,
      [wallBox.min.x, wallBox.max.x, wallBox.min.z, wallBox.max.z],
      { x0: -ROOM.HW + 2.5, x1: ROOM.HW - 2.5, z0: ROOM.BACK + 2.5, z1: 31 },
      { cx: stageView.cx, bandY: STAGE_Y - 1.5, eyeY: 20, wallTop: wallBox.max.y, hung: hungBoxes, star, loftGap: FOOT.LOFT_GAP });   // (band − 1.5: the pads rising INTO the band read too)
    lastLayout = { items: items.map(({ key, x, z, box, top, deck }) => ({ key, x, z, box, top, y0: bots[key], deck })), wall: wallBox.clone(), solved, cx: stageView.cx, bandY: STAGE_Y - 1.5, hung: hungBoxes, star };
    items.forEach(it => {
      const { x, y, z, lift } = solved[it.key];
      if (it.rig){
        // up onto the rear GALLERY (a lift: the gallery deck − its ground) or a tiered RISER (its lift) —
        // unless the user set its height
        const to = y !== undefined ? y - it.rig.ground : lift;
        if (to !== undefined && !Number.isFinite(it.rig.slot.lift) && Math.abs(to - it.rig.lift) > 1e-6) it.rig.setLift(to);
        it.rig.station.position.x = x; it.rig.station.position.z = z; it.rig.station.updateMatrixWorld(true);
      }
      else if (Math.abs(x - kx0) + Math.abs(z - kz0) > 1e-6 || (lift || 0) !== (kitSlot.rise || 0)){   // the kit moved (or up its DRUM RISER):
        world.remove(drumGroup); disposeTree(drumGroup);                                              //  rebuilt at its solved slot + deck
        kitSlot = { ...kitSlot, x: x - stageView.cx, z, rise: lift || 0 };
        kitSlot.y = kitDeck();
        drumGroup = buildKit(); world.add(drumGroup);
      }
    });
  }

  // PERF: bake each station's provably-still parts into one mesh per material (mergestatic.js —
  // posed across the whole loop first: a part that ever moves or blinks is left alone).
  // ?nomerge skips it (A/B).
  let kitMerge = null;                                  // (the kit's bake, again for a kit rebuilt at a new slot: restage)
  if (!NO_MERGE){
    const times = Array.from({ length: 48 }, (_, k) => -LEAD_IN + (k + .37) / 48 * (P0 + LEAD_IN));
    mergeStats = { merged: 0, removed: 0 };
    mergeStats.frozen = 0;
    const add = r => { mergeStats.merged += r.merged + (r.rigid?.merged || 0); mergeStats.removed += r.removed + (r.rigid?.removed || 0); mergeStats.frozen += r.frozen || 0; mergeStats.rigid = (mergeStats.rigid || 0) + (r.rigid?.removed || 0); };
    const RUN = { started: true, skipStrikes: true, onStrike(){} };   // (started: the LIVE pose — !started is the armed hold)
    // (the last arg re-poses for the count-in; parts still across the sweep AND that pose stop auto-updating their matrices)
    // the proof's SAMPLES: the uniform sweep, plus the moments a STRIKE moves something. A lid pop,
    // a bell's flex, a valve press lasts a fraction of a second and can fall between uniform samples
    // (a part that only twitches there would be baked still — frozen for good). So: every lane's
    // first two events ± a short window, a sustained note's middle + end, and the count-in + roll-in
    // (entrance hardware — a gate, a magnet — moves once, there). ?mergeaudit=N re-proves every bake
    // over a dense sweep (N uniform + every event ±.5 s) and lists any it gets wrong (__dev.mergeAudit).
    const EV_OFF = [-.3, -.12, -.04, 0, .04, .12, .3], EV_PER = 2;
    const fit = x => x < -LEAD_IN ? x + P0 : x;
    const sweepFor = evs => {
      const per = new Map(), out = times.slice();
      for (let x = -LEAD_IN; x < ROLL_T + 1; x += .1) out.push(x);
      for (const e of evs){ const a = per.get(e.id) || per.set(e.id, []).get(e.id); if (a.length < EV_PER) a.push(e); }
      for (const a of per.values()) for (const e of a){
        for (const o of EV_OFF) out.push(fit(e.t + o));
        if (e.d > 0) out.push(fit(e.t + e.d / 2), fit(e.t + e.d), fit(e.t + e.d + .12));
      }
      return out;
    };
    const instEvs = r => eventTimes(S.parts?.[r.I.key], { rollT: ROLL_T, beat: BEAT }).map(e => ({ t: wrapP(e.t, P0), d: e.tDur, id: String(e.note) }));
    const kitEvs = () => Object.entries(S.drums || {}).flatMap(([lane, hits]) => hits.map(normalizeHit).map(h => ({ t: wrapP(ROLL_T + h.beat * BEAT, P0), d: 0, id: lane })));
    const opt = evs => !AUDIT_N ? RIGID : { ...RIGID, audit: [...Array.from({ length: AUDIT_N }, (_, k) => -LEAD_IN + (k + .5) / AUDIT_N * (P0 + LEAD_IN)),
      ...evs.flatMap(e => Array.from({ length: 53 }, (_, k) => fit(e.t - .5 + k * .025)))] };
    mergeAudit = [];
    const audited = (key, r) => { if (r.audit?.length) mergeAudit.push({ key, parts: r.audit }); return r; };
    instLive.forEach(r => { const ev = instEvs(r); add(audited(r.I.key, mergeStatic(r.station, t => r.inst.update(t, P0, 0, RUN), sweepFor(ev), () => r.inst.update(-LEAD_IN, P0, 0, POSE0), opt(ev)))); });
    kitMerge = () => { const ev = kitEvs(); return mergeStatic(drumGroup, t => drumKit.update(t, P0, 0, RUN), sweepFor(ev), () => drumKit.update(-LEAD_IN, P0, 0, POSE0), opt(ev)); };
    if (drumGroup) add(audited('drums', kitMerge()));
  }

  // a full room is deep: thin the haze so the back tier still reads from the wide shot
  // (FogExp2 .026 at ~50 u ≈ 18 % visible; .016 ≈ 45 %)
  scene.fog.density = instLive.length ? .016 : .026;
  if (xrMode === 'ar') rooms.set('off');                // (AR passthrough: the camera feed IS the room — a song change mustn't bring one back)
  else rooms.suggest(S.room);                           // a song may name its room (data); a viewer's pick wins
  // the song's weather for the room (data): storm = beats that flash lightning, sky = [[beat,
  // 'night'|'dawn'], …] — the room reads them as pure fns of songTime (a room may ignore them)
  rooms.cue({ storm: Array.isArray(S.storm) ? S.storm.filter(Number.isFinite) : null,
              sky: Array.isArray(S.sky) ? S.sky.filter(c => Array.isArray(c) && Number.isFinite(c[0]) && typeof c[1] === 'string') : null,
              rollT: ROLL_T, beat: BEAT, P: ROLL_T + LOOP_T,
              drums: S.drums || null, melody: S.melody, loopBeats, start: ARM_AT });   // (the arena solves its pyro cues from these)
  curBuild = { S, view: stageView, wallW, P0, buildKit, kitMerge };
  placeRoom();

  audio.setBeat(BEAT);
  cam.syncTracks(tracks, stageView);                    // reframe + rebuild the cam-button row for the new song
  syncDirector(S, stageView);
  fadeMats = collectFadeMats(world); fadeWarm = 3;
  if (xrOn) for (const r of instLive) r.inst.xr?.(true);   // a song picked in the headset: its plugins open in their XR look
  // (voices soonest machine first: the bank bakes in this order within its sync budget, the rest in idle
  //  slices; once every voice exists, a song left behind frees its renders — browsing stays bounded)
  voices.sort((a, b) => a.t0 - b.t0);
  const epoch = voiceEpoch();
  audio.rebuildBank(tracks, S.drums ? Object.keys(S.drums) : [], voices,
    () => { if (voiceEpoch() === epoch) voiceCacheStat = sweepVoiceCaches(); });
  gov.hold(90);                                         // a rebuild's hitch + compiles are not the device's pace
  singlePassFlats(scene);                               // PERF (perftune.js): no 2-pass draw for flat/additive see-through parts
  // start in the COUNT-IN: songTime < 0 — the belt spins up (jugTime), every other machine sits
  // ARMED (built with start = ARM_AT), and the timeline never reaches 0 before the belt's plan is in
  // (transport.js). skipStrikes guards the first frame from retro-firing every edge it lands on
  // (same as a scrub jump). A new song plays (STOP is per song).
  songTime = -LEAD_IN; loopIndex = -1; skipStrikes = true;
  setPlaying(true);
  if (started) clock.start();
  editor.built();
}
/* THE STAR of the stage (stations.js STAR — front and centre): the song's SIGNATURE machine, exactly
   as the director will name it (syncDirector: song.director.signature — a station or its shot key,
   false for none — else, for an import, directorplan signatureOf over every station's cue, a chord
   one moment). A floor station or the kit; a hung one keeps hanging (null). Pure song data. */
function stageStar(S){
  const cs = stationCues(S), sig = songSignature(S, cs), key = sig && cs.find(c => c.key === sig)?.owner;
  return key && !instLive.find(r => r.I.key === key)?.slot.hang ? key : null;
}
/* THE SIGNATURE (directorplan signatureOf) — ONE answer for the room solve (stageStar) and the
   director (syncDirector): song.director.signature names it (a station key or its shot key) or false
   for none; an IMPORT (no curator: staging 'auto') reads it off the song data — the hook. → a cue key */
function songSignature(S, cs){
  const cfg = S.director?.signature;
  if (typeof cfg === 'string') return cs.find(c => c.key === cfg || c.owner === cfg)?.key ?? null;
  if (cfg === false || S.staging !== 'auto' || !tracks.length) return null;
  return signatureOf(cs.map(c => ({ key: c.key, hits: c.cue, ...(c.perc ? { perc: true } : {}) })), dirGrid(S));
}
/* the edit's beat grid: from the loop's first beat to the engine's seam (no music, no lead marble —
   seamFrom), song.barBeats the meter's bar (Mars is 5/4: the edit prefers its bar lines) */
function dirGrid(S){
  const lead = tracks[0];
  return { t0: ROLL_T, beat: BEAT, end: lead.rollT + lead.total - .7, loop: ROLL_T + LOOP_T,
    bar: Number.isInteger(S.barBeats) && S.barBeats >= 2 && S.barBeats <= 16 ? S.barBeats : 4 };
}
/* every station's CUE as the director reads it (+ the kit's: perc), keyed by its SHOT key (owner = the
   plugin key) — loop-local times, a chord one moment (chordMoments) */
function stationCues(S){
  const P = ROLL_T + LOOP_T;
  const cs = instLive.map(rig => ({ key: rig.I.cameraKey ?? rig.I.key, owner: rig.I.key, cue: chordMoments(rig.cue) }));
  if (S.drums){
    const cue = [];
    Object.entries(S.drums).forEach(([lane, hits]) => hits.map(normalizeHit).forEach(h =>
      cue.push({ t: wrapP(ROLL_T + h.beat * BEAT, P), w: h.vel, id: lane })));
    cs.push({ key: 'drums', owner: 'drums', cue: chordMoments(cue), perc: true });
  }
  return cs;
}
/* A CHORD is one moment, not N: simultaneous hits on one station merge into one (the loudest + a
   little for the rest) — or a pad that strikes 4-note chords reads as 4× busy. Its id: the chord's
   pitch heads, sorted (a riff's E5 power chord and its palm-muted chug are one shape) */
function chordMoments(cue){
  const byT = new Map();
  for (const e of cue){ const k = Math.round(e.t * 500); const g = byT.get(k); if (g) g.push(e); else byT.set(k, [e]); }
  return [...byT.entries()].sort((a, b) => a[0] - b[0]).map(([k, es]) => {
    const ws = es.map(e => e.w), mx = Math.max(...ws), sum = ws.reduce((a, b) => a + b, 0);
    return { t: k / 500, w: mx + .3 * (sum - mx), id: [...new Set(es.map(e => String(e.id ?? '').replace(/[:|].*$/, '')))].sort().join('+') };
  });
}
/* THE ROOM'S ANCHORS (rooms/index.js): what stands where this song, in world space — the belt
   (fixed: its own posts to the floor), the kit and every floor station: its footprint (x, z, yaw,
   w, d), its deck y (ground + lift), the world y it stands on (bottom — a `stand` hint's underside,
   the kit's deck slab, else its lowest solid part) and the lowest it reaches (low: the kit's pistons
   at their deepest), its solid box, and its strike CUE
   (loop times + weights; P, start) — so the room can plant a plinth / riser / scaffold under each
   (rooms/footing.js) and answer its strikes; an open stand's feet + hang (standParts). A HUNG station
   is an anchor too ('hung': no footing — its solid box is an obstacle a stair or a prop keeps out of).
   Re-sent on every staging change (restage). */
function placeRoom(){
  const { S, view } = curBuild, P = ROLL_T + LOOP_T, run = { P, start: ARM_AT };
  const out = [];
  if (!stageWall.isEmpty()){
    const w = stageWall;
    out.push({ key: 'belt', kind: 'belt', label: 'Belt', color: '#ffaa55', x: (w.min.x + w.max.x) / 2, z: (w.min.z + w.max.z) / 2, yaw: 0,   // (the lead ball's glow)
      w: w.max.x - w.min.x, d: w.max.z - w.min.z, y: ROOM.FLOOR, ground: ROOM.FLOOR, lift: 0, bottom: ROOM.FLOOR, low: w.min.y,
      box: [w.min.x, w.max.x, w.min.y, w.max.y, w.min.z, w.max.z], cue: loopCue(beltHits(), P), ...run, fixed: true });
  }
  if (S.drums && drumGroup){
    const a = kitAnchor(view.cx, kitSlot), lift = kitLift(), K = kitOrigin();
    out.push({ key: 'drums', kind: 'kit', label: 'Drum Machine', color: '#ff8a3d', x: a.x, z: a.z, yaw: 0, w: a.w, d: a.d,
      y: kitSlot.y, ground: kitSlot.y - lift, lift, bottom: kitSlot.y + KIT_STAND, low: kitSlot.y + Math.min(KIT_STAND, kitLoc ? kitLoc.min.y : 0),
      box: kitLoc ? [kitLoc.min.x + K.x, kitLoc.max.x + K.x, kitLoc.min.y + K.y, kitLoc.max.y + K.y, kitLoc.min.z + K.z, kitLoc.max.z + K.z] : null,
      cue: loopCue(kitHits(S), P), ...run, fixed: false });
  }
  for (const r of instLive){
    if (r.slot.hang){
      const b = solidBox(r.station, drawn);
      if (b) out.push({ key: r.I.key, kind: 'hung', label: r.I.label, color: r.I.color ?? null, x: (b[0] + b[1]) / 2, z: (b[4] + b[5]) / 2, yaw: 0,
        w: b[1] - b[0], d: b[5] - b[4], y: r.station.position.y, ground: null, lift: 0, bottom: b[2], low: b[2], box: b, cue: loopCue(r.cue, P), ...run, fixed: true });
      continue;
    }
    const st = r.station, L = r.loc, deck = st.position.y;
    const c = L ? st.localToWorld(new THREE.Vector3((L.min.x + L.max.x) / 2, 0, (L.min.z + L.max.z) / 2)) : st.position;
    out.push({ key: r.I.key, kind: 'station', label: r.I.label, color: r.I.color ?? null, x: c.x, z: c.z, yaw: st.rotation.y,
      w: L ? L.max.x - L.min.x : r.slot.w, d: L ? L.max.z - L.min.z : r.slot.d, y: deck, ground: r.ground, lift: r.lift,
      bottom: deck + standOf(r), low: deck + r.low, box: L ? worldBox(L, st) : null, cue: loopCue(r.cue, P), ...run, fixed: false,
      ...(r.stand ? { feet: r.stand.feet, hang: r.stand.hang } : {}) });
  }
  rooms.place(lastAnchors = out);
}
/* RCT-style HEIGHT, live: a floor station's lift is a rigid y-move (it has no legs to regrow); the
   kit is rebuilt at its new deck (restage — its contacts are world). Re-anchors the room and
   re-solves the director's shots. Returns the machine's new deck y (null: no such machine). */
function setLift(key, u){
  const lift = clampLift(+u);
  devLift[key] = lift;                                  // (and for this page's next builds)
  if (key === 'drums'){
    if (!drumGroup || !curBuild?.S.drums) return null;
    kitSlot = { ...kitSlot, lift }; restage(); return kitSlot.y;
  }
  const r = instLive.find(q => q.I.key === key && !q.slot.hang);
  if (!r) return null;
  r.slot.lift = lift; r.setLift(lift); restage();
  return r.station.position.y;
}
/* the underside a station RESTS on (local y): its descriptor's `stand` hint (the turntable stands on
   its plinth's feet, its resonator rank hanging below) — else its lowest solid part */
const standOf = r => Number.isFinite(r.I.stand) ? Math.max(r.I.stand, r.low) : r.low;
/* the kit's own origin this song (marbledrums.js builds it there: its contacts are world) */
const kitOrigin = (cx = curBuild?.view.cx ?? 0) => ({ x: cx + kitSlot.x, y: kitSlot.y, z: kitSlot.z });
/* a machine's strikes as the ROOM reads them: sorted loop times, one per instant (a chord is one
   strike — its loudest), weights 0..1 */
function loopCue(hits, P){
  const byT = new Map();
  for (const h of hits){
    const t = wrapP(h.t, P), k = Math.round(t * 500), w = Math.max(0, Math.min(1, h.w ?? 1)), o = byT.get(k);
    if (!o) byT.set(k, { t, w }); else if (w > o.w) o.w = w;
  }
  return [...byT.values()].sort((a, b) => a.t - b.t);
}
/* the belt's strikes: the juggler plan's plates (src/juggle.js — every note struck exactly on its
   time; a plan still being solved strikes the same notes: its layout's) */
const beltHits = () => (jplan?.voices || []).flatMap(V => V.plates ? V.plates.map(p => ({ t: p.s, w: p.vel ?? 1 })) : V.notes.map(q => ({ t: q.s, w: q.vel ?? 1 })));
const kitHits = S => Object.values(S.drums || {}).flatMap(hits => hits.map(normalizeHit).map(h => ({ t: ROLL_T + h.beat * BEAT, w: h.vel })));
/* STAGE EDIT moved a station (src/editor/stage-edit.js moved its group: a rigid render-time move
   of an already-solved world — supports already reach the flat floor), or a machine's LIFT changed
   (__dev.lift: a station is moved rigidly first). Re-anchor the room and re-solve the director's
   shots from where things now stand. A dragged or lifted KIT is rebuilt at its new slot (its
   contacts are world-space). No re-solve of any physics; songTime runs on. */
function restage({ director = true } = {}){            // (director: false — stage edit re-solves it once, on the way out)
  if (!curBuild) return;
  const { S, view, P0, buildKit, kitMerge } = curBuild;
  const dx = drumGroup?.position.x || 0, dz = drumGroup?.position.z || 0;
  // (a kit DRAGGED takes the DRUM RISER's rise where it now stands — on the right wing while the band plays,
  //  else none — exactly as the room solve will give its pinned spot on a reload: stations.js kitRiseAt)
  if (drumGroup && (dx || dz) && lastLayout) kitSlot = { ...kitSlot, rise: kitRiseAt(view.cx + kitSlot.x + dx, kitSlot.z + dz,
    instLive.filter(r => !r.slot.hang).map(r => r.I.key), [lastLayout.wall.min.x, lastLayout.wall.max.x, lastLayout.wall.min.z, lastLayout.wall.max.z], { cx: lastLayout.cx }) };
  const deck = kitDeck();
  if (drumGroup && (dx || dz || Math.abs(deck - kitSlot.y) > 1e-6)){
    kitSlot = dx || dz ? { ...kitSlot, x: kitSlot.x + dx, z: kitSlot.z + dz, pin: true, y: deck } : { ...kitSlot, y: deck };
    world.remove(drumGroup); disposeTree(drumGroup);
    drumGroup = buildKit(); world.add(drumGroup);
    if (kitMerge) kitMerge();                           // (the build's own bake: its strike sweep + rest pose)
    else if (!NO_MERGE){
      const times = Array.from({ length: 48 }, (_, k) => -LEAD_IN + (k + .37) / 48 * (P0 + LEAD_IN));
      mergeStatic(drumGroup, t => drumKit.update(t, P0, 0, { started: true, skipStrikes: true, onStrike(){} }), times);
    }
    drumKit.update(songTime, P0, 0, { started, skipStrikes: true, onStrike(){} });
  }
  instLive.forEach(r => r.station.updateMatrixWorld(true));
  placeRoom();
  if (director) syncDirector(S, view);
  fadeMats = collectFadeMats(world); fadeWarm = 3;
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
/* A belt strike (jugglebelt: the timeline crossing a plate's strike time): its juice and voice —
   ripple on the plate, sparks at the ball, the lead's punch, its note. */
function juggleStrike(h){
  const look = h.look;
  if (devStrikes){ const d = devStrikes['belt:' + h.role] ||= { n: 0, ids: {}, unbaked: [], at: [] }; d.n++; d.ids[h.note] = (d.ids[h.note] || 0) + 1; d.at.push(+songTime.toFixed(3)); }
  if (h.role === 'lead') noteEl.innerHTML = `<b>${h.note}</b>&nbsp; ·&nbsp; ${'·'.repeat(Math.min(h.k, 40))}`;
  spawnRipple(h.surf, h.quat, h.hue, h.role === 'bass', h.amp * look);
  spawnBurst(h.pos, new THREE.Color().setHSL(h.hue, .85, .62),
             Math.max(2, Math.round(Math.min(5 + Math.round(h.dt * 7), 16) * look)),
             (2.4 + Math.min(h.dt * 1.6, 3)) * (.6 + .4 * look));
  if (h.role === 'lead'){
    cam.addShake((.04 + h.dt * .05) * h.vel);
    expoKick = Math.max(expoKick, look);
  }
  if (audio.isReady() && !muted && !devMute?.has('belt')){
    try { audio.playNote(h.note, h.deep, placeAt(h.pos), h.vel); } catch(e){ /* audio must never break the run */ }
  }
}
/* …and a ball docking on its carriage's magnet: the CLACK */
function juggleDock(d){
  spawnBurst(d.pos.clone().add(new THREE.Vector3(0, d.r, 0)), new THREE.Color(0xff7a3a), 10, 2.2);
}

/* A drum ball reaching its head: sparks + the percussion voice (the head ripple,
   flash, piston and strike light are the machine's own). The KICK hits the room:
   the cannonball landing shakes the camera and punches the exposure. */
const _kc = new THREE.Vector3();
function drumStrike(hit){
  // a CHOKE (the cymbal's magnet clamp grabbed it — marbledrums' timeline edge): cut its sound
  if (hit.choke){ if (audio.isReady()) try { audio.chokeDrum(hit.lane); } catch(e){} return; }
  // a closed hat strike is the pedal CHICKING the pair shut: an open hat still ringing stops
  if (hit.lane === 'hat' && audio.isReady()) try { audio.chokeDrum('hatOpen'); } catch(e){}
  if (devStrikes){ const d = devStrikes.drums ||= { n: 0, ids: {}, unbaked: [], at: [] }; d.n++; d.ids[hit.lane] = (d.ids[hit.lane] || 0) + 1; if (d.at.length < 64) d.at.push(+songTime.toFixed(3)); }
  // (+ the kit group's offset: a kit moved live in stage edit rides it until it is rebuilt at its new slot)
  const c = drumGroup ? _kc.copy(hit.drum.contact).add(drumGroup.position) : hit.drum.contact, v = hit.vel ?? 1;
  spawnBurst(c.clone().add(UP), new THREE.Color(hit.drum.style.ball),
             Math.round(5 + 7 * v), 3.0);
  if (hit.lane === 'kick'){
    cam.addShake(.05 + .05 * v);
    expoKick = Math.max(expoKick, .8 * v);
  }
  if (audio.isReady() && !muted && !devMute?.has('drums')){
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
  });
  if (S.drums){
    const kx = view.cx + kitSlot.x, kz = kitSlot.z;     // the kit's slot this song (marbledrums.js)
    // eye a touch right of the kit's centre + aim raised: keeps the belt wall's edge
    // rail (a bloom streak at the old angle) out of the top-left of the frame
    // (the eye rides ABOVE the kit's magnet rail: from rail height the chrome bar slices the frame)
    const ky = kitSlot.y;                               // (its deck: on the floor's plinth, or lifted)
    shots.push({ key: 'drums', owner: 'drums', color: '#ff8a3d', self: drumGroup, aim: new THREE.Vector3(kx, ky + 2.1, kz - 2.5), eye: new THREE.Vector3(kx + 1, ky + 10, kz + 12.5) });
  }
  cues = stationCues(S);                                // (every station's + the kit's cue, a chord one moment)
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
  // Held for holdBeats (≥ .35 s): fixed points the solved edit builds around. A script that
  // runs past the last note OWNS the breath (and may wrap into the roll-in): without one the
  // seam is the wide 'stage' shot (directorplan shotAt).
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
    w: (.5 + Math.min(1.5, Math.max(0, pd.dt - 1) * .6) + (pd.dt <= .15 ? .4 : 0)) * (.5 + .5 * (pd.vel ?? 1)) })));   // (a pp line pulls less)
  // RIDES: the long, tall flights the camera may ride (ridecam.js) — sparingly, and never for a
  // reduced-motion viewer (the manual RIDE button stays theirs to pick)
  rides = reduceMotion ? [] : rideMoments(flightsOf(P));
  const voices = [...cues.map(c => ({ key: c.key, hits: c.cue, weight: dirWeight(S, c.owner), ...(c.perc ? { perc: true } : {}) })),   // (the song's pull only:
                  // salience is relative to each machine's own norm, so sparse voices need no boost)
                  { key: 'belt', belt: true, hits: beltHits, weight: dirWeight(S, 'belt') }];
  const grid = dirGrid(S);                              // (end = seamFrom, loop = P)
  // THE SIGNATURE (songSignature): the machine the song is about earns the edit's biggest share —
  // the same one the room solve stood front and centre (stageStar)
  const sig = songSignature(S, cues);
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
  // THE GALLERY STAR: when the machine the song is about (its signature, or the station its
  // director pulls clearly hardest for) stands up on the rear gallery, the wide comes round to
  // ITS side — it is the farthest machine in the hall, the one a fitted wide shrinks the most
  const star = full ? galleryStar(S, sig) : null;
  const wide = full
    ? { ...searchWide(stageFrame(), star ? starDirs(star).concat(WIDE_DIRS) : galleryUp() || bandOn() ? GALLERY_DIRS.concat(WIDE_DIRS) : WIDE_DIRS, 1.6, .94, WIDE_UI, star, WIDE_LENSES), fitMax: 1,
        // a phone held upright can't fit the room's width — so it frames the PROTAGONISTS (the
        // belt band → top housing, the chandelier, the turntable's record) down a diagonal, with
        // the title/song-select block's height kept clear at the top (PORTRAIT_INSET); the wings
        // enter from the frame edges as context
        //  (a floor STAR — stations.js — is a protagonist too: kept clear of the bottom button bar)
        portrait: { ...searchWide(stageFrame(true), PORTRAIT_DIRS, .5, .92, { top: PORTRAIT_INSET, ...(lastLayout?.star ? { bottom: UI_BOTTOM } : {}) }), fov: WIDE_FOV, fitMax: 1 } }
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
/* ---- RIDE THE BALL (ridecam.js): every belt flight's launch, duration and apex, from the
   juggler's plan. Static song data: solved once per song. ---- */
let rides = [], rideWins = [], rideEvery = 1, rideDbg = null;          // (rideDbg: __dev.ride — the last pose's raw solve)
function flightsOf(P){                                  // (every flight runs strike line → strike line: apex = g·F²/8)
  return tracks.flatMap(tr => (tr.V.segs || []).filter(q => q.kind === 'flight' && q.t1 - q.t0 >= RIDE.DT_MIN)
    .map(q => ({ t: wrapP(q.t0, P), dt: q.t1 - q.t0, apex: -G.y * (q.t1 - q.t0) ** 2 / 8, role: tr.role })));
}
/* The ride pose at songTime st — a pure fn of it. directed: inside a planned ride window only
   (eased in/out of the chase); else the manual RIDE mode on the lead. The marble path is ONE ball
   of the juggler's plan (ballAt — every ball is conserved, so the path runs the whole loop; the
   new loop's first frame is a cut). Guarded: never inside a machine, nor out through the room. */
const _rE = new THREE.Vector3(), _rA = new THREE.Vector3();
const _ride = { eye: new THREE.Vector3(), aim: new THREE.Vector3(), fov: RIDE.FOV };
function rideCam(st, directed){
  if (!started || st < 0 || !tracks.length) return null;
  const P = ROLL_T + LOOP_T, now = wrapP(st, P), base = st - now;
  let win = null, tr = tracks[0];
  if (directed){
    const w = rideWindowAt(rideWins, now); if (!w || Math.round(base / P) % rideEvery) return null;
    win = { t0: base + w.t0, t1: base + w.t1 }; tr = tracks.find(t => t.role === w.role) || tr;
  }
  // ride ONE ball of the plan: the one on the window's longest flight (manual RIDE: the ball that flies most)
  const V = tr.V, w0 = win && win.t0 - base, w1 = win && win.t1 - base;
  if (!V.pieces) return null;                           // (still being solved: nothing to ride)
  const f = win && V.segs.filter(q => q.kind === 'flight' && q.t1 > w0 && q.t0 < w1).sort((a, b) => (b.t1 - b.t0) - (a.t1 - a.t0))[0];
  const b = f ? f.ball : busiestBall(V), oy = STAGE_Y + UP.y;
  const path = s => { const q = jBallAt(V, b, base + Math.min(P - 1e-3, Math.max(0, s - base))); return [q.x, q.y + oy, q.z]; };
  const r = ridePose(path, st, win, RIDE, camera.aspect);
  rideDbg = { raw: r, ball: path(st), tr: tr.role, win };
  const eye = _rE.fromArray(r.eye), aim = _rA.fromArray(r.aim);
  // never inside a machine (step toward the marble until clear) nor out through the room
  const inBox = () => followRig.boxes.some(b => eye.x > b[0] - .6 && eye.x < b[1] + .6 && eye.y > b[2] - .6 && eye.y < b[3] + .6 && eye.z > b[4] - .6 && eye.z < b[5] + .6);
  for (let k = 0; k < 8 && inBox(); k++) eye.lerp(aim, .25);
  const rm = eyeRoom();
  eye.set(Math.min(rm.x1, Math.max(rm.x0, eye.x)), Math.min(rm.y1, Math.max(rm.y0, eye.y)), Math.min(rm.z1, Math.max(rm.z0, eye.z)));
  _ride.eye.copy(eye); _ride.aim.copy(aim);
  return _ride;
}
/* VR teleport pads (src/xrplan.js): every solved shot eye + the wide + one at the belt, kept
   clear of every machine's box. Cheap (no rays) — re-run whenever the director re-solves. */
function xrAnchors(){
  xrLitAge = 0;                                         // (a new world: re-collect its lights for xrRender)
  const box = o => { const b = visBox(o); return b.isEmpty() ? null : [b.min.x, b.max.x, b.min.y, b.max.y, b.min.z, b.max.z]; };
  const belts = tracks.filter((tr, i) => tracks.findIndex(q => q.machine.group === tr.machine.group) === i).map(tr => { const b = box(tr.machine.group) || box(tr.stage);
    return b && { role: tr.role, x: (b[0] + b[1]) / 2, z0: b[4], z1: b[5], bandY: STAGE_Y }; }).filter(Boolean);
  const solids = [...instLive.map(r => box(r.station)), drumGroup && box(drumGroup), ...[...new Set(tracks.map(tr => tr.machine.group))].map(box),
    ...rooms.footBoxes.map(e => e.box)].filter(Boolean);   // (+ what they stand on: a pad never lands in a tower)
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
  return { world, roomGroup: rooms.group, footGroup: rooms.footGroup, belts: new Set(tracks.map(t => t.stage)), stageY: STAGE_Y, room: eyeRoom(), camera, drawn,
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
/* the song raised a floor machine well off the floor: onto the rear GALLERY (stations.js
   layoutStations), or the user lifted it (a layout entry's lift — rooms/footing.js) */
const galleryUp = () => instLive.some(r => !r.slot.hang && r.lift > 2);
/* …or the BAND plays (a gallery-born station — riff / strum / horns / pogo, stations.js — wherever it
   stands: floor first, so mostly on the floor now): its wide is the same low one from the stalls */
const bandOn = () => instLive.some(r => !r.slot.hang && r.slot.gallery);
function stageFrame(core = false){
  const pts = [], add = (x0, x1, y0, y1, z0, z1) => { for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) pts.push(new THREE.Vector3(x, y, z)); };
  if (!stageWall.isEmpty()) add(stageWall.min.x, stageWall.max.x, STAGE_Y - 3, stageWall.max.y, stageWall.min.z, stageWall.max.z);
  if (core){                                             // portrait: the belt, the hung plates, the record (+ the STAR)
    instLive.forEach(r => {
      if (!r.slot.hang && r.I.key !== 'turntable' && r.I.key !== lastLayout?.star) return;
      const b = visBox(r.station), p = r.station.position;
      if (b.isEmpty()) return;
      if (r.slot.hang) add(b.min.x, b.max.x, hangLow(r.station), Math.min(b.max.y, p.y + 13), b.min.z, b.max.z);
      else if (r.I.key === lastLayout?.star) add(b.min.x, b.max.x, p.y, b.max.y, b.min.z, (b.min.z + b.max.z) / 2);   // (the star whole, its back half)
      else add(b.min.x, b.max.x, p.y, p.y + 1, b.min.z, (b.min.z + b.max.z) / 2);
    });
    return pts;
  }
  const front = 13;                                      // a footprint centred past this z is the front row
  const floorBox = (b, deckY, whole = false) => {
    const y0 = Math.max(b.min.y, deckY - 1.5), zc = (b.min.z + b.max.z) / 2;
    add(b.min.x, b.max.x, y0, b.max.y, b.min.z, zc > front && !whole ? zc + FRONT_KEEP * (b.max.z - zc) : b.max.z);
  };
  instLive.forEach(r => {
    const b = visBox(r.station), p = r.station.position;
    if (b.isEmpty()) return;
    if (r.slot.hang) add(b.min.x, b.max.x, p.y + 1, Math.min(b.max.y, p.y + 13), b.min.z, b.max.z);   // plates + canopy, not the rods
    else floorBox(b, p.y, r.I.key === lastLayout?.star);          // (the STAR — stations.js — is held WHOLE: its keys, its lip)
  });
  if (drumGroup){ const b = visBox(drumGroup); if (!b.isEmpty()) floorBox(b, kitSlot.y - .5); }
  return pts;
}
/* Fit a shot to `pts`: look along −dir (dir = unit aim→eye), centre the points in frame and
   back off just far enough that all of them fit `fill` of the frame at `aspect` — then pull
   in so the eye stays inside the room (whatever then falls outside crops). */
const WIDE_FOV = 68;                                    // the wide's lens (camera.js eases into it)
/* …widened (to ≤ 80°) only when the room's walls would otherwise crop a LOW eye: a big hall (ten
   machines, a raised gallery) then keeps the concert-film angle instead of climbing to a top-down
   one to back off. LENS_COST per degree: 5° of lens ≈ one step down the direction list. */
const WIDE_LENSES = [WIDE_FOV, 74, 80], LENS_COST = .004;
const dirOf = (x, y, z) => new THREE.Vector3(x, y, z).normalize();
/* the wide's candidate directions (unit aim → eye), preferred first: a LOW front-left three-
   quarter (the hall reads as a machine-hall, not a floor plan), then steeper / squarer */
const WIDE_DIRS = [[-.15, .43, .89], [-.08, .5, .89], [-.22, .5, .86], [0, .55, .85], [-.15, .62, .8], [.1, .55, .85], [-.3, .58, .8]].map(d => dirOf(...d));
/* …and when the song raised machines onto the rear GALLERY (or the band plays, bandOn): a LOWER eye
   first (a concert-film wide — from the stalls, the riser reads as a riser, not a floor plan seen
   from the lighting rig) */
const GALLERY_DIRS = [[-.15, .26, .95], [-.08, .3, .95], [-.22, .3, .93], [-.15, .35, .92]].map(d => dirOf(...d));
/* the gallery star's candidates: the low wide swung round toward its side (mirrored for a star
   right of the belt), the wider swings first-to-last; STAR_PULL: how much the star's size in
   frame (screenSize, ≈ .1–.3) may outweigh the candidate order (.02 a step) */
const STAR_DIRS = [[-.2, .26, .94], [-.32, .26, .91], [-.44, .26, .86], [-.32, .34, .88]];
const STAR_PULL = .6;
//  (a star ON the belt's centre line — the floor star — swings from the house side, the left: the kit stands right)
const starDirs = box => { const c = box[0] + box[1] - (stageWall.isEmpty() ? 0 : stageWall.min.x + stageWall.max.x), m = c > 2 ? -1 : 1;
  return STAR_DIRS.map(([x, y, z]) => dirOf(x * m, y, z)); };
function galleryStar(S, sig){
  let key = sig ? cues.find(c => c.key === sig)?.owner : null;
  if (!key){                                             // the station the song's director pulls clearly hardest for
    const w = instLive.map(r => [r.I.key, dirWeight(S, r.I.key)]).sort((a, b) => b[1] - a[1]);
    if (w.length && w[0][1] >= 2 && w[0][1] - (w[1]?.[1] ?? 1) >= .3) key = w[0][0];
  }
  const r = key && instLive.find(q => q.I.key === key);
  // (only a GALLERY / lifted machine is far enough to need it — or the room solve's floor STAR, front and
  //  centre: the wide swings a three-quarter round it, never dead head-on down the belt's axis)
  if (!r || r.slot.hang || !(r.lift > 2 || r.I.key === lastLayout?.star)) return null;
  const b = visBox(r.station);
  return b.isEmpty() ? null : [b.min.x, b.max.x, Math.max(b.min.y, r.station.position.y - 1.5), b.max.y, b.min.z, b.max.z];
}
const PORTRAIT_DIRS = [[.45, .36, .82], [.3, .4, .87], [.6, .33, .74], [.15, .42, .9], [-.2, .42, .89], [.45, .5, .76], [0, .5, .87], [-.4, .42, .82]].map(d => dirOf(...d));
const PORTRAIT_INSET = .13;                             // the top of a phone frame belongs to the title + song select
const WIDE_UI = { top: .03, bottom: UI_BOTTOM };      // a desktop wide is fitted ABOVE the button row (the front row's decks no longer run under it)
const _occRay = new THREE.Raycaster();
/* fit each candidate direction; score = how much the room clamp crops (1 − k) + how much of
   the strike band other machines hide from the eye. First candidate that is clean wins. */
function searchWide(pts, dirs, aspect, fill, ui, star = null, lenses = [WIDE_FOV]){
  const band = [];
  if (!stageWall.isEmpty()) for (let i = 0; i <= 6; i++) for (const dy of [0, 2.5])
    band.push(new THREE.Vector3(THREE.MathUtils.lerp(stageWall.min.x + 1.5, stageWall.max.x - 1.5, i / 6), STAGE_Y + dy, (stageWall.min.z + stageWall.max.z) / 2));
  const belt = new Set(tracks.map(t => t.stage)), foot = rooms.footGroup;
  const top = o => { while (o.parent && o.parent !== world) o = o.parent; return o; };
  const shown = o => { for (let p = o; p && p !== world; p = p.parent) if (!p.visible) return false; return true; };
  let best = null; const tried = [];
  dirs.forEach((d, i) => {
    // (a lens per direction: the house lens, or — when the room's walls would crop a low eye — a
    //  wider one, before the search has to climb to a steeper, top-down angle to back off)
    let f, fov;
    for (fov of lenses){ f = fitShot(pts, d, aspect, fill, fov, ui); if (f.k >= .995) break; }
    let blocked = 0;
    for (const q of band){
      const v = q.clone().sub(f.eye), L = v.length();
      _occRay.set(f.eye, v.divideScalar(L)); _occRay.far = L - .5; _occRay.camera = camera;
      if (_occRay.intersectObject(world, true).some(h => (h.object.isMesh || h.object.isInstancedMesh) && shown(h.object) && !belt.has(top(h.object)))
       || _occRay.intersectObject(foot, true).some(h => drawn(h.object) && !glowy(h.object.material))) blocked++;   // (the machines' towers too)
    }
    // (a gallery STAR: how big the song's star machine reads from here — a nearer angle on it wins)
    const sz = star ? screenSize(f.eye.toArray(), f.aim.toArray(), star, fov, aspect) : 0;
    const score = (1 - f.k) * 3 + (band.length ? blocked / band.length : 0) * 2 + i * .02 + (fov - WIDE_FOV) * LENS_COST - sz * STAR_PULL;
    tried.push([i, +score.toFixed(3), +f.k.toFixed(2), blocked, +sz.toFixed(3), fov]);   // (__dev.wide.tried: the search, for the audit)
    if (!best || score < best.score) best = { ...f, score, dir: i, blocked, star: +sz.toFixed(3), fov };
  });
  return { ...best, tried };
}
function fitShot(pts, dir, aspect, fill = .94, fov = camera.fov, ui = {}){
  // (the room box — the smallest room's walls, STAGE — with room for the director's slow orbit drift)
  const pad = 1.5, room = { x0: -ROOM.HW + pad, x1: ROOM.HW - pad, y0: ROOM.FLOOR + pad, y1: ROOM.CEIL - pad, z0: ROOM.BACK + pad, z1: ROOM.FRONT - pad };
  const f = fitWide(pts.map(p => p.toArray()), dir.toArray(), { aspect, fov, fill, top: ui.top || 0, bottom: ui.bottom || 0, room });
  return { aim: new THREE.Vector3().fromArray(f.aim), eye: new THREE.Vector3().fromArray(f.eye), k: f.k };
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
   its tutti. A number is the voice's bank GAIN (audio.js applies it as it wraps the render:
   the live AudioBuffer and the iOS WAV, which keeps the render's level — src/wavlevel.js;
   it used to peak-normalise, silently undoing this), so it holds on the iOS sample path
   too; a step envelope bakes its loudest step and scales each hit by step/loudest
   on the webaudio path (iOS plays every sample full — §5). No `mix` → unity, unchanged. */
function partMix(S, key){
  const m = S.mix?.[key], g01 = v => Math.max(0, Math.min(1, v));   // share links are untrusted: clamp, never amplify
  if (Number.isFinite(m)) return { base: g01(m), at: () => 1 };
  if (!Array.isArray(m) || !m.length || !m.every(s => Array.isArray(s) && Number.isFinite(s[0]) && Number.isFinite(s[1])))
    return { base: 1, at: () => 1 };
  const base = g01(Math.max(...m.map(s => s[1])));
  return { base, at: beat => { let g = m[0][1]; for (const [b, v] of m) if (beat >= b) g = v; return base > 0 ? g01(g) / base : 0; } };
}
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
  if (devStrikes){ const k = rig.I.key, d = devStrikes[k] ||= { n: 0, ids: {}, unbaked: [], at: [] };
    d.n++; d.ids[hit.note] = (d.ids[hit.note] || 0) + 1; if (d.at.length < 64) d.at.push(+songTime.toFixed(3));
    if (!audio.hasVoice(`inst:${k}:${hit.note}`) && !d.unbaked.includes(hit.note)) d.unbaked.push(hit.note); }
  if (audio.isReady() && !muted && !devMute?.has(rig.I.key)){
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
/* the director, while stage edit is open: nothing frames a shot (the eye is free), so a move / a height
   gesture re-anchors the room only and marks this build's edit STALE — re-solved once, on the way out */
let edStale = null;                                     // the build (curBuild) whose director is behind its stage
/* the height the ROOM SOLVE gave a floor station (its gallery raise, or 0) — while it still stands where
   that solve put it (moved since: null — only a fresh solve can say) */
function autoLiftOf(r){
  const s = lastLayout?.solved?.[r.I.key], p = r.station.position;
  if (!s || Math.abs(s.x - p.x) > 1e-3 || Math.abs(s.z - p.z) > 1e-3) return null;
  return s.y === undefined ? (s.lift || 0) : Math.max(0, s.y - r.ground);   // (s.lift: a tiered riser — stations.js)
}
const editor = makeEditor({ THREE, scene, cam, dom: renderer.domElement, songs: SONGS,
  machines: INSTRUMENTS.map(I => ({ key: I.key, label: I.label, color: I.color })),
  host: {
    key: () => sel.value,
    rebuild(keepTime){ const t = songTime, was = playing; buildWorld(sel.value); if (keepTime && started){ songTime = t; skipStrikes = true; if (!was) setPlaying(false); }
      audio.primeSamples(); audio.showState(); },        // (called from a tap/change: a gesture — §5)
    restage(o){ restage(o); if (o?.director === false) edStale = curBuild; },
    /* leaving stage edit: the director catches up with every move / height made in it (once) */
    // (a frame after the editor has closed — the DONE tap answers at once; a rebuild in between re-solved it anyway)
    directorNow(){ const b = edStale; edStale = null; if (b) requestAnimationFrame(() => setTimeout(() => { if (b === curBuild && !editor.stage.on) syncDirector(b.S, b.view); else if (b === curBuild) edStale = b; }, 0)); },
    pieces: () => [
      ...instLive.filter(r => !r.slot.hang).map(r => ({ key: r.I.key, label: r.I.label, color: r.I.color, obj: r.station, kind: 'station', canRotate: true })),
      ...(drumGroup && curBuild?.S.drums ? [{ key: 'drums', label: 'Drum Machine', color: '#ff8a3d', obj: drumGroup, kind: 'kit', canRotate: false,
        deckY: kitSlot.y }] : []),
    ],
    wall: () => stageWall, cx: () => curBuild?.view.cx ?? 0,
    // the HEIGHT the user gave a machine (rooms/footing.js lift: a layout entry's, or __dev.lift / ?lift=) —
    // never the room solve's gallery raise (rig.lift): a stage move keeps it in the layout (src/editor)
    lift(key){
      const u = key === 'drums' ? kitSlot.lift : instLive.find(r => r.I.key === key && !r.slot.hang)?.slot.lift;
      return Number.isFinite(u) ? clampLift(u) : undefined;
    },
    /* RCT HEIGHT — stage edit's height handle (src/editor/height.js). A floor machine's height NOW, as the
       room was last told it (the anchors: live while a lift runs): its lift (the user's, or the gallery
       raise), the user's own (undefined: the layout decides), its deck, the world y it stands on (bottom),
       its top, the floor + ceiling, an open stand. null: the belt / a hung station — nothing to give.
       (Read every frame while editing: written into `out`, found by a plain loop — no garbage.) */
    height(key, out = {}){
      let a = null;
      for (const q of lastAnchors) if (q.key === key){ a = q; break; }
      if (!a || a.kind === 'belt' || a.kind === 'hung') return null;
      let u = kitSlot.lift;
      if (key !== 'drums'){ u = undefined; for (const r of instLive) if (r.I.key === key && !r.slot.hang){ u = r.slot.lift; break; } }
      out.lift = a.lift; out.user = Number.isFinite(u) ? clampLift(u) : undefined; out.deck = a.y; out.bottom = a.bottom;
      out.top = a.box ? a.box[3] : a.y + 3; out.floor = ROOM.FLOOR; out.ceil = ROOM.CEIL; out.open = Array.isArray(a.feet) || Array.isArray(a.hang);
      return out;
    },
    /* …set LIVE, mid-gesture (u undefined: the user's height is forgotten — AUTO: a station takes the
       room solve's own height for where it stands, autoLiftOf; false when only a fresh solve can say).
       A floor station moves rigidly (no legs to regrow). The kit's GROUP moves rigidly too — no rebuild
       per frame: its strikes report their contact plus the group's offset (drumStrike), so they stay where
       the drums are — and liftSettle rebuilds it at its deck. The room re-anchors + re-plans its footing
       now; the director re-solves once, when stage edit closes. */
    liftLive(key, u){
      const set = Number.isFinite(u) ? clampLift(u) : undefined;
      if (set === undefined) delete devLift[key];       // (AUTO: a page-wide ?lift= / __dev.lift for it goes too)
      if (key === 'drums'){
        if (!drumGroup || !curBuild?.S.drums) return false;
        const built = kitSlot.y - drumGroup.position.y; // (the deck it was BUILT at: its group rides the difference)
        kitSlot = { ...kitSlot, lift: set };
        const deck = kitDeck();
        drumGroup.position.y = deck - built; drumGroup.updateMatrixWorld(true);
        kitSlot.y = deck;
      } else {
        const r = instLive.find(q => q.I.key === key && !q.slot.hang);
        if (!r) return false;
        const to = set !== undefined ? set : autoLiftOf(r);
        if (to === null) return false;
        r.slot.lift = set;
        r.setLift(to);
      }
      placeRoom();
      return true;
    },
    /* …the gesture is over: a kit moved live is rebuilt at its deck (restage sees the deck it was built at
       differ from its lift's) and the room re-anchored; the director waits for the way out (directorNow) */
    liftSettle(){
      if (drumGroup && drumGroup.position.y) kitSlot.y -= drumGroup.position.y;
      restage({ director: false }); edStale = curBuild;
    },
    footing: () => rooms.footing,                         // the live plan: the readout's LOFT mates
    /* what can't be moved here — and why (stage edit says so when one is clicked) */
    fixed: () => [
      ...(stageWall.isEmpty() ? [] : [{ key: 'belt', label: 'Belt', color: '#ffaa55', box: stageWall, why: 'the belt stands on its own posts' }]),
      ...instLive.filter(r => r.slot.hang).map(r => {          // (its meshes, else its solid box: a loft is mostly air)
        const a = lastAnchors.find(q => q.key === r.I.key && q.kind === 'hung'), b = a?.box;
        return { key: r.I.key, label: r.I.label, color: r.I.color, obj: r.station, why: 'hangs from the belt',
                 box: b ? new THREE.Box3(new THREE.Vector3(b[0], b[2], b[4]), new THREE.Vector3(b[1], b[3], b[5])) : null };
      }),
    ],
    kitPivot: () => ({ x: (curBuild?.view.cx ?? 0) + kitSlot.x + (drumGroup?.position.x || 0), z: kitSlot.z + (drumGroup?.position.z || 0) }),
    visBox: o => visBox(o),
    room: { x0: -ROOM.HW + 2.5, x1: ROOM.HW - 2.5, z0: ROOM.BACK + 2.5, z1: 31 },
    roomBox: { y1: ROOM.CEIL - 2, z1: ROOM.FRONT - 2, x1: ROOM.HW - 2 },
    floorY: ROOM.FLOOR,
    roomGroup: () => rooms.group,                         // (stage edit's plan view may lift the ceiling)
  } });
/* WebXR (src/xr.js): ENTER VR appears only where navigator.xr supports a session — the 2D page is
   otherwise untouched. While presenting: the head is the camera (no rig, no composer, no governor),
   halos + emissive step up for the missing bloom, the marble lamps go dark (a constant light set →
   one recompile, behind the entry blink), and every strike is placed against the head pose. */
const xr = makeXR({ renderer, scene, camera, envMap, glowTex,
  enterSound: () => enterSound(), gestureRetry: () => { if (started) audio.gestureRetry(); },
  getTime: () => songTime, setTime: v => { songTime = v; skipStrikes = true; },
  getRate: () => playing ? playRate : 0, setRate: r => { if (r){ playRate = r; setPlaying(true); } else setPlaying(false); },   // (B / the menu: the transport's STOP / START)
  nextSong(){ sel.selectedIndex = (sel.selectedIndex + 1) % sel.options.length; sel.dispatchEvent(new Event('change')); },
  songLabel: () => SONGS[sel.value]?.label,
  shotAt: now => shotAt(plan, wrapP(now, ROLL_T + LOOP_T), seamFrom),
  menu: {                                               // the in-world menu (src/xrmenu.js): the same song <select> + room host the 2D page drives
    songs: () => [...sel.options].map(o => ({ key: o.value, label: o.textContent })),
    song: () => sel.value,
    setSong(k){ if (![...sel.options].some(o => o.value === k)) return; sel.value = k; sel.dispatchEvent(new Event('change')); },
    rooms: () => [...ROOMS.map(r => ({ key: r.key, label: r.label })), { key: 'off', label: 'No room' }],
    room: () => rooms.key,
    setRoom: k => rooms.set(k, { announce: true }),
  },
  onSession: xrSession });
let xrPrev = null;
function xrSession(on, mode){
  haloA = on ? XR_HALO_A : HALO_A; emi = on ? XR_EMI : EMI;
  rooms.xr(on && xrLite);                               // the rooms' headset variants (studio: no mirror pass per eye; arena/starship comfort)
  for (const r of instLive) r.inst.xr?.(on);            // optional plugin hook (src/instruments/README.md)
  xrOn = on; xrMode = on ? mode : null; xrLitAge = 0; xrDetail.invalidate();
  if (!on){ scene.remove(xrBatch.group); xrBatch.dispose(); }   // (the 2D page never draws the mirror)
  jug?.xr(on);                                          // XR quality: the marble lamps go dark
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

function animate(){
  const frameT0 = performance.now();
  const dt = Math.min(clock.getDelta(), .05);
  // THE TRANSPORT (transport.js): a song never reaches its start before the belt's plan is in — a
  // juggle that isn't baked (an import, a share link, a MAP re-route) is solved while the count-in
  // runs, and the count-in then WAITS for it (every machine armed, nothing struck); a STOPPED song
  // is a frozen frame
  songTime = advance(songTime, dt, { playing, ready: !!jplan?.solved, rate: playRate });
  const P = ROLL_T + LOOP_T;                             // loop period (per song)
  const T = started ? ((songTime % P) + P) % P : 0;     // loop-local time (always ≥0, even during the lead-in) — display + scrub
  if (started){                                         // the loop boundary: the recording's cut point
    const li = Math.floor(songTime / P);
    if (li > loopIndex){
      loopIndex = li;
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
  if (jug){                                             // THE BELT (the juggler): one machine, every voice — a pure fn of songTime
    jug.update(jplan?.solved ? jugTime(songTime) : 0, dt, { skipStrikes, haloA, emi, onStrike: juggleStrike, onDock: juggleDock });   // (pending: standing still)
    tracks.forEach((tr, vi) => {                        // (the camera reads each voice: its focus + its next big moment)
      tr._st = jug.st[vi];
      marblePts.push({ p: jug.focus[vi].clone(), w: tr.role === 'lead' ? 1.7 : 1, role: tr.role, vis: true });
    });
    leadRender = jug.focus[0];
  }

  // ---- marble drums: one ball per drum, dribbling its solved arcs ----
  drumKit.update(songTime, P, dt, { started, skipStrikes, onStrike: drumStrike });

  // ---- instrument plugins: pure fns of songTime, strikes routed through instStrike ----
  for (const rig of instLive)
    rig.inst.update(songTime, P, dt, { started, skipStrikes, onStrike: hit => instStrike(rig, hit) });
  for (const L of strikeLights){ L.age += dt; L.l.intensity = L.peak * Math.exp(-L.age * 11); }

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
    if (BATCH_2D && world){
      if (flatBatch.root !== world || flatBatch.stale > 12){ flatBatch.build(world); if (!flatBatch.group.parent) scene.add(flatBatch.group); }
      scene.updateMatrixWorld();                        // (poses current BEFORE the batch copies them; the render skips its own pass)
      flatBatch.before(); flatBatch.group.visible = true;
      scene.matrixWorldAutoUpdate = false;
      composer.render();
      scene.matrixWorldAutoUpdate = true;
      flatBatch.after(); flatBatch.group.visible = false;   // (only ever drawn by this render: never in a headset frame, a raycast, a probe)
    } else composer.render();
    gov.frame(frameT0, started && playing && playRate > 0 && document.visibilityState === 'visible');   // adaptive resolution (perfgov.js)
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
    xrRender.glowNow = true;                            // re-collect the no-bloom glow set too (an instrument may set its own xrGlow)
  }
  if (!xrLite){ xrRender1(); return; }
  // XR DETAIL PROFILE: fine parts + dim glows skipped, glow boosted (src/xrdetail.js), the machines'
  // parts mirrored into one multi-draw per material (src/xrbatch.js) — all undone after the render
  if (xrBatch.root !== world || xrBatch.stale > 12){
    xrBatch.build(world); if (!xrBatch.group.parent) scene.add(xrBatch.group);
    xrLitAge = 0; xrRender.glowNow = true; }            // (its frozen looks join the glow boost below)
  if (xrRender.glowNow){ xrRender.glowNow = false; xrDetail.setGlow(collectGlow([
    ...instLive.map(r => ({ root: r.station, k: r.I.xrGlow })), ...[...new Set(tracks.map(tr => tr.stage))].map(root => ({ root })), { root: drumGroup }, { root: xrBatch.group }])); }
  scene.updateMatrixWorld();                            // (poses current BEFORE the batch copies them; the render skips its own pass)
  xrDetail.before([world], xr.viewer.position, fadeMats);   // fine parts + dim glows out…
  xrBatch.before();                                     // …the rest mirrored into the batch (looks compared UN-boosted)…
  xrDetail.boost();                                     // …then the no-bloom glow boost (originals + the batch's own looks)
  xrPoints();
  scene.matrixWorldAutoUpdate = false;
  xrRender1();
  scene.matrixWorldAutoUpdate = true;
  xrBatch.after(); xrDetail.after(); xrPoints(true);
}
/* PointsMaterial dust sizes attenuate by view distance — in METRES in the headset (U× nearer),
   so every mote would draw U× bigger: scale them back for the headset render */
const xrDust = [], xrDustSize = []; let xrDustAge = 0;
function xrPoints(undo = false){
  if (undo){ for (let i = 0; i < xrDust.length; i++) xrDust[i].size = xrDustSize[i]; return; }
  if (xrDustAge-- <= 0){ xrDust.length = 0; xrDustAge = 120;
    scene.traverse(o => { if (o.isPoints && o.material?.isPointsMaterial && o.material.sizeAttenuation && !xrDust.includes(o.material)) xrDust.push(o.material); }); }
  for (let i = 0; i < xrDust.length; i++){ xrDustSize[i] = xrDust[i].size; xrDust[i].size /= U_PER_M; }
}
function xrRender1(){
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
  const file = new File([blob], `gravity-orchestra-${sel.value}.${ext}`, {type: blob.type});
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
/* ---------------- the transport: STOP / START · RESTART ---------------- */
/* STOP freezes the frame (time is the only state) and cuts the sound — everything ringing, the echo,
   the room (audio.silence); START plays on from there; RESTART goes back to the count-in and, like
   every start, waits there for the belt's plan (transport.js). Space = STOP / START. */
function showPlaying(){
  playEl.textContent = playing ? '■\u00a0STOP' : '▶\ufe0e\u00a0START';
  playEl.classList.toggle('on', !playing);
  playEl.title = playing ? 'stop (space)' : 'play on from here (space)';
}
function setPlaying(on){
  if (on === playing) return;
  playing = on;
  if (on) audio.unsilence();
  else { audio.silence(); if (recState === 'rec') abortRec(); }   // (a take with a frozen stretch in it is no loop)
  showPlaying();
}
function restart(){
  if (recState === 'rec') abortRec();                   // (an ARMED take keeps waiting for the seam: this start)
  audio.silence(LEAD_IN - .35);                         // cut what rings — its echo + room tail with it — through the count-in
  songTime = -LEAD_IN; loopIndex = -1; skipStrikes = true;
  if (jplan?.solved) jugSpin = spinFor(songTime, jugBreath(jplan), LEAD_IN);
  playing = true; showPlaying();
}
playEl.addEventListener('click', () => setPlaying(!playing));
restartEl.addEventListener('click', restart);
addEventListener('keydown', e => {
  if (e.code !== 'Space' || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
  if (/^(input|textarea|select|button)$/i.test(e.target.tagName) || e.target.isContentEditable) return;   // (a focused button: Space clicks it)
  e.preventDefault(); setPlaying(!playing);
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
    transport: () => ({ playing, songTime, ready: !!jplan?.solved, from: jplan?.from ?? null, spin: { ...jugSpin } }),
    stop(){ setPlaying(false); }, start(){ setPlaying(true); }, restart(){ restart(); },
    song(k){ sel.value = k; sel.dispatchEvent(new Event('change')); },
    station(key, dist, up){ return lookAtStation(key, dist, up); },
    instruments: () => instLive.map(r => r.I.key),
    cam(m){ cam.mode = m; }, get shot(){ return cam.shot; },
    ride(t = songTime, directed = true){ const p = rideCam(t, directed); return p && { eye: p.eye.toArray(), aim: p.aim.toArray(), ...rideDbg }; },
    // room layout probe: world-space XZ boxes of every station, the drum machine and the belt
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
    // sound sweep: SOLO machines by muting the rest — mute(['belt','drums','organ']) / mute() = all on (scripts/audio-sweep.mjs)
    mute(keys){ devMute = keys && keys.length ? new Set(keys) : null; return devMute ? [...devMute] : []; },
    audioPath: () => document.getElementById('astate')?.textContent ?? null,   // the status readout (state · clock · path)
    bank: () => ({ ...audio.bankStats(), cache: voiceCacheStat }),                     // iOS sample bank: count, WAV bytes, build ms
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
    get layout(){ return lastLayout; }, get wide(){ return lastWide; }, get merge(){ return mergeStats; }, get mergeAudit(){ return mergeAudit; }, frozen: () => frozenStats(), rayBVH: () => rayBVHStats(),
    get editor(){ return editor; }, xr: xr.dev,
    xrPerf: () => ({ lite: xrLite, batch: xrBatch.stats, detail: xrDetail.stats }),   // the VR detail profile at work (scripts/xr-perf.mjs)                    // creation tools: .openMap() .toggleEdit() .stage.state() .stage.select(k)
    // staging-audit handles (scripts/staging-audit.mjs): the live camera, the song's world, the live marbles
    get three(){ return THREE; }, get camera(){ return camera; }, get world(){ return world; }, get marbles(){ return devMarbles; }, get P(){ return ROLL_T + LOOP_T; },
    get shots(){ return lastShots.map(s => ({ key: s.key, owner: s.owner, eye: s.eye.toArray(), aim: s.aim.toArray(), pref: s.pref?.toArray(), rays: s.rays, fg: s.fg, fitMax: s.fitMax, pk: s.pk, portrait: s.portrait?.eye.toArray() })); },
    get solve(){ const f = lastSolve?.follow; return lastSolve && { ms: lastSolve.ms, split: lastSolve.split, kept: lastSolve.kept, solids: lastSolve.solids, room: solvedRoom, follow: lastShots.length && f?.land ? { land: f.land, portrait: f.portrait, rays: f.rays } : null }; },
    get follow(){ return followRig; }, shotCtx: () => shotCtx(),
    // the belt (the juggler): where its plan came from (bake / worker / main), the build ms, balls per voice, warnings
    get jplan(){ return jplan; },
    jug: () => jplan && { solved: !!jplan.solved, from: jplan.from || 'pending', ms: jplan.ms, P: +jplan.P.toFixed(3),
      voices: jplan.voices.map(V => ({ role: V.role, notes: V.notes.length, balls: V.balls ?? null, bad: V.bad ?? null })), warnings: jplan.warnings },
    roomSolids: () => roomSolids(rooms.group).map(s => s.box),   // the room's standing geometry, as the shot solve sees it
    // STAGING (rooms/footing.js): set a floor machine's / the kit's LIFT live (u above its ground; 0 = on
    // the floor) · what the room was told stands where (deck, ground, lift, bottom, low, box, cue) · the floor contract
    lift: (key, u) => setLift(key, u),
    anchors: () => lastAnchors,
    footing: () => rooms.footing,                         // the plan (pads, lofts, accesses: rooms/footing.js)
    footBoxes: () => rooms.footBoxes,                     // its envelopes, as the shot solve sees them
    footStats: () => { const g = rooms.footGroup; return { draws: g.children.length, tris: g.children.reduce((s, m) => s + (m.geometry?.index ? m.geometry.index.count / 3 : 0), 0), ms: g.userData.ms, room: rooms.key }; },
    get stage(){ return { ...ROOM, lowMs: +lowMs.toFixed(1) }; },
    hung: () => instLive.filter(r => r.slot.hang).map(r => ({ key: r.I.key, box: solidBox(r.station, drawn) })),   // (solid: the merged cable/glow batches aren't bulk)
    hang: () => instLive.filter(r => r.slot.hang).map(r => ({ key: r.I.key, wallTop: +stageWall.max.y.toFixed(2), low: +hangLow(r.station).toFixed(2), y: +r.station.position.y.toFixed(2) })),
    set rigid(v){ RIGID.rigid = RIGID.groups = !!v; },   // (A/B of the extended merge: takes effect on the next song build)
    set batch(v){ BATCH_2D = !!v; }, get batch(){ return BATCH_2D && flatBatch.stats; },
    // the flat batch's honesty probe: THIS frame (drawn batched) read back, then the same frame re-drawn
    // with every original part instead — per-pixel difference of the two (same state, same instant)
    batchAB(){
      return new Promise(res => frameTaps.push(() => {
        if (!BATCH_2D) { res({ off: true }); return true; }
        const gl = renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
        const A = new Uint8Array(w * h * 4), B = new Uint8Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, A);
        const st = flatBatch.stats;
        scene.matrixWorldAutoUpdate = false; composer.render(); scene.matrixWorldAutoUpdate = true;
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, B);
        let max = 0, changed = 0, sum = 0; const pts = [];
        for (let i = 0; i < A.length; i += 4){ let m = 0; for (let c = 0; c < 3; c++){ const d = Math.abs(A[i + c] - B[i + c]); sum += d; if (d > m) m = d; } if (m > max) max = m; if (m > 8){ changed++; if (pts.length < 400) pts.push([(i >> 2) % w, h - 1 - ((i >> 2) / w | 0), m]); } }
        res({ w, h, max, changed, meanAbs: +(sum / (w * h * 3)).toFixed(4), batch: st, pts });
        return true;
      }));
    },
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
