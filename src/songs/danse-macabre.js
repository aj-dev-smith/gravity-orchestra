/* DANSE MACABRE — Camille Saint-Saëns, Op. 40 (1874). Public domain. Death plays his
   fiddle at midnight; the skeletons rise and waltz until the cock crows. Re-scored for the
   whole room; the themes are transcribed in gesture from the score (checked against a
   flute reduction of the whole piece: the twelve D's, Death's A–E♭ tuning, the waltz and
   its semitone-up sequence, the descending chromatic second theme, the final farewell).

   KEY: G minor. 3/4 — a WALTZ: every bar is oom-pah-pah (the string bass's oom, the
   robot marimbist's dry pah-pah — the XYLOPHONE BONES).

   TEMPO / THE SEAM: bpm = 60·12/3.8 ≈ 189.5, so the loop's fixed 3.8 s breath is EXACTLY
   12 beats = 4 bars of 3/4: the farewell's last D + the breath land the loop back on the
   first stroke of midnight ON the downbeat. Melody 258 beats + 12 = 270 = 90 bars, ~85 s.

   FORM (beats · bars of 3):
     §1   0–36   MIDNIGHT. The clock strikes twelve: the TUBULAR BELLS toll D twelve times
                 (the harp's twelve D's), the lead marble swings between D5 and D4 like a
                 pendulum, the bowls hold an empty D–A fifth, a soft bass drum is the
                 clock's weight; the string bass creeps in pizzicato for the last four.
     §2  36–60   DEATH TUNES HIS FIDDLE. The famous mistuned open strings: A against E♭,
                 the TRITONE (diabolus in musica — deliberate). The belt plays the score's
                 rhythm; the TURNTABLE (vibraphone) sounds the other string of every
                 double-stop, so each strike is the whole devil's chord. The last E♭ slides
                 to D — and the waltz begins.
     §3  60–108  THE WALTZ. The skeletons' theme (G·B♭·G·A | B♭…) and its sequence a
                 semitone UP (G#·C·G#·A# — A♭, the Neapolitan: the floor tilts), stated low
                 over the bones' pah-pah (open fifths, so the theme's A never grinds), then
                 — 84 — THE XYLOPHONE BONES: the robot marimbist takes the theme itself, dry
                 and rattling (two hands in octaves, every long note re-struck — the
                 skeletons' teeth), under the belt an octave up. Bass oom, hat rattles.
     §4 108–144  THE SAD WALTZ. Death's second theme: the slow chromatic slide G·F·E·E♭·D
                 in tall two-beat arcs, harmonised Gm · B♭ · C · Cm · G · D7 · A7 · D, the
                 bowls swelling under it (their spotlight).
     §5 144–192  DIES IRAE. The chant of the dead (B♭·A·B♭·G·A·F·G·G), SIX beats a note — the
                 tallest, slowest arcs in the piece (apex ∝ dt²: the dead rise highest), the
                 bowls an organ chorale under it, the MUSIC BOX turning a creepy lullaby
                 above, a bell tolling once on D and once on G.
     §6 192–228  THE FRENZY. The waltz theme at full cry — everyone: bells pealing, crashes,
                 snare on the pahs; then a CHROMATIC WHIRLWIND (the score's whipping scales:
                 lead up, turntable down, the marimbist sweeping two octaves in 16ths, a tom
                 cascade), and three hammer-blows of G minor.
     §7 228–258  COCKCROW. Silence — a lone figure on the belt: the cock crows (D·D·A–F#,
                 the oboe's crow, in gesture). Everyone SCATTERS (fleeing scraps on the music
                 box, turntable and marimba). Death plays his farewell (D · B♭ A G · G · B♭ ·
                 G F E♭ · E♭), his tritone one last time, the theme's ghost — and the loop's
                 breath turns back to midnight.

   WHO LIVES WHERE:
     string bass  G1–D#2  7 strings (G1 G#1 A1 A#1 C2 D2 D#2 ≤ 8): the waltz's oom
     marimba      F#3–C6  the bones: dry pah-pah fifths, the theme rattled (§3b), the 16th
                          whirlwind (≤ 4 mallets: low notes left hand, high right)
     bowls        D3–G4   the empty fifth, the sad-waltz chords, the Dies Irae chorale
                          (≤ 15 beats = 4.75 s, under the 5 s cap; ≤ 3 notes)
     turntable    F#4–D#5 Death's other string, the frenzy's theme an octave down, the whirlwind
     lead (belt)  D#4–A#5 the pendulum, the fiddle, the waltz, the chant, the crow
     bells        D4–D5   midnight's twelve, frenzy peals, the chant's tolls
     music box    D5–C7   the creepy lullaby, frenzy glints, the scatter
   Drums: kick (the clock / the oom), hat (bone rattles on the pahs), snare (the frenzy's
   pahs), crash, and the toms (A2 C3 D#3 F3 G#3 — all in G minor's orbit) for the whirlwind.

   CLASHES THAT ARE MEANT: the tritone (§2, §7), the theme's own A–B♭ rub over G minor
   (kept to the melody: the bones play bare fifths), the whirlwind's contrary chromatic
   scales, the scatter, and the LAST STROKE OF MIDNIGHT bleeding into Death's first E♭
   (the tube rings ~4 s: a D–E♭–A cluster — the clock's ghost under the devil's tuning).
   Everything else checked consonant by a beat-grid walk of every part (with each
   machine's real ring time).

   DIRECTOR: song.director.at scripts the story beats the density vote would miss — the
   moonlit establishing shot, the bells at midnight, Death tuning (the belt), the bones'
   solo, the chant's towering arcs, the frenzy's wide downbeat, the cock-crow.
   song.storm cues the graveyard's lightning on the hammer-blows (the thunder IS the
   cymbal); song.sky turns the sky grey-rose at cockcrow and back to midnight on the seam.
   ============================================================ */

