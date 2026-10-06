/* CAROL OF THE BELLS — Mykola Leontovych, "Shchedryk" (1916). The melody is public
   domain; this is a gesture-faithful re-scoring for the whole room, in E minor
   (the original's G minor, down a third — no flats needed, and it sits the ostinato
   right in the belt's sweet spot).

   THE OSTINATO is the whole piece: G F#G E (quarter, two eighths, quarter) in 3/4,
   relentless. Leontovych builds by STACKING it — the same cell a third higher
   (B AB G), then a sixth (E DE B), until the stack spells Em · D · Em chords — over a
   bass that walks down E D C B. We build the same way, one machine at a time.

   FORM (3/4, bar = 3 beats, section = 4 bars = 12 beats; 9 sections = 108 beats,
   ~46 s at 142.1 — and the loop's fixed 3.8 s breath (ROLL_T + 1.2) is EXACTLY 9
   beats at bpm 60·9/3.8, so the final 3-beat chord + the breath make one whole
   12-beat section and the lone ostinato re-enters on the hypermeter downbeat):
     §1  0   the ostinato alone on the belt — one marble, three pads
     §2  12  + the music box doubles it an octave up (wound up, ticking)
     §3  24  + marimba stacks the third (B AB G) · + string bass walks down E D C B
     §4  36  + belt alto takes the ostinato low; the lead climbs to the sixth (E DE B)
             + the bowls breathe an E-minor drone (E3 · G3 · E4 — no B: iOS rings
             every bowl its full ~6 s, and a B still sounding under the C bar grinds;
             the G sits a major 7th BELOW the ostinato's F#, the carol's own rub, softened)
     §5  48  + TUBULAR BELLS: "ding-dong" pairs (beats 1 and 3) falling with the bass
             (E·B, D·A, G·E, A·D — chord tones still consonant with the NEXT bar,
             because a tube rings ~4 s: a C bell would grind the Bm7 bar's B bass);
             soft bass-drum on each downbeat
     §6  60  THE BUILD: the cell rises a step per bar on every ostinato machine at
             once (G→A→B→C on top), the bass climbs E D G A under it, hats + snare
             creep in, a tom fill tumbles into…
     §7  72  CLIMAX I: crash. The lead SOARS in dotted halves (B A G B — tall slow arcs over the
             churn) while alto/music box hammer the ostinato, marimba runs eighth-note
             arpeggios, bells ding-dong, full 3/4 rock groove (kick 1 & the and-of-2,
             snare 2 & 3), bass driving
     §8  84  CLIMAX II: the lead takes the ostinato up an octave (skimming), the
             BELLS toll the cell's FRAME (G on the downbeat, E on beat 3 — the F#
             passing note stays on the dry machines: a 4 s tube ringing G and F#
             together is a cluster, not a carol), a floor-tom roll on A (the 7th of
             the Bm7 bar) cascades into…
     §9  96  FINALE: three last bars at full tilt, then ONE unison E-minor hit — the
             whole room, each machine voicing at most two notes of it (the bowls and
             bells sustain the chord) — and the loop's breath rings it out before
             the lone ostinato starts again, in tempo.

   MIX: the stack is the whole point, so the gain is staged in the data — `mix`
   (song.mix: an AUDIO-ONLY per-machine level, a step envelope by beat: §4–§5 ×.75,
   §6–§9 ×.4–.5) — leaving velocity as dynamics, so the climax still strikes hard and
   flashes bright. Balanced offline from the voices' own renders: the finale lands
   ~3 dB over Mountain King, not 8.

   Harmony per bar while the bass walks: Em · D(/E) · Cmaj7 · Bm7 (natural minor,
   modal like the original — no D# anywhere; the pitched toms only ever play C (tomLow)
   and A (the floor tom), both in key). The ostinato's F#
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
               ['E5','G5','A5','G5','E5','A5'], ['D5','B5','F#5','D6','B5','D6']]   // C-bar ends on A: a top C would hang over the B bass
              .flatMap(bar => bar.map(n => [n, .5]));
// ding-dongs: chord tones that are still consonant with the NEXT bar while they ring
// (a tube rings ~4 s ≈ 3 bars) — so no C (it would grind the B bass of the Bm7 bar)
const DINGDONG = [['E5','B4'], ['D5','A4'], ['G4','E4'], ['A4','D4']];

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
const G7 = groove(S(7), 4, .7, .58), G8 = groove(S(8), 3, .75, .62), G9 = groove(S(9), 3, .75, .64);

/** the gain staging (song.mix, audio-only): a machine's level → ×.75 from §4 (the stack
    is four deep), ×tutti from §6 to the end */
const stage = (level, tutti = .4) => [[0, level], [S(4), +(level * .75).toFixed(3)], [S(6), +(level * tutti).toFixed(3)]];

