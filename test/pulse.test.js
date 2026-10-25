import { describe, it, expect } from 'vitest';
import { makePulse } from '../src/rooms/pulse.js';

/* PULSE (src/rooms/pulse.js): a machine's strike cue → a light envelope that is a PURE function of
   songTime — scrub-exact, silent through the count-in, honest across the loop seam. */

const P = 10, START = -.6, D = .45, LEAD = .3;
const cue = [{ t: 2, w: 1 }, { t: 2.1, w: .3 }, { t: 5, w: .6 }, { t: 8.5, w: .8 }];   // (events end ≥ 1.2 s before P)
const pulse = makePulse(cue, { P, start: START, decay: D, lead: LEAD });

describe('pulse: a strike cue as a pure envelope of songTime', () => {
  it('no cue (or no loop) is dark', () => {
    for (const p of [makePulse([], { P }), makePulse(null, { P }), makePulse(cue, { P: 0 })])
      for (const t of [-2, 0, 3, 50]){ expect(p.at(t)).toBe(0); expect(p.next(t)).toBe(0); }
  });
  it('a strike lights at its weight and decays exp(−dt / decay)', () => {
    expect(pulse.at(2)).toBeCloseTo(1, 12);
    expect(pulse.at(2 + D)).toBeCloseTo(Math.exp(-1), 12);
    expect(pulse.at(5)).toBeCloseTo(.6, 12);
    // between strikes it only falls
    let prev = Infinity;
    for (let t = 5; t < 8.5; t += .05){ const v = pulse.at(t); expect(v).toBeLessThanOrEqual(prev + 1e-12); prev = v; }
  });
  it('a dense run holds the strongest light (max, not a sum: no strobe, never above 1)', () => {
    // 2.1's weak strike does not dim the loud one before it
    expect(pulse.at(2.1)).toBeCloseTo(Math.exp(-.1 / D), 12);
    const run = makePulse(Array.from({ length: 40 }, (_, i) => ({ t: 1 + i * .1, w: 1 })), { P, start: START, decay: D });
    for (let t = 1; t < 5; t += .013) expect(run.at(t)).toBeLessThanOrEqual(1 + 1e-12);
    expect(run.at(3.05)).toBeGreaterThan(.89);           // half a step after a strike: still lit
  });
  it('the count-in is silent: nothing before the first strike after start', () => {
    for (let t = -2.4; t < 2; t += .01){ expect(pulse.at(t)).toBe(0); }
  });
  it('a pickup in the count-in (a strike after start, before 0) does happen', () => {
    const pick = makePulse([{ t: 9.7, w: 1 }], { P, start: START, decay: D });   // 9.7 − P = −.3 ≥ −.6
    expect(pick.at(-.3)).toBeCloseTo(1, 12);
    expect(pick.at(-.7)).toBe(0);
    const early = makePulse([{ t: 9.2, w: 1 }], { P, start: START, decay: D });  // −.8 < start: never
    for (let t = -2.4; t < 1; t += .01) expect(early.at(t)).toBe(0);
  });
  it('the seam: the last strike of a loop glows on into the next one (never back into the count-in)', () => {
    expect(pulse.at(P + .1)).toBeCloseTo(.8 * Math.exp(-1.6 / D), 12);   // 8.5's strike, 1.6 s later
    expect(Math.abs(pulse.at(P - 1e-9) - pulse.at(P + 1e-9))).toBeLessThan(1e-6);   // continuous across it
    const late = makePulse([{ t: 3, w: .5 }, { t: 9.9, w: 1 }], { P, start: 0, decay: D });
    expect(late.at(P + .2)).toBeCloseTo(Math.exp(-.3 / D), 12);
    expect(late.at(.2)).toBe(0);                         // (its loop −1 twin, −.1, is before start: it never happened)
    // …and it is periodic from the first loop on
    for (const t of [2, 2.05, 5.3, 9.9, 10.05, 11.2]) expect(pulse.at(t + 3 * P)).toBeCloseTo(pulse.at(t + P), 9);
  });
  it('scrub-exact: the same songTime gives the same light, whatever was asked before', () => {
    const ts = [7.3, -1, 2.2, 31.4, 2.2, 0, 7.3, 1e4 + .25];
    const a = ts.map(t => pulse.at(t)), b = ts.slice().reverse().map(t => pulse.at(t)).reverse();
    expect(a).toEqual(b);
    const fresh = makePulse(cue, { P, start: START, decay: D, lead: LEAD });
    expect(ts.map(t => fresh.at(t))).toEqual(a);
    expect(ts.map(t => fresh.next(t))).toEqual(ts.map(t => pulse.next(t)));
  });
  it('anticipation rises over the last `lead` seconds into the next strike — never past start\'s', () => {
    expect(pulse.next(2 - LEAD - .01)).toBe(0);
    expect(pulse.next(2 - LEAD / 2)).toBeCloseTo(.25, 12);
    expect(pulse.next(2 - 1e-6)).toBeCloseTo(1, 4);
    expect(pulse.next(8.5 - .15)).toBeCloseTo(.8 * .25, 12);
    // across the seam: from the loop's tail to the next loop's first strike (2 + P)
    expect(pulse.next(P + 2 - .15)).toBeCloseTo(.25, 12);
    // the count-in anticipates only strikes that happen (a strike before start is skipped)
    const early = makePulse([{ t: 9.5, w: 1 }, { t: .1, w: .5 }], { P, start: START, lead: LEAD });   // 9.5 − P = −.5 ≥ −.6: happens
    expect(early.next(-.5 - .15)).toBeCloseTo(.25, 12);
    const late = makePulse([{ t: 9.2, w: 1 }, { t: .1, w: .5 }], { P, start: START, lead: LEAD });    // −.8: never — next is .1
    expect(late.next(-.8 - .1)).toBe(0);
    expect(late.next(.1 - .15)).toBeCloseTo(.5 * .25, 12);
  });
  it('unsorted, unwrapped cues are read as loop times', () => {
    const p = makePulse([{ t: 15, w: .6 }, { t: -8, w: 1 }, { t: 8.5 + 2 * P, w: .8 }, { t: 2.1, w: .3 }], { P, start: START, decay: D, lead: LEAD });
    for (const t of [1.5, 2, 2.1, 4, 5, 6, 8.6, 9.9, 10.3, 12]){ expect(p.at(t)).toBeCloseTo(pulse.at(t), 12); expect(p.next(t)).toBeCloseTo(pulse.next(t), 12); }
  });
});
