// PHRASE LOOPS — a full-length song imports as its best LOOPABLE window (src/midi/phrase.js +
// convert.js step 4b). Every song here is SYNTHETIC: a verse/chorus form composed in code, so
// the right answer is known by construction.
import { describe, it, expect } from 'vitest';
import { parseMidi } from '../src/midi/parse.js';
import { convertToSong } from '../src/midi/convert.js';
import { PHRASE, barGrid, barFeatures, barSim, selfSimilarity, findPhrase } from '../src/midi/phrase.js';
import { buildMidi } from './helpers/midi-builder.js';

const PPQ = 480;
const sum = notes => notes.reduce((s, [, b]) => s + b, 0);
const uspq = bpm => Math.round(60_000_000 / bpm);

/* ---- the composer: a FORM is a list of [section, bars]; each section has its own material ----
   lead  per-bar patterns [[beat, midi, len]] (cycled), or null = the lead rests
   bass  per-bar roots (cycled)
   drums 'groove' | 'big' (a crash on the 1, 8th hats) | null                                  */
const SECTIONS = {
  I: { lead: null, bass: [45, 45, 41, 43], drums: 'groove' },
  V: { lead: [[[0, 64, 1], [1, 62, 1], [2, 60, 1], [3, 62, 1]], [[0, 64, 1], [1, 64, 1], [2, 64, 2]],
              [[0, 62, 1], [1, 62, 1], [2, 62, 2]], [[0, 64, 1], [1, 67, 1], [2, 67, 2]]],
       bass: [45, 41, 36, 43], drums: 'groove' },
  C: { lead: [[[0, 76, .5], [.5, 74, .5], [1, 72, .5], [1.5, 74, .5], [2, 76, 1], [3, 79, 1]],
              [[0, 81, .5], [.5, 79, .5], [1, 77, 1], [2, 76, 2]],
              [[0, 74, .5], [.5, 76, .5], [1, 77, .5], [1.5, 79, .5], [2, 81, 1], [3, 83, 1]],
              [[0, 84, 2], [2, 79, 2]]],
       bass: [36, 43, 45, 41], drums: 'big' },
  B: { lead: [[[0, 67, 2], [2, 69, 2]], [[0, 71, 4]]], bass: [38, 40], drums: 'groove' },
  R: { lead: null, bass: [40, 40, 40, 40], drums: 'big', riff: true },     // an instrumental riff (vibes): no lead
  O: { lead: null, bass: [45], drums: null },
};

function compose(form, { bpm = 120, barBeats = 4, num = 4, den = 4, leadShift = 0, leadProgram = 80 } = {}){
  const lead = [], bass = [], kit = [], riff = [];
  const starts = [];                                  // [{ sec, bar (1-based) }]
  let bar = 0;
  for (const [key, bars] of form){
    const S = SECTIONS[key];
    starts.push({ sec: key, bar: bar + 1 });
    for (let k = 0; k < bars; k++, bar++){
      const b0 = bar * barBeats;
      if (S.lead) for (const [b, m, len] of S.lead[k % S.lead.length]) if (b < barBeats) lead.push([b0 + b + leadShift, m, Math.min(len, barBeats - b)]);
      bass.push([b0, S.bass[k % S.bass.length], barBeats]);
      if (S.riff) for (let e = 0; e < barBeats * 2; e++) riff.push([b0 + e / 2, [52, 55, 57, 55][e % 4], .5]);
      if (S.drums){
        for (let q = 0; q < barBeats; q++) kit.push([b0 + q, q % 2 ? 38 : 36, 100]);
        const step = S.drums === 'big' ? .5 : 1;
        for (let h = 0; h < barBeats; h += step) kit.push([b0 + h, 42, 70]);
        if (S.drums === 'big' && k % 4 === 0) kit.push([b0, 49, 110]);
      }
    }
  }
  const ev = (notes, ch) => notes.flatMap(([b, m, len]) => [
    { tick: Math.round(b * PPQ), type: 'on', note: m, vel: 96, channel: ch },
    { tick: Math.round((b + len) * PPQ) - 8, type: 'off', note: m, channel: ch }]);
  const tracks = [
    { events: [{ tick: 0, type: 'name', text: 'Lead' }, { tick: 0, type: 'tempo', uspq: uspq(bpm) },
               { tick: 0, type: 'timesig', num, den }, { tick: 0, type: 'pc', program: leadProgram, channel: 0 }, ...ev(lead, 0)] },
    { events: [{ tick: 0, type: 'name', text: 'Bass' }, { tick: 0, type: 'pc', program: 33, channel: 1 }, ...ev(bass, 1)] },
  ];
  if (riff.length) tracks.push({ events: [{ tick: 0, type: 'name', text: 'Riff' }, { tick: 0, type: 'pc', program: 11, channel: 2 }, ...ev(riff, 2)] });
  tracks.push({ events: [{ tick: 0, type: 'name', text: 'Drums' },
    ...kit.flatMap(([b, m, v]) => [{ tick: Math.round(b * PPQ), type: 'on', note: m, vel: v, channel: 9 },
                                   { tick: Math.round(b * PPQ) + 60, type: 'off', note: m, channel: 9 }])] });
  const sectionAt = b => { let s = null; for (const x of starts) if (x.bar <= b) s = x.sec; return s; };
  return { bytes: buildMidi({ format: 1, ppq: PPQ, tracks }), starts, sectionAt, bars: bar };
}
const convert = (bytes, opts = {}) => convertToSong(parseMidi(bytes), opts);
const POP = [['I', 4], ['V', 8], ['C', 8], ['V', 8], ['C', 8], ['B', 8], ['C', 8], ['C', 8], ['O', 4]];   // 64 bars, 128 s

