import * as THREE from 'three';
/* ============================================================
   XR BATCH — the machines' parts, drawn as ONE call per look (headset render only).

   Every machine part is already a pure function of songTime: its matrixWorld is simply where the
   owner put it this frame. So for the headset render we MIRROR it: every opaque mesh in the world
   that shares a look (material) + vertex layout with others is an instance in a THREE.BatchedMesh,
   and each frame its instance matrix = the part's matrixWorld and its visibility = the part's own
   (ancestors + material gate included). The originals are hidden for that one render and shown
   again right after. Nothing the owners do changes: they still move their own meshes; the batch
   only copies what they did (no state of its own beyond the copy — time is still the only state).

   Why: three r184's WebGLRenderer has no multiview, so each object is drawn once PER EYE. A full
   room's ~800 parts collapse to a few dozen multi-draws per eye (+ whatever is flashing).

   LOOKS: parts with ONE shared material batch with it (its live changes are everyone's). Parts
   with separately-made materials that look identical (every serialisable property equal — a
   plugin that makes one material per plate so each can flash on its own) batch with a frozen
   copy; each part rides along only while its own animated fields (sameLook) still match — a
   plate mid-flash simply draws as itself that frame.

   Eligible: plain opaque Mesh (not instanced / skinned / batched), a single built-in material
   without onBeforeCompile hooks or custom onBeforeRender, no morph targets, a mirror-free matrix,
   and at least one other part with the same look + attribute layout + renderOrder. A part whose
   geometry, material or parent is swapped after the build drops out (its original draws) and
   the batch is re-built (main: when the world changes, or enough parts dropped out).
   ============================================================ */

const OBC = THREE.Material.prototype.onBeforeCompile;
const OBR = THREE.Object3D.prototype.onBeforeRender;

/* the vertex layout + draw state a batch shares (null = not batchable) */
export function layoutKey(o){
  if (!o.isMesh || o.isInstancedMesh || o.isBatchedMesh || o.isSkinnedMesh || o.isReflector) return null;
  if (o.userData.xrNoBatch || o.onBeforeRender !== OBR) return null;
  const m = o.material, g = o.geometry;
  if (!m || Array.isArray(m) || m.isShaderMaterial || m.transparent || m.onBeforeCompile !== OBC) return null;
  if (!g || !g.attributes.position || (g.morphAttributes && Object.keys(g.morphAttributes).length)) return null;   // (geometry.groups only matter with a material ARRAY — excluded)
  if (g.drawRange && (g.drawRange.start !== 0 || g.drawRange.count !== Infinity)) return null;
  const attrs = Object.keys(g.attributes).sort().map(k => { const a = g.attributes[k];
    return a.isInterleavedBufferAttribute ? null : `${k}:${a.itemSize}${a.normalized ? 'n' : ''}:${a.array.constructor.name}`; });
  if (attrs.includes(null)) return null;
  return `${attrs.join(',')}|${g.index ? 'i' + g.index.array.constructor.name : 'n'}|${o.renderOrder}`;
}

/* a material's whole LOOK as a string (every serialisable property — maps by uuid — minus its
   identity), so two separately-made materials that render identically share a batch.
   Cached per material per build. */
const SKIP = new Set(['uuid', 'id', 'name', 'userData', 'version', '_listeners']);
const val = v => v === null || v === undefined ? String(v)
  : typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string' ? String(v)
  : v.isTexture ? 'T' + v.uuid
  : v.isColor ? 'C' + v.r + ',' + v.g + ',' + v.b
  : v.isVector2 || v.isVector3 || v.isVector4 || v.isEuler || v.isQuaternion || v.isMatrix3 || v.isMatrix4 ? (v.toArray ? v.toArray().join(',') : '?')
  : Array.isArray(v) ? '[' + v.map(val).join(',') + ']'
  : typeof v === 'function' ? 'f'
  : typeof v === 'object' ? '{' + Object.keys(v).sort().map(k => k + ':' + val(v[k])).join(',') + '}'
  : '?';
export function lookKey(m, cache = null){
  if (cache?.has(m)) return cache.get(m);
  let k = m.type;                                       // (every own property; maps by uuid — never serialises an image)
  for (const p of Object.keys(m).sort()) if (!SKIP.has(p)) k += '|' + p + '=' + val(m[p]);
  cache?.set(m, k);
  return k;
}

/* the fields owners ANIMATE (flashes, fades, tints): a part with its own material stays in the
   batch only while these match the batch's frozen copy (and the material was never re-flagged) */
