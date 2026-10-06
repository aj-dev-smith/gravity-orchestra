/* CAROL OF THE BELLS — Mykola Leontovych, "Shchedryk" (1916). The melody is public
   domain; this is a gesture-faithful re-scoring for the whole room, in E minor
   (the original's G minor, down a third — no flats needed, and it sits the ostinato
   right in the belt's sweet spot).

   THE OSTINATO is the whole piece: G F#G E (quarter, two eighths, quarter) in 3/4,
   relentless. Leontovych builds by STACKING it — the same cell a third higher
   (B AB G), then a sixth (E DE B), until the stack spells Em · D · Em chords — over a
   bass that walks down E D C B. We build the same way, one machine at a time.

   FORM (3/4, bar = 3 beats, section = 4 bars = 12 beats; 9 sections = 108 beats,
   ~43 s at 152):
     §1  0   the ostinato alone on the belt — one marble, three pads
     §2  12  + the music box doubles it an octave up (wound up, ticking)
     §3  24  + marimba stacks the third (B AB G) · + string bass walks down E D C B
     §4  36  + belt alto takes the ostinato low; the lead climbs to the sixth (E DE B)
             + the bowls breathe an open E drone (E3 · E4, B3 over Em/D only — a G
             or a B held under C would grind the ostinato's F# / the C)
     §5  48  + TUBULAR BELLS: "ding-dong" pairs (beats 1 and 3) falling with the bass;
             soft bass-drum on each downbeat
     §6  60  THE BUILD: the cell rises a step per bar on every ostinato machine at
             once (G→A→B→C on top), the bass climbs E D G A under it, hats + snare
             creep in, a tom fill tumbles into…
     §7  72  CLIMAX I: crash. The lead SOARS in dotted halves (B A G B — tall slow arcs over the
             churn) while alto/music box hammer the ostinato, marimba runs eighth-note
             arpeggios, bells ding-dong, full 3/4 rock groove (kick 1 & the and-of-2,
             snare 2 & 3), bass driving
     §8  84  CLIMAX II: the lead takes the ostinato up an octave (skimming), the
             BELLS ring the ostinato itself, a tom cascade (D# C A — in key) into…
     §9  96  FINALE: three last bars at full tilt, then ONE unison E-minor hit — the
             whole room — and the loop's breath rings it out before the lone
             ostinato starts again.

   Harmony per bar while the bass walks: Em · D(/E) · Cmaj7 · Bm7 (natural minor,
   modal like the original — no D#, except the toms' fill pitch). The ostinato's F#
   rubs the sustained G above it as a passing eighth: that rub IS the carol.

   Belt: lead = the ostinato's voice, then its stacks; alto (delay 36) = the
   ostinato an octave down from §4. LOCK RULE: alto 72 + delay 36 = melody 108.
   String bass: E2 D2 C2 B1 G2 A2 + E1 for the final hit = 7 strings (cap 8). */

