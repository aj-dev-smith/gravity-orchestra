import { describe, it, expect } from 'vitest';
import { dribbleLane, dribbleAt, dribblePiston, G } from '../src/engine.js';
import { GM_DRUMS } from '../src/drumkit.js';
import { SONGS } from '../src/songs/index.js';
import { kitPieces, pieceLane, spiralSeats, styleOf, SPIRAL, BACK, kitFrame, shellPoint, shellRungs, deckOutline,
         stairTreads, treadOutline, pieceReach, pieceDisc, pieceStand, magnetTop, STANDS, TRIPOD, HAT, hatLinkage,
         clutchFrom, CLUTCH, wireBuzz, shockRing, shockAges, SHOCK, pistonDip, DT_MAX } from '../src/drumparts.js';
import { KIT_SOLO } from '../src/marbledrums.js';

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

/* The belt bays' world XZ boxes for every SOLO-slot drum song, as measured by
   __dev.boxes() (cx = the wall centre). The kit's ENTIRE plan footprint must stay out
   of them — re-measure if a song's melody (hence its belt) changes. */
const SOLO_BELTS = {
  'mountain-king': { cx: 0, belts: [[-16.9, -4.1, -1.3, 2.3], [-1.2, -4.1, 19, 1.9]] },
  backbeat:        { cx: 0, belts: [[-11.4, -4.1, 9.3, 1.7]] },
};

/* everything the kit puts on the floor plan, as [x, z, radius] discs, kit-local */
function footprint(spec){
  const ps = kitPieces(spec), F = kitFrame(ps), out = [];
  for (const p of ps){
    const D = pieceDisc(p); if (D) out.push([D[0], D[1], D[2], p.key]);
    const S = pieceStand(p); if (S) out.push([S.x, S.z, TRIPOD, p.key + ' stand']);
    if (p.key === 'hat') out.push([p.x, p.z + HAT.heelZ + .1, .22, 'hat pedal']);
  }
  for (const t of stairTreads(ps)) for (const [x, z] of treadOutline(t)) out.push([x, z, 0, 'tread ' + t.key]);
  for (const [x, z] of deckOutline(F)) out.push([x, z, .06, 'deck']);                      // + the bevel
  for (const sx of [-1, 1]) out.push([F.xc + sx * F.X0, F.zA, .44, 'footing']);
  for (const th of F.tilts) for (let k = 0; k <= 60; k++){ const x = F.xc - F.X0 + 2 * F.X0 * k / 60, q = shellPoint(F, x, th);
    out.push([q.x, q.z, .19, 'rib']); }
  for (const r of shellRungs(F)) for (let k = 0; k <= 20; k++){ const q = shellPoint(F, r.x, r.th1 * k / 20); out.push([q.x, q.z, .1, 'rung']); }
  return { ps, F, out };
}

