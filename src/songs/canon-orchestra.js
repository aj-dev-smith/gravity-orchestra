/* CANON IN D — FULL ORCHESTRA. Pachelbel (c. 1680), re-scored for the whole room.

   THE IDEA: a canon is one melody chasing itself. Here it chases itself ACROSS THE
   ROOM — the same line leaves the belt lead, is picked up one ground later by the belt
   alto, then by the marimba, then by the music box, each voice entering exactly one
   ground behind the last. Harmony is free: every variation fits the ground by itself,
   so any stack of them is consonant (that is Pachelbel's trick, and it is ours).

   THE GROUND (string bass, never stops): D  A  Bm  F#m  G  D  G  A — one chord per
   2 beats, 16 beats per ground. D3 A2 B2 F#2 G2 D2 = 6 strings on the bed (≤ 8) —
   cello register, not D1: phone speakers roll off under ~200 Hz (CLAUDE.md §5) and
   the ground is the piece's spine, it must survive a phone.

   THE VARIATIONS (each exactly one ground; the canon order every voice walks):
     S1 the theme, one note per chord (F# E D C# B A B C#)
     S2 its answer (D C# B A G F# G E)
     S3 eighths — broken chords
     S4 the famous sixteenths (D C# D d c# A E F# …)
     S5 the "A F#G A F#G" flourish + the rising scale  ┐ the 32nd-note passage — on
     S6 its falling answer, climbing home              ┘ the belt in 16ths (a .25-beat
                                                         skim is too flat to read), on the
                                                         MARIMBA in TRUE 32nds (S5x/S6x):
                                                         eight strokes per chord sweeping
                                                         the keyboard, the visual peak
     S7 eighth-note arpeggios hanging off the theme
     S8 the theme in octave LEAPS — the climax

   FORM (11 grounds + a 9-beat coda = 185 beats, ~100 s at 110.53):
     G1   bare ground — string bass alone, the lead marble walking it in tall arcs
     G2   lead S1                                    + bowls (the strings' sustain)
     G3   lead S2 · alto S1
     G4   lead S3 · alto S2 · marimba S1 (rolled, like a real marimba holds a note)
     G5   lead S4 · alto S3 · marimba S2 (rolled) · music box S1 (8va)
     G6   lead S5 · alto S4 · marimba S3 · music box S2          + a bell marks the ground
     G7   lead S6 · alto S5 · marimba S4 (16ths!) · music box S3
     G8   lead S7 · alto S6 · marimba S5x (TRUE 32nds!) · music box S4
          — THE SWELL: drums enter, soft bass-drum heartbeats → a floor-tom timpani roll
     G9   CLIMAX: lead S8 (octave leaps) · alto S7 · marimba S6x (32nds, ending
          in an A7 scale that tips into the return) · music box S5,
          tubular bells ring the THEME one per chord, crash, bass drum on every chord,
          a half-time snare, ride shimmer, the string bass driving in eighths
     G10  the return: lead S2 · alto S8 · marimba S7 · music box S6 — drums recede
     G11  lead S1 · alto S2 · marimba S1 (rolled, fading) — music box rests; the room
          thins back toward where it started
     CODA the D chord — everyone, bells + bowls ringing through the loop's breath,
          and the loop falls back to the bare ground bass ON THE BEAT: the loop's
          breath is a fixed 3.8 s (ROLL_T + 1.2), so bpm = 60·7/3.8 ≈ 110.53 makes it
          exactly 7 beats, and the 9-beat coda + 7 = one whole 16-beat ground. (Change
          the bpm and the seam drifts off the pulse — re-solve 7 beats = 3.8 s.)

   MIX: tutti grounds stack ~20 onsets per chord, so the song stages its gain in
   `mix` (song.mix: an AUDIO-ONLY per-machine level, a step envelope by beat — G5–G6
   ×.75, the tutti G7–G10 ×.4–.6), leaving velocity as pure dynamics: the climax still
   strikes hard, flashes bright and picks the marimba's hard-mallet layer. The coda
   chords are thinned to ≤ 2 notes per machine — the bowls and bells already sustain
   the chord. Levels balanced
   offline from the voices' own renders: the loudest 16-beat window (the climax)
   sits ~2 dB over Mountain King's, not 7 dB over it — the belt is the soloist.

   iOS NOTE (§5): the sample path ignores a bowl's `dur` — every bowl rings its whole
   ~6 s render. So the bowls hold only A · B · E (the D-major degrees with a whole
   step on BOTH sides): no chord in the ground can rub a semitone against them, so
   they are clash-free however long they ring. Bells likewise ring 4.4 s on every
   path: they toll chord tones that survive into the next chord or two.

   DRUMS — absent for 7 grounds, on purpose. Canon's drama is ACCUMULATION: voice after
   voice. Drums from bar 1 would flatten that into a groove. They arrive only as the
   swell (G8: orchestral bass-drum heartbeats + a timpani-style floor-tom roll, the
   floor tom is tuned to A — the dominant), carry the one climax ground, and leave.
   The other toms are tuned off-key for D major, so they stay out.

   Belt: lead = violin I, alto = violin II an octave down (delay = 2 grounds: G1 is
   bare, so the canon's second voice enters at G3). No belt bass — the string bass
   owns the ground. THE LOCK RULE: alto 153 + delay 32 = melody 185. */

