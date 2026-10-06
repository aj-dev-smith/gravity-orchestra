/* MORNING MOOD — Grieg, Peer Gynt Suite No. 1, Op. 46 (1875). Public domain.

   THE SHOWCASE: everything the other arrangements aren't — slow, SUSTAINED, no drums,
   no marimba. The singing bowls are the string section: every chord is a marble
   rolling round a rim, held for seconds, the room glowing violet→aqua. The melody is
   pure pentatonic (5 3 2 1 2 3 · 5 3 2 1 2 3 · 5 3 5 6 · 3 6 5 3 · 2 1 — in E:
   B G# F# E …), so nothing can clash; the music box is the birds; the tubular bells
   are the sun coming up.

   1 beat = one EIGHTH note (6/8 counted in eighths: ♩ = 2, ♪ = 1, bar = 6 beats),
   so the lilting long-short pairs stay integers. bpm 192 (♩. ≈ 64, Allegretto
   pastorale).

   FORM (5 statements, 162 beats, ~51 s):
     P1   0   the FLUTE (belt lead) states the theme in E over a bowl drone (E · B,
              G# shimmering above) and a soft low-E pedal on the string bass;
              birds (music box) answer each held cadence
     P2  36   the OBOE: the same theme an octave down on the lead; the HORN (belt
              alto) enters underneath in long tall arcs (B G# C# B)
     P3  72   THE SUN BREAKS: Grieg's sudden lift up a major third to G# major —
              flute theme in G#, bowls swing to G# · D# · C(=B#), bass to G#1, the
              first tubular bell
     P4 108   FULL DAYLIGHT, back home in E: theme forte, the horn singing a
              counterline (G# E F# G# C# B), bells on every bar, the music box
              twinkling E-major arpeggios, bass walking E B E B C# B
     P5 144   coda: the opening cell twice, falling an octave, then one long E —
              bowls + bells + bass ring the last chord through the loop's breath.

   LOCK RULE: alto 126 + delay 36 = melody 162. String bass: E1 B1 G#1 C#2 E2 = 5.
   Bowls: E3 G#3 B3 C#4 D#4 G#4 C5 — 7 bowls, never more than 4 ringing. */

