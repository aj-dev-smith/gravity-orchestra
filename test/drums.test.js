import { describe, it, expect } from 'vitest';
import { SONGS } from '../src/songs/index.js';
import { DRUM_NAMES, GM_DRUMS, drumByGm, normalizeHit } from '../src/drumkit.js';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const sumBeats = notes => notes.reduce((s, [, b]) => s + b, 0);

/** Every song that declares a `drums` block. */
const drumSongs = Object.entries(SONGS).filter(([, s]) => s.drums);

// ---------------------------------------------------------------------------
// registry sanity
// ---------------------------------------------------------------------------

describe('drumkit registry', () => {
  it('GM note numbers are unique (reverse lookup is unambiguous)', () => {
    const gms = Object.values(GM_DRUMS).map(d => d.gm);
    expect(new Set(gms).size).toBe(gms.length);
  });

  it('drumByGm round-trips every registered name', () => {
    for (const name of DRUM_NAMES) {
      expect(drumByGm(GM_DRUMS[name].gm)).toBe(name);
    }
  });

  it('every drum has a finite gain in (0, 1]', () => {
    for (const [name, d] of Object.entries(GM_DRUMS)) {
      expect(d.gain, name).toBeGreaterThan(0);
      expect(d.gain, name).toBeLessThanOrEqual(1);
    }
  });

  it('normalizeHit accepts a bare beat and a [beat, vel] pair', () => {
    expect(normalizeHit(3)).toEqual({ beat: 3, vel: 1 });
    expect(normalizeHit([3, 0.4])).toEqual({ beat: 3, vel: 0.4 });
  });
});

// ---------------------------------------------------------------------------
// per-song drum invariants — the percussion analogue of the LOCK RULE.
// Hits are absolute + pinned, so the only rule is: a legal lane name, and
// every hit inside the loop window [0, melodyTotal). They cannot desync.
// ---------------------------------------------------------------------------

describe.each(drumSongs)('song "%s" drums', (key, song) => {
  const loop = sumBeats(song.melody);   // the loop length = melody total beats

  it('is a plain object of named lanes', () => {
    expect(typeof song.drums).toBe('object');
    expect(Array.isArray(song.drums)).toBe(false);
    expect(Object.keys(song.drums).length).toBeGreaterThan(0);
  });

  for (const [lane, hits] of Object.entries(song.drums)) {
    it(`lane "${lane}" is a registered drum name`, () => {
      expect(DRUM_NAMES.has(lane), `unknown drum "${lane}" in ${key}`).toBe(true);
    });

    it(`lane "${lane}" — every hit is inside the loop [0, ${loop})`, () => {
      for (const h of hits) {
        const { beat } = normalizeHit(h);
        expect(typeof beat, `beat in ${key}.${lane}`).toBe('number');
        expect(Number.isFinite(beat)).toBe(true);
        expect(beat, `beat ${beat} in ${key}.${lane}`).toBeGreaterThanOrEqual(0);
        expect(beat, `beat ${beat} in ${key}.${lane}`).toBeLessThan(loop);
      }
    });

    it(`lane "${lane}" — every velocity is in (0, 1]`, () => {
      for (const h of hits) {
        const { vel } = normalizeHit(h);
        expect(typeof vel).toBe('number');
        expect(vel, `vel in ${key}.${lane}`).toBeGreaterThan(0);
        expect(vel, `vel in ${key}.${lane}`).toBeLessThanOrEqual(1);
      }
    });

    it(`lane "${lane}" — hits are in ascending time order`, () => {
      const beats = hits.map(h => normalizeHit(h).beat);
      for (let i = 1; i < beats.length; i++) {
        expect(beats[i], `${key}.${lane} hit ${i} out of order`).toBeGreaterThanOrEqual(beats[i - 1]);
      }
    });
  }
});