describe('kit layout', () => {
  const sets = [['full kit', FULL], ...drumSongs.map(([k, s]) => [k, s.drums])];

  it('hat + hatOpen are ONE hi-hat (one pair, one ball)', () => {
    const ps = kitPieces({ hat: [0], hatOpen: [1], kick: [0] });
    expect(ps.filter(p => p.key === 'hat')).toHaveLength(1);
    expect(ps.find(p => p.key === 'hat').lanes).toEqual(['hat', 'hatOpen']);
    expect(ps.some(p => p.key === 'hatOpen')).toBe(false);
    expect(kitPieces({ hatOpen: [1] }).map(p => p.key)).toEqual(['hat']);
  });

  for (const [name, spec] of sets) it(`${name}: no two pieces share air (heads, tripods, stands)`, () => {
    const ps = kitPieces(spec);
    const disc = ps.flatMap(p => { const D = pieceDisc(p), S = pieceStand(p);
      return [...(D ? [[D[0], D[1], D[2], p.cym || p.key, p]] : []), ...(S ? [[S.x, S.z, .12, (p.cym || p.key) + ' stand', null]] : [])]; });
    for (let i = 0; i < disc.length; i++) for (let j = i + 1; j < disc.length; j++){
      const a = disc[i], b = disc[j];
      if (!a[4] && !b[4]) continue;
      if (a[3].startsWith(b[3]) || b[3].startsWith(a[3])) continue;     // a cymbal over its own stand
      // a stand post may stand under a cymbal that sits higher than the boom's joint — only heads/tripods are checked here
      const cymbalOverStand = (a[4] && styleOf(a[3]).kind === 'cymbal' && !b[4]) || (b[4] && styleOf(b[3]).kind === 'cymbal' && !a[4]);
      if (cymbalOverStand) continue;
      const need = (a[4] && b[4]) ? styleOf(a[3]).r + styleOf(b[3]).r + .15 : a[2] + b[2];
      expect(Math.hypot(a[0] - b[0], a[1] - b[1]), `${a[3]}/${b[3]}`).toBeGreaterThanOrEqual(need);
    }
  });

  for (const [name, spec] of sets) it(`${name}: nothing goes behind the BACK line (deck, footings, ribs, rungs, treads, stands)`, () => {
    for (const [, z, r, what] of footprint(spec).out) expect(z - r, what).toBeGreaterThanOrEqual(BACK - (what === 'deck' ? .065 : 1e-9));
  });

  for (const [name, { cx, belts }] of Object.entries(SOLO_BELTS)) it(`${name} (solo slot): the whole kit stands clear of every belt bay`, () => {
    for (const [x, z, r, what] of footprint(SONGS[name].drums).out){
      const X = cx + KIT_SOLO.x + x, Z = KIT_SOLO.z + z;
      for (const [x0, z0, x1, z1] of belts){
        const inside = X + r > x0 && X - r < x1 && Z + r > z0 && Z - r < z1;
        expect(inside, `${what} at (${X.toFixed(2)}, ${Z.toFixed(2)})`).toBe(false);
      }
    }
  });

  for (const [name, spec] of sets) it(`${name}: on the deck — every piece, stand and tread inside the outline`, () => {
    const { F, out } = footprint(spec);
    for (const [x, z, r, what] of out){
      if (what === 'deck' || what === 'rib' || what === 'rung') continue;
      expect(x - r, what).toBeGreaterThanOrEqual(F.deck.x0); expect(x + r, what).toBeLessThanOrEqual(F.deck.x1);
      expect(z - r, what).toBeGreaterThanOrEqual(F.deck.z0 - 1e-9); expect(z + r, what).toBeLessThanOrEqual(F.deck.z1);
    }
  });

  for (const [name, spec] of sets) it(`${name}: every magnet hangs from a rung, and the shell clears every piece`, () => {
    const { ps, F } = footprint(spec);
    const rungs = shellRungs(F);
    for (const p of ps){
      const r = rungs.find(q => q.ms.some(m => m.key === p.key)), h = r.hang.find(q => q.m.key === p.key);
      expect(h.z).toBeCloseTo(p.z, 9);                                  // the hanger rod is vertical
      expect(h.y - .12 - magnetTop(p), p.key).toBeGreaterThan(.3);      // and the rung is above the pot
      expect(h.th, p.key).toBeLessThan(r.th1);
    }
    // every rib + rung point passes over (never through) every piece's column
    const pts = [];
    for (const th of F.tilts) for (let k = 0; k <= 200; k++) pts.push(shellPoint(F, F.xc - F.X0 + 2 * F.X0 * k / 200, th));
    for (const r of rungs) for (let k = 0; k <= 40; k++) pts.push(shellPoint(F, r.x, r.th1 * k / 40));
    for (const q of pts) for (const p of ps){
      const D = pieceDisc(p);                                            // the piece, and (a cymbal) its ball's column
      const near = (D && Math.hypot(q.x - D[0], q.z - D[1]) <= D[2] + .25) || Math.hypot(q.x - p.x, q.z - p.z) <= .45;
      if (!near) continue;
      expect(q.y - .2, `${p.key} under the shell at x=${q.x.toFixed(2)}`).toBeGreaterThan(magnetTop(p));
    }
  });

  it('a compact kit gets a compact shell; the full kit a big one', () => {
    const small = kitFrame(kitPieces({ kick: [0], snare: [0], hat: [0] })), full = kitFrame(kitPieces(FULL));
    expect(small.X0).toBeLessThan(.6 * full.X0);
    expect(small.deck.x1 - small.deck.x0).toBeLessThan(11);
    expect(small.T).toBeLessThan(full.T);
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

  it('each tread sits under its own tom only — never under a neighbour, the kick or anything else', () => {
    const ps = kitPieces(FULL), treads = stairTreads(ps);
    expect(treads.length).toBeGreaterThan(2);
    for (const t of treads){
      expect(t.y).toBeGreaterThan(t.below);                              // the stair climbs
      for (const [x, z] of treadOutline(t, 24)) for (const p of ps){
        if (p.key === t.key) continue;
        expect(Math.hypot(x - p.x, z - p.z), `tread ${t.key} / ${p.key}`).toBeGreaterThanOrEqual(pieceReach(p) + .05);
      }
    }
  });
});

describe('hi-hat LINKAGE — the real way round', () => {
  const closed = hatLinkage(0), open = hatLinkage(HAT.OPEN);
  it('pedal pressed (toe down) = CLOSED, released (toe up) = OPEN', () => {
    expect(closed.pedalAng).toBeLessThan(.08);
    expect(open.pedalAng).toBeGreaterThan(.3);
    expect(open.pedalToe.y).toBeGreaterThan(closed.pedalToe.y);
  });
  it('the pull-tube end moves exactly the clutch travel; the rocker is a first-class lever', () => {
    expect(closed.end.y - open.end.y).toBeCloseTo(HAT.OPEN, 12);
    expect(open.toe.y - closed.toe.y).toBeCloseTo(HAT.OPEN, 12);      // equal arms: toe rises as the tube drops
  });
  it('the return spring is stretched while the pedal holds it closed, relaxed open', () => {
    expect(closed.spring).toBeGreaterThan(open.spring);
    expect(open.spring).toBeGreaterThan(.3);
  });
  it('continuous + monotone through the travel, the toe link stays (nearly) rigid', () => {
    let prev = hatLinkage(0);
    const L0 = Math.hypot(prev.toe.z - prev.pedalToe.z, prev.toe.y - prev.pedalToe.y);
    for (let dr = .002; dr <= HAT.OPEN + 1e-9; dr += .002){
      const k = hatLinkage(dr);
      expect(k.pedalAng).toBeGreaterThan(prev.pedalAng);
      expect(Math.abs(k.pedalAng - prev.pedalAng)).toBeLessThan(.01);
      expect(Math.abs(Math.hypot(k.toe.z - k.pedalToe.z, k.toe.y - k.pedalToe.y) - L0)).toBeLessThan(.08);
      prev = k;
    }
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

/* the deepest a head's piston strokes (the staging measures the kit's lowest solid part there:
   main.js, rooms/footing.js) — exact against a brute-force scan of the piston law */
describe('pistonDip — where a piston bottoms out', () => {
  const ROLL_T = 2.6, START = -.6;
  for (const key of ['backbeat', 'mountain-king', 'forge']) it(`${key}: every head's deepest stroke = a 1 ms scan of the count-in + the loop`, () => {
    const S = SONGS[key], beat = 60 / S.bpm, P = ROLL_T + S.melody.reduce((a, n) => a + n[1], 0) * beat + 1.2;
    for (const p of kitPieces(S.drums)){
      if (p.cym) continue;                                // (a hung cymbal rides its own piston, high on its boom)
      const { L } = pieceLane(p, S.drums, { rollT: ROLL_T, beat, P, dtMax: DT_MAX });
      const d = pistonDip(L, { start: START });
      let lo = 0;                                         // (the count-in, then a whole loop from the lane's first strike)
      for (let t = START - .5; t < START + 2 * P + 1; t += .001) lo = Math.min(lo, dribblePiston(L, t, { start: START }));
      expect(d.off, `${p.key}`).toBeLessThanOrEqual(lo + 1e-4);                       // (as deep as the scan finds, or deeper)
      expect(d.off, `${p.key}`).toBeGreaterThanOrEqual(lo - .01);
      expect(dribblePiston(L, d.t, { start: START }), `${p.key}: it IS the travel at t`).toBeCloseTo(d.off, 12);
      expect(d.t).toBeGreaterThanOrEqual(START - .5); expect(d.t).toBeLessThan(START + 2 * P + 1);
    }
  });
});

