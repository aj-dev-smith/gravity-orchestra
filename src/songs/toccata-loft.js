/* ============================================================
   TOCCATA IN THE LOFT — J. S. Bach, Toccata (and Fugue) in D minor, BWV 565
   (attrib.; c. 1704–1750). Public domain. The organ piece, at last played by an
   ORGAN: the LIGHT ORGAN hung in the cathedral's gallery is the star, every held
   note a slow visible breath (the bellows lid sinking for exactly the note's
   length, a column of ice-blue light climbing out of the pipe into the loft's air).
   The belt marble carries the running lines the organist's fingers would, the
   BOW WHEEL bows the pedal tones (a 16' reed you can watch grind on its rosined
   rim), and the MARBLE GRAND (key 'dulcimer') takes the figuration — the broken
   chords, the waterfalls, the rolled spreads — that an organ toccata scatters
   between its hands.

   Transcribed in GESTURE from the toccata (not the fugue): the three-octave
   mordent call, the diminished-seventh chord built up note by note over the
   low pedal D and its resolution, the prestissimo runs, the pedal solo, the
   hammered chords, and the final cadence. Bach's free, fermata-strewn timing is
   squared into 4/4 bars so the loop can close on the pulse. (The original
   belt-only 'toccata' song is untouched — this is its full-room sibling.)

   KEY: D minor (harmonic: the C# leading tone; the dim7 C#·E·G·B♭ is the
   piece's signature colour). 4/4.

   TEMPO / THE SEAM: bpm = 60·5/3.8 ≈ 78.95, so the loop's fixed 3.8 s breath is
   EXACTLY 5 beats: melody 75 beats + 5 = 80 = 20 whole bars, ~61 s a loop. The
   final D-minor chord is held by the organ through the breath (8 beats ≈ 6.1 s,
   under its 8 s bellows limit), so the loop falls out of a ringing tonic into
   silence-then-the-call on A — exactly how the piece itself begins. (Change the
   bpm and the seam drifts off the pulse — re-solve 5 beats = 3.8 s.)

   FORM (beats):
     §1   0–18   THE CALL. The mordent A–G–A, held; the falling G F E D to the
                 C# (held) and the D (held). Three times, each an octave lower:
                 belt + organ in OCTAVES (the organ an octave under the marble —
                 the real piece is in octaves), soft for the echo, full for the
                 third, which sinks into the organ's 16' register and shakes its
                 mordent into a longer trill (A G A G A — as organists play the
                 low one; it also keeps the belt's weave inside its bay). Stark:
                 no one else plays. Long notes = the tallest arcs, the 32nds = skims.
     §2  18–28   THE ROLLED CHORD. The pedal low D (organ + the BOW WHEEL's first
                 stroke) and the dim7 built up from the bottom, a pipe every half
                 beat, C#3 → A#4, and HELD — nine pipes breathing at once, eight
                 columns of light standing in the loft (the organ's money shot).
                 The belt climbs the same chord an octave up to a 4-beat A#5 lob;
                 the grand shimmers a rolled dim7 high over it; then the
                 resolution to D MAJOR (as Bach writes it), rolled on the grand.
     §3  28–44   PRESTISSIMO. The belt runs in 16ths (falling sequences, a dim7
                 sweep to C#6, the A–G# shake), the organ sustains one chord per
                 half-bar under it (Dm · A7 · Dm · C#°7 · Gm/B♭ · A · Dm/F B♭ ·
                 A7), the bow wheel walks the pedal (D · C# · B♭ · A), the grand
                 plays the other hand's broken chords in 8ths.
     §4  44–48   THE PEDAL SOLO. Everyone stops but the BOW WHEEL: a bowed pedal
                 line D C# D E F G E → A, the belt hanging one tall arc over it.
         48–56   THE HAMMERED CHORDS. Two fortissimo dim7 blows (organ + grand,
                 the belt plunging between them), then a held D-minor 6/4 over the
                 pedal A (a 3-second column) while the belt climbs and the grand
                 pours a waterfall down the bed, then Gm/B♭ with the belt falling.
     §5  56–75   THE CADENCE. The call returns over a held A7 (the mordent on
                 A5, the organ breathing four whole beats), Gm → A7 → Dm with the
                 runs, a plagal Gm/D, a rising harmonic-minor run, and the final
                 D minor — organ, bow wheel and a rolled grand spread — held into
                 the loop's breath.

   WHO LIVES WHERE:
     lead (belt)   C#3–C#6  the runs and the call (the third call takes the marble
                            down to octave 3; the organ doubles it an octave under)
     organ         D2–A#4   octave doublings, held chords, the pedal (D2/A2/A#2).
                            ≤ 36 pipes (here 22); held notes up to 8 beats (6.1 s)
     bow wheel     C#2–D3   the pedal: 8 strings (≤ 12), strokes ≤ 5 beats (3.8 s,
                            under its 3.9 s sustain), same-string re-bows ≥ .5 beat
     grand         A3–A#5   figuration in 8ths (≥ .38 s per string, its retrigger
                            floor is .21 s), rolled chords (.125-beat spread),
                            ≤ 20 strings (here 17)
   No drums: an organ toccata has none, and the pedal + the hammered chords are
   all the weight the piece needs.

   MIX: the organ is the soloist (full level); the bow wheel sits just under it as
   the 16' pedal; the grand's figuration is kept below the belt's runs, and
   steps up for the hammered chords. Velocity stays dynamics: the echo statement
   is soft, the third and the hammered chords strike hard (brighter light).

   DIRECTOR: the organ gets the call and the rolled chord scripted (its held
   columns are why the piece exists), the belt the prestissimo runs, the grand its
   figuration, the bow wheel its solo, the wide shot the hammered chords, and the
   organ the final chord breathing into the seam.

   iOS NOTE (§5): the sample path ignores `dur` — each organ/bow note rings its
   whole render there. The pedal and chord tones are chosen so a ring-on stays
   inside the next harmony (the chords move by common tones over the D/A pedal).
   ============================================================ */

