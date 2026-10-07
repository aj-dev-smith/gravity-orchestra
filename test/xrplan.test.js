import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { G, solveLaunch, arcPos } from '../src/engine.js';
import { planEdit, shotAt } from '../src/directorplan.js';
import { spatialize } from '../src/spatial.js';
import { U_PER_M, EYE_U, PAD_R, G_REAL, earFrame, planAnchors, anchorFor, tourAt, pickAnchor, throwArc, rigFor, padHits, yawToward } from '../src/xrplan.js';

/* a small room: a belt wall at x∈[-8,8], z∈[-6,1.5], two floor stations and a drum kit,
   director eyes that look at each of them */
const ROOM = { x0: -38, x1: 38, y0: -22, y1: 36, z0: -34, z1: 42 };
const BELT = { role: 'lead', x: 0, z0: -6, z1: 1.5, bandY: 5.72 };
const SOLIDS = [
  [-8, 8, -22, 14, -6, 1.5],          // belt wall
  [-24, -14, -22, 3, -4, 4],          // marimba
  [14, 24, -22, 3, -4, 4],            // bells
  [-6, 6, -22, 2, 12, 20],            // drums (in FRONT of the belt)
];
const SHOTS = [
  { key: 'marimba', eye: [-19, 8, 15], aim: [-19, 3, 0], color: '#e0508a' },
  { key: 'bells', eye: new THREE.Vector3(19, 8, 15), aim: new THREE.Vector3(19, 3, 0), color: '#ffc86a' },
  { key: 'drums', eye: [1, 11.5, 28.5], aim: [0, 3.6, 13.5], color: '#ff8a3d' },
];
const WIDE = { eye: [-5, 22, 36], aim: [0, 6, 0] };
const plan = () => planAnchors({ shots: SHOTS, wide: WIDE, belts: [BELT], solids: SOLIDS, room: ROOM });

describe('xr scale: honest gravity', () => {
  it('U_PER_M follows G — a marble falls at a true 9.81 m/s² in the headset', () => {
    expect(U_PER_M).toBeCloseTo(-G.y / 9.81, 12);
    expect(U_PER_M).toBeCloseTo(1.478, 3);
    // a 1 s free fall in world units, read in metres through the rig scale, is ½·g·t²
    const fall = .5 * -G.y * 1 * 1;
    expect(fall / U_PER_M).toBeCloseTo(.5 * G_REAL, 9);
    expect(EYE_U).toBeCloseTo(1.6 * U_PER_M, 12);
  });
});

