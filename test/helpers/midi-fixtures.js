// midi-fixtures.js — small multi-program MIDI files, composed in code.
// Shared by test/midi-orchestra.test.js and scripts/make-midi-fixtures.mjs (which
// writes them to public/midi/ so `?midi=/midi/<name>.mid` can boot them in the app).
// Each returns a Uint8Array (via the test MIDI writer). Deterministic.

import { buildMidi } from './midi-builder.js';

const PPQ = 480;
const uspq = bpm => Math.round(60_000_000 / bpm);

/** note → on + off events. beat/len in beats. */
function note(evs, beat, midi, len, vel, channel){
  const t = Math.round(beat * PPQ);
  evs.push({ tick: t, type: 'on', note: midi, vel, channel });
  evs.push({ tick: t + Math.max(1, Math.round(len * PPQ) - 8), type: 'off', note: midi, channel });
}
function track(name, program, channel, fill, extra = []){
  const events = [{ tick: 0, type: 'name', text: name }, ...extra];
  if (program != null) events.push({ tick: 0, type: 'pc', program, channel });
  fill(events);
  return { events };
}
/** a line written as [[midi, beats], …] (midi null = rest) from a start beat */
function line(evs, start, seq, channel, vel = 90){
  let b = start;
  for (const [m, d, v] of seq){ if (m != null) note(evs, b, m, d, v ?? vel, channel); b += d; }
  return b;
}

/* ---------------------------------------------------------------------------
   ROOM TOUR — A minor, 100 bpm, 16 bars. Every station in the room on one tune:
   piano lead (belt) · marimba arpeggios · string-ensemble pad (bowls) · acoustic
   bass (string bass) · tubular bells · glockenspiel (music box) · drums.
   --------------------------------------------------------------------------- */
export function roomTour(){
  const PROG = ['Am', 'F', 'C', 'G', 'Am', 'F', 'G', 'E'];
  const CH = { Am: [57, 3], F: [53, 4], C: [48, 4], G: [55, 4], E: [52, 4] };   // root (oct 3), third
  const BASS = { Am: 33, F: 29, C: 36, G: 31, E: 28 };
  const bars = [...PROG, ...PROG];

  const A = [
    [[69,1],[72,1],[76,1],[81,1]],               [[79,.5],[77,.5],[76,1],[72,2]],
    [[76,1],[79,1],[84,1.5],[83,.5]],            [[81,.5],[79,.5],[74,1],[71,2]],
    [[72,.5],[74,.5],[76,1],[81,1],[79,1]],      [[77,1],[81,1],[84,1],[81,1]],
    [[83,1.5],[81,.5],[79,1],[74,1]],            [[76,1],[80,1],[83,2]],
  ];
  const B = [...A.slice(0, 6), [[83,.5],[84,.5],[86,1],[83,1],[79,1]], [[88,2],[80,1],[83,1]]];
  const lead = track('Piano', 0, 0, ev => { let b = 0; for (const bar of [...A, ...B]) b = line(ev, b, bar, 0, 96); },
                     [{ tick: 0, type: 'tempo', uspq: uspq(100) }]);

  const marimba = track('Marimba', 12, 1, ev => bars.forEach((c, i) => {
    const [r, t] = CH[c];
    [r - 12, r - 5, r, r + t, r + 7, r + t, r, r - 5].forEach((m, k) =>
      note(ev, i * 4 + k * .5, m, .5, k === 0 ? 100 : k % 2 ? 62 : 78, 1));
  }));

  const strings = track('Strings', 48, 2, ev => bars.forEach((c, i) => {
    const [r, t] = CH[c];
    for (const m of [r - 12, r - 5, r, r + t]) note(ev, i * 4, m, 4, 70, 2);
  }));

  const bass = track('Acoustic Bass', 32, 3, ev => bars.forEach((c, i) => {
    const r = BASS[c];
    line(ev, i * 4, [[r, 1.5, 110], [r, .5, 80], [r + 7, 1, 95], [r + 12, .5, 90], [r + 7, .5, 80]], 3);
  }));

  const bells = track('Tubular Bells', 14, 4, ev => {
    [0, 8, 16, 24, 32, 40, 48, 56].forEach((b, i) => note(ev, b, [69, 65, 69, 67, 69, 65, 67, 64][i], 4, 110, 4));
    for (const [b, m] of [[30, 76], [30.5, 71], [31, 68], [62, 76], [62.5, 71], [63, 68]]) note(ev, b, m, 1, 95, 4);
  });

  const glock = track('Glockenspiel', 9, 5, ev => bars.forEach((c, i) => {
    if (i < 8) return;                            // second half only: it ENTERS
    const [r, t] = CH[c];
    [[1.5, r + 24 + t], [2.5, r + 31], [3.5, r + 36]].forEach(([b, m]) => note(ev, i * 4 + b, m, .5, 85, 5));
  }));

  const drums = track('Drums', null, 9, ev => {
    for (let bar = 0; bar < 16; bar++){
      const b0 = bar * 4;
      note(ev, b0, 36, .25, 120, 9); note(ev, b0 + 2, 36, .25, 110, 9);
      if (bar % 2) note(ev, b0 + 2.5, 36, .25, 90, 9);
      note(ev, b0 + 1, 38, .25, 105, 9);
      for (let k = 0; k < 8; k++) note(ev, b0 + k * .5, 42, .25, k % 2 ? 55 : 85, 9);
      if (bar === 7 || bar === 15){
        [50, 48, 47, 45, 43, 43].forEach((m, k) => note(ev, b0 + 2.5 + k * .25, m, .25, 100, 9));
      } else note(ev, b0 + 3, 38, .25, 105, 9);
      if (bar === 0 || bar === 8) note(ev, b0, 49, 1, 110, 9);
    }
  });

  return buildMidi({ format: 1, ppq: PPQ, tracks: [lead, marimba, strings, bass, bells, glock, drums] });
}

