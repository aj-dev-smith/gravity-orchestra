import { describe, it, expect } from 'vitest';
import { GEOM, Y_S, Y_C, Y_M, H_ARC, PRE, POST, g, buildRecord, ballAt, carriageAt, padPose, forActivePads,
         stroke, deployAt, driveTime, driveRate, spinTime, maxActive, discDistance, clearance, toLocal,
         chainEvents, staff, RAIL, wallSpeed } from '../src/instruments/turntable/solve.js';
import TT from '../src/instruments/turntable/index.js';
import { noteNum } from '../src/engine.js';

const TAU = Math.PI * 2, ROLL_T = 2.6, START = -2.4;
const beat = 60 / TT.demo.bpm;
const P = ROLL_T + TT.demo.beats * beat + 1.2;          // main.js: ROLL_T + LOOP_T, LOOP_T = melody + 1.2
const R = buildRecord(TT.demo.part, { rollT: ROLL_T, beat, P, start: START });
// a stress record: a dense repeat, a chord (monophonic: keeps the top), a big leap, a lone long note
const stressPart = [[0, 'C5'], [.5, 'C5'], [1, 'C5'], [1, 'E4'], [1.5, 'G3'], [2, 'G5', .6], [3, 'D4'], [9, 'A5', .4]];
const RS = buildRecord(stressPart, { rollT: ROLL_T, beat, P, start: START });
// a 16th-note run on neighbouring pitches (the dense case spacing must solve by geometry)
const sixteenths = [];
['C5', 'D5', 'E5', 'F5', 'G5', 'F5', 'E5', 'D5'].forEach((n, i) => sixteenths.push([4 + i * .25, n, .6]));
['A4', 'B4', 'C5', 'D5', 'C5', 'B4', 'A4', 'G4'].forEach((n, i) => sixteenths.push([8 + i * .25, n, .6]));
const R16 = buildRecord(sixteenths.concat([[0, 'C4'], [2, 'G4'], [12, 'C5']]), { rollT: ROLL_T, beat, P, start: START });
const RECS = [['demo', R], ['stress', RS], ['16ths', R16]];

const wrapPi = a => ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = v => Math.hypot(v[0], v[1], v[2]);
const ballLocal = (Rr, t) => { const b = ballAt(Rr, t); return toLocal(b.s, b.y); };
/** every absolute strike time in [from, to) */
function strikes(Rr, from, to){
  const out = [];
  Rr.evs.forEach((e, k) => { for (let a = e.s + Math.ceil((from - e.s) / P) * P; a < to; a += P) if (a >= Rr.first - 1e-9) out.push([k, a]); });
  return out.sort((x, y) => x[1] - y[1]);
}

describe('turntable record — the platter IS the score', () => {
  it('spins an INTEGER number of revolutions per loop (loops by construction)', () => {
    for (const [, Rr] of RECS){
      expect(Number.isInteger(Rr.N)).toBe(true);
      expect(Rr.omega * P / TAU).toBeCloseTo(Rr.N, 12);
    }
  });
  it('rim speed is in the belt\'s range and every deployed pair clears (geometry, not shrinking)', () => {
    expect(R.ok).toBe(true);
    expect(R.omega * (GEOM.R_IN + GEOM.R_OUT) / 2).toBeGreaterThanOrEqual(GEOM.RIM_MIN - 1e-9);
    expect(R.omega * GEOM.R_OUT).toBeLessThanOrEqual(GEOM.RIM_MAX + 1e-9);
    expect(clearance(R.evs, P, R.omega).worst).toBeGreaterThanOrEqual(1);
  });
  it('radius encodes pitch (low = outer); pad size is a pure fn of the note', () => {
    const st = R.staff;
    expect(st.ringR('F3')).toBeGreaterThan(st.ringR('F6'));
    expect(st.padR('F3')).toBeGreaterThan(st.padR('F6'));
    for (const e of R.evs){ expect(e.rho).toBe(st.padR(e.note)); expect(e.r).toBe(st.ringR(e.note)); }
  });
  it('the chain is monophonic: a chord keeps its top note', () => {
    const ev = chainEvents([[0, 'C4'], [0, 'G4', .3], [1, 'E4']], { rollT: ROLL_T, beat, P });
    expect(ev.map(e => e.note)).toEqual(['G4', 'E4']);
    expect(chainEvents(TT.demo.part, { rollT: ROLL_T, beat, P }).length).toBe(TT.demo.part.length);
  });
});

