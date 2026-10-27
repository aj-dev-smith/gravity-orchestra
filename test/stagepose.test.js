/* THE STAGE POSE (src/stagepose.js): the belt moves + turns in stage edit — a rigid render-time move.
   Pins: the transform round-trips, identity is untouched (every old layout loads as it did), the room in
   the stage frame stays inside the room, a ball / strike / dock the machine reports is the plan's point
   moved by the pose, the room solve + the follow solve are frame-invariant, the layout format. */
import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import { IDENTITY, isIdentity, toWorld, toStage, dirToWorld, poseToWorld, poseToStage, box6ToWorld, boxToWorld, stageRoom, clampPose, poseOf } from '../src/stagepose.js';
import { sanitizeLayout, encodeLayout, placeEntry, rehangs, footprint, inRectPoly, BELT } from '../src/editor/placement.js';
import { layoutStations, stationFor } from '../src/instruments/stations.js';
import { solveFollow } from '../src/shotsolve.js';
import { planAnchors } from '../src/xrplan.js';

const ROOM = { x0: -35.5, x1: 35.5, z0: -31.5, z1: 31 };
const T1 = { x: 12, z: 4, yaw: .52 }, T2 = { x: -8, z: -6, yaw: Math.PI / 2 }, T3 = { x: 5, z: -2, yaw: 0 };
const close = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

describe('stage pose: the transform', () => {
  it('identity hands every point back untouched (old layouts load bit for bit)', () => {
    for (const [x, z] of [[1.2345678, -9.87654321], [0, 0], [-31.5, 17.25]]){
      expect(toWorld(IDENTITY, x, z)).toEqual({ x, z });
      expect(toStage(IDENTITY, x, z)).toEqual({ x, z });
      expect(toWorld(null, x, z)).toEqual({ x, z });
    }
    expect(isIdentity(IDENTITY)).toBe(true); expect(isIdentity({ x: 0, z: 0, yaw: 0 })).toBe(true); expect(isIdentity(T3)).toBe(false);
    const b = [-12.6, 12.6, -1, 18, -4, 3];
    expect(box6ToWorld(IDENTITY, b)).toEqual(b);
    expect(stageRoom(ROOM, IDENTITY)).toEqual(ROOM);
    expect(clampPose(IDENTITY, [-12, 12, -4, 3], ROOM)).toBe(IDENTITY);
  });
  it('toStage undoes toWorld (and back), for moves and turns', () => {
    for (const T of [T1, T2, T3, { x: -20, z: 9, yaw: -2.6 }])
      for (const [x, z] of [[0, 0], [7, -3], [-25, 14]]){
        const w = toWorld(T, x, z), s = toStage(T, w.x, w.z);
        expect(close(s.x, x)).toBe(true); expect(close(s.z, z)).toBe(true);
        const p = poseToStage(T, poseToWorld(T, { x, z, yaw: .3 }));
        expect(close(p.x, x) && close(p.z, z) && close(p.yaw, .3)).toBe(true);
      }
  });
  it('is three.js\'s rigid move: a group at the pose takes a local point exactly where toWorld says', () => {
    const g = new THREE.Group();
    for (const T of [T1, T2, T3]){
      g.position.set(T.x, 7.3, T.z); g.rotation.set(0, T.yaw, 0); g.updateMatrixWorld(true);
      for (const [x, z] of [[3, 2], [-11, -4]]){
        const v = g.localToWorld(new THREE.Vector3(x, 1, z)), w = toWorld(T, x, z);
        expect(v.x).toBeCloseTo(w.x, 9); expect(v.z).toBeCloseTo(w.z, 9); expect(v.y).toBeCloseTo(8.3, 9);
      }
      const d = dirToWorld(T, 0, 1), v = new THREE.Vector3(0, 0, 1).applyQuaternion(g.quaternion);
      expect(d.x).toBeCloseTo(v.x, 9); expect(d.z).toBeCloseTo(v.z, 9);
    }
    // …and placement.js's footprint() turns the same way (stage edit draws the belt with it)
    const fp = footprint([-2, 2, -1, 1], T1.x, T1.z, T1.yaw), bw = boxToWorld(T1, [-2, 2, -1, 1]);
    fp.forEach((q, i) => { expect(q[0]).toBeCloseTo(bw[i][0], 9); expect(q[1]).toBeCloseTo(bw[i][1], 9); });
  });
  it('the room in the stage frame: exact for a move / a quarter-turn, inside the room when turned between', () => {
    const r3 = stageRoom(ROOM, T3);
    expect(r3).toEqual({ x0: ROOM.x0 - 5, x1: ROOM.x1 - 5, z0: ROOM.z0 + 2, z1: ROOM.z1 + 2 });
    const r2 = stageRoom(ROOM, T2);   // (a quarter-turn: the room's 71 × 62.5 comes back 62.5 × 71)
    expect(r2.x1 - r2.x0).toBeCloseTo(ROOM.z1 - ROOM.z0, 9); expect(r2.z1 - r2.z0).toBeCloseTo(ROOM.x1 - ROOM.x0, 9);
    const belt = [-12.6, 12.6, -4, 3], r1 = stageRoom(ROOM, T1, belt);
    for (const [x, z] of [[r1.x0, r1.z0], [r1.x1, r1.z0], [r1.x1, r1.z1], [r1.x0, r1.z1]]){
      const w = toWorld(T1, x, z);
      expect(w.x >= ROOM.x0 - 1e-6 && w.x <= ROOM.x1 + 1e-6 && w.z >= ROOM.z0 - 1e-6 && w.z <= ROOM.z1 + 1e-6).toBe(true);
    }
    expect(r1.x0 <= belt[0] && r1.x1 >= belt[1] && r1.z0 <= belt[2] && r1.z1 >= belt[3]).toBe(true);   // (it holds the belt)
    expect((r1.x1 - r1.x0) * (r1.z1 - r1.z0)).toBeGreaterThan(1500);                                  // (and a stage's worth of floor)
  });
  it('clampPose keeps the belt inside the room (an untrusted share link can\'t put it through a wall)', () => {
    const belt = [-12.6, 12.6, -4, 3];
    for (const T of [{ x: 80, z: 0, yaw: 0 }, { x: -40, z: 40, yaw: 1 }, { x: 30, z: -30, yaw: .4 }]){
      const c = clampPose(T, belt, ROOM), w = boxToWorld(c, belt);
      for (const [x, z] of w) expect(x >= ROOM.x0 - 1e-9 && x <= ROOM.x1 + 1e-9 && z >= ROOM.z0 - 1e-9 && z <= ROOM.z1 + 1e-9).toBe(true);
      expect(c.yaw).toBe(T.yaw);                                                                        // (moved, never turned)
    }
    expect(clampPose(T1, belt, ROOM)).toEqual(T1);                                                     // (inside: untouched)
  });
});