// ---- helpers ---------------------------------------------------------------------
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
const chroma = (a, b, step) => {
  const A = num(a), B = num(b), d = B > A ? 1 : -1, out = [];
  for (let k = A; d > 0 ? k <= B : k >= B; k += d) out.push([name(k), step]);
  return out;
};
const sortHits = hs => hs.sort((a, b) => (Array.isArray(a) ? a[0] : a) - (Array.isArray(b) ? b[0] : b));

// ---- THE LEAD (belt) ---------------------------------------------------------------
// §1 the pendulum under the twelve strokes
const MIDNIGHT = Array.from({ length: 12 }, (_, i) => [i % 2 ? 'D4' : 'D5', 3]);
// §2 Death's tuning — the score's rhythm, A against E♭ (the last E♭ slides to D)
const FIDDLE = [
  ['D#5', 3], ['A4', 3], ['D#5', 2], ['D#5', 1], ['A4', 2], ['A4', 1],
  ['D#5', .5], ['D#5', .5], ['D#5', 1], ['A4', 1], ['D#5', .5], ['D#5', .5], ['D#5', 1], ['A4', 1],
  ['D#5', 1], ['A4', 1], ['D#5', 1], ['A4', 1], ['D#5', 1], ['D5', 1],
];
// §3/§6 the waltz theme (8 bars): G minor, then the sequence a semitone up (A♭).
// `first` = the downbeat that opens it (the resolution of what came before).
const WALTZ = (o, first) => {
  const g = n => n + o, g1 = n => n + (+o + 1);
  return [
    [first, 1], [g('G'), .5], [g('A#'), .5], [g('G'), .5], [g('A'), .5],
    [g('A#'), 1], [g('A'), .5], [g('A#'), .5], [g('G'), .5], [g('A#'), .5],
    [g('A'), .5], [g('G'), .5], [g('G'), .5], [g('A#'), .5], [g('G'), .5], [g('A'), .5],
    [g('A#'), 1], [g('A'), .5], [g('A#'), .5], [g('G'), .5], [g('A#'), .5],
    [g('G#'), 1], [g('G#'), .5], [g1('C'), .5], [g('G#'), .5], [g('A#'), .5],
    [g1('C'), 1], [g('A#'), .5], [g1('C'), .5], [g('G#'), .5], [g1('C'), .5],
    [g('A#'), .5], [g('G#'), .5], [g('G#'), .5], [g1('C'), .5], [g('G#'), .5], [g('A#'), .5],
    [g1('C'), 1], [g('G#'), .5], [g1('C'), .5], [g('A#'), .5], [g('G#'), .5],
  ];
};
// §4 the sad waltz (octave 5), one bar per chord
const SAD = [
  ['G5', 2], ['D5', 1],                                   // the pickup bar
  ['G5', 2], ['G5', 1], ['F5', 2], ['F5', 1], ['E5', 2], ['E5', 1], ['D#5', 2], ['D#5', 1],
  ['D5', 1], ['E5', 1], ['G5', 1], ['F#5', 1], ['E5', 1], ['D5', 1], ['E5', 2], ['E5', 1], ['F#5', 2], ['D5', 1],
  ['D5', 1], ['G5', 1], ['A#5', 1], ['A5', 1], ['F#5', 1], ['D5', 1], ['F#5', 2], ['E5', 1],
];
const SAD_CHORDS = ['Gm', 'Gm', 'Bb', 'C', 'Cm', 'G', 'D7', 'A7', 'D', 'Gm', 'D7', 'D'];
// §5 Dies Irae: six beats (two bars) a note — the tallest arcs in the piece
const DIES = [['A#5', 6], ['A5', 6], ['A#5', 6], ['G5', 6], ['A5', 6], ['F5', 6], ['G5', 6], ['G5', 6]];
const DIES_CHORDS = ['Gm', 'D', 'Gm', 'Eb', 'D', 'Bb', 'Gm', 'Gm'];
// §6 whirlwind + hammer-blows
const WHIRL = chroma('G4', 'F#5', .5);
const HAMMER = [['G5', 1], ['D5', 1], ['A#5', 1], ['G5', 3]];
// §7 the crow, the scatter's held breath, Death's farewell, the last tritone, the ghost
const COCKCROW = [
  ['D5', .5], ['D5', .5], ['A5', 1.5], ['F#5', .5],
  ['A4', 3],
  ['D5', 3], ['A#4', 1], ['A4', 1], ['G4', 1], ['G4', 3], ['A#4', 3], ['G4', 1], ['F4', 1], ['D#4', 1], ['D#4', 3],
  ['A4', 1], ['D#5', 1], ['A4', 1],
  ['G4', .5], ['A#4', .5], ['A4', .5], ['G4', .5], ['D5', 1],
];