/* ---------------------------------------------------------------------------
   CANON IN D (Pachelbel, public domain) — 66 bpm, four turns of the ground.
   Violin I (belt lead) · Violin II in canon two bars behind (belt alto) ·
   contrabass on the ground (string bass) · harp arpeggios (marimba) · slow-strings
   pad (bowls) · celesta sparkle (music box) · a tubular bell on each turn ·
   a soft kit in the last two turns.
   --------------------------------------------------------------------------- */
export function canonInD(){
  // the ground: D A Bm F#m G D G A — one chord per beat, 8 beats per turn
  const ROOT = [50, 45, 47, 42, 43, 50, 43, 45];           // D3 A2 B2 F#2 G2 D3 G2 A2
  const THIRD = [4, 4, 3, 3, 4, 4, 4, 4];
  const GROUND = [38, 33, 35, 30, 31, 26, 31, 33];        // D2 A1 B1 F#1 G1 D1 G1 A1
  const V = [
    [[78,1],[76,1],[74,1],[73,1],[71,1],[69,1],[71,1],[73,1]],                          // F# E D C# B A B C#
    [[74,1],[73,1],[71,1],[69,1],[67,1],[66,1],[67,1],[64,1]],                          // D C# B A G F# G E
    [[62,.5],[66,.5],[69,.5],[67,.5],[66,.5],[62,.5],[66,.5],[64,.5],
     [62,.5],[59,.5],[62,.5],[69,.5],[67,.5],[71,.5],[69,.5],[67,.5]],                  // D F# A G F# D F# E D B D A G B A G
    [[74,.5],[73,.5],[74,.5],[62,.5],[61,.5],[69,.5],[64,.5],[66,.5],
     [62,.5],[74,.5],[73,.5],[71,.5],[73,.5],[78,.5],[81,.5],[83,.5]],                  // D C# D D C# A E F# D D C# B C# F# A B
  ];
  const TURNS = 4, L = 8;

  const v1 = track('Violin I', 40, 0, ev => V.forEach((t, i) => line(ev, i * L, t, 0, 92)),
                   [{ tick: 0, type: 'tempo', uspq: uspq(66) }]);
  const v2 = track('Violin II', 40, 1, ev => V.slice(0, 3).forEach((t, i) => line(ev, (i + 1) * L, t, 1, 78)));
  const cb = track('Contrabass', 43, 2, ev => {
    for (let k = 0; k < TURNS; k++) GROUND.forEach((m, j) => note(ev, k * L + j, m, 1, j % 2 ? 90 : 112, 2));
  });
  const harp = track('Harp', 46, 3, ev => {
    for (let k = 1; k < TURNS; k++) ROOT.forEach((r, j) => {
      const pat = k === 1 ? [r, r + 7] : [r, r + 7, r + 12, r + 12 + THIRD[j]];
      pat.forEach((m, q) => note(ev, k * L + j + q / pat.length, m, 1 / pat.length, q ? 70 : 92, 3));
    });
  });
  const pad = track('Slow Strings', 49, 4, ev => {
    for (let k = 0; k < TURNS; k++) for (let j = 0; j < L; j += 2){
      const r = ROOT[j] < 45 ? ROOT[j] + 12 : ROOT[j];
      for (const m of [r, r + THIRD[j], r + 7]) note(ev, k * L + j, m, 2, 64, 4);
    }
  });
  const celesta = track('Celesta', 8, 5, ev => {
    for (let k = 2; k < TURNS; k++) ROOT.forEach((r, j) => {
      note(ev, k * L + j + .5, r + 36 + THIRD[j], .5, k === 3 ? 90 : 70, 5);
      if (k === 3 && j % 2) note(ev, k * L + j + .75, r + 43, .25, 70, 5);
    });
  });
  const bells = track('Tubular Bells', 14, 6, ev => {
    [74, 69, 74, 69].forEach((m, k) => note(ev, k * L, m, 4, 112, 6));
    note(ev, 3 * L + 4, 78, 2, 90, 6);
  });
  const drums = track('Drums', null, 9, ev => {
    for (let b = 2 * L; b < TURNS * L; b++){
      if (b % 2 === 0) note(ev, b, 36, .25, 100, 9); else note(ev, b, 38, .25, 70, 9);
      note(ev, b, 51, .25, 60, 9); note(ev, b + .5, 42, .25, 45, 9);
    }
    note(ev, 2 * L, 49, 1, 105, 9);
  });

  return buildMidi({ format: 1, ppq: PPQ, tracks: [v1, v2, cb, harp, pad, celesta, bells, drums] });
}