/** every invariant a windowed import must keep, whatever window it chose */
function expectHonestLoop(song, phrase, barBeats = 4){
  const L = sum(song.melody);
  expect(L).toBeCloseTo(phrase.bars * barBeats, 6);                 // the loop IS the window's bars
  for (const k of ['alto', 'bass']) if (song[k]) expect(song[k].delay + sum(song[k].notes)).toBeCloseTo(L, 6);   // THE LOCK RULE
  for (const [lane, hits] of Object.entries(song.drums || {}))
    for (const h of hits){ const b = Array.isArray(h) ? h[0] : h; expect(b, lane).toBeGreaterThanOrEqual(0); expect(b, lane).toBeLessThan(L); }
  for (const [key, part] of Object.entries(song.parts || {}))
    for (const [b] of part){ expect(b, key).toBeGreaterThanOrEqual(0); expect(b, key).toBeLessThan(L); }
}

// ---------------------------------------------------------------------------
describe('parse: the meter map', () => {
  it('reads time signatures (num/den) and defaults to [] when the file states none', () => {
    const { bytes } = compose([['V', 2]], { num: 3, den: 4, barBeats: 3 });
    expect(parseMidi(bytes).timeSigs).toEqual([{ tick: 0, num: 3, den: 4 }]);
    const bare = buildMidi({ format: 1, ppq: PPQ, tracks: [{ events: [{ tick: 0, type: 'on', note: 60, vel: 90 }, { tick: 400, type: 'off', note: 60 }] }] });
    expect(parseMidi(bare).timeSigs).toEqual([]);
  });
  it('barGrid takes the DOMINANT meter (a 4/4 count-in bar before a 6/8 song is 6/8)', () => {
    const g = barGrid([{ tick: 0, num: 4, den: 4 }, { tick: 4 * PPQ, num: 6, den: 8 }], PPQ, 400 * PPQ);
    expect(g.barBeats).toBe(3);
    expect(g.origin).toBeCloseTo(1, 9);                           // 6/8 bars are anchored at beat 4 (≡ 1 mod 3)
    expect(barGrid([], PPQ, 1000).barBeats).toBe(4);
  });
});

describe('phrase.js — pure', () => {
  it('a bar is identical to its own copy, and unlike a different section', () => {
    const ev = [];
    for (const [b, m] of [[0, 60], [1, 62], [2, 64], [4, 60], [5, 62], [6, 64], [8, 72], [8.5, 74], [9, 79]]) ev.push({ beat: b, midi: m, vel: .8, dur: .5, kind: 'lead' });
    const F = barFeatures(ev, { barBeats: 4 });
    expect(barSim(F[0], F[1])).toBeCloseTo(1, 6);
    expect(barSim(F[0], F[2])).toBeLessThan(.6);
    const S = selfSimilarity(F);
    expect(S[0 * 3 + 1]).toBe(S[1 * 3 + 0]);
  });
  it('fewer than 8 bars → no phrase (a sketch is its own loop)', () => {
    expect(findPhrase([{ beat: 0, midi: 60, vel: 1, dur: 1, kind: 'lead' }], { barBeats: 4, bpm: 120 })).toBe(null);
  });
});

