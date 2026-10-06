/* MORNING MOOD — Grieg, Peer Gynt Suite No. 1, Op. 46 (1875). Public domain.

   THE SHOWCASE: everything the other arrangements aren't — slow, SUSTAINED, no drums,
   no marimba. The singing bowls are the string section: every chord is a marble
   rolling round a rim, held for seconds, the room glowing violet→aqua. The melody is
   pure pentatonic (5 3 2 1 2 3 · 5 3 2 1 2 3 · 5 3 5 6 · 3 6 5 3 · 2 1 — in E:
   B G# F# E …), so nothing can clash; the music box is the birds; the tubular bells
   are the sun coming up.

   1 beat = one EIGHTH note (6/8 counted in eighths: ♩ = 2, ♪ = 1, bar = 6 beats),
   so the lilting long-short pairs stay integers. bpm 60·12/3.8 ≈ 189.5 (♩. ≈ 63,
   Allegretto pastorale) — chosen so the loop's fixed 3.8 s breath (ROLL_T + 1.2) is
   EXACTLY 12 beats = two 6/8 bars: the final 6-beat E + the breath = three whole
   bars, and the flute re-enters on a downbeat, in tempo.

   FORM (5 statements, 162 beats, ~51 s):
     P1   0   the FLUTE (belt lead) states the theme in E over a bowl drone (E · B,
              G# shimmering above) and a soft low-E pedal on the string bass;
              birds (music box) answer each held cadence
     P2  36   the OBOE: the same theme an octave down on the lead; the HORN (belt
              alto) enters underneath, re-tonguing each long note once a bar (B B G# G#
              C# B): 6-beat arcs (~6 u) that stay in the band — a 12-beat note would be
              a 25 u lob that leaves half the belt empty and steals the director
     P3  72   THE SUN BREAKS: Grieg's sudden lift up a major third to G# major —
              flute theme in G#, bowls swing to G# · D# · C(=B#), bass to G#2, the
              first tubular bell; the horn pulses in dotted quarters (short hops),
              so the director's eye goes to the bowls and the bell, where the colour is
     P4 108   FULL DAYLIGHT, back home in E: theme forte, the horn singing a
              counterline (G# E F# G# C# B), bells on every bar, the music box
              twinkling E-major arpeggios, bass walking E B E B C# B
     P5 144   coda: the opening cell twice, falling an octave, then one long E —
              bowls + bells + bass ring the last chord through the loop's breath.

   LOCK RULE: alto 126 + delay 36 = melody 162. String bass: E2 B2 G#2 C#3 E3 = 5
   (cello register: an E1 pedal is inaudible on a phone — CLAUDE.md §5).
   Bowls: E3 G#3 B3 C#4 D#4 G#4 C5 — 7 bowls, never more than 4 ringing.

   iOS NOTE (§5): the sample path ignores a bowl's `dur` and rings the whole ~6 s
   (≈ 19 beats here). So the bowls are voiced for THAT: the last E-major strikes
   before the lift are E3 + G#3 (G# is the common tone of E and G# major), and the
   G#-major bowls stop striking B# / D# a bar before E major returns. */

const PC = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const num = n => { const m = /^([A-G]#?)(\d)$/.exec(n); return PC.indexOf(m[1]) + 12 * (+m[2] + 1); };
const name = k => PC[k % 12] + (Math.floor(k / 12) - 1);
const tr = (line, s) => line.map(([n, b]) => [name(num(n) + s), b]);

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
// (holds ≤ 15 beats = 4.75 s — the bowls' 5 s ceiling)
const bowlsE = (at, v, intoLift = false) => [
  [at, 'E3', v, 15], [at, 'B3', v * .9, 15], [at + 3, 'G#4', v * .7, 12],
  ...(intoLift
    ? [[at + 18, 'E3', v, 15], [at + 18, 'G#3', v * .9, 15]]            // G#: the pivot into G# major
    : [[at + 18, 'E3', v, 15], [at + 18, 'B3', v * .9, 15], [at + 24, 'C#4', v * .75, 9]]),
];
const bowlsGs = (at, v) => [
  [at, 'G#3', v, 15], [at, 'D#4', v * .9, 15], [at + 3, 'C5', v * .7, 12],
  [at + 18, 'G#3', v, 15],                                           // then only G#: E major is coming
];
// birds: a twitter over each held cadence (bar 6 of every statement)
const birds = (at, [a, b, c, d], v = .55) => [
  [at + 31, a, v], [at + 31.5, b, v * .8], [at + 32, a, v], [at + 32.5, b, v * .8],
  [at + 33, c, v * .9], [at + 34, d, v * .7], [at + 35, b, v * .6],
];
const twinkle = (at, v) => Array.from({ length: 6 }, (_, bar) =>
  ['E6', 'G#6', 'B6', 'G#6', 'E6', 'B5'].map((n, j) => [at + 6 * bar + j, n, +(v * (j ? .75 : 1)).toFixed(2)])).flat();

export default {
  label: 'Morning Mood', sub: 'Grieg · sunrise on singing bowls',
  bpm: 60 * 12 / 3.8,                                  // ≈ 189.5: the loop's 3.8 s breath = 12 beats = 2 bars
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
      ['B3', 6], ['B3', 6], ['G#3', 6], ['G#3', 6], ['C#4', 6], ['B3', 6],   // P2 — re-tongued each bar
      ...[['D#4', 4], ['C4', 4], ['F4', 2], ['D#4', 2]].flatMap(([n, k]) =>   // P3 (= +4): pulsing ♩.
        Array.from({ length: k }, () => [n, 3])),
      ['G#4', 6], ['E4', 6], ['F#4', 6], ['G#4', 6], ['C#4', 6], ['B3', 6],   // P4
      ['B3', 6], ['G#3', 6], ['E4', 6],                                  // P5
    ],
  },

  // the director's pull per station (song.director): the bowls are this song's
  // showcase, but a bowl struck once a bar loses the hit-density vote to the birds
  director: { bowls: 2.2, bells: 1.5 },

  parts: {
    bowls: [
      ...bowlsE(0, .5), ...bowlsE(36, .55, true), ...bowlsGs(72, .68), ...bowlsE(108, .82),
      [144, 'E3', .6, 10], [144, 'B3', .5, 10],
      [156, 'E3', .85, 15], [156, 'B3', .75, 15], [156, 'G#4', .65, 15], [156, 'C#4', .4, 15],
    ],
    bass: [
      [0, 'E2', .55], [12, 'E2', .5], [24, 'E2', .55], [30, 'B2', .45],
      [36, 'E2', .6], [48, 'E2', .55], [60, 'C#3', .5], [66, 'B2', .5],
      [72, 'G#2', .8], [84, 'G#2', .65], [96, 'G#2', .7],
      [108, 'E2', 1], [108, 'E3', .7], [114, 'B2', .8], [120, 'E2', .9], [126, 'B2', .8],
      [132, 'C#3', .85], [138, 'B2', .8],
      [144, 'E2', .7], [150, 'E2', .6], [156, 'E2', .9], [156, 'E3', .6],
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
      [156, 'E4', .9], [156, 'E5', .75],
    ],
  },

  // AUDIO-ONLY levels per machine (song.mix — velocity stays dynamics, so the bowls'
  // swell still brightens their rims and draws the director), balanced offline from
  // the voices' own renders against the belt lead
  mix: {
    bowls: .48,       // a pad under the flute, not over it
    bass:  .55,       // the cello-register pedal speaks far louder than the old E1 did
    bells: .8,
  },
};
