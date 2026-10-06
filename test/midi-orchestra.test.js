import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseMidi } from '../src/midi/parse.js';
import { convertToSong } from '../src/midi/convert.js';
import { routeProgram, shapePart, orchestrate, polyphony, twinsFor, PART_SPEC, PICKUP_BEATS, GM_NAMES,
         ROLL_T as ORCH_ROLL_T, MB_MIN_ANGLE, MB_TWINS } from '../src/midi/orchestra.js';
import { buildMidi } from './helpers/midi-builder.js';
import { FIXTURES, GOLDEN_INPUTS } from './helpers/midi-fixtures.js';
import GOLDEN from './fixtures/midi-golden-a69c84a.json';
import { INSTRUMENTS } from '../src/instruments/index.js';
import { eventTimes, lanesByNote } from '../src/instruments/clock.js';
import { ROLL_T, noteNum } from '../src/engine.js';
import { solve as marimbaSolve, keyboard as marimbaKeyboard, malletAt as marimbaMallet } from '../src/instruments/marimba/solve.js';
import { buildRecord, ballAt as ttBall } from '../src/instruments/turntable/solve.js';
import { buildOrbit, marbleAt as ricoMarble } from '../src/instruments/ricochet/solve.js';
import { bellLane, bellAt } from '../src/instruments/bells/solve.js';
import { solveLane, poseAt } from '../src/instruments/bass/solve.js';
import { bowlGeom, bowlLane, bowlAt } from '../src/instruments/bowls/solve.js';
import { buildComb, tineAt, splitTwins, GEOM } from '../src/instruments/musicbox/solve.js';
import { solveLane as bassSolve, TC, E as BASS_E, V_MIN, winchT } from '../src/instruments/bass/solve.js';

const NOTE_RE = /^[A-G]#?\d$/;
const PPQ = 480;
const sumBeats = notes => notes.reduce((s, [, b]) => s + b, 0);
const convert = (bytes, opts) => convertToSong(parseMidi(bytes), opts);

/** one format-1 track: a name, an optional program on `ch`, and [beat, midi, lenBeats, vel?] notes */
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
const scale8 = (base, n = 8, step = 1) => Array.from({ length: n }, (_, i) => [i * step, base + [0, 2, 4, 5, 7, 9, 11, 12][i % 8]]);