// ---- note helpers (sharps only) --------------------------------------------------
const PC = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const num = n => { const m = /^([A-G]#?)(\d)$/.exec(n); return PC.indexOf(m[1]) + 12 * (+m[2] + 1); };
const name = k => PC[k % 12] + (Math.floor(k / 12) - 1);
const tr = (line, s) => line.map(([n, b]) => [name(num(n) + s), b]);
/** a chained line → pinned instrument events from `at` (beats), all at velocity v */
const pin = (line, at, v = .8) => {
  let b = at; const out = [];
  for (const [n, d] of line){ out.push([b, n, v]); b += d; }
  return out;
};
/** a marimba ROLL: each note re-struck every `step` beats, swelling into the next note */
const roll = (line, at, step, v0, v1) => {
  let b = at; const out = [];
  for (const [n, d] of line){
    const k = Math.round(d / step);
    for (let i = 0; i < k; i++) out.push([b + i * step, n, +(v0 + (v1 - v0) * i / Math.max(1, k - 1)).toFixed(2)]);
    b += d;
  }
  return out;
};
const G = g => (g - 1) * 16;                        // beat at which ground g (1-based) starts

// ---- the material ----------------------------------------------------------------
const h = (ns, d) => ns.map(n => [n, d]);
const GROUND_WALK = h(['D4','A3','B3','F#3','G3','D3','G3','A3'], 2);
const S1 = h(['F#5','E5','D5','C#5','B4','A4','B4','C#5'], 2);
const S2 = h(['D5','C#5','B4','A4','G4','F#4','G4','E4'], 2);
const S3 = h(['D5','F#5','A5','G5','F#5','D5','F#5','E5','D5','B4','D5','A5','G5','B5','A5','G5'], 1);
const S4 = h(['D5','C#5','D5','D4','C#4','A4','E4','F#4','D4','D5','C#5','B4','C#5','F#5','A5','B5',
              'G5','F#5','E5','G5','F#5','E5','D5','C#5','B4','A4','G4','F#4','E4','G4','F#4','E4'], .5);
const S5 = [
  ['A5', 1], ['F#5', .5], ['G5', .5], ['A5', 1], ['F#5', .5], ['G5', .5],
  ...h(['A5','A4','B4','C#5','D5','E5','F#5','G5'], .5),
  ['F#5', 1], ['D5', .5], ['E5', .5], ['F#5', 1], ['F#4', .5], ['G4', .5],
  ...h(['A4','B4','A4','G4','A4','F#4','G4','A4'], .5),
];
const S6 = [
  ['G4', 1], ['B4', .5], ['A4', .5], ['G4', 1], ['F#4', .5], ['E4', .5],
  ...h(['F#4','E4','D4','E4','F#4','G4','A4','B4'], .5),
  ['G4', 1], ['B4', .5], ['A4', .5], ['B4', 1], ['C#5', .5], ['D5', .5],
  ...h(['A4','B4','C#5','D5','E5','F#5','G5','A5'], .5),
];
// the marimba's TRUE 32nd-note passage: the same flourishes, the runs at .25 beats —
// a scale through Bm, an F#m arpeggio wave, G and A arpeggio sweeps; S6x ends on an A7
// scale (A B C# D E F# G A) that tips the climax into the return
const S5x = [
  ['A5', 1], ['F#5', .5], ['G5', .5], ['A5', 1], ['F#5', .5], ['G5', .5],
  ...h(['A4','B4','C#5','D5','E5','F#5','G5','A5', 'A5','F#5','C#5','A4','C#5','F#5','A5','G5'], .25),
  ['F#5', 1], ['D5', .5], ['E5', .5], ['F#5', 1], ['F#4', .5], ['G4', .5],
  ...h(['G4','B4','D5','G5','B5','G5','D5','B4', 'A4','C#5','E5','A5','G5','E5','C#5','A4'], .25),
];
const S6x = [
  ['G4', 1], ['B4', .5], ['A4', .5], ['G4', 1], ['F#4', .5], ['E4', .5],
  ...h(['F#4','B4','D5','F#5','B5','F#5','D5','B4', 'A4','C#5','F#5','A5','F#5','C#5','A4','F#4'], .25),
  ['G4', 1], ['B4', .5], ['A4', .5], ['B4', 1], ['C#5', .5], ['D5', .5],
  ...h(['G4','B4','D5','G5','B5','G5','D5','B4', 'A4','B4','C#5','D5','E5','F#5','G5','A5'], .25),
];
const S7 = h(['F#5','A5','E5','A5','D5','F#5','C#5','F#5','B4','D5','A4','D5','B4','D5','C#5','E5'], 1);
const S8 = h(['F#5','F#6','E5','E6','D5','D6','C#5','C#6','B4','B5','A4','A5','B4','B5','C#5','C#6'], 1);

// the ground on the string bass, one ground starting at `at` — cello register (see header)
const GROUND = ['D3','A2','B2','F#2','G2','D2','G2','A2'];
const groundAt = (at, v = .85) => GROUND.map((n, i) => [at + 2 * i, n, i === 0 ? Math.min(1, v + .1) : v]);
// G9: the bass DRIVES — each chord's root struck again on the off-beat
const driveAt = at => GROUND.flatMap((n, i) => [[at + 2 * i, n, 1], [at + 2 * i + 1, n, .62]]);

// bowls: the strings' sustain, one bowl per chord PAIR, A · B · E · A only — the three
// D-major degrees no chord of the ground can rub a semitone against (iOS rings every
// bowl its full ~6 s, so they must be clash-free at ANY length). Over the ground they
// spell open quartal colour: D add9, Bm11, G 6/9, A sus.
const bowlsAt = (at, v) => [[at, 'A3', v, 8], [at + 4, 'B3', v * .95, 8], [at + 8, 'E4', v * .9, 8], [at + 12, 'A4', v * .85, 8]];

/** the gain staging (song.mix): a machine's level → ×.75 from G5 (four voices already),
    ×tutti over the tutti grounds G7–G10, back to its level for G11 + the coda */
const stage = (level, tutti) => [[0, level], [G(5), +(level * .75).toFixed(3)], [G(7), +(level * tutti).toFixed(3)], [G(11), level]];
const CODA = G(12);                                   // beat 176: the final D

export default {
  label: 'Canon in D — Orchestra', sub: 'Pachelbel · the canon chases itself across the room',
  bpm: 60 * 7 / 3.8,                                  // ≈ 110.53: the loop's 3.8 s breath = 7 beats (see header)
  scale: ['C#','D','E','F#','G','A','B'],

  // violin I — chained, one marble
  melody: [
    ...GROUND_WALK,                                  // G1  the bare ground
    ...S1, ...S2, ...S3, ...S4, ...S5, ...S6, ...S7, // G2–G8
    ...S8,                                           // G9  climax: octave leaps
    ...S2, ...S1,                                    // G10–G11 winding back to the theme
    ['D5', 9],                                       // coda: 9 + the 7-beat breath = one ground
  ],
  // violin II — the canon's second voice, one ground behind, an octave down
  alto: {
    delay: 32,
    notes: [
      ...tr(S1, -12), ...tr(S2, -12), ...tr(S3, -12), ...tr(S4, -12), ...tr(S5, -12),   // G3–G7
      ...tr(S6, -12), ...tr(S7, -12), ...tr(S8, -12),                                   // G8–G10
      ...tr(S2, -12),                                                                    // G11
      ['F#4', 9],                                                                        // coda: the third
    ],
  },

  parts: {
    // the ground — 11 times round, driving at the climax, then the final D
    bass: [
      ...groundAt(G(1), .9),
      ...[2, 3, 4, 5, 6, 7].flatMap(g => groundAt(G(g))),
      ...groundAt(G(8), .92),
      ...driveAt(G(9)),
      ...groundAt(G(10), .85), ...groundAt(G(11), .75),
      [CODA, 'D2', .9], [CODA, 'D3', .7],
    ],

    // the canon's THIRD voice: rolled theme, 16ths, the TRUE 32nd passage, then home
    marimba: [
      ...roll(S1, G(4), .5, .4, .62),
      ...roll(S2, G(5), .5, .45, .66),
      ...pin(S3, G(6), .72),
      ...pin(S4, G(7), .74),                  // soft mallets: the hard layer waits for the 32nds
      ...pin(S5x, G(8), .74),                 // the 32nds arrive soft…
      ...pin(S6x, G(9), .95),                 // …and the climax switches to hard mallets
      ...pin(S7, G(10), .75),
      ...roll(S1, G(11), .5, .5, .3),
      [CODA, 'D4', .74], [CODA, 'A4', .7],
    ],

    // the canon's FOURTH voice, an octave up in starlight — enters G5, rests G11
    musicbox: [
      ...pin(tr(S1, 12), G(5), .7),
      ...pin(tr(S2, 12), G(6), .72),
      ...pin(tr(S3, 12), G(7), .75),
      ...pin(tr(S4, 12), G(8), .78),
      ...pin(tr(S5, 12), G(9), .85),
      ...pin(tr(S6, 12), G(10), .7),
      [CODA, 'D6', .7], [CODA, 'A5', .55],
    ],

    // the strings' sustain, swelling to the climax
    bowls: [
      ...bowlsAt(G(2), .42), ...bowlsAt(G(3), .45), ...bowlsAt(G(4), .48), ...bowlsAt(G(5), .5),
      ...bowlsAt(G(6), .55), ...bowlsAt(G(7), .6), ...bowlsAt(G(8), .66), ...bowlsAt(G(9), .75),
      ...bowlsAt(G(10), .55), ...bowlsAt(G(11), .45),
      [CODA, 'D3', .75, 8], [CODA, 'A3', .65, 8],
    ],

    // tubular bells — only the big moments, tolling chord tones that outlast their chord
    bells: [
      [G(6) + 8, 'D5', .5],                                // a bell marks the 4th voice settling in
      [G(7), 'A4', .58], [G(7) + 8, 'D5', .5],
      [G(8), 'A4', .68], [G(8) + 8, 'D5', .6],
      // G9: the low D tolls the climax, then the theme's frame one tube per chord pair
      [G(9), 'D4', 1], [G(9), 'F#5', .85], [G(9) + 4, 'D5', .8], [G(9) + 8, 'B4', .8], [G(9) + 12, 'A4', .85],
      [G(10), 'A4', .7], [G(10), 'F#5', .55],              // the return
      [CODA, 'D4', .75], [CODA, 'A4', .6],                  // coda
    ],
  },

  // AUDIO-ONLY levels per machine (velocity stays dynamics) — balanced offline from the
  // voices' own renders against the belt lead; see MIX in the header
  mix: {
    bass:     stage(.6, .62),        // the cello-register ground speaks; keep it under the canon
    marimba:  stage(.62, .42),
    musicbox: stage(1, .38),
    bowls:    stage(.8, .55),
    bells:    stage(1, .6),
  },

  // absent until the swell (see the header for why)
  drums: {
    kick: [
      [G(8), .4], [G(8) + 4, .45], [G(8) + 8, .52], [G(8) + 12, .6],     // heartbeats
      ...[0, 2, 4, 6, 8, 10, 12, 14].map(b => [G(9) + b, b % 4 ? .55 : .75]), // every chord
      [G(10), .65], [G(10) + 8, .45],                                     // receding
      [CODA, .65],
    ],
    // the timpani roll into the climax — the A floor tom (the dominant), crescendo
    floorHigh: [
      ...[0, 1, 2, 3, 4, 5, 6, 7].map(i => [G(8) + 14 + i * .25, +(.3 + .6 * i / 7).toFixed(2)]),
      [G(9) + 14, .6], [G(9) + 14.5, .7], [G(9) + 15, .8], [G(9) + 15.5, .9],   // a fill out of the climax
    ],
    snare: [G(9) + 2, G(9) + 6, G(9) + 10].map(b => [b, .5]),
    ride:  [...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map(b => [G(9) + b, b % 2 ? .3 : .45]),
            [G(10), .4], [G(10) + 2, .32], [G(10) + 4, .25]],
    crash: [[G(9), .85], [G(10), .5], [CODA, .65]],
  },
};