// ---- helpers ---------------------------------------------------------------------
const PC = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const num = n => { const m = /^([A-G]#?)(\d)$/.exec(n); return PC.indexOf(m[1]) + 12 * (+m[2] + 1); };
const name = k => PC[k % 12] + (Math.floor(k / 12) - 1);
const tr = (line, s) => line.map(([n, b]) => [name(num(n) + s), b]);
const r5 = x => +x.toFixed(5);
const sum = line => line.reduce((s, [, d]) => s + d, 0);
const h = (ns, d) => ns.map(n => [n, d]);
/** a chained line → pinned events from `at`: velocity v, each held `leg` of its value */
const pin = (line, at, v = .8, leg = .9) => {
  let b = at; const out = [];
  for (const [n, d] of line){ out.push([r5(b), n, v, r5(d * leg)]); b += d; }
  return out;
};
/** a block chord: every note at `at`, velocity v, held d beats */
const chord = (at, ns, v, d) => ns.map(n => [at, n, v, d]);
/** a rolled chord, bottom up: note i enters at at + i·step, all released together at at + d */
const rolled = (at, ns, v, d, step = .125) => ns.map((n, i) => [r5(at + i * step), n, +(v + .04 * i).toFixed(2), r5(d - i * step)]);
/** 8th-note figuration: one note per half beat from `at`, each held `len` beats */
const eighths = (at, ns, v, len = .45) => ns.map((n, i) => [r5(at + i * .5), n, v, len]);

// ---- §1 the call (6 beats): mordent, held A; falling G F E D; held C#; held D ------
const CALL = [['A5', .25], ['G5', .25], ['A5', 1.5], ...h(['G5', 'F5', 'E5', 'D5'], .25), ['C#5', 1.5], ['D5', 1.5]];
// the third call shakes its mordent longer — a trill (A G A G A), as organists play the low one
const CALL_TRILL = [['A5', .25], ['G5', .25], ['A5', .25], ['G5', .25], ['A5', 1], ...CALL.slice(3)];
// §5's recall over the A7 (4 beats): the mordent, the fall, landing on the leading tone
const RECALL = [['A5', .25], ['G5', .25], ['A5', 1.5], ...h(['G5', 'F5', 'E5', 'D5'], .25), ['C#5', 1]];

// ---- the belt: the organist's fingers ------------------------------------------------
const melody = [
  // §1 0–18 — the call, three octaves down
  ...CALL, ...tr(CALL, -12), ...tr(CALL_TRILL, -24),
  // §2 18–28 — climbing the dim7 an octave over the organ's roll, the apex lob, D major
  ...h(['C#4', 'E4', 'G4', 'A#4', 'C#5', 'E5'], .5), ['G5', 1], ['A#5', 4], ['F#5', 2],
  // §3 28–44 — prestissimo
  ...h(['A5', 'G5', 'A5', 'F5', 'E5', 'F5', 'D5', 'A4'], .25),                 // 28 Dm
  ...h(['G5', 'F5', 'G5', 'E5', 'C#5', 'E5', 'A4', 'C#5'], .25),               // 30 A7
  ...h(['D5', 'F5', 'A5', 'F5'], .5),                                          // 32 Dm (8ths: a breath)
  ...h(['C#5', 'E5', 'G5', 'A#5', 'C#6', 'A#5', 'G5', 'E5'], .25),             // 34 C#°7 sweep
  ...h(['D5', 'G5', 'A#5', 'G5'], .5),                                         // 36 Gm/B♭
  ...h(['A5', 'G#5', 'A5', 'G#5', 'A5', 'E5', 'C#5', 'A4'], .25),              // 38 A: the shake, the fall
  ...h(['F5', 'D5', 'A#5', 'F5'], .5),                                         // 40 Dm/F → B♭
  ...h(['G5', 'E5', 'C#5', 'A4'], .25), ['C#5', .5], ['E5', .5],               // 42 A7
  // §4 44–48 — one tall arc over the pedal solo
  ['D5', 4],
  // §4 48–56 — plunging between the blows, climbing the held 6/4, falling into Gm
  ...h(['A#5', 'G5', 'E5', 'C#5', 'A#4', 'G4', 'E4', 'C#4'], .25),             // 48–50 the two blows
  ...h(['D4', 'F4', 'A4', 'D5', 'F5'], .5), ['A5', 1.5],                       // 50–54 Dm 6/4
  ...h(['A#5', 'A5', 'G5', 'F5', 'E5', 'D5'], .25), ['C#5', .5],               // 54–56 Gm/B♭ → A
  // §5 56–75 — the call returns; the cadence
  ...RECALL,                                                                   // 56 A7
  ...h(['D5', 'G5', 'A#5', 'G5'], .5),                                         // 60 Gm
  ...h(['A5', 'G5', 'F5', 'E5'], .25), ['C#5', .5], ['E5', .5],                // 62 A7
  ...h(['A5', 'G5', 'F5', 'E5', 'D5', 'C#5', 'D5', 'A4'], .25),                // 64 Dm
  ['A#4', .5], ['D5', .5], ['G5', .5], ['A#5', .5],                            // 66 Gm/D (plagal)
  ...h(['A4', 'A#4', 'C#5', 'D5', 'E5', 'F5', 'G5', 'A5', 'A#5', 'A5', 'G5', 'E5'], .25),  // 68 A7: the run
  ['D5', 4],                                                                   // 71 the final D (+ the breath)
];

// ---- the organ: octaves, held chords, the pedal --------------------------------------
// the dim7 roll (§2): the pedal D, then a pipe every half beat from C#3, all held to 25.85
const ROLL = ['C#3', 'E3', 'G3', 'A#3', 'C#4', 'E4', 'G4', 'A#4'];
const organ = [
  // §1 the call in octaves under the marble: soft-full, the echo softer, the third full + the 16'
  ...pin(tr(CALL, -12), 0, .8, .95),
  ...pin(tr(CALL, -24), 6, .66, .95),
  ...pin(tr(CALL_TRILL, -36), 12, .9, .95), ...pin(tr(CALL_TRILL, -24), 12, .78, .95),
  // §2 the rolled chord — nine pipes breathing at once
  [18, 'D2', .95, 7.85],
  ...ROLL.map((n, i) => [18 + i * .5, n, +(.58 + .04 * i).toFixed(2), r5(7.85 - i * .5)]),
  ...chord(26, ['D2', 'D3', 'F#3', 'A3', 'D4'], .85, 1.9),         // → D major (Bach's own)
  // §3 one chord per half-bar under the runs
  ...chord(28, ['D3', 'F3', 'A3', 'D4'], .7, 1.9),
  ...chord(30, ['A2', 'C#3', 'E3', 'G3', 'A3'], .66, 1.9),
  ...chord(32, ['D3', 'F3', 'A3', 'D4'], .62, 1.9),
  ...chord(34, ['C#3', 'E3', 'G3', 'A#3'], .72, 1.9),
  ...chord(36, ['A#2', 'D3', 'G3', 'A#3'], .66, 1.9),
  ...chord(38, ['A2', 'C#3', 'E3', 'A3'], .72, 1.9),
  ...chord(40, ['D3', 'F3', 'A3'], .64, .9), ...chord(41, ['A#2', 'D3', 'F3'], .64, .9),
  ...chord(42, ['A2', 'C#3', 'E3', 'G3'], .74, 1.9),
  // §4 (44–48: the organ rests — the pedal solo is the bow wheel's) the hammered chords
  ...chord(48, ['A2', 'C#3', 'E3', 'G3', 'A#3', 'C#4', 'E4'], 1, .7),
  ...chord(49, ['A2', 'C#3', 'E3', 'G3', 'A#3', 'C#4', 'E4'], .95, .7),
  ...chord(50, ['A2', 'D3', 'F3', 'A3', 'D4', 'F4'], .9, 3.85),      // the 6/4: a 3-second column
  ...chord(54, ['A#2', 'D3', 'G3', 'A#3', 'D4', 'G4'], .82, 1.9),
  // §5 the cadence
  ...chord(56, ['A2', 'E3', 'G3', 'C#4', 'E4'], .8, 3.85),           // the call returns over A7
  ...chord(60, ['A#2', 'D3', 'G3', 'A#3', 'D4'], .72, 1.9),
  ...chord(62, ['A2', 'C#3', 'E3', 'G3', 'A3'], .78, 1.9),
  [64, 'D2', .85, 6.85],                                             // the tonic pedal, 64 → 71
  ...chord(64, ['D3', 'F3', 'A3', 'D4'], .72, 1.9),
  ...chord(66, ['D3', 'G3', 'A#3', 'D4'], .7, 1.9),                  // plagal Gm/D
  ...chord(68, ['C#3', 'E3', 'G3', 'A3'], .76, 2.9),
  ...chord(71, ['D2', 'D3', 'F3', 'A3', 'D4', 'F4'], .9, 8),        // the final D minor, into the breath
];

// ---- the bow wheel: the 16' pedal --------------------------------------------------------
const bowwheel = [
  [18, 'D2', .8, 5], [23, 'D3', .62, 2.85],                         // the pedal under the roll; the octave lifts with it
  [26, 'D2', .75, 1.9],                                             // D major
  [28, 'D2', .7, 1.9],
  [30, 'A2', .66, 1.9], [32, 'D2', .62, 1.9], [34, 'C#2', .7, 1.9],
  [36, 'A#2', .66, 1.9], [38, 'A2', .72, 1.9], [40, 'D2', .62, .9], [41, 'A#2', .62, .9],
  [42, 'A2', .74, 1.9],
  // THE PEDAL SOLO
  [44, 'D2', .9, .9], [45, 'C#2', .75, .45], [45.5, 'D2', .78, .45], [46, 'E2', .8, .45],
  [46.5, 'F2', .84, .45], [47, 'G2', .88, .45], [47.5, 'E2', .84, .45],
  [48, 'A2', .95, 1.85], [50, 'A2', .85, 3.85], [54, 'A#2', .78, 1.9],
  [56, 'A2', .78, 3.85], [60, 'A#2', .7, 1.9], [62, 'A2', .74, 1.9],
  [64, 'D2', .72, 3.9], [68, 'A2', .74, 2.9],
  [71, 'D2', .85, 5], [71, 'D3', .62, 5],                           // the final D, bowed into the breath
];

// ---- the grand: figuration, spreads, the blows --------------------------------------------
const dulcimer = [
  ...rolled(22, ['C#5', 'E5', 'G5', 'A#5'], .5, 3.85),              // a dim7 shimmer high over the held roll
  ...rolled(26, ['D3', 'A3', 'D4', 'F#4', 'A4', 'D5'], .6, 1.9),     // D major, spread like a harp
  // §3 the other hand: broken chords in 8ths
  ...eighths(28, ['D4', 'A4', 'F4', 'A4'], .48),
  ...eighths(30, ['C#4', 'A4', 'E4', 'G4'], .5),
  ...eighths(32, ['D4', 'A4', 'F4', 'A4'], .5),
  ...eighths(34, ['C#4', 'G4', 'E4', 'A#4'], .55),
  ...eighths(36, ['D4', 'G4', 'A#4', 'G4'], .52),
  ...eighths(38, ['C#4', 'E4', 'A4', 'E4'], .56),
  ...eighths(40, ['D4', 'F4', 'A#4', 'F4'], .52),
  ...eighths(42, ['C#4', 'E4', 'G4', 'A4'], .58),
  // §4 the blows, then the waterfall down the bed over the held 6/4, then Gm
  ...chord(48, ['C#4', 'E4', 'G4', 'A#4'], .85, .6), ...chord(49, ['C#4', 'E4', 'G4', 'A#4'], .8, .6),
  ...eighths(50, ['A5', 'F5', 'D5', 'A4', 'F4', 'D4', 'A3', 'D4'], .6),
  ...eighths(54, ['G4', 'A#4', 'D5', 'G5'], .55),
  // §5 the cadence
  ...rolled(56, ['A3', 'E4', 'G4', 'C#5'], .5, 3.8),
  ...eighths(60, ['G4', 'A#4', 'D5', 'A#4'], .5),
  ...eighths(62, ['A4', 'C#5', 'E5', 'C#5'], .52),
  ...eighths(64, ['D4', 'A4', 'F4', 'A4'], .48),
  ...eighths(66, ['D4', 'G4', 'A#4', 'G4'], .48),
  ...eighths(68, ['C#4', 'E4', 'G4', 'A4'], .52),
  ...rolled(71, ['D3', 'A3', 'D4', 'F4', 'A4', 'D5'], .6, 4),        // the final spread
];

const byBeat = (a, b) => a[0] - b[0];

export default {
  label: 'Toccata in the Loft', sub: 'Bach · BWV 565 · the light organ, the bow wheel, the marble grand',
  bpm: 60 * 5 / 3.8,                                  // ≈ 78.95: the loop's 3.8 s breath = 5 beats (see header)
  scale: ['A', 'A#', 'C', 'C#', 'D', 'E', 'F', 'G'],
  room: 'cathedral',
  melody,
  parts: {
    organ: organ.sort(byBeat),
    bowwheel: bowwheel.sort(byBeat),
    dulcimer: dulcimer.sort(byBeat),
  },
  // AUDIO-ONLY levels (velocity stays dynamics): the organ is the soloist
  mix: {
    organ: 1,
    bowwheel: .78,
    dulcimer: [[0, .55], [48, .7], [56, .55]],       // under the runs; up for the blows + the waterfall
  },
  director: {
    // pulls: the organ is the star; the grand's busy 8ths must not outvote it
    organ: 1.8, bowwheel: 1.5, dulcimer: 1.1,
    shots: { bowwheel: { x: 4, up: 3, dist: 20 } },
    at: [
      [0, 'organ', 12],       // the call (and its echo) from the loft
      [12, 'stage', 6],       // the third call sinks into the 16': the whole cathedral
      [18, 'organ', 10],      // the rolled chord — nine columns of light standing
      [28, 'lead', 8],        // prestissimo: the marble runs
      [36, 'dulcimer', 8],    // the grand's figuration under the shake
      [44, 'bowwheel', 4],    // the pedal solo
      [48, 'stage', 4],       // the hammered chords: the whole room on the blows
      [52, 'organ', 4],       // the held 6/4 breathing
      [56, 'lead', 6],        // the call returns
      [64, 'bowwheel', 4],    // the tonic pedal grinding under the cadence
      [68, 'dulcimer', 3],    // the last run
      [71, 'organ', 9],       // the final chord, breathing into the seam
    ],
  },
};

export const _toccataLoft = { sum, melodyBeats: sum(melody) };