describe('turntable honesty — every strike', () => {
  for (const [name, Rr] of RECS) it(`${name}: the pad reaches the strike line ON the beat, deployed, at rest at contact, under the marble`, () => {
    for (const [k, abs] of strikes(Rr, Rr.first, Rr.first + 2 * P)){
      const e = Rr.evs[k], p = padPose(Rr, k, abs, abs);
      expect(wrapPi(p.a - GEOM.A_S)).toBeCloseTo(0, 9);              // on the strike line
      expect(p.extend).toBe(1); expect(p.tilt).toBe(1);               // fully deployed
      expect(Math.abs(p.off)).toBe(0);                                        // the stroke is exactly 0 at contact
      expect(Math.abs(stroke(0, e.A))).toBe(0);
      const c = ballLocal(Rr, abs);                                   // the marble lands exactly on time…
      const C = toLocal(e.C[0], e.C[1]);
      for (let a = 0; a < 3; a++) expect(c[a]).toBeCloseTo(C[a], 9);
      const before = ballLocal(Rr, abs - 1e-7);                       // …continuously (no snap)
      expect(len(sub(before, c))).toBeLessThan(1e-5);
      const d = sub(c, p.top);                                        // touching the face, along its normal
      for (let a = 0; a < 3; a++) expect(d[a]).toBeCloseTo(GEOM.RM * p.n[a], 9);
      expect(discDistance(c, p.top, p.n, e.rho)).toBeCloseTo(GEOM.RM, 9);
    }
  });

  it('every bounce is a frictionless contact: the impulse is along the pad normal, face speed kept', () => {
    for (const [, Rr] of RECS) for (const e of Rr.evs){
      const dv = [e.vOut[0] - e.vIn[0], e.vOut[1] - e.vIn[1]];
      expect(dv[0] * e.nrm[1] - dv[1] * e.nrm[0]).toBeCloseTo(0, 9);          // (vout − vin) × n = 0
      expect(dv[0] * e.nrm[0] + dv[1] * e.nrm[1]).toBeGreaterThan(0);          // a push, not a pull
      const tIn = e.vIn[0] * e.nrm[1] - e.vIn[1] * e.nrm[0], tOut = e.vOut[0] * e.nrm[1] - e.vOut[1] * e.nrm[0];
      expect(tOut).toBeCloseTo(tIn, 9);                                          // speed along the face unchanged
      expect(e.vinN).toBeGreaterThan(0); expect(e.voutN).toBeGreaterThan(0);    // arrives into the face, leaves off it
    }
  });

  it('the stroke is the moving-wall solve: the pad\'s own contact speed supplies exactly the lost energy', () => {
    for (const [, Rr] of RECS) for (const e of Rr.evs){
      const h = 1e-6, w = (stroke(0, e.A) - stroke(-h, e.A)) / h;              // pad speed along n just before contact
      expect(w).toBeCloseTo(e.w, 3);
      // relative-velocity restitution: (vout − w) = e·(vin + w)  ⇔  vout = e·vin + (1+e)·w
      expect(e.voutN - w).toBeCloseTo(GEOM.E * (e.vinN + w), 3);
      expect(e.w).toBeCloseTo(wallSpeed(e.vinN, e.voutN), 12);
      expect(-w).toBeLessThan(e.vinN);                                           // a yielding pad is slower than the ball
    }
  });
});

