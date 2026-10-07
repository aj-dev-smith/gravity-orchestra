import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/* ============================================================
   MERGE STATIC — a render-time draw-call pass over one built station.
   Every machine is dozens of separate meshes (legs, rails, frames,
   spokes…), most of which never move. Time is the only state, so we can
   PROVE which ones never move: pose the station at many songTimes
   across the loop and keep only the meshes whose world matrix and
   drawn-ness never change. Those are baked into ONE mesh per material,
   in the station's own frame (the station never moves after staging).

   Conservative by construction — a mesh is left alone if it is
   transparent, instanced/skinned/morphed, multi-material (an ARRAY), mirrored, has
   a custom shader (ShaderMaterial or onBeforeCompile: it may read
   object-space positions), its own onBeforeRender, or opts out with
   userData.noMerge (on the mesh or its material). Materials are SHARED,
   not copied, so a material a plugin animates (an emissive flash on a
   shared frame material) still animates the merged mesh. A plugin that
   moves a part only at a moment the sampling misses must set noMerge.
   ============================================================ */
const DEFAULT_OBC = THREE.Material.prototype.onBeforeCompile;
const DEFAULT_OBR = THREE.Object3D.prototype.onBeforeRender;

/* (geometry GROUPS — a Box's 6 faces, a Cylinder's side + caps — only mean something to a material
   ARRAY: with one material three.js draws the whole draw range and ignores them, raycasts likewise.
   So a single-material part with groups merges like any other (the merged geometry has none);
   opts.groups = false restores the old refusal, for A/B.) */
function mergeable(o, groupsOK = true){
  if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || !o.geometry?.attributes?.position) return false;
  if (o.userData.noMerge || o.morphTargetInfluences || o.onBeforeRender !== DEFAULT_OBR) return false;
  const m = o.material;
  if (!m || Array.isArray(m) || m.transparent || m.isShaderMaterial || m.userData?.noMerge) return false;
  if (m.onBeforeCompile !== DEFAULT_OBC) return false;
  if (!(m.isMeshStandardMaterial || m.isMeshBasicMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial)) return false;
  if ((!groupsOK && o.geometry.groups?.length > 1) || Object.keys(o.geometry.morphAttributes || {}).length) return false;
  return true;
}
// a geometry's edit stamp: buffer versions only grow, so any CPU re-write (or a draw-range change) moves it
const geoVer = g => { let v = g.index ? g.index.version : 0; for (const k in g.attributes) v += g.attributes[k].version || 0; return `${g.id}|${v}|${g.drawRange.start}|${g.drawRange.count}`; };
const drawnUnder = (o, root) => { for (let p = o; p; p = p.parent){ if (!p.visible) return false; if (p === root) return true; } return true; };

/** root: a built station group (already placed). pose(t): poses it at songTime t (a pure fn).
    times: the songTimes to prove stillness over. rest (optional): re-poses the station for
    the count-in after the sweep — given it, every part whose LOCAL transform held still across
    the sweep AND the rest pose is also FROZEN (see freezeStill), and parts rigid on a moving carriage
    are baked onto it (mergeRigid; opts.rigid = false skips that). Returns { merged, removed, frozen, rigid }. */
