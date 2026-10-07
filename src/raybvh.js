import * as THREE from 'three';

/* ============================================================
   RAY BVH — the same raycast answers, without testing every triangle.

   A song load raycasts the whole room thousands of times (the director's
   shot solve, the wide's occlusion search, the room re-check): three.js tests
   EVERY triangle of every mesh whose bounds a ray crosses, and the big meshes
   (a merged station frame, a room's hull, a long string) span everything.
   This keeps a bounding-volume hierarchy per big static geometry and walks
   only the boxes a ray crosses. The hits are the SAME hits — every triangle
   whose box the ray reaches is tested with three's own Ray.intersectTriangle
   under three's own side rule and near/far — so a shot solve picks the same
   eye with or without it. Render-time only; nothing about the scene changes.

   Scope (anything else takes three's own path, untouched): a plain Mesh (not
   instanced / skinned / morphed), one material, no groups, the full draw range,
   ≥ MIN_TRIS triangles. A geometry whose positions are edited (attribute version
   moves) is re-indexed lazily — only once it has been raycast twice at the same
   version, so a mesh animated on the CPU every frame keeps the brute-force path.
   Hit objects carry { distance, point, object, face, faceIndex } (no uv/normal:
   nothing in the app reads them; three's path still supplies them where it runs).
   ============================================================ */
const MIN_TRIS = 512, LEAF = 6;
const base = THREE.Mesh.prototype.raycast;
const cache = new WeakMap();                 // geometry → { ver, seen, bvh }
let stats = { built: 0, fast: 0, slow: 0 };

function eligible(m){
  if (m.isInstancedMesh || m.isSkinnedMesh || m.morphTargetInfluences || Array.isArray(m.material) || !m.material) return false;
  const g = m.geometry, pos = g?.attributes?.position;
  if (!pos || pos.isInterleavedBufferAttribute || (g.groups && g.groups.length) || Object.keys(g.morphAttributes || {}).length) return false;
  const n = g.index ? g.index.count : pos.count;
  if (g.drawRange.start !== 0 || g.drawRange.count < n) return false;
  return n / 3 >= MIN_TRIS;
}

function build(g){
  const pos = g.attributes.position, idx = g.index, n = (idx ? idx.count : pos.count) / 3 | 0;
  const tri = new Uint32Array(n * 3), box = new Float32Array(n * 6), cen = new Float32Array(n * 3);
  for (let t = 0; t < n; t++){
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let k = 0; k < 3; k++){
      const v = idx ? idx.getX(t * 3 + k) : t * 3 + k; tri[t * 3 + k] = v;
      const x = pos.getX(v), y = pos.getY(v), z = pos.getZ(v);
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    box.set([x0, y0, z0, x1, y1, z1], t * 6); cen[t * 3] = (x0 + x1) / 2; cen[t * 3 + 1] = (y0 + y1) / 2; cen[t * 3 + 2] = (z0 + z1) / 2;
  }
  const order = new Uint32Array(n); for (let i = 0; i < n; i++) order[i] = i;
  const nb = [], kids = [], span = [];                  // node box (6), [left, right] (−1 = leaf), [start, count]
  const node = (s, c) => {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    let cx0 = Infinity, cy0 = Infinity, cz0 = Infinity, cx1 = -Infinity, cy1 = -Infinity, cz1 = -Infinity;
    for (let i = s; i < s + c; i++){ const t = order[i], b = t * 6;
      x0 = Math.min(x0, box[b]); y0 = Math.min(y0, box[b + 1]); z0 = Math.min(z0, box[b + 2]);
      x1 = Math.max(x1, box[b + 3]); y1 = Math.max(y1, box[b + 4]); z1 = Math.max(z1, box[b + 5]);
      const q = t * 3; cx0 = Math.min(cx0, cen[q]); cx1 = Math.max(cx1, cen[q]); cy0 = Math.min(cy0, cen[q + 1]); cy1 = Math.max(cy1, cen[q + 1]); cz0 = Math.min(cz0, cen[q + 2]); cz1 = Math.max(cz1, cen[q + 2]); }
    const id = nb.length / 6; nb.push(x0, y0, z0, x1, y1, z1); kids.push(-1, -1); span.push(s, c);
    if (c <= LEAF) return id;
    const ex = [cx1 - cx0, cy1 - cy0, cz1 - cz0], ax = ex[0] >= ex[1] && ex[0] >= ex[2] ? 0 : ex[1] >= ex[2] ? 1 : 2;
    if (ex[ax] <= 0) return id;                          // (all centroids coincide: one leaf)
    const mid = [cx0 + cx1, cy0 + cy1, cz0 + cz1][ax] / 2;
    let i = s, j = s + c - 1;
    while (i <= j){ if (cen[order[i] * 3 + ax] < mid) i++; else { const tmp = order[i]; order[i] = order[j]; order[j] = tmp; j--; } }
    let m = i - s; if (m === 0 || m === c) m = c >> 1;   // (degenerate split: halve)
    const L = node(s, m), R = node(s + m, c - m);
    kids[id * 2] = L; kids[id * 2 + 1] = R;
    return id;
  };
  node(0, n);
  return { tri, order, nb: new Float32Array(nb), kids: new Int32Array(kids), span: new Uint32Array(span) };
}

