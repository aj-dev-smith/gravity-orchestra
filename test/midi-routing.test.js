// midi-routing.test.js — the orchestrator's generic routing fixes (research: midi-routing.md):
// power-chord ROOTS, belt TWINS merge, track-NAME hints, ROLE.LOW, steel drums → volley, the
// METER-AWARE bar grid + the tempo-aware loop length. Every fixture is SYNTHETIC (composed here):
// a 220-bpm chug riff in 4/4 + 5/8 bars with a half-tempo clean interlude, an L/R-doubled bass on
// guitar programs, named tracks, … — no file from anyone's Downloads.
import { describe, it, expect } from 'vitest';
import { parseMidi } from '../src/midi/parse.js';
import { convertToSong } from '../src/midi/convert.js';
import { orchestrate, orchestrateByRole, shapePart, polyphony, splitHands, routeProgram, nameRole, riffLike, isPowerChord, gapFit, twins, preferFor,
         ioiFit, PREFER_FIT, overflowOrder, noteSuffix, RIFF_MUTE_SEC,
         lowLine, PART_SPEC, PREFER, OVERFLOW_TO, ROLE, VOLLEY_MIN_HOP, BASS_FIT } from '../src/midi/orchestra.js';
import { barGrid, walkMeter, barAt, barStart, barFeatures, barSim, scoreWindows, selfSimilarity, tempoClock, PHRASE } from '../src/midi/phrase.js';
import { fitMachine } from '../src/editor/mapping.js';
import { GEOM as VOLLEY, buildVolley } from '../src/instruments/volley/solve.js';
import { PART_LIMITS as RIFF_L, normalizeHits } from '../src/instruments/riff/solve.js';
import { PART_LIMITS as STRUM_L, parseId as strumParse } from '../src/instruments/strum/solve.js';
import { PART_LIMITS as ORGAN_L, parseId as organParse } from '../src/instruments/organ/solve.js';
import { PART_LIMITS as HORNS_L, MIN_GAP as HORNS_MIN_GAP } from '../src/instruments/horns/solve.js';
import { PART_LIMITS as BOWWHEEL_L, MIN_REPEAT as BW_MIN_REPEAT } from '../src/instruments/bowwheel/solve.js';
import { PART_LIMITS as DULCIMER_L, parseNote as dulcimerParse } from '../src/instruments/dulcimer/solve.js';
import { buildMidi } from './helpers/midi-builder.js';
import { noteNum, ROLL_T } from '../src/engine.js';

const PPQ = 480;
const uspq = bpm => Math.round(60_000_000 / bpm);
const sum = notes => notes.reduce((s, [, b]) => s + b, 0);
const convert = (bytes, opts) => convertToSong(parseMidi(bytes), opts);
const pc = n => noteNum(n) % 12;

/** a track: name, program on `ch`, notes [beat, midi, len = 1, vel = 90] (+ extra meta events) */
function trk(name, program, ch, notes, extra = []){
  const events = [{ tick: 0, type: 'name', text: name }, ...extra];
  if (program != null) events.push({ tick: 0, type: 'pc', program, channel: ch });
  for (const [b, m, len = 1, vel = 90] of notes){
    events.push({ tick: Math.round(b * PPQ), type: 'on', note: m, vel, channel: ch });
    events.push({ tick: Math.round((b + len) * PPQ) - 4, type: 'off', note: m, channel: ch });
  }
  return { events };
}
const file = (...tracks) => buildMidi({ format: 1, ppq: PPQ, tracks });
const tempo = bpm => ({ tick: 0, type: 'tempo', uspq: uspq(bpm) });
const vibes = () => trk('Vibes', 11, 8, Array.from({ length: 8 }, (_, i) => [i * 2, 72 + (i % 3)]));   // keeps PROGRAM routing on
const tune = (base, n, step = 1) => Array.from({ length: n }, (_, i) => [i * step, base + [0, 2, 4, 5, 7, 9, 11, 12][i % 8]]);

/* ---------------------------------------------------------------------------
   THE CHUG — a synthetic thrash song (all original): 220 bpm, a riff CYCLE of three 4/4 bars + one
   5/8 bar (14.5 beats), power chords (root + fifth, + octave every other hit) chugged in 8ths, the
   bass doubling the root an octave down on TWO tracks (L/R, guitar programs 26/28 — the way MoP's
   file has it), vocals over the verses, and a CLEAN INTERLUDE in 4/4 at HALF tempo (110).
     form: R ×4 cycles · V ×8 · I (16 bars of 4/4 @110) · V ×8 · R ×4
   --------------------------------------------------------------------------- */
