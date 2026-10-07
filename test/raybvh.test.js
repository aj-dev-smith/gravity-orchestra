import { describe, it, expect, afterAll } from 'vitest';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { installRayBVH, uninstallRayBVH, rayBVHStats } from '../src/raybvh.js';

/* The BVH must give the SAME hits as three's brute force: same objects, same distances,
   same order — every way a shot solve could ask (near/far, sides, scaled/rotated meshes,
   indexed and not, rays from inside a mesh, axis-parallel rays). */
function rng(seed){ let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function scene(){
  const r = rng(7), root = new THREE.Group();
  const parts = [];
  for (let i = 0; i < 40; i++){
    const g = [new THREE.BoxGeometry(1, 2, 1, 4, 4, 4), new THREE.SphereGeometry(.8, 24, 16), new THREE.TorusGeometry(1, .2, 12, 48), new THREE.CylinderGeometry(.3, .5, 3, 24, 8)][i % 4];
    g.rotateX(r() * 6); g.translate(r() * 20 - 10, r() * 8, r() * 20 - 10); parts.push(i % 3 ? g : g.toNonIndexed());
  }
  const idx = parts.filter(g => g.index), non = parts.filter(g => !g.index);
  const sides = [THREE.FrontSide, THREE.DoubleSide, THREE.BackSide];
  [mergeGeometries(idx), mergeGeometries(non)].forEach((g, k) => {
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ side: sides[k] }));
    m.position.set(k * 3, -1, 2); m.rotation.set(.3, k * .7, .1); m.scale.set(1.2, .8 + k * .5, 1);
    root.add(m);
  });
  const third = new THREE.Mesh(mergeGeometries(idx.slice(0, 12)), new THREE.MeshBasicMaterial({ side: THREE.BackSide }));
  third.position.set(-4, 2, 0); root.add(third);
  root.updateMatrixWorld(true);
  return root;
}
const rays = (() => { const r = rng(99), out = [];
  for (let i = 0; i < 600; i++){
    const o = new THREE.Vector3(r() * 50 - 25, r() * 20 - 4, r() * 50 - 25);
    const d = i % 25 === 0 ? new THREE.Vector3(...[[1, 0, 0], [0, -1, 0], [0, 0, 1]][i % 3]) : new THREE.Vector3(r() - .5, r() - .5, r() - .5).normalize();
    if (i % 4 !== 3 && i % 25) d.copy(new THREE.Vector3(r() * 10 - 5, r() * 6, r() * 10 - 5).sub(o).normalize());   // aimed into the clutter
    out.push({ o, d, near: i % 7 === 0 ? 2 : 0, far: i % 5 === 0 ? 12 : Infinity });
  }
  return out; })();
const cast = (root, { o, d, near, far }) => { const rc = new THREE.Raycaster(o, d, near, far); return rc.intersectObject(root, true).map(h => [h.object.id, +h.distance.toFixed(9)]); };

describe('ray BVH', () => {
  afterAll(uninstallRayBVH);
  it('returns exactly the brute-force hits (objects, distances, order)', () => {
    const root = scene();
    const want = rays.map(q => cast(root, q));
    installRayBVH();
    const s0 = rayBVHStats();
    const got = rays.map(q => cast(root, q));
    expect(got).toEqual(want);
    expect(rayBVHStats().fast - s0.fast).toBeGreaterThan(500);   // the fast path actually ran
    expect(want.flat().length).toBeGreaterThan(200);                  // (and the rays really hit things)
  });
  it('re-indexes a geometry whose positions were edited', () => {
    installRayBVH();
    const g = new THREE.SphereGeometry(1, 32, 24), m = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
    m.updateMatrixWorld(true);
    const q = { o: new THREE.Vector3(0, 0, 5), d: new THREE.Vector3(0, 0, -1), near: 0, far: Infinity };
    cast(m, q); cast(m, q);
    expect(cast(m, q)[0][1]).toBeCloseTo(4, 3);
    g.translate(0, 0, 1); g.computeBoundingSphere(); g.computeBoundingBox();   // (translate bumps the position version)
    expect(cast(m, q)[0][1]).toBeCloseTo(3, 3);
    expect(cast(m, q)[0][1]).toBeCloseTo(3, 3);
  });
});