// ray (local) vs node box (slab test): does the ray meet the box at some t ≥ 0? CONSERVATIVE —
// a tie or an axis-parallel ray counts as a hit (a false "maybe" only costs a triangle test;
// far is judged per hit in WORLD units, exactly as three does)
function hitBox(nb, i, o, d){
  const b = i * 6;
  let tmin = -Infinity, tmax = Infinity;
  for (let a = 0; a < 3; a++){
    const lo = nb[b + a] - 1e-7, hi = nb[b + 3 + a] + 1e-7, oa = o[a], da = d[a];
    if (da === 0){ if (oa < lo || oa > hi) return false; continue; }
    let t1 = (lo - oa) / da, t2 = (hi - oa) / da;
    if (t1 > t2){ const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2;
    if (tmin > tmax + 1e-9) return false;
  }
  return tmax >= -1e-9;
}

const _inv = new THREE.Matrix4(), _ray = new THREE.Ray(), _sphere = new THREE.Sphere(), _at = new THREE.Vector3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _p = new THREE.Vector3(), _w = new THREE.Vector3();
const stack = [];
function fastRaycast(raycaster, intersects){
  const g = this.geometry, material = this.material, pos = g.attributes.position;
  let e = cache.get(g);
  if (!e || e.ver !== pos.version){ e = { ver: pos.version, seen: 0, bvh: null }; cache.set(g, e); }
  if (!e.bvh && ++e.seen < 2){ stats.slow++; return base.call(this, raycaster, intersects); }
  if (!e.bvh){ e.bvh = build(g); stats.built++; }
  stats.fast++;
  // three's own culls, verbatim: world bounding sphere (from near), then the local bounding box
  if (g.boundingSphere === null) g.computeBoundingSphere();
  _sphere.copy(g.boundingSphere).applyMatrix4(this.matrixWorld);
  _ray.copy(raycaster.ray).recast(raycaster.near);
  if (_sphere.containsPoint(_ray.origin) === false){
    if (_ray.intersectSphere(_sphere, _at) === null) return;
    if (_ray.origin.distanceToSquared(_at) > (raycaster.far - raycaster.near) ** 2) return;
  }
  _inv.copy(this.matrixWorld).invert();
  _ray.copy(raycaster.ray).applyMatrix4(_inv);
  if (g.boundingBox !== null && _ray.intersectsBox(g.boundingBox) === false) return;
  const { tri, order, nb, kids, span } = e.bvh;
  const o = [_ray.origin.x, _ray.origin.y, _ray.origin.z], d = [_ray.direction.x, _ray.direction.y, _ray.direction.z];
  const back = material.side === THREE.BackSide, cull = material.side === THREE.FrontSide;
  stack.length = 0; stack.push(0);
  while (stack.length){
    const i = stack.pop();
    if (!hitBox(nb, i, o, d)) continue;
    const L = kids[i * 2];
    if (L >= 0){ stack.push(kids[i * 2 + 1], L); continue; }
    for (let k = span[i * 2], end = k + span[i * 2 + 1]; k < end; k++){
      const t = order[k], va = tri[t * 3], vb = tri[t * 3 + 1], vc = tri[t * 3 + 2];
      _a.fromBufferAttribute(pos, va); _b.fromBufferAttribute(pos, vb); _c.fromBufferAttribute(pos, vc);
      const hit = back ? _ray.intersectTriangle(_c, _b, _a, true, _p) : _ray.intersectTriangle(_a, _b, _c, cull, _p);
      if (hit === null) continue;
      _w.copy(_p).applyMatrix4(this.matrixWorld);
      const distance = raycaster.ray.origin.distanceTo(_w);
      if (distance < raycaster.near || distance > raycaster.far) continue;
      const face = { a: va, b: vb, c: vc, normal: new THREE.Vector3(), materialIndex: 0 };
      THREE.Triangle.getNormal(_a, _b, _c, face.normal);
      intersects.push({ distance, point: _w.clone(), object: this, face, faceIndex: t });
    }
  }
}

/** Route every eligible Mesh raycast through the BVH (idempotent). */
export function installRayBVH(){
  if (THREE.Mesh.prototype.raycast !== base) return;
  THREE.Mesh.prototype.raycast = function(raycaster, intersects){
    return eligible(this) ? fastRaycast.call(this, raycaster, intersects) : base.call(this, raycaster, intersects);
  };
}
export function uninstallRayBVH(){ THREE.Mesh.prototype.raycast = base; }
export const rayBVHStats = () => ({ ...stats });
