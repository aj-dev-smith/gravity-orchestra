import * as THREE from 'three';
import { solveShotEye, solveFollow, blockedRays, foreground, boxDist, boxPts, rayBox, CLEAR_RAYS, FG_MAX, FG_TALL } from './shotsolve.js';
import { STAGE } from './rooms/common.js';
/* ============================================================
   SHOT RIG — the scene side of the director's solved eyes. shotsolve.js is
   pure (it reaches the world only through `blocked(eye, dir, far)`); this module
   builds that `blocked` from the REAL meshes — every machine in the song's world
   AND the room's standing geometry (cathedral piers, graves, trees, gate piers) —
   AABB-prefiltered so a whole solve stays tens of ms. DI'd seam: main hands over
   the world, the room's group, the belt bays and its own visBox/drawn helpers.

     solveShots(shots, ctx)  — every station's eye (from its designer's preferred
                               framing, sh.pref), its portrait pull-back cap (fitMax),
                               and the belt's FOLLOW offsets (both aspect classes,
                               solved up front — no hitch when a phone turns).
     resolveRoom(shots, ctx) — the room changed under a song (R / ROOM): keep every
                               eye that is still clean in the new room, re-solve only
                               the ones a pier or a grave now stands in front of.
   Render-time only; the engine never knows.
   ============================================================ */

const _ray = new THREE.Raycaster(), _o = new THREE.Vector3(), _d = new THREE.Vector3(), _b = new THREE.Box3(), _m = new THREE.Matrix4();
export const glowy = m => !!m && (m.blending === THREE.AdditiveBlending || (m.transparent && !m.depthWrite));
const PULL_MAX = 2.25, PHONE_FIT = 2.03;                    // (a 390×844 phone: (1.5/.462)^.6)
const _unusedPULL = 0;                                       // (camera.js never pulls a station shot back further: (1.5/.42)^.6)
const arr = b => [b.min.x, b.max.x, b.min.y, b.max.y, b.min.z, b.max.z];

/* a machine's SOLID box: what stands there, for clear-air tests. Glows, beams and the merged
   unlit wire/LED batches (MeshBasicMaterial — a chandelier's merged cables span floor → ceiling)
   are light, not bulk: they still occlude a ray (blocked() raycasts them), but they don't make a
   machine a floor-to-ceiling column an eye can never stand beside. */
export function solidBox(root, drawn){
  const out = new THREE.Box3();
  root.updateWorldMatrix(true, true);
  root.traverse(o => {
    if (!(o.isMesh || o.isInstancedMesh) || !o.geometry || !drawn(o)) return;
    const m = [].concat(o.material)[0];
    if (!m || glowy(m) || m.isMeshBasicMaterial) return;
    if (o.isInstancedMesh){ if (!o.count) return; o.computeBoundingBox(); _b.copy(o.boundingBox); }
    else { if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); _b.copy(o.geometry.boundingBox); }
    out.union(_b.applyMatrix4(o.matrixWorld));
  });
  return out.isEmpty() ? null : arr(out);
}

/* the room's STANDING geometry: opaque meshes that rise off the floor and aren't the hall's own
   shell (floors, walls, vaults: anything wider than 40 u) — one box per instance. `floor`: the
   room floor's world y (the floor contract: STAGE.FLOOR) — a part within 1 u of it lies flush.
   A merged mesh that knows its parts' envelopes (userData.boxes: the FOOTING, rooms/footing3d.js —
   every machine's support in one mesh per material) counts as one box per envelope, never its
   room-wide bounds */
export function roomSolids(group, floor = STAGE.FLOOR){
  const out = [];
  if (!group || !group.visible) return out;
  group.updateWorldMatrix(true, true);
  group.traverse(o => {
    if (!(o.isMesh || o.isInstancedMesh) || !o.geometry) return;
    for (let p = o; p && p !== group.parent; p = p.parent) if (!p.visible) return;
    const m = [].concat(o.material)[0];
    if (!m || m.transparent || glowy(m) || m.side === THREE.BackSide || m.isShaderMaterial) return;
    if (Array.isArray(o.userData.boxes)){
      for (const b of o.userData.boxes) if (b[3] >= floor + 1) out.push({ c: o, box: b, room: true });
      return;
    }
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    const n = o.isInstancedMesh ? o.count : 1;
    for (let i = 0; i < n; i++){
      _b.copy(o.geometry.boundingBox);
      if (o.isInstancedMesh){ o.getMatrixAt(i, _m); _b.applyMatrix4(_m); }
      _b.applyMatrix4(o.matrixWorld);
      if (_b.max.x - _b.min.x > 40 || _b.max.z - _b.min.z > 40) continue;       // the hall's shell, not a standing obstacle
      if (_b.max.y < floor + 1) continue;                                      // flush with the floor
      out.push({ c: o, box: arr(_b), room: true });
    }
  });
  return out;
}