describe('stage pose: the layout format (back-compatible)', () => {
  it('no belt entry = identity; an entry round-trips through a share link', () => {
    expect(poseOf(undefined)).toBe(IDENTITY);
    expect(poseOf({ x: 0, z: 0, yaw: 0 })).toBe(IDENTITY);
    const L = sanitizeLayout(encodeLayout({ marimba: { x: -20, z: 5, yaw: .5 }, belt: { x: 12, z: 4, yaw: .524 } }));
    expect(L.belt).toEqual({ x: 12, z: 4, yaw: .524 });
    expect(poseOf(L.belt)).toEqual({ x: 12, z: 4, yaw: .524 });
    expect(encodeLayout({ belt: { x: 3, z: -1, yaw: 0 } })).toEqual({ belt: [3, -1] });
    // an old layout (no belt) reads exactly as before
    const old = sanitizeLayout({ marimba: [-20, 5, .5, 2], drums: [18, 19] });
    expect(old.belt).toBeUndefined();
    expect(poseOf(old.belt)).toBe(IDENTITY);
  });
  it('moving the belt first pins nobody (the band re-seats round it); a station\'s first edit never pins the belt', () => {
    const all = [{ key: 'marimba', x: -20, z: 5, yaw: .5 }, { key: 'drums', x: 18, z: 19, yaw: 0 }];
    const L = placeEntry({}, BELT, { x: 12, z: 4, yaw: .5 }, all);
    expect(Object.keys(L)).toEqual(['belt']);
    expect(L.belt).toEqual({ x: 12, z: 4, yaw: .5 });
    const L2 = placeEntry(L, 'marimba', { x: -22, z: 5, yaw: .5 }, all);
    expect(L2.belt).toEqual(L.belt); expect(L2.marimba.x).toBe(-22); expect(L2.drums).toBeUndefined();   // (the layout was not empty: no pin-all)
    const L3 = placeEntry({}, 'marimba', { x: -22, z: 5, yaw: .5 }, all);                                 // (stage edit's `all` never holds the belt)
    expect(L3.belt).toBeUndefined(); expect(L3.drums).toEqual({ x: 18, z: 19, yaw: 0 });
  });
  it('a hung machine re-hangs over a TURNED belt\'s footprint (the magnet reads its corners)', () => {
    const fp = footprint([-12.6, 12.6, -4, 3], 12, 4, .52);
    const on = toWorld({ x: 12, z: 4, yaw: .52 }, 10, 2), off = toWorld({ x: 12, z: 4, yaw: .52 }, 10, 6);
    expect(rehangs(on, fp)).toBe(true); expect(rehangs(off, fp)).toBe(false);
    expect(inRectPoly([on.x, on.z], fp)).toBe(true);
    // (the axis-aligned box of that footprint would have taken `off` too — the turned test doesn't)
    const xs = fp.map(q => q[0]), zs = fp.map(q => q[1]);
    expect(rehangs(off, [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)])).toBe(true);
  });
});

