/* WINTER — Antonio Vivaldi, The Four Seasons (Le quattro stagioni, Op. 8 no. 4,
   Concerto in F minor, RV 297, publ. 1725), first movement: Allegro non molto.
   Public domain. Arranged for tonight's machines: the BOW WHEEL is the string band,
   the MARBLE GRAND (key 'dulcimer') is the harpsichord continuo, the STRING BASS is
   the basso, and the belt lead is the solo violin.

   Vivaldi printed a sonnet over the concerto and wrote its lines INTO the score, over
   the bars they paint. This loop walks four of them, faithful in gesture (the staggered
   shivering entries, the chromatically sinking bass, the solo's wind-gust arpeggios, the
   tutti's stamping, the soloist's chattering teeth) — an arrangement, not a note-for-note
   transcription:
     "Agghiacciato tremar tra nevi algenti"   — to shiver, frozen, in the icy snow
     "Al severo spirar d'orrido vento"        — in the harsh breath of a horrid wind
     "Correr battendo i piedi ogni momento"   — to run, stamping one's feet every moment
     "E pel soverchio gel batter i denti"     — and for the bitter cold, teeth chattering

   KEY: F minor (C7, with its leading-tone E natural, is the dominant). 4/4, counted in
   quarter beats; an eighth = .5, a sixteenth = .25.

   TEMPO / THE SEAM: bpm = 60·4/3.8 ≈ 63.16 — the loop's fixed 3.8 s breath (ROLL_T + 1.2)
   is EXACTLY 4 beats = one bar, so 15 bars of music + the breath bar = 16 bars ON the
   pulse (~60.8 s). It is also the bow wheel's own speed limit: same-string onsets closer
   than its MIN_REPEAT (~.4 s) MERGE into one long stroke, and at 63 an eighth is .475 s —
   so every shivering eighth is a REAL separate bow (press, kick, hop, re-bow), never a
   smear. (At the usual ~80 the eighths would merge into sustained chords: the shiver
   would vanish. Re-solve the seam AND that limit before touching the bpm.)

   FORM (15 bars + the breath):
     A  bars 1–6   0–24   SHIVERING. Pianissimo repeated eighths on the bow wheel, the
                          voices entering one at a time (low, then middle, then top), over
                          the string bass shivering on a chromatic descent F·E·E♭·D·D♭·C —
                          the lament ground (i · V⁶ · i⁴₂ · IV⁶ · iv⁶ · V) — crescendo.
                          The solo violin (belt) holds tall frozen notes and trills at the
                          end of each bar: tall arcs, then a shiver of flat skims.
     B  bars 7–10  24–40  THE HORRID WIND. The soloist's flashing runs — sixteenths sweeping
                          two octaves (Fm plunge, B♭m scale with its G♭, the C7♭9 diminished
                          climb, the C7 fall that dies low) — over the wheel's LONG bow:
                          whole-bar sustained chords, the other face of the same machine. The
                          harpsichord punctuates; the bass walks quarters.
     C  bars 11–12 40–48  STAMPING FEET. Tutti forte: everyone hammering eighths on
                          i · VI | iv⁶ · V⁷ — up to five strings at once on the wheel, the
                          harpsichord on every beat, the soloist's broken chords.
     D  bars 13–14 48–56  CHATTERING TEETH. The soloist's tremolo: two notes alternating in
                          sixteenths, over hushed sustained chords.
     E  bar 15     56–60  THE FREEZE. The shiver returns on C7 (the dominant), crescendo, and
                          at beat 59 the wheel's two LOW strings (C3·G3, kept free all loop
                          for this) take a long bow and the harpsichord rolls C7 — both ring
                          through the breath bar, a held dominant that falls onto the tonic
                          shiver of bar 1. The loop's last bar leads into its first.

   WHO PLAYS:
     belt lead   the solo violin (one marble). No alto/bass belts — the wheel and the
                 string bass own the band, the belt is the soloist.
     bowwheel    12 strings exactly (its MAX_STRINGS): C3 F3 G3 · C4 C#4 D4 E4 F4 G4 G#4
                 A#4 · C5. Viola / violin II in the shiver, the tutti in the stamping.
     dulcimer    the harpsichord: ROLLED chords (the notes a few hundredths of a beat
                 apart — the keyboardist's spread) with short damper times, left hand an
                 octave over the bass. The plain piano timbre (no ':e'); soft hits pick its
                 ':p' layer by themselves (vel < .6).
     bass        the basso: 6 strings, F2 E2 D#2 D2 C#2 C2 (≤ 8), shivering eighths in A,
                 walking quarters in B, stamping eighths in C. Octave 2, not 1: phones.

   MIX (song.mix, audio-only — velocity stays dynamics): the soloist on top; the wheel's
   twelve strings and the harpsichord are pulled under it, the basso sits just below.

   iOS NOTE (§5): the sample path ignores `dur` — a bowed string rings its whole 4.3 s
   render each stroke (one <audio> per string, so a re-bow cuts its own tail). The wheel's
   chords therefore move by common tones and steps (F4 and C4 are held almost throughout)
   to keep that over-ring consonant; it is a known degradation, the live path is exact.

   DIRECTOR: the whole edit is scripted (the piece is a sequence of pictures, and the vote
   alone gave the shiver's crescendo to a wide shot): the wheel opens the loop (the shiver
   IS this piece), hands to the basso's sinking ground, then the harpsichord swelling into
   the wind; the belt takes the wind and the teeth (its fastest, flattest skims), with the
   wheel's long bow between; the wide shot takes the stamping downbeat, the harpsichord its
   hammered beats; the wheel owns the freeze through the breath. Shares (director-audit):
   lead 34% · bowwheel 25% · dulcimer 20% · strings 14% · stage 7%.
   ============================================================ */

