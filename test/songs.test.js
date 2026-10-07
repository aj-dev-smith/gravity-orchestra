import { describe, it, expect } from 'vitest';
import { SONGS, SONG_GROUPS, songShelves, defaultSongKey, DEFAULT_SONG } from '../src/songs/index.js';
import { isRuntimeSong } from '../src/songmenu.js';
import { buildRecord } from '../src/instruments/turntable/solve.js';
import { buildOrbit, CLEAR as RICO_CLEAR, FOOT_MAX } from '../src/instruments/ricochet/solve.js';
import { eventTimes } from '../src/instruments/clock.js';

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
  'bald-mountain',
  'danse-macabre',
  'marionette',
  'mars',
];

describe('SONGS catalogue', () => {
  it('has exactly the expected keys in order', () => {
    expect(Object.keys(SONGS)).toEqual(EXPECTED_KEYS);
  });
  // the picker's shelves (SONG_GROUPS): every song on exactly one shelf, no ghosts
  it('shelves every song exactly once, naming only real songs', () => {
    const shelved = SONG_GROUPS.flatMap(([, keys]) => keys);
    expect(new Set(shelved).size).toBe(shelved.length);
    for (const k of shelved) expect(SONGS[k], k).toBeDefined();
    expect([...shelved].sort()).toEqual([...EXPECTED_KEYS].sort());
  });
  it('an unshelved song still reaches the menu (under More)', () => {
    const shelves = songShelves({ ...SONGS, 'new-song': SONGS['fur-elise'] });
    expect(shelves.at(-1)).toEqual(['More', ['new-song']]);
    expect(songShelves().some(([l]) => l === 'More')).toBe(false);
  });
  it('the opening song is seasonal: Danse Macabre in October, else the Daybreak Engine', () => {
    expect(defaultSongKey(new Date(2026, 9, 6))).toBe('danse-macabre');
    expect(defaultSongKey(new Date(2026, 9, 31))).toBe('danse-macabre');
    expect(defaultSongKey(new Date(2026, 10, 1))).toBe(DEFAULT_SONG);
    expect(defaultSongKey(new Date(2026, 5, 19))).toBe('daybreak-engine');
  });
  it('no catalogue key collides with the runtime-song rule (Yours shelf / no ?song= link)', () => {
    for (const k of EXPECTED_KEYS) expect(isRuntimeSong(k), k).toBe(false);
    for (const k of ['imported', 'shared', 'solo-bells']) expect(isRuntimeSong(k), k).toBe(true);
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

// Daybreak Engine's late-added TURNTABLE + RICOCHET parts must solve clean on the real loop
// (the record's pads clear by geometry; the glass knot audits clean and stays compact)
describe('daybreak-engine: turntable + ricochet parts solve on the real loop', () => {
  const S = SONGS['daybreak-engine'], ROLL_T = 2.6, beat = 60 / S.bpm;
  const P = ROLL_T + S.melody.reduce((a, n) => a + n[1], 0) * beat + 1.2;   // main.js: LOOP_T = melody + 1.2
  it('the turntable record clears every deployed pair', () => {
    const R = buildRecord(S.parts.turntable, { rollT: ROLL_T, beat, P, start: -2.4 });
    expect(R.ok).toBe(true);
  });
  it('the ricochet orbit is clean and compact', () => {
    const o = buildOrbit(eventTimes(S.parts.ricochet, { rollT: ROLL_T, beat }), { P, start: -2.4 });
    expect(o.score).toBeGreaterThanOrEqual(RICO_CLEAR);
    expect(o.footMax).toBeLessThanOrEqual(FOOT_MAX * 1.12 ** 2 + 1e-9);   // ≤ 2 escalation rounds
  });
  // a TRADE, never a doubling: no counter-line note lands on a lead onset with the lead's pitch
  // class, and the vibes never sit on the exact pitch the lead is holding (two machines, one note)
  it('turntable + ricochet never double the lead', () => {
    const NN = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const midi = n => { const m = n.match(/^([A-G]#?)(\d)$/); return NN.indexOf(m[1]) + 12 * (+m[2] + 1); };
    let t = 0; const lead = S.melody.map(([n, d]) => { const o = [t, midi(n), d]; t += d; return o; });
    const bad = [];
    for (const k of ['turntable', 'ricochet']) for (const [b, n] of S.parts[k]){
      const L = lead.find(([s, , d]) => b >= s - 1e-6 && b < s + d - 1e-6); if (!L) continue;
      const onset = Math.abs(L[0] - b) < 1e-6, m = midi(n);
      if ((onset && (m - L[1]) % 12 === 0) || (k === 'turntable' && m === L[1])) bad.push(`${k} ${b}:${n}`);
    }
    expect(bad).toEqual([]);
  });
});
