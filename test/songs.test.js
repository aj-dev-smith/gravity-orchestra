import { describe, it, expect } from 'vitest';
import { SONGS } from '../src/songs/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalize a part (bare array OR {delay?, deep?, notes}) to {notes, delay}. */
function normalizePart(part) {
  if (Array.isArray(part)) {
    return { notes: part, delay: 0 };
  }
  return { notes: part.notes, delay: part.delay || 0 };
}

/** Sum the beat values of a notes array: [[note, beats], ...] → number. */
function sumBeats(notes) {
  return notes.reduce((s, [, b]) => s + b, 0);
}

// ---------------------------------------------------------------------------
// Suite 1 — catalogue shape
// ---------------------------------------------------------------------------

const EXPECTED_KEYS = [
  'daybreak-engine',
  'fur-elise',
  'ode-to-joy',
  'canon-in-d',
  'greensleeves',
  'gymnopedie',
  'prelude-in-c',
  'mountain-king',
  'toccata',
  'dies-irae',
  'backbeat',
  'canon-orchestra',
  'carol-of-the-bells',
  'morning-mood',
];

describe('SONGS catalogue', () => {
  it('has exactly the expected keys in order', () => {
    expect(Object.keys(SONGS)).toEqual(EXPECTED_KEYS);
  });
});

// ---------------------------------------------------------------------------
// Suite 2 — per-song invariants
// ---------------------------------------------------------------------------

const NOTE_RE = /^[A-G]#?\d$/;

describe.each(Object.entries(SONGS))('song "%s"', (key, song) => {
  // Collect all parts that exist for this song.
  const melodyTotal = sumBeats(song.melody);

  it('has valid top-level metadata', () => {
    expect(typeof song.label).toBe('string');
    expect(song.label.length).toBeGreaterThan(0);

    expect(typeof song.sub).toBe('string');
    expect(song.sub.length).toBeGreaterThan(0);

    expect(typeof song.bpm).toBe('number');
    expect(song.bpm).toBeGreaterThan(0);
    expect(Number.isFinite(song.bpm)).toBe(true);

    expect(Array.isArray(song.scale)).toBe(true);
    expect(song.scale.length).toBeGreaterThan(0);
  });

  // Build a map of part name → normalized part for all tracks present.
  const parts = { melody: normalizePart(song.melody) };
  if (song.alto) parts.alto = normalizePart(song.alto);
  if (song.bass) parts.bass = normalizePart(song.bass);

  for (const [partName, part] of Object.entries(parts)) {
    it(`${partName}: every note matches /^[A-G]#?\\d$/`, () => {
      for (const [note] of part.notes) {
        expect(note, `note "${note}" in ${key}.${partName}`).toMatch(NOTE_RE);
      }
    });

    it(`${partName}: every beat value is a positive finite number`, () => {
      for (const [, beats] of part.notes) {
        expect(typeof beats, `beats in ${key}.${partName}`).toBe('number');
        expect(Number.isFinite(beats), `beats ${beats} in ${key}.${partName}`).toBe(true);
        expect(beats, `beats ${beats} in ${key}.${partName}`).toBeGreaterThan(0);
      }
    });
  }

  // Lock rule: alto and bass (if present) must sum to exactly melody total.
  for (const trackName of ['alto', 'bass']) {
    if (!song[trackName]) continue;
    it(`${trackName}: lock rule — sum(notes) + delay === melody total (${melodyTotal})`, () => {
      const part = parts[trackName];
      const trackTotal = sumBeats(part.notes) + part.delay;
      expect(trackTotal).toBeCloseTo(melodyTotal, 9);
    });
  }
});
