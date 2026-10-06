/* NIGHT ON BALD MOUNTAIN — Modest Mussorgsky (St John's Eve on Bald Mountain, 1867),
   with the dawn of Rimsky-Korsakov's 1886 edition. Public domain. The witches' sabbath,
   re-scored for the whole room. The themes are transcribed in gesture from the 1867
   score (checked note-for-note against a piano reduction of it — the opening shriek, the
   Chernobog theme, the sabbath dance, the chromatic whirlwind); the dawn is Rimsky's
   idea (a distant church bell scatters the spirits, a calm D-major song) in our own notes.

   KEY: D minor (the theme sits on the dominant A — it is ALWAYS about to resolve, which is
   what makes it feel hunted) → D major at dawn. 4/4.

   TEMPO / THE SEAM: bpm = 60·9/3.8 ≈ 142.1, so the loop's fixed 3.8 s breath (ROLL_T + 1.2)
   is EXACTLY 9 beats: the dawn's last 3-beat D + the breath = 3 whole bars of morning,
   and the storm breaks back in ON the downbeat. Melody 139 beats + 9 = 148 = 37 bars,
   ~62.5 s per loop.

   FORM (beats):
     A    0–16   THE SHRIEK. The witches scream in: the lead marble skims four rising
                 16th-note shrieks (A → A#·C·D → D#, then B·C·D → E, then up to F and F#,
                 each falling back to the A it can't escape). Under it the TURNTABLE
                 (vibraphone) whirls the score's triplet turn A–G#–A–A# — the string
                 tremolo — the marimbist ROLLS an open A, the string bass pounds the
                 score's A–G#–A#–G# octaves, a timpani roll on the floor tom (tuned A)
                 swells into…
     B   16–48   CHERNOBOG'S THEME, twice: the syncopated brass theme (E·F·E·D·E·F·G·A…
                 over the A pedal, then A·A#·A·G·A·A#·C·D over D minor, a 16th-note
                 flourish up to A6). The belt ALTO enters as the TROMBONES, the theme an
                 octave down under the lead (Chernobog is a brass theme: the low belt's big
                 pads carry its weight). Bowls + the marimba's tremolo hold bare A octaves
                 (no E: the theme's F leans on the open A, nothing smears under it), the
                 drums march; the second time the bells toll and a
                 DIMINISHED tom cascade (G# F D# C A — all five toms, every one in the
                 spell) throws us into…
     C   48–80   THE SABBATH. The dance from the score: a chromatic climb D·E·F#·G·G#·A·A#
                 and its falling answer, over the bass pounding a B♭ pedal — the harmony
                 is a B♭ AUGMENTED triad (the bowls hold it: deliberate, unresolvable).
                 The marimbist joins on the bones (the dance an octave down), the
                 trombones hold the B♭+ in tall slow lobs (B♭·D·F#·D), the RICOCHET glass
                 wails high above (its spotlight: inside the B♭+, with a chromatic climb
                 B·C·C# into its last D), a pagan tom groove drives it; the climb repeats
                 faster and faster.
     D   80–112  THE FRENZY. Chernobog's theme in full cry — lead and trombones in
                 octaves, bells peal D, crashes, LIGHTNING; then the CHROMATIC
                 WHIRLWIND (the score's own chromatic scales): lead down while the alto
                 climbs (a wedge — deliberate chromatic dissonance), the marimbist sweeps
                 the keyboard in chromatic triplets (A5 → A#4 → F#5: 16ths are beyond
                 the robot's carriages at this tempo), toms cascade (the kit's spotlight);
                 two bars of diminished-7th shrieks (C#·E·G·A# then C·D#·F#·A — rolled on
                 the marimba under the lead's chromatic falls) and…
     E  112–139  DAWN. A church bell tolls D (after 24 beats of bell silence — its
                 entrance, the camera's cut). Everything stops; the sky greys toward
                 morning. The last spirits flicker
                 out on the turntable (the triplet turn, fading); the lead sings a calm
                 D-major song in tall slow arcs over the alto and the bowls; the music box
                 is the harp's rising arpeggios; the bell tolls three times, ever softer, and
                 once more for the final D.
                 The final D rings through the breath — and the shriek comes back.

   WHO LIVES WHERE (so nobody steps on anybody):
     string bass  G1–A#2  6 strings (A1 G#1 A#1 A#2 D2 G1 ≤ 8): the score's pounding
                          octaves, the B♭ pedal, the dawn roots
     bowls        D3–G4   held fifths / the B♭+ / the dawn chords (≤ 11 beats = 4.6 s,
                          under the 5 s cap; ≤ 4 notes)
     marimba      A3–A5   ROLLS (durBeats ≥ 1 = the robot marimbist's tremolo: ≤ 4 notes,
                          low = left hand) + the bones + the whirlwind sweep
     turntable    G#4–A#4 the triplet turn (mono), the dawn flicker
     alto (belt)  A#3–A5  trombones, from the theme on (delay 16): the theme an octave
                          down, the sabbath's B♭+ lobs, the frenzy, the dawn's inner voice
     lead (belt)  E4–F#6  the shrieks, the theme, the dance, the dawn song
     ricochet     F#5–D6  the wailing glass line over the sabbath (mono)
     bells        D4–E5   tolls only on chord tones that survive what follows (a tube
                          rings ~4 s)
     music box    D5–B6   the dawn harp (and a glint of the shriek, the whirlwind's peaks)
   Drums: kick + crash + all five PITCHED toms (A2 floor, C3, D#3, F3, G#3 — together a
   diminished-7th + the floor's A: every fill is in the spell) + a snare for the march.

   CLASHES THAT ARE MEANT: the shriek's A# and B against the A pedal and its E (Mussorgsky's
   own semitone grind — the only place the rolls hold an E), the sabbath's B♭-augmented
   (D·F# over B♭ against the dance's chromatic climb, and the glass's B·C·C# climb over
   the pedal), the theme's own A–B♭ neighbour, the whirlwind wedge, the diminished-7th
   shrieks. Everything else is kept consonant (checked by a beat-grid walk of every part,
   with each machine's real ring time).

   DIRECTOR: song.director.at scripts the story — the trombones' theme on the belts, the
   frenzy's wide downbeat, the kit's tom cascades, the dawn bell. song.storm cues the
   graveyard's lightning on the crashes (the thunder IS the cymbal) and stops at dawn;
   song.sky greys the sky at the bell and snaps back to midnight on the seam.

   MIX: song.mix stages each machine's AUDIO level (velocity stays dynamics + light),
   balanced offline from the voices' own renders so the belt reads on top.
   ============================================================ */