export function mergeStatic(root, pose, times, rest, { rigid = true, groups = true, audit = null } = {}){
  root.updateMatrixWorld(true);
  const cand = [], locals = [];
  root.traverse(o => { if (o !== root && mergeable(o, groups)) cand.push({ o, m: o.matrixWorld.clone(), v: drawnUnder(o, root), mat: o.material, ver: geoVer(o.geometry), live: true, same: true });
                       if (rest) locals.push({ o, m: o.matrix.clone(), vis: o.visible, still: true, shown: true }); });
  for (const t of (cand.length >= 2 || rest) ? times : []){
    pose(t);
    root.updateMatrixWorld(true);
    for (const c of cand){
      // (same: the part itself never changes — its material is never swapped and its geometry never
      // re-written on the CPU (a deformed tine, a bent string) — a baked copy would freeze either)
      if (c.same && (c.o.material !== c.mat || geoVer(c.o.geometry) !== c.ver)) c.same = c.live = false;
      if (c.live && (!c.m.equals(c.o.matrixWorld) || drawnUnder(c.o, root) !== c.v)) c.live = false;
    }
    for (const l of locals){ if (l.still && !l.m.equals(l.o.matrix)) l.still = false; if (l.shown && l.o.visible !== l.vis) l.shown = false; }
  }
  // AUDIT (dev, opts.audit = a much denser set of times): re-run the proof over it BEFORE baking, then
  // report every part that was baked although the dense proof says it moves (the sweep missed it)
  let auditL2 = null;
  if (audit){
    for (const c of cand) c.ok2 = true;
    const L2 = new Map(locals.map(l => [l.o, true]));
    for (const t of audit){
      pose(t); root.updateMatrixWorld(true);
      for (const c of cand){
        if (!c.ok2) continue;
        if (c.o.material !== c.mat || geoVer(c.o.geometry) !== c.ver) c.ok2 = false;
        else if (c.live && (!c.m.equals(c.o.matrixWorld) || drawnUnder(c.o, root) !== c.v)) c.ok2 = false;
      }
      for (const l of locals) if (L2.get(l.o) && (!l.m.equals(l.o.matrix) || l.o.visible !== l.vis)) L2.set(l.o, false);
    }
    auditL2 = L2;
    pose(times[times.length - 1]); root.updateMatrixWorld(true);
  }
  const res = cand.length < 2 ? { merged: 0, removed: 0 } : mergeStill(root, pose, times, cand);
  if (rest){
    rest();
    res.rigid = rigid ? mergeRigid(root, cand, locals) : { merged: 0, removed: 0 };
    res.frozen = freezeStill(root, locals);
  }
  if (audit){
    const path = o => { const a = []; for (let p = o; p && p !== root; p = p.parent) a.push(p.name || p.type + (p.geometry ? ':' + p.geometry.type : '')); return a.join('<'); };
    res.audit = cand.filter(c => !c.o.parent && (!c.ok2 || (!c.live && c.chain.some(o => !auditL2.get(o))))).map(c => `${c.live ? 'still' : 'rigid'}:${path(c.o)}`);
  }
  return res;
}
function mergeStill(root, pose, times, cand){
  pose(times[0]);
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert(), groups = new Map(), _m = new THREE.Matrix4();
  for (const c of cand){
    if (!c.live || !c.v) continue;                       // (a part that is never drawn stays as it is)
    if (c.o.matrixWorld.determinant() < 0) continue;     // mirrored: merging would flip its winding
    const g = c.o.geometry, attrs = Object.keys(g.attributes).sort().join(',');
    const key = `${c.o.material.uuid}|${c.o.renderOrder}|${c.o.castShadow}|${c.o.receiveShadow}|${attrs}|${g.index ? 'i' : 'n'}`;
    (groups.get(key) || groups.set(key, []).get(key)).push(c.o);
  }
  let merged = 0, removed = 0;
  for (const list of groups.values()){
    if (list.length < 2) continue;
    const geos = list.map(o => o.geometry.clone().applyMatrix4(_m.multiplyMatrices(inv, o.matrixWorld)));
    const geo = mergeGeometries(geos, false);
    geos.forEach(g => g.dispose());
    if (!geo) continue;
    const src = list[0], mesh = new THREE.Mesh(geo, src.material);
    mesh.castShadow = src.castShadow; mesh.receiveShadow = src.receiveShadow; mesh.renderOrder = src.renderOrder;
    mesh.name = 'merged-static';
    for (const o of list) o.parent.remove(o);            // (never rendered yet: nothing uploaded to dispose)
    root.add(mesh);
    merged++; removed += list.length;
  }
  return { merged, removed };
}