const ROOTS = [40, 40, 43, 45, 40, 40, 47, 46];          // E E G A E E B A# (E2…) — the riff's root motion
function chug({ bpm = 220, names = true } = {}){
  const meta = [tempo(bpm)], g1 = [], bassL = [], voc = [], kit = [], arp = [];
  let beat = 0, sections = [];
  const cycle = (vocal) => {
    const lens = [4, 4, 4, 2.5];
    let k = 0;                                           // 8ths into the cycle: the riff runs through all 29
    for (let bi = 0; bi < 4; bi++){
      const len = lens[bi];
      meta.push({ tick: Math.round(beat * PPQ), type: 'timesig', num: len === 4 ? 4 : 5, den: len === 4 ? 4 : 8 });
      for (let e = 0; e < len * 2; e++){
        const b = beat + e / 2, r = ROOTS[k++ % ROOTS.length];
        g1.push([b, r, .4, 100], [b, r + 7, .4, 100]);
        if (e % 2 === 0) g1.push([b, r + 12, .4, 100]);
        bassL.push([b, r - 12, .4, 100]);
        if (e % 2 === 0) kit.push([b, e % 4 === 0 ? 36 : 38, 110]);
        kit.push([b, 42, 80]);
      }
      if (vocal) for (let q = 0; q < Math.floor(len); q++) voc.push([beat + q, [64, 67, 69, 71, 69, 67][(bi * 4 + q) % 6], .9, 96]);
      beat += len;
    }
  };
  const mark = (name, f) => { const b0 = beat; f(); sections.push({ name, b0, b1: beat }); };
  mark('R', () => { for (let c = 0; c < 4; c++) cycle(false); });
  mark('V', () => { for (let c = 0; c < 8; c++) cycle(true); });
  mark('I', () => {
    meta.push({ tick: Math.round(beat * PPQ), type: 'timesig', num: 4, den: 4 }, { tick: Math.round(beat * PPQ), type: 'tempo', uspq: uspq(bpm / 2) });
    for (let bar = 0; bar < 16; bar++){
      for (let e = 0; e < 8; e++) arp.push([beat + e / 2, [52, 59, 64, 67, 71, 67, 64, 59][e] + (bar % 4 === 3 ? -2 : 0), .5, 70]);
      bassL.push([beat, 28 + (bar % 4 === 3 ? -2 : 0), 4, 80]);
      kit.push([beat, 36, 70], [beat + 2, 38, 60]);
      beat += 4;
    }
    meta.push({ tick: Math.round(beat * PPQ), type: 'tempo', uspq: uspq(bpm) });
  });
  mark('V2', () => { for (let c = 0; c < 8; c++) cycle(true); });
  mark('R2', () => { for (let c = 0; c < 4; c++) cycle(false); });
  const nm = (s, i) => names ? s : `ch${i}`;
  const g = [...g1, ...arp];
  const bytes = file(
    { events: [{ tick: 0, type: 'name', text: nm('Vocals (left)', 0) }, ...meta, { tick: 0, type: 'pc', program: 31, channel: 0 },
               ...trk('', null, 0, voc).events.filter(e => e.type !== 'name')] },
    trk(nm('Guitar 1', 1), 30, 1, g),
    trk(nm('Bass (left)', 2), 26, 2, bassL),
    trk(nm('Bass (right)', 3), 28, 3, bassL),
    trk(nm('Drums', 4), null, 9, kit.map(([b, m, v]) => [b, m, .1, v])),
  );
  return { bytes, sections, beats: beat };
}

// ---------------------------------------------------------------------------
describe('chord → one note: a RIFF keeps its root, a piano / lead chord its top', () => {
  it('isPowerChord: root + fifth (± octaves) only', () => {
    expect(isPowerChord([40, 47])).toBe(true);
    expect(isPowerChord([40, 47, 52])).toBe(true);
    expect(isPowerChord([40, 47, 52, 59])).toBe(true);
    expect(isPowerChord([40, 44, 47])).toBe(false);           // a triad
    expect(isPowerChord([40, 52])).toBe(false);               // an octave is one note, not a chord
    expect(isPowerChord([40])).toBe(false);
  });
  const on = n => n.beat;
  const chords = (rootLo, shapes, n = 16) => Array.from({ length: n }, (_, i) => shapes[i % shapes.length].map(iv => ({ beat: i / 2, midi: rootLo + [0, 3, 5, 7][i % 4] + iv })) ).flat();
  it('riffLike: low power chords yes; the same shapes up high, or low triads, no', () => {
    expect(riffLike(chords(40, [[0, 7], [0, 7, 12]]), on)).toBe(true);
    expect(riffLike(chords(64, [[0, 7], [0, 7, 12]]), on)).toBe(false);     // parallel fifths up high: a harmonised tune
    expect(riffLike(chords(40, [[0, 4, 7], [0, 3, 7]]), on)).toBe(false);   // low triads: piano comping
    expect(riffLike(chords(40, [[0, 7]], 3), on)).toBe(false);              // too few chords to call
  });
  it('polyphony: a LOW power chord counts as one note; the same fifths up high stay a chord (riffLike agrees)', () => {
    const q = t => Math.round(t / PPQ * 12) / 12;
    const fifths = lo => Array.from({ length: 16 }, (_, i) => [lo, lo + 7].map(m => ({ tick: i * PPQ, midi: m + (i % 3), dur: PPQ * .9 }))).flat();
    expect(polyphony(fifths(40), q)).toBeLessThan(.25);                  // a chug: a line
    expect(polyphony(fifths(67), q)).toBeGreaterThan(.9);                // a pad / harmonised line in fifths: chordal
  });
  it('the belt: a power-chord riff plays its ROOT motion (not fifths / octaves on top)', () => {
    const roots = [40, 40, 43, 45, 40, 40, 47, 46];
    const riff = roots.flatMap((r, i) => [[i, r], [i, r + 7], ...(i % 2 ? [] : [[i, r + 12]])]);
    const both = [...riff, ...riff.map(([b, m]) => [b + 8, m])];
    // program routing (a vibraphone keeps the room non-empty): the belt's chord squash keeps roots
    const { song, warnings } = convert(file(trk('Riff', 30, 0, both), vibes()));
    expect(song.melody.map(([n]) => pc(n))).toEqual([...roots, ...roots].map(m => m % 12));
    expect(warnings.some(w => /kept the root \(lowest note\) of 24 chords/.test(w))).toBe(true);
    // alone it is a LINE (power chords are one note — polyphony), still the root motion
    const alone = convert(file(trk('Riff', 30, 0, both)));
    expect(alone.song.melody.map(([n]) => pc(n))).toEqual([...roots, ...roots].map(m => m % 12));
    // a riff split by role routing (no program data, one track) reads bottom-up as well
    const q = t => Math.round(t / PPQ * 12) / 12;
    const sh = splitHands(both.map(([b, m]) => ({ tick: b * PPQ, midi: m, dur: PPQ })), q, { riff: true });
    expect(sh.top.map(n => n.midi)).toEqual([...roots, ...roots]);             // the roots, one hand (octaves aren't a left hand)
    expect(sh.bottom).toEqual([]);
  });
  it('the belt: a piano melody harmonised in sixths below keeps its TOP note (the tune)', () => {
    const top = [76, 77, 79, 81, 79, 77, 76, 74];
    const harm = top.flatMap((m, i) => [[i, m], [i, m - 9]]);
    const { song, warnings } = convert(file(trk('Piano', 0, 0, harm), vibes()));
    expect(song.melody.map(([n]) => noteNum(n))).toEqual(top);
    expect(warnings.some(w => /kept top note of 8 chords/.test(w))).toBe(true);
    expect(convert(file(trk('Piano', 0, 0, harm))).song.melody.map(([n]) => noteNum(n))).toEqual(top);   // (role routing too)
  });
  it('a one-marble machine (turntable): a riff voice keeps its roots, a chordal tune its tops', () => {
    const riff = [40, 43, 45, 40].flatMap((r, i) => [r, r + 7, r + 12].map(m => ({ beat: i, midi: m, vel: .8, voice: 0 })));
    const r = shapePart('turntable', riff, { bpm: 120, loopBeats: 8 });
    expect(r.part.map(e => pc(e[1]))).toEqual([4, 7, 9, 4]);
    expect(r.warnings.some(w => /kept the ROOT of/.test(w))).toBe(true);
    const tunes = [76, 77, 79, 81].flatMap((m, i) => [m, m - 4].map(x => ({ beat: i, midi: x, vel: .8, voice: 0 })));
    expect(shapePart('turntable', tunes, { bpm: 120, loopBeats: 8 }).part.map(e => noteNum(e[1]) % 12)).toEqual([76, 77, 79, 81].map(m => m % 12));
  });
  it('legacy routing is untouched (the classic importer keeps top notes)', () => {
    const riff = [40, 43, 45, 40].flatMap((r, i) => [[i, r], [i, r + 7]]);
    const { song } = convert(file(trk('Riff', 30, 0, riff)), { route: 'legacy' });
    expect(song.melody.map(([n]) => pc(n))).toEqual([47, 50, 52, 47].map(m => m % 12));
  });
});