/* the belt's FOLLOW offsets, one stable object per song (camera.js holds it; a room swap
   re-solves INTO it). land / portrait: [ox, oy, oz]; boxes: every non-belt solid (camera.js
   keeps a pulled-back eye clear of them); blocked(e, d, far): a real-mesh sight test. */
export function makeFollow(){
  let st = null; const memo = {};
  const get = cls => (memo[cls] ??= st?.solve ? st.solve(cls === 'portrait', st.prev?.[cls]) : null);
  return {
    reset(s){ st = s; for (const k in memo) delete memo[k]; },
    get land(){ return get('land')?.off ?? null; }, get portrait(){ return get('portrait')?.off ?? null; },
    get rays(){ return [memo.land?.rays, memo.portrait?.rays]; },
    all(){ get('land'); get('portrait'); return this; },
    get boxes(){ return st?.boxes || []; },
    blocked(e, d, far){ return !!st && st.blocked(e, d, far); },
  };
}

/* ctx: { world, roomGroup, footGroup (what the machines stand on), belts:Set, wall:[6]|null, stageY,
          room:{x0..z1} (eye bounds), camera, drawn, follow (makeFollow()), solveFollowNow:bool } */
export function scene(ctx){
  const { world, drawn, camera } = ctx;
  const kids = [];
  for (const c of world.children){
    const b = new THREE.Box3(); c.updateWorldMatrix(true, true);
    c.traverse(o => { if ((o.isMesh || o.isInstancedMesh || o.isLine) && o.geometry && drawn(o)){
      if (o.isInstancedMesh){ if (!o.count) return; o.computeBoundingBox(); b.union(_b.copy(o.boundingBox).applyMatrix4(o.matrixWorld)); }
      else { if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); b.union(_b.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld)); } } });
    if (b.isEmpty()) continue;
    kids.push({ c, box: arr(b), solid: solidBox(c, drawn) });
  }
  // per-MESH entries (the sight tests' finer prefilter: a ray through a kit's overall box but
  // between its parts raycasts nothing)
  const meshes = c => { const out = [];
    c.traverse(o => { if (!(o.isMesh || o.isInstancedMesh) || !o.geometry || !drawn(o) || glowy([].concat(o.material)[0])) return;
      if (o.isInstancedMesh){ if (!o.count) return; o.computeBoundingBox(); _b.copy(o.boundingBox); }
      else { if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); _b.copy(o.geometry.boundingBox); }
      out.push({ c: o, box: arr(_b.applyMatrix4(o.matrixWorld)), leaf: true }); });
    return out; };
  const solids = roomSolids(ctx.roomGroup).concat(roomSolids(ctx.footGroup));
  const top = o => { while (o.parent && o.parent !== world) o = o.parent; return o; };
  // the first real hit along a ray among the entries whose box it crosses (AABB prefilter)
  const firstHit = (list, e, d, far, skip = null) => {
    const near = new Set();
    for (const k of list) if (k.c !== skip && rayBox(e, d, k.box) < far) near.add(k.c);
    if (!near.size) return null;
    _ray.set(_o.fromArray(e), _d.fromArray(d)); _ray.far = far; _ray.camera = camera;
    return _ray.intersectObjects([...near], true).find(i => (i.object.isMesh || i.object.isInstancedMesh) && drawn(i.object) && !glowy(i.object.material)) || null;
  };
  // ANY real hit (no ordering needed): each crossed entry alone, cheapest box first, out at the first
  const anyHit = (list, e, d, far) => {
    const near = [];
    for (const k of list) { const t = rayBox(e, d, k.box); if (t < far) near.push([t, k.c]); }
    if (!near.length) return false;
    near.sort((a, b) => a[0] - b[0]);
    _ray.set(_o.fromArray(e), _d.fromArray(d)); _ray.far = far; _ray.camera = camera;
    const seen = new Set();
    for (const [, c] of near){ if (seen.has(c)) continue; seen.add(c);
      if (_ray.intersectObject(c, false).some(i => (i.object.isMesh || i.object.isInstancedMesh) && drawn(i.object) && !glowy(i.object.material))) return true; }
    return false;
  };
  const all = kids.concat(solids);
  // does this ray hit anything but `self` first — another machine or the room?
  // (the station itself is raycast only when something else is hit — and only up to that hit:
  // most probe rays end on their own subject, and it is the heaviest mesh in the line)
  const blockedFor = self => {
    const mine = kids.filter(k => k.c === self);
    return (e, d, far) => {
      const h = firstHit(all, e, d, far, self);
      if (!h) return false;
      return !(mine.length && firstHit(mine, e, d, h.distance));
    };
  };
  return { kids, solids, all, firstHit, anyHit, blockedFor, meshes };
}

