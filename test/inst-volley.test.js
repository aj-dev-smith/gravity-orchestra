import { describe, it, expect } from 'vitest';
import { GEOM, g, X_RAIL, xOfRank, buildVolley, ballAt, shuttleAt, padPose, forPads, maxPads, stroke,
         wallSpeed, discDistance, chainEvents, assignSides, staff, solOf } from '../src/instruments/volley/solve.js';
import VOL from '../src/instruments/volley/index.js';
import { steelpanVoice } from '../src/instruments/volley/voice.js';
import { noteNum } from '../src/engine.js';

const ROLL_T = 2.6, START = -2.4;
const mk = (part, bpm = VOL.demo.bpm, beats = VOL.demo.beats) => {
  const beat = 60 / bpm, P = ROLL_T + beats * beat + 1.2;        // main.js: ROLL_T + LOOP_T, LOOP_T = melody + 1.2
  return { R: buildVolley(part, { rollT: ROLL_T, beat, P, start: START }), beat, P };
};
const DEMO = mk(VOL.demo.part);
// stresses: a 16th-note run on one wall, a lone note (the whole loop is one same-wall park),
// an odd number of volleys (the parity rule), a part with no park into its first strike, wide leaps
const sixteenths = [];
['C5', 'D5', 'E5', 'F5', 'G5', 'F5', 'E5', 'D5'].forEach((n, i) => sixteenths.push([4 + i * .25, n, .6]));
const STRESS = {
  '16ths': mk(sixteenths.concat([[0, 'C4'], [2, 'G4'], [7, 'C5'], [10, 'G5']]), 100, 16),
  lone: mk([[3, 'E5', .8]], 100, 8),
  odd: mk([[0, 'C5'], [2, 'E5'], [4, 'G5'], [6.5, 'C6'], [7, 'B5']], 100, 8),
  noPark: mk([[0, 'C5'], [2, 'D5'], [4, 'E5'], [6, 'F5']], 120, 8),
  leaps: mk([[0, 'C4'], [1, 'C6'], [2, 'C4'], [2.5, 'G5'], [3, 'D4'], [5, 'A5'], [5.5, 'A3'], [7, 'E6']], 90, 8),
};
const RECS = [['demo', DEMO], ...Object.entries(STRESS)];

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = v => Math.hypot(v[0], v[1], v[2]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** every absolute strike (k, abs) in [from, to) that actually happens (at/after the count-in) */
function strikes(R, P, from, to){
  const out = [];
  R.evs.forEach((e, k) => { for (let a = e.s + Math.ceil((from - e.s) / P) * P; a < to; a += P) if (a >= R.first - 1e-9) out.push([k, a]); });
  return out.sort((x, y) => x[1] - y[1]);
}
/* the closest approach of two solid discs (sampled: centre + rims of each against the other) */
function discGap(p, q){
  let d = Infinity;
  for (const [a, b] of [[p, q], [q, p]]){
    const n = a.n, t1 = Math.abs(n[1]) < .9 ? [0, 1, 0] : [1, 0, 0];
    const u = [n[1] * t1[2] - n[2] * t1[1], n[2] * t1[0] - n[0] * t1[2], n[0] * t1[1] - n[1] * t1[0]];
    const ul = len(u); u[0] /= ul; u[1] /= ul; u[2] /= ul;
    const v = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
    d = Math.min(d, discDistance(a.top, b.top, b.n, b.rho));
    for (let i = 0; i < 16; i++){
      const th = i / 16 * Math.PI * 2, c = Math.cos(th) * a.rho, s = Math.sin(th) * a.rho;
      for (const h of [0, -GEOM.PAD_T]){
        const pt = [a.top[0] + u[0] * c + v[0] * s + n[0] * h, a.top[1] + u[1] * c + v[1] * s + n[1] * h, a.top[2] + u[2] * c + v[2] * s + n[2] * h];
        d = Math.min(d, discDistance(pt, b.top, b.n, b.rho));
      }
    }
  }
  return d;
}

describe('volley — the score, the staff, who plays what', () => {
  it('pitch is height (same staff on both walls); pad size is a pure fn of the note', () => {
    const { R } = DEMO, st = R.staff;
    for (const e of R.evs){
      expect(e.C[1]).toBe(st.yOf(e.note));
      expect(e.rho).toBe(st.padR(e.note));
    }
    expect(st.yOf('C6')).toBeGreaterThan(st.yOf('C5'));
    expect(st.padR('C6')).toBeLessThan(st.padR('C4'));
    const lo = R.evs.reduce((a, e) => noteNum(e.note) < noteNum(a.note) ? e : a), hi = R.evs.reduce((a, e) => noteNum(e.note) > noteNum(a.note) ? e : a);
    expect(lo.C[1]).toBeCloseTo(GEOM.Y_LO, 12); expect(hi.C[1]).toBeCloseTo(GEOM.Y_LO + GEOM.H_STAFF, 12);
  });
  it('a long gap volleys across the court, a short one stays on its wall; volleys per loop are even', () => {
    for (const [, { R }] of RECS){
      const n = R.n;
      const crosses = R.evs.filter((e, i) => e.side !== R.evs[(i + 1) % n].side).length;
      expect(crosses % 2).toBe(0);
      R.evs.forEach((e, i) => { if (e.gap < GEOM.T_CROSS) expect(e.side, `${i}`).toBe(R.evs[(i + 1) % n].side); });
    }
    // the parity rule keeps the SHORTEST volley home
    const { side, cross } = assignSides([1.2, 1.0, 2.0]);
    expect(cross).toEqual([true, false, true]); expect(side).toEqual([-1, 1, 1]);
  });
  it('the demo is a call and response: both walls play, the marble is traded, the shuttle works', () => {
    const { R } = DEMO;
    expect(R.ok, R.warnings.join('; ')).toBe(true);
    expect(R.evs.some(e => e.side < 0) && R.evs.some(e => e.side > 0)).toBe(true);
    expect(R.evs.filter((e, i) => e.side !== R.evs[(i + 1) % R.n].side).length).toBeGreaterThanOrEqual(8);
    expect(R.holds.length).toBeGreaterThanOrEqual(2);
    expect(R.cntPark).toBe(true);                                       // the count-in is a park's tail
    expect(ballAt(R, START).mode).toBe('held');                          // armed on the magnet
    expect(VOL.demo.beats).toBe(32);
  });
  it('monophonic: a chord keeps its top note; every strike lands on its beat', () => {
    const { P, beat } = DEMO;
    expect(chainEvents([[0, 'C4'], [0, 'G4', .3], [1, 'E4']], { rollT: ROLL_T, beat, P }).map(e => e.note)).toEqual(['G4', 'E4']);
    for (const e of DEMO.R.evs) expect(e.s).toBeCloseTo((ROLL_T + e.beat * beat) % P, 9);
  });
  it('every build is clean (no warnings) — the stresses included', () => {
    for (const [name, { R }] of RECS) expect(R.warnings, name).toEqual([]);
  });
});

describe('volley honesty — every strike', () => {
  for (const [name, { R, P }] of RECS) it(`${name}: the pad is fully out ON the column at its beat, exactly under the marble`, () => {
    for (const [k, abs] of strikes(R, P, R.first, R.first + 2 * P)){
      const e = R.evs[k], sol = solOf(R, k, abs), p = padPose(R, k, abs, abs);
      expect(Math.abs(p.z)).toBe(0);                                    // on the strike column
      expect(p.extend).toBe(1); expect(p.tilt).toBe(1);
      expect(Math.abs(p.off)).toBe(0);                                            // the stroke is exactly 0 at contact
      const b = ballAt(R, abs), before = ballAt(R, abs - 1e-7);
      for (let a = 0; a < 3; a++) expect(b.p[a]).toBeCloseTo(e.C[a], 9);   // lands exactly on the beat…
      expect(len(sub(before.p, b.p))).toBeLessThan(1e-5);                   // …continuously
      const d = sub(b.p, p.top);
      for (let a = 0; a < 3; a++) expect(d[a]).toBeCloseTo(GEOM.RM * sol.nrm[a], 9);   // touching, along the normal
      expect(discDistance(b.p, p.top, p.n, e.rho)).toBeCloseTo(GEOM.RM, 9);
      expect(Math.abs(e.side * e.C[0])).toBeCloseTo(xOfRank(e.rank), 12);
    }
  });

  for (const [name, { R, P }] of RECS) it(`${name}: at contact the pad is at REST but for its stroke (its slat slides along the face)`, () => {
    for (const [k, abs] of strikes(R, P, R.first, R.first + P)){
      const sol = solOf(R, k, abs), h = 1e-6;
      const a = padPose(R, k, abs, abs - h).top, b = padPose(R, k, abs, abs).top;
      const vel = sub(b, a).map(x => x / h);
      expect(sol.nrm[2]).toBe(0);                                      // every normal lies in the strike plane…
      expect(vel[2]).toBeCloseTo(R.V, 4);                              // …the slat's motion is ALONG the face (z)
      expect(dot(vel, sol.nrm)).toBeCloseTo(sol.w, 2);                  // the only push is the stroke
      const along = sub(vel, sol.nrm.map(x => x * dot(vel, sol.nrm)));
      expect(Math.hypot(along[0], along[1])).toBeLessThan(1e-3);       // nothing else moves in the plane
    }
  });

  it('every bounce is a frictionless contact: the impulse is along the normal, face speed kept', () => {
    for (const [, { R }] of RECS) for (const e of [...R.evs, ...(R.cnt ? [R.cnt] : [])]){
      const dv = sub(e.vOut, e.vIn);
      const c = [dv[1] * e.nrm[2] - dv[2] * e.nrm[1], dv[2] * e.nrm[0] - dv[0] * e.nrm[2], dv[0] * e.nrm[1] - dv[1] * e.nrm[0]];
      expect(len(c)).toBeLessThan(1e-9);
      expect(dot(dv, e.nrm)).toBeGreaterThan(0);
      const tIn = sub(e.vIn, e.nrm.map(x => x * dot(e.vIn, e.nrm))), tOut = sub(e.vOut, e.nrm.map(x => x * dot(e.vOut, e.nrm)));
      expect(len(sub(tIn, tOut))).toBeLessThan(1e-9);                   // speed along the face unchanged
      expect(e.vinN).toBeGreaterThan(0); expect(e.voutN).toBeGreaterThan(0);
    }
  });

  it('the stroke is the moving-wall solve: the pad supplies exactly what the lossy bounce loses', () => {
    for (const [, { R }] of RECS) for (const e of [...R.evs, ...(R.cnt ? [R.cnt] : [])]){
      const h = 1e-6, w = (stroke(0, e.A) - stroke(-h, e.A)) / h;
      expect(w).toBeCloseTo(e.w, 3);
      expect(e.voutN - w).toBeCloseTo(GEOM.E * (e.vinN + w), 3);       // vout = E·vin + (1+E)·w
      expect(e.w).toBeCloseTo(wallSpeed(e.vinN, e.voutN), 12);
      expect(-w).toBeLessThan(e.vinN);                                  // a yielding pad is slower than the ball
    }
  });

  it('volley arcs are solveLaunch: every free flight lands on the next contact in exactly the gap', () => {
    for (const [, { R }] of RECS) R.evs.forEach((e, i) => {
      if (e.park) return;
      const b = R.evs[(i + 1) % R.n], T = e.gap;
      for (let a = 0; a < 3; a++) expect(e.C[a] + e.vOut[a] * T - (a === 1 ? .5 * g * T * T : 0)).toBeCloseTo(b.C[a], 9);
    });
  });
});

describe('volley honesty — nothing passes through anything', () => {
  for (const [name, { R, P }] of RECS) it(`${name}: the marble never enters a pad, a wall, the net or the magnet`, () => {
    let worst = Infinity, at = null, worstWall = Infinity, worstMag = Infinity, worstNet = Infinity, maxZ = 0;
    for (let t = START; t < R.first + 1.2 * P; t += 1 / 600){
      const b = ballAt(R, t);
      maxZ = Math.max(maxZ, Math.abs(b.p[2]));
      worstWall = Math.min(worstWall, GEOM.XF - GEOM.COWL_IN - Math.abs(b.p[0]) - GEOM.RM);
      worstMag = Math.min(worstMag, GEOM.Y_M - b.p[1]);
      if (Math.abs(b.p[0]) < GEOM.RM + .03) worstNet = Math.min(worstNet, b.p[1] - GEOM.RM - GEOM.NET_H);
      forPads(R, t, (k, abs) => {
        const p = padPose(R, k, abs, t);
        const d = discDistance(b.p, p.top, p.n, p.rho) - GEOM.RM;
        if (d < worst){ worst = d; at = { t, k, abs }; }
      });
    }
    expect(worst, JSON.stringify(at)).toBeGreaterThan(-2e-3);
    expect(maxZ).toBe(0);                                               // every flight in the strike plane
    expect(worstWall).toBeGreaterThan(0);
    expect(worstMag).toBeGreaterThan(-1e-9);
    if (R.evs.some((e, i) => e.side !== R.evs[(i + 1) % R.n].side)) expect(worstNet).toBeGreaterThan(.15);
  });

  it('flown arcs stay under the magnet; parks kiss it at zero vertical speed', () => {
    for (const [, { R }] of RECS) for (const e of R.evs){
      if (e.park){
        expect(e.vOut[1] - g * e.tUp).toBeCloseTo(0, 9);
        expect(e.C[1] + .5 * g * e.tUp * e.tUp).toBeCloseTo(GEOM.Y_M, 9);
      } else {
        const tA = Math.max(0, Math.min(e.gap, e.vOut[1] / g));
        expect(e.C[1] + e.vOut[1] * tA - .5 * g * tA * tA).toBeLessThan(GEOM.Y_M + 1e-9);
      }
    }
  });

  for (const [name, { R, P }] of RECS) it(`${name}: pads never touch each other, and the pool covers the most ever out`, () => {
    let worst = Infinity, at = null;
    const M = maxPads(R);
    for (let t = START; t < R.first + P; t += 1 / 120){
      const live = [];
      expect(forPads(R, t, (k, abs) => live.push([k, padPose(R, k, abs, t)]))).toBeLessThanOrEqual(M);
      for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++){
        if (live[i][1].side !== live[j][1].side) continue;
        const d = discGap(live[i][1], live[j][1]);
        if (d < worst){ worst = d; at = { t, a: live[i][0], b: live[j][0] }; }
      }
    }
    expect(worst, JSON.stringify(at)).toBeGreaterThan(.02);
  });

  for (const [name, { R, P }] of RECS) it(`${name}: a pad is out only in the open run, stowed edge-on inside the cowls`, () => {
    for (let t = START; t < R.first + P; t += 1 / 60) forPads(R, t, (k, abs) => {
      const p = padPose(R, k, abs, t);
      if (Math.abs(p.z) > R.ZW - p.rho - .04){ expect(p.extend).toBe(0); expect(p.tilt).toBe(0); }
      expect(Math.abs(p.z)).toBeLessThanOrEqual(R.ZW + p.rho + 1e-9);
    });
  });
});

