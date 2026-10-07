import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { mergeStatic, thaw, frozenStats, pruneFrozen } from '../src/mergestatic.js';

/* a station: a still frame (two legs) + one part that swings with songTime */
function station(){
  const root = new THREE.Group(), mat = new THREE.MeshStandardMaterial();
  const box = () => new THREE.BoxGeometry(1, 1, 1);
  const legA = new THREE.Mesh(box(), mat); legA.position.set(1, 0, 0);
  const legB = new THREE.Mesh(box(), mat); legB.position.set(-1, 0, 0);
  const arm = new THREE.Group(); const tip = new THREE.Mesh(box(), new THREE.MeshStandardMaterial()); tip.position.set(0, 2, 0);
  arm.add(tip); root.add(legA, legB, arm);
  const scene = new THREE.Scene(); scene.add(root);
  const pose = t => { arm.rotation.z = Math.sin(t); };
  return { root, arm, tip, scene, pose };
}
const times = Array.from({ length: 12 }, (_, k) => k * .5 + .1);

describe('mergeStatic freeze', () => {
  it('freezes the still parts and the root, never the mover', () => {
    const s = station();
    const r = mergeStatic(s.root, s.pose, times, () => s.pose(0));
    expect(r.frozen).toBeGreaterThan(0);
    expect(s.root.matrixAutoUpdate).toBe(false);
    expect(s.arm.matrixAutoUpdate).toBe(true);
    pruneFrozen();
  });
  it('a frozen station root still honours an editor move: set position/rotation + updateMatrixWorld(true)', () => {
    const s = station();
    mergeStatic(s.root, s.pose, times, () => s.pose(0));
    expect(s.root.matrixAutoUpdate).toBe(false);
    s.root.position.x = 5; s.root.rotation.y = Math.PI / 2;
    s.root.updateMatrixWorld(true);
    const p = new THREE.Vector3().setFromMatrixPosition(s.tip.matrixWorld);
    expect(p.x).toBeCloseTo(5, 5);
    // …and the un-turn → measure → re-turn the editor does sees the un-turned box
    s.root.rotation.y = 0; s.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(s.root);
    expect(box.max.x - box.min.x).toBeCloseTo(3, 3);
    pruneFrozen();
  });
  it('thaw() hands a subtree back to auto-update', () => {
    const s = station();
    mergeStatic(s.root, s.pose, times, () => s.pose(0));
    const before = frozenStats().frozen;
    expect(thaw(s.root)).toBeGreaterThan(0);
    expect(s.root.matrixAutoUpdate).toBe(true);
    expect(frozenStats().frozen).toBeLessThan(before);
  });
});

/* a CARRIAGE (a piston) that slides with songTime, carrying a rigid head (two parts, one material),
   a part that wiggles ON the carriage, and a part that only moves in the count-in rest pose */
function carriage(){
  const root = new THREE.Group(), mat = new THREE.MeshStandardMaterial();
  const box = () => { const g = new THREE.BoxGeometry(1, 1, 1); g.clearGroups(); return g; };   // (a multi-group geometry never merges)
  const car = new THREE.Group(); root.add(car);
  const a = new THREE.Mesh(box(), mat); a.position.set(1, 0, 0);
  const b = new THREE.Mesh(box(), mat); b.position.set(-1, 0, 0);
  const sub = new THREE.Group(); sub.position.y = 1; const c = new THREE.Mesh(box(), mat); sub.add(c);   // (rigid through a still sub-group)
  const wig = new THREE.Mesh(box(), mat);
  const armed = new THREE.Mesh(box(), mat);
  car.add(a, b, sub, wig, armed);
  const scene = new THREE.Scene(); scene.add(root);
  let resting = false;
  const pose = t => { car.position.y = Math.sin(t) * 3; wig.rotation.z = t; armed.position.x = resting ? 5 : 0; };
  return { root, car, sub, a, b, c, wig, armed, scene, pose, rest: () => { resting = true; pose(-2.4); } };
}
describe('mergeStatic carriage (rigid) merge', () => {
  it('bakes the parts rigid on a moving carriage into ONE mesh under it — and it rides the carriage', () => {
    const s = carriage();
    const r = mergeStatic(s.root, s.pose, times, s.rest);
    expect(r.rigid.removed).toBe(3);                    // a, b, c (not the wiggler, not the armed-only mover)
    expect(s.a.parent).toBe(null); expect(s.c.parent).toBe(null);
    expect(s.wig.parent).toBe(s.car); expect(s.armed.parent).toBe(s.car);
    const merged = s.car.children.filter(o => o.name === 'merged-static');
    expect(merged.length).toBe(1);
    // the merged mesh follows the carriage exactly as the parts did
    for (const t of [0, .7, 2.1]){
      s.pose(t); s.root.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(merged[0]);
      expect(bb.min.y).toBeCloseTo(s.car.position.y - .5, 6);
      expect(bb.max.y).toBeCloseTo(s.car.position.y + 1.5, 6);
      expect(bb.min.x).toBeCloseTo(-1.5, 6); expect(bb.max.x).toBeCloseTo(1.5, 6);
    }
    pruneFrozen();
  });
  it('opts.rigid = false leaves the carriage parts alone; noMerge on the carriage path blocks it', () => {
    const s = carriage();
    expect(mergeStatic(s.root, s.pose, times, s.rest, { rigid: false }).rigid.removed).toBe(0);
    expect(s.a.parent).toBe(s.car);
    const t = carriage(); t.sub.userData.noMerge = true;
    const r = mergeStatic(t.root, t.pose, times, t.rest);
    expect(r.rigid.removed).toBe(2);                    // a, b — c sits under a noMerge sub-group
    expect(t.c.parent).toBe(t.sub);
    pruneFrozen();
  });
});