/* one station's eye + its portrait pull-back cap. keep: the current eye, kept if still clean. */
function solveOne(sh, S, room, keep){
  const blocked = S.blockedFor(sh.self);
  const others = S.kids.filter(k => k.c !== sh.self && k.solid).map(k => k.solid).concat(S.solids.map(s => s.box));
  const own = S.kids.find(k => k.c === sh.self);
  const ownBox = own?.solid || own?.box;
  const aim = sh.aim.toArray();
  const clean = e => !others.some(b => boxDist(e, b) < 1.2) && blockedRays(e, aim, blocked) <= CLEAR_RAYS && foreground(e, aim, blocked) <= FG_MAX;
  sh._kept = !!keep && clean(sh.eye.toArray());
  if (!sh._kept){
    const r = solveShotEye({ aim, pref: sh.pref.toArray(), room, blocked, others, subject: ownBox ? boxPts(ownBox, sh.aim.y - 4) : null });
    sh.eye.fromArray(r.eye); sh.rays = r.rays; sh.fg = +r.fg.toFixed(2); sh.pk = r.pk ?? 1;
  }
  // (a room swap: an eye kept as clean keeps its phone framing too, while that is still clean)
  if (sh._kept && sh._phone){
    const pe = sh._phone.eye;
    if (!others.some(b => boxDist(pe, b) < 1.2) && blockedRays(pe, aim, blocked) <= CLEAR_RAYS && foreground(pe, aim, blocked, FG_TALL) <= sh._phone.fg + 1e-9) return;
  }
  // the portrait pull-back (camera.js: (1.5 / aspect)^.6 — ≈ 2.03 on a phone, ≤ PULL_MAX on any
  // screen): the farthest step whose eye stays in clear air, SEES its station, and doesn't walk a
  // neighbour into the tall frame's foreground (edge rays at a phone's aspect). Farthest first —
  // the common case (all clear) costs one probe, not seven.
  // (the phone's pull-back is relative to the DESIGNER's distance: an eye fitPref already walked
  //  back by pk for the desktop's button row backs off pk less — they never stack)
  const pk = sh.pk ?? 1, PF = Math.max(1, PHONE_FIT / pk), PM = Math.max(1, PULL_MAX / pk);
  const off = sh.eye.clone().sub(sh.aim);
  const at = q => sh.aim.clone().addScaledVector(off, q).toArray();
  // (portrait clutter is judged over the whole tall frame — FG_TALL: nearer than .8 × the aim's depth —
  // RELATIVE to the designer's own k = 1 frame: the pull-back may add none)
  let fg1 = null, k = 1;
  for (let q = PM; q > 1.01; q -= .25){
    const e = at(q);
    if (others.some(b => boxDist(e, b) < 1.2) || blockedRays(e, aim, blocked) > CLEAR_RAYS) continue;
    fg1 ??= foreground(at(1), aim, blocked, FG_TALL);
    if (foreground(e, aim, blocked, FG_TALL) > fg1 + .5 / FG_TALL.pts.length) continue;
    k = q; break;
  }
  // …and when its own line can't back off far enough for a phone, or the phone's frame along it
  // still holds a neighbour's housing in the foreground (a tall frame shows far more floor), the
  // phone gets its OWN solved eye: the same ring search from the pulled-back preference, judged at
  // the phone's aspect over the whole frame (camera.js takes shot.portrait on a narrow screen)
  delete sh.portrait;
  const kOn = Math.min(roomFit(sh.aim, sh.eye, room), k), short = kOn < PF * .9;   // (a few % short just crops a sliver: not worth a new angle)
  const fgOn = foreground(at(Math.min(kOn, PF)), aim, blocked, FG_TALL);    // what a phone sees by default
  if (short || fgOn > FG_TALL.max){
    const subject = ownBox ? boxPts(ownBox, sh.aim.y - 4) : null;
    const r = solveShotEye({ aim, pref: at(PF), room, blocked, others, subject, aspect: FG_TALL.aspect, fgNear: FG_TALL.near, fgPts: FG_TALL.pts, fgMax: FG_TALL.max, fgBudget: 16, maxCands: 70, fit: false, bottom: 0 });   // (a phone pulls back its own way)
    // (short: any clean-enough eye beats a cramped one; cluttered: only a clearly cleaner one — ≥ 2 rays —
    // is worth leaving the designer's angle for)
    if (!r.none && r.rays <= CLEAR_RAYS && (short ? (r.fg <= FG_TALL.max || r.fg < fgOn) : r.fg <= fgOn - 2 / FG_TALL.pts.length + 1e-9))
      sh.portrait = { key: sh.key, eye: new THREE.Vector3().fromArray(r.eye), aim: sh.aim, fitMax: 1, fg: +r.fg.toFixed(2) };
  }
  sh.fitMax = kOn;
  const pe = sh.portrait ? sh.portrait.eye.toArray() : at(Math.min(kOn, PF));
  sh._phone = { eye: pe, fg: Math.max(FG_TALL.max, sh.portrait ? sh.portrait.fg : fgOn) };
}
function roomFit(aim, eye, room){
  const d = eye.clone().sub(aim); let k = Infinity;
  const lim = (a, v, lo, hi) => { if (v > 1e-6) k = Math.min(k, (hi - a) / v); else if (v < -1e-6) k = Math.min(k, (lo - a) / v); };
  lim(aim.x, d.x, room.x0, room.x1); lim(aim.y, d.y, room.y0, room.y1); lim(aim.z, d.z, room.z0, room.z1);
  return Math.max(1, k);
}

