import { describe, it, expect } from 'vitest';
import { laneClock, at, firstAt, makeEdge, eventTimes, lanesByNote, wrapP } from '../src/instruments/clock.js';
import { INSTRUMENTS } from '../src/instruments/index.js';
import { STATIONS } from '../src/instruments/stations.js';
import { SONGS } from '../src/songs/index.js';

const sumBeats = notes => notes.reduce((s, [, b]) => s + b, 0);

// ---------------------------------------------------------------------------
// the shared lane clock
// ---------------------------------------------------------------------------
describe('instrument lane clock', () => {
  const P = 10;
  const L = laneClock([1, 4, 4, -2 /* pickup → 8 */], P);

  it('wraps, dedups and sorts strikes; gaps close the loop seam', () => {
    expect(L.s).toEqual([1, 4, 8]);
    expect(L.gaps).toEqual([3, 4, 3]);
    expect(L.gaps.reduce((a, b) => a + b, 0)).toBe(P);
  });

  it('reports the strike just left, and since + until = gap', () => {
    const c = at(L, 5.5);
    expect(c.i).toBe(1); expect(c.since).toBeCloseTo(1.5); expect(c.until).toBeCloseTo(2.5);
    expect(c.abs).toBeCloseTo(4);
    const w = at(L, 10.5);                      // next loop, before its first strike → the last one (8)
    expect(w.i).toBe(2); expect(w.since).toBeCloseTo(2.5); expect(w.abs).toBeCloseTo(8);
  });

  it('is ARMED before the first strike after start (the count-in)', () => {
    const start = -2.4;
    expect(firstAt(L, start)).toBeCloseTo(-2);  // the pickup at 8 − 10
    const c = at(L, -2.3, start);
    expect(c.armed).toBe(true); expect(c.i).toBe(-1); expect(c.until).toBeCloseTo(.3);
    expect(at(L, -1.9, start).armed).toBe(false);
  });

  it('the edge fires exactly once per strike, and skip swallows it', () => {
    const e = makeEdge(.25);
    expect(e.check(4, .01)).toBe(true);
    expect(e.check(4, .02)).toBe(false);
    expect(e.check(8, .5)).toBe(false);          // outside the window: a missed frame never late-fires
    expect(e.check(8, .1, true)).toBe(false);    // skipped (scrub) …
    expect(e.check(8, .12)).toBe(false);         // … and recorded, so it can't fire after
  });

  it('eventTimes / lanesByNote parse the part format', () => {
    const ev = eventTimes([[2, 'E4', .5, 1], [0, 'C4']], { rollT: 2.6, beat: .5 });
    expect(ev[0]).toMatchObject({ beat: 0, note: 'C4', vel: 1, dur: 0, t: 2.6 });
    expect(ev[1]).toMatchObject({ beat: 2, note: 'E4', vel: .5, t: 3.6, tDur: .5 });
    expect(Object.keys(lanesByNote(ev))).toEqual(['C4', 'E4']);
    expect(wrapP(-1, 10)).toBe(9);
  });
});

// ---------------------------------------------------------------------------
// every registered instrument honours the contract
// ---------------------------------------------------------------------------
describe.each(INSTRUMENTS.map(I => [I.key, I]))('instrument "%s" contract', (key, I) => {
  it('has a key, label, make, voice and a demo', () => {
    expect(typeof I.label).toBe('string');
    expect(typeof I.make).toBe('function');
    expect(typeof I.voice).toBe('function');
    expect(I.demo && Array.isArray(I.demo.part)).toBe(true);
    expect(I.demo.beats % 4).toBe(0);
  });

  it('has a station slot', () => { expect(STATIONS[key]).toBeTruthy(); });

  it('demo events are inside the loop window', () => {
    for (const [b] of I.demo.part){ expect(b).toBeGreaterThanOrEqual(0); expect(b).toBeLessThan(I.demo.beats); }
  });

  it('every demo voice renders finite, bounded, non-silent samples', () => {
    const ids = I.voiceIds ? I.voiceIds(I.demo.part) : [...new Set(I.demo.part.map(e => e[1]))];
    for (const id of ids){
      const { samples, sr } = I.voice(id);
      expect(sr).toBeGreaterThanOrEqual(8000);
      expect(samples.length).toBeLessThan(sr * 6);
      let peak = 0;
      for (const x of samples){ expect(Number.isFinite(x)).toBe(true); peak = Math.max(peak, Math.abs(x)); }
      expect(peak, id).toBeGreaterThan(.01);
      expect(peak, id).toBeLessThanOrEqual(1);
    }
  });
});

// ---------------------------------------------------------------------------
// songs that carry instrument parts
// ---------------------------------------------------------------------------
const partSongs = Object.entries(SONGS).filter(([, s]) => s.parts);
describe.each(partSongs.length ? partSongs : [['(none)', null]])('song "%s" parts', (key, song) => {
  it('every part names a registered instrument, every event sits in [0, loop)', () => {
    if (!song) return;
    const loop = sumBeats(song.melody);
    for (const [k, part] of Object.entries(song.parts)){
      const I = INSTRUMENTS.find(x => x.key === k);
      expect(I, `unknown instrument "${k}"`).toBeTruthy();
      for (const e of part){
        expect(e[0], `${k} @${e[0]}`).toBeGreaterThanOrEqual(0);
        expect(e[0], `${k} @${e[0]}`).toBeLessThan(loop);
        if (e[2] !== undefined){ expect(e[2]).toBeGreaterThan(0); expect(e[2]).toBeLessThanOrEqual(1); }
      }
    }
  });
});
