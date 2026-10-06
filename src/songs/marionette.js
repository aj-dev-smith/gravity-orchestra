/* FUNERAL MARCH OF A MARIONETTE — Charles Gounod (Marche funèbre d'une marionnette,
   1872). Public domain. The Hitchcock theme. A puppet has broken in a duel; its fellow
   marionettes carry it off in a mock-solemn procession — playful, a little sinister.
   Transcribed in gesture from the score (checked against a flute reduction): the theme's
   octave hop (the puppet's stiff little step), the dotted 6/8 lilt, the episode on A.

   KEY: D minor (an episode on its dominant, A). 6/8 — two big lilting beats a bar;
   counted here in QUARTER beats, so a bar = 3 beats and an eighth = .5.

   TEMPO / THE SEAM: bpm = 60·6/3.8 ≈ 94.7 (dotted quarter ≈ 63, Gounod's Allegretto),
   so the loop's fixed 3.8 s breath is EXACTLY 6 beats = 2 bars: the last D + the breath
   land the procession back on its first step ON the downbeat. 96 + 6 = 102 beats = 34
   bars, ~64.6 s.

   FORM:
     A   0–48   THE PROCESSION: the theme twice-and-a-half (the octave hop D4→D5, the
                turn D·C#·B·C#, the climb to E6 and the chromatic tumble), its second half
                ending with the mock-sob E5–D5. Lead alone at first, the MUSIC BOX joins
                an octave up for the second half (a wind-up toy's shadow).
     B  48–72   THE EPISODE ON A: the hop moves to A, sweeter; the TURNTABLE (vibraphone)
                carries it an octave down, the music box glints; a climb to E6 over F and
                C (Gounod's sidestep) and a sigh home.
     A' 72–96   THE PROCESSION AGAIN: the theme's closing half — everyone, the bell tolls
                for the puppet, the bass drum walks, and the mock-sob lands on D.

   WHO PLAYS: lead belt (the theme), string bass (pizzicato roots on both dotted beats —
   7 strings: D2 A1 F2 G1 D#2 E2 C2), marimba (the puppets' wooden clatter: soft dry
   dyads on the off-eighths; the final one is D·F so the four-mallet marimbist's hands
   cross the seam cleanly), music box (C5–C7: the octave shadow + glints), turntable
   (A3–E5: the episode's melody and the return's lower octave), bowls (a soft dirge drone on A),
   bells (the funeral toll), drums (a muffled bass drum + a ticking snare: the march).
   ============================================================ */