const melody = [
  ...MIDNIGHT,                                   // §1    0
  ...FIDDLE,                                     // §2   36
  ...WALTZ('4', 'G5'), ...WALTZ('5', 'G4'),      // §3   60
  ...SAD,                                        // §4  108
  ...DIES,                                       // §5  144
  ...WALTZ('5', 'G5'), ...WHIRL, ...HAMMER,      // §6  192
  ...COCKCROW,                                   // §7  228
];

// ---- harmony tables --------------------------------------------------------------
const BASS = { Gm: 'G1', Ab: 'G#1', Bb: 'A#1', C: 'C2', Cm: 'C2', G: 'G1', D7: 'D2', D: 'D2', A7: 'A1', Eb: 'D#2' };
const BONES = {                                    // the marimba's pah-pah (dry, mid-low)
  Gm: ['G3', 'D4'], Ab: ['G#3', 'D#4'], Bb: ['F3', 'A#3', 'D4'], C: ['G3', 'C4', 'E4'], Cm: ['G3', 'C4', 'D#4'],
  G: ['G3', 'D4'], D7: ['F#3', 'A3', 'C4'], D: ['F#3', 'A3', 'D4'], A7: ['A3', 'C#4', 'G4'], Eb: ['G3', 'A#3', 'D#4'],
};
const PAD = {                                      // the bowls
  Gm: ['G3', 'A#3', 'D4'], Ab: ['G#3', 'C4', 'D#4'], Bb: ['F3', 'A#3', 'D4'], C: ['G3', 'C4', 'E4'], Cm: ['G3', 'C4', 'D#4'],
  G: ['G3', 'D4'], D7: ['F#3', 'A3', 'C4'], D: ['F#3', 'A3', 'D4'], A7: ['A3', 'C#4', 'G4'], Eb: ['G3', 'A#3', 'D#4'],
};
const LULLABY = { Gm: ['D6', 'G6', 'A#6'], D: ['D6', 'F#6', 'A6'], Eb: ['D#6', 'G6', 'A#6'], Bb: ['D6', 'F6', 'A#6'] };
const WALTZ_CHORDS = ['Gm', 'Gm', 'Gm', 'Gm', 'Ab', 'Ab', 'Ab', 'Ab'];
const DIES_BARS = DIES_CHORDS.flatMap(c => [c, c]);   // a chord per chant note = two bars

