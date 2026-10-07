import { describe, it, expect } from 'vitest';
import { velGain, beltVel, okBeltVel, velLook, DYN } from '../src/dynamics.js';
import { SONGS } from '../src/songs/index.js';
import { layoutPads } from '../src/engine.js';

const dB = g => 20 * Math.log10(g);
const old = v => .35 + .65 * v;                       // the pre-dynamics drum law

describe('velGain — one velocity law', () => {
  it('is full at v = 1 and identical to the old law from the knee up (existing grooves keep their level)', () => {
    expect(velGain(1)).toBe(1);
    for (let v = DYN.KNEE; v <= 1 + 1e-9; v += .01) expect(velGain(v)).toBeCloseTo(old(v), 12);
  });
  it('is monotone and continuous (slope too) across the knee', () => {
    let prev = -1;
    for (let v = 0; v <= 1 + 1e-9; v += .001){ const g = velGain(v); expect(g).toBeGreaterThan(prev); prev = g; }
    const k = DYN.KNEE, e = 1e-6;
    const sL = (velGain(k) - velGain(k - e)) / e, sR = (velGain(k + e) - velGain(k)) / e;
    expect(Math.abs(sL - sR)).toBeLessThan(1e-3);
  });
  it('makes low velocities genuinely quiet (the old floor spanned only ~9 dB)', () => {
    expect(dB(old(0))).toBeGreaterThan(-9.2);
    expect(dB(velGain(.1))).toBeLessThan(-18);
    expect(dB(velGain(0))).toBeLessThan(-26);
    expect(dB(velGain(.3))).toBeLessThan(dB(old(.3)) - 2.5);
    expect(dB(velGain(.4))).toBeGreaterThan(dB(old(.4)) - 1);      // the gentle edge of the bend
  });
  it('treats junk as full, clamps out-of-range', () => {
    expect(velGain(NaN)).toBe(1); expect(velGain(undefined)).toBe(1);
    expect(velGain(2)).toBe(1); expect(velGain(-1)).toBe(velGain(0));
  });
});

describe('belt velocity — an optional 3rd element', () => {
  it('defaults to full, reads and clamps the 3rd element', () => {
    expect(beltVel(['G4', 1])).toBe(1);
    expect(beltVel(['G4', 1, .6])).toBe(.6);
    expect(beltVel(['G4', 1, 0])).toBe(0);
    expect(beltVel(['G4', 1, 3])).toBe(1);
    expect(beltVel(['G4', 1, undefined])).toBe(1);
  });
  it('okBeltVel: absent or a finite 0..1 number', () => {
    for (const v of [undefined, 0, .5, 1]) expect(okBeltVel(v)).toBe(true);
    for (const v of [null, -.1, 1.01, NaN, '0.5', Infinity]) expect(okBeltVel(v)).toBe(false);
  });
  it('a pp note still lights its pad', () => {
    expect(velLook(0)).toBeGreaterThan(.2); expect(velLook(1)).toBe(1);
  });
  // every shipped song's belt lines: 2 or 3 elements, the 3rd a legal velocity
  for (const [key, s] of Object.entries(SONGS)){
    it(`${key}: belt velocities are legal`, () => {
      for (const part of ['melody', 'alto', 'bass']){
        const d = s[part]; if (!d) continue;
        const notes = Array.isArray(d) ? d : d.notes;
        for (const e of notes){
          expect(e.length, `${key}.${part} ${JSON.stringify(e)}`).toBeGreaterThanOrEqual(2);
          expect(e.length).toBeLessThanOrEqual(3);
          expect(okBeltVel(e[2]), `${key}.${part} ${JSON.stringify(e)}`).toBe(true);
        }
      }
    });
  }
});

describe('belt velocity never touches the solve', () => {
  it('layoutPads: same positions / times / sizes with or without velocities; pads carry vel', () => {
    const line = [['C5', 1], ['E5', .5], ['G5', 2], ['C6', .25], ['B5', 1.25], ['G4', 3]];
    const soft = line.map(([n, b], i) => [n, b, i % 2 ? .2 : .9]);
    const o = { zBase: 0, isBass: false, beat: .5, radOf: n => n.endsWith('4') ? .9 : .7 };
    const a = layoutPads(line, o), b = layoutPads(soft, o);
    a.forEach((p, i) => {
      expect(b[i].pos.equals(p.pos)).toBe(true);
      expect(b[i].t).toBe(p.t); expect(b[i].dt).toBe(p.dt); expect(b[i].r).toBe(p.r);
      expect(p.vel).toBe(1); expect(b[i].vel).toBe(soft[i][2]);
    });
  });
});