const PC = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const num = n => { const m = /^([A-G]#?)(\d)$/.exec(n); return PC.indexOf(m[1]) + 12 * (+m[2] + 1); };
const name = k => PC[k % 12] + (Math.floor(k / 12) - 1);
const tr = (line, s) => line.map(([n, b]) => [name(num(n) + s), b]);
const r5 = x => +x.toFixed(5);
const pin = (line, at, v = .8) => {
  let b = at; const out = [];
  for (const [n, d] of line){ out.push([r5(b), n, typeof v === 'function' ? +v(out.length).toFixed(3) : v]); b += d; }
  return out;
};
const sum = line => line.reduce((s, [, d]) => s + d, 0);

// ---- the theme ---------------------------------------------------------------------
const HOP = [['D4', 1], ['D5', .5], ['D5', .5], ['C#5', .5], ['B4', .5]];      // the puppet's step
const PHRASE_1 = [                                                               // 24 beats
  ...HOP, ['C#5', 1], ['D5', .5], ['E5', 1], ['A4', .5],
  ...HOP, ['C#5', 1], ['D5', .5], ['E5', 1], ['A4', .5],
  ['D4', 1], ['F5', .5], ['A5', 1], ['G5', .5], ['F5', 1], ['A5', .5], ['C6', 1], ['A#5', .5],
  ['A5', 1], ['C6', .5], ['E6', 1], ['D6', .5], ['C#6', .5], ['A#5', .5], ['A5', .5], ['G5', .5], ['F5', .5], ['E5', .5],
];
const PHRASE_2 = [                                                               // 24 beats — ends on the mock-sob
  ...HOP, ['C#5', 1], ['D5', .5], ['E5', 1], ['A4', .5],
  ...HOP, ['C#5', 1], ['D5', .5], ['E5', 1], ['C#5', .5],
  ['D5', 1], ['A5', .5], ['C6', 1], ['A#5', .5],
  ['A5', .5], ['G5', .5], ['F5', .5], ['D#5', .5], ['G5', .5], ['A#5', .5],
  ['D5', .5], ['C#5', .5], ['D5', .5], ['E5', 1], ['F5', .5],
  ['E5', 1.5], ['D5', 1.5],
];
const EPISODE = [                                                                // 24 beats, on A
  ['A4', 1], ['A5', .5], ['A5', .5], ['G#5', .5], ['A5', .5], ['C#6', 1], ['B5', .5], ['A5', 1], ['G#5', .5],
  ['A4', 1], ['A5', .5], ['A5', .5], ['G#5', .5], ['A5', .5], ['C#6', 1], ['B5', .5], ['A5', 1], ['G#5', .5],
  ['A4', 1], ['A5', .5], ['A#5', .75], ['C6', .25], ['D6', .5],
  ['E6', 1], ['A5', .5], ['A#5', .75], ['C6', .25], ['D6', .5],
  ['E6', 1], ['A5', .5], ['A5', .5], ['G5', .5], ['F5', .5],
  ['G5', .5], ['A5', .5], ['G5', .5], ['F5', 1], ['E5', .5],
];

const melody = [...PHRASE_1, ...PHRASE_2, ...EPISODE, ...PHRASE_2];

// ---- harmony: one chord per 6/8 bar -------------------------------------------------
const CH_1 = ['Dm', 'A', 'Dm', 'A', 'Dm', 'F', 'Am', 'A7'];
const CH_2 = ['Dm', 'A', 'Dm', 'A', 'Gm', 'Eb', 'A7', 'A7>Dm'];
const CH_E = ['A', 'E7', 'A', 'E7', 'F', 'C7', 'A7', 'A7'];   // (bar 5 on F: the line A·A·A#·C·D = root-3rd, passing, 5th, 6th)
const CHART = [...CH_1, ...CH_2, ...CH_E, ...CH_2];
const ROOT = { Dm: 'D2', A: 'A1', F: 'F2', Am: 'A1', A7: 'A1', Gm: 'G1', Eb: 'D#2', E7: 'E2', Bb: 'A#1', C7: 'C2' };
const DYAD = {                                    // the clatter: two soft notes under the tune
  Dm: ['F4', 'A4'], A: ['E4', 'A4'], F: ['F4', 'A4'], Am: ['E4', 'A4'], A7: ['E4', 'G4'], Gm: ['D4', 'G4'],
  Eb: ['G4', 'A#4'], E7: ['E4', 'G#4'], Bb: ['F4', 'A#4'], C7: ['E4', 'G4'],
};

const bass = [], marimba = [];
CHART.forEach((c, i) => {
  const b = 3 * i;
  if (c === 'A7>Dm'){                             // the cadence bar: A on the first beat, D on the second
    bass.push([b, 'A1', .7], [b + 1.5, 'D2', .75]);
    // (the last clatter lands on D·F, the root under the mock-sob's D — not F·A, the very
    // dyad that opens the loop: across the seam the robot marimbist's two hands converged
    // on it and brushed, and the no-cross guard's shove broke the carriage limits)
    marimba.push([b + .5, 'E4', .32], [b + .5, 'G4', .3], [b + 2, 'D4', .32], [b + 2, 'F4', .3]);
    return;
  }
  const v = i >= 24 ? .78 : .66;
  // a march bass: root, then (in D minor) the fifth below — so the theme's C# turn rubs
  // nothing but its own resolution
  bass.push([b, ROOT[c], v], [b + 1.5, c === 'Dm' ? 'A1' : ROOT[c], +(v * .7).toFixed(3)]);
  for (const off of [.5, 1, 2, 2.5]) for (const n of DYAD[c]) marimba.push([b + off, n, +((off % 1 ? .3 : .26) * (i >= 24 ? 1.2 : 1)).toFixed(3)]);
});

// ---- plugins ------------------------------------------------------------------------
// MUSIC BOX: the octave shadow of the second phrase, glints in the episode, and the
// shadow again at the end — a wind-up toy following the coffin
const musicbox = [
  ...pin(tr(PHRASE_2, 12).filter(([n]) => num(n) <= num('C7')), 24, i => i % 2 ? .38 : .5),
  [48, 'A6', .45], [54, 'A6', .45], [60, 'D6', .5], [63, 'E6', .45], [66, 'C#6', .45],
  ...pin(tr(PHRASE_2, 12), 72, i => i % 2 ? .42 : .55),
];
// TURNTABLE (vibraphone, mono): the episode an octave down, then the return an octave down
const turntable = [
  ...pin(tr(EPISODE, -12), 48, i => i % 3 ? .45 : .6),
  ...pin(tr(PHRASE_2, -12).map(([n, d]) => [num(n) < num('F3') ? name(num(n) + 12) : n, d]), 72, .45),
];
// BOWLS: a soft dirge drone on A, the procession's floor; D only for the last step
// (A, the dominant: it sits under both the D minor and the A bars without a rub)
const bowls = [
  [0, 'A3', .32, 6], [24, 'A3', .32, 6], [60, 'A3', .3, 3], [63, 'C4', .28, 3],
  [72, 'A3', .4, 6], [94.5, 'D3', .45, 7], [94.5, 'A3', .38, 7],
];
// BELLS: the funeral toll
// (A while the theme turns round its C#; D only on the final step)
const bells = [[0, 'A4', .55], [24, 'A4', .45], [72, 'A4', .7], [94.5, 'D4', .6], [94.5, 'D5', .4]];

// ---- drums: a muffled bass drum on the first step of every bar, a ticking snare -----
const kick = [], snare = [], floorHigh = [], crash = [];
for (let b = 0; b < 96; b += 3){ kick.push([b, b % 12 === 0 ? .5 : .32]); snare.push([b + 1.5, b >= 72 ? .3 : .2]); }
floorHigh.push([46.5, .6], [70.5, .55], [71, .6], [71.5, .7]);
crash.push([72, .45]);

export default {
  label: 'Funeral March of a Marionette', sub: 'Gounod · good evening (the puppet procession)',
  bpm: 60 * 6 / 3.8,                                 // ≈ 94.7: the loop's 3.8 s breath = 6 beats = 2 bars of 6/8
  scale: ['D', 'E', 'F', 'G', 'A', 'A#', 'C', 'C#'],
  room: 'graveyard',
  melody,
  parts: { musicbox, turntable, marimba, bass, bowls, bells },
  mix: { musicbox: .75, turntable: .62, marimba: .5, bass: .72, bowls: .55, bells: .75 },
  director: { musicbox: 1.6, turntable: 1.6, bells: 1.8, marimba: .5,   // the clatter is dense but it's the accompaniment
    shots: { bells: { x: 4.5, up: 7.2, dist: 12.5 } },   // the toll against the moon, clear of the music box
    at: [[0, 'stage', 6], [48, 'turntable', 12], [71.6, 'bells', 6], [90, 'stage', 6]] },   // the procession, the episode, the toll
  storm: [72],                                       // one distant flicker as the puppet's bell tolls
  drums: { kick, snare, floorHigh, crash },
};

export const _marionette = { sum, melodyBeats: sum(melody) };