// ---------------------------------------------------------------------------
describe('auto window on a long verse/chorus song', () => {
  const { bytes, sectionAt, starts } = compose(POP);
  const { song, warnings, phrase } = convert(bytes);

  it('a 128 s song loops a 30–75 s window, not the whole song', () => {
    expect(phrase).toBeTruthy();
    expect(phrase.auto).toBe(true);
    expect(phrase.sec).toBeGreaterThanOrEqual(PHRASE.SEC_LO - 1e-9);
    expect(phrase.sec).toBeLessThanOrEqual(PHRASE.SEC_HI + 1e-9);
    expect(sum(song.melody) * 60 / song.bpm).toBeLessThan(80);
  });
  it('the window holds the chorus (the most-repeated material) and the lead plays through it', () => {
    let chorus = 0, lead = 0;
    for (let b = phrase.fromBar; b < phrase.fromBar + phrase.bars; b++){ if (sectionAt(b) === 'C') chorus++; if (SECTIONS[sectionAt(b)].lead) lead++; }
    expect(chorus).toBeGreaterThanOrEqual(8);
    expect(lead / phrase.bars).toBeGreaterThanOrEqual(PHRASE.LEAD_MIN);
    expect(phrase.label).toMatch(/chorus/);
  });
  it('it starts on a section line and LOOPS: the bar after it is the same section as its first bar', () => {
    expect(starts.map(s => s.bar)).toContain(phrase.fromBar);
    expect(sectionAt(phrase.fromBar + phrase.bars)).toBe(sectionAt(phrase.fromBar));
  });
  it('the import is an honest loop (lock rule, drums + parts inside [0, loop))', () => {
    expectHonestLoop(song, phrase);
    expect(song.drums.kick.length).toBeGreaterThan(0);
  });
  it('says what it did, in the warnings and the subtitle', () => {
    const a = phrase.fromBar, b = phrase.fromBar + phrase.bars - 1;
    expect(warnings.some(w => w.startsWith(`phrase: looping bars ${a}–${b} of 64`))).toBe(true);
    expect(song.sub).toContain(`looping bars ${a}–${b}`);
  });
});

describe('the lead is the spine: a riff repeated more often than any chorus is not picked if the lead sits it out', () => {
  it('R R V C R R V C R R (the instrumental riff is the most-repeated material)', () => {
    const form = [['R', 8], ['R', 8], ['V', 8], ['C', 8], ['R', 8], ['R', 8], ['V', 8], ['C', 8], ['R', 8], ['R', 8]];
    const { bytes, sectionAt } = compose(form);
    const { song, phrase } = convert(bytes);
    expect(phrase).toBeTruthy();
    let lead = 0;
    for (let b = phrase.fromBar; b < phrase.fromBar + phrase.bars; b++) if (SECTIONS[sectionAt(b)].lead) lead++;
    expect(lead / phrase.bars).toBeGreaterThanOrEqual(PHRASE.LEAD_MIN - 1e-9);
    expectHonestLoop(song, phrase);
  });
});

describe('short songs and opts.window', () => {
  it('a song ≤ 75 s imports whole (no phrase), exactly as with window: full', () => {
    const { bytes } = compose([['V', 8], ['C', 8], ['V', 8]]);            // 48 s
    const a = convert(bytes), b = convert(bytes, { window: 'full' });
    expect(a.phrase).toBe(null);
    expect(a.song).toEqual(b.song);
    expect(a.warnings.some(w => w.startsWith('phrase:'))).toBe(false);
  });
  it("window: 'full' keeps the whole long song (the old loop: last onset + 1, to the bar)", () => {
    const { bytes } = compose(POP);
    const { song, phrase } = convert(bytes, { window: 'full' });
    expect(phrase).toBe(null);
    // the old rule: from the lead's first note (bar 5) to the last onset anywhere (the outro's
    // bass, bar 64) + 1, rounded up to a bar → 240 beats
    expect(sum(song.melody)).toBe(240);
  });
  it('window: { fromBar, bars } loops exactly those bars (1-based)', () => {
    const { bytes } = compose(POP);
    const { song, phrase, warnings } = convert(bytes, { window: { fromBar: 13, bars: 8 } });
    expect(phrase).toMatchObject({ fromBar: 13, bars: 8, auto: false });
    expect(sum(song.melody)).toBe(32);
    expect(song.melody[0][0]).toBe('E5');                                // the chorus's first lead note (76)
    expect(warnings.some(w => w.startsWith('phrase: looping bars 13–20'))).toBe(true);
    expectHonestLoop(song, phrase);
  });
  it('an explicit window where the lead never plays falls back to the whole song (warned)', () => {
    const { bytes } = compose(POP);
    const { phrase, warnings } = convert(bytes, { window: { fromBar: 1, bars: 4 } });
    expect(phrase).toBe(null);
    expect(warnings.some(w => /lead never plays in bars 1–4/.test(w))).toBe(true);
  });
});