/* ---- RIGID SUBASSEMBLIES: the same proof, one level down ----
   A part that rides a moving carriage (a drum head on its piston, a valve cap on its slide, a
   hammer on its arm) is NOT still in the world — but it is still RELATIVE to the carriage: its
   own transform and every transform between it and the carriage never change. Such parts are
   one rigid body, so they are baked the same way, one mesh per material, in the CARRIAGE'S
   frame and parented to it: the carriage's motion carries the merged mesh exactly as it carried
   the parts. The carriage ("anchor") is the nearest ancestor whose own transform moves.
   The proof runs over the sweep AND the count-in rest pose (a part that moves only while armed
   stays loose), drawn-ness must hold still on the whole path to the anchor (every object's
   own `visible` constant), and the material must never be swapped. Everything mergeable() bars
   stays barred (transparent, custom shaders, noMerge — and noMerge on any ancestor below the anchor). */
function mergeRigid(root, cand, locals){
  const L = new Map(locals.map(l => [l.o, l]));
  const still = o => { const l = L.get(o); return !!l && l.still && l.shown && l.m.equals(o.matrix); };
  root.updateMatrixWorld(true);
  const groups = new Map(), _m = new THREE.Matrix4();
  for (const c of cand){
    if (c.live || !c.same || !c.o.parent || !c.mat || c.o.material !== c.mat || geoVer(c.o.geometry) !== c.ver) continue;   // (world-still parts went to mergeStill)
    if (!still(c.o) || !c.o.visible) continue;
    let a = c.o.parent, ok = true;
    for (; a && a !== root; a = a.parent){
      if (a.userData.noMerge){ ok = false; break; }
      if (!still(a)) break;                               // the carriage: the first ancestor that moves
      if (!a.visible){ ok = false; break; }               // (never drawn: leave it as it is)
    }
    if (!ok || !a || a === root) continue;                // (a === root: the station itself never moves — mergeStill's case)
    c.chain = []; for (let p = c.o; p !== a; p = p.parent) c.chain.push(p);   // (the rigid path: the audit re-checks it)
    if (!L.has(a)) continue;
    const rel = _m.copy(a.matrixWorld).invert().multiply(c.o.matrixWorld);
    if (rel.determinant() < 0) continue;                  // mirrored: merging would flip its winding
    const g = c.o.geometry, attrs = Object.keys(g.attributes).sort().join(',');
    const key = `${a.id}|${c.o.material.uuid}|${c.o.renderOrder}|${c.o.castShadow}|${c.o.receiveShadow}|${c.o.frustumCulled}|${attrs}|${g.index ? 'i' : 'n'}`;
    (groups.get(key) || groups.set(key, { a, list: [] }).get(key)).list.push({ o: c.o, rel: rel.clone() });
  }
  let merged = 0, removed = 0;
  for (const { a, list } of groups.values()){
    if (list.length < 2) continue;
    const geos = list.map(({ o, rel }) => o.geometry.clone().applyMatrix4(rel));
    const geo = mergeGeometries(geos, false);
    geos.forEach(g => g.dispose());
    if (!geo) continue;
    const src = list[0].o, mesh = new THREE.Mesh(geo, src.material);
    mesh.castShadow = src.castShadow; mesh.receiveShadow = src.receiveShadow; mesh.renderOrder = src.renderOrder; mesh.frustumCulled = src.frustumCulled;
    mesh.name = 'merged-static';
    for (const { o } of list) o.parent.remove(o);
    a.add(mesh);
    merged++; removed += list.length;
  }
  return { merged, removed };
}

/* ---- FREEZE: the matrix half of the same proof ----
   three.js recomposes every object's local matrix and re-multiplies its world matrix EVERY
   frame (matrixAutoUpdate), and a parent that recomposes forces its whole subtree to
   re-multiply. A station is thousands of objects, most of which the sweep just proved never
   move — so they stop auto-updating (their matrices are correct as of the rest pose). The
   station root and the world above it never move either (main freezes those), so a still
   subtree under a still parent costs only the traversal.
   Exclusions: userData.noMerge (and everything under it), and the ancestors of any part that
   drives its own matrix by hand (matrixAutoUpdate already off and NOT still: it relies on its
   parent's world being re-pushed each frame).
   SAFETY NET (watchFrozen): the sweep samples the loop, so a part that moves only in a brief
   window between samples could be frozen by mistake. Every frame a slice of the frozen set is
   re-checked against its live position/quaternion/scale; a part found moving is thawed for
   good (a stale pose for a few frames, once, instead of a stuck part forever). */
