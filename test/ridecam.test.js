import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { RIDE, ridePose, smoothAt, rideMoments, rideWindowAt } from '../src/ridecam.js';
import { G, solveLaunch, arcPos } from '../src/engine.js';

/* a belt-shaped marble path from the engine's own closed-form arcs: pads at (x, y, 0), each
   flight the solved launch for its dt — a pure fn of t, like a belt ball (juggle.js ballAt) */
function beltPath(pads){                               // pads: [[x, y, dt]] (the last is the end point)
  const segs = []; let t = 0;
  for (let i = 0; i + 1 < pads.length; i++){
    const a = new THREE.Vector3(pads[i][0], pads[i][1], 0), b = new THREE.Vector3(pads[i + 1][0], pads[i + 1][1], 0);
    segs.push({ t, dt: pads[i][2], a, v: solveLaunch(a, b, pads[i][2]) }); t += pads[i][2];
  }
  const T = t;
  const path = s => {
    s = Math.min(T, Math.max(0, s));
    let i = segs.length - 1; while (i > 0 && segs[i].t > s) i--;
    const g = segs[i], p = arcPos(g.a, g.v, Math.min(s - g.t, g.dt));
    return [p.x, p.y, p.z];
  };
  return { path, T };
}
// the catalog's hard cases: a zig-zag of skims (direction flips every .25 s), a long run one way,
// a 1.67 s tall lob, a back-and-forth of medium hops, and a vertical yo-yo
const PADS = [[0, 0, .25], [1.2, .3, .25], [0, .1, .25], [1.2, .4, .25], [0, 0, 1.67], [6, 0, .5], [8, .4, .5], [10, .2, .5],
  [12, .6, 1.2], [9, 0, 1.2], [12, .2, .8], [12, .2, .8], [12, 0, .5], [4, 0, 2.08], [-2, .3, .33], [-3, .1, .33], [-4, 0, 1]];
const { path, T } = beltPath(PADS);
const dirOf = p => new THREE.Vector3(...p.aim).sub(new THREE.Vector3(...p.eye)).normalize();

describe('ridecam — ride the ball, solved up front', () => {
  it('is a pure function of songTime (scrub-exact: same t, same pose)', () => {
    const a = ridePose(path, 3.3), b = (ridePose(path, 7.1), ridePose(path, 3.3));
    expect(b).toEqual(a);
  });

  it('comfort: the view direction turns slower than RIDE.RATE, the yaw stays bounded, the horizon never rolls', () => {
    let maxRate = 0, maxYaw = 0, prev = null;
    const h = 1 / 240;
    for (let t = 0; t <= T; t += h){
      const p = ridePose(path, t), d = dirOf(p);
      if (prev) maxRate = Math.max(maxRate, prev.angleTo(d) / h);
      prev = d;
      const ex = p.aim[0] - p.eye[0], ez = p.aim[2] - p.eye[2];
      maxYaw = Math.max(maxYaw, Math.abs(Math.atan2(ex, -ez)));
    }
    expect(maxRate).toBeLessThan(RIDE.RATE);
    expect(maxYaw).toBeLessThan(RIDE.MAX_YAW + .5);   // (the aim's own lead adds a little to the eye's yaw)
  });

  it('the eye never jumps (continuous, bounded speed) and rides above + in front of the marble plane', () => {
    let prev = null, maxV = 0;
    const h = 1 / 240;
    for (let t = .5; t <= T - .5; t += h){
      const p = ridePose(path, t);
      if (prev) maxV = Math.max(maxV, Math.hypot(p.eye[0] - prev[0], p.eye[1] - prev[1], p.eye[2] - prev[2]) / h);
      prev = p.eye;
      expect(p.eye[1]).toBeGreaterThan(path(t - RIDE.LAG)[1] + RIDE.UP - .9);   // over where the marble just was
      expect(p.eye[2]).toBeGreaterThanOrEqual(path(t)[2] + RIDE.ZMIN - 1e-9);   // in front of its plane: never in the machine
    }
    expect(maxV).toBeLessThan(25);                                     // u/s — a dolly, never a teleport
  });

  it('keeps the marble in frame (inside the lens, ahead of the eye) the whole ride', () => {
    const tanV = Math.tan(THREE.MathUtils.degToRad(RIDE.FOV / 2)), tanH = tanV * 1.5;
    for (let t = .2; t <= T - .2; t += .01){
      const p = ridePose(path, t), f = dirOf(p), e = new THREE.Vector3(...p.eye);
      const R = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0)).normalize(), U = new THREE.Vector3().crossVectors(R, f);
      const q = new THREE.Vector3(...path(t)).sub(e), z = q.dot(f);
      expect(z).toBeGreaterThan(1);
      expect(Math.abs(q.dot(R)) / z).toBeLessThan(tanH);
      expect(Math.abs(q.dot(U)) / z).toBeLessThan(tanV);
    }
  });

  it('a directed ride eases in from (and out to) the wide chase', () => {
    const win = { t0: 4, t1: 8 };
    const back = t => { const p = ridePose(path, t, win), tr = smoothAt(path, t - RIDE.LAG, RIDE.SM); return p.eye[1] - tr[1]; };
    expect(back(4)).toBeCloseTo(RIDE.CHASE_UP, 6);
    expect(back(8)).toBeCloseTo(RIDE.CHASE_UP, 6);
    expect(back(6)).toBeCloseTo(RIDE.UP, 6);
  });

  it('rideMoments: only long, tall flights; the loop\'s biggest takes the pull', () => {
    const g = -G.y, apex = dt => g * dt * dt / 8;
    const m = rideMoments([
      { t: 1, dt: .3, apex: apex(.3), role: 'lead' },     // a skim
      { t: 2, dt: 1.0, apex: .5, role: 'lead' },          // long but flat (a hop between heights)
      { t: 3, dt: 1.2, apex: apex(1.2), role: 'alto' },
      { t: 5, dt: 5.4, apex: 5.8, role: 'bass' },         // the pedal lob (a crane hop)
    ]);
    expect(m.map(x => x.t)).toEqual([3, 5]);
    expect(m[1].w).toBeCloseTo(1, 6);
    expect(m[0].w).toBeLessThan(.3);
    expect(rideWindowAt([{ t0: 4, t1: 9 }], 4)).toEqual({ t0: 4, t1: 9 });
    expect(rideWindowAt([{ t0: 4, t1: 9 }], 9)).toBe(null);
  });
});