describe('planAnchors', () => {
  it('one pad per director shot + the wide + the belt, wide first, unique ids', () => {
    const A = plan();
    expect(A.map(a => a.key)).toEqual(['stage', 'lead', 'marimba', 'bells', 'drums']);
    expect(A.map(a => a.id)).toEqual([0, 1, 2, 3, 4]);
  });
  it('every playing machine has a pad', () => {
    const keys = new Set(plan().map(a => a.key));
    for (const s of SHOTS) expect(keys.has(s.key)).toBe(true);
  });
  it('no pad stands inside a machine (a standing user + pad clear of every box)', () => {
    for (const a of plan()) for (const b of SOLIDS) expect(padHits(a.pos, b)).toBe(false);
  });
  it('eyes land where the director looked from: feet = eye − EYE_U, on the shot line, facing the aim', () => {
    for (const a of plan()){
      expect(a.eye[1] - a.pos[1]).toBeCloseTo(EYE_U, 9);
      // forward of a rig turned by yaw is (−sin, −cos): it points at the aim horizontally
      const dx = a.aim[0] - a.eye[0], dz = a.aim[2] - a.eye[2], L = Math.hypot(dx, dz);
      expect(-Math.sin(a.yaw)).toBeCloseTo(dx / L, 9);
      expect(-Math.cos(a.yaw)).toBeCloseTo(dz / L, 9);
    }
    const m = plan().find(a => a.key === 'marimba'), s = SHOTS[0];
    // on the aim→eye line (pulled in, never past the aim)
    const t = (m.eye[2] - s.aim[2]) / (s.eye[2] - s.aim[2]);
    expect(t).toBeGreaterThan(.5); expect(t).toBeLessThanOrEqual(1 + 1e-9);
    expect(m.eye[0]).toBeCloseTo(s.aim[0] + (s.eye[0] - s.aim[0]) * t, 9);
  });
  it('the belt pad puts the eye at strike-band height, in front of the wall', () => {
    const b = plan().find(a => a.key === 'lead');
    expect(Math.abs(b.eye[1] - BELT.bandY)).toBeLessThan(1);
    expect(b.pos[2]).toBeGreaterThan(BELT.z1 + PAD_R);
  });
  it('a pad pulled into a machine backs off along its own line (else keeps the solved eye)', () => {
    // the eye is clear, but pulled 15 % toward the aim it would stand in the drums' box
    const box = [-6, 6, -22, 2, 12, 24.5];
    const A = planAnchors({ shots: [{ key: 'x', eye: [0, 4.5, 28], aim: [0, 2, 10] }], solids: [box], room: ROOM });
    expect(A).toHaveLength(1);
    expect(padHits(A[0].pos, box)).toBe(false);
    expect(A[0].eye[2]).toBeCloseTo(28, 9);              // both pulled-in candidates stood in the box
    expect(padHits([0, 4.5 - EYE_U, 10 + 18 * .85], box)).toBe(true);
  });
  it('feet stay inside the room', () => {
    const A = planAnchors({ shots: [{ key: 'far', eye: [80, 60, 90], aim: [0, 3, 0] }], room: ROOM, pull: 1 });
    const a = A[0];
    expect(a.pos[0]).toBeLessThanOrEqual(ROOM.x1 - PAD_R + 1e-9);
    expect(a.pos[2]).toBeLessThanOrEqual(ROOM.z1 - PAD_R + 1e-9);
    expect(a.eye[1]).toBeLessThan(ROOM.y1);
  });
  it('two shots from (nearly) the same place merge into one pad', () => {
    const A = planAnchors({ shots: [{ key: 'a', eye: [0, 8, 20], aim: [0, 3, 0] }, { key: 'b', eye: [.5, 8, 20.3], aim: [0, 3, 0] }], room: ROOM });
    expect(A.map(a => a.key)).toEqual(['a']);
  });
  it('is pure: the same inputs give the same anchors', () => {
    expect(JSON.stringify(plan())).toBe(JSON.stringify(plan()));
  });
});

describe('tour = the director edit, as pads (a pure fn of songTime)', () => {
  const A = plan();
  it('maps every shot key onto a pad', () => {
    expect(A[anchorFor('stage', A)].key).toBe('stage');
    expect(A[anchorFor('belt', A)].key).toBe('lead');
    expect(A[anchorFor('alto', A)].key).toBe('lead');    // a belt role without its own pad → the lead belt
    expect(A[anchorFor('bells', A)].key).toBe('bells');
    expect(anchorFor('nope', A)).toBe(0);
    expect(anchorFor('x', [])).toBe(-1);
  });
  it('replays planEdit: the pad at t is the cut at t, scrub-safe', () => {
    const hits = (k, step, ph) => Array.from({ length: 40 }, (_, i) => ({ t: 2.6 + ph + i * step, w: 1 }));
    const P = 40;
    const ed = planEdit({ voices: [{ key: 'marimba', hits: hits('m', .7, 0) }, { key: 'bells', hits: hits('b', 1.4, .35) },
      { key: 'belt', belt: true, hits: hits('l', .35, 0) }], grid: { t0: 2.6, beat: .7, end: 30 }, fixed: [], wides: [] });
    const at = t => shotAt(ed, ((t % P) + P) % P, 30);
    const ts = Array.from({ length: 400 }, (_, i) => -2.4 + i * .23);
    const fwd = ts.map(t => tourAt(at, A, t));
    const back = [...ts].reverse().map(t => tourAt(at, A, t)).reverse();
    expect(back).toEqual(fwd);                           // order of evaluation never matters
    ts.forEach((t, i) => expect(fwd[i]).toBe(anchorFor(at(t), A)));
    expect(new Set(fwd).size).toBeGreaterThan(1);         // it actually tours
    expect(tourAt(at, A, 5)).toBe(tourAt(at, A, 5 + P));  // loops with the song
  });
});

