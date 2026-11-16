import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import * as THREE from 'three';
import { installFakeDom } from './fake-dom.js';
installFakeDom();                                       // (before any room module: they paint canvases at build)
const { STAGE, disposeTree } = await import('../../src/rooms/common.js');
const { planFooting, footingBoxes, FOOT } = await import('../../src/rooms/footing.js');
const { buildFooting, makeFootingMats, DEFAULT_STYLE } = await import('../../src/rooms/footing3d.js');
const { roomSolids } = await import('../../src/shotrig.js');
const { ARM_AT } = await import('../../src/transport.js');

/* ============================================================
   THE ROOM CONTRACT — describeRoomContract(R) registers every check the room host's header
   (src/rooms/index.js), the footing kit (src/rooms/footing3d.js) and docs/STAGING-WORLD.md
   promise for ONE room module, built with the real THREE under a fake DOM (test/helpers/fake-dom.js:
   blank canvases, no renderer — the checks are about STRUCTURE, never pixels):

     · the descriptor: key / label / build; the built room: group, bounds, fog, background, mood,
       footing style, hooks — each of the right type; build() leaves the scene alone
     · THE FLOOR CONTRACT: FLOOR === STAGE.FLOOR, and STAGE itself is never mutated; bounds may widen
       the stage, never narrow it
     · NO LIGHTS of its own (the light set is constant: a swap never recompiles a program)
     · place(anchors, plan) on a crowd with every footing band (+ a second, lifted crowd: place runs
       again on every stage edit) never throws, and what the shot solve sees as SOLID in the room
       (shotrig roomSolids — props, piers, graves) stays out of every machine's box and every footing
       envelope (footingBoxes)
     · its footing STYLE builds on the plan (footing3d buildFooting) and stays inside the envelopes
     · update(dt, songTime, camera, energy, cues) is a PURE fn of its arguments: update(t) → elsewhere
       → update(t) draws the identical frame (scrub-safe); a frame creates no THREE object, geometry,
       material or texture and doesn't change the scene graph's shape
     · the PREWARM rules: an InstancedMesh's instanceColor exists from build() (it is a program
       define); after place() no frame changes a material's program (defines, maps, onBeforeCompile,
       customProgramCacheKey) or swaps a mesh's material
     · xr(true) → xr(false) gives the desktop frame back; resize doesn't throw
     · dispose leaves nothing behind: after the host's teardown (disposeTree(group), room.dispose(),
       the footing's own dispose) every geometry, material and texture the room EVER drew (any
       place, its footing style's materials, its background) has been disposed
   test/room-contract.test.js runs it over every room the registry has (shipped + guests: no list to
   edit); test/scaffold-room.test.js runs it over a freshly generated `npm run new:room` room.

   KNOWN EXCEPTIONS: a shipped room that genuinely departs from a check is listed in KNOWN with the
   reason — never by weakening the check for everyone. A new room should need none.
   ============================================================ */
export const KNOWN = {
  // the Metal Arena's suites predate the test/room-<key>.test.js convention (test/arena.test.js,
  // arena-staging.test.js, arena-props.test.js) — renaming shipped test files is churn for nothing
  ownTest: { arena: 'its suites are test/arena.test.js, arena-staging.test.js and arena-props.test.js' },
  // bounds that NARROW the stage: the churchyard's front fence line is FRONT 40 (< STAGE.FRONT 42). Harmless today —
  // the host and main read STAGE (rooms.frame), never a room's own bounds — but a room should only ever widen them
  bounds: { graveyard: 'FRONT 40: the churchyard fence (main / the host read STAGE, not the room\'s bounds)' },
  // the shared FogExp2's DENSITY is not a pure fn of songTime in the graveyard: update() re-reads its night density
  // from the fog itself (`fogBase = fog.density` whenever dawn is 0), so after a frame at dawn a jump back to night
  // keeps the thinned fog (and each loop's roll-in ratchets it by a hair) until the next song build resets the
  // density. Only songs with a `sky` dawn cue (Danse Macabre, Bald Mountain) ever see it. Fixing it is a behaviour
  // change to a shipped room (read the density once per song) — left for the maintainer; every other value it
  // draws, the fog's colour included, IS checked
  fogDensity: { graveyard: 'update() re-reads its night fog density from the fog it thinned at dawn (a scrub back keeps it thin)' },
};
export const ownTestOf = key => ({ arena: 'test/arena.test.js' })[key] ?? `test/room-${key}.test.js`;

