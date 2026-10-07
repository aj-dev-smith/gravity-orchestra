// Regressions from the MIDI torture survey (52 real-world files, read in place — never
// committed). Every case here is a SYNTHETIC file composed in code that reproduces one
// systemic failure the corpus showed, locked to the fixed behaviour.
import { describe, it, expect } from 'vitest';
import { parseMidi, tempoMap } from '../src/midi/parse.js';
import { convertToSong } from '../src/midi/convert.js';
import { orchestrate, orchestrateByRole, splitHands, shapePart, budgetWindow, PART_SPEC, ROLE } from '../src/midi/orchestra.js';
import { drumByGm } from '../src/drumkit.js';
import { layoutStations, STATIONS } from '../src/instruments/stations.js';
import { buildMidi } from './helpers/midi-builder.js';
import { FIXTURES } from './helpers/midi-fixtures.js';
import { ROLL_T, noteNum } from '../src/engine.js';

const PPQ = 480;
const sumBeats = notes => notes.reduce((s, [, b]) => s + b, 0);
const convert = (bytes, opts) => convertToSong(parseMidi(bytes), opts);
const uspq = bpm => Math.round(60_000_000 / bpm);
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
const line = (base, n, step = 1, len = step) => Array.from({ length: n }, (_, i) => [i * step, base + [0, 2, 4, 5, 7, 9, 11, 12][i % 8], len]);