const PC = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const num = n => { const m = /^([A-G]#?)(\d)$/.exec(n); return PC.indexOf(m[1]) + 12 * (+m[2] + 1); };
const name = k => PC[k % 12] + (Math.floor(k / 12) - 1);
const tr = (line, s) => line.map(([n, b]) => [name(num(n) + s), b]);
/** MIX trim — scale a part's velocities (balanced offline: each stem's RMS against the belt lead) */
const trim = (part, k) => part.map(([b, n, v = 1, ...r]) => [b, n, +Math.min(1, v * k).toFixed(2), ...r]);

// the theme in E (flute octave): six bars of ♩♪♩♪, the last held
const THEME = [
  ['B5', 2], ['G#5', 1], ['F#5', 2], ['E5', 1],
  ['F#5', 2], ['G#5', 1], ['B5', 2], ['G#5', 1],
  ['F#5', 2], ['E5', 1], ['F#5', 2], ['G#5', 1],
  ['B5', 2], ['G#5', 1], ['B5', 2], ['C#6', 1],
  ['G#5', 2], ['C#6', 1], ['B5', 2], ['G#5', 1],
  ['F#5', 2], ['E5', 4],
];

// bowls — the strings: an E·B drone, G# shimmer, C# for the bar-5 colour
const bowlsE = (at, v) => [
  [at, 'E3', v, 15], [at, 'B3', v * .9, 15], [at + 3, 'G#4', v * .7, 12],
  [at + 18, 'E3', v, 15], [at + 18, 'B3', v * .9, 15], [at + 24, 'C#4', v * .75, 9],
];
const bowlsGs = (at, v) => [
  [at, 'G#3', v, 15], [at, 'D#4', v * .9, 15], [at + 3, 'C5', v * .7, 12],
  [at + 18, 'G#3', v, 15], [at + 18, 'D#4', v * .9, 15], [at + 27, 'C5', v * .7, 8],
];
// birds: a twitter over each held cadence (bar 6 of every statement)
const birds = (at, [a, b, c, d], v = .55) => [
  [at + 31, a, v], [at + 31.5, b, v * .8], [at + 32, a, v], [at + 32.5, b, v * .8],
  [at + 33, c, v * .9], [at + 34, d, v * .7], [at + 35, b, v * .6],
];
const twinkle = (at, v) => Array.from({ length: 6 }, (_, bar) =>
  ['E6', 'G#6', 'B6', 'G#6', 'E6', 'B5'].map((n, j) => [at + 6 * bar + j, n, +(v * (j ? .75 : 1)).toFixed(2)])).flat();

export default {
  label: 'Morning Mood', sub: 'Grieg · sunrise on singing bowls', bpm: 192,
  scale: ['E','F#','G#','B','C#'],

  melody: [
    ...THEME,                                   // P1  flute, E
    ...tr(THEME, -12),                          // P2  oboe, E, an octave down
    ...tr(THEME, 4),                            // P3  flute, G# — the sun breaks
    ...THEME,                                   // P4  full daylight, E
    ['B5', 2], ['G#5', 1], ['F#5', 2], ['E5', 1],   // P5 coda: the cell…
    ['B4', 2], ['G#4', 1], ['F#4', 2], ['E4', 1],   //   …falling an octave…
    ['E5', 6],                                      //   …and home
  ],
  // the horn: tall slow arcs under the oboe, then the counterline in daylight
  alto: {
    delay: 36,
    notes: [
      ['B3', 12], ['G#3', 12], ['C#4', 6], ['B3', 6],                    // P2
      ['D#4', 12], ['C4', 12], ['F4', 6], ['D#4', 6],                    // P3 (= +4)
      ['G#4', 6], ['E4', 6], ['F#4', 6], ['G#4', 6], ['C#4', 6], ['B3', 6],   // P4
      ['B3', 6], ['G#3', 6], ['E4', 6],                                  // P5
    ],
  },

  parts: {
    bowls: trim([
      ...bowlsE(0, .5), ...bowlsE(36, .55), ...bowlsGs(72, .68), ...bowlsE(108, .82),
      [144, 'E3', .6, 10], [144, 'B3', .5, 10],
      [156, 'E3', .85, 15], [156, 'B3', .75, 15], [156, 'G#4', .65, 15], [156, 'C#4', .4, 15],
    ], .6),     // a pad under the flute, not over it
    bass: [
      [0, 'E1', .55], [12, 'E1', .5], [24, 'E1', .55], [30, 'B1', .45],
      [36, 'E1', .6], [48, 'E1', .55], [60, 'C#2', .5], [66, 'B1', .5],
      [72, 'G#1', .8], [84, 'G#1', .65], [96, 'G#1', .7],
      [108, 'E1', 1], [108, 'E2', .7], [114, 'B1', .8], [120, 'E1', .9], [126, 'B1', .8],
      [132, 'C#2', .85], [138, 'B1', .8],
      [144, 'E1', .7], [150, 'E1', .6], [156, 'E1', .9], [156, 'E2', .6],
    ],
    musicbox: [
      ...birds(0, ['B6', 'G#6', 'E6', 'F#6']),
      ...birds(36, ['G#6', 'E6', 'B5', 'C#6'], .5),
      ...birds(72, ['C7', 'G#6', 'D#6', 'F6'], .62),
      ...twinkle(108, .55),
      [150, 'B6', .45], [151, 'G#6', .4], [152, 'E6', .4], [153, 'B5', .35],
      [156, 'E6', .6], [156, 'B6', .55],
    ],
    bells: [
      [72, 'G#4', .75],                                                  // the sun breaks
      [108, 'E4', .85], [114, 'B4', .7], [120, 'E5', .75], [126, 'G#4', .7],
      [132, 'C#5', .7], [138, 'B4', .65],
      [156, 'E4', .9], [156, 'B4', .7], [156, 'E5', .8],
    ],
  },
};