// ---- helpers ---------------------------------------------------------------------
const PC = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const num = n => { const m = /^([A-G]#?)(\d)$/.exec(n); return PC.indexOf(m[1]) + 12 * (+m[2] + 1); };
const name = k => PC[k % 12] + (Math.floor(k / 12) - 1);
const tr = (line, s) => line.map(([n, b]) => [name(num(n) + s), b]);
const rep = (line, k) => Array.from({ length: k }, () => line).flat();
const pin = (line, at, v = .8) => {
  let b = at; const out = [];
  for (const [n, d] of line){ out.push([b, n, v]); b += d; }
  return out;
};
/** MIX trim — scale a part's velocities (balanced offline: each stem's RMS against the belt lead) */
const trim = (part, k) => part.map(([b, n, v = 1, ...r]) => [b, n, +Math.min(1, v * k).toFixed(2), ...r]);
const S = s => (s - 1) * 12;                         // beat where section s starts
const sortHits = hs => hs.sort((a, b) => (Array.isArray(a) ? a[0] : a) - (Array.isArray(b) ? b[0] : b));

// ---- the cell and its stacks -----------------------------------------------------
const cell = (a, b, c) => [[a, 1], [b, .5], [a, .5], [c, 1]];      // a b-a c  (♩ ♪♪ ♩)
const OST   = cell('G5', 'F#5', 'E5');                               // the ostinato
const THIRD = cell('B5', 'A5', 'G5');                                // stacked a third up
const SIXTH = cell('E6', 'D6', 'B5');                                // and a sixth: Em · D · Em
const RISE  = [...cell('G5', 'F#5', 'E5'), ...cell('A5', 'G5', 'F#5'),
               ...cell('B5', 'A5', 'G5'), ...cell('C6', 'B5', 'A5')]; // up a step per bar
const RISE3 = [...cell('B5', 'A5', 'G5'), ...cell('C6', 'B5', 'A5'),
               ...cell('D6', 'C6', 'B5'), ...cell('E6', 'D6', 'C6')]; // its third
const SOAR  = [['B5', 3], ['A5', 3], ['G5', 3], ['B5', 3]];          // over the falling bass (B, not F#:
                                                                     // a held F# would grind the ostinato's G)
// Em · D · C · Bm in eighths, VOICED AROUND THE OSTINATO: under its held G (offsets 0, .5,
// 1.5) never an F#; under its F# (offset 1) a chord tone that agrees with it (B, F#, A)
const ARPS  = [['E5','G5','B5','E6','B5','G5'], ['D5','A5','F#5','D6','A5','F#5'],
               ['E5','G5','A5','G5','E5','C6'], ['D5','B5','F#5','D6','B5','D6']]
              .flatMap(bar => bar.map(n => [n, .5]));
const DINGDONG = [['E5','B4'], ['D5','A4'], ['C5','G4'], ['B4','E4']];   // dongs agree with the stack's E · G

// ---- bass lines ------------------------------------------------------------------
const DESC = ['E2', 'D2', 'C2', 'B1'];
const walk = (at, roots, v = .85, drive = 0) => roots.flatMap((n, i) =>
  drive ? [[at + 3 * i, n, v], [at + 3 * i + 1.5, n, drive]] : [[at + 3 * i, n, v]]);

// ---- drums -----------------------------------------------------------------------
const groove = (at, bars, vk = .9, vs = .75) => {
  const k = [], s = [], h = [];
  for (let i = 0; i < bars; i++){
    const b = at + 3 * i;
    k.push([b, vk], [b + 1.5, vk * .7]);
    s.push([b + 1, vs * .85], [b + 2, vs]);
    for (let j = 0; j < 6; j++) h.push([b + j * .5, j === 0 ? .55 : j % 2 ? .3 : .42]);
  }
  return { k, s, h };
};
const G7 = groove(S(7), 4), G8 = groove(S(8), 3, 1, .8), G9 = groove(S(9), 3, 1, .85);

export default {
  label: 'Carol of the Bells', sub: 'Leontovych · the ostinato, stacked to the ceiling', bpm: 152,
  scale: ['E','F#','G','A','B','C','D'],

  melody: [
    ...rep(OST, 12),                           // §1–§3  the ostinato
    ...rep(SIXTH, 8),                          // §4–§5  the top of the stack
    ...RISE,                                   // §6     the build
    ...SOAR,                                   // §7     climax I — tall arcs
    ...rep(tr(OST, 12), 4),                    // §8     climax II — the ostinato 8va
    ...rep(OST, 3), ['E5', 3],                 // §9     finale → the unison hit
  ],
  alto: {
    delay: 36,
    notes: [
      ...rep(tr(OST, -12), 8),                 // §4–§5
      ...tr(RISE, -12),                        // §6
      ...rep(tr(OST, -12), 4),                 // §7
      ...rep(tr(THIRD, -12), 4),               // §8
      ...rep(tr(OST, -12), 3), ['E4', 3],      // §9
    ],
  },

  parts: {
    musicbox: [
      ...pin(rep(tr(OST, 12), 16), S(2), .6),             // §2–§5
      ...pin(tr(RISE, 12), S(6), .68),                    // §6 rises with the room
      ...pin(rep(tr(OST, 12), 8), S(7), .78),             // §7–§8 hammering
      ...pin(rep(tr(OST, 12), 3), S(9), .82),
      [105, 'E6', .9], [105, 'G6', .8], [105, 'B6', .85],
    ],
    marimba: trim([
      ...pin(rep(THIRD, 4), S(3), .55),
      ...pin(rep(THIRD, 4), S(4), .62),
      ...pin(rep(THIRD, 4), S(5), .7),
      ...pin(RISE3, S(6), .78),
      ...pin(ARPS, S(7), .85),
      ...pin(ARPS, S(8), .92),
      ...pin(rep(THIRD, 3), S(9), .95),
      [105, 'E5', 1], [105, 'G5', .9], [105, 'B5', .9], [105, 'E6', 1],
    ], .72),
    bass: trim([
      ...walk(S(3), DESC, .8), ...walk(S(4), DESC, .85), ...walk(S(5), DESC, .9),
      ...walk(S(6), ['E2', 'D2', 'G2', 'A2'], .9, .55),
      ...walk(S(7), DESC, 1, .65), ...walk(S(8), DESC, 1, .7),
      ...walk(S(9), ['E2', 'D2', 'C2'], 1, .7),
      [105, 'E1', 1], [105, 'E2', .9],
    ], .85),
    bowls: trim([
      ...[4, 5, 6, 7, 8, 9].flatMap((s, i) => {
        const v = +(.42 + .07 * i).toFixed(2);
        return [[S(s), 'E3', v, 9], [S(s), 'E4', v * .8, 9], [S(s), 'B3', v * .85, s === 6 ? 2.5 : 5]];   // B only over Em · D
      }),
      [105, 'E3', .85, 8], [105, 'B3', .75, 8], [105, 'G3', .7, 8], [105, 'E4', .8, 8],   // the final Em
    ], .75),
    bells: [
      ...DINGDONG.flatMap(([a, b], i) => [[S(5) + 3 * i, a, .7], [S(5) + 3 * i + 2, b, .55]]),
      [S(6), 'E5', .6], [S(6) + 9, 'A4', .55],
      ...DINGDONG.flatMap(([a, b], i) => [[S(7) + 3 * i, a, .9], [S(7) + 3 * i + 2, b, .72]]),
      ...pin(rep(OST, 4), S(8), .85),
      [S(9), 'E5', .9], [S(9) + 3, 'D5', .9], [S(9) + 6, 'C5', .9],
      [105, 'E4', 1], [105, 'B4', .9], [105, 'E5', 1],
    ],
  },

  drums: {
    kick: sortHits([
      [48, .4], [51, .42], [54, .46], [57, .5],                              // §5 heartbeats
      ...[0, 1, 2, 3].flatMap(i => [[60 + 3 * i, .55 + .06 * i], [61.5 + 3 * i, .4 + .05 * i]]),
      ...G7.k, ...G8.k, [93, 1], ...G9.k, [105, 1],
    ]),
    snare: sortHits([
      [67, .45], [68, .55], [70, .6],                                        // §6 creeping in
      ...G7.s, ...G8.s, [94, .85], ...G9.s, [105, 1],
    ]),
    hat: sortHits([
      ...Array.from({ length: 20 }, (_, j) => [60 + j * .5, +(.2 + .3 * j / 19).toFixed(2)]),   // §6 creeping in
      ...G7.h, ...G8.h, ...G9.h,
    ]),
    crash: [[72, 1], [84, .9], [96, 1], [105, 1]],
    // fills, pitched in key: tomLow = C, floor tom = A, tomMid = D#
    tomMid:    [[94.5, .8], [94.75, .85]],
    tomLow:    [[70.5, .6], [70.75, .65], [71, .7], [95, .88], [95.25, .9]],
    floorHigh: [[71.25, .75], [71.5, .82], [71.75, .9], [95.5, .95], [95.75, 1], [105, .9]],
  },
};