const FROZEN = [];                                       // every part this page froze (pruned on rebuild)
let watchI = 0;
const _wm = new THREE.Matrix4();
function freezeStill(root, locals){
  root.updateMatrixWorld(true);
  const blocked = new Set();
  const block = o => { for (let p = o; p; p = p.parent){ if (blocked.has(p)) break; blocked.add(p); if (p === root) break; } };
  root.traverse(o => { if (o.userData.noMerge) o.traverse(c => blocked.add(c)); });
  for (const l of locals) if (!l.still && !l.o.matrixAutoUpdate) block(l.o);
  let n = 0;
  // effects (lights, sprites, points, see-through glows) are placed by STRIKES, which the sweep
  // does not fire — they are never frozen; the rest is guarded by watchFrozen
  const fx = o => o.isLight || o.isSprite || o.isPoints || [].concat(o.material || []).some(m => m.transparent);
  const freeze = o => { if (!o.matrixAutoUpdate || blocked.has(o) || fx(o)) return; o.matrixAutoUpdate = false; FROZEN.push(o); n++;
                       if (o === root) o.updateMatrixWorld = forcedUpdate; };
  for (const l of locals) if (l.still && l.o.matrix.equals(l.m) && (l.o === root || isUnder(l.o, root))) freeze(l.o);
  root.traverse(o => { if (o.name === 'merged-static') freeze(o); });   // (built still)
  return n;
}
/* A frozen STATION ROOT is the one frozen thing outside code is allowed to move (layout, the stage
   editor: set position/rotation, then updateMatrixWorld(true)). three.js skips the local matrix
   when matrixAutoUpdate is off, so a FORCED update on a frozen root recomposes it first — the
   editor's move/turn/measure then sees the truth without knowing about freezing. The per-frame
   render traversal never forces a still world, so this costs nothing while playing. */
function forcedUpdate(force){
  if (force && !this.matrixAutoUpdate) this.updateMatrix();
  return Object.getPrototypeOf(this).updateMatrixWorld.call(this, force);
}
/** Unfreeze a subtree for good (an editor about to animate parts by hand can call this; the next
    world rebuild re-proves and re-freezes). */
export function thaw(root){
  let n = 0; const f = new Set(FROZEN);
  root.traverse(o => { if (!o.matrixAutoUpdate && f.has(o)){ o.matrixAutoUpdate = true; n++; } });
  for (let i = FROZEN.length - 1; i >= 0; i--) if (FROZEN[i].matrixAutoUpdate) FROZEN.splice(i, 1);
  return n;
}
const isUnder = (o, root) => { for (let p = o.parent; p; p = p.parent) if (p === root) return true; return false; };

/** Per frame: re-check a slice of the frozen parts (all of them every 8 frames: a mis-frozen part
    is stale for ≤ ~130 ms, once). */
export function watchFrozen(per = 1 / 8){
  const N = FROZEN.length; if (!N) return 0;
  let thawed = 0;
  for (let k = Math.ceil(N * per); k > 0; k--){
    if (watchI >= FROZEN.length) watchI = 0;
    const o = FROZEN[watchI];
    _wm.compose(o.position, o.quaternion, o.scale);
    if (!_wm.equals(o.matrix)){ o.matrixAutoUpdate = true; FROZEN.splice(watchI, 1); thawed++; thawCount++; if (THAWED.length < 64) THAWED.push(o); }
    else watchI++;
  }
  return thawed;
}
let thawCount = 0;
const THAWED = [];                                      // dev: the first parts the net caught moving
/** On a world rebuild: forget parts that left the scene (the old song's stations). */
export function pruneFrozen(){
  for (let i = FROZEN.length - 1; i >= 0; i--){ let p = FROZEN[i]; while (p.parent) p = p.parent; if (!p.isScene) FROZEN.splice(i, 1); }
}
export const frozenStats = () => ({ frozen: FROZEN.length, thawed: thawCount, caught: THAWED });