const r5 = x => +x.toFixed(5);
const sum = line => line.reduce((s, [, d]) => s + d, 0);
const h = (ns, d) => ns.map(n => [n, d]);
/** alternating two-note figure (a trill / the teeth): n pairs of sixteenths */
const alt = (a, b, n) => Array.from({ length: n }, () => [[a, .25], [b, .25]]).flat();
const ramp = (v0, v1, i, n) => +(v0 + (v1 - v0) * i / Math.max(1, n - 1)).toFixed(3);

// ---- THE SOLO VIOLIN (belt, chained) ----------------------------------------------
const A = [
  ['C5', 3], ...alt('C#5', 'C5', 2),                          // 1  Fm      — frozen C, a D♭ shiver
  ['A#4', 3], ...alt('C5', 'A#4', 2),                         // 2  C7/E    — B♭ over the leading tone
  ['G#4', 2], ['C5', 1], ['F5', 1],                           // 3  Fm/E♭   — the line climbs out
  ['F5', 3], ...alt('G5', 'F5', 2),                           // 4  B♭/D    — Dorian G♮ trill
  ['F5', 2], ['A#4', 1], ['C#5', 1],                          // 5  B♭m/D♭
  ['C5', 1], ['E5', 1], ['G5', 1], ['A#5', 1],                // 6  C7      — the arpeggio that lifts the wind
];
const B = [
  ...h(['F6','C6','G#5','F5', 'C5','G#4','F4','C4', 'F4','G#4','C5','F5', 'G#5','C6','F6','C6'], .25),   // 7  Fm: the gust plunges and climbs
  ...h(['F6','D#6','C#6','C6', 'A#5','G#5','F#5','F5', 'C#5','F5','A#5','C#6', 'F6','C#6','A#5','F5'], .25), // 8  B♭m: the scale, G♭ and all
  ...h(['E5','G5','A#5','C#6', 'E6','C#6','A#5','G5', 'E5','G5','A#5','C#6', 'E6','G6','E6','C#6'], .25), // 9  C7♭9: the diminished climb
  ...h(['C6','A#5','G#5','G5', 'F5','E5','F5','G5', 'A#5','G5','E5','C#5', 'C5','A#4','G4','E4'], .25), // 10 Fm · C7: the gust dies low
];
const C = [
  ...h(['C6','G#5','F5','G#5', 'C#6','G#5','F5','G#5'], .5),   // 11 Fm · D♭  — stamping broken chords
  ...h(['C#6','A#5','F5','A#5', 'C6','G5','E5','G5'], .5),     // 12 B♭m/D♭ · C7
];
const D = [
  ...alt('C6', 'G#5', 4), ...alt('C#6', 'F5', 4),             // 13 Fm · D♭  — teeth
  ...alt('C#6', 'A#5', 4), ...alt('A#5', 'E5', 2),            // 14 B♭m · C7 …
  ['G5', .25], ['E5', .25], ['C5', .25], ['G4', .25],         //    … shaking down into the freeze
];
const E = [['E5', 4]];                                        // 15 the leading tone, frozen through the breath

const melody = [...A, ...B, ...C, ...D, ...E];
const BAR = b => (b - 1) * 4;                                 // beat at which bar b (1-based) starts
const LOOP = sum(melody);                                     // 60

// ---- harmony per half-bar: [bar, beatInBar, wheel voices, harpsichord RH, bass] ----------
// (the wheel's 12 strings + the harpsichord's right hand; the bass is the string bass)
const FM   = ['C4', 'F4', 'G#4'];
const C_E  = ['C4', 'E4', 'G4'];
const BB_D = ['D4', 'F4', 'A#4'];
const BBM  = ['C#4', 'F4', 'A#4'];
const C7   = ['C4', 'E4', 'A#4'];
const C7B9 = ['E4', 'G4', 'A#4'];
const DB   = ['C#4', 'F4', 'G#4'];