describe('teleport', () => {
  const A = plan();
  it('pickAnchor: the pad nearest the pointing ray, inside the cone, never the one you stand on', () => {
    const head = [0, 6, 30], m = A.find(a => a.key === 'marimba');
    const dir = [m.pos[0] - head[0], m.pos[1] + .3 - head[1], m.pos[2] - head[2]];
    expect(pickAnchor(A, head, dir)).toBe(m.id);
    expect(pickAnchor(A, head, dir, { skip: m.id })).not.toBe(m.id);
    expect(pickAnchor(A, head, [0, 1, 0])).toBe(-1);      // pointing at the ceiling: nothing
  });
  it('throwArc is the engine\'s own solved throw: starts at the hand, lands on the pad, under G', () => {
    const from = [3, 6, 30], to = [-19, 5.6, 13];
    const { T, v0, pts } = throwArc(from, to, 24);
    expect(pts[0].distanceTo(new THREE.Vector3(...from))).toBeLessThan(1e-9);
    expect(pts[24].distanceTo(new THREE.Vector3(...to))).toBeLessThan(1e-9);
    const ref = solveLaunch(new THREE.Vector3(...from), new THREE.Vector3(...to), T);
    expect(v0.distanceTo(ref)).toBeLessThan(1e-12);
    // every sample is arcPos at its time (an analytic arc — no integrator)
    pts.forEach((p, i) => expect(p.distanceTo(arcPos(new THREE.Vector3(...from), v0, T * i / 24))).toBeLessThan(1e-9));
    // and the arc rises above the straight line (a lob, not a laser)
    expect(Math.max(...pts.map(p => p.y))).toBeGreaterThan(Math.max(from[1], to[1]));
  });
  it('rigFor puts the HEAD (not the rig origin) over the pad centre, at the anchor yaw', () => {
    const a = A.find(x => x.key === 'bells');
    for (const head of [[0, 1.6, 0], [.4, 1.7, -.3], [-1.1, 1.5, .8]]){
      const r = rigFor(a, head);
      const rig = new THREE.Object3D(); rig.position.set(r.x, r.y, r.z); rig.rotation.y = r.yaw; rig.scale.setScalar(U_PER_M);
      rig.updateMatrixWorld(true);
      const w = new THREE.Vector3(...head).applyMatrix4(rig.matrixWorld);
      expect(w.x).toBeCloseTo(a.pos[0], 9);
      expect(w.z).toBeCloseTo(a.pos[2], 9);
      expect(w.y).toBeCloseTo(a.pos[1] + head[1] * U_PER_M, 9);   // feet on the pad: the head is its own height up
      expect(r.yaw).toBe(a.yaw);
    }
  });
  it('yawToward: a rig turned by it looks down the direction', () => {
    for (const [dx, dz] of [[1, 0], [0, 1], [-1, -1], [3, -2]]){
      const y = yawToward(dx, dz), L = Math.hypot(dx, dz);
      const f = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), y);
      expect(f.x).toBeCloseTo(dx / L, 12); expect(f.z).toBeCloseTo(dz / L, 12);
    }
  });
});

describe('spatial audio follows the HEAD in XR (spatial.js contract unchanged)', () => {
  const head = (yaw, p = [0, 6, 20]) => ({ position: new THREE.Vector3(...p), quaternion: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw) });
  it('a strike to your right pans right; turn your head toward it and it centres', () => {
    const strike = new THREE.Vector3(10, 6, 20);
    const e0 = earFrame(strike, head(0));
    expect(e0.x).toBeCloseTo(10, 9); expect(e0.z).toBeCloseTo(0, 9);
    expect(spatialize(e0.x, e0.y, e0.z, e0).pan).toBeGreaterThan(.3);
    const e1 = earFrame(strike, head(-Math.PI / 2));     // facing +x
    expect(e1.x).toBeCloseTo(0, 9); expect(e1.z).toBeCloseTo(-10, 9);
    expect(Math.abs(spatialize(e1.x, e1.y, e1.z, e1).pan)).toBeLessThan(1e-6);
  });
  it('distances are world units (the rig scale is not a distance) and focus = head → the pad aim', () => {
    const e = earFrame(new THREE.Vector3(0, 6, 8), head(0), [0, 3, 4]);
    expect(Math.hypot(e.x, e.y, e.z)).toBeCloseTo(12, 9);
    expect(e.focus).toBeCloseTo(Math.hypot(0, 3, 16), 9);
    expect(e.tanH).toBe(1);
    expect(earFrame(new THREE.Vector3(), head(0)).focus).toBe(8);
    expect(earFrame(new THREE.Vector3(), head(0), [0, 6, 19]).focus).toBe(4);   // never a pinhole focus
  });
});