describe('stage pose: the solves are frame-invariant', () => {
  const wall = [-12.6, 12.6, -4, 3];
  const items = ['marimba', 'bells', 'bass', 'bowls'].map((key, i) => { const s = stationFor(key, i);
    return { key, x: s.x, z: s.z, box: [-4, 4, -2.5, 2.5], top: 3, deck: 0 }; });
  it('layoutStations: a roomPoly equal to the room changes nothing (the option is additive)', () => {
    const a = layoutStations(items, wall, ROOM, { cx: 0 });
    const b = layoutStations(items, wall, ROOM, { cx: 0, roomPoly: [[ROOM.x0, ROOM.z0], [ROOM.x1, ROOM.z0], [ROOM.x1, ROOM.z1], [ROOM.x0, ROOM.z1]] });
    expect(b).toEqual(a);
  });
  it('layoutStations: a belt moved with room to spare keeps the band exactly round it', () => {
    const a = layoutStations(items, wall, ROOM, { cx: 0 });
    const T = { x: 2, z: -3, yaw: 0 }, room = stageRoom(ROOM, T, wall);
    const b = layoutStations(items, wall, room, { cx: 0 });
    for (const k of Object.keys(a)){ expect(b[k].x).toBeCloseTo(a[k].x, 9); expect(b[k].z).toBeCloseTo(a[k].z, 9); }
  });
  it('solveFollow: solved in the belt\'s frame — the same offset for the same stage wherever the belt stands', () => {
    const wall6 = [-12.6, 12.6, -1, 16, -4, 3];
    const boxes = [[-24, -14, -6, 3, 8, 14], [14, 24, -6, 3, 8, 14], [-5, 5, -6, 2, 16, 22]];
    const room = { x0: -60, x1: 60, y0: -6, y1: 40, z0: -60, z1: 60 };
    const a = solveFollow({ wall: wall6, boxes, stageY: 5.7, room });
    expect(solveFollow({ wall: wall6, boxes, stageY: 5.7, room, pose: IDENTITY })).toEqual(a);
    for (const T of [T1, T2, T3]){
      // the same stage moved by T: every box's corners through T (a box turned 90° stays a box; otherwise its
      // AABB — a little larger, so only the quarter-turn and the move must match exactly)
      const moved = boxes.map(b => box6ToWorld(T, b));
      const b = solveFollow({ wall: wall6, boxes: moved, stageY: 5.7, room, pose: T });
      if (T.yaw % (Math.PI / 2) === 0 || Math.abs(T.yaw - Math.PI / 2) < 1e-12) b.off.forEach((v, i) => expect(v).toBeCloseTo(a.off[i], 9));
      else expect(b.off.length).toBe(3);
    }
  });
  it('xr: the belt\'s teleport pad stands in front of it wherever it is turned', () => {
    const belt = { role: 'lead', x: 0, z0: -4, z1: 3, bandY: 5.72 };
    const a = planAnchors({ belts: [belt], room: { x0: -60, x1: 60, y0: -6, y1: 40, z0: -60, z1: 60 } })[0];
    for (const T of [T1, T2]){
      const b = planAnchors({ belts: [{ ...belt, pose: T }], room: { x0: -60, x1: 60, y0: -6, y1: 40, z0: -60, z1: 60 } })[0];
      const w = toWorld(T, a.pos[0], a.pos[2]);
      expect(b.pos[0]).toBeCloseTo(w.x, 9); expect(b.pos[2]).toBeCloseTo(w.z, 9); expect(b.pos[1]).toBeCloseTo(a.pos[1], 9);
      const aim = toWorld(T, a.aim[0], a.aim[2]);
      expect(b.aim[0]).toBeCloseTo(aim.x, 9); expect(b.aim[2]).toBeCloseTo(aim.z, 9);
    }
  });
});

/* THE MACHINE: a strike / a dock / a voice's focus the juggler reports is the plan's point moved by the pose
   (sparks, spatial audio, the follow cam's marbles) — and unturned it is exactly the plain offset it was */
