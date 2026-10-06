import { describe, it, expect } from 'vitest';
import { GEOM, g, X_RAIL, RHO_MAX, xOfRank, buildVolley, ballAt, shuttleAt, padPose, forPads, maxPads, stroke,
         wallSpeed, discDistance, chainEvents, assignSides, staff, solOf, netClear, crossOK } from '../src/instruments/volley/solve.js';
import { SONGS } from '../src/songs/index.js';
import { fitLine, LINE_SPEC } from '../src/editor/mapping.js';
import VOL from '../src/instruments/volley/index.js';
import { steelpanVoice } from '../src/instruments/volley/voice.js';
import { noteNum } from '../src/engine.js';

const ROLL_T = 2.6, START = -2.4;
const mk = (part, bpm = VOL.demo.bpm, beats = VOL.demo.beats) => {
  const beat = 60 / bpm, P = ROLL_T + beats * beat + 1.2;        // main.js: ROLL_T + LOOP_T, LOOP_T = melody + 1.2
  const R = buildVolley(part, { rollT: ROLL_T, beat, P, start: START });
  return { R, beat, P: R.P, P1: P };                              // (R.P: a doubled loop's period is 2P)
};
const DEMO = mk(VOL.demo.part);
// stresses: a 16th-note run on one wall, a lone note (the whole loop is one same-wall park),
// an odd number of volleys (the parity rule), a part with no park into its first strike, wide leaps
const DENSE = [];
{ const ns = ['C5', 'D5', 'E5', 'G5', 'A5', 'C6', 'B5', 'G5', 'E5', 'D5', 'C4', 'A5']; let b = 0;
  for (let i = 0; b < 16; i++){ DENSE.push([b, ns[(i * 7) % ns.length], .5 + .05 * (i % 9)]); b += [.5, .25, .25, 1, .25, .25, .5, 2][i % 8]; } }