const FL = STAGE.FLOOR;
const STAGE0 = { ...STAGE };
const FOOT_ROOM = { x0: -STAGE.HW, x1: STAGE.HW, z0: STAGE.BACK, z1: STAGE.FRONT };   // (rooms/index.js plans every room in these walls)
const P = 20;
const st = (key, x, z, w, d, h = FOOT.PLINTH, extra = {}) => ({ key, kind: 'station', label: key, color: '#88aaff', x, z, yaw: 0, w, d,
  y: FL + h, ground: FL + FOOT.PLINTH, lift: h - FOOT.PLINTH, bottom: FL + h, low: FL + h, box: [x - w / 2, x + w / 2, FL + h, FL + h + 5, z - d / 2, z + d / 2],
  cue: [{ t: 1 + (key.length % 3), w: 1 }, { t: 6, w: .5 }, { t: 11.5, w: .8 }], P, start: ARM_AT, fixed: false, ...extra });
/** a crowd with every footing form (the room-grid suite's): the belt, the kit, plinths, a dais, platforms (stair / ladder),
    a tower, a gallery loft + a mid loft + a low loft, a turned riser, an open stand, the organ loft hung over the floor */
export const CROWD = [
  { key: 'belt', kind: 'belt', label: 'Belt', color: '#ffaa55', x: 0, z: -1.17, yaw: 0, w: 21.74, d: 5.77, y: FL, bottom: FL, low: FL, box: [-10.87, 10.87, FL, 15.83, -4.05, 1.72], cue: [{ t: 3, w: 1 }, { t: 9, w: .6 }], P, start: ARM_AT, fixed: true },
  { ...st('drums', 19, 19, 18, 5.5), kind: 'kit', color: '#ff8a3d', low: FL + FOOT.PLINTH - .335 },
  st('bass', -20, 5, 11.7, 7.8, undefined, { color: '#7ad0a0' }), st('bells', 26, -10, 10.9, 6.85, undefined, { color: '#ffd166' }),
  st('dais', -27, 20, 10, 6, 2.4), st('plat', 0, 30, 10, 6, 5), st('platL', 20, 33, 10, 6, 8), st('tower', -20, -10, 12, 6, 14),
  st('g1', -10, -24, 12, 4, 19.33), st('g2', 4.5, -24, 12, 4, 19.33), st('m1', 28, 6, 8, 5, 6), st('m2', 28, -1, 8, 5, 6.2),
  st('yawed', -30, 32, 6, 4, 3, { yaw: .6 }), st('l1', 9, 12, 5, 4, 1.6), st('l2', 15, 12, 5, 4, 1.8),
  { ...st('tt', -6, 15, 14.2, 14.1, -1.29 - FL), low: -5.1, feet: [[-5.5, -4.5, .7], [5.5, -4.5, .7], [-5.5, 4.5, .7], [5.5, 4.5, .7]], hang: [-6.25, 4.35, 4.8, 5.7] },
  { key: 'organ', kind: 'hung', label: 'organ', color: '#c08cff', x: 0, z: -13.65, yaw: 0, w: 13.16, d: 4.64, y: 16, box: [-6.58, 6.58, FL, 24.54, -15.97, -11.33], cue: [{ t: 4, w: 1 }], P, start: ARM_AT, fixed: true },
];
/** the same machines after a stage edit: the floor machines moved and lifted (place runs on every edit) */
export const CROWD2 = CROWD.map(a => a.kind !== 'station' || a.feet ? a : (() => {
  const dx = a.x > 0 ? -2 : 2, u = 1.5;
  return { ...a, x: a.x + dx, y: a.y + u, lift: (a.lift ?? 0) + u, bottom: a.bottom + u, low: a.low + u,
    box: [a.box[0] + dx, a.box[1] + dx, a.box[2] + u, a.box[3] + u, a.box[4], a.box[5]] };
})());
/** the room host's footing plan for a crowd (rooms/index.js footPlan: one plan in the stage's walls, each pad its machine's footprint) */
export function planOf(anchors){
  const plan = planFooting(anchors, { floor: FL, room: FOOT_ROOM });
  const byKey = new Map(anchors.map(a => [a.key, a]));
  for (const p of plan.pads){ const a = byKey.get(p.key); if (a && p.foot == null) p.foot = [a.w, a.d]; }
  return plan;
}
/** the song's weather + cue sheet as main hands it to the host (rooms.cue): the arena solves pyro from the drums */
export const CUES = { storm: [6, 22], sky: [[0, 'night'], [24, 'dawn']], rollT: 1.2, beat: .5, P, loopBeats: 32, start: ARM_AT,
  drums: { kick: [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30], snare: [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31], crash: [0, 16] },
  melody: Array.from({ length: 16 }, (_, i) => [['C4', 'E4', 'G4', 'B4'][i % 4], 2]) };

