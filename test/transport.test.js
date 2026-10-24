import { describe, it, expect } from 'vitest';
import { advance, spinTime, spinFor, RUN_IN, ARM_AT } from '../src/transport.js';
import { DT_MAX } from '../src/drumparts.js';
import { T_ENTER } from '../src/instruments/marimba/solve.js';
import { dribbleLane, dribbleAt, firstStrike } from '../src/engine.js';
import { laneClock, at } from '../src/instruments/clock.js';

const LEAD_IN = 2.4;                                      // main.js's count-in

describe('the planner gate: a song never starts before its plan', () => {
  it('a pending song runs its count-in, then waits — however long the plan takes, at any frame rate', () => {
    for (const dt of [1 / 144, 1 / 60, 1 / 24, .05]){
      let t = -LEAD_IN;
      for (let k = 0; k < 20 / dt; k++){ t = advance(t, dt, { ready: false }); expect(t).toBeLessThan(0); }
      expect(t).toBeCloseTo(-RUN_IN, 9);
    }
  });
  it('the plan lands: the count-in runs on from where it waited', () => {
    let t = -LEAD_IN;
    for (let k = 0; k < 600; k++) t = advance(t, 1 / 60, { ready: false });
    const ready = [];
    for (let k = 0; k < 120; k++){ t = advance(t, 1 / 60, { ready: true }); ready.push(t); }
    expect(ready[0]).toBeCloseTo(-RUN_IN + 1 / 60, 9);
    expect(ready.at(-1)).toBeCloseTo(-RUN_IN + 2, 9);
  });
  it('a song already past the gate when its plan went stale (a MAP re-route kept the time) holds where it is', () => {
    for (const t of [-1, -.2, 0, 31.7]) expect(advance(t, .05, { ready: false })).toBe(t);
  });
  it('STOP freezes the frame; no time, no motion', () => {
    expect(advance(12.5, .05, { playing: false })).toBe(12.5);
    expect(advance(-2.4, .05, { playing: false, ready: false })).toBe(-2.4);
    expect(advance(3, 0)).toBe(3);
    expect(advance(3, NaN)).toBe(3);
  });
  it('the rate scales a ready song (?debug slow-mo, XR)', () => {
    expect(advance(1, .04, { rate: .25 })).toBeCloseTo(1.01, 12);
  });
});

describe('the machines sit out the count-in (start = ARM_AT)', () => {
  it('ARM_AT lies inside the loop\'s strike-free breath tail, after the gate', () => {
    expect(ARM_AT).toBeGreaterThanOrEqual(-1.2);          // juggle.js P: every event is pinned before the loop's last 1.2 s
    expect(ARM_AT).toBeGreaterThan(-RUN_IN);              // (while the plan is pending, every machine is already still)
    expect(ARM_AT).toBeLessThanOrEqual(-DT_MAX / 2);      // a drum ball's drop onto a pickup at songTime ≥ 0 starts after it
    expect(ARM_AT).toBeLessThanOrEqual(-T_ENTER);         // the marimba's hands glide in for a first strike at songTime ≥ 0
  });
  it('a drum ball hangs ARMED on its magnet through the count-in — never struck, never in mid-air', () => {
    const P = 10, tail = P - 1.25;                        // a hit just before the breath tail + a pickup right after 0
    for (const first of [.05, .3, .59, 2.6]){
      const L = dribbleLane([first, 3.1, 4, tail], P);
      expect(firstStrike(L, ARM_AT)).toBeCloseTo(first, 9);
      let prev = null;
      for (let t = -LEAD_IN; t < first; t += .01){
        const d = dribbleAt(L, t, ARM_AT);
        expect(d.mode === 'hold' || d.mode === 'drop').toBe(true);
        if (d.mode === 'drop') expect(t).toBeGreaterThanOrEqual(ARM_AT - 1e-9);
        if (prev) expect(Math.abs(d.y - prev.y)).toBeLessThan(.25);
        prev = d;
      }
    }
  });
  it('a plugin lane is ARMED until its first strike after songTime 0', () => {
    const P = 12, L = laneClock([2.6, 5, P - 1.3], P);
    for (let t = -LEAD_IN; t < 2.6; t += .05){ const c = at(L, t, ARM_AT); expect(c.armed).toBe(true); expect(c.first).toBeCloseTo(2.6, 9); }
    expect(at(L, 2.61, ARM_AT).armed).toBe(false);
  });
});

describe('the belt spins up (spinTime / spinFor)', () => {
  const old = (t, d) => t >= 0 ? t : -d * (1 - Math.max(0, 1 + t / LEAD_IN) ** (LEAD_IN / d));   // main.js's jugTime before the gate
  it('a build\'s spin-up is the old count-in exactly', () => {
    for (const d0 of [.05, .4, .9, 1.2, 3, Infinity]){
      const spin = spinFor(-LEAD_IN, d0, LEAD_IN);
      expect(spin.R).toBe(LEAD_IN);
      expect(spin.d).toBe(Math.min(LEAD_IN / 2, d0));
      for (let t = -LEAD_IN; t <= 1; t += .013) expect(spinTime(t, spin)).toBe(old(t, spin.d));
    }
  });
  it('a plan landing mid-count-in spins up over what is left: at rest at the landing, full speed at songTime 0', () => {
    for (const t0 of [-2.2, -1.7, -RUN_IN, -.5, -.05]){
      for (const d0 of [.1, .7, 2]){
        const spin = spinFor(t0, d0, LEAD_IN), h = 1e-6;
        expect(spin.R).toBeCloseTo(-t0, 12);
        expect(spin.d).toBeLessThanOrEqual(spin.R / 2 + 1e-12);
        expect(spinTime(t0, spin)).toBeCloseTo(-spin.d, 12);                              // the plan's breath, every ball home
        expect((spinTime(t0 + h, spin) - spinTime(t0, spin)) / h).toBeLessThan(.02);       // from rest
        expect((spinTime(0, spin) - spinTime(-h, spin)) / h).toBeCloseTo(1, 3);            // into full speed
        expect(spinTime(0, spin)).toBe(0);
        let prev = -Infinity;                                                              // never backwards
        for (let t = t0; t <= 0; t += .01){ const v = spinTime(t, spin); expect(v).toBeGreaterThanOrEqual(prev); prev = v; }
      }
    }
  });
  it('past songTime 0 the belt is songTime itself, and spinFor keeps the full count-in for a RESTART', () => {
    expect(spinTime(17.3, { R: .4, d: .2 })).toBe(17.3);
    expect(spinFor(40, .9, LEAD_IN)).toEqual({ R: LEAD_IN, d: .9 });
  });
});