// ---------------------------------------------------------------------------
describe('belt TWINS merge (one line panned L/R is one belt, not two)', () => {
  const q = t => Math.round(t / PPQ * 12) / 12;
  const N = (b, m) => ({ tick: b * PPQ, midi: m });
  it('twins: mutual exact cover only', () => {
    const a = [N(0, 40), N(1, 43), N(2, 45)];
    expect(twins(a, a.map(n => ({ ...n })), q)).toBe(true);
    expect(twins(a, a.map(n => ({ ...n, midi: n.midi + 12 })), q)).toBe(false);    // an octave doubling: two registers
    expect(twins([...a, N(0, 47), N(1, 50), N(2, 52)], a, q)).toBe(false);          // a chord that CONTAINS a line
  });
  it('an L/R bass on guitar programs takes ONE belt (and frees the other for a real voice)', () => {
    const bass = Array.from({ length: 16 }, (_, i) => [i, 40 + [0, 3, 5, 7][i % 4]]);
    const { song, warnings } = convert(file(
      trk('Lead', 0, 0, tune(72, 16)), trk('Low L', 26, 1, bass), trk('Low R', 28, 2, bass),
      trk('Alto', 0, 3, tune(64, 16, 1).map(([b, m]) => [b + .5, m + 1])), vibes()));
    expect(warnings.some(w => /belt: "Low (L|R)" doubles "Low (L|R)" — merged/.test(w))).toBe(true);
    expect(song.alto).toBeDefined(); expect(song.bass).toBeDefined();
    expect(sum(song.bass.notes) + song.bass.delay).toBe(sum(song.melody));          // the lock rule
    expect(warnings.join('\n')).not.toMatch(/"Alto".*plays on/);                    // the freed belt took the alto
    // before: Low L + Low R burned both belts and the alto overflowed to the turntable
  });
  it('an octave doubling keeps its own belt (a second register the room can see)', () => {
    const { warnings } = convert(file(trk('Lead', 0, 0, tune(76, 16)), trk('Low', 0, 1, tune(52, 16))));
    expect(warnings.some(w => /doubles/.test(w))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('track NAMES before programs', () => {
  it('nameRole reads what a person typed (and nothing from "ch3" / "Track 2" / numbers)', () => {
    const cases = {
      bass: ['Bass', 'Bass (left)', 'bass', 'Synth Bass', 'Bass Lead Left', 'Strings (as bass)', 'Bass Melody', 'Contrabass'],
      lead: ['Vocals', 'Vocals (right)', 'Lead Vocal', 'Voice', 'Melody', 'Flute (Melody)', 'Lead Guitar', 'Lead Right', 'Singer'],
      guitar: ['Guitar 1', 'Rhthym Guitar Dist', 'Acoustic Guitar', 'GTR', 'MUTED GTR', 'Riff', 'Rhythm'],
      sustain: ['Strings', 'STRINGS', 'Choir', 'Organ', 'Warm Pad', 'String Ensemble', 'Cello'],
      drums: ['Drums', 'drum kit', 'Percussion', 'Kick', 'Bass Drum'],
      null: ['', 'ch3', 'tk12', 'Track 2', '81', 'Staff-1', 'CH #3', 'Counter Melody', 'Melody support', 'Harmony', 'Guitar Solo',
             'Lead Guitar Fill', 'STEEL DRUM', 'Melodic Toms Left', 'Bassoon', 'Atmosphere 1', 'Backing Vocals'],
    };
    const got = {};
    for (const [want, names] of Object.entries(cases)) for (const n of names){
      const r = nameRole(n);
      if (String(r) !== want) got[n] = r;
    }
    // (a solo / a fill is not the song's tune: those guitars are guitars, not leads)
    expect(got).toEqual({ 'Guitar Solo': 'guitar', 'Lead Guitar Fill': 'guitar' });
  });
  it('"Bass" played by a guitar program goes to the string bass (when the string bass can keep up)', () => {
    const bass = Array.from({ length: 16 }, (_, i) => [i, 40 + [0, 3, 5, 7][i % 4]]);
    const { song, warnings } = convert(file(trk('Lead', 0, 0, tune(72, 16)), trk('Bass', 27, 1, bass)));
    expect(warnings.some(w => /"Bass" plays as a bass by its name \(its program is Clean Guitar\)/.test(w))).toBe(true);
    expect(song.parts?.bass?.length).toBe(16);
    expect(song.bass).toBeUndefined();
  });
  it('…but a bass the string bass would gut (8ths on one pitch at 220 bpm: .136 s < its .15 s gap) stays a belt line', () => {
    const bass = Array.from({ length: 32 }, (_, i) => [i / 2, 40, .4]);
    expect(gapFit(bass.map(([b, m]) => ({ tick: b * PPQ, midi: m })), PART_SPEC.bass.gap, 60 / 220 / PPQ)).toBeLessThan(BASS_FIT);
    expect(gapFit(bass.map(([b, m]) => ({ tick: b * PPQ, midi: m })), PART_SPEC.bass.gap, 60 / 120 / PPQ)).toBe(1);
    const { song, warnings } = convert(file(trk('Lead', 0, 0, tune(72, 16), [tempo(220)]), trk('Bass', 26, 1, bass), vibes()));
    expect(warnings.some(w => /named a bass, but the string bass could play only 50%/.test(w))).toBe(true);
    expect(song.parts?.bass).toBeUndefined();
    expect(song.bass.notes.length).toBe(32);                                        // every chug, on the belt
  });
  it('a NAMED lead beats a busier voice (a sung line vs a chugging guitar)', () => {
    const chugs = Array.from({ length: 64 }, (_, i) => [i / 4, 64 + (i % 3)]);
    const vocal = tune(67, 16);
    const { warnings, song } = convert(file(trk('Gtr', 0, 0, chugs), trk('Vocals', 0, 1, vocal)));
    expect(song.melody.map(([n]) => noteNum(n))).toEqual(vocal.map(([, m]) => m));
    expect(warnings.join('\n')).not.toMatch(/leads the belt/);
  });
  it('…when it is a real line: a 6-note "Melody" doodle does not take the belt', () => {
    const { song } = convert(file(trk('Piano', 0, 0, tune(72, 64, .5).map(([b, m]) => [b, m, .5])), trk('Melody', 0, 1, tune(60, 6))));
    expect(song.melody.length).toBe(64);
  });
  it('a long song (a phrase window): a named lead that enters late still leads; a short one keeps the rules', () => {
    // 64 bars at 120 = 128 s: guitar from bar 1, vocals from bar 9
    const gtr = Array.from({ length: 256 }, (_, i) => [i, 52 + (i % 5)]);
    const voc = Array.from({ length: 112 }, (_, i) => [32 + i * 2, 67 + [0, 2, 4, 2][i % 4]]);
    const long = convert(file(trk('Gtr', 27, 0, gtr), trk('Vocals', 52, 1, voc)));
    expect(long.phrase).toBeTruthy();
    expect(new Set(long.song.melody.map(([n]) => noteNum(n)))).toEqual(new Set([67, 69, 71]));
    const short = convert(file(trk('Gtr', 27, 0, gtr.slice(0, 64)), trk('Vocals', 52, 1, voc.slice(0, 16).map(([b, m]) => [b - 16, m]))));
    expect(short.phrase).toBeNull();
    expect(short.song.melody.length).toBe(64);                                      // the vocal enters 16 beats late: no
  });
  it('a "Drums" track off channel 10 plays the drum machine (its keys are GM drums)', () => {
    const kit = Array.from({ length: 16 }, (_, i) => [i / 2, i % 2 ? 42 : (i % 4 ? 38 : 36), .1]);
    const { song, warnings } = convert(file(trk('Lead', 0, 0, tune(72, 8)), trk('Drums', 0, 3, kit)));
    expect(warnings.some(w => /"Drums": a drum track on channel 4 \(not 10\)/.test(w))).toBe(true);
    expect(Object.keys(song.drums).sort()).toEqual(['hat', 'kick', 'snare']);
    expect(song.alto ?? song.bass).toBeUndefined();
    // …but "STEEL DRUM" is an instrument, and a "Drums"-named melody (keys off the GM kit) stays melodic
    const pan = convert(file(trk('Lead', 0, 0, tune(72, 8)), trk('STEEL DRUM', 114, 3, tune(72, 8, .5))));
    expect(pan.song.parts.volley).toBeDefined();
    const odd = convert(file(trk('Lead', 0, 0, tune(72, 8)), trk('Drums', 0, 3, tune(90, 8, .5))));
    expect(odd.song.drums).toBeUndefined();
    // a "Percussion" staff on a PITCHED percussion program (timpani: keys 40–55 all map to kit pieces) stays melodic
    const timp = Array.from({ length: 16 }, (_, i) => [i, [41, 48, 43, 45][i % 4], .5]);
    const orch = convert(file(trk('Lead', 0, 0, tune(72, 8)), trk('Percussion', 47, 3, timp)));
    expect(orch.song.drums).toBeUndefined();
    expect(orch.warnings.some(w => /a drum track on channel/.test(w))).toBe(false);
  });
  it('nameRole: a kit named with "tom" / "custom" is still a kit; melodic toms are not', () => {
    expect(nameRole('Drums (custom)')).toBe('drums');
    expect(nameRole('Drum Kit - Toms')).toBe('drums');
    expect(nameRole('Melodic Toms')).toBeNull();
  });
  it('"Strings" on a piano program is a sustained part (chords → the bowls)', () => {
    const pad = [0, 4, 8, 12].flatMap(b => [60, 64, 67].map(m => [b, m, 4]));
    const { song, warnings } = convert(file(trk('Lead', 0, 0, tune(72, 16)), trk('Strings', 0, 1, pad)));
    expect(warnings.some(w => /"Strings" plays as a sustained part by its name/.test(w))).toBe(true);
    expect(song.parts.bowls.length).toBe(12);
  });
  it('a name never overrules a plugin program that already names its machine (a "Lead" vibraphone stays vibes)', () => {
    const { song } = convert(file(trk('Piano', 0, 0, tune(72, 16)), trk('Lead', 11, 1, tune(60, 16, .5))));
    expect(song.parts.marimba.length).toBe(16);
  });
});

// ---------------------------------------------------------------------------
describe('ROLE.LOW 50 → 46: rhythm guitars are guitars, basses are basses', () => {
  it('thresholds', () => { expect(ROLE.LOW).toBe(46); expect(ROLE.GTR_LOW).toBe(40); expect(ROLE.LEAD_MIN).toBe(55); });
  it('lowLine: a guitar is low only under its lowest string; a bass-named track always', () => {
    expect(lowLine({ mean: 47, program: 30 })).toBe(false);          // MoP's distortion rhythm guitar
    expect(lowLine({ mean: 42, program: 30 })).toBe(false);
    expect(lowLine({ mean: 32, program: 26 })).toBe(true);           // MoP's bass on a jazz-guitar program
    expect(lowLine({ mean: 44, program: 0 })).toBe(true);
    expect(lowLine({ mean: 47, program: 0 })).toBe(false);
    expect(lowLine({ mean: 50, program: 0, role: 'bass' })).toBe(true);
  });
  it('program routing: a spare rhythm-guitar line (mean 47) is not dumped on the string bass', () => {
    const gtr = Array.from({ length: 16 }, (_, i) => [i, 40 + [0, 5, 7, 12, 14, 12, 7, 5][i % 8]]);  // mean ≈ 47.75
    const { song, warnings } = convert(file(
      trk('Lead', 0, 0, tune(76, 16)), trk('A', 0, 1, tune(64, 16)), trk('B', 0, 2, tune(57, 16)), trk('Rhythm', 30, 3, gtr)));
    expect(song.parts?.bass).toBeUndefined();
    // (was: the free turntable — a spare guitar line now plays its family's machine, the Riff Forge)
    expect(warnings.some(w => /"Rhythm" .*plays on the riff \(a spare distortion guitar line\)/.test(w))).toBe(true);
    expect(song.parts.riff.length).toBe(16);
  });
  it('role routing (no programs): a guitar-named line at 47 is a melodic line; an unnamed line at 40 is the bass', () => {
    const r = orchestrateByRole(parseMidi(file(trk('Tune', null, 0, tune(72, 16)),
      trk('Guitar', null, 1, Array.from({ length: 16 }, (_, i) => [i, 40 + [0, 5, 7, 12, 14, 12, 7, 5][i % 8]])),
      trk('Low', null, 2, tune(34, 16)))).tracks, { ppq: PPQ, bpm: 120 });
    expect(r.parts.find(p => p.key === 'bass')?.name).toBe('Low');
    expect(r.warnings[0]).toMatch(/"Guitar" → turntable \(a melodic line\)/);
  });
});

// ---------------------------------------------------------------------------
describe('steel drums → the volley (an existing machine, never routed before)', () => {
  it('PART_SPEC.volley mirrors the solver: one marble, a hop ≥ GEOM.MIN_HOP', () => {
    expect(VOLLEY_MIN_HOP).toBe(VOLLEY.MIN_HOP);
    expect(PART_SPEC.volley.gap).toBe(VOLLEY.MIN_HOP);
    expect(PART_SPEC.volley.ioi).toBe(VOLLEY.MIN_HOP);
    expect(PART_SPEC.volley.poly).toBe(1);
    expect(routeProgram(114)).toBe('volley');
  });
  it('a steel-pan line plays the volley; a second steel-pan voice falls to the marimba (not dropped)', () => {
    const { song, warnings } = convert(file(trk('Lead', 0, 0, tune(72, 16)),
      trk('Pan 1', 114, 1, tune(67, 16, .5)), trk('Pan 2', 114, 2, tune(60, 16, .5).map(([b, m]) => [b + .25, m]))));
    expect(song.parts.volley.length).toBe(16);
    expect(warnings.some(w => /"Pan 2" \(Steel Drums\) plays on the marimba \(the volley already plays 1 voice\)/.test(w))).toBe(true);
    expect(song.parts.marimba.length).toBe(16);
    expect(OVERFLOW_TO.volley).toBe('marimba');
  });
  it('the imported part builds honestly on the volley solver (nothing for it to thin)', () => {
    const { song } = convert(file(trk('Lead', 0, 0, tune(72, 32)), trk('Pan', 114, 1, tune(67, 32, .5))));
    const beat = 60 / song.bpm, P = ROLL_T + sum(song.melody) * beat + 1.2;
    const R = buildVolley(song.parts.volley, { rollT: ROLL_T, beat, P, start: -2.4 });
    expect(R.thinned).toBeLessThanOrEqual(.05 * song.parts.volley.length);         // the orchestra's fit did the thinning
  });
  it('the hand mapping (fitMachine) still runs the volley solver after the orchestra fit', () => {
    const notes = Array.from({ length: 64 }, (_, i) => ({ beat: i * .25, midi: 70 + (i % 5), vel: .8, voice: 0 }));
    const r = fitMachine('volley', notes, { bpm: 120, loopBeats: 16 });
    for (let i = 1; i < r.part.length; i++) expect((r.part[i][0] - r.part[i - 1][0]) * .5).toBeGreaterThanOrEqual(VOLLEY.MIN_HOP - 1e-9);
  });
});

// ---------------------------------------------------------------------------
describe('the family machines: PREFER / LINE_HOME / OVERFLOW_TO', () => {
  it('a PREFER machine routes only while it has a PART_SPEC (a plugin that is gone falls back to the family home)', () => {
    expect([...new Set(PREFER.map(p => p.key))]).toEqual(['riff', 'strum', 'bowwheel', 'organ', 'horns']);
    expect(preferFor(30, false)).toBe(null);                          // a distortion LINE stays a belt candidate …
    expect(preferFor({ program: 30, poly: 0, medDur: .1, riff: true, pitches: 12 })).toBe('riff');   // … a power-chord riff doesn't
    expect(preferFor(25, true)).toBe('strum');
    expect(preferFor(25, false)).toBe(null);                          // a single steel-guitar line stays a belt candidate
    expect(preferFor({ program: 27, poly: 0, medDur: .1, riff: true, pitches: 12 })).toBe('riff');   // a clean guitar's power chords (MoP G1)
    expect(preferFor(27, true)).toBe('strum');                        // … its ordinary chords strum
    expect(preferFor(89, false)).toBe('organ');                       // a pad is always a bed
    expect(preferFor({ program: 89, poly: 1, medDur: 3, pitches: 6 })).toBe('bowls');   // … a few long notes: the bowls
    expect(preferFor(61, true)).toBe('horns');
    expect(preferFor(61, false)).toBe(null);                          // a single horn line is a melody
    expect(preferFor(48, true)).toBe('bowwheel');
    const chords = Array.from({ length: 16 }, (_, i) => [[i, 52], [i, 56], [i, 59]]).flat();
    const route = () => orchestrate(parseMidi(file(trk('Lead', 0, 0, tune(72, 16)), trk('Strum', 25, 1, chords))).tracks, { ppq: PPQ, bpm: 120 });
    expect(route().parts.map(p => p.key)).toEqual(['strum']);
    const saved = PART_SPEC.strum;
    delete PART_SPEC.strum;
    try {
      expect(preferFor(25, true)).toBe(null);
      expect(route().parts.map(p => p.key)).toEqual(['riff']);        // the guitar family's other machine (then the marimba)
    } finally { PART_SPEC.strum = saved; }
  });
  it('a fit guard: the autoharp takes a voice only if its .2 s strum spacing keeps ≥ PREFER_FIT of it', () => {
    const spt = 60 / 120 / PPQ;
    const strums = Array.from({ length: 16 }, (_, i) => [52, 56, 59].map(m => ({ tick: i * PPQ / 2 + (m - 52) * 4, midi: m })));   // 8ths, pre-strummed
    expect(ioiFit(strums.flat(), PART_SPEC.strum.ioi, spt, PART_SPEC.strum.chordEps)).toBe(1);   // .25 s strums; a 10 ms roll is one strum
    expect(ioiFit(strums.flat(), PART_SPEC.strum.ioi, spt)).toBeLessThan(.5);                     // (unmerged, the roll's strings crowd)
    const run = Array.from({ length: 32 }, (_, i) => ({ tick: i * PPQ / 4, midi: 52 + i % 7 }));          // a 16th-note harp run (.125 s)
    expect(ioiFit(run, PART_SPEC.strum.ioi, spt, PART_SPEC.strum.chordEps)).toBeLessThan(PREFER_FIT);
    const harp = trk('Harp', 46, 1, run.map(n => [n.tick / PPQ, n.midi, 1]));
    const { song } = convert(file(trk('Lead', 0, 0, tune(76, 16)), harp));
    expect(song.parts.strum).toBeUndefined();                         // the run stays on the struck bars
    expect(song.parts.marimba.length).toBeGreaterThan(0);
  });
  it('every new PART_SPEC is its plugin\'s own PART_LIMITS (no copied numbers); the gaps are the solvers\' floors', () => {
    const L = { riff: RIFF_L, strum: STRUM_L, organ: ORGAN_L, horns: HORNS_L, bowwheel: BOWWHEEL_L, dulcimer: DULCIMER_L };
    for (const [k, lim] of Object.entries(L)){
      const S = PART_SPEC[k];
      for (const f of ['lo', 'hi', 'gap']) expect(S[f], `${k}.${f}`).toBe(lim[f]);
      expect(S.poly, `${k}.poly`).toBeLessThanOrEqual(lim.poly);
      if (lim.pitches) expect(S.pitches, `${k}.pitches`).toBeLessThanOrEqual(lim.pitches);
      if (lim.maxDur) expect(S.maxDur, `${k}.maxDur`).toBeLessThanOrEqual(lim.maxDur);
      if (lim.voices) expect(S.voices, `${k}.voices`).toBe(lim.voices);
      expect(S.voices).toBeGreaterThan(0);
    }
    expect(PART_SPEC.bowwheel.gap).toBe(+BW_MIN_REPEAT.toFixed(3));  // closer same-pitch onsets MERGE into one stroke
    expect(PART_SPEC.horns.gap).toBe(HORNS_MIN_GAP);
    expect(PART_SPEC.riff.maxEvents).toBe(2 * RIFF_L.maxEvents);     // its budget counts hits; a power chord is ≥ 2 notes
    expect(PART_SPEC.riff.durs).toBe(true);                          // every hit carries its length (the hook lift)
  });
  it('OVERFLOW_TO chains run upstream first and never loop', () => {
    const order = overflowOrder(Object.keys(PART_SPEC));
    for (const [from, to] of Object.entries(OVERFLOW_TO)){
      expect(PART_SPEC[to], `${from} → ${to}`).toBeDefined();
      expect(order.indexOf(from), `${from} before ${to}`).toBeLessThan(order.indexOf(to));
    }
    expect(OVERFLOW_TO.organ).toBe('bowls'); expect(OVERFLOW_TO.bowwheel).toBe('organ');
  });
  it('a big string section: the bow wheel takes 4 voices, the rest bow on the organ (its pad voice)', () => {
    // (six DIFFERENT sections — each enters on its own sixteenth, so none is a twin of another)
    const sect = (name, ch, base) => trk(name, 48, ch, Array.from({ length: 8 }, (_, i) => [i * 2 + ch / 4, base + [0, 4, 7][i % 3]]).flatMap(([b, m]) => [[b, m, 1.5], [b, m + 3, 1.5]]));
    const { song, warnings } = convert(file(trk('Lead', 0, 0, tune(76, 16)),
      ...[1, 2, 3, 4, 5, 6].map(ch => sect(`Str ${ch}`, ch, 44 + 3 * ch))));
    expect(song.parts.bowwheel.length).toBeGreaterThan(0);
    expect(song.parts.organ.length).toBeGreaterThan(0);
    expect(song.parts.organ.every(e => e[1].endsWith('|pad'))).toBe(true);    // strings on the organ: its pad voice
    expect(warnings.filter(w => /plays on the organ \(the bowwheel already plays 4 voices\)/.test(w)).length).toBe(2);
  });
});

describe('timbre / articulation suffixes (orchestra.noteSuffix ↔ each plugin\'s parser)', () => {
  const spb = .5;
  it('riff: palm mute from the note length in SECONDS (or a muted-guitar program), clean for clean / acoustic programs', () => {
    expect(noteSuffix('riff', { prog: 30, dur: .2 }, spb)).toBe(':m');            // .1 s < RIFF_MUTE_SEC
    expect(noteSuffix('riff', { prog: 30, dur: 1 }, spb)).toBe('');
    expect(noteSuffix('riff', { prog: 28, dur: 2 }, spb)).toBe(':m');
    expect(noteSuffix('riff', { prog: 27, dur: 2 }, spb)).toBe(':c');
    expect(noteSuffix('riff', { prog: 27, dur: .1 }, spb)).toBe(':mc');
    expect(noteSuffix('riff', { prog: 27, progs: [27, 30], dur: 2 }, spb)).toBe('');   // a clean guitar doubling a distortion riff: the dirt
    expect(noteSuffix('riff', { prog: 30, dur: null }, spb)).toBe('');
    expect(RIFF_MUTE_SEC).toBe(.15);
    // the plugin reads them back
    const h = normalizeHits([[0, 'E2:m', 1, 1], [0, 'B2:m', 1, 1], [1, 'G2:c', 1, 2]]);
    expect(h.map(x => [x.mute, x.clean])).toEqual([[true, false], [false, true]]);
  });
  it('strum / organ / dulcimer timbres by program; the others take none', () => {
    expect(noteSuffix('strum', { prog: 24 }, spb)).toBe('|n');
    expect(noteSuffix('strum', { prog: 46 }, spb)).toBe('|h');
    expect(noteSuffix('strum', { prog: 25 }, spb)).toBe('');
    expect(noteSuffix('organ', { prog: 52 }, spb)).toBe('|choir');
    expect(noteSuffix('organ', { prog: 89 }, spb)).toBe('|pad');
    expect(noteSuffix('organ', { prog: 49 }, spb)).toBe('|pad');
    expect(noteSuffix('organ', { prog: 19 }, spb)).toBe('');
    expect(noteSuffix('dulcimer', { prog: 4 }, spb)).toBe(':e');
    expect(noteSuffix('dulcimer', { prog: 0 }, spb)).toBe('');
    for (const k of ['horns', 'bowwheel', 'marimba', 'bass']) expect(noteSuffix(k, { prog: 61, dur: .1 }, spb)).toBe('');
    expect(strumParse('E3|n').variant).toBe('n');
    expect(organParse('C4|choir').timbre).toBe('choir');
    expect(dulcimerParse('C4:e').ep).toBe(true);
  });
  it('a pre-ROLLED MIDI strum (its strings spread over the 1/12-beat grid) stays one strum on the autoharp', () => {
    // 8th-note strums at 140 bpm (.21 s), each chord rolled over two 1/12-beat grid cells (36 ms ≤ chordEps)
    const rolled = Array.from({ length: 16 }, (_, i) => [52, 56, 59].map((m, k) => [i * .5 + (k ? 1 / 12 : 0), m, .4])).flat();
    const r = shapePart('strum', rolled.map(([beat, midi]) => ({ beat, midi, vel: .8, dur: .4, prog: 25 })), { bpm: 140, loopBeats: 8 });
    expect(r.warnings.filter(w => /thinned/.test(w))).toEqual([]);
    expect(r.part.length).toBe(48);
  });
  it('end to end: a nylon strummer, a choir and a Rhodes import with their voices', () => {
    const chords = (base, n, step, len) => Array.from({ length: n }, (_, i) => [i * step, base + i % 2, len]).flatMap(([b, m, l]) => [[b, m, l], [b, m + 4, l], [b, m + 7, l]]);
    const { song } = convert(file(trk('Lead', 73, 0, tune(79, 16)),
      trk('Nylon', 24, 1, chords(52, 16, 1, 1)),
      trk('Choir', 52, 2, Array.from({ length: 4 }, (_, i) => [0, 3, 7, 10, 14].map(d => [i * 4, 50 + 2 * i + d, 4])).flat()),
      trk('Rhodes', 4, 3, chords(57, 8, 2, 2))));
    expect(song.parts.strum.every(e => e[1].endsWith('|n'))).toBe(true);
    expect(song.parts.organ.every(e => e[1].endsWith('|choir'))).toBe(true);
    expect(song.parts.dulcimer.every(e => e[1].endsWith(':e'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('the bar grid follows METER CHANGES', () => {
  const sigs = (...ms) => { let t = 0; return ms.map(([n, d, bars = 1]) => { const e = { tick: t, num: n, den: d }; t += bars * n * 4 / d * PPQ; return e; }); };
  it('walkMeter: 4/4 + 5/8 cycles → bar lines at 0 4 8 12 14.5 18.5 …', () => {
    const map = sigs([4, 4, 3], [5, 8], [4, 4, 3], [5, 8]);
    expect(walkMeter(map, PPQ, 28 * PPQ).slice(0, 9)).toEqual([0, 4, 8, 12, 14.5, 18.5, 22.5, 26.5, 29]);
  });
  it('a mid-bar meter change starts a new bar there; before the first time signature it is 4/4', () => {
    expect(walkMeter([{ tick: 6 * PPQ, num: 3, den: 4 }], PPQ, 12 * PPQ)).toEqual([0, 4, 6, 9, 12, 15]);
  });
  it('barGrid: a moving meter map gets walked bar lines; a 4/4 count-in before 6/8 keeps the uniform grid', () => {
    const g = barGrid(sigs([4, 4, 3], [5, 8], [4, 4, 3], [5, 8], [4, 4, 3], [5, 8]), PPQ, 40 * PPQ);
    expect(g.barBeats).toBe(4);
    expect(g.starts.slice(0, 5)).toEqual([0, 4, 8, 12, 14.5]);
    expect(barAt(g, 14.4)).toBe(3); expect(barAt(g, 14.5)).toBe(4); expect(barStart(g, 4)).toBe(14.5);
    const u = barGrid([{ tick: 0, num: 4, den: 4 }, { tick: 4 * PPQ, num: 6, den: 8 }], PPQ, 400 * PPQ);
    expect(u.starts).toBe(null); expect(u.origin).toBeCloseTo(1, 9);
    expect(barAt(u, 4)).toBe(1); expect(barStart(u, 1)).toBeCloseTo(4, 9);
  });
  it('fingerprints line up: every riff cycle matches the next on the walked grid, not on a uniform one', () => {
    const { bytes } = chug();
    const p = parseMidi(bytes), lead = [];
    const g = barGrid(p.timeSigs, PPQ, 200 * PPQ);
    for (const tr of p.tracks) for (const n of tr.notes) if (tr.name === 'Guitar 1') lead.push({ beat: n.tick / PPQ, midi: n.midi, vel: .8, dur: .4, kind: 'lead' });
    const walked = barFeatures(lead, { barBeats: 4, starts: g.starts, nBars: 32 });
    const uniform = barFeatures(lead, { barBeats: 4, nBars: 32 });
    // bars 0..3 are cycle 1, bars 4..7 cycle 2 — the same riff
    const mean = F => [0, 1, 2, 3].reduce((s, k) => s + barSim(F[k], F[k + 4]), 0) / 4;
    expect(mean(walked)).toBeGreaterThan(.99);
    expect(mean(uniform)).toBeLessThan(.9);
  });
});

describe('tempo-aware windows', () => {
  it('tempoClock integrates the tempo map (one tempo → beat·60/bpm)', () => {
    expect(tempoClock(null, 120)(8)).toBe(4);
    const c = tempoClock([{ beat: 0, bpm: 220 }, { beat: 22, bpm: 110 }, { beat: 44, bpm: 220 }], 220);
    expect(c(22)).toBeCloseTo(6, 9); expect(c(44)).toBeCloseTo(18, 9); expect(c(66)).toBeCloseTo(24, 9);
  });
  const flat = (bpm, nBars) => {
    const ev = [];
    for (let b = 0; b < nBars; b++) for (let q = 0; q < 4; q++) ev.push({ beat: b * 4 + q, midi: 60 + ((b % 8) + q) % 7, vel: .8, dur: 1, kind: 'lead' });
    const F = barFeatures(ev, { barBeats: 4 });
    return scoreWindows(F, selfSimilarity(F), { barBeats: 4, bpm });
  };
  it('at 120 bpm the sweet spot is unchanged: a 16-bar (32 s) window scores len = 1 − .25·18/25', () => {
    const w = flat(120, 96).find(c => c.bars === 16);
    expect(w.terms.len).toBeCloseTo(1 - .25 * 18 / 25, 9);
  });
  it('at 220 bpm a 32-bar riff (35 s) is the ideal length (the old curve wanted 50 s = 46 bars)', () => {
    const all = flat(220, 200);
    const w32 = all.find(c => c.bars === 32), w24 = all.find(c => c.bars === 24);
    expect(w32.terms.len).toBeCloseTo(1, 9);                                    // was 1 − .25·(50 − 34.9)/25 = .85
    expect(w24.terms.len).toBeGreaterThan(.9);                                  // 24 bars = 26 s: was (26.2/30)² = .76
  });
});

// ---------------------------------------------------------------------------
describe('THE CHUG (a 220-bpm riff song in 4/4 + 5/8, half-tempo clean interlude) imports its riff', () => {
  const { bytes, sections } = chug();
  const r = convert(bytes);
  const I = sections.find(s => s.name === 'I');
  it('loops a RIFF section at 220 bpm (not the 110-bpm interlude), on the walked bar lines', () => {
    expect(r.phrase).toBeTruthy();
    expect(r.phrase.bpm).toBe(220);
    expect(r.phrase.endBeat <= I.b0 + 1e-9 || r.phrase.startBeat >= I.b1 - 1e-9).toBe(true);
    expect(sum(r.song.melody)).toBeCloseTo(r.phrase.endBeat - r.phrase.startBeat, 9);   // the loop IS its bars (5/8 = 2.5 beats)
    expect(r.phrase.barLines.length).toBe(r.phrase.bars + 1);
    for (const k of ['alto', 'bass']) if (r.song[k]) expect(r.song[k].delay + sum(r.song[k].notes)).toBeCloseTo(sum(r.song.melody), 9);
  });
  it('the vocals lead, the RIFF FORGE plays the power chords as palm-muted chugs, the L/R bass is ONE string bass', () => {
    // (was: every voice a belt voice by program, the riff a belt line on its roots, the bass a belt — before
    // the Riff Forge: a distortion guitar's power chords are its machine's native shape, chords and all)
    const w = r.warnings.join('\n');
    expect(r.song.melody.every(([n]) => [64, 67, 69, 71].includes(noteNum(n)))).toBe(true);
    expect(w).toMatch(/bass: "Bass \(right\)" doubles "Bass \(left\)" — merged/);
    expect(w).toMatch(/"Bass \(left\)" plays as a bass by its name/);
    expect(w).not.toMatch(/routed by musical role/);
    expect(r.song.alto).toBeUndefined(); expect(r.song.bass).toBeUndefined();     // the belt is the singer's alone
    const riff = r.song.parts.riff, rootPcs = new Set(ROOTS.map(m => m % 12));
    // every hit is a POWER CHORD on a riff root (root + fifth [+ octave]) …
    const byBeat = new Map();
    for (const [b, n] of riff){ if (!byBeat.has(b)) byBeat.set(b, []); byBeat.get(b).push(noteNum(n.split(':')[0])); }
    for (const ms of byBeat.values()){
      expect(isPowerChord(ms) || ms.length === 1).toBe(true);
      expect(rootPcs.has(Math.min(...ms) % 12)).toBe(true);
    }
    expect([...byBeat.values()].filter(ms => ms.length >= 2).length).toBeGreaterThan(.9 * byBeat.size);
    // … palm-muted (a .4-beat note at 220 bpm is .11 s < RIFF_MUTE_SEC), with its length for the hook lift
    expect(riff.every(e => e[1].endsWith(':m') && e[3] > 0)).toBe(true);
    // the bass: one string-bass voice on the roots (its pedal repeats thinned to the .15 s string gap)
    expect(r.song.parts.bass.every(e => rootPcs.has(pc(e[1])))).toBe(true);
  });
  it('without names the guitar leads — and the loop is still a riff section, not the interlude', () => {
    const x = convert(chug({ names: false }).bytes);
    expect(x.phrase.bpm).toBe(220);
    expect(x.phrase.endBeat <= I.b0 + 1e-9 || x.phrase.startBeat >= I.b1 - 1e-9).toBe(true);
    const rootPcs = new Set(ROOTS.map(m => m % 12));
    expect(x.song.melody.every(([n]) => rootPcs.has(pc(n)))).toBe(true);
  });
});