describe('turntable honesty — nothing passes through anything', () => {
  for (const [name, Rr] of RECS) it(`${name}: the marble never enters a pad, the platter or the magnet`, () => {
    let worst = Infinity, worstPlat = Infinity, worstMag = Infinity, at = null;
    const dt = 1 / 600;
    for (let t = START; t < Rr.first + 1.2 * P; t += dt){
      const b = ballAt(Rr, t), c = toLocal(b.s, b.y);
      worstPlat = Math.min(worstPlat, b.y - GEOM.RM - GEOM.Y_PLAT);
      worstMag = Math.min(worstMag, Y_M - b.y);
      forActivePads(Rr, t, (k, abs) => {
        const p = padPose(Rr, k, abs, t);
        const d = discDistance(c, p.top, p.n, Rr.evs[k].rho) - GEOM.RM;
        if (d < worst){ worst = d; at = { t, k, abs }; }
      });
    }
    expect(worst, JSON.stringify(at)).toBeGreaterThan(-2e-3);
    expect(worstPlat).toBeGreaterThan(.3);
    expect(worstMag).toBeGreaterThan(-1e-9);
  });

  it('flown arcs stay under the magnet; parks kiss it at zero vertical speed', () => {
    for (const [, Rr] of RECS) for (const e of Rr.evs){
      if (e.park){
        expect(e.vOut[1] - g * e.tUp).toBeCloseTo(0, 9);
        expect(e.C[1] + .5 * g * e.tUp * e.tUp).toBeCloseTo(Y_M, 9);
      } else {
        const tA = Math.max(0, Math.min(e.gap, e.vOut[1] / g));
        expect(e.C[1] + e.vOut[1] * tA - .5 * g * tA * tA).toBeLessThan(Y_M + 1e-9);
        expect(e.gap).toBeLessThanOrEqual(GEOM.DT_MAX + .05);
      }
    }
    expect(H_ARC).toBeCloseTo(g * GEOM.DT_MAX ** 2 / 8, 12);
  });

  for (const [name, Rr] of RECS) it(`${name}: deployed pads never collide with each other or dig into the platter`, () => {
    let worst = Infinity, worstPlat = Infinity;
    for (let t = START; t < Rr.first + P; t += 1 / 60){
      const live = [];
      forActivePads(Rr, t, (k, abs) => { const p = padPose(Rr, k, abs, t); live.push([k, p]); });   // flush or up
      for (let i = 0; i < live.length; i++){
        const [k, p] = live[i], e = Rr.evs[k];
        if (p.tilt > 0) worstPlat = Math.min(worstPlat, p.top[1] - e.rho * Math.sqrt(1 - p.n[1] * p.n[1]) - GEOM.PAD_T * p.n[1] - GEOM.Y_PLAT);
        for (let j = i + 1; j < live.length; j++){
          const [k2, p2] = live[j];
          worst = Math.min(worst, len(sub(p.top, p2.top)) / (e.rho + Rr.evs[k2].rho));
        }
      }
    }
    expect(worst).toBeGreaterThanOrEqual(1);
    expect(worstPlat).toBeGreaterThan(-1e-9);
  });

  it('the pad pool covers the most pads ever out', () => {
    for (const [, Rr] of RECS){
      const M = maxActive(Rr);
      for (let t = START; t < Rr.first + P; t += 1 / 50) expect(forActivePads(Rr, t, () => {})).toBeLessThanOrEqual(M);
    }
  });
});