export default {
  label: 'Carol of the Bells', sub: 'Leontovych · the ostinato, stacked to the ceiling',
  bpm: 60 * 9 / 3.8,                                   // ≈ 142.1: the loop's 3.8 s breath = 9 beats (see header)
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

  // the director's pull per station (song.director): every machine gets its entrance
  // on camera — the sparse bells and the drum machine would lose the density vote
  director: { bells: 1.8, drums: 1.8 },

  parts: {
    musicbox: [
      ...pin(rep(tr(OST, 12), 16), S(2), .6),             // §2–§5
      ...pin(tr(RISE, 12), S(6), .68),                    // §6 rises with the room
      ...pin(rep(tr(OST, 12), 8), S(7), .78),             // §7–§8 hammering
      ...pin(rep(tr(OST, 12), 3), S(9), .82),
      [105, 'E6', .9], [105, 'B6', .8],
    ],
    marimba: [
      ...pin(rep(THIRD, 4), S(3), .55),
      ...pin(rep(THIRD, 4), S(4), .62),
      ...pin(rep(THIRD, 4), S(5), .7),
      ...pin(RISE3, S(6), .78),
      ...pin(ARPS, S(7), .85),
      ...pin(ARPS, S(8), .92),
      ...pin(rep(THIRD, 3), S(9), .95),
      [105, 'E5', 1, 3], [105, 'G5', .9, 3],         // the last chord ROLLED to the loop's end
    ],
    bass: [
      ...walk(S(3), DESC, .8), ...walk(S(4), DESC, .85), ...walk(S(5), DESC, .9),
      ...walk(S(6), ['E2', 'D2', 'G2', 'A2'], .9, .55),
      ...walk(S(7), DESC, 1, .65), ...walk(S(8), DESC, 1, .7),
      ...walk(S(9), ['E2', 'D2', 'C2'], 1, .7),
      [105, 'E1', 1], [105, 'E2', .9],
    ],
    bowls: [
      ...[4, 5, 6, 7, 8, 9].flatMap((s, i) => {
        const v = +(.42 + .07 * i).toFixed(2);
        return [[S(s), 'E3', v, 9], [S(s), 'E4', v * .8, 9], [S(s), 'G3', v * .8, 9]];   // G, never B: iOS rings a bowl ~6 s, a B would grind the C bar
      }),
      [105, 'E3', .85, 8], [105, 'B3', .75, 8], [105, 'G3', .7, 8],   // the final Em (bowls hold the chord)
    ],
    bells: [
      ...DINGDONG.flatMap(([a, b], i) => [[S(5) + 3 * i, a, .7], [S(5) + 3 * i + 2, b, .55]]),
      [S(6), 'E5', .6], [S(6) + 9, 'A4', .55],
      ...DINGDONG.flatMap(([a, b], i) => [[S(7) + 3 * i, a, .9], [S(7) + 3 * i + 2, b, .72]]),
      ...[0, 1, 2, 3].flatMap(i => [[S(8) + 3 * i, 'G5', .85], [S(8) + 3 * i + 2, 'E5', .6]]),   // the cell's frame
      [S(9), 'E5', .9], [S(9) + 3, 'D5', .9], [S(9) + 6, 'G4', .9],      // G, not C: no C ringing into the final B
      [105, 'E4', 1], [105, 'E5', .9],
    ],
  },

  // AUDIO-ONLY levels per machine (velocity stays dynamics: the climax still strikes hard
  // and bright) — balanced offline from the voices' own renders; see MIX in the header
  mix: {
    musicbox: stage(1),
    marimba:  stage(.72),
    bass:     stage(.85, .45),
    bowls:    stage(.75, .5),
    bells:    stage(1, .45),
  },

  drums: {
    kick: sortHits([
      [48, .4], [51, .42], [54, .46], [57, .5],                              // §5 heartbeats
      ...[0, 1, 2, 3].flatMap(i => [[60 + 3 * i, .55 + .06 * i], [61.5 + 3 * i, .4 + .05 * i]]),
      ...G7.k, ...G8.k, [93, .75], ...G9.k, [105, .75],
    ]),
    snare: sortHits([
      [67, .45], [68, .55], [70, .6],                                        // §6 creeping in
      ...G7.s, ...G8.s, [94, .6], ...G9.s,
    ]),
    hat: sortHits([
      ...Array.from({ length: 20 }, (_, j) => [60 + j * .5, +(.2 + .3 * j / 19).toFixed(2)]),   // §6 creeping in
      ...G7.h, ...G8.h, ...G9.h,
    ]),
    crash: [[72, .75], [84, .65], [96, .75], [105, .75]],
    // fills, pitched IN KEY: tomLow = C, floor tom = A (tomMid would be D# — kept out)
    tomLow:    [[70.5, .6], [70.75, .65], [71, .7]],                         // §6 over the A bar
    floorHigh: [[71.25, .75], [71.5, .82], [71.75, .9],
                ...[0, 1, 2, 3, 4, 5, 6, 7].map(i => [94 + i * .25, +(.45 + .45 * i / 7).toFixed(2)]),   // §8 → §9: a roll on A, the Bm7's 7th
                [105, .65]],
  },
};
