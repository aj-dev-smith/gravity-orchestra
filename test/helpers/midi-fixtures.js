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
   piano lead (belt) · marimba arpeggios · string-ensemble pad (bow wheel) · acoustic
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
   CANON IN D (Pachelbel, public domain) — 66 bpm, six turns of the ground + a
   cadence bar. The real thing is a canon for THREE violins over a ground bass, so:
   Violin I (belt lead) · Violin II two bars behind (alto belt) · Violin III four bars
   behind (bass belt) — three marbles chasing one tune · contrabass on the ground
   (string bass) · harp arpeggios (marimba) · slow-strings pad (bowls) · celesta
   sparkle (music box) · a tubular bell on every turn · a soft kit from turn 3, with
   tom fills into turn 5 and back round the loop. Turn 5 is the 16th-note variation
   (flat, fast skims on the belt), turn 6 the leaping arpeggios (tall arcs). Then the
   CADENCE: the whole room lands on D major at beat 48 and breathes before the loop.
   --------------------------------------------------------------------------- */
export function canonInD(){
  // the ground: D A Bm F#m G D G A — one chord per beat, 8 beats per turn
  const ROOT = [50, 45, 47, 42, 43, 50, 43, 45];           // D3 A2 B2 F#2 G2 D3 G2 A2
  const THIRD = [4, 4, 3, 3, 4, 4, 4, 4];
  const GROUND = [38, 33, 35, 30, 31, 26, 31, 33];        // D2 A1 B1 F#1 G1 D1 G1 A1
  const s16 = ns => ns.map(m => [m, .25]);
  const V = [
    [[78,1],[76,1],[74,1],[73,1],[71,1],[69,1],[71,1],[73,1]],                          // F# E D C# B A B C#
    [[74,1],[73,1],[71,1],[69,1],[67,1],[66,1],[67,1],[64,1]],                          // D C# B A G F# G E
    [[62,.5],[66,.5],[69,.5],[67,.5],[66,.5],[62,.5],[66,.5],[64,.5],
     [62,.5],[59,.5],[62,.5],[69,.5],[67,.5],[71,.5],[69,.5],[67,.5]],                  // D F# A G F# D F# E D B D A G B A G
    [[74,.5],[73,.5],[74,.5],[62,.5],[61,.5],[69,.5],[64,.5],[66,.5],
     [62,.5],[74,.5],[73,.5],[71,.5],[73,.5],[78,.5],[81,.5],[83,.5]],                  // D C# D D C# A E F# D D C# B C# F# A B
    s16([81,79,78,76, 78,76,74,73, 74,73,71,69, 71,69,67,66,                           // the 16th-note variation:
         67,66,64,62, 64,66,67,69, 71,73,74,76, 78,76,74,73]),                          // stepwise cascades down, then up
    [[74,.5],[78,.5],[73,.5],[76,.5],[71,.5],[74,.5],[69,.5],[73,.5],                   // leaping arpeggios
     [67,.5],[71,.5],[74,.5],[78,.5],[79,.5],[83,.5],[81,.5],[79,.5]],
  ];
  const TURNS = 6, L = 8, END = TURNS * L;               // the cadence bar starts at beat 48

  const violin = (name, ch, delayTurns, vel) => track(name, 40, ch, ev => {
    V.slice(0, TURNS - delayTurns).forEach((t, i) => line(ev, (i + delayTurns) * L, t, ch, vel));
    note(ev, END, [86, 78, 74][delayTurns], 3.5, vel + 8, ch);                     // D6 / F#5 / D5: the cadence chord
  }, ch === 0 ? [{ tick: 0, type: 'tempo', uspq: uspq(66) }] : []);
  const v1 = violin('Violin I', 0, 0, 92), v2 = violin('Violin II', 1, 1, 80), v3 = violin('Violin III', 2, 2, 72);
  const cb = track('Contrabass', 43, 3, ev => {
    for (let k = 0; k < TURNS; k++) GROUND.forEach((m, j) => note(ev, k * L + j, m, 1, j % 2 ? 90 : 112, 3));
    note(ev, END, 26, 2, 120, 3); note(ev, END + 2, 38, 1.5, 96, 3);              // D1 … D2
  });
  const harp = track('Harp', 46, 4, ev => {
    for (let k = 1; k < TURNS; k++) ROOT.forEach((r, j) => {
      const pat = k === 1 ? [r, r + 7] : k === 4 ? [r, r + 7, r + 12, r + 12 + THIRD[j], r + 19, r + 12 + THIRD[j]] : [r, r + 7, r + 12, r + 12 + THIRD[j]];
      pat.forEach((m, q) => note(ev, k * L + j + q / pat.length, m, 1 / pat.length, q ? 70 : 92, 4));
    });
    [50, 57, 62, 66, 69, 74].forEach((m, q) => note(ev, END + q / 6, m, 3, 96 - q * 4, 4));   // a rolled D chord
  });
  const pad = track('Slow Strings', 49, 5, ev => {
    for (let k = 0; k < TURNS; k++) for (let j = 0; j < L; j += 2){
      const r = ROOT[j] < 45 ? ROOT[j] + 12 : ROOT[j];
      for (const m of [r, r + THIRD[j], r + 7]) note(ev, k * L + j, m, 2, 64, 5);
    }
    for (const m of [50, 54, 57, 62]) note(ev, END, m, 3.5, 72, 5);
  });
  const celesta = track('Celesta', 8, 6, ev => {
    for (let k = 2; k < TURNS; k++) ROOT.forEach((r, j) => {
      note(ev, k * L + j + .5, r + 36 + THIRD[j], .5, k >= 3 ? 90 : 70, 6);
      if (k >= 3 && j % 2) note(ev, k * L + j + .75, r + 43, .25, 70, 6);
    });
    [[.5, 90], [1, 93], [1.5, 98]].forEach(([b, m]) => note(ev, END + b, m, .5, 84, 6));   // F# A D sparkle
  });
  const bells = track('Tubular Bells', 14, 7, ev => {
    for (let k = 0; k < TURNS; k++) note(ev, k * L, k % 2 ? 69 : 74, 4, 112, 7);
    note(ev, 3 * L + 4, 78, 2, 90, 7);
    note(ev, END, 74, 4, 120, 7);
  });
  const drums = track('Drums', null, 9, ev => {
    for (let b = 2 * L; b < TURNS * L; b++){
      if (b === 4 * L - 1) continue;                                                     // the fill bar's last beat
      if (b % 2 === 0) note(ev, b, 36, .25, 100, 9); else note(ev, b, 38, .25, 70, 9);
      note(ev, b, 51, .25, 60, 9); note(ev, b + .5, 42, .25, 45, 9);
    }
    [50, 48, 47, 45].forEach((m, k) => note(ev, 4 * L - 1 + k / 4, m, .25, 85 + k * 8, 9));   // fill into the 16ths
    for (const t of [2 * L, 4 * L]) note(ev, t, 49, 1, 105, 9);
    note(ev, END, 36, .25, 110, 9); note(ev, END, 49, 1, 115, 9);                      // the landing
    [47, 45, 43].forEach((m, k) => note(ev, END + 3 + k / 3, m, .25, 80 + k * 10, 9));   // a tom pickup back into the top
  });

  return buildMidi({ format: 1, ppq: PPQ, tracks: [v1, v2, v3, cb, harp, pad, celesta, bells, drums] });
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

/* ---------------------------------------------------------------------------
   SKETCH BAND — NO PROGRAM CHANGES (a bare sequencer sketch: GM piano on every channel,
   like Owl City 'Fireflies'). D major, 104 bpm, 16 bars. Routed by musical ROLE: a
   melody (belt lead) · a counter-line (turntable) · a sustained pad (bowls) · a low line
   (string bass) · a high sparkle (music box) · let-ring arpeggios (marimba) · a kit.
   --------------------------------------------------------------------------- */
export function sketchBand(){
  const PROG = ['D', 'Bm', 'G', 'A'];
  const R = { D: 62, Bm: 59, G: 55, A: 57 }, M3 = { D: 4, Bm: 3, G: 4, A: 4 };
  const bars = [...PROG, ...PROG, ...PROG, ...PROG];
  const melody = track('Melody', null, 0, ev => {
    const A = [[[74,1],[76,.5],[78,.5],[81,2]], [[78,1],[76,1],[74,2]], [[71,.5],[74,.5],[79,1],[78,1],[76,1]], [[76,1],[73,1],[69,2]]];
    let b = 0; for (let k = 0; k < 4; k++) for (const bar of A) b = line(ev, b, bar, 0, 96);
  }, [{ tick: 0, type: 'tempo', uspq: uspq(104) }]);
  const counter = track('Counter', null, 1, ev => bars.forEach((c, i) => {
    line(ev, i * 4 + 1, [[R[c] + 7, 1], [R[c] + M3[c] + 12 - 12, 1], [R[c] + 12, 1]], 1, 74);
  }));
  const pad = track('Pad', null, 2, ev => bars.forEach((c, i) => {
    for (const m of [R[c] - 12, R[c] - 12 + M3[c], R[c] - 5]) note(ev, i * 4, m, 4, 60, 2);
  }));
  const low = track('Low', null, 3, ev => bars.forEach((c, i) => {
    [0, 0, 7, 5].forEach((d, k) => note(ev, i * 4 + k, R[c] - 24 + d, .9, 100, 3));
  }));
  const sparkle = track('Sparkle', null, 4, ev => bars.forEach((c, i) => {
    if (i % 2) [0, M3[c], 7, 12].forEach((d, k) => note(ev, i * 4 + 2 + k * .5, R[c] + 24 + d, .25, 70, 4));
  }));
  const arps = track('Arps', null, 5, ev => bars.forEach((c, i) => {
    [0, 7, 12, 12 + M3[c], 19, 12 + M3[c], 12, 7].forEach((d, k) => note(ev, i * 4 + k * .5, R[c] - 12 + d, 1.5, k ? 64 : 84, 5));   // let ring
  }));
  const kit = track('Kit', null, 9, ev => {
    for (let b = 0; b < 64; b++){ note(ev, b, b % 2 ? 40 : 35, .25, 100, 9); note(ev, b + .5, 54, .25, 60, 9); }   // the OTHER kick/snare + tambourine
  });
  return buildMidi({ format: 1, ppq: PPQ, tracks: [melody, counter, pad, low, sparkle, arps, kit] });
}

/* ---------------------------------------------------------------------------
   PIANO HANDS — ONE track, program 0, both hands (Tetris / Zelda-title shaped): a right-
   hand melody over its own off-beat chords, a left hand walking under it. Split into the
   top line (belt lead) · the left hand (string bass) · the inner chords (marimba).
   --------------------------------------------------------------------------- */
export function pianoHands(){
  const t = track('Piano', 0, 0, ev => {
    const MEL = [76, 71, 72, 74, 72, 71, 69, 69, 72, 76, 74, 72, 71, 72, 74, 76];
    const LH = [45, 52, 40, 47, 45, 52, 41, 48];
    for (let bar = 0; bar < 16; bar++){
      const top = MEL[bar];
      line(ev, bar * 4, [[top, 1], [top - 5, .5], [top - 4, .5], [top - 2, 1], [top - 4, .5], [top - 5, .5]], 0, 96);
      for (const off of [.5, 1.5, 2.5, 3.5]) for (const d of [7, 10]) note(ev, bar * 4 + off, top - 12 - d + 12 - 5, .4, 60, 0);   // inner chords
      LH.slice((bar % 2) * 4, (bar % 2) * 4 + 4).forEach((m, k) => note(ev, bar * 4 + k, m, .9, 84, 0));
    }
  }, [{ tick: 0, type: 'tempo', uspq: uspq(132) }]);
  return buildMidi({ format: 1, ppq: PPQ, tracks: [t] });
}

export const FIXTURES = { 'room-tour': roomTour, 'canon-in-d': canonInD, 'night-mallets': nightMallets,
                          'sketch-band': sketchBand, 'piano-hands': pianoHands };

/* ---------------------------------------------------------------------------
   GOLDEN INPUTS — files the orchestra must import EXACTLY as the classic importer
   (a69c84a) did: program-less sketches + a piano-only file. Their a69c84a outputs are
   committed in test/fixtures/midi-golden-a69c84a.json (made by
   scripts/make-midi-golden.mjs against `git show a69c84a:src/midi/*`). Not written
   to public/. Each ends on a SHORT last note — that's what the loop length guards.
   --------------------------------------------------------------------------- */
function sketchTrio(){
  const lead = track('Lead', null, 0, ev => {
    const seq = [[76,1],[74,.5],[72,.5],[71,1],[69,1],[72,1.5],[74,.5],[76,2],
                 [77,1],[76,1],[74,1],[72,1],[71,.5],[72,.5],[74,1],[67,2],
                 [69,1],[71,1],[72,1],[74,1],[76,1.5],[77,.5],[79,1],[81,1],
                 [79,.5],[77,.5],[76,.5],[74,.5],[72,1],[71,1],[72,3.5],[74,.5]];
    line(ev, 0, seq, 0, 96);
  }, [{ tick: 0, type: 'tempo', uspq: uspq(112) }]);
  const comp = track('Comp', null, 1, ev => {
    for (let b = 0; b < 32; b += 2) for (const m of [60, 64, 67].map(x => x + (b % 8 < 4 ? 0 : -3))) note(ev, b, m, 2, 70, 1);
  });
  const low = track('Low', null, 2, ev => {
    for (let b = 1; b < 32; b++) note(ev, b, [48, 43, 45, 41][(b >> 2) % 4] + (b % 2 ? 0 : 7), 1, 88, 2);
  });
  const drums = track('Kit', null, 9, ev => {
    note(ev, -0, 49, 1, 110, 9);
    for (let b = 0; b < 32; b++){ note(ev, b, b % 2 ? 38 : 36, .25, 100, 9); note(ev, b + .5, 42, .25, 60, 9); }
  });
  return buildMidi({ format: 1, ppq: PPQ, tracks: [lead, comp, low, drums] });
}
function pianoSolo(){                       // Tetris-shaped: one piano track, pc 0, chords, ends on an eighth
  const t = track('Piano', 0, 0, ev => {
    let b = 0;
    for (let bar = 0; bar < 17; bar++){
      const top = [76, 71, 72, 74, 72, 71, 69, 69][bar % 8];
      for (const [d, m] of [[1, top], [.5, top - 5], [.5, top - 4], [1, top - 2], [.5, top - 4], [.5, top - 5]]){
        note(ev, b, m, d, 92, 0);
        if (d === 1) note(ev, b, m - 12, d, 70, 0);       // left-hand octave under the beat
        b += d;
      }
    }
  }, [{ tick: 0, type: 'tempo', uspq: uspq(120) }]);
  return buildMidi({ format: 1, ppq: PPQ, tracks: [t] });
}
function sketchFormat0(){
  const ev = [{ tick: 0, type: 'tempo', uspq: uspq(96) }];
  line(ev, 2, [[67,1],[69,1],[71,1],[72,1],[74,2],[72,.5],[71,.5],[69,2],[67,.5]], 0, 90);
  line(ev, 0, [[43,2],[48,2],[50,2],[43,2],[48,2],[43,1]], 1, 80);
  for (let b = 0; b < 12; b++) note(ev, b, 42, .25, 50, 9);
  return buildMidi({ format: 0, ppq: PPQ, tracks: [{ events: ev }] });
}
export const GOLDEN_INPUTS = { 'sketch-trio': sketchTrio, 'piano-solo': pianoSolo, 'sketch-format0': sketchFormat0 };