function followState(S, ctx, prev){
  const bk = S.kids.filter(k => !ctx.belts.has(k.c)), list = bk.flatMap(k => S.meshes(k.c)).concat(S.solids);
  const boxes = bk.filter(k => k.solid).map(k => k.solid).concat(S.solids.map(s => s.box));
  const blocked = (e, d, far) => S.anyHit(list, e, d, far);       // the real meshes of everything but the belt
  const solve = ctx.wall ? (portrait, prefer) => solveFollow({ wall: ctx.wall, boxes, stageY: ctx.stageY,
    backs: portrait ? [2.4, 3.2] : [1, 1.6], room: ctx.room, blocked, portrait, prefer, pose: ctx.pose || null }) : null;
  return { boxes, blocked, solve, prev };
}

export function solveShots(shots, ctx){
  const t0 = performance.now(), S = scene(ctx), t1 = performance.now();
  shots.forEach(sh => { sh.pref ??= sh.eye.clone(); solveOne(sh, S, ctx.room, false); });
  const t2 = performance.now();
  ctx.follow.reset(followState(S, ctx, null));
  if (shots.length && ctx.wall) ctx.follow.all();              // both aspect classes now: a phone turning never hitches
  const t3 = performance.now(), r = v => +v.toFixed(1);
  return { ms: r(t3 - t0), split: [r(t1 - t0), r(t2 - t1), r(t3 - t2)], solids: S.solids.length };
}

export function resolveRoom(shots, ctx){
  const t0 = performance.now(), S = scene(ctx);
  shots.forEach(sh => { sh.pref ??= sh.eye.clone(); solveOne(sh, S, ctx.room, true); });
  const f = ctx.follow, prev = shots.length && ctx.wall ? { land: f.land, portrait: f.portrait } : null;
  f.reset(followState(S, ctx, prev));
  if (prev) f.all();                                           // (the previous offsets are tried first: a clean one is kept at once)
  return { ms: +(performance.now() - t0).toFixed(1), solids: S.solids.length, kept: shots.filter(sh => sh._kept).length };
}
