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