/** oom-pah-pah for a run of bars: bass on 1, the bones on 2 and 3 */
function waltzBars(at, chords, { vb = .75, vm = .5, rattle = false } = {}){
  const bass = [], marimba = [], hat = [];
  chords.forEach((c, i) => {
    const b = at + 3 * i;
    bass.push([b, BASS[c], vb]);
    for (const off of [1, 2]) for (const n of BONES[c]) marimba.push([b + off, n, +(vm * (off === 1 ? 1 : .8)).toFixed(3)]);
    if (rattle) hat.push([b + 1, .32], [b + 2, .26]);
  });
  return { bass, marimba, hat };
}

const W3a = waltzBars(60, WALTZ_CHORDS, { vb: .7, vm: .45, rattle: true });
const W3b = waltzBars(84, WALTZ_CHORDS, { vb: .78, vm: .52, rattle: true });
const W4  = waltzBars(108, SAD_CHORDS, { vb: .62, vm: .34 });
const W5  = waltzBars(144, DIES_BARS, { vb: .6, vm: .3 });
const W6  = waltzBars(192, WALTZ_CHORDS, { vb: .95, vm: .7, rattle: true });

// ---- PLUGINS ---------------------------------------------------------------------
// TUBULAR BELLS
const bells = [
  // MIDNIGHT: twelve strokes of D (the first doubled at the octave; the twelfth plain and
  // softer — it still bleeds into Death's first E♭: meant, see CLASHES)
  ...Array.from({ length: 12 }, (_, i) => [3 * i, 'D4', i === 11 ? .55 : +(.78 - (i % 2) * .06).toFixed(3)]),
  [0, 'D5', .5],
  [168, 'D4', .6], [180, 'G4', .55],                     // the chant's tolls (on its D and its G)
  [192, 'G4', .6], [204, 'G#4', .8], [204, 'C5', .6],    // the frenzy peals: G (soft — only its first 3 s matter), then A♭
  [222, 'G4', .9], [222, 'D5', .7],                      // the hammer-blows
];

// TURNTABLE (vibraphone, mono): Death's other string, the frenzy's theme an octave down,
// the whirlwind falling against the lead's rise (12 notes: its G#4 leads into the
// hammer-blow's G), a fleeing scrap at the cockcrow
const other = n => n === 'A4' ? 'D#5' : n === 'D#5' ? 'A4' : null;
const turntable = [
  ...pin(FIDDLE, 36, .55).map(([b, n, v]) => [b, other(n) || 'A4', v]).slice(0, -1),   // (the slide to D: the lead alone)
  ...pin(WALTZ('4', 'G4'), 192, i => i % 5 === 0 ? .6 : .48),
  ...pin(chroma('G5', 'G#4', .5), 216, .5),
  ...pin([['D#5', .25], ['C5', .25], ['A4', .25], ['F#4', .25]], 231.5, i => .4 - .07 * i),   // fleeing
  ...pin([['D#5', 1], ['A4', 1]], 252, .38),                                                  // the tritone, once more
];

// MARIMBA — the bones (dry pah-pah); THE XYLOPHONE BONES at 84: the theme itself, rattled
// (two hands in octaves — left G4 octave, right G5 — every long note re-struck as two
// dry eighths: Saint-Saëns' rattling teeth); rattles at phrase ends; the whirlwind
const rattle = (b, n, v) => [0, .5, 1, 1.5].map(o => [b + o, n, +(v * (o ? .8 : 1)).toFixed(3)]);
const BONE_THEME = WALTZ('4', 'G4').flatMap(([n, d]) => d >= 1 ? [[n, .5], [n, .5]] : [[n, d]]);
const boneSolo = [
  ...pin(BONE_THEME, 84, i => i % 6 === 0 ? .78 : .6),                                // left hand
  ...pin(tr(BONE_THEME, 12), 84, i => i % 6 === 0 ? .7 : .52),                        // right hand, an octave up
];
const marimba = sortHits([
  ...W3a.marimba, ...boneSolo, ...W4.marimba, ...W5.marimba, ...W6.marimba,
  ...rattle(70, 'G5', .55), ...rattle(202, 'G5', .7), ...rattle(214, 'G#5', .72),
  ...pin(chroma('G3', 'F#5', .25), 216, i => .5 + .45 * i / 23),       // the whirlwind sweep
  ...[222, 225].flatMap(b => [[b, 'G3', 1], [b, 'D4', .95], [b, 'G4', .95], [b, 'A#4', .9]]),   // hammer-blows (4 mallets)
  ...pin([['G5', .25], ['F5', .25], ['D5', .25], ['A#4', .25], ['G4', .25]], 232, i => .45 - .06 * i),   // fleeing
]);