// ---- BOW WHEEL ---------------------------------------------------------------------------
const bowwheel = [];
const bow = (b, n, v, d) => bowwheel.push([r5(b), n, v, d]);
/** shivering eighths on `notes` across [from, to), velocity ramp v0 → v1, a lift on the beat */
const shiver = (notes, from, to, v0, v1) => {
  const n = Math.round((to - from) * 2);
  for (let i = 0; i < n; i++){
    const b = from + i * .5, v = ramp(v0, v1, i, n) + (i % 2 ? 0 : .05);
    for (const x of notes) bow(b, x, +Math.min(1, v).toFixed(3), .3);
  }
};
// A — the staggered entries: the low voice alone, the middle at beat 2, the top at bar 2
shiver(['C4'], BAR(1), BAR(1) + 2, .34, .38);
shiver(['C4', 'F4'], BAR(1) + 2, BAR(2), .38, .42);
shiver(C_E, BAR(2), BAR(3), .42, .48);
shiver(FM, BAR(3), BAR(4), .48, .54);
shiver(BB_D, BAR(4), BAR(5), .54, .6);
shiver(BBM, BAR(5), BAR(6), .6, .66);
shiver(C_E, BAR(6), BAR(6) + 2, .66, .7);
shiver(C7, BAR(6) + 2, BAR(7), .7, .78);                     // the B♭ arrives: C7, the wind is coming
// B — the long bow: whole-bar chords under the solo (bar 10 splits Fm · C7)
for (const [b, ch, v, d] of [[BAR(7), FM, .5, 3.6], [BAR(8), BBM, .5, 3.6], [BAR(9), C7B9, .55, 3.6],
                             [BAR(10), FM, .5, 1.7], [BAR(10) + 2, C7, .55, 1.7]])
  for (const x of ch) bow(b, x, v, d);
// C — stamping: five voices, accents on the beat
const STAMP = [[BAR(11), ['F3', 'C4', 'F4', 'G#4', 'C5']], [BAR(11) + 2, ['F3', 'C#4', 'F4', 'G#4']],
               [BAR(12), ['F3', 'C#4', 'F4', 'A#4']], [BAR(12) + 2, ['G3', 'C4', 'E4', 'G4', 'A#4']]];
for (const [at, ch] of STAMP) for (let i = 0; i < 4; i++)
  for (const x of ch) bow(at + i * .5, x, i % 2 ? .78 : .95, .3);
// D — hushed sustained chords under the teeth
for (const [b, ch] of [[BAR(13), FM], [BAR(13) + 2, DB], [BAR(14), BBM], [BAR(14) + 2, C7]])
  for (const x of ch) bow(b, x, .42, 1.75);
// E — the freeze: the C7 shiver once more, then the low strings bow through the breath
shiver(['C4', 'E4', 'G4', 'A#4'], BAR(15), BAR(15) + 3, .5, .8);
bow(BAR(15) + 3, 'C3', .62, 4.1); bow(BAR(15) + 3, 'G3', .55, 4.1);

// ---- HARPSICHORD (the Marble Grand) -----------------------------------------------------
const dulcimer = [];
/** a rolled continuo chord: left hand `lh` first, right hand spread upward */
const roll = (b, lh, rh, v, d, spread = .04) => {
  [...lh, ...rh].forEach((x, i) => dulcimer.push([r5(b + i * spread), x, v, d]));
};
// A — the continuo creeps in: the left hand alone in bar 1, chords on 1 and 3 after
roll(BAR(1) + 2, ['F3'], [], .42, 1.6);
for (const [b, lh, rh, v] of [
  [BAR(2), 'E3', C_E, .44], [BAR(2) + 2, 'E3', ['C4', 'G4', 'A#4'], .46],
  [BAR(3), 'D#3', FM, .48], [BAR(3) + 2, 'D#3', FM, .5],
  [BAR(4), 'D3', BB_D, .52], [BAR(4) + 2, 'D3', BB_D, .54],
  [BAR(5), 'C#3', BBM, .56], [BAR(5) + 2, 'C#3', BBM, .58],
  [BAR(6), 'C3', C_E, .6], [BAR(6) + 2, 'C3', C7, .62],
]) roll(b, [lh], rh, v, 1.4);
// B — punctuation on the downbeat and beat 3, forte, quick spread
for (const [b, lh, rh] of [
  [BAR(7), 'F3', ['C4', 'F4', 'G#4', 'C5']], [BAR(7) + 2, 'F3', FM],
  [BAR(8), 'C#3', ['C#4', 'F4', 'A#4', 'C#5']], [BAR(8) + 2, 'C#3', BBM],
  [BAR(9), 'C3', ['E4', 'G4', 'A#4', 'C#5']], [BAR(9) + 2, 'C3', C7B9],
  [BAR(10), 'F3', FM], [BAR(10) + 2, 'C3', C7],
]) roll(b, [lh], rh, .72, .8, .03);
// C — tutti: a chord on every beat, hammered
for (const [b, lh, rh] of [
  [BAR(11), 'F3', FM], [BAR(11) + 1, 'F3', FM], [BAR(11) + 2, 'C#3', DB], [BAR(11) + 3, 'C#3', DB],
  [BAR(12), 'C#3', BBM], [BAR(12) + 1, 'C#3', BBM], [BAR(12) + 2, 'C3', C7], [BAR(12) + 3, 'C3', ['E4', 'G4', 'A#4', 'C5']],
]) roll(b, [lh], rh, .86, .4, .02);
// D — sparse: one soft chord per half bar under the teeth
for (const [b, lh, rh] of [[BAR(13), 'F3', FM], [BAR(13) + 2, 'C#3', DB], [BAR(14), 'C#3', BBM], [BAR(14) + 2, 'C3', C7]])
  roll(b, [lh], rh, .45, 1.8);