describe('turntable continuity — strikes, the loop seam and the count-in', () => {
  for (const [name, Rr] of RECS) it(`${name}: marble position is continuous; velocity only changes at a contact or a magnet`, () => {
    const dt = 1 / 4000;
    const hits = strikes(Rr, START, Rr.first + 1.3 * P).map(x => x[1]);
    let maxJump = 0, maxDv = 0;
    let prev = ballAt(Rr, START);
    for (let t = START + dt; t < Rr.first + 1.3 * P; t += dt){
      const b = ballAt(Rr, t);
      maxJump = Math.max(maxJump, Math.hypot(b.s - prev.s, b.y - prev.y));
      const nearHit = hits.some(h => h > t - dt - 1e-9 && h <= t + 1e-9);
      if (!nearHit) maxDv = Math.max(maxDv, Math.hypot(b.vs - prev.vs, b.vy - prev.vy - (-g * dt)) * (['hold', 'held'].includes(b.mode) || ['hold', 'held'].includes(prev.mode) ? 0 : 1));
      prev = b;
    }
    expect(maxJump).toBeLessThan(25 * dt);                 // < 25 u/s anywhere
    expect(maxDv).toBeLessThan(1e-6);                       // free flight is free flight
  });

  for (const [name, Rr] of RECS) it(`${name}: the carriage is C¹, on its rail, and carries the marble exactly while holding`, () => {
    const dt = 1 / 2000;
    let prev = carriageAt(Rr, START), maxJ = 0, maxA = 0, lo = Infinity, hi = -Infinity, carry = 0, bad = 0;
    for (let t = START + dt; t < Rr.first + 1.3 * P; t += dt){
      const c = carriageAt(Rr, t), b = ballAt(Rr, t);
      lo = Math.min(lo, c.s); hi = Math.max(hi, c.s);
      maxJ = Math.max(maxJ, Math.abs(c.s - prev.s));
      maxA = Math.max(maxA, Math.abs(c.v - prev.v) / dt);
      if (b.mode === 'hold' || b.mode === 'held'){ carry = Math.max(carry, Math.abs(c.s - b.s)); if (!c.holding) bad++; }
      prev = c;
    }
    expect(lo).toBeGreaterThanOrEqual(RAIL.S0); expect(hi).toBeLessThanOrEqual(RAIL.S1);
    expect(carry).toBeLessThan(1e-9); expect(bad).toBe(0);
    expect(maxJ / dt).toBeLessThan(12);                      // a finite speed — no teleport
    expect(maxA).toBeLessThan(60);                           // and no velocity snap (C¹)
  });

  for (const [name, Rr] of RECS) it(`${name}: pad poses are continuous through the loop seam and the count-in`, () => {
    const dt = 1 / 1000;
    // track one occurrence by (k, abs): its pose may only move a little per step
    let worst = 0;
    for (const [k, abs] of strikes(Rr, START - P, Rr.first + 1.2 * P).concat(Rr.evs.map((e, k) => [k, e.s - P]))){
      let prev = null;
      for (let t = abs - (PRE + Rr.hide) / Rr.omega - .2; t < abs + (POST + Rr.hide) / Rr.omega + .2; t += dt){
        if (t < START) continue;
        const p = padPose(Rr, k, abs, t);
        if (prev) worst = Math.max(worst, len(sub(p.top, prev.top)));
        prev = p;
      }
    }
    expect(worst / dt).toBeLessThan(GEOM.R_PLAT * Rr.omega + 25);   // rim speed + the stroke: finite, no pops
  });

  it('ARMED: the marble hangs on the magnet until the release, nothing strikes before start', () => {
    for (const [, Rr] of RECS){
      expect(Rr.first).toBeGreaterThanOrEqual(0);
      expect(Rr.tRel).toBeGreaterThan(START);
      for (let t = START; t < Rr.tRel; t += .05){ const b = ballAt(Rr, t); expect(b.mode).toBe('held'); expect(b.y).toBe(Y_M); }
      const c0 = carriageAt(Rr, START);
      expect(c0.v).toBeCloseTo(0, 9);                           // the carriage starts from rest
      // the count-in drop lands exactly like the steady-state seam drop (same vIn)
      const fe = Rr.evs[Rr.firstIdx], h = 1e-6;
      const b0 = ballAt(Rr, Rr.first - h), b1 = ballAt(Rr, Rr.first + P - h);
      expect(b0.vs).toBeCloseTo(b1.vs, 6); expect(b0.vy).toBeCloseTo(b1.vy, 3);
      expect(b0.vy).toBeCloseTo(fe.vIn[1], 3);
    }
  });

  it('the platter spins up from rest (C¹) to full speed on the score phase at t = 0', () => {
    const Ts = spinTime(START);
    expect(Ts).toBeGreaterThan(0); expect(Ts).toBeLessThanOrEqual(-START);
    expect(driveRate(START, Ts)).toBe(0);
    expect(driveTime(0, Ts)).toBe(0); expect(driveRate(-1e-9, Ts)).toBeCloseTo(1, 6);
    const h = 1e-6;
    for (let t = START; t < 1; t += .01)
      expect((driveTime(t + h, Ts) - driveTime(t - h, Ts)) / (2 * h)).toBeCloseTo(driveRate(t, Ts), 4);
  });

  it('a pad stands up only just in time: flush at the bridge, flush for most of its pass, fully up through its stroke', () => {
    for (const [, Rr] of RECS){
      const W = Rr.win;
      expect(deployAt(-PRE - Rr.hide, W).extend).toBe(0); expect(deployAt(POST + Rr.hide, W).extend).toBe(0);
      expect(deployAt(0, W).extend).toBe(1); expect(deployAt(0, W).tilt).toBe(1);
      // up for less than half the visible pass (the rest it rides flush, an inlay in the vinyl)
      expect(W.up0 / PRE).toBeLessThan(Rr === R16 ? .6 : .45);
      expect(W.dn1).toBeLessThan(POST);                                          // flush again before the bridge
      // fully up through every wind-up + the follow-through + the marble's exit
      for (const e of Rr.evs){
        const lead = .3 + Math.abs(e.A) * .35 + GEOM.STROKE_S;
        expect(deployAt(-lead * Rr.omega, e.win).tilt).toBe(1); expect(deployAt(-lead * Rr.omega, e.win).extend).toBe(1);
        expect(deployAt(-PRE - Rr.hide, e.win).extend).toBe(0);
      }
      expect(deployAt(.3 * Rr.omega, W).tilt).toBe(1);
      // the rise happens in FRONT of the audience (+z half of the record), not behind the bridge
      expect(Math.sin(GEOM.A_S - W.up0)).toBeGreaterThan(0);
    }
  });

  for (const [name, Rr] of RECS) it(`${name}: every pad stands on a FIXED foot in the vinyl (nothing slides through the record)`, () => {
    let worst = 0;
    for (const [k, abs] of strikes(Rr, Rr.first, Rr.first + P)){
      const e = Rr.evs[k];
      for (let t = abs - (PRE + Rr.hide) / Rr.omega; t < abs + (POST + Rr.hide) / Rr.omega; t += 1 / 120){
        const p = padPose(Rr, k, abs, t);
        // foot in the platter's own frame: radius F at the pad's own azimuth, under the vinyl
        expect(Math.hypot(p.foot[0], p.foot[2])).toBeCloseTo(e.F, 9);
        expect(p.foot[1]).toBeCloseTo(GEOM.Y_PLAT - GEOM.FOOT, 12);
        // the post is vertical (knuckle right above the foot), the face sits on the arm: top = knuckle + n·len
        worst = Math.max(worst, Math.abs(p.knuckle[0] - p.foot[0]), Math.abs(p.knuckle[2] - p.foot[2]));
        for (let a = 0; a < 3; a++) worst = Math.max(worst, Math.abs(p.top[a] - p.knuckle[a] - p.n[a] * p.len));
        expect(p.knuckle[1]).toBeGreaterThanOrEqual(p.foot[1] - 1e-9);
        expect(p.len).toBeGreaterThan(.05);                                      // the arm never collapses
      }
    }
    expect(worst).toBeLessThan(1e-9);
  });
});