describe('volley continuity — strikes, the loop seam and the count-in', () => {
  for (const [name, { R, P }] of RECS) it(`${name}: marble position is continuous; velocity only changes at a contact (or on the magnet)`, () => {
    const dt = 1 / 4000;
    const hits = strikes(R, P, START, R.first + 1.3 * P).map(x => x[1]);
    let maxJump = 0, maxDv = 0, prev = ballAt(R, START);
    for (let t = START + dt; t < R.first + 1.3 * P; t += dt){
      const b = ballAt(R, t);
      maxJump = Math.max(maxJump, len(sub(b.p, prev.p)));
      const nearHit = hits.some(h => h > t - dt - 1e-9 && h <= t + 1e-9);
      const held = ['hold', 'held'].includes(b.mode) || ['hold', 'held'].includes(prev.mode);
      if (!nearHit && !held) maxDv = Math.max(maxDv, Math.hypot(b.v[0] - prev.v[0], b.v[1] - prev.v[1] + g * dt, b.v[2] - prev.v[2]));
      prev = b;
    }
    expect(maxJump).toBeLessThan(30 * dt);
    expect(maxDv).toBeLessThan(1e-6);                                   // free flight is free flight
  });

  for (const [name, { R, P }] of RECS) it(`${name}: the shuttle is C¹, on its rail, and carries the marble exactly while holding`, () => {
    const dt = 1 / 2000;
    let prev = shuttleAt(R, START), maxV = 0, maxA = 0, lo = Infinity, hi = -Infinity, carry = 0, bad = 0;
    for (let t = START + dt; t < R.first + 1.3 * P; t += dt){
      const c = shuttleAt(R, t), b = ballAt(R, t);
      lo = Math.min(lo, c.x); hi = Math.max(hi, c.x);
      maxV = Math.max(maxV, Math.abs(c.x - prev.x) / dt);
      maxA = Math.max(maxA, Math.abs(c.v - prev.v) / dt);
      if (b.mode === 'hold' || b.mode === 'held'){ carry = Math.max(carry, Math.abs(c.x - b.p[0])); if (!c.holding) bad++; }
      prev = c;
    }
    expect(lo).toBeGreaterThanOrEqual(-X_RAIL - 1e-9); expect(hi).toBeLessThanOrEqual(X_RAIL + 1e-9);
    expect(carry).toBeLessThan(1e-7); expect(bad).toBe(0);
    expect(maxV).toBeLessThan(16);                                      // a finite speed — no teleport
    expect(maxA).toBeLessThan(60);                                      // no velocity snap (C¹)
  });

  for (const [name, { R, P }] of RECS) it(`${name}: pad poses are continuous through the loop seam and the count-in`, () => {
    const dt = 1 / 1000;
    let worst = 0;
    for (const [k, abs] of strikes(R, P, START - P, R.first + 1.2 * P).concat(R.evs.map((e, k) => [k, e.s - P]))){
      let prev = null;
      for (let t = abs - R.PRE; t < abs + R.POST; t += dt){
        if (t < START) continue;
        const p = padPose(R, k, abs, t);
        if (prev) worst = Math.max(worst, len(sub(p.top, prev.top)) / dt);
        prev = p;
      }
    }
    expect(worst).toBeLessThan(32);                                     // u/s: a pad never jumps (its boom snaps out fast, but it travels)
  });

  it('the count-in hangs ARMED on the shuttle, then is released exactly as in steady state', () => {
    for (const [, { R }] of RECS){
      expect(ballAt(R, START).mode).toBe('held');
      expect(ballAt(R, START).p[1]).toBe(GEOM.Y_M);
      expect(shuttleAt(R, START).v).toBeCloseTo(0, 12);                 // it starts from rest
      const b = ballAt(R, R.first);
      expect(b.armed).toBe(false);
      if (R.cntPark){                                                   // the count-in IS the incoming park's tail
        const pe = R.evs[(R.firstIdx - 1 + R.n) % R.n];
        expect(R.uIn).toBeCloseTo(pe.u, 12);
      }
    }
  });
});

