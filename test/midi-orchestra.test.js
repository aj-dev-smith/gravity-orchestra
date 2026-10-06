import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseMidi } from '../src/midi/parse.js';
import { convertToSong } from '../src/midi/convert.js';
import { routeProgram, shapePart, orchestrate, PART_SPEC, PICKUP_BEATS, GM_NAMES } from '../src/midi/orchestra.js';
import { buildMidi } from './helpers/midi-builder.js';
import { FIXTURES } from './helpers/midi-fixtures.js';
import { INSTRUMENTS } from '../src/instruments/index.js';
import { eventTimes, lanesByNote } from '../src/instruments/clock.js';
import { ROLL_T, noteNum } from '../src/engine.js';
import { makeLanes, ballAt } from '../src/instruments/marimba/solve.js';
import { bellLane, bellAt } from '../src/instruments/bells/solve.js';
import { solveLane, poseAt } from '../src/instruments/bass/solve.js';
import { bowlGeom, bowlLane, bowlAt } from '../src/instruments/bowls/solve.js';
import { buildComb, tineAt } from '../src/instruments/musicbox/solve.js';

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
    sustain: [16, 19, 21, 40, 41, 42, 44, 48, 49, 50, 52, 53],
    belt: [0, 1, 4, 6, 24, 25, 30, 56, 60, 65, 68, 73, 80, 81, 104, 107, 110],
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
  it('a file with no program changes imports exactly as the classic belts (no parts)', () => {
    const bytes = file(trk('a', null, 0, scale8(72)), trk('b', null, 1, [[0, 48, 4], [0, 52, 4], [4, 50, 4], [4, 53, 4]]));
    const a = convert(bytes), b = convert(bytes, { orchestra: false });
    expect(a.song.parts).toBeUndefined();
    expect(a.song).toEqual(b.song);
    expect(a.song.bass).toBeDefined();                       // chordal track stays a (top-note) belt
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
    expect(warnings.some(w => /"Comp" is chordal/.test(w))).toBe(true);
    expect(warnings.some(w => /dropped track "Extra" from the belts/.test(w))).toBe(true);
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
      const lanes = makeLanes(eventTimes(P_.marimba, { rollT: ROLL_T, beat }), P, start);
      for (const l of lanes) for (const t of ts) finiteDeep(ballAt(l.L ?? l, t, l.start ?? start), `marimba ${l.note}`);
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
  });
});

describe('fixture specifics', () => {
  it('room tour lights up every station + the drums', () => {
    const { song } = convertToSong(parseMidi(FIXTURES['room-tour']()));
    expect(Object.keys(song.parts).sort()).toEqual(['bass', 'bells', 'bowls', 'marimba', 'musicbox']);
    expect(Object.keys(song.drums)).toEqual(expect.arrayContaining(['kick', 'snare', 'hat', 'crash']));
    expect(sumBeats(song.melody)).toBe(64);
  });

  it('canon: Violin I leads, Violin II is a belt in canon, the ground is on the string bass', () => {
    const { song } = convertToSong(parseMidi(FIXTURES['canon-in-d']()));
    expect(song.melody.slice(0, 4).map(n => n[0])).toEqual(['F#5', 'E5', 'D5', 'C#5']);
    expect((song.alto || song.bass).delay).toBe(8);
    expect(song.parts.bass.slice(0, 4).map(e => e[1])).toEqual(['D3', 'A2', 'B2', 'F#2']);
    expect(sumBeats(song.melody)).toBe(32);                // the loop ends with the phrase, no dead bar
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