// ---------------------------------------------------------------------------
// parse: programs + durations survive
// ---------------------------------------------------------------------------
describe('parseMidi — program + duration', () => {
  it('stamps each note with the program in effect on its channel', () => {
    const bytes = file({ events: [
      { tick: 0, type: 'pc', program: 12, channel: 1 },
      { tick: 0, type: 'on', note: 60, vel: 90, channel: 1 },
      { tick: 0, type: 'on', note: 64, vel: 90, channel: 2 },              // channel with no pc → 0
      { tick: 960, type: 'pc', program: 14, channel: 1 },
      { tick: 960, type: 'on', note: 62, vel: 90, channel: 1 },
    ] });
    const { tracks, hasPrograms } = parseMidi(bytes);
    const ns = tracks[0].notes;
    expect(hasPrograms).toBe(true);
    expect(ns.find(n => n.midi === 60).program).toBe(12);
    expect(ns.find(n => n.midi === 62).program).toBe(14);
    expect(ns.find(n => n.midi === 64).program).toBe(0);
  });

  it('channel program state is global across format-1 tracks (it is one synth)', () => {
    const bytes = file(
      { events: [{ tick: 0, type: 'pc', program: 33, channel: 3 }] },
      { events: [{ tick: 0, type: 'on', note: 40, vel: 90, channel: 3 }] },
    );
    const { tracks } = parseMidi(bytes);
    expect(tracks[0].notes[0].program).toBe(33);
  });

  it('a program change arriving after the channel\'s first note still names it', () => {
    const bytes = file({ events: [
      { tick: 0, type: 'on', note: 60, vel: 90, channel: 0 },
      { tick: 5, type: 'pc', program: 11, channel: 0 },
    ] });
    expect(parseMidi(bytes).tracks[0].notes[0].program).toBe(11);
  });

  it('measures duration from note-off (0x8) and from note-on vel 0; unreleased → null', () => {
    const bytes = file(
      { events: [
        { tick: 0, type: 'on', note: 60, vel: 90 }, { tick: 480, type: 'off', note: 60 },
        { tick: 480, type: 'on', note: 62, vel: 90 }, { tick: 1440, type: 'vel0', note: 62 },
        { tick: 1440, type: 'on', note: 64, vel: 90 },
      ] },
    );
    const ns = parseMidi(bytes).tracks[0].notes;
    expect(ns.map(n => n.dur)).toEqual([480, 960, null]);
  });

  it('overlapping same-key notes release first-in-first-out', () => {
    const bytes = file({ events: [
      { tick: 0, type: 'on', note: 60, vel: 90 }, { tick: 100, type: 'on', note: 60, vel: 90 },
      { tick: 200, type: 'off', note: 60 }, { tick: 400, type: 'off', note: 60 },
    ] });
    expect(parseMidi(bytes).tracks[0].notes.map(n => n.dur)).toEqual([200, 300]);
  });

  it('hasPrograms is false without program changes, and ignores percussion-channel kit changes', () => {
    expect(parseMidi(file(trk('x', null, 0, [[0, 60]]))).hasPrograms).toBe(false);
    expect(parseMidi(file(trk('x', null, 0, [[0, 60]]), trk('d', 0, 9, [[0, 36]]))).hasPrograms).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// routing table
// ---------------------------------------------------------------------------
describe('routeProgram — GM program → room instrument', () => {
  const cases = {
    musicbox: [8, 9, 10, 98, 108, 112],
    marimba: [11, 12, 13, 15, 45, 46, 113, 114, 115],
    bells: [14],
    bass: [32, 33, 34, 35, 36, 37, 38, 39, 43, 47],
    bowls: [88, 89, 90, 91, 92, 93, 94, 95, 96, 99],
    sustain: [16, 19, 20, 40, 41, 42, 44, 48, 49, 50, 52, 53],
    belt: [0, 1, 4, 6, 21, 22, 23, 24, 25, 30, 56, 60, 65, 68, 73, 80, 81, 104, 107, 110],   // 21–23: accordion / harmonica = reed melody
  };
  for (const [dest, progs] of Object.entries(cases)){
    it(`${dest} ← ${progs.join(', ')}`, () => { for (const p of progs) expect(routeProgram(p), `${p} ${GM_NAMES[p]}`).toBe(dest); });
  }
  it('sound effects have no home (dropped)', () => { for (const p of [119, 120, 121, 125, 127]) expect(routeProgram(p)).toBeNull(); });
  it('every program routes to a known destination', () => {
    const ok = new Set([...Object.keys(PART_SPEC), 'belt', 'sustain', null]);
    for (let p = 0; p < 128; p++) expect(ok.has(routeProgram(p)), `program ${p}`).toBe(true);
    expect(GM_NAMES.length).toBe(128);
  });
});

// ---------------------------------------------------------------------------
// convert — orchestra routing
// ---------------------------------------------------------------------------
describe('convertToSong — legacy behaviour without program changes', () => {
  // GOLDEN: the classic importer's own output (a69c84a, before the orchestra existed),
  // regenerated only by scripts/make-midi-golden.mjs — never by the code under test.
  // A program-less file now routes by ROLE by default (the room plays — see 'role routing'
  // below), so the classic output is pinned on the legacy path ({ orchestra: false }) that
  // keeps it reachable. piano-solo HAS a program (0) and a single line: the default import
  // must still reproduce it exactly.
  for (const name of Object.keys(GOLDEN_INPUTS)){
    it(`golden "${name}" imports exactly as a69c84a did (song + warnings)`, () => {
      const bytes = GOLDEN_INPUTS[name]();
      const r = convertToSong(parseMidi(bytes), { label: name, ...(parseMidi(bytes).hasPrograms ? {} : { orchestra: false }) });
      expect(r.song).toEqual(GOLDEN[name].song);
      expect(r.warnings).toEqual(GOLDEN[name].warnings);
    });
  }
  it('the golden files really exercise the seam: they end on a short last note', () => {
    expect(GOLDEN['piano-solo'].song.melody.at(-1)[1]).toBeGreaterThanOrEqual(1);   // the loop keeps its breath
    expect(GOLDEN['sketch-trio'].song.drums).toBeDefined();
  });

  it('a file with no program changes: legacy = the classic belts; default = routed by role', () => {
    // (was: "imports as the classic belts" — the room stood empty for every program-less file,
    // e.g. Owl City 'Fireflies'. Now the sustained chords sing on the bowls; legacy still reachable.)
    const bytes = file(trk('a', null, 0, scale8(72)), trk('b', null, 1, [[0, 48, 4], [0, 52, 4], [4, 50, 4], [4, 53, 4]]));
    const a = convert(bytes, { orchestra: false });
    expect(a.song.parts).toBeUndefined();
    expect(a.song.bass).toBeDefined();                       // chordal track stays a (top-note) belt
    const b = convert(bytes);
    expect(b.song.parts.bowls.length).toBe(4);               // 2 s chords: a sustained bed
    expect(b.song.bass).toBeUndefined();
    expect(b.song.melody[0][0]).toBe('C5');
    expect(convert(bytes, { route: 'legacy' }).song).toEqual(a.song);
  });

  it('opts.orchestra forces routing on for a program-less (all-piano) file', () => {
    const bytes = file(trk('a', null, 0, scale8(72)), trk('b', null, 1, [[0, 48, 4], [0, 52, 4], [4, 50, 4], [4, 53, 4]]));
    const { song } = convert(bytes, { orchestra: true });
    expect(song.parts?.marimba?.length).toBeGreaterThan(0);  // the chordal piano goes to the marimba
    expect(song.bass).toBeUndefined();
  });
});

describe('convertToSong — orchestra routing', () => {
  it('routes each GM family to its machine; the piano stays the belt lead', () => {
    const { song, warnings } = convert(file(
      trk('Piano', 0, 0, scale8(72)),
      trk('Marimba', 12, 1, scale8(60, 8, .5)),
      trk('Bells', 14, 2, [[0, 67, 2], [4, 72, 2]]),
      trk('Bass', 33, 3, scale8(40)),
      trk('Pad', 89, 4, [[0, 60, 4], [0, 64, 4], [0, 67, 4], [4, 62, 4], [4, 65, 4], [4, 69, 4]]),
      trk('Celesta', 8, 5, [[1, 84], [3, 88]]),
    ));
    expect(song.melody.map(n => n[0]).slice(0, 3)).toEqual(['C5', 'D5', 'E5']);
    expect(Object.keys(song.parts).sort()).toEqual(['bass', 'bells', 'bowls', 'marimba', 'musicbox']);
    expect(song.alto).toBeUndefined(); expect(song.bass).toBeUndefined();
    expect(song.sub).toMatch(/marimba/);
    expect(warnings.every(w => typeof w === 'string')).toBe(true);
  });

  it('strings: a chordal ensemble is a bowls bed, a single moving line is a melody (belt)', () => {
    const { song } = convert(file(
      trk('Violin', 40, 0, scale8(76, 8, .5).map(([b, m]) => [b, m, .5])),
      trk('Ensemble', 48, 1, [[0, 55, 4], [0, 59, 4], [0, 62, 4], [4, 57, 4], [4, 60, 4], [4, 64, 4]]),
    ));
    expect(song.melody[0][0]).toBe('E5');                   // the violin leads the belt
    expect(song.parts.bowls.length).toBe(6);
    expect(song.parts.bowls.every(e => e.length === 4 && e[3] > 0)).toBe(true);   // sustained: durations kept
  });

  it('a chordal non-lead belt voice moves to the marimba; overflow beyond 3 belts too', () => {
    const { song, warnings } = convert(file(
      trk('Lead', 0, 0, scale8(76)),
      trk('Comp', 0, 1, [[0, 60], [0, 64], [1, 62], [1, 65], [2, 64], [2, 67], [3, 62], [3, 65]]),
      trk('Alto', 0, 2, scale8(64)),
      trk('Low', 0, 3, scale8(48)),
      trk('Extra', 0, 4, scale8(55, 4)),
    ));
    expect(song.alto).toBeDefined(); expect(song.bass).toBeDefined();
    expect(warnings.some(w => /"Comp" .*plays on the marimba \(chordal/.test(w))).toBe(true);
    // a spare melodic LINE no longer dumps on the marimba: it finds the free turntable (#9)
    expect(warnings.some(w => /"Extra" .*plays on the turntable \(a spare melodic line/.test(w))).toBe(true);
    expect(song.parts.turntable.length).toBe(4);
    const mar = song.parts.marimba.map(e => e[0]);
    expect(mar.filter(b => b === 0).length).toBeGreaterThanOrEqual(2);              // chords survive
  });

  it('sound-effect programs are dropped with a warning', () => {
    const { song, warnings } = convert(file(trk('Lead', 0, 0, scale8(72)), trk('Copter', 125, 1, scale8(60))));
    expect(song.parts).toBeUndefined();
    expect(warnings.some(w => /Copter.*Helicopter/.test(w))).toBe(true);
  });

  it('no piano/lead voice: the belt lead doubles the earliest melodic machine voice', () => {
    const { song, warnings } = convert(file(
      trk('Pad', 89, 1, [[0, 60, 4], [0, 64, 4], [0, 67, 4]]),
      trk('Vibes', 11, 0, scale8(72)),
      trk('Glock', 9, 2, [[4, 84], [5, 86]]),
    ));
    expect(warnings.some(w => /doubles the top line of "Vibes"/.test(w))).toBe(true);
    expect(song.melody.length).toBe(8);
    expect(song.parts.marimba.length).toBe(8);               // vibes still play their own machine
  });

  it('a track that switches program mid-way is two players', () => {
    const t = trk('Switch', 12, 1, [[0, 60], [1, 62]]);
    t.events.push({ tick: 2 * PPQ - 1, type: 'pc', program: 14, channel: 1 });
    t.events.push({ tick: 2 * PPQ, type: 'on', note: 67, vel: 90, channel: 1 }, { tick: 3 * PPQ, type: 'off', note: 67, channel: 1 });
    const { song } = convert(file(trk('Lead', 0, 0, scale8(72)), t));
    expect(song.parts.marimba.length).toBe(2);
    expect(song.parts.bells.length).toBe(1);
  });

  it('loop length covers plugin notes; pickups within a bar wrap to the tail, earlier ones drop', () => {
    const { song, warnings } = convert(file(
      trk('Lead', 0, 0, [[8, 72], [9, 74]]),
      trk('Mar', 12, 1, [[7, 60], [2, 64], [13, 67]]),       // a pickup, an early intro note, a late note
    ));
    const loop = sumBeats(song.melody);
    expect(loop).toBe(8);                                   // the late note (beat 5 after the lead) fits in 8
    const beats = song.parts.marimba.map(e => e[0]);
    expect(beats).toContain(7);                             // −1 → loop tail
    expect(beats).toContain(5);
    expect(beats.length).toBe(2);
    expect(warnings.some(w => /marimba: dropped 1 note more than 4 beats before the lead/.test(w))).toBe(true);
  });

  it('the belt lock rule still holds in orchestra mode', () => {
    const { song } = convert(FIXTURES['canon-in-d']());
    const total = sumBeats(song.melody);
    for (const r of ['alto', 'bass']) if (song[r]) expect(sumBeats(song[r].notes) + song[r].delay).toBeCloseTo(total, 9);
  });
});

// ---------------------------------------------------------------------------
// shapePart — each machine's limits are honoured
// ---------------------------------------------------------------------------
describe('shapePart — honouring each machine', () => {
  const N = (beat, midi, vel = .8, dur = null) => ({ beat, midi, vel, dur });
  const spread = Array.from({ length: 48 }, (_, i) => N(i * .5, 24 + i * 2));        // 4 octaves+ of pitches

  for (const key of Object.keys(PART_SPEC)){
    it(`${key}: every note in range, ≤ ${PART_SPEC[key].pitches} pitches, ≤ ${PART_SPEC[key].poly} per onset`, () => {
      const S = PART_SPEC[key];
      const chords = Array.from({ length: 8 }, (_, i) => [0, 3, 7, 10, 14, 17, 21].map(x => N(30 + i * 2, 48 + i + x)));
      const { part } = shapePart(key, [...spread, ...chords.flat()], { bpm: 100, loopBeats: 48 });
      expect(part.length).toBeGreaterThan(0);
      const ms = part.map(e => noteNum(e[1]));
      for (const m of ms){ expect(m).toBeGreaterThanOrEqual(S.lo); expect(m).toBeLessThanOrEqual(S.hi); }
      expect(new Set(ms).size).toBeLessThanOrEqual(S.pitches);
      const per = new Map(); for (const e of part) per.set(e[0], (per.get(e[0]) || 0) + 1);
      for (const c of per.values()) expect(c).toBeLessThanOrEqual(S.poly);
      for (const e of part){
        expect(e[1]).toMatch(NOTE_RE);
        expect(e[0]).toBeGreaterThanOrEqual(0); expect(e[0]).toBeLessThan(48);
        expect(e[2]).toBeGreaterThan(0); expect(e[2]).toBeLessThanOrEqual(1);
      }
    });
  }

  it('transposes the whole part by octaves toward the machine centre (intervals kept)', () => {
    const { part, warnings } = shapePart('musicbox', [N(0, 60), N(1, 64), N(2, 67)], { bpm: 100, loopBeats: 4 });
    expect(part.map(e => e[1])).toEqual(['C6', 'E6', 'G6']);
    expect(warnings.some(w => /shifted 2 octaves up/.test(w))).toBe(true);
  });

  it('string bass: ≤ 8 strings, the most-used kept, the rest folded by octave (pitch class kept)', () => {
    const notes = [];
    for (let i = 0; i < 9; i++) for (let k = 0; k < 9 - i; k++) notes.push(N(notes.length, 28 + i));   // E1.. (most-used low)
    notes.push(N(notes.length, 28 + 12), N(notes.length + 1, 30 + 12));                             // E2, F#2 have twins
    const { part, warnings } = shapePart('bass', notes, { bpm: 120, loopBeats: 64 });
    const pcs = new Set(part.map(e => noteNum(e[1])));
    expect(pcs.size).toBeLessThanOrEqual(8);
    expect(part.length).toBe(notes.length - 1);              // only the 9th pitch (no twin) is lost
    const kept = [...pcs];
    const e2 = noteNum(part.find(e => e[0] === notes.length - 2)[1]);   // E2 (after the part's octave shift)…
    expect(kept).toContain(e2);                                         // …lands on a kept string…
    expect(e2 % 12).toBe(4);                                            // …that is still an E
    expect(warnings.some(w => /pitches > 8 strings/.test(w))).toBe(true);
  });

  it('bowls: durations in [.3, 5] s, never more than 4 singing at once', () => {
    const bpm = 60;
    const notes = [];
    for (let k = 0; k < 4; k++) for (const x of [0, 4, 7, 11, 14, 17]) notes.push(N(k * 2, 48 + x, .6, 8));   // 6-voice, 8-beat chords every 2 beats
    notes.push(N(9, 60, .5, null), N(9.25, 67, .5, .05));
    const { part } = shapePart('bowls', notes, { bpm, loopBeats: 16 });
    for (const e of part){ expect(e[3] * 60 / bpm).toBeLessThanOrEqual(5 + 1e-9); expect(e[3] * 60 / bpm).toBeGreaterThanOrEqual(.3 - 1e-9); }
    for (let t = 0; t < 16; t += 1 / 12){
      const sounding = part.filter(e => e[0] <= t + 1e-9 && t < e[0] + e[3] - 1e-9).length;
      expect(sounding, `t=${t}`).toBeLessThanOrEqual(4);
    }
  });

  it('bells: a dense run is thinned (≥ .2 s between onsets, ≥ .36 s per tube)', () => {
    const run = Array.from({ length: 32 }, (_, i) => N(i * .25, 60 + (i % 5) * 2));     // 16ths @ 120 = .125 s
    const { part, warnings } = shapePart('bells', run, { bpm: 120, loopBeats: 8 });
    const spb = .5;
    const onsets = [...new Set(part.map(e => e[0]))];
    for (let i = 1; i < onsets.length; i++) expect((onsets[i] - onsets[i - 1]) * spb).toBeGreaterThanOrEqual(.2 - 1e-9);
    const byNote = lanesByNote(part.map(e => ({ beat: e[0], note: e[1] })));
    for (const evs of Object.values(byNote)) for (let i = 1; i < evs.length; i++) expect((evs[i].beat - evs[i - 1].beat) * spb).toBeGreaterThanOrEqual(.36 - 1e-9);
    expect(part.length).toBeLessThan(run.length);
    expect(warnings.some(w => /bells: thinned/.test(w))).toBe(true);
  });

  it('pickups: within PICKUP_BEATS wrap to the tail; earlier dropped', () => {
    const { part } = shapePart('marimba', [N(-1, 60), N(-PICKUP_BEATS - 1, 62), N(0, 64)], { bpm: 100, loopBeats: 8 });
    expect(part.map(e => e[0]).sort((a, b) => a - b)).toEqual([0, 7]);
  });
});

// ---------------------------------------------------------------------------
// the fixtures: whole-room files convert, validate, and SOLVE on every machine
// ---------------------------------------------------------------------------
// NaN is a legit "undefined" for a few fields (bowls: phiBall while the marble isn't orbiting)
const NAN_OK = new Set(['phiBall']);
const finiteDeep = (o, where) => {
  if (NAN_OK.has(where.split('.').pop())) return;
  if (typeof o === 'number'){ if (!Number.isFinite(o) && o !== Infinity && o !== -Infinity) throw new Error(`NaN at ${where}`); return; }
  if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) if (typeof v !== 'function') finiteDeep(v, `${where}.${k}`);
};

describe.each(Object.keys(FIXTURES))('fixture "%s"', name => {
  const bytes = FIXTURES[name]();
  const { song, warnings } = convertToSong(parseMidi(bytes), { label: name });
  const loop = sumBeats(song.melody);
  const beat = 60 / song.bpm, P = ROLL_T + loop * beat, start = -2.4;

  it('public/midi copy matches the composer (run scripts/make-midi-fixtures.mjs)', () => {
    const disk = fs.readFileSync(path.join(__dirname, '..', 'public', 'midi', `${name}.mid`));
    expect(Buffer.compare(disk, Buffer.from(bytes))).toBe(0);
  });

  it('converts with parts on registered instruments, every event inside the contract', () => {
    expect(song.parts).toBeDefined();
    expect(loop % 4).toBe(0);
    for (const [k, part] of Object.entries(song.parts)){
      expect(INSTRUMENTS.some(I => I.key === k), k).toBe(true);
      for (const e of part){
        expect(e[0]).toBeGreaterThanOrEqual(0); expect(e[0]).toBeLessThan(loop);
        expect(e[1]).toMatch(NOTE_RE);
        expect(e[2]).toBeGreaterThan(0); expect(e[2]).toBeLessThanOrEqual(1);
      }
    }
    for (const r of ['alto', 'bass']) if (song[r]) expect(sumBeats(song[r].notes) + song[r].delay).toBeCloseTo(loop, 9);
    expect(Array.isArray(warnings)).toBe(true);
  });

  it('every part solves on its real machine (no NaN through a whole loop)', () => {
    const P_ = song.parts;
    const ts = Array.from({ length: 160 }, (_, i) => start + i * (P + 3) / 160);
    if (P_.marimba){
      const ev = eventTimes(P_.marimba, { rollT: ROLL_T, beat });
      const plan = marimbaSolve(ev, { P, start, kb: marimbaKeyboard(ev.map(e => e.note), { width: 11.2, x0: -.35 }) });
      for (let k = 0; k < 4; k++) for (const t of ts) finiteDeep(marimbaMallet(plan, k, t), `marimba mallet ${k}`);
    }
    if (P_.bells){
      for (const [n, evs] of Object.entries(lanesByNote(eventTimes(P_.bells, { rollT: ROLL_T, beat })))){
        const lane = bellLane(evs.map(e => e.t), evs.map(e => e.vel), P);
        for (const t of ts) finiteDeep(bellAt(lane, t, start), `bells ${n}`);
      }
    }
    if (P_.bass){
      const byNote = lanesByNote(eventTimes(P_.bass, { rollT: ROLL_T, beat }));
      expect(Object.keys(byNote).length).toBeLessThanOrEqual(8);
      for (const [n, evs] of Object.entries(byNote)){
        const S = solveLane(evs.map(e => e.t), P);
        for (const t of ts) finiteDeep(poseAt(S, t, start), `bass ${n}`);
      }
    }
    if (P_.bowls){
      const byNote = lanesByNote(eventTimes(P_.bowls, { rollT: ROLL_T, beat }));
      expect(Object.keys(byNote).length).toBeLessThanOrEqual(8);
      for (const [n, evs] of Object.entries(byNote)){
        const L = bowlLane(evs.map(e => ({ t: e.t, tDur: e.tDur, vel: e.vel })), P, bowlGeom(n));
        for (const t of ts) finiteDeep(bowlAt(L, t, start), `bowls ${n}`);
      }
    }
    if (P_.musicbox){
      const { lanes, omega } = buildComb(P_.musicbox, { rollT: ROLL_T, beat, P });
      for (const l of lanes) for (const t of ts) finiteDeep(tineAt(l, t, start, omega), `musicbox ${l.note}`);
    }
    if (P_.turntable){
      const rec = buildRecord(P_.turntable, { rollT: ROLL_T, beat, P, start });
      expect(rec.ok).toBe(true);                             // every deployed pad pair clears
      for (const t of ts) finiteDeep(ttBall(rec, t), 'turntable ball');
    }
    if (P_.ricochet){
      const orb = buildOrbit(eventTimes(P_.ricochet, { rollT: ROLL_T, beat }), { P, start });
      for (const t of ts) finiteDeep(ricoMarble(orb, t), 'ricochet marble');
    }
  });
});

describe('fixture specifics', () => {
  it('room tour lights up every station + the drums', () => {
    const { song } = convertToSong(parseMidi(FIXTURES['room-tour']()));
    expect(Object.keys(song.parts).sort()).toEqual(['bass', 'bells', 'bowls', 'marimba', 'musicbox']);
    expect(Object.keys(song.drums)).toEqual(expect.arrayContaining(['kick', 'snare', 'hat', 'crash']));
    expect(sumBeats(song.melody)).toBe(64);
  });

  it('canon: a TRIPLE canon on three belts (Violin I leads, II two bars behind, III four), the ground on the string bass', () => {
    const { song, warnings } = convertToSong(parseMidi(FIXTURES['canon-in-d']()));
    expect(song.melody.slice(0, 4).map(n => n[0])).toEqual(['F#5', 'E5', 'D5', 'C#5']);
    expect(song.alto.delay).toBe(8);
    expect(song.bass.delay).toBe(16);
    expect(song.alto.notes.slice(0, 4).map(n => n[0])).toEqual(['F#5', 'E5', 'D5', 'C#5']);   // the SAME tune, chasing
    expect(song.bass.notes.slice(0, 4).map(n => n[0])).toEqual(['F#5', 'E5', 'D5', 'C#5']);
    expect(song.parts.bass.slice(0, 4).map(e => e[1])).toEqual(['D3', 'A2', 'B2', 'F#2']);
    expect(sumBeats(song.melody)).toBe(52);                // six turns + the cadence bar
    expect(song.melody.at(-1)).toEqual(['D6', 4]);         // the lead lands on D and takes the tallest arc home
    for (const k of ['marimba', 'bells', 'bass', 'bowls']) expect(song.parts[k].some(e => e[0] === 48), k).toBe(true);
    expect(warnings.filter(w => /dropped|thinned/.test(w))).toEqual([]);   // nothing lost
  });

  it('night mallets (format 0, no lead program): the vibraphone is doubled on the belt', () => {
    const { song, warnings } = convertToSong(parseMidi(FIXTURES['night-mallets']()));
    expect(warnings.some(w => /doubles the top line of "Vibraphone"/.test(w))).toBe(true);
    expect(song.parts.marimba.length).toBeGreaterThan(0);
  });
});

describe('orchestrate — direct', () => {
  it('splits voices by program and names format-0 channels by instrument', () => {
    const notes = [{ midi: 60, tick: 0, channel: 0, vel: 90, dur: 480, program: 12 }];
    const r = orchestrate([{ name: 'ch0', notes }], { ppq: 480, bpm: 100 });
    expect(r.parts[0].name).toBe('Marimba');
    expect(r.belt.length).toBe(1);                          // promoted spine
  });
});

// ---------------------------------------------------------------------------
// polish: lead choice, overflow, harmony coverage, loop-aware machines
// ---------------------------------------------------------------------------
describe('the lead must enter early and last (Star Wars / Piano Man regressions)', () => {
  // a chordal brass section carries the tune from beat 0; a sparse, high flute enters late
  const brass = trk('Brass', 61, 0, Array.from({ length: 48 }, (_, i) => [i, [67, 72, 74, 79][i % 4], 1]).flatMap(([b, m]) => [[b, m], [b, m - 4]]));
  const horn = trk('Horn', 60, 1, Array.from({ length: 40 }, (_, i) => [i + .5, 60 + (i % 3), .5]));
  const flute = trk('Flute', 73, 2, Array.from({ length: 12 }, (_, i) => [24 + i * .5, 88 + (i % 4)]));
  const bass = trk('Bass', 33, 3, Array.from({ length: 12 }, (_, i) => [34 + i, 40]));

  it('a chordal brass lead from beat 0 keeps the lead over a late, high flute; the loop is not shortened', () => {
    const { song } = convert(file(brass, horn, flute, bass));
    expect(song.melody[0][0]).toBe('G4');                 // brass top line
    expect(sumBeats(song.melody)).toBe(48);
    expect(song.parts.bass.length).toBeGreaterThan(0);
  });

  it('an early lead that STOPS halfway loses to one that lasts', () => {
    const early = trk('Choir', 52, 0, Array.from({ length: 16 }, (_, i) => [i * 2, 84, 2]));      // 0..30, high
    const piano = trk('Piano', 0, 1, Array.from({ length: 128 }, (_, i) => [i, 60 + (i % 5)]));   // 0..127
    const { song } = convert(file(early, piano));
    expect(song.melody.length).toBe(128);
  });

  it('harmonica / accordion are melody, not bowls', () => {
    const harm = trk('Harmonica', 22, 1, Array.from({ length: 16 }, (_, i) => [i, 72 + (i % 3)]).flatMap(([b, m]) => [[b, m], ...(b % 4 ? [] : [[b, m - 5]])]));
    const { song } = convert(file(trk('Piano', 0, 0, scale8(76, 16)), harm));
    expect(song.parts?.bowls).toBeUndefined();
    // (was: an alto/bass BELT. Piano + harmonica gives the room nothing by program, so it
    // routes by role and the second melodic line takes the turntable — still a melody machine)
    expect(song.parts?.turntable?.length ?? (song.bass || song.alto)?.notes.length).toBeGreaterThan(0);
    expect(convert(file(trk('Piano', 0, 0, scale8(76, 16)), harm), { route: 'programs' }).song.alto ??
           convert(file(trk('Piano', 0, 0, scale8(76, 16)), harm), { route: 'programs' }).song.bass).toBeDefined();
  });

  it('octave doublings are one line, not chords', () => {
    const q = t => t / 480;
    const oct = Array.from({ length: 16 }, (_, i) => [60 + i % 5, 72 + i % 5].map(m => ({ midi: m, tick: i * 480, dur: 400 }))).flat();
    expect(polyphony(oct, q)).toBe(0);
    const triad = Array.from({ length: 16 }, (_, i) => [60, 64, 67].map(m => ({ midi: m, tick: i * 480, dur: 400 }))).flat();
    expect(polyphony(triad, q)).toBe(1);
  });
});

describe('overflow: the marimba is not a dumping ground', () => {
  it('keeps at most 2 guest (non-mallet) voices, names repeated tracks by channel, routes spare lines by register', () => {
    const chordal = (name, ch, base) => trk(name, 0, ch, Array.from({ length: 16 }, (_, i) => [i, base + i % 3, 1]).flatMap(([b, m]) => [[b, m], [b, m + 4], [b, m + 7]]));
    const { song, warnings } = convert(file(
      trk('Lead', 0, 0, scale8(79, 16)),
      chordal('Piano', 1, 60), chordal('Piano', 2, 55), chordal('Piano', 3, 62),
      trk('Alto', 0, 4, scale8(67, 16)), trk('Tenor', 0, 5, scale8(62, 16)),
      trk('Low line', 0, 6, Array.from({ length: 16 }, (_, i) => [i, 40 + (i % 4)])),
      trk('High line', 0, 7, Array.from({ length: 16 }, (_, i) => [i + .5, 84 + (i % 4)])),
    ));
    expect(warnings.filter(w => /plays on the marimba/.test(w)).length).toBe(2);
    expect(warnings.some(w => /dropped "Piano \(ch\d\)".*marimba already plays/.test(w))).toBe(true);
    expect(song.parts.bass.length).toBe(16);               // the spare LOW line found the free string bass
    expect(song.parts.musicbox.length).toBe(16);           // the spare HIGH line found the free music box
  });

  it('a doubled track merges instead of taking a slot', () => {
    const m = Array.from({ length: 16 }, (_, i) => [i * .5, 60 + (i % 7)]);
    const { song, warnings } = convert(file(trk('Lead', 0, 0, scale8(76, 16)), trk('Mar A', 12, 1, m), trk('Mar B', 12, 2, m)));
    expect(warnings.some(w => /"Mar B" doubles "Mar A"/.test(w))).toBe(true);
    expect(song.parts.marimba.length).toBe(16);
  });

  it('each voice is octave-shaped on its own before merging (a low and a high voice both land in range, intervals kept)', () => {
    const { part } = shapePart('marimba', [
      ...[0, 1, 2].map(b => ({ beat: b, midi: 36 + b * 2, vel: .8, dur: null, voice: 0 })),
      ...[0, 1, 2].map(b => ({ beat: b + .5, midi: 96 + b * 2, vel: .8, dur: null, voice: 1 })),
    ], { bpm: 100, loopBeats: 4 });
    const lo = part.filter(e => e[0] % 1 === 0).map(e => noteNum(e[1])), hi = part.filter(e => e[0] % 1).map(e => noteNum(e[1]));
    expect(lo[1] - lo[0]).toBe(2); expect(hi[1] - hi[0]).toBe(2);
    expect(Math.abs(lo[0] - 66)).toBeLessThan(12); expect(Math.abs(hi[0] - 66)).toBeLessThan(12);
  });
});

describe('pitch caps cover the harmony first', () => {
  // diatonic material over 3 octaves: 15+ distinct pitches, 7 pitch classes
  const diatonic = [];
  const D = [0, 2, 4, 5, 7, 9, 11];
  for (let i = 0; i < 60; i++) diatonic.push({ beat: i * .5, midi: 40 + 12 * (i % 3) + D[(i * 3) % 7], vel: .8, dur: 1 });
  for (const key of ['bass', 'bowls']){
    it(`${key}: a diatonic part with ${new Set(diatonic.map(n => n.midi)).size} pitches loses 0 notes (all fold by octave)`, () => {
      const { part, warnings } = shapePart(key, diatonic, { bpm: 60, loopBeats: 32 });
      const pcs = new Set(part.map(e => noteNum(e[1]) % 12));
      expect(pcs.size).toBe(7);
      expect(warnings.some(w => /dropped/.test(w))).toBe(false);
      expect(new Set(part.map(e => noteNum(e[1]))).size).toBeLessThanOrEqual(8);
    });
  }
});

describe('string bass: the groove survives, and every lane solves', () => {
  it('repeated eighths at 200 bpm (.15 s) are kept', () => {
    const notes = Array.from({ length: 64 }, (_, i) => ({ beat: i * .5, midi: 40, vel: .9, dur: .4 }));
    const { part } = shapePart('bass', notes, { bpm: 200, loopBeats: 32 });
    expect(part.length).toBe(64);
  });
  it('PART_SPEC.bass.gap is the solver\'s real floor: Tc + e·V_MIN/g + winch + V_MIN/g fits in it', () => {
    const g = 14.5, gap = PART_SPEC.bass.gap;
    const need = Math.min(TC, .4 * gap) + BASS_E * V_MIN / g + winchT(V_MIN ** 2 / (2 * g) - (BASS_E * V_MIN) ** 2 / (2 * g)) + V_MIN / g;
    expect(need).toBeLessThanOrEqual(gap);
    expect(need).toBeGreaterThan(gap - .02);                // …and it isn't needlessly strict
  });
  it('a song-length part is capped at the solve budget (with a warning)', () => {
    const notes = Array.from({ length: 900 }, (_, i) => ({ beat: i * .5, midi: 40 + (i % 5), vel: i % 2 ? .6 : .9, dur: .4 }));
    const { part, warnings } = shapePart('bass', notes, { bpm: 120, loopBeats: 452 });
    expect(part.length).toBe(PART_SPEC.bass.maxEvents);
    expect(warnings.some(w => /solve budget/.test(w))).toBe(true);
  });
});

describe('music box: pins fit the once-per-loop cylinder at any loop length', () => {
  it('mirrored constants match the engine + the comb', () => {
    expect(ORCH_ROLL_T).toBe(ROLL_T);
    expect(MB_MIN_ANGLE).toBe(GEOM.MIN_ANGLE);
    for (const ts of [[0, .1, .2, .3, 5, 9], [0, 2, 4, 6], [0, .5, 3, 3.5, 10]]) expect(twinsFor(ts, 20, 1)).toBe(splitTwins(ts, 20, 1).length);
    expect(twinsFor([0, .1, .2, .3, .4, .5], 20, 1)).toBe(0);           // can't fit 4 twins → 0 (splitTwins would overlap)
    expect(MB_TWINS).toBe(splitTwins(Array.from({ length: 40 }, (_, i) => i * .01), 20, 5).length);
  });
  for (const loopBeats of [16, 64, 256]){
    it(`alternating C6/G6 eighths over ${loopBeats} beats: no pin collisions, comb within budget`, () => {
      const bpm = 120, beat = 60 / bpm, notes = [];
      for (let b = 0; b < loopBeats; b += .5) notes.push({ beat: b, midi: 84 + ((b * 2) % 2) * 7, vel: .8, dur: .5 });
      for (let b = 0; b < loopBeats; b += 4) for (const m of [86, 88, 89, 91]) notes.push({ beat: b + .25, midi: m, vel: .6, dur: .25 });
      const { part, warnings } = shapePart('musicbox', notes, { bpm, loopBeats });
      const P = ROLL_T + loopBeats * beat;
      const { lanes, omega } = buildComb(part, { rollT: ROLL_T, beat, P });
      const minGap = GEOM.MIN_ANGLE / omega;
      let bad = 0;
      for (const l of lanes){ const s = l.L.s; if (s.length > 1) for (let i = 0; i < s.length; i++) if ((i + 1 < s.length ? s[i + 1] : s[0] + P) - s[i] < minGap - 1e-9) bad++; }
      expect(bad).toBe(0);
      expect(lanes.length).toBeLessThanOrEqual(PART_SPEC.musicbox.tines);
      expect(part.length).toBeGreaterThan(0);
      if (loopBeats >= 256) expect(warnings.some(w => /thinned \d+ pins/.test(w))).toBe(true);
    });
  }
});

describe('the loop seam', () => {
  it('bells: the gap across the seam (incl. the roll-in) honours the part-wide spacing', () => {
    const { part } = shapePart('bells', [0, 2, 4, 7.9].map((b, i) => ({ beat: b, midi: 60 + i * 2, vel: .9, dur: 1 })), { bpm: 120, loopBeats: 8, rollT: 0 });
    const on = part.map(e => e[0]);
    expect((on[0] + 8 - on.at(-1)) * .5).toBeGreaterThanOrEqual(.2);
  });
  it('a pickup never lands on the song\'s own last bar (only a FREE tail takes it)', () => {
    const busy = shapePart('marimba', [{ beat: -1, midi: 60, vel: .8 }, { beat: 0, midi: 64, vel: .8 }, { beat: 7.5, midi: 67, vel: .8 }], { bpm: 100, loopBeats: 8 });
    expect(busy.part.map(e => e[0])).toEqual([0, 7.5]);
    expect(busy.warnings.some(w => /loop tail already plays/.test(w))).toBe(true);
    const free = shapePart('marimba', [{ beat: -1, midi: 60, vel: .8 }, { beat: 0, midi: 64, vel: .8 }, { beat: 5, midi: 67, vel: .8 }], { bpm: 100, loopBeats: 8 });
    expect(free.part.map(e => e[0])).toEqual([0, 5, 7]);
  });
});