// E — the freeze: C7 on the downbeat, then the long roll that rings through the breath
roll(BAR(15), ['C3'], ['E4', 'G4', 'A#4'], .55, 1.4);
roll(BAR(15) + 3, ['C3', 'G3'], ['E4', 'A#4', 'C5', 'E5'], .5, 5, .07);

// ---- STRING BASS (the basso) -------------------------------------------------------------
const bass = [];
const eighths = (n, from, to, v0, v1) => {
  const k = Math.round((to - from) * 2);
  for (let i = 0; i < k; i++) bass.push([r5(from + i * .5), n, +Math.min(1, ramp(v0, v1, i, k) + (i % 2 ? 0 : .06)).toFixed(3)]);
};
// A — the sinking chromatic ground, shivering
['F2', 'E2', 'D#2', 'D2', 'C#2', 'C2'].forEach((n, i) => eighths(n, BAR(1 + i), BAR(2 + i), .48 + .05 * i, .52 + .05 * i));
// B — walking quarters
for (const [bar, ns] of [[7, ['F2', 'F2', 'F2', 'F2']], [8, ['C#2', 'C#2', 'C#2', 'C#2']],
                         [9, ['C2', 'C2', 'C2', 'C2']], [10, ['F2', 'F2', 'C2', 'C2']]])
  ns.forEach((n, i) => bass.push([BAR(bar) + i, n, i ? .7 : .82]));
// C — stamping eighths
eighths('F2', BAR(11), BAR(11) + 2, .82, .82); eighths('C#2', BAR(11) + 2, BAR(12) + 2, .82, .86);
eighths('C2', BAR(12) + 2, BAR(13), .86, .9);
// D — half notes under the teeth
for (const [b, n] of [[BAR(13), 'F2'], [BAR(13) + 2, 'C#2'], [BAR(14), 'C#2'], [BAR(14) + 2, 'C2']]) bass.push([b, n, .58]);
// E — the freeze: the dominant shivers once more, the last stroke rings into the breath
eighths('C2', BAR(15), BAR(15) + 3.5, .55, .8);

for (const p of [bowwheel, dulcimer, bass]) p.sort((a, b) => a[0] - b[0]);

export default {
  label: 'Winter', sub: 'Vivaldi · shivering, frozen, in the icy snow',
  bpm: 60 * 4 / 3.8,                                   // ≈ 63.16: the loop's 3.8 s breath = 4 beats = one bar (see header)
  scale: ['C', 'C#', 'D#', 'E', 'F', 'G', 'G#', 'A#'],
  room: 'void',
  melody,
  parts: { bowwheel, dulcimer, bass },
  mix: { bowwheel: .62, dulcimer: .58, bass: .7 },
  director: {
    bowwheel: 1.8, dulcimer: 1.6, bass: 1.5,
    at: [
      [BAR(1), 'bowwheel', 8],      // the shiver: the wheel, its strings entering one by one
      [BAR(3), 'strings', 8],       // the basso sinking chromatically under it
      [BAR(5), 'dulcimer', 8],      // the harpsichord's rolled chords swelling into the wind
      [BAR(7), 'lead', 12],         // the horrid wind: the soloist's flashing runs
      [BAR(10), 'bowwheel', 4],     // … over the wheel's long bow (the same strings, sustained)
      [BAR(11), 'stage', 4],        // stamping feet: the whole band on one downbeat
      [BAR(12), 'dulcimer', 4],     // the harpsichord hammering every beat
      [BAR(13), 'lead', 8],         // chattering teeth
      [BAR(15), 'bowwheel', 8],     // the freeze, held through the breath
    ],
  },
};

export const _winter = { sum, melodyBeats: LOOP };