// STRING BASS — pizzicato creeping in at midnight, under the fiddle, the waltz's oom
const bass = sortHits([
  [24, 'D2', .45], [27, 'D2', .5], [30, 'D2', .55], [33, 'D2', .6],
  // under the fiddle: G, the key it is about to fall into (a D here would grind the E♭)
  ...[36, 39, 42, 45, 48, 51, 54].map((b, i) => [b, 'G1', +(.55 + .03 * i).toFixed(3)]), [57, 'G1', .7],
  ...W3a.bass, ...W3b.bass, ...W4.bass, ...W5.bass, ...W6.bass,
  [216, 'G1', .9], [219, 'G#1', .85], [222, 'G1', 1], [225, 'G1', 1],
  [234, 'G1', .55], [240, 'G1', .5], [243, 'D#2', .5], [249, 'C2', .5], [252, 'D2', .45], [255, 'G1', .5], [257, 'D2', .45],
]);

// SINGING BOWLS [beat, note, vel, beats] — ≤ 15 beats (4.75 s)
const bowls = [
  [0, 'D3', .4, 15], [0, 'A3', .32, 15], [15, 'D3', .42, 15], [15, 'A3', .34, 15], [30, 'D3', .45, 6], [30, 'A3', .36, 6],
  [60, 'G3', .35, 12], [60, 'D4', .3, 12], [72, 'G#3', .35, 12], [72, 'D#4', .3, 12],
  [84, 'G3', .38, 12], [84, 'D4', .32, 12], [96, 'G#3', .38, 12], [96, 'D#4', .32, 12],
  // the sad waltz: a chord per bar, swelling (the bowls' spotlight)
  ...SAD_CHORDS.flatMap((c, i) => PAD[c].map((n, j) => [108 + 3 * i, n, +((.42 + .025 * i) * (1 - .12 * j)).toFixed(3), 3])),
  // the chant's organ: one chord per chant note, held its whole six beats (1.9 s)
  ...DIES_CHORDS.flatMap((c, i) => PAD[c].map((n, j) => [144 + 6 * i, n, +(.55 * (1 - .12 * j)).toFixed(3), 6])),
  [192, 'G3', .5, 12], [192, 'D4', .42, 12], [204, 'G#3', .5, 12], [204, 'D#4', .42, 12],
  [222, 'G3', .7, 6], [222, 'A#3', .6, 6], [222, 'D4', .6, 6],
  // cockcrow: the grey dawn under Death's farewell
  [234, 'G3', .45, 9], [234, 'A#3', .38, 9], [234, 'D4', .35, 9],
  [243, 'D#3', .42, 6], [243, 'G3', .38, 6], [243, 'A#3', .35, 6],
  [249, 'G3', .4, 3], [249, 'C4', .34, 3], [249, 'D#4', .32, 3],
  [252, 'D3', .4, 3], [252, 'A3', .34, 3],
  [255, 'G3', .38, 3], [255, 'D4', .32, 3],
];

// MUSIC BOX — the creepy lullaby over the chant (each chord's arpeggio up, then back down
// softer: a wind-up toy left playing in a crypt), frenzy glints, fleeing sparkles
const musicbox = [
  ...DIES_CHORDS.flatMap((c, i) => {
    const ns = LULLABY[c], k = i < 7 ? 1 : .7, b = 144 + 6 * i;
    return [...ns.map((n, j) => [b + j, n, +((j ? .32 : .42) * k).toFixed(3)]),
            ...[...ns].reverse().map((n, j) => [b + 3 + j, n, +(.24 * k).toFixed(3)])];
  }),
  [192, 'G6', .55], [192, 'D6', .45], [204, 'G#6', .55], [204, 'D#6', .45],
  ...pin(chroma('G5', 'F#6', .5), 216, .42),
  [222, 'G6', .6], [222, 'D6', .5], [225, 'A#6', .6],
  ...pin([['C7', .25], ['A6', .25], ['F#6', .25], ['D#6', .25], ['C6', .25], ['A5', .25]], 231, i => .4 - .04 * i),   // fleeing
];