/* ---------------------------------------------------------------------------
   NIGHT MALLETS — a FORMAT-0 file with NO piano / lead at all: vibraphone tune,
   warm pad, fingered bass, music box. Exercises the format-0 channel split and
   the spine fallback (the belt lead doubles the vibraphone's top line).
   --------------------------------------------------------------------------- */
export function nightMallets(){
  const CH = [[48, [4, 7, 11]], [45, [3, 7, 10]], [50, [3, 7, 10]], [43, [4, 7, 10]]];  // Cmaj7 Am7 Dm7 G7
  const ev = [{ tick: 0, type: 'tempo', uspq: uspq(90) }, { tick: 0, type: 'name', text: 'Night Mallets' }];
  ev.push({ tick: 0, type: 'pc', program: 11, channel: 0 }, { tick: 0, type: 'pc', program: 89, channel: 1 },
          { tick: 0, type: 'pc', program: 33, channel: 2 }, { tick: 0, type: 'pc', program: 10, channel: 3 });
  const tune = [
    [[76,1],[79,1],[83,1.5],[81,.5]], [[79,1],[76,1],[72,2]],
    [[77,1],[81,1],[84,1],[81,1]],    [[79,1.5],[77,.5],[74,1],[71,1]],
  ];
  for (let rep = 0; rep < 2; rep++) tune.forEach((bar, i) => {
    const b0 = (rep * 4 + i) * 4, [r, iv] = CH[i];
    line(ev, b0, bar, 0, 92);
    for (const m of [r, ...iv.map(x => r + x)]) note(ev, b0, m + 12, 4, 66, 1);
    line(ev, b0, [[r - 12, 2, 105], [r - 5, 1, 90], [r - 12 + 12, 1, 85]], 2);
    if (rep) [[.5, 0], [1.5, 1], [2.5, 2], [3.5, 1]].forEach(([b, k]) => note(ev, b0 + b, r + 36 + iv[k], .5, 80, 3));
  });
  return buildMidi({ format: 0, ppq: PPQ, tracks: [{ events: ev }] });
}

export const FIXTURES = { 'room-tour': roomTour, 'canon-in-d': canonInD, 'night-mallets': nightMallets };