export function sameLook(a, b, ver = a.version){
  return a.version === ver &&
    a.color?.r === b.color?.r && a.color?.g === b.color?.g && a.color?.b === b.color?.b &&
    a.emissive?.r === b.emissive?.r && a.emissive?.g === b.emissive?.g && a.emissive?.b === b.emissive?.b &&
    a.emissiveIntensity === b.emissiveIntensity && a.opacity === b.opacity &&
    a.roughness === b.roughness && a.metalness === b.metalness && a.envMapIntensity === b.envMapIntensity &&
    a.map === b.map && a.emissiveMap === b.emissiveMap && a.transparent === b.transparent;
}

/* group the batchable parts under `root` → Map key → [mesh] (only groups of ≥ min parts;
   mirrored (negative-determinant) parts excluded — winding is per batch) */
export function batchGroups(root, min = 2){
  const groups = new Map(), cache = new Map();
  root.updateMatrixWorld(true);
  root.traverse(o => {
    const k = layoutKey(o);
    if (!k || o.matrixWorld.determinant() < 0) return;
    const key = k + '|' + lookKey(o.material, cache);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(o);
  });
  for (const [k, list] of groups) if (list.length < min) groups.delete(k);
  return groups;
}

export function makeXRBatch(){
  const holder = new THREE.Group(); holder.name = 'xr-batch';
  holder.matrixAutoUpdate = false;
  let entries = [], batches = [], root = null;
  const undo = [];
  let stale = 0, own = 0, drawn = 0;

  function dispose(){
    for (const b of batches){ holder.remove(b); b.dispose(); if (b.userData.ownMat) b.material.dispose(); }
    batches = []; entries = []; root = null;
  }
  function build(world){
    dispose(); root = world; stale = 0;
    if (!world) return 0;
    for (const list of batchGroups(world).values()){
      const geos = [...new Set(list.map(o => o.geometry))];
      const nv = geos.reduce((s, g) => s + g.attributes.position.count, 0);
      const ni = geos.reduce((s, g) => s + (g.index ? g.index.count : 0), 0);
      const shared = list.every(o => o.material === list[0].material);
      const mat = shared ? list[0].material : list[0].material.clone();
      let b = null;
      try {
        b = new THREE.BatchedMesh(list.length, nv, ni || undefined, mat);
        b.userData.ownMat = !shared;
        const gid = new Map(geos.map(g => [g, b.addGeometry(g)]));
        b.sortObjects = false;                          // opaque only: the depth buffer sorts
        b.renderOrder = list[0].renderOrder;
        b.frustumCulled = false;                        // (per-instance culling inside, per eye)
        b.name = 'xr-batch:' + (list[0].material.name || list[0].material.type);
        for (const o of list){
          const id = b.addInstance(gid.get(o.geometry));
          const chain = []; for (let p = o.parent; p && p !== world.parent; p = p.parent) chain.push(p);
          entries.push({ o, b, id, geo: o.geometry, mat: o.material, ver: o.material.version, shared, chain, parent: o.parent, gone: false });
        }
      } catch(e){                                       // (a layout the batch refuses: those parts just draw as before)
        if (b) entries = entries.filter(x => x.b !== b);
        b?.dispose(); if (!shared) mat.dispose(); continue;
      }
      batches.push(b); holder.add(b);
    }
    return entries.length;
  }
  /* right before the headset render (matrixWorld must be current): copy pose + visibility,
     hide the originals the batch now draws */
  function before(){
    undo.length = 0; own = 0;
    for (let i = 0; i < entries.length; i++){
      const e = entries[i], o = e.o;
      if (o.geometry !== e.geo || o.material !== e.mat || o.parent !== e.parent){   // swapped / moved out: the original draws
        if (!e.gone){ e.gone = true; stale++; e.b.setVisibleAt(e.id, false); }
        continue;
      }
      let vis = o.visible && e.mat.visible;
      for (let k = 0, L = e.chain.length; vis && k < L; k++)   // every ancestor shown AND still attached (a rebuilt kit leaves its old group behind)
        vis = e.chain[k].visible && (k === L - 1 || e.chain[k].parent === e.chain[k + 1]);
      if (vis && !e.shared && !sameLook(e.mat, e.b.material, e.ver)){ e.b.setVisibleAt(e.id, false); own++; continue; }   // mid-flash: drawn as itself
      e.b.setVisibleAt(e.id, vis);
      if (!vis) continue;
      e.b.setMatrixAt(e.id, o.matrixWorld);
      o.visible = false; undo.push(o);
    }
    drawn = undo.length;
  }
  function after(){ for (let i = 0; i < undo.length; i++) undo[i].visible = true; undo.length = 0; }
  return {
    group: holder, build, before, after, dispose,
    get root(){ return root; },
    get stale(){ return stale; },                      // parts that dropped out since the build (a re-build re-takes them)
    get stats(){ return { batches: batches.length, parts: entries.length, drawn, own, stale }; },
  };
}