// ---------------------------------------------------------------------------
describe('drums: the kit merges GM notes that are "another of the same thing"', () => {
  it('the other kick / snare, pedal hat, shakers, extra cymbals, hand drums all land on a lane', () => {
    const want = { 35: 'kick', 40: 'snare', 37: 'snare', 44: 'hat', 54: 'hat', 69: 'hat', 70: 'hat', 82: 'hat',
                   52: 'crash', 55: 'crash', 57: 'crash', 53: 'ride', 59: 'ride', 81: 'hatOpen',
                   60: 'tomHigh', 62: 'tomMid', 64: 'tomLow', 41: 'floorHigh' };
    for (const [gm, lane] of Object.entries(want)) expect(drumByGm(+gm), `GM ${gm}`).toBe(lane);
    for (const gm of [56, 75, 76, 77]) expect(drumByGm(gm), `GM ${gm}`).toBeUndefined();   // no piece reads as these
  });
  it('a GM35 / GM40 / tambourine groove imports as kick / snare / hat (was: a hat-less, kick-less kit)', () => {
    const kit = { events: [] };
    for (let b = 0; b < 8; b++){
      kit.events.push({ tick: b * PPQ, type: 'on', note: b % 2 ? 40 : 35, vel: 110, channel: 9 });
      kit.events.push({ tick: b * PPQ + PPQ / 2, type: 'on', note: 54, vel: 70, channel: 9 });
    }
    const { song, warnings } = convert(file(trk('Lead', 0, 0, line(72, 8)), kit));
    expect(song.drums.kick.length).toBe(4);
    expect(song.drums.snare.length).toBe(4);
    expect(song.drums.hat.length).toBe(8);
    expect(warnings.some(w => /unmapped/.test(w))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('tempo: the dominant tempo, not the first event (the rickroll played 1.69× fast)', () => {
  it('a short 200-bpm count-in marker before 64 beats at 118 imports at 118', () => {
    const lead = trk('Lead', 0, 0, line(72, 68).map(([b, m]) => [b, m]), [
      { tick: 0, type: 'tempo', uspq: uspq(200) },
      { tick: 4 * PPQ, type: 'tempo', uspq: uspq(118) },
    ]);
    const p = parseMidi(file(lead));
    expect(p.bpm).toBeCloseTo(118, 1);
    expect(p.tempos.map(t => Math.round(t.bpm))).toEqual([200, 118]);
    expect(convertToSong(p).song.bpm).toBeCloseTo(118, 1);
  });
  it('a ritardando of many small steps keeps the body tempo (beat-weighted median)', () => {
    const ev = [{ tick: 0, type: 'tempo', uspq: uspq(96) }];
    for (let k = 0; k < 8; k++) ev.push({ tick: (56 + k) * PPQ, type: 'tempo', uspq: uspq(94 - k * 6) });
    expect(parseMidi(file(trk('Lead', 0, 0, line(72, 64), ev))).bpm).toBe(96);
  });
  it('simultaneous tempo events: the first (conductor) track wins', () => {
    const raw = [{ tempos: [{ tick: 0, bpm: 120 }], notes: [{ tick: 960 }] }, { tempos: [{ tick: 0, bpm: 200 }], notes: [] }];
    expect(tempoMap(raw)).toEqual({ bpm: 120, tempos: [{ tick: 0, bpm: 120 }] });
  });
});

// ---------------------------------------------------------------------------
describe('drums: a pickup deeper than the roll-in is an intro, not a fill', () => {
  it('keeps the hits within ROLL_T before the lead; drops (and reports) the rest', () => {
    const bpm = 120, floor = -ROLL_T * bpm / 60;                     // −5.2 beats
    const kit = { events: [] };
    for (let b = 0; b < 32; b++) kit.events.push({ tick: b * PPQ, type: 'on', note: 36, vel: 100, channel: 9 });
    const lead = trk('Lead', 0, 0, line(72, 16).map(([b, m]) => [b + 16, m]), [{ tick: 0, type: 'tempo', uspq: uspq(bpm) }]);
    const { song, warnings } = convert(file(lead, kit));
    const beats = song.drums.kick.map(h => (Array.isArray(h) ? h[0] : h));
    expect(Math.min(...beats)).toBeGreaterThanOrEqual(floor);        // nothing wraps into the groove mid-loop
    expect(beats.filter(b => b < 0)).toEqual([-5, -4, -3, -2, -1]);  // the fill that leads into the downbeat
    expect(warnings.some(w => /dropped 11 hits more than the roll-in/.test(w))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('solve budgets keep ONE contiguous window (never a sieve of "strongest" notes)', () => {
  it('a song-length marimba part is capped at its budget, from its entrance, whole onsets', () => {
    const notes = [];
    for (let i = 0; i < 400; i++) for (const d of [0, 4, 7]) notes.push({ beat: i * .5, midi: 60 + d + (i % 5), vel: i % 2 ? .5 : .9, dur: .4 });
    const { part, warnings } = shapePart('marimba', notes, { bpm: 120, loopBeats: 200 });
    expect(part.length).toBeLessThanOrEqual(PART_SPEC.marimba.maxEvents);
    expect(part.length % 3).toBe(0);                                  // no chord cut in half
    const beats = [...new Set(part.map(e => e[0]))];
    expect(beats[0]).toBe(0);
    for (let i = 1; i < beats.length; i++) expect(beats[i] - beats[i - 1]).toBe(.5);   // no holes
    expect(warnings.some(w => /contiguous window.*solve budget/.test(w))).toBe(true);
  });
  it('budgetWindow: under budget is untouched; a giant first chord is truncated, not emptied', () => {
    const ns = [0, 0, 0, 1, 2].map((beat, i) => ({ beat, i }));
    expect(budgetWindow(ns, 9)).toBe(ns);
    expect(budgetWindow(ns, 4).map(n => n.i)).toEqual([0, 1, 2, 3]);
    expect(budgetWindow(ns, 2).length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
describe('turntable + ricochet: reachable by MIDI (each was empty on all 52 files)', () => {
  it('both are monophonic: a chord keeps its TOP note (the marble reads the tune)', () => {
    for (const key of ['turntable', 'ricochet']){
      const { part } = shapePart(key, [{ beat: 0, midi: 60, vel: .8 }, { beat: 0, midi: 67, vel: .8 }, { beat: 1, midi: 64, vel: .8 }], { bpm: 100, loopBeats: 8 });
      expect(part.map(e => noteNum(e[1]) % 12)).toEqual([7, 4]);
    }
  });
  it('the ricochet only takes a short loop (every rest is a relay mirror; ~1 s solve at 40 plates)', () => {
    const notes = line(72, 16).map(([beat, midi]) => ({ beat, midi, vel: .8 }));
    expect(shapePart('ricochet', notes, { bpm: 120, loopBeats: 64 }).part.length).toBe(16);
    const long = shapePart('ricochet', notes, { bpm: 120, loopBeats: 256 });
    expect(long.part).toEqual([]);
    expect(long.warnings.some(w => /too long for one frozen orbit/.test(w))).toBe(true);
    const many = shapePart('ricochet', line(72, 80, .5).map(([beat, midi]) => ({ beat, midi, vel: .8 })), { bpm: 120, loopBeats: 40 });
    expect(many.part.length).toBe(PART_SPEC.ricochet.maxEvents);
  });
  it('program routing: a spare melodic line goes to the free turntable before the marimba', () => {
    // (C is a FLUTE: a spare piano line now plays the piano machine first — the next test)
    const { song, warnings } = convert(file(
      trk('Lead', 0, 0, line(76, 16)), trk('A', 0, 1, line(67, 16)), trk('B', 0, 2, line(60, 16)), trk('C', 73, 3, line(55, 16, 1, .5))));
    expect(song.parts.turntable.length).toBe(16);
    expect(warnings.some(w => /"C" .*plays on the turntable/.test(w))).toBe(true);
  });
  it('program routing: a spare PIANO line plays the Marble Grand (its family machine) before the line machines', () => {
    const { song, warnings } = convert(file(
      trk('Lead', 0, 0, line(76, 16)), trk('A', 0, 1, line(67, 16)), trk('B', 0, 2, line(60, 16)), trk('C', 0, 3, line(55, 16, 1, .5))));
    expect(song.parts.dulcimer.length).toBe(16);
    expect(song.parts.turntable).toBeUndefined();
    expect(warnings.some(w => /"C" .*plays on the dulcimer \(a spare acoustic grand piano line\)/.test(w))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('the lead stays PRESENT (no 90-second silences on the belt)', () => {
  it('a high voice with a long mid-song rest loses the lead to one that keeps playing', () => {
    const gappy = trk('Gappy', 0, 0, [...line(84, 16), ...line(84, 16).map(([b, m]) => [b + 112, m])]);   // rests 96 beats
    const steady = trk('Steady', 0, 1, line(67, 128));
    const { song } = convert(file(gappy, steady));
    expect(song.melody[0][0]).toBe('G4');
    expect(Math.max(...song.melody.map(n => n[1]))).toBeLessThanOrEqual(8);
  });
});

// ---------------------------------------------------------------------------
describe('ROLE routing: a file whose programs say nothing still fills the room', () => {
  it('no program changes (a sequencer sketch): every shape finds its machine', () => {
    const { song, warnings } = convertToSong(parseMidi(FIXTURES['sketch-band']()));
    // (the arpeggiated chords comp on the Marble Grand — every program-less voice is "piano"; was: the marimba)
    expect(Object.keys(song.parts).sort()).toEqual(['bass', 'bowls', 'dulcimer', 'musicbox', 'turntable']);
    expect(song.melody.slice(0, 4).map(n => n[0])).toEqual(['D5', 'E5', 'F#5', 'A5']);   // "Melody" leads (the legacy choice)
    expect(warnings[0]).toMatch(/^routed by musical role \(no program data\)/);
    expect(warnings[0]).toMatch(/"Pad" → bowls \(a sustained chordal bed\)/);
    expect(warnings[0]).toMatch(/"Low" → bass \(a low line\)/);
    expect(warnings[0]).toMatch(/"Sparkle" → musicbox/);
    expect(warnings[0]).toMatch(/"Counter" → turntable/);
    expect(warnings[0]).toMatch(/"Arps" → dulcimer \(chords \/ arpeggios\)/);
    expect(song.staging).toBe('auto');
  });

  it('the legacy belts-only import stays reachable', () => {
    const bytes = FIXTURES['sketch-band']();
    const { song, warnings } = convert(bytes, { route: 'legacy' });
    expect(song.parts).toBeUndefined();
    expect(song.alto && song.bass).toBeTruthy();
    expect(warnings.some(w => /dropped track/.test(w))).toBe(true);
    expect(convert(bytes, { orchestra: false }).song).toEqual(song);
  });

  it('one track, two hands: split into melody (lead) / left hand (string bass) / chords (the Marble Grand)', () => {
    const { song, warnings } = convertToSong(parseMidi(FIXTURES['piano-hands']()));
    expect(warnings.some(w => /routed by musical role \(its programs give the room nothing to play\)/.test(w))).toBe(true);
    expect(warnings.some(w => /one track plays melody \+ accompaniment — split into \(melody\) \d+, \(left hand\) \d+, \(chords\) \d+/.test(w))).toBe(true);
    expect(song.melody.slice(0, 6).map(n => n[0])).toEqual(['E5', 'B4', 'C5', 'D5', 'C5', 'B4']);   // the right hand's tune
    expect(song.parts.bass.length).toBe(64);
    expect(song.parts.dulcimer.length).toBeGreaterThan(0);
    expect(song.parts.marimba).toBeUndefined();
    expect(song.alto).toBeUndefined(); expect(song.bass).toBeUndefined();
    expect(warnings.some(w => /kept top note/.test(w))).toBe(false);   // (was: the whole left hand thrown away)
  });

  it('splitHands: the top line skips inner notes under a still-sounding melody note', () => {
    const q = t => t / PPQ;
    const N = (beat, midi, len) => ({ tick: beat * PPQ, midi, dur: len * PPQ });
    const notes = [N(0, 76, 2), N(0, 40, 1), N(1, 64, .5), N(1, 43, 1), N(2, 74, 1), N(2, 40, 1)];
    const { top, bottom, inner } = splitHands(notes, q);
    expect(top.map(n => n.midi)).toEqual([76, 74]);                    // the held E5, not the inner E4 under it
    expect(bottom.map(n => n.midi)).toEqual([40, 43, 40]);
    expect(inner.map(n => n.midi)).toEqual([64]);
  });

  it('a full machine passes the voice down its list; nothing fits → dropped with a reason', () => {
    // five bass-register lines (means 36–42: under ROLE.LOW 46 — the corpus's basses sit at 30–42)
    const lows = [0, 1, 2, 3, 4].map(k => trk(`Low ${k}`, null, k + 1, line(30 + k * 2, 16, 1, .5).map(([b, m]) => [b + k * .2, m, .5])));
    const r = orchestrateByRole(parseMidi(file(trk('Tune', null, 0, line(72, 16)), ...lows)).tracks, { ppq: PPQ, bpm: 120 });
    expect(r.parts.filter(p => p.key === 'bass').length).toBe(1);      // one string-bass voice…
    expect(r.belt.length).toBe(3);                                     // …two more low lines take the belts…
    expect(r.parts.filter(p => p.key === 'pogo').length).toBe(1);      // …the next one the Pogo Bass (a program-less low line: the string bass first)…
    expect(r.parts.some(p => p.key === 'marimba')).toBe(true);         // …and the last one the marimba
  });

  it('a file whose programs DO route keeps program routing (role routing is a fallback)', () => {
    const { warnings } = convert(file(trk('Piano', 0, 0, line(72, 8)), trk('Marimba', 12, 1, line(60, 8, .5))));
    expect(warnings.some(w => /routed by musical role/.test(w))).toBe(false);
  });

  it('ROLE thresholds are the documented ones', () => {
    // LOW 50 → 46 (a guitar: 40) — see orchestra.js ROLE; the lead floor stays at the old LOW + 5
    expect(ROLE).toEqual({ LOW: 46, GTR_LOW: 40, LEAD_MIN: 55, BASS_MAX: 55, HIGH: 79, SPARK: .3, SUSTAIN: 1.2, SPLIT: 12 });
  });
});

// ---------------------------------------------------------------------------
// (the torture branch's own placeStation was superseded on merge by v2's layoutStations —
//  the same guarantee, checked here against the corpus's wide walls)
describe('stations make way for a wide belt wall', () => {
  const room = { x0: -38, x1: 38, z0: -34, z1: 30 };
  const box = st => {
    const c = Math.abs(Math.cos(st.yaw)), s = Math.abs(Math.sin(st.yaw));
    const ex = st.w / 2 * c + st.d / 2 * s, ez = st.w / 2 * s + st.d / 2 * c;
    return [-ex, ex, -ez, ez];
  };
  const floor = Object.entries(STATIONS).filter(([, st]) => !st.hang);
  for (const half of [20, 30]){
    it(`a ±${half} u wall: no station footprint overlaps it or another, every station stays in the room`, () => {
      const wall = [-half, half, -4.1, 2.4];
      const items = floor.map(([key, st]) => ({ key, x: st.x, z: st.z, box: box(st) }));
      const out = layoutStations(items, wall, room);
      const fps = items.map(it => [out[it.key].x + it.box[0], out[it.key].x + it.box[1], out[it.key].z + it.box[2], out[it.key].z + it.box[3], it.key]);
      const hit = (a, b) => a[0] < b[1] && b[0] < a[1] && a[2] < b[3] && b[2] < a[3];
      for (const f of fps){
        expect(hit(f, wall), `${f[4]} vs wall`).toBe(false);
        expect(f[0] >= room.x0 - 1e-6 && f[1] <= room.x1 + 1e-6 && f[2] >= room.z0 - 1e-6 && f[3] <= room.z1 + 6 + 1e-6, f[4]).toBe(true);
        for (const g of fps) if (g !== f) expect(hit(f, g), `${f[4]} vs ${g[4]}`).toBe(false);
      }
    });
  }
});