// ---- DRUMS ---------------------------------------------------------------------------
const D = { kick: [], snare: [], hat: [], crash: [], tomHigh: [], tomHiMid: [], tomMid: [], tomLow: [], floorHigh: [] };
{
  for (let i = 0; i < 12; i++) D.kick.push([3 * i, .3]);                    // the clock's weight
  for (const b of [60, 63, 66, 69, 72, 75, 78, 81]) D.kick.push([b, .45]);
  for (const b of [84, 87, 90, 93, 96, 99, 102, 105]) D.kick.push([b, .55]);
  D.hat.push(...W3a.hat, ...W3b.hat);
  for (let b = 108; b < 192; b += 3) D.kick.push([b, .3]);
  // the frenzy: oom (kick) pah-pah (snare), hat rattles, crashes on the phrase heads
  D.crash.push([192, 1], [204, .85]);
  for (let b = 192; b < 216; b += 3){ D.kick.push([b, .9]); D.snare.push([b + 1, .55], [b + 2, .48]); }
  D.hat.push(...W6.hat);
  // a fill into the whirlwind, then the tom cascade in 16ths
  D.tomHigh.push([214, .7], [214.5, .75]); D.tomMid.push([215, .8]); D.floorHigh.push([215.5, .9]);
  const LANES = ['tomHigh', 'tomHiMid', 'tomMid', 'tomLow', 'floorHigh', 'tomLow'];
  for (let i = 0; i < 24; i++) D[LANES[i % 6]].push([r5(216 + i * .25), +(.55 + .4 * i / 23).toFixed(3)]);
  D.kick.push([216, .9], [219, .9]);
  // the hammer-blows
  D.crash.push([222, 1], [225, 1]); D.kick.push([222, 1], [223, .8], [224, .8], [225, 1]);
  D.snare.push([223, .9], [224, .9]);
  D.floorHigh.push([225.5, .7], [226, .8], [226.5, .9]);
  for (const l of Object.keys(D)) sortHits(D[l]);
}

// audio-only stage levels per machine — the lead belt reads on top
const mix = {
  bells:     [[0, .85], [60, .7], [192, .55]],
  turntable: [[0, .65], [192, .5]],
  marimba:   [[0, .5], [84, .62], [108, .5], [144, .36], [192, .4]],   // the bones' solo steps up; hushed under the chant
  bass:      [[0, .75], [144, .58], [192, .62]],
  bowls:     [[0, .7], [144, .4], [192, .5]],      // the chant's organ sits UNDER the chant
  musicbox:  .65,
};

export default {
  label: 'Danse Macabre', sub: 'Saint-Saëns · midnight, the fiddle, the bones, the cock',
  bpm: 60 * 12 / 3.8,                                  // ≈ 189.5: the loop's 3.8 s breath = 12 beats = 4 bars
  scale: ['G', 'A', 'A#', 'C', 'D', 'D#', 'F', 'F#'],
  room: 'graveyard',
  melody,
  parts: { bells, turntable, marimba, bass, bowls, musicbox },
  mix,
  director: {
    // the density vote's pull per machine: the bells' sparse tolls need help; the busy
    // accompaniment (pah-pahs, glints, the turntable's doubling) must not outvote Death
    bells: 2.2, bowls: 1.1, marimba: .8, turntable: .7, musicbox: .6, drums: 1.2,
    // the graveyard's money frame: the chimes against the moon, eye swung clear of the music box
    shots: { bells: { x: 4.5, up: 7.2, dist: 12.5 } },
    // the story beats, scripted: [beat, shot, hold beats]
    at: [
      [0, 'stage', 9],        // midnight: the moonlit churchyard, the whole machine waiting
      [9, 'bells', 24],       // the clock strikes on
      [33, 'lead', 27],       // Death tunes his fiddle (the last stroke → the tritone)
      [72, 'lead', 9],        // the waltz slips up a semitone (A♭): the floor tilts
      [84, 'marimba', 24],    // the xylophone bones
      [144, 'lead', 30],      // Dies irae: the tallest arcs in the piece
      [191.4, 'stage', 5],    // the frenzy breaks: the whole room on one downbeat
      [215.6, 'marimba', 6],  // the whirlwind: the marimbist sweeps two octaves
      [221.6, 'stage', 5],    // the hammer-blows (lightning on each)
      [228, 'lead', 18],      // the cock crows
      [252, 'stage', 6],      // everyone scatters — back to midnight
    ],
  },
  storm: [192, 204, 216, 222, 225],   // lightning = the cymbal: frenzy heads, the whirlwind, the hammer-blows
  sky: [[0, 'night'], [228, 'dawn']],  // the grey cockcrow; the seam's breath returns to midnight
  drums: D,
};

export const _danse = { sum, melodyBeats: sum(melody) };
