import { describe, it, expect } from 'vitest';
import starship, { bankAt, beatPulse, streakZ, skyClock, BANK, STREAK, T_WRAP } from '../src/rooms/starship.js';
import { ROOMS, ROOM_KEYS } from '../src/rooms/index.js';

/* The Starship deck's moving sky is a pure fn of songTime: the banking turns land on bar lines,
   are level through the loop's breath (seamless at the loop seam), and the star field is exactly
   periodic in T_WRAP (scrub-safe, no float drift over a long session). */
const ROLL_T = 2.6;
const cuesFor = (bpm, melodyBeats) => { const beat = 60 / bpm; return { rollT: ROLL_T, beat, P: ROLL_T + melodyBeats * beat + 1.2 }; };
const SONGS = [cuesFor(110.53, 112), cuesFor(94.7, 64), cuesFor(189.5, 36), cuesFor(120, 4)];

describe('starship room', () => {
  it('is registered in the room host', () => {
    expect(ROOMS).toContain(starship);
    expect(ROOM_KEYS).toContain('starship');
    expect(starship.label).toBe('Starship');
  });

  it('banking: level with no cue, bounded, level through the roll-in and at the seam', () => {
    expect(bankAt(5, null)).toBe(0);
    for (const c of SONGS){
      for (let t = -2.4; t < 3 * c.P; t += .01) expect(Math.abs(bankAt(t, c))).toBeLessThanOrEqual(BANK.roll + 1e-12);
      for (let u = 0; u < c.rollT; u += .05) expect(bankAt(u, c)).toBeCloseTo(0, 12);           // roll-in (before the downbeat)
      expect(bankAt(c.P - 1e-6, c)).toBeCloseTo(0, 9);                              // the seam
      expect(bankAt(c.P, c)).toBeCloseTo(0, 12);
    }
  });

  it('banking is periodic in the loop and continuous (C1: no snaps, no kinks)', () => {
    for (const c of SONGS){
      const h = .002;
      let prev = bankAt(-2.4, c), prevD = (prev - bankAt(-2.4 - h, c)) / h, maxStep = 0, maxDD = 0;
      for (let t = -2.4 + h; t < 2.2 * c.P; t += h){
        const b = bankAt(t, c), d = (b - prev) / h;
        maxStep = Math.max(maxStep, Math.abs(b - prev)); maxDD = Math.max(maxDD, Math.abs(d - prevD));
        prev = b; prevD = d;
        expect(bankAt(t + c.P, c)).toBeCloseTo(b, 9);
      }
      expect(maxStep).toBeLessThan(BANK.roll * .01);
      expect(maxDD).toBeLessThan(.01);
    }
  });

  it('turns start on bar lines and alternate starboard / port', () => {
    const c = SONGS[0], bar = BANK.bar * c.beat, ph = 4 * bar;
    const at = (beatPos) => bankAt(c.rollT + beatPos * c.beat, c);
    expect(at(0)).toBe(0);
    expect(at(.5)).toBeGreaterThan(0);                                              // eases in right after the downbeat
    expect(at(8)).toBeCloseTo(BANK.roll, 12);                                       // held mid-phrase
    expect(at(16)).toBeCloseTo(0, 12);                                              // level on the phrase line
    expect(at(24)).toBeCloseTo(-BANK.roll, 12);                                     // next phrase banks the other way
    expect(ph).toBeGreaterThan(0);
    // a short loop (< 8 bars) banks on 2-bar phrases; one shorter than a phrase stays level
    const short = SONGS[2]; expect(Math.abs(bankAt(short.rollT + 4 * short.beat, short))).toBeGreaterThan(0);
    const tiny = SONGS[3]; for (let t = 0; t < tiny.P; t += .05) expect(bankAt(t, tiny)).toBeCloseTo(0, 12);
  });

  it('engine beat thump is in [0, 1] and peaks on the beat', () => {
    const c = SONGS[1];
    for (let t = -2.4; t < 2 * c.P; t += .013){ const p = beatPulse(t, c); expect(p).toBeGreaterThanOrEqual(0); expect(p).toBeLessThanOrEqual(1); }
    expect(beatPulse(c.rollT + 3 * c.beat + 1e-9, c)).toBeCloseTo(1, 6);
  });

  it('star field: periodic in T_WRAP, moving aft, wrapping only inside the field', () => {
    for (const t of [-2.4, 0, 13.7, 59.99, 3600.25, 86400.5]) expect(skyClock(t)).toBeGreaterThanOrEqual(0), expect(skyClock(t)).toBeLessThan(T_WRAP);
    for (let n = STREAK.n0; n <= STREAK.n1; n++) for (const z0 of [0, 77.7, 300]){
      for (const t of [-2.4, 1.3, 47.9]){
        const z = streakZ(z0, n, t);
        expect(z).toBeGreaterThanOrEqual(STREAK.z0); expect(z).toBeLessThan(STREAK.z0 + STREAK.L);
        expect(streakZ(z0, n, t + T_WRAP)).toBeCloseTo(z, 6);                       // exactly periodic
        expect(streakZ(z0, n, t + 7 * T_WRAP)).toBeCloseTo(z, 6);
        const z2 = streakZ(z0, n, t + .01), v = n * STREAK.L / T_WRAP;
        if (z2 > z) expect(z2 - z).toBeCloseTo(v * .01, 6);                          // steady +z (aft) between wraps
      }
    }
  });
});