describe('the window is a CIRCLE cut at the lead: nothing before beat 0, nothing dropped', () => {
  // the lead enters on beat 1 of every bar; the bass and the kick land on beat 0 → after the cut,
  // the window's very first bass note and kick belong at the loop's TAIL (W − 1)
  const { bytes } = compose(POP, { leadShift: 1 });
  const { song, phrase } = convert(bytes, { window: { fromBar: 13, bars: 8 }, route: 'legacy' });
  const W = 32;
  it('the bass and drums that precede the lead in the window wrap to the tail', () => {
    expect(sum(song.melody)).toBe(W);
    expect(song.bass.delay).toBe(3);                                      // its 2nd note (beat 4) − 1
    expect(song.bass.delay + sum(song.bass.notes)).toBe(W);
    expect(song.bass.notes[song.bass.notes.length - 1][1]).toBe(1);       // window-beat 0 → W − 1, rings 1 beat to the seam
    expect(song.drums.kick.map(h => Array.isArray(h) ? h[0] : h)).toContain(W - 1);
    expectHonestLoop(song, phrase);
  });
  it('every lead note of the window is kept (8 bars of chorus)', () => {
    const per = SECTIONS.C.lead.map(p => p.length);                       // notes per chorus bar
    expect(song.melody.length).toBe(2 * per.reduce((s, x) => s + x, 0));
  });
});

describe('meter: a 3/4 song loops whole 3-beat bars', () => {
  it('waltz form (bars of 3) → the loop is a multiple of 3 beats', () => {
    const form = [['I', 4], ['V', 8], ['C', 8], ['V', 8], ['C', 8], ['B', 8], ['C', 8], ['C', 8]];   // 60 bars × 1.5 s = 90 s
    const { bytes } = compose(form, { barBeats: 3, num: 3, den: 4 });
    const { song, phrase } = convert(bytes);
    expect(phrase).toBeTruthy();
    expect(phrase.barBeats).toBe(3);
    expect(sum(song.melody) % 3).toBeCloseTo(0, 6);
    expectHonestLoop(song, phrase, 3);
  });
});

describe('cost', () => {
  it('a 200-bar song (6+ minutes) is detected in well under a frame budget per import', () => {
    const form = [];
    for (let i = 0; i < 12; i++) form.push(['V', 8], ['C', 8]);
    form.push(['O', 8]);
    const { bytes } = compose(form, { bpm: 120 });
    const t0 = performance.now();
    const { phrase } = convert(bytes);
    expect(performance.now() - t0).toBeLessThan(1500);
    expect(phrase).toBeTruthy();
  });
});

describe('the creation tools carry the window (MAP panel: LOOP / WHOLE SONG)', () => {
  it('a hand mapping re-solve keeps the window; window: full gives the whole song back', async () => {
    const { applyMidiMapping, defaultMidiMapping } = await import('../src/editor/mapping.js');
    const { bytes } = compose(POP);
    const parsed = parseMidi(bytes);
    const auto = convertToSong(parsed);
    const win = { window: { fromBar: auto.phrase.fromBar, bars: auto.phrase.bars, label: auto.phrase.label } };
    const map = defaultMidiMapping(parsed, win);
    const looped = applyMidiMapping(parsed, map, win), whole = applyMidiMapping(parsed, map, { window: 'full' });
    expect(sum(looped.song.melody)).toBe(auto.phrase.bars * 4);
    expect(sum(whole.song.melody)).toBe(240);
  });
  it('loopText names the window in words', async () => {
    const { loopText } = await import('../src/editor/index.js');
    expect(loopText({ fromBar: 33, bars: 16, sec: 41, songSec: 207, label: 'the chorus' })).toBe('bars 33–48 (0:41 of 3:27) — the chorus');
  });
});