describe('turntable edge cases', () => {
  it('a 16th-note run on neighbouring pitches is spaced by GEOMETRY (a faster spin), never by shrinking', () => {
    expect(R16.ok).toBe(true);
    expect(clearance(R16.evs, P, R16.omega).worst).toBeGreaterThanOrEqual(1);
    expect(R16.omega * GEOM.R_OUT).toBeLessThanOrEqual(GEOM.RIM_MAX + 1e-9);
    for (const e of R16.evs) expect(e.rho).toBe(R16.staff.padR(e.note));
  });

  it('a one-note part loops on the magnet forever; an empty part is inert', () => {
    const R1 = buildRecord([[3, 'A4']], { rollT: ROLL_T, beat, P, start: START });
    expect(R1.n).toBe(1); expect(R1.evs[0].park).toBe(true);
    for (let t = START; t < R1.first + 2.2 * P; t += .37){
      const b = ballAt(R1, t), c = carriageAt(R1, t);
      expect(Number.isFinite(b.s) && Number.isFinite(b.y) && Number.isFinite(c.s)).toBe(true);
      expect(b.y).toBeLessThanOrEqual(Y_M + 1e-9);
    }
    const R0 = buildRecord([], { rollT: ROLL_T, beat, P, start: START });
    expect(R0.n).toBe(0); expect(forActivePads(R0, 1, () => {})).toBe(0);
  });
});