const sixteenths = [];
['C5', 'D5', 'E5', 'F5', 'G5', 'F5', 'E5', 'D5'].forEach((n, i) => sixteenths.push([4 + i * .25, n, .6]));
const STRESS = {
  '16ths': mk(sixteenths.concat([[0, 'C4'], [2, 'G4'], [7, 'C5'], [10, 'G5']]), 100, 16),
  lone: mk([[3, 'E5', .8]], 100, 8),
  odd: mk([[0, 'C5'], [2, 'E5'], [4, 'G5'], [6.5, 'C6'], [7, 'B5']], 100, 8),
  noPark: mk([[0, 'C5'], [2, 'D5'], [4, 'E5'], [6, 'F5']], 120, 8),
  leaps: mk([[0, 'C4'], [1, 'C6'], [2, 'C4'], [2.5, 'G5'], [3, 'D4'], [5, 'A5'], [5.5, 'A3'], [7, 'E6']], 90, 8),
  // too dense to play honestly as written (16ths at 110 against wide leaps): it must THIN, then be clean
  dense: mk(DENSE, 110, 16),
  // a continuous 16th run: no gap inside the loop can serve — the loop DOUBLES (once per wall)
  run: mk(Array.from({ length: 32 }, (_, i) => [i * .25, ['C5', 'E5', 'G5', 'C6', 'G5', 'E5'][i % 6], .7]), 100, 8),
  // the composer's own sides
  pinned: mk([[0, 'E5', .8, 0, 'L'], [1, 'C5'], [2, 'G5', .8, 0, 'R'], [3, 'E5'], [4, 'C5', .8, 0, 'L'], [6, 'G5', .8, 0, 'R'], [7, 'C5']], 100, 8),
};
const RECS = [['demo', DEMO], ...Object.entries(STRESS)];

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = v => Math.hypot(v[0], v[1], v[2]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** every absolute strike (k, abs) in [from, to) that actually happens (at/after the count-in) */
function strikes(R, _P, from, to){
  const out = [], P = R.P;
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
  it('every volley clears the net (closed form) and is a real throw; volleys per loop are even', () => {
    for (const [name, { R }] of RECS){
      const n = R.n;
      const crosses = R.evs.filter((e, i) => e.side !== R.evs[(i + 1) % n].side).length;
      expect(crosses % 2, name).toBe(0);
      R.evs.forEach((e, i) => { const b = R.evs[(i + 1) % n];
        if (e.side === b.side || e.park) return;
        expect(e.gap, `${name} ${i}`).toBeGreaterThanOrEqual(GEOM.T_XMIN - 1e-9);
        expect(netClear(e.C[0], e.C[1], b.C[0], b.C[1], e.gap), `${name} ${i}`).toBeGreaterThanOrEqual(GEOM.NET_CLR - 1e-9); });
    }
  });
  it('sides are phrased: long gaps serve, a run is capped, the parity holds, the walls share', () => {
    // every long (phrase-end) gap serves: [1.2, 1.0, 2.0] — three long gaps, odd → the shortest
    // can't be dropped without a lopsided loop… it serves once more nowhere, so the loop DOUBLES
    const a = assignSides([1.2, 1.0, 2.0]);
    expect(a.cross).toEqual([true, true, true]); expect(a.double).toBe(true);
    // a run of 12 eighths at .55 s with one long gap: the run cap serves inside it (≤ RUN_N strikes)
    const gaps = [...Array(11).fill(.55), 2.0, ...Array(11).fill(.55), 2.0];
    const ys = gaps.map(() => 6.5);                                     // high notes: a short volley clears the net
    const r = assignSides(gaps, { ys, runT: 4 * .55 });
    expect(r.double).toBe(false);
    let run = 1, worst = 0; for (let i = 0; i < 2 * gaps.length; i++){ const k = i % gaps.length;
      if (r.cross[k]) run = 1; else worst = Math.max(worst, ++run); }
    expect(worst).toBeLessThanOrEqual(GEOM.RUN_N);
    expect(r.cross.filter(Boolean).length % 2).toBe(0);
    const L = r.side.filter(x => x < 0).length / gaps.length;
    expect(L).toBeGreaterThanOrEqual(GEOM.BAL); expect(L).toBeLessThanOrEqual(1 - GEOM.BAL);
    // a gap too short (or too low) to clear the net never serves
    expect(crossOK(.3, 3.5, 3.5)).toBe(false); expect(crossOK(GEOM.T_CROSS, 3.5, 3.5)).toBe(true);
    // pins are the law
    const p = assignSides([.3, .3, .3, .3], { pins: [-1, 0, 1, 0] });
    expect(p.side).toEqual([-1, -1, 1, 1]);
    expect(STRESS.pinned.R.evs.map(e => e.side)).toEqual([-1, -1, 1, 1, -1, 1, 1]);
    expect(chainEvents([[0, 'C5', .5, 0, 'R'], [1, 'D5']], { rollT: ROLL_T, beat: .6, P: 9 }).map(e => e.pin)).toEqual([1, 0]);
  });
  it('the catalog trades: every melody played on the volley gives both walls a real share', () => {
    for (const [key, song] of Object.entries(SONGS)){
      if (!song?.melody) continue;
      const notes = Array.isArray(song.melody) ? song.melody : song.melody.notes;
      let b = 0; const part = []; for (const [n, d] of notes){ part.push([b, n, .8]); b += d; }
      const { R } = mk(part, song.bpm, b);
      const L = R.evs.filter(e => e.side < 0).length / R.n;
      expect(L, key).toBeGreaterThanOrEqual(.25); expect(L, key).toBeLessThanOrEqual(.75);
      expect(R.ok, `${key}: ${R.warnings.join('; ')}`).toBe(true);
    }
  });
  it('honest or thinned: a line too dense to play is merged down, and says so', () => {
    const { R } = STRESS.dense;
    expect(R.thinned).toBeGreaterThan(0); expect(R.ok).toBe(true);
    expect(R.notes[0]).toMatch(/thinned/);
    expect(GEOM.MIN_HOP).toBeGreaterThan(GEOM.MIN_GAP);
  });
  it('the MAP panel fits a line to what the walls can play: MIN_HOP air, then the solver\'s own thinning, reported', () => {
    expect(LINE_SPEC.volley.minGap).toBe(GEOM.MIN_HOP);
    const notes = DENSE.map(([beat, n, vel]) => ({ beat, midi: noteNum(n), vel }));
    const { part, warnings } = fitLine('volley', notes, { bpm: 110, loopBeats: 16 });
    expect(part.length).toBeLessThan(notes.length);
    expect(warnings.some(w => /thinned/.test(w))).toBe(true);
    const beat = 60 / 110, R = buildVolley(part, { rollT: ROLL_T, beat, P: ROLL_T + 16 * beat + 1.2, start: START });
    expect(R.thinned).toBe(0); expect(R.ok).toBe(true);                // what the panel shows is what plays
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
  it('the run DOUBLES: each wall plays the loop once, the marble handed across at the seam', () => {
    const { R, P1 } = STRESS.run;
    expect(R.loops).toBe(2); expect(R.P).toBeCloseTo(2 * P1, 12);
    expect(R.evs.filter(e => e.side < 0).length).toBe(R.n / 2);
    for (let i = 0; i < R.n / 2; i++) expect(R.evs[i + R.n / 2].side).toBe(-R.evs[i].side);
  });
  it('every build is clean (no warnings) — the stresses included', () => {
    for (const [name, { R }] of RECS) expect(R.warnings, name).toEqual([]);
    expect(RHO_MAX).toBeGreaterThan(Math.max(...RECS.flatMap(([, { R }]) => R.evs.map(e => e.rho))) - 1e-12);
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
    for (let t = START; t < R.first + 1.2 * R.P; t += 1 / 600){
      const b = ballAt(R, t);
      maxZ = Math.max(maxZ, Math.abs(b.p[2]));
      worstWall = Math.min(worstWall, GEOM.XF - .2 - Math.abs(b.p[0]) - GEOM.RM);   // the slats + shoes (the cowls are off the strike plane)
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

  /* the LINKAGE, not just the disc: shoe → boom → elbow → riser → knuckle → arm → disc, as capsules */
  const capD = (p, A, B) => { const ab = sub(B, A), ap = sub(p, A), L2 = dot(ab, ab) || 1;
    const u = Math.max(0, Math.min(1, dot(ap, ab) / L2)); return len(sub(ap, ab.map(x => x * u))); };
  const linkSegs = p => { const bot = p.top.map((x, a) => x - p.n[a] * GEOM.PAD_T);
    return [[p.knuckle, bot, GEOM.ARM_R], [p.shoe, p.elbow, GEOM.BOOM_R], [p.elbow, p.knuckle, GEOM.BOOM_R]]; };
  for (const [name, { R }] of RECS) it(`${name}: the marble never touches a pad's arm, boom or riser — and no boom pierces its own disc`, () => {
    let worst = Infinity, at = null, self = Infinity, sat = null;
    for (let t = START; t < R.first + 1.2 * R.P; t += 1 / 600){
      const b = ballAt(R, t);
      forPads(R, t, (k, abs) => {
        const p = padPose(R, k, abs, t);
        for (const [A, B, r] of linkSegs(p)){
          const d = capD(b.p, A, B) - r - GEOM.RM;
          if (d < worst){ worst = d; at = { t, k, abs }; }
        }
        for (const [A, B, r] of linkSegs(p).slice(1)) for (let u = 0; u <= 1; u += 1 / 24){
          const q = A.map((x, a) => x + (B[a] - x) * u), d = discDistance(q, p.top, p.n, p.rho) - r;
          if (d < self){ self = d; sat = { t, k, abs, u }; }
        }
      });
    }
    expect(worst, JSON.stringify(at)).toBeGreaterThan(-2e-3);
    expect(self, JSON.stringify(sat)).toBeGreaterThan(0);
  });
  it('a backhand pad (its face toward its own wall) dog-legs its boom under the disc and the ball', () => {
    const backs = DEMO.R.evs.filter(e => e.back);
    expect(backs.length).toBeGreaterThan(0);
    for (const e of backs){
      expect(e.yb).toBeLessThan(e.K[1]);
      expect(e.yb).toBeLessThan(e.C[1] - GEOM.RM - GEOM.BOOM_R);
      expect(e.yb).toBeGreaterThanOrEqual(GEOM.Y_BOOM_MIN);
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
        let d = discGap(live[i][1], live[j][1]);
        // and neither pad's boom / riser runs through the other's disc
        for (const [x, y] of [[live[i][1], live[j][1]], [live[j][1], live[i][1]]])
          for (const [A, B, r] of linkSegs(x).slice(1)) for (let u = 0; u <= 1; u += 1 / 12){
            const q = A.map((v, a) => v + (B[a] - v) * u); d = Math.min(d, discDistance(q, y.top, y.n, y.rho) - r); }
        if (d < worst){ worst = d; at = { t, a: live[i][0], b: live[j][0] }; }
      }
    }
    expect(worst, JSON.stringify(at)).toBeGreaterThan(.02);
  });

  for (const [name, { R, P }] of RECS) it(`${name}: a pad is out only in the open run, stowed edge-on inside the cowls`, () => {
    for (let t = START; t < R.first + P; t += 1 / 60) forPads(R, t, (k, abs) => {
      const p = padPose(R, k, abs, t);
      if (Math.abs(p.z) > R.ZW - p.rho - .04){
        expect(p.extend).toBe(0); expect(p.tilt).toBe(0);
        // …and its disc's court-side edge stays inside the cowl (x, not just z)
        expect(GEOM.XF - Math.abs(p.top[0]) + p.rho).toBeLessThanOrEqual(GEOM.COWL_IN - .05 + 1e-9);
      }
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
    expect(worst).toBeLessThan(40);                                     // u/s: a pad never jumps (its boom + arm snap out fast, but they travel)
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
  it('the stick is a tick, not a clack; the shimmer is a slow beat, not a tremolo', () => {
    for (const note of ['C4', 'G5', 'C6']){
      const { samples, sr } = steelpanVoice(note);
      const rms = (a, b) => { let q = 0; for (let i = a; i < b; i++) q += samples[i] * samples[i]; return Math.sqrt(q / (b - a)); };
      // the tick lives in the first ~10 ms: it may lift the attack, but the tone owns it
      const att = rms(0, Math.round(.012 * sr)), tone = rms(Math.round(.03 * sr), Math.round(.06 * sr));
      expect(att, note).toBeLessThan(1.35 * tone);
      expect(steelpanVoice(note).tick).toBeLessThanOrEqual(.35);     // the stick's peak, measured against the tone's
      // the FUNDAMENTAL's envelope (a 60 ms Goertzel probe every 40 ms over the first second),
      // its exponential decay fitted out: the near-degenerate pair may beat gently, never pump
      const f = 440 * Math.pow(2, (noteNum(note) - 69) / 12), N = Math.round(.06 * sr), env = [];
      for (let i0 = Math.round(.08 * sr); i0 + N < Math.min(samples.length, sr); i0 += Math.round(.04 * sr)){
        let re = 0, im = 0; for (let i = 0; i < N; i++){ const w = .5 - .5 * Math.cos(2 * Math.PI * i / N), x = samples[i0 + i] * w;
          re += x * Math.cos(2 * Math.PI * f * i / sr); im += x * Math.sin(2 * Math.PI * f * i / sr); }
        env.push([i0 / sr, Math.log(Math.hypot(re, im))]); }
      const mx = env.reduce((a, e) => a + e[0], 0) / env.length, my = env.reduce((a, e) => a + e[1], 0) / env.length;
      const k = env.reduce((a, e) => a + (e[0] - mx) * (e[1] - my), 0) / env.reduce((a, e) => a + (e[0] - mx) ** 2, 0);
      const res = env.map(e => e[1] - (my + k * (e[0] - mx)));
      expect(Math.exp(Math.max(...res) - Math.min(...res)), note).toBeLessThan(1.45);
    }
  });
});
