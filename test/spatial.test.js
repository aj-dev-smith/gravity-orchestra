import { describe, it, expect } from 'vitest';
import { screenX, panFor, widthFor, WIDTH_LO, gainFor, airFor, roomFor, stereoGains, spatialize,
         PAN_MAX, PAN_K, NEAR, MIN_GAIN, AIR_MAX, ROOM_MIN, DEF_TANH } from '../src/spatial.js';

const T = DEF_TANH;
const atScreen = (sx, depth = 20) => [sx * depth * T, -depth];   // camera-space x,z for a screen x

describe('spatial: pan from FRAME position', () => {
  it('dead ahead is centre; the listener origin is 0', () => {
    expect(panFor(0, -20)).toBe(0);
    expect(panFor(0, 0)).toBe(0);
    expect(spatialize(0, 5, -20).pan).toBe(0);
  });
  it('right is positive, left negative, odd-symmetric', () => {
    expect(panFor(5, -20)).toBeGreaterThan(0);
    expect(panFor(-5, -20)).toBeLessThan(0);
    for (const x of [.5, 3, 9, 30]) expect(panFor(-x, -15)).toBeCloseTo(-panFor(x, -15), 12);
  });
  it('is driven by SCREEN position: same frame x → same pan at any depth', () => {
    for (const sx of [-.8, -.3, .2, .6, 1.4]){
      const [x1, z1] = atScreen(sx, 6), [x2, z2] = atScreen(sx, 60);
      expect(screenX(x1, z1)).toBeCloseTo(sx, 9);
      expect(panFor(x1, z1)).toBeCloseTo(panFor(x2, z2), 12);
    }
  });
  it('a narrower lens spreads the same bearing wider (it is the frame, not the angle)', () => {
    expect(panFor(4, -20, T / 2)).toBeGreaterThan(panFor(4, -20, T));
  });
  it('in-frame voices spread across the field; frame edge ≈ PAN_MAX·tanh(PAN_K)', () => {
    const [xe, ze] = atScreen(1);
    expect(panFor(xe, ze)).toBeCloseTo(PAN_MAX * Math.tanh(PAN_K), 9);
    expect(panFor(...atScreen(.5))).toBeGreaterThan(.25);
  });
  it('off-screen voices lean softly — never past PAN_MAX, no pile-up at a hard cap', () => {
    const far = panFor(...atScreen(3)), wayFar = panFor(...atScreen(30));
    expect(far).toBeLessThan(PAN_MAX); expect(wayFar).toBeLessThanOrEqual(PAN_MAX);
    for (let a = -Math.PI; a <= Math.PI; a += .05)
      expect(Math.abs(panFor(Math.sin(a) * 20, -Math.cos(a) * 20))).toBeLessThanOrEqual(PAN_MAX + 1e-12);
    expect(PAN_MAX).toBeLessThanOrEqual(.65);
  });
  it('is monotone across the frame', () => {
    let prev = -Infinity;
    for (let sx = -4; sx <= 4; sx += .05){ const p = panFor(...atScreen(sx)); expect(p).toBeGreaterThanOrEqual(prev - 1e-12); prev = p; }
  });
  it('behind the camera keeps its side, finite', () => {
    expect(panFor(5, 20)).toBeGreaterThan(0);
    expect(panFor(-5, 20)).toBeLessThan(0);
    expect(Number.isFinite(panFor(5, 0))).toBe(true);
  });
});

describe('spatial: distance is relative to the SHOT', () => {
  it('the framed subject is full level & full band in a close-up AND a wide shot', () => {
    for (const focus of [8, 20, 60]){
      const s = spatialize(0, 0, -focus, { focus });
      expect(s.gain).toBe(1); expect(s.shelf).toBe(0);
    }
  });
  it('only voices clearly beyond the subject roll off — gently, floored', () => {
    expect(gainFor(NEAR)).toBe(1);
    expect(gainFor(NEAR + 1)).toBeLessThan(1);
    expect(gainFor(NEAR + 1)).toBeGreaterThan(MIN_GAIN);
    expect(gainFor(1e6)).toBe(MIN_GAIN);
    let prev = 1;
    for (let r = 0; r < 20; r += .1){ const g = gainFor(r); expect(g).toBeLessThanOrEqual(prev); prev = g; }
  });
  it('air is a gentle shelf cut (dB), capped at AIR_MAX', () => {
    expect(airFor(1)).toBe(0);
    expect(airFor(NEAR + 1)).toBeLessThan(0);
    expect(airFor(NEAR + 1)).toBeGreaterThan(-AIR_MAX);
    expect(airFor(1e6)).toBe(-AIR_MAX);
  });
  it('farther = wetter: room send rises from ROOM_MIN to 1', () => {
    expect(roomFor(.5)).toBe(ROOM_MIN);
    expect(roomFor(NEAR + 1)).toBeGreaterThan(ROOM_MIN);
    expect(roomFor(1e6)).toBe(1);
  });
  it('bad input degrades to a centred, unfiltered, full-level voice', () => {
    const n = { pan: 0, gain: 1, shelf: 0, room: ROOM_MIN };
    expect(spatialize(NaN, 0, 0)).toEqual(n);
    expect(spatialize(Infinity, 0, -3)).toEqual(n);
    expect(spatialize(0, 0, -20, { focus: NaN, tanH: -1 }).gain).toBe(1);
  });
});

describe('spatial: the pan law place() applies', () => {
  it('centre is exactly the old mono upmix (1.0 per side) — panning costs no level', () => {
    const g = stereoGains(0);
    expect(g.L).toBeCloseTo(1, 12); expect(g.R).toBeCloseTo(1, 12);
  });
  it('constant power at every pan, clamped to ±1', () => {
    for (let p = -1; p <= 1; p += .05){ const g = stereoGains(p); expect(g.L ** 2 + g.R ** 2).toBeCloseTo(2, 9); }
    expect(stereoGains(5)).toEqual(stereoGains(1));
    expect(stereoGains(NaN)).toEqual(stereoGains(0));
  });
  it('a spatialized pan never drives one side past ~+2.7 dB', () => {
    expect(stereoGains(PAN_MAX).R).toBeLessThan(1.36);
  });
});

describe('spatial: lows sit near centre', () => {
  it('width rises monotonically with pitch from WIDTH_LO to 1', () => {
    expect(widthFor(50)).toBe(WIDTH_LO);
    expect(widthFor(2000)).toBe(1);
    let prev = 0;
    for (let f = 40; f < 4000; f *= 1.1){ const w = widthFor(f); expect(w).toBeGreaterThanOrEqual(prev); prev = w; }
  });
  it('unknown pitch keeps full width', () => { expect(widthFor(undefined)).toBe(1); expect(widthFor(0)).toBe(1); });
});