describe('turntable voice — vibraphone', () => {
  it('renders a bounded, decaying, deterministic bar across F3–F6; higher rings shorter', () => {
    for (const note of ['F3', 'C4', 'A4', 'F5', 'F6']){
      const { samples, sr } = TT.voice(note);
      let peak = 0, head = 0, tail = 0;
      for (let i = 0; i < samples.length; i++){
        const a = Math.abs(samples[i]); peak = Math.max(peak, a);
        if (i < sr * .1) head = Math.max(head, a);
        if (i > samples.length - sr * .15) tail = Math.max(tail, a);
      }
      expect(peak).toBeGreaterThan(.4); expect(peak).toBeLessThanOrEqual(.9);
      expect(tail).toBeLessThan(head * .08);
      expect(samples.length / sr).toBeGreaterThan(2); expect(samples.length / sr).toBeLessThanOrEqual(3);
    }
    expect(TT.voice('F6').samples.length).toBeLessThan(TT.voice('F3').samples.length);
    const a = TT.voice('A4').samples, b = TT.voice('A4').samples;
    for (let i = 0; i < a.length; i += 101) expect(a[i]).toBe(b[i]);
  });
});

describe('turntable demo', () => {
  it('shows off long arcs, fast skims, repeated notes, big leaps and magnet parks', () => {
    const ev = R.evs;
    const flown = ev.filter(e => !e.park);
    expect(Math.max(...flown.map(e => e.gap))).toBeGreaterThanOrEqual(1.1);          // a tall arc
    expect(Math.min(...ev.map(e => e.gap))).toBeLessThanOrEqual(.31);                 // flat skims
    expect(ev.filter(e => e.park).length).toBeGreaterThanOrEqual(2);                  // mid-phrase park + the seam
    let rep = 0, leap = 0;
    ev.forEach((e, i) => { const b = ev[(i + 1) % ev.length];
      if (b.note === e.note) rep++;
      leap = Math.max(leap, Math.abs(noteNum(b.note) - noteNum(e.note))); });
    expect(rep).toBeGreaterThanOrEqual(3);
    expect(leap).toBeGreaterThanOrEqual(15);
    const nums = ev.map(e => noteNum(e.note));
    expect(Math.min(...nums)).toBeGreaterThanOrEqual(noteNum('F3'));
    expect(Math.max(...nums)).toBeLessThanOrEqual(noteNum('F6'));
    expect(ev[ev.length - 1].park).toBe(true);                                         // the seam parks
  });
});