describe('volley voice — a struck steel pan', () => {
  it('renders finite, bounded, non-silent, short samples with its fundamental on pitch', () => {
    for (const note of ['C4', 'A4', 'E6']){
      const { samples, sr } = steelpanVoice(note);
      let peak = 0; for (const x of samples){ expect(Number.isFinite(x)).toBe(true); peak = Math.max(peak, Math.abs(x)); }
      expect(peak).toBeGreaterThan(.1); expect(peak).toBeLessThanOrEqual(.92);
      expect(samples.length / sr).toBeLessThanOrEqual(3);
    }
    // the fundamental dominates a 1/f sweep around it (a plain DFT probe at 200 ms in)
    const { samples, sr } = steelpanVoice('A4');
    const probe = f => { let re = 0, im = 0; const i0 = Math.round(.2 * sr), N = 4096;
      for (let i = 0; i < N; i++){ const w = .5 - .5 * Math.cos(2 * Math.PI * i / N); re += samples[i0 + i] * w * Math.cos(2 * Math.PI * f * i / sr); im += samples[i0 + i] * w * Math.sin(2 * Math.PI * f * i / sr); }
      return Math.hypot(re, im); };
    expect(probe(440)).toBeGreaterThan(3 * probe(415));
    expect(probe(440)).toBeGreaterThan(3 * probe(466));
  });
});
