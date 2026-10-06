import { describe, it, expect } from 'vitest';
import { dribbleLane, dribbleAt, G } from '../src/engine.js';
import { GM_DRUMS } from '../src/drumkit.js';
import { SONGS } from '../src/songs/index.js';
import { kitPieces, pieceLane, spiralSeats, styleOf, SPIRAL, KEEPOUT, rungY, zBack, ARCH,
         clutchFrom, CLUTCH, wireBuzz, shockRing, shockAges, SHOCK } from '../src/drumparts.js';

/* ---------------------------------------------------------------------------
   The drum machine's fresh coat — the pure half. Layout honesty (no two heads
   share air, the toms' pitch IS their height, every magnet hangs under the
   arch, the solo slot's belt corner stays clear) and the timing of every part
   that reacts: the hi-hat clutch, the snare wires, the kick shockwave — each
   exact at the strike, continuous everywhere (seam + count-in), never popping.
--------------------------------------------------------------------------- */

const g = -G.y, DT = 1.2;
const FULL = Object.fromEntries(Object.keys(GM_DRUMS).map(n => [n, [0]]));
const drumSongs = Object.entries(SONGS).filter(([, s]) => s.drums);
const H = g * DT * DT / 8;
const magnetTop = p => p.lift + H + 2 * styleOf(p.key).ball + .66;   // drumlook.buildMagnet: face + pot + cap

describe('kit layout', () => {
  const sets = [['full kit', FULL], ...drumSongs.map(([k, s]) => [k, s.drums])];

  it('hat + hatOpen are ONE hi-hat (one pair, one ball)', () => {
    const ps = kitPieces({ hat: [0], hatOpen: [1], kick: [0] });
    expect(ps.filter(p => p.key === 'hat')).toHaveLength(1);
    expect(ps.find(p => p.key === 'hat').lanes).toEqual(['hat', 'hatOpen']);
    expect(ps.some(p => p.key === 'hatOpen')).toBe(false);
    expect(kitPieces({ hatOpen: [1] }).map(p => p.key)).toEqual(['hat']);
  });

  for (const [name, spec] of sets) it(`${name}: no two heads share air, all on the deck, belt corner clear`, () => {
    const ps = kitPieces(spec);
    for (let i = 0; i < ps.length; i++){
      const a = ps[i], ra = styleOf(a.key).r;
      expect(Math.abs(a.x) + ra).toBeLessThanOrEqual(9.3);
      expect(a.z + ra).toBeLessThanOrEqual(3.4);
      expect(a.z - ra).toBeGreaterThanOrEqual(-6.4);
      if (a.x - ra < KEEPOUT.xMax) expect(a.z - ra).toBeGreaterThan(KEEPOUT.zMax);
      for (let j = i + 1; j < ps.length; j++){
        const b = ps[j];
        // plan discs disjoint: a ball's column never passes through another head
        expect(Math.hypot(a.x - b.x, a.z - b.z), `${a.key}/${b.key}`).toBeGreaterThanOrEqual(ra + styleOf(b.key).r + .15);
      }
    }
  });

  for (const [name, spec] of sets) it(`${name}: every magnet hangs under the arch`, () => {
    for (const p of kitPieces(spec)) expect(rungY(p.x, p.z) - magnetTop(p), p.key).toBeGreaterThan(.25);
  });

  it('the toms climb a spiral: PITCH = HEIGHT, neighbouring hoops never touch', () => {
    const toms = ['tomHigh', 'floorHigh', 'tomMid', 'tomLow', 'tomHiMid'];
    const seats = spiralSeats(toms);
    for (let k = 1; k < seats.length; k++){
      const a = seats[k - 1], b = seats[k];
      expect(GM_DRUMS[b.lane].tone).toBeGreaterThan(GM_DRUMS[a.lane].tone);   // ordered low → high…
      expect(b.y).toBeGreaterThan(a.y);                                        // …and so climbing
      expect(b.phi).toBeGreaterThan(a.phi);                                    // round the newel
      expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(styleOf(a.lane).r + styleOf(b.lane).r + SPIRAL.gap - 1e-9);
    }
    expect(seats.at(-1).lane).toBe('tomHigh');
  });

  it('the back rib stays behind every magnet it carries (or the rung cantilevers past it)', () => {
    for (const p of kitPieces(FULL)) expect(p.z).toBeLessThan(ARCH.front.z - .3);
    expect(zBack(-ARCH.X0)).toBeGreaterThan(KEEPOUT.zMax - .2);
  });
});

describe('pieceLane — merged hi-hat metadata', () => {
  const spec = { hat: [0, [1, .4], 2, [3, .5]], hatOpen: [[1, .9], 1.5] };
  const m = pieceLane({ key: 'hat', lanes: ['hat', 'hatOpen'] }, spec, { rollT: 0, beat: .5, P: 2, dtMax: DT });
  it('one strike per moment; coincident hat + hatOpen plays OPEN at the louder velocity', () => {
    expect(m.L.s).toEqual([0, .5, .75, 1, 1.5]);
    expect(m.lane).toEqual(['hat', 'hatOpen', 'hatOpen', 'hat', 'hat']);
    expect(m.open).toEqual([false, true, true, false, false]);
    expect(m.vel[1]).toBe(.9);
    expect(m.vel[4]).toBe(.5);
  });
});