const camAt = (x, y, z) => { const c = new THREE.PerspectiveCamera(50, 16 / 9, .1, 200); c.position.set(x, y, z); c.lookAt(0, 4, 0); c.updateMatrixWorld(true); return c; };
const CAM = camAt(6, 9, 46), CAM2 = camAt(-20, 14, 30);
const DT = 1 / 60;

/* ---- what a frame can change in what is DRAWN, flattened (the instrument contract's snapshot + the room's extras:
   texture transforms — haze scrolls — every uniform, the shared fog it may tint, its background) ---- */
const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
function putVal(put, v, depth = 0){
  if (v == null || depth > 2) return;
  if (typeof v === 'number' || typeof v === 'boolean') put(v);
  else if (ArrayBuffer.isView(v)) v.forEach(put);
  else if (Array.isArray(v)) v.forEach(x => putVal(put, x, depth + 1));
  else if (v.isColor) v.toArray().forEach(put);
  else if (v.isVector2 || v.isVector3 || v.isVector4 || v.isQuaternion || v.isMatrix3 || v.isMatrix4) v.toArray().forEach(put);
  else if (v.isTexture){ v.offset.toArray().forEach(put); v.repeat.toArray().forEach(put); put(v.rotation); }
}
function snapshot(group, extra = {}){
  const out = [];
  const put = v => out.push(typeof v === 'boolean' ? +v : v);
  group.updateMatrixWorld(true);
  const walk = o => {
    put(o.visible);
    if (!o.visible) return;
    o.matrixWorld.decompose(_p, _q, _s);
    o.matrixWorld.elements.forEach(put);
    for (const m of [o.material].flat().filter(Boolean)){
      put(m.visible); put(m.opacity ?? 0); put(m.emissiveIntensity ?? 0);
      for (const k of ['color', 'emissive']) if (m[k]) m[k].toArray().forEach(put);
      for (const v of Object.values(m)) if (v && v.isTexture) putVal(put, v);
      if (m.uniforms) for (const u of Object.values(m.uniforms)) putVal(put, u.value);
    }
    if (o.isInstancedMesh){ put(o.count); o.instanceMatrix.array.subarray(0, o.count * 16).forEach(put); o.instanceColor?.array.subarray(0, o.count * 3).forEach(put); }
    if (o.morphTargetInfluences) o.morphTargetInfluences.forEach(put);
    const g = o.geometry;
    if (g?.attributes) for (const a of Object.values(g.attributes)) if (a.version > 0 && a.array) a.array.forEach(put);
    if (g?.drawRange){ put(g.drawRange.start); put(Number.isFinite(g.drawRange.count) ? g.drawRange.count : -1); }
    for (const c of o.children) walk(c);
  };
  walk(group);
  if (extra.scene?.fog){ extra.scene.fog.color.toArray().forEach(put); if (!extra.skipFogDensity) put(extra.scene.fog.density); }
  putVal(put, extra.background);
  return out;
}
const sameSnap = (a, b, msg) => {
  expect(b.length, `${msg}: the scene graph changed shape`).toBe(a.length);
  let worst = 0, at = -1;
  for (let i = 0; i < a.length; i++){
    const d = Object.is(a[i], b[i]) ? 0 : Math.abs(a[i] - b[i]);
    if (!(d <= worst)){ worst = Number.isNaN(d) ? Infinity : d; at = i; }
  }
  expect(worst, `${msg}: value #${at} differs (${a[at]} vs ${b[at]})`).toBeLessThanOrEqual(1e-9);
};
/* THREE's own id counters: one probe of each class; the next probe's id − this one's − 1 = how many were made between */
const ids = () => [new THREE.Object3D().id, new THREE.BufferGeometry().id, new THREE.MeshBasicMaterial().id, new THREE.Texture().id];
const nodes = g => { let n = 0; g.traverse(() => n++); return n; };
/* everything that keys a material's PROGRAM (three's getProgramCacheKey reads these), per drawn object, + its material's identity */
const progKey = m => JSON.stringify([m.type, m.defines ?? null, typeof m.onBeforeCompile === 'function' ? String(m.onBeforeCompile).length : 0,
  m.customProgramCacheKey?.() ?? '', ...['map', 'envMap', 'alphaMap', 'emissiveMap', 'normalMap', 'bumpMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'lightMap', 'specularMap', 'gradientMap', 'displacementMap']
    .map(k => !!m[k]), m.vertexColors, m.fog, m.flatShading, m.side, m.forceSinglePass, m.transparent, m.alphaTest > 0, m.toneMapped, m.dithering]);
function programs(group){
  const out = new Map();
  group.traverse(o => {
    const mats = [o.material].flat().filter(Boolean);
    if (mats.length) out.set(o, JSON.stringify([mats.map(m => m.uuid), mats.map(progKey), !!o.isInstancedMesh && !!o.instanceColor, !!o.morphTargetInfluences]));
  });
  return out;
}
/* every GPU resource reachable from a root: geometries, materials, their textures (also inside uniforms) */
const ownerOf = new WeakMap();                         // a resource → the object it was found on (for the message)
function resources(root, into = new Set()){
  root?.traverse?.(o => {
    const add = r => { into.add(r); if (!ownerOf.has(r)) ownerOf.set(r, nameOf(o)); };
    if (o.geometry) add(o.geometry);
    for (const m of [o.material].flat().filter(Boolean)){
      add(m);
      for (const v of Object.values(m)) if (v && v.isTexture) add(v);
      if (m.uniforms) for (const u of Object.values(m.uniforms)){ const v = u.value; if (v && v.isTexture) add(v); if (Array.isArray(v)) v.forEach(x => x?.isTexture && add(x)); }
    }
  });
  return into;
}
const hit = (a, b, m) => a[0] < b[1] - m && a[1] > b[0] + m && a[2] < b[3] - m && a[3] > b[2] + m && a[4] < b[5] - m && a[5] > b[4] + m;
const nameOf = o => o.name || `${o.type}#${o.id}`;

/** build a room as the host does (rooms/index.js buildRoom): a scene of its own, no renderer */
export function buildRoom(R, { scene = new THREE.Scene() } = {}){
  scene.fog ||= new THREE.FogExp2(0x07060e, .026);
  const b = R.build(scene, { envMap: null });
  return { scene, b };
}

/** Register the whole contract for room module R. root: the tree it lives in (a URL ending in '/', holding
    src/rooms/<key>.js and its own test) — the repo by default. */
export function describeRoomContract(R, { root = new URL('../../', import.meta.url) } = {}){
const key = R?.key;
describe(`room "${key}" contract`, () => {
  it('the descriptor: a key (its file name), a label, build()', () => {
    expect(typeof key).toBe('string');
    expect(key).toMatch(/^[a-z][a-z0-9]{1,23}$/);
    expect(key).not.toBe('off');
    expect(typeof R.label === 'string' && R.label.trim().length > 0 && R.label.length <= 28, `label "${R.label}" (≤ 28: the VR menu)`).toBe(true);
    expect(typeof R.build).toBe('function');
    expect(fs.existsSync(new URL(`src/rooms/${key}.js`, root)), `src/rooms/${key}.js`).toBe(true);
  });

  it(`it has its own test (${ownTestOf(key)})`, () => {
    expect(fs.existsSync(new URL(ownTestOf(key), root)), `${ownTestOf(key)}${KNOWN.ownTest[key] ? ` (known: ${KNOWN.ownTest[key]})` : ''}`).toBe(true);
  });

  it('builds with the real THREE and no renderer, leaving the scene alone; every field the host reads is of the right type', () => {
    const scene = new THREE.Scene(), fog = new THREE.FogExp2(0x07060e, .026), bg = new THREE.Color(0x07060e);
    scene.fog = fog; scene.background = bg;
    const b = R.build(scene, { envMap: null });
    expect(scene.children.length, 'build() added to the scene (the host adds the group)').toBe(0);
    expect(scene.fog).toBe(fog); expect(scene.background).toBe(bg);
    expect(fog.color.getHex()).toBe(0x07060e); expect(fog.density).toBe(.026);
    expect(b && b.group && b.group.isObject3D, 'group').toBe(true);
    expect(b.group.parent, 'the group is not parented').toBe(null);
    expect(b.fog?.isFogExp2 && b.fog.color?.isColor && Number.isFinite(b.fog.density) && b.fog.density >= 0, 'fog: a FogExp2 (the host copies its colour + density)').toBe(true);
    expect(!!(b.background?.isColor || b.background?.isTexture), 'background: a Color or a Texture').toBe(true);
    if (b.mood !== undefined){
      const hex = v => Number.isInteger(v) && v >= 0 && v <= 0xffffff;
      if (b.mood.ambient) expect(hex(b.mood.ambient[0]) && Number.isFinite(b.mood.ambient[1]), 'mood.ambient [hex, intensity]').toBe(true);
      if (b.mood.hemi) expect(hex(b.mood.hemi[0]) && hex(b.mood.hemi[1]) && Number.isFinite(b.mood.hemi[2]), 'mood.hemi [sky, ground, intensity]').toBe(true);
    }
    if (b.footing !== undefined) expect(typeof b.footing === 'object' && b.footing !== null, 'footing: a style object (rooms/footing3d.js)').toBe(true);
    for (const h of ['place', 'update', 'resize', 'xr']) if (b[h] !== undefined) expect(typeof b[h], h).toBe('function');
    expect(typeof b.dispose, 'dispose()').toBe('function');
    b.dispose(); disposeTree(b.group);
  });

  it('THE FLOOR CONTRACT: FLOOR is STAGE.FLOOR; bounds may widen the stage, never narrow it; STAGE is never mutated', () => {
    const { b } = buildRoom(R);
    expect(b.FLOOR, `FLOOR ${b.FLOOR}`).toBe(STAGE.FLOOR);
    for (const k of ['FLOOR', 'CEIL', 'HW', 'BACK', 'FRONT']) expect(Number.isFinite(b[k]), k).toBe(true);
    const narrow = [b.HW < STAGE.HW && `HW ${b.HW}`, b.CEIL < STAGE.CEIL && `CEIL ${b.CEIL}`, b.BACK > STAGE.BACK && `BACK ${b.BACK}`, b.FRONT < STAGE.FRONT && `FRONT ${b.FRONT}`].filter(Boolean);
    if (KNOWN.bounds[key]) expect(narrow.length, `${key}: its known narrowing (${KNOWN.bounds[key]}) is gone — drop the KNOWN entry`).toBeGreaterThan(0);
    else expect(narrow, `${key}: bounds narrower than STAGE ${JSON.stringify(STAGE)}`).toEqual([]);
    b.place?.(CROWD, planOf(CROWD));
    b.update?.(DT, 3, CAM, 0, CUES);
    expect({ ...STAGE }).toEqual(STAGE0);
    b.dispose(); disposeTree(b.group);
  });

  it('owns no lights (built, placed or animated)', () => {
    const { scene, b } = buildRoom(R);
    const lights = () => { const L = []; b.group.traverse(o => { if (o.isLight) L.push(nameOf(o)); }); scene.traverse(o => { if (o.isLight) L.push(nameOf(o)); }); return L; };
    expect(lights(), 'after build').toEqual([]);
    b.place?.(CROWD, planOf(CROWD));
    for (const t of [-1, 3, 13]) b.update?.(DT, t, CAM, .5, CUES);
    expect(lights(), 'after place + update').toEqual([]);
    b.dispose(); disposeTree(b.group);
  });

  it('place(anchors, plan) — every footing band, then a stage edit — and what stands in the room stays clear of every machine and every footing envelope', () => {
    const { b } = buildRoom(R);
    if (!b.place){ b.dispose(); disposeTree(b.group); return; }
    for (const crowd of [CROWD, CROWD2, CROWD]){
      const plan = planOf(crowd), env = footingBoxes(plan);
      b.place(crowd, plan);
      b.group.visible = true;
      const bad = new Set();
      for (const s of roomSolids(b.group)){
        for (const a of crowd) if (Array.isArray(a.box) && hit(s.box, a.box, .05)) bad.add(`${nameOf(s.c)} × ${a.key}`);
        for (const e of env) if (hit(s.box, e.box, .05)) bad.add(`${nameOf(s.c)} × the footing of ${e.key ?? e.unit}`);
      }
      expect([...bad], `${key}: room solids inside a machine / its footing (${crowd === CROWD2 ? 'the edited stage' : 'the crowd'})`).toEqual([]);
    }
    b.place([], planOf([]));                                   // (an empty stage: a song with no machines placed yet)
    b.dispose(); disposeTree(b.group);
  });

  it('its footing STYLE builds on the plan (rooms/footing3d.js), every footing mesh inside the envelopes it is tagged with', () => {
    const { b } = buildRoom(R);
    const plan = planOf(CROWD), env = footingBoxes(plan), mats = makeFootingMats();
    b.place?.(CROWD, plan);
    const f = buildFooting(plan, b.footing || DEFAULT_STYLE, { mats, envMap: null, boxes: env, room: key });
    let meshes = 0;
    const B = env.map(e => e.box), v = new THREE.Vector3(), im = new THREE.Matrix4(), out = [];
    f.group.updateMatrixWorld(true);
    f.group.traverse(o => {
      if (!(o.isMesh || o.isInstancedMesh) || !o.visible) return;
      meshes++;
      expect(o.userData.footing, `${nameOf(o)} tagged userData.footing`).toBe(true);
      const pos = o.geometry?.attributes?.position;
      if (!pos) return;
      let worst = 0, at = null;
      for (let k = 0; k < (o.isInstancedMesh ? o.count : 1); k++){
        if (o.isInstancedMesh) o.getMatrixAt(k, im);
        for (let i = 0; i < pos.count; i++){
          v.fromBufferAttribute(pos, i); if (o.isInstancedMesh) v.applyMatrix4(im); v.applyMatrix4(o.matrixWorld);
          const y = Math.max(v.y, FL);                         // (feet may be buried in the floor…)
          let d = Infinity;                                    // (…but not hang far under it)
          if (v.y >= FL - .2) for (const b of B) d = Math.min(d, Math.hypot(Math.max(b[0] - v.x, 0, v.x - b[1]), Math.max(b[2] - y, 0, y - b[3]), Math.max(b[4] - v.z, 0, v.z - b[5])));
          if (d > worst){ worst = d; at = [v.x, v.y, v.z]; }
        }
      }
      if (worst > .05) out.push(`${nameOf(o)}: ${worst.toFixed(3)} u out at ${at.map(c => c.toFixed(2))}`);
    });
    expect(meshes, 'the footing draws something').toBeGreaterThan(0);
    expect(out, `${key}: footing drawn outside footingBoxes (the envelopes the shot solve keeps an eye out of)`).toEqual([]);
    for (const t of [-1, 1.5, 3.05, 13]) f.update(t);
    f.dispose(); b.dispose(); disposeTree(b.group); mats.dispose();
  });

  it('update() is a pure fn of songTime: update(t) → elsewhere → update(t) draws the identical frame (scrub-safe)', () => {
    const { scene, b } = buildRoom(R);
    if (!b.update){ b.dispose(); disposeTree(b.group); return; }
    b.place?.(CROWD, planOf(CROWD));
    for (let t = -2.4; t < P + 1; t += .25) b.update(DT, t, CAM, .3, CUES);   // (warm: every lazily-made thing exists)
    const T = [-2, -.3, 1.02, 3.05, 6.01, 11.6, P - .4, P + 3.1, 2.5 * P];
    const known = KNOWN.fogDensity[key];
    const look = () => snapshot(b.group, { scene, background: b.background, skipFogDensity: !!known });
    let fogMoved = false;
    for (const t of T){
      b.update(DT, t, CAM, .3, CUES); const a = look(), d = scene.fog.density;
      for (const u of [t + .37 * P, -2.3, t - .05, t + 1e-3]){
        b.update(DT * 3, u, CAM, .3, CUES);
        b.update(DT, t, CAM, .3, CUES);
        sameSnap(a, look(), `${key} @${t.toFixed(3)} after a visit to ${u.toFixed(3)}${known ? ` (fog density: known — ${known})` : ''}`);
        if (scene.fog.density !== d) fogMoved = true;
      }
    }
    if (known) expect(fogMoved, `${key}: its fog density is pure now — drop KNOWN.fogDensity.${key}`).toBe(true);
    b.dispose(); disposeTree(b.group);
  });

  it('a frame allocates nothing: no THREE object / geometry / material / texture, the scene graph keeps its shape', () => {
    const { b } = buildRoom(R);
    if (!b.update){ b.dispose(); disposeTree(b.group); return; }
    b.place?.(CROWD, planOf(CROWD));
    b.update(DT, 0, CAM, 0, CUES); b.update(DT, 1, CAM2, .8, CUES);   // (one warm frame: a cue sheet solved once per song may build on first sight)
    const n0 = nodes(b.group), i0 = ids();
    for (let k = 0; k < 240; k++) b.update(DT, -2.4 + k * .11, k % 2 ? CAM : CAM2, (k % 5) / 4, CUES);
    const i1 = ids(), made = i1.map((v, j) => v - i0[j] - 1);
    expect({ object3D: made[0], geometry: made[1], material: made[2], texture: made[3] }, `${key}: THREE objects created over 240 frames`).toEqual({ object3D: 0, geometry: 0, material: 0, texture: 0 });
    expect(nodes(b.group), 'scene graph nodes').toBe(n0);
    b.dispose(); disposeTree(b.group);
  });

  it('the PREWARM rules: instanceColor exists from build(); after place() no frame changes a program or swaps a material', () => {
    const { b } = buildRoom(R);
    const colored = new Map(); b.group.traverse(o => { if (o.isInstancedMesh) colored.set(o, !!o.instanceColor); });
    b.place?.(CROWD, planOf(CROWD));
    const p0 = programs(b.group);
    for (const t of [-2.4, -.2, 1.02, 3.05, 6, 11.6, P + 2]) b.update?.(DT, t, CAM, .7, CUES);
    b.place?.(CROWD2, planOf(CROWD2));
    for (const t of [3.05, 11.6]) b.update?.(DT, t, CAM, .7, CUES);
    const late = [];
    for (const [o, had] of colored) if (!had && o.instanceColor) late.push(nameOf(o));
    expect(late, `${key}: InstancedMesh given instanceColor after build() (a program define the prewarm compiled without)`).toEqual([]);
    const p1 = programs(b.group), flipped = [];
    for (const [o, k] of p0) if (p1.has(o) && p1.get(o) !== k) flipped.push(nameOf(o));
    expect(flipped, `${key}: a frame changed a material's program`).toEqual([]);
    b.dispose(); disposeTree(b.group);
  });

  it('xr(true) → xr(false) gives the desktop frame back; resize() never throws', () => {
    const { scene, b } = buildRoom(R);
    b.place?.(CROWD, planOf(CROWD));
    b.update?.(DT, 3.05, CAM, .2, CUES);
    const a = snapshot(b.group, { scene, background: b.background });
    if (b.xr){ b.xr(true); b.update?.(DT, 7, CAM, .2, CUES); b.xr(false); b.update?.(DT, 3.05, CAM, .2, CUES); sameSnap(a, snapshot(b.group, { scene, background: b.background }), `${key} after a headset session`); }
    b.resize?.(390, 844, 3); b.resize?.(1280, 720, 1);
    b.dispose(); disposeTree(b.group);
  });

  it('dispose leaves nothing behind: everything it ever drew (every place, its footing style, its background) is freed by the host\'s teardown', () => {
    const { b } = buildRoom(R);
    const drawn = new Set(), freed = new Set(), mats = makeFootingMats(), foots = [];
    const watch = root => { for (const r of resources(root)) if (!drawn.has(r)){ drawn.add(r); r.addEventListener('dispose', () => freed.add(r)); } };   // (listen the moment it is seen: a place() may free what it replaces)
    const look = () => { watch(b.group); if (b.background?.isTexture && !drawn.has(b.background)){ drawn.add(b.background); ownerOf.set(b.background, 'the background'); b.background.addEventListener('dispose', () => freed.add(b.background)); } };
    look();
    for (const crowd of [CROWD, CROWD2]){
      const plan = planOf(crowd), env = footingBoxes(plan);
      b.place?.(crowd, plan);
      look();
      const f = buildFooting(plan, b.footing || DEFAULT_STYLE, { mats, envMap: null, boxes: env, room: key });
      foots.push(f); watch(f.group);
      for (const t of [-1, 3.05, 11.6]){ b.update?.(DT, t, CAM, .4, CUES); f.update(t); }
      look();
    }
    // the host's teardown, in its order (rooms/index.js dispose + a footing rebuild)
    for (const f of foots) f.dispose();
    disposeTree(b.group); b.dispose(); mats.dispose();          // (mats: the host's kit materials — host.dispose frees them)
    const left = [...drawn].filter(r => !freed.has(r)).map(r => `${r.type || r.constructor.name}${r.name ? ` "${r.name}"` : ''} (on ${ownerOf.get(r) ?? 'the background'})`);
    expect(left, `${key}: drawn, never disposed`).toEqual([]);
  });
});
}

/** The ROOM HOST over a registry: build, place, footing, prewarm, the R cycle — every room through the real makeRoomHost. */
export async function hostSmoke(makeRoomHost, ROOM_KEYS){
  const scene = new THREE.Scene(); scene.fog = new THREE.FogExp2(0x07060e, .026);
  const ambient = new THREE.AmbientLight(0xffffff, 1), hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 1);
  const renderer = { getPixelRatio: () => 1, getRenderTarget: () => null, setRenderTarget(){}, compile(){}, render(){}, initTexture(){}, capabilities: { getMaxAnisotropy: () => 4 } };
  const idle = globalThis.requestIdleCallback;
  globalThis.requestIdleCallback = cb => cb();                 // (the prewarm's idle slices, run now)
  const warn = [], cw = console.warn;
  console.warn = (...a) => { warn.push(a.map(String).join(' ')); };
  try {
    const host = makeRoomHost({ scene, envMap: null, renderer, lights: { ambient, hemi }, initial: 'off' });
    host.place(CROWD);
    host.cue(CUES);
    host.prewarm(CAM);                                         // every room built, PLACED, footed and "compiled"
    const seen = [];
    for (let i = 0; i < ROOM_KEYS.length; i++){
      seen.push(host.cycle());
      host.update(DT, 1 + i, CAM, .2);
      if (host.key !== 'off') expect(host.group?.visible, host.key).toBe(true);
    }
    host.place(CROWD2);                                        // a stage edit re-places the live room
    host.update(DT, 4, CAM, 0);
    host.dispose();
    return { seen, warn };
  } finally {
    console.warn = cw;
    if (idle === undefined) delete globalThis.requestIdleCallback; else globalThis.requestIdleCallback = idle;
  }
}