// ---- helpers ---------------------------------------------------------------------
const PC = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const num = n => { const m = /^([A-G]#?)(\d)$/.exec(n); return PC.indexOf(m[1]) + 12 * (+m[2] + 1); };
const name = k => PC[k % 12] + (Math.floor(k / 12) - 1);
const tr = (line, s) => line.map(([n, b]) => [name(num(n) + s), b]);
const r5 = x => +x.toFixed(5);
/** a chained [note, beats] line → pinned hits [beat, note, vel] starting at `at` */
const pin = (line, at, v = .8) => {
  let b = at; const out = [];
  for (const [n, d] of line){ out.push([r5(b), n, typeof v === 'function' ? +v(out.length).toFixed(3) : v]); b += d; }
  return out;
};
const sum = line => line.reduce((s, [, d]) => s + d, 0);
const sortHits = hs => hs.sort((a, b) => (Array.isArray(a) ? a[0] : a) - (Array.isArray(b) ? b[0] : b));
/** chromatic run from note a toward note b (inclusive), `step` beats apart */
const chroma = (a, b, step) => {
  const A = num(a), B = num(b), d = B > A ? 1 : -1, out = [];
  for (let k = A; d > 0 ? k <= B : k >= B; k += d) out.push([name(k), step]);
  return out;
};

// ---- THE LEAD (belt) ---------------------------------------------------------------
// A: four shrieks, each falling back to the A it can't escape
const SHRIEK = [
  ['A5', 1.25], ['A#5', .25], ['C6', .25], ['D6', .25], ['D#6', 1.25], ['D6', .25], ['C6', .25], ['A#5', .25],
  ['A5', 1.25], ['B5', .25],  ['C6', .25], ['D6', .25], ['E6', 1.25],  ['D6', .25], ['C6', .25], ['B5', .25],
  ['A5', 1], ['A#5', .25], ['C6', .25], ['D6', .25], ['E6', .25], ['F6', 1],  ['E6', .25], ['D6', .25], ['C6', .25], ['A#5', .25],
  ['A5', 1], ['B5', .25],  ['C6', .25], ['D6', .25], ['E6', .25], ['F#6', 1], ['E6', .25], ['D6', .25], ['C6', .25], ['B5', .25],
];
// B/D: Chernobog's theme (4 bars). `pick` = its first eighth (the A stab, or the E6 the
// previous statement's flourish resolves to).
const THEME = (pick = 'A5') => [
  [pick, .5], ['E5', 1], ['F5', .5], ['E5', .5], ['D5', .5], ['E5', .5], ['F5', .5],           // over A
  ['G5', 1], ['A5', 1], ['E5', .5], ['F5', .25], ['G5', .25], ['A5', .5], ['G5', .25], ['F5', .25],
  ['D5', .5], ['A5', 1], ['A#5', .5], ['A5', .5], ['G5', .5], ['A5', .5], ['A#5', .5],        // over D minor
  ['C6', 1], ['D6', 1], ['A5', .5], ['E6', .25], ['F6', .25], ['A6', .5], ['G6', .25], ['F6', .25],
];
// C: the sabbath dance — the climb and its fall (score, 1867), and the fall's short form
const CLIMB = [['D5', .5], ['E5', .5], ['F#5', .5], ['G5', .5], ['G#5', .5], ['A5', .5], ['A#5', .5], ['A5', .5]];
const FALL  = [['D6', .5], ['C6', .5], ['C6', .5], ['A5', .5], ['C6', .5], ['A#5', .5], ['A#5', .25], ['A5', .25], ['G5', .5]];
const FALL2 = [['D6', .5], ['C6', .5], ['A5', .5], ['C6', .5], ['A#5', .5], ['A5', .5], ['G5', 1]];
// D: the whirlwind (down A5→D5, up C#5→G#5) and the two diminished shrieks
const WHIRL = [...chroma('A5', 'D5', .5), ...chroma('C#5', 'G#5', .5)];
const DIM = [['A#5', .5], ['A5', .5], ['A#5', .5], ['A5', .5], ['G#5', .5], ['G5', .5], ['G#5', .5], ['G5', .5],
             ['F#5', .5], ['F5', .5], ['E5', .5], ['C#5', .5], ['C5', .5], ['D#5', .5], ['F#5', .5], ['A5', .5]];
// E: the dawn song (D major, tall slow arcs) — ends on a D held into the breath
const DAWN = [
  ['D5', 4],
  ['F#5', 2], ['E5', 1], ['D5', 1],
  ['A4', 3], ['B4', 1],
  ['A4', 2], ['G4', 1], ['F#4', 1],
  ['E4', 2], ['F#4', 1], ['G4', 1],
  ['A4', 2], ['E5', 2],
  ['D5', 3],
];

const melody = [
  ...SHRIEK,                      // A    0
  ...THEME('A5'), ...THEME('E6'), // B   16
  ...CLIMB, ...FALL, ...CLIMB, ...FALL, ...CLIMB, ...CLIMB, ...FALL2, ...FALL2,   // C 48
  ...THEME('A5'), ...WHIRL, ...DIM,                                              // D 80
  ...DAWN,                                                                       // E 112
];

// ---- THE ALTO (belt) — the trombones, from the theme (delay 16) ------------------------
const LOBS = [['A#3', 4], ['D4', 4], ['F#4', 4], ['D4', 4]];   // B♭·D·F#: the augmented triad, one per bar
const alto = {
  delay: 16,
  notes: [
    ...tr(THEME('A5'), -12), ...tr(THEME('E6'), -12),       // B: Chernobog, an octave under the lead
    ...LOBS, ...LOBS,                                      // C: the B♭+ in tall slow lobs (32 beats)
    ...tr(THEME('A5'), -12),                               // D: the theme an octave down
    ...chroma('D4', 'A4', .5), ...chroma('G#4', 'C#4', .5),   // the wedge: climbing while the lead falls, then
                                                           // falling while it climbs (16 eighths)
    ...tr(DIM, -12),                                       // the diminished shrieks, an octave down
    ['F#4', 4], ['A4', 4], ['E4', 4], ['D4', 4], ['B3', 4], ['E4', 4], ['F#4', 3],   // dawn: the slow inner voice
  ],
};

// ---- PLUGINS ---------------------------------------------------------------------------
const S = { A: 0, B: 16, C: 48, D: 80, E: 112 };

// TURNTABLE (vibraphone, mono): the score's triplet turn A–G#–A | A#–A–G# (the string
// tremolo) under the shrieks; the dawn's last flicker
const TURN = ['A4', 'G#4', 'A4', 'A#4', 'A4', 'G#4'];
const turntable = [
  ...Array.from({ length: 48 }, (_, i) => [r5(i / 3), TURN[i % 6], +(i % 3 === 0 ? .62 + .2 * (i / 47) : .4 + .15 * (i / 47)).toFixed(3)]),
  // dawn: the spirits flicker out — the turn, three times, fading to nothing
  ...[113, 115, 117].flatMap((b, k) => ['A4', 'G#4', 'A4', 'A#4'].map((n, j) => [r5(b + j / 3), n, +((.42 - .12 * k) * (1 - .12 * j)).toFixed(3)])),
];

// MARIMBA (the robot four-mallet marimbist): ROLLS for the tremolo (durBeats ≥ 1),
// the bones in the sabbath, a full-keyboard whirlwind sweep, the diminished rolls
const roll = (b, notes, v, d = 3.9) => notes.map(n => [b, n, v, d]);
const marimba = [
  ...roll(0, ['A3', 'A4'], .55), ...roll(4, ['A3', 'A4'], .6),
  ...roll(8, ['A3', 'E4', 'A4'], .65), ...roll(12, ['A3', 'E4', 'A4'], .75),
  // B: the tremolo under the theme — bare A octaves, then D minor
  ...[16, 32].flatMap((b, k) => [
    ...roll(b, ['A3', 'A4'], .5 + .08 * k), ...roll(b + 4, ['A3', 'A4'], .5 + .08 * k),
    ...roll(b + 8, ['D4', 'A4'], .52 + .08 * k), ...roll(b + 12, ['D4', 'F4', 'A4'], .55 + .08 * k),
  ]),
  // C: the bones — the dance an octave down, dry, from the second climb on
  // (accented by the BEAT, not by note count: counting notes put the accent after FALL's
  // 16th turn A#·A on an off-beat — a full-height stroke the wrist had no time to whip)
  ...pin(tr([...CLIMB, ...FALL, ...CLIMB, ...CLIMB, ...FALL2, ...FALL2], -12), 56).map(([b, n]) => [b, n, Number.isInteger(b) ? .68 : .5]),
  // D: the theme's tremolo at full cry…
  ...roll(80, ['A3', 'A4', 'A5'], .8), ...roll(84, ['A3', 'A4', 'A5'], .8),
  ...roll(88, ['D4', 'F4', 'A4'], .82), ...roll(92, ['D4', 'F4', 'A4'], .85),
  // …the whirlwind: chromatic TRIPLETS sweeping the keyboard (A5 down to A#4 and back up
  // to F#5), then a beat of air before the shrieks. (Re-voiced for the robot marimbist:
  // at 142 bpm a chromatic 16th run hops each mallet between the sharp and natural rows
  // faster than any carriage can follow, and a sweep that ends up at G#5 can't dive to the
  // shriek's close voicing in a triplet — the triplet whirl, turned round a little early,
  // keeps both chromatic scales inside the drive limits.)
  ...pin([...chroma('A5', 'A#4', 1 / 3), ...chroma('A4', 'F#5', 1 / 3)], 96, i => .55 + .4 * Math.abs(Math.sin(i / 21 * Math.PI))),
  // …the diminished shrieks, rolled (C#·E·G·A#, then C·D#·F#·A — four mallets each)
  ...roll(104, ['C#4', 'E4', 'G4', 'A#4'], .85), ...roll(108, ['C4', 'D#4', 'F#4', 'A4'], .9),
];

// STRING BASS: the score's pounding octaves, the B♭ pedal, the frenzy, the dawn roots
const quarters = (from, to, notes, v = .8, acc = 1) => {
  const out = [];
  for (let b = from, i = 0; b < to - 1e-9; b += 1, i++) out.push([b, notes[i % notes.length], +(Math.min(1, (b % 4 === 0 ? acc : 1) * v)).toFixed(3)]);
  return out;
};
const bass = [
  ...quarters(4, 16, ['A1', 'G#1', 'A#1', 'G#1'], .78),                  // A: the score's A–G#–A#–G#
  ...[16, 32].flatMap(b => [...quarters(b, b + 8, ['A1'], .62, 1.4), ...quarters(b + 8, b + 16, ['D2'], .62, 1.4)]),
  ...quarters(48, 80, ['A#1', 'A#2'], .72, 1.3),                          // C: the B♭ pedal, in octaves
  ...quarters(80, 88, ['A1'], .78, 1.25), ...quarters(88, 96, ['D2'], .78, 1.25),
  [96, 'A1', .9], [98, 'G#1', .85], [100, 'G1', .85], [102, 'G#1', .88],   // the whirlwind: the floor slides
  ...quarters(104, 112, ['A1'], .85, 1.15),                               // dominant pedal under the dim7s
  [112, 'D2', 1], [120, 'A1', .7], [124, 'G1', .65], [132, 'A1', .6], [136, 'D2', .7],   // dawn
];

// SINGING BOWLS: [beat, note, vel, beats] — held fifths, the B♭+, the dawn
const bowls = [
  [0, 'A3', .55, 11], [0, 'E4', .45, 11],
  [16, 'A3', .5, 8], [16, 'A4', .42, 8], [24, 'D3', .55, 8], [24, 'A3', .45, 8], [24, 'F4', .4, 8],
  [32, 'A3', .55, 8], [32, 'A4', .45, 8], [40, 'D3', .6, 8], [40, 'A3', .5, 8], [40, 'F4', .45, 8],
  // C: B♭ augmented — B♭·D·F# — unresolvable, held under the whole sabbath
  ...[48, 56, 64, 72].flatMap((b, k) => [[b, 'A#3', .5 + .05 * k, 8], [b, 'D4', .42 + .05 * k, 8], [b, 'F#4', .38 + .05 * k, 8]]),
  [80, 'D3', .75, 8], [80, 'A3', .6, 8], [88, 'D3', .75, 8], [88, 'A3', .6, 8], [88, 'F4', .5, 8],
  // E: dawn — D, G, A, D (the last one rings into the breath)
  [113, 'D3', .7, 11], [113, 'A3', .55, 11], [113, 'F#4', .45, 11],   // (a beat under the bell's ring: the bell's cut)
  [124, 'G3', .55, 8], [124, 'B3', .45, 8], [124, 'D4', .42, 8],
  [132, 'A3', .5, 4], [132, 'C#4', .4, 4], [132, 'E4', .4, 4],
  [136, 'D3', .45, 10], [136, 'A3', .38, 10], [136, 'F#4', .32, 10],
];

// RICOCHET (crystal glass, mono): a slow WAIL high over the sabbath — half notes inside
// the B♭+ (B♭·D·F#, the A a neighbour), then a chromatic climb B·C·C# into its last D
const ricochet = pin([
  ['A#5', 2], ['A5', 2], ['A#5', 2], ['D6', 2], ['C#6', 2], ['D6', 2], ['A#5', 2], ['A5', 2],
  ['A#5', 2], ['B5', 2], ['C6', 2], ['C#6', 2], ['D6', 2], ['F#5', 2], ['A#5', 2], ['D6', 2],
], 48, i => .5 + .3 * (i / 15));

// TUBULAR BELLS: chord tones that survive what follows them; the dawn bell tolls D
const bells = [
  [16, 'A4', .55],
  [32, 'A4', .62], [40, 'D5', .5],
  [48, 'D4', .5], [64, 'D4', .58],
  [80, 'D4', .9], [80, 'A4', .65], [88, 'D5', .75],      // (no A at 88: it would grind the theme's B♭s)
  // DAWN: the church bell — three tolls, each softer (the first doubled at the octave),
  // silent while the song turns through G and A, and once more on the final D
  [112, 'D4', 1], [112, 'D5', .7], [116, 'D4', .72], [120, 'D4', .55], [136, 'D4', .5], [136, 'A4', .3],
];

// MUSIC BOX: a glint on the shrieks, the frenzy's top octave, the dawn harp
const musicbox = [
  [2, 'D#6', .5], [6, 'E6', .5], [10.5, 'F6', .5], [14.5, 'F#6', .55],    // the shrieks' peaks, an icy glint
  [88, 'D6', .6], [88, 'F6', .55], [92, 'D6', .55], [92, 'F6', .5],
  [96, 'A6', .5], [103.5, 'A#6', .5],                       // two glints: the wedge's top, then the dim7's B♭
  // dawn: the harp — rising D-major arpeggios, sparse, ever higher
  // (each arpeggio spells the bowls' chord under it: D · G · G · A)
  ...[[120, ['D5', 'F#5', 'A5', 'D6']], [124, ['G5', 'B5', 'D6', 'G6']], [128, ['B5', 'D6', 'G6', 'B6']], [132, ['A5', 'C#6', 'E6', 'A6']]]
    .flatMap(([b, ns], k) => ns.map((n, j) => [r5(b + .5 * j), n, +(.42 + .06 * j - .03 * k).toFixed(3)])),
  [136, 'D6', .55], [136, 'A6', .5], [138, 'F#6', .4],
];

// ---- DRUMS (orchestral: bass drum, cymbal, snare, five pitched toms) -------------------
const D = { kick: [], snare: [], crash: [], floorHigh: [], tomLow: [], tomMid: [], tomHiMid: [], tomHigh: [] };
{
  // A: the slam, then a timpani roll on A (the floor tom) swelling into the theme
  D.kick.push([0, 1]); D.crash.push([0, .85]);
  for (let i = 0; i < 32; i++) D.floorHigh.push([r5(8 + i * .25), +(.25 + .65 * i / 31).toFixed(3)]);
  // B: the march — bass drum on the bars, snare on 2 & 4 the second time
  D.crash.push([16, 1], [32, .85]);
  for (const b of [16, 20, 24, 28]) D.kick.push([b, b === 16 ? 1 : .7]);
  for (let b = 32; b < 46; b += 4){ D.kick.push([b, .85], [b + 2, .65]); D.snare.push([b + 1, .55], [b + 3, .65]); }
  D.kick.push([44, .85], [45.5, .6]);
  // the DIMINISHED cascade: G# → F → D# → C → A, two strokes each, into the sabbath
  const fill = (b0, v = 1) => {
    [['tomHigh', 0], ['tomHiMid', .5], ['tomMid', 1], ['tomLow', 1.5]].forEach(([l, o], i) =>
      D[l].push([b0 + o, +(Math.min(1, (.62 + .06 * i) * v)).toFixed(3)], [b0 + o + .25, +(Math.min(1, (.66 + .06 * i) * v)).toFixed(3)]));
  };
  fill(46); D.floorHigh.push([47.75, .95]);
  // C: the pagan groove — bass drum 1 & 3, snare 2 & 4, floor + low tom thumping the "and"s
  D.crash.push([48, .9], [64, .9]);
  for (let b = 48; b < 78; b += 4){
    D.kick.push([b, .9], [b + 2, .75]); D.snare.push([b + 1, .6], [b + 3, .7]);
    D.floorHigh.push([b + .5, .5], [b + 2.5, .5]); D.tomLow.push([b + 1.5, .45], [b + 3.5, .55]);
  }
  fill(78, 1.1); D.kick.push([78, .9]);
  // D: the frenzy — bass drum on every beat, snare backbeat, crashes every two bars
  D.crash.push([80, 1], [88, .9]);
  for (let b = 80; b < 96; b += 1){ D.kick.push([b, b % 4 === 0 ? 1 : .72]); if (b % 2) D.snare.push([b, .72]); }
  // the whirlwind: tom cascades in 16ths, high → floor, four times, rising in force
  for (let k = 0; k < 4; k++){
    const b0 = 96 + 2 * k, v = .7 + .08 * k;
    ['tomHigh', 'tomHiMid', 'tomMid', 'tomLow', 'floorHigh', 'tomLow', 'tomMid', 'tomHiMid']
      .forEach((l, i) => D[l].push([r5(b0 + i * .25), +Math.min(1, v + (i === 4 ? .15 : 0)).toFixed(3)]));
    D.kick.push([b0, .9]);
  }
  D.crash.push([96, .8]);
  // the dim7 shrieks: kick 1 & 3, a snare roll swelling to the bell
  D.crash.push([104, .9]);
  for (const b of [104, 106, 108, 110]) D.kick.push([b, .9]);
  for (let i = 0; i < 24; i++) D.snare.push([r5(106 + i * .25), +(.3 + .7 * i / 23).toFixed(3)]);
  // 112: the bell — one last bass-drum + cymbal, and silence
  D.kick.push([112, 1]); D.crash.push([112, 1]);
  for (const l of Object.keys(D)) sortHits(D[l]);
}

// audio-only stage levels per machine ([beat, gain] steps) — see MIX in the header
const mix = {
  turntable: .7,
  marimba:   [[0, .55], [S.C, .5], [S.D, .42]],
  bass:      [[0, .62], [S.D, .55], [S.E, .65]],
  bowls:     [[0, .6], [S.D, .45], [S.E, .6], [116, .42]],   // the dawn chord blooms, then sits under the song
  ricochet:  .62,
  bells:     [[0, .8], [S.D, .6], [S.E, 1], [116, .85]],
  musicbox:  .7,
};

export default {
  label: 'Night on Bald Mountain', sub: 'Mussorgsky · the witches’ sabbath, until the bell',
  bpm: 60 * 9 / 3.8,                                   // ≈ 142.1: the loop's 3.8 s breath = 9 beats (see header)
  scale: ['D', 'E', 'F', 'G', 'A', 'A#', 'C', 'C#', 'F#'],
  room: 'graveyard',
  melody,
  alto,
  parts: { turntable, marimba, bass, bowls, ricochet, bells, musicbox },
  mix,
  // the director's pull: the sparse/sustained machines' moments (the bell at dawn, the
  // glass wail, the turntable's opening whirl) would lose the density vote
  director: {
    bells: 2.2, ricochet: 1.8, turntable: 1.4, drums: 2.5,
    shots: { bells: { x: 4.5, up: 7.2, dist: 12.5 } },   // the dawn bell against the (paling) moon, clear of the music box
    // the story beats, scripted: [beat, shot, hold beats]
    at: [
      [16, 'alto', 12],       // Chernobog: the trombones' theme, on the low belt
      [28, 'lead', 4],        // …the flourish up to A6
      [79.6, 'stage', 4],     // the frenzy: the whole room on one downbeat
      [84, 'alto', 8],        // the theme in full cry, lead + trombones
      [95.6, 'drums', 8],     // the whirlwind's tom cascades
      [111.6, 'bells', 10],   // DAWN: the church bell
      [122, 'lead', 12],      // the calm song's tall arcs
      [134, 'stage', 5],      // morning over the graveyard — and the storm comes back
    ],
  },
  storm: [0, 16, 32, 48, 64, 80, 88, 96, 104, 112],   // lightning = the cymbal; the last one is the bell's (then dawn)
  sky: [[0, 'night'], [112, 'dawn']],
  drums: D,
};

export const _bald = { sum, melodyBeats: sum(melody), sections: S };
