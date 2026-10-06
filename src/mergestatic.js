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
    times: the songTimes to prove stillness over. Returns { merged, removed } counts. */
export function mergeStatic(root, pose, times){
  root.updateMatrixWorld(true);
  const cand = [];
  root.traverse(o => { if (o !== root && mergeable(o)) cand.push({ o, m: o.matrixWorld.clone(), v: drawnUnder(o, root), live: true }); });
  if (cand.length < 2) return { merged: 0, removed: 0 };
  for (const t of times){
    pose(t);
    root.updateMatrixWorld(true);
    for (const c of cand) if (c.live && (!c.m.equals(c.o.matrixWorld) || drawnUnder(c.o, root) !== c.v)) c.live = false;
  }
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
