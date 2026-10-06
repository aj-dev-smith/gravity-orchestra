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
   transparent, instanced/skinned/morphed, multi-material, mirrored, has
   a custom shader (ShaderMaterial or onBeforeCompile: it may read
   object-space positions), its own onBeforeRender, or opts out with
   userData.noMerge (on the mesh or its material). Materials are SHARED,
   not copied, so a material a plugin animates (an emissive flash on a
   shared frame material) still animates the merged mesh. A plugin that
   moves a part only at a moment the sampling misses must set noMerge.
   ============================================================ */
const DEFAULT_OBC = THREE.Material.prototype.onBeforeCompile;
const DEFAULT_OBR = THREE.Object3D.prototype.onBeforeRender;

function mergeable(o){
  if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || !o.geometry?.attributes?.position) return false;
  if (o.userData.noMerge || o.morphTargetInfluences || o.onBeforeRender !== DEFAULT_OBR) return false;
  const m = o.material;
  if (!m || Array.isArray(m) || m.transparent || m.isShaderMaterial || m.userData?.noMerge) return false;
  if (m.onBeforeCompile !== DEFAULT_OBC) return false;
  if (!(m.isMeshStandardMaterial || m.isMeshBasicMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial)) return false;
  if (o.geometry.groups?.length > 1 || Object.keys(o.geometry.morphAttributes || {}).length) return false;
  return true;
}
const drawnUnder = (o, root) => { for (let p = o; p; p = p.parent){ if (!p.visible) return false; if (p === root) return true; } return true; };

/** root: a built station group (already placed). pose(t): poses it at songTime t (a pure fn).
    times: the songTimes to prove stillness over. rest (optional): re-poses the station for
    the count-in after the sweep — given it, every part whose LOCAL transform held still across
    the sweep AND the rest pose is also FROZEN (see freezeStill). Returns { merged, removed, frozen }. */
export function mergeStatic(root, pose, times, rest){
  root.updateMatrixWorld(true);
  const cand = [], locals = [];
  root.traverse(o => { if (o !== root && mergeable(o)) cand.push({ o, m: o.matrixWorld.clone(), v: drawnUnder(o, root), live: true });
                       if (rest) locals.push({ o, m: o.matrix.clone(), still: true }); });
  for (const t of (cand.length >= 2 || rest) ? times : []){
    pose(t);
    root.updateMatrixWorld(true);
    for (const c of cand) if (c.live && (!c.m.equals(c.o.matrixWorld) || drawnUnder(c.o, root) !== c.v)) c.live = false;
    for (const l of locals) if (l.still && !l.m.equals(l.o.matrix)) l.still = false;
  }
  const res = cand.length < 2 ? { merged: 0, removed: 0 } : mergeStill(root, pose, times, cand);
  if (rest){ rest(); res.frozen = freezeStill(root, locals); }
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
  const freeze = o => { if (!o.matrixAutoUpdate || blocked.has(o) || fx(o)) return; o.matrixAutoUpdate = false; FROZEN.push(o); n++; };
  for (const l of locals) if (l.still && l.o.matrix.equals(l.m) && (l.o === root || isUnder(l.o, root))) freeze(l.o);
  root.traverse(o => { if (o.name === 'merged-static') freeze(o); });   // (built still)
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