describe('stage pose: the belt machine reports where it stands', () => {
  let shop, J;
  beforeAll(async () => {
    // (a canvas for the housings' wash texture — node has none: a stub that draws nothing)
    const ctx = new Proxy({}, { get: (o, k) => k in o ? o[k] : (o[k] = typeof k === 'string' && /^create/.test(k) ? () => ({ addColorStop(){} }) : () => {}), set: (o, k, v) => (o[k] = v, true) });
    globalThis.document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => ctx, style: {} }) };
    const { makeJugglerShop } = await import('../src/jugglebelt.js');
    const { layoutJuggler, assembleJuggler, unpackSolve, jugglerKey } = await import('../src/juggle.js');
    const { SONGS } = await import('../src/songs/index.js');
    const BAKED = (await import('../src/juggle-baked.json')).default;
    const song = SONGS['fur-elise'] || Object.values(SONGS)[0];
    J = assembleJuggler(layoutJuggler(song), unpackSolve(BAKED.plans[jugglerKey(song)].voices));
    const tex = new THREE.Texture();
    shop = makeJugglerShop({ envMap: null, floorY: -11.5, rig: { lead: { r: .26, body: 0xffc488, emissive: 0xff9233, glow: 0xffaa55, glowTex: tex },
      bass: { r: .36, body: 0xa8d4ff, emissive: 0x3d7dff, glow: 0x66aaff, glowTex: tex }, alto: { r: .21, body: 0xe2c8ff, emissive: 0x9a4dff, glow: 0xc08bff, glowTex: tex } } });
  });
  const run = (pose, t0, t1) => {
    const m = shop.build(J, {});
    m.group.position.set(pose.x, 5.98, pose.z); m.group.rotation.y = pose.yaw; m.group.updateMatrixWorld(true);
    const hits = [], docks = [];
    m.update(t0, 0, { skipStrikes: true });
    for (let t = t0 + .02; t <= t1; t += .02) m.update(t, .02, { started: true, onStrike: h => hits.push(h), onDock: d => docks.push(d) });
    return { m, hits, docks };
  };
  it('every strike sparks / sounds at its plate\'s point moved by the pose (and the dock clacks there)', () => {
    const plates = J.voices.flatMap(V => V.plates.map(p => p));
    const a = run(IDENTITY, 1, 9), b = run(T1, 1, 9);
    expect(a.hits.length).toBeGreaterThan(5);
    expect(b.hits.length).toBe(a.hits.length);
    a.hits.forEach((h, i) => {
      const p = plates.find(q => q.note === h.note && Math.abs(q.x - h.pos.x) < 1e-12 && Math.abs(q.z - h.pos.z) < 1e-12);
      expect(p).toBeTruthy();                                                   // (identity: the plain offset — the plate itself)
      expect(h.pos.y).toBeCloseTo(5.98, 12);
      const w = toWorld(T1, h.pos.x, h.pos.z), g = b.hits[i];
      expect(g.note).toBe(h.note);
      expect(g.pos.x).toBeCloseTo(w.x, 9); expect(g.pos.z).toBeCloseTo(w.z, 9); expect(g.pos.y).toBeCloseTo(h.pos.y, 12);
      const ws = toWorld(T1, h.surf.x, h.surf.z);
      expect(g.surf.x).toBeCloseTo(ws.x, 9); expect(g.surf.z).toBeCloseTo(ws.z, 9);
      // (the ripple's plate orientation turns with the belt)
      const n0 = new THREE.Vector3(0, 1, 0).applyQuaternion(h.quat), n1 = new THREE.Vector3(0, 1, 0).applyQuaternion(g.quat), nw = dirToWorld(T1, n0.x, n0.z);
      expect(n1.x).toBeCloseTo(nw.x, 9); expect(n1.z).toBeCloseTo(nw.z, 9); expect(n1.y).toBeCloseTo(n0.y, 9);
    });
    a.docks.forEach((d, i) => { const w = toWorld(T1, d.pos.x, d.pos.z); expect(b.docks[i].pos.x).toBeCloseTo(w.x, 9); expect(b.docks[i].pos.z).toBeCloseTo(w.z, 9); });
  });
  it('a voice\'s FOCUS (what the follow cam chases) is the plan\'s, moved by the pose', () => {
    const a = run(IDENTITY, 2, 4), b = run(T1, 2, 4);
    a.m.focus.forEach((f, i) => { const w = toWorld(T1, f.x, f.z); expect(b.m.focus[i].x).toBeCloseTo(w.x, 9); expect(b.m.focus[i].z).toBeCloseTo(w.z, 9); });
  });
});