describe('hi-hat CLUTCH', () => {
  const P = 4, start = -2.4;
  // closed 8ths with two open hits, one of them right before a closed one (a short open)
  const strikes = [0, .5, 1, 1.5, 1.75, 2, 2.5, 3, 3.5];
  const open =    [0, 0, 1, 0, 0, 0, 1, 1, 0].map(Boolean);
  const L = dribbleLane(strikes, P, { dtMax: DT });
  const at = (t, s0 = -Infinity) => clutchFrom(L, open, dribbleAt(L, t, s0), s0);

  it('is exactly at each strike\'s state AT the strike, every loop', () => {
    for (let k = 0; k < 3; k++) L.s.forEach((s, i) => expect(at(s + k * P)).toBe(open[i] ? 1 : 0));
  });
  it('holds between same-state strikes, stays in [0, 1]', () => {
    expect(at(.25)).toBe(0);                            // closed → closed
    expect(at(2.75)).toBe(1);                           // open → open: rings on
    for (let t = 0; t < 2 * P; t += .0071){ const o = at(t); expect(o).toBeGreaterThanOrEqual(0); expect(o).toBeLessThanOrEqual(1); }
  });
  it('an open hat rings until the pedal chicks it shut ON the next closed hit', () => {
    expect(at(1.4)).toBe(1);                            // still open late in the gap
    expect(at(1.5 - CLUTCH.close / 2)).toBeGreaterThan(0);
    expect(at(1.5 - CLUTCH.close / 2)).toBeLessThan(1);
  });
  it('opens just before an open hit, never earlier than its window', () => {
    expect(at(1 - CLUTCH.open - .01)).toBe(0);
    expect(at(1 - CLUTCH.open / 2)).toBeGreaterThan(0);
  });
  it('is continuous everywhere — across the seam and out of the armed count-in', () => {
    const step = .0004, wMin = Math.min(CLUTCH.close, CLUTCH.open, Math.min(...L.gaps) * CLUTCH.frac);
    for (const s0 of [-Infinity, start]){
      let prev = at(start, s0);
      for (let t = start + step; t < 2 * P; t += step){
        const o = at(t, s0);
        expect(Math.abs(o - prev)).toBeLessThanOrEqual(1.5 * step / wMin * 1.02 + 1e-9);
        prev = o;
      }
    }
  });
  it('sits ARMED at the first strike\'s state through the count-in', () => {
    const L2 = dribbleLane([.5, 1, 2], P), op = [false, false, true];
    // the first strike after −2.4 is 2 − P = −2 (open): armed open, landing open
    expect(clutchFrom(L2, op, dribbleAt(L2, -2.3, -2.4), -2.4)).toBe(1);
    expect(clutchFrom(L2, op, dribbleAt(L2, -2, -2.4), -2.4)).toBe(1);
  });
});

describe('SNARE WIRES', () => {
  it('silent at the strike, rattling just after, silent again by the next strike', () => {
    expect(wireBuzz(0, .5, 1)).toBe(0);
    expect(wireBuzz(.04, .5, 1)).toBeGreaterThan(.5);
    expect(wireBuzz(.5 - 1e-9, .5, 1)).toBeLessThan(1e-12);
    expect(wireBuzz(.6, .5, 1)).toBe(0);
    expect(wireBuzz(-.01, .5, 1)).toBe(0);
  });
  it('bounded by the hit, continuous in time', () => {
    let prev = 0;
    for (let s = 0; s < 1; s += .0005){
      const b = wireBuzz(s, 1, .7);
      expect(b).toBeLessThanOrEqual(.7);
      expect(Math.abs(b - prev)).toBeLessThan(.04);
      prev = b;
    }
    expect(wireBuzz(.05, 1, .3)).toBeLessThan(wireBuzz(.05, 1, 1));
  });
});

describe('KICK SHOCKWAVE', () => {
  it('a ring is born at the kick: zero radius, zero strength — and dies to zero', () => {
    expect(shockRing(0)).toEqual({ r: 0, a: 0 });
    expect(shockRing(.3).a).toBeGreaterThan(0);
    expect(shockRing(.3).r).toBeCloseTo(SHOCK.v * .3, 12);
    expect(shockRing(SHOCK.life).a).toBeCloseTo(0, 12);
    expect(shockRing(SHOCK.life + .1).a).toBe(0);
  });
  it('only kicks that HAPPENED ring — none in the armed count-in', () => {
    const L = dribbleLane([0, 1], 4), start = -2.4;                              // first kick after −2.4 is 0
    expect(shockAges(L, dribbleAt(L, -1, start), -1, start)).toEqual([]);       // armed
    const r = shockAges(L, dribbleAt(L, .3, start), .3, start);                  // not the "previous loop" kick at −3
    expect(r.map(x => x.k)).toEqual([0]);
    expect(r[0].age).toBeCloseTo(.3, 12);
  });
  it('the ring field never pops — dense double-kick runs, the seam, the count-in', () => {
    const P = 4, start = -2.4;
    const L = dribbleLane([0, .12, .24, .36, .48, 1, 2, 2.1, 3.5], P);
    const field = t => {                                // ring brightness at a few radii on the floor
      const rings = shockAges(L, dribbleAt(L, t, start), t, start);
      return [1, 2.5, 4, 6].map(r0 => rings.reduce((s, R) => {
        const sr = shockRing(R.age); return s + sr.a * R.fade * Math.exp(-(((r0 - sr.r) / .3) ** 2));
      }, 0));
    };
    const step = .0005;
    let prev = field(start);
    for (let t = start + step; t < 2 * P; t += step){
      const f = field(t);
      f.forEach((v, k) => expect(Math.abs(v - prev[k])).toBeLessThan(.06));
      prev = f;
    }
  });
  it('at most SHOCK.n rings, newest first', () => {
    const L = dribbleLane(Array.from({ length: 16 }, (_, i) => i * .1), 4);
    const r = shockAges(L, dribbleAt(L, 1.55), 1.55);
    expect(r.length).toBeLessThanOrEqual(SHOCK.n);
    for (let k = 1; k < r.length; k++) expect(r[k].age).toBeGreaterThan(r[k - 1].age);
  });
});
