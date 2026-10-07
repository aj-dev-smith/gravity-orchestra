/* THE ENTERTAINER — Scott Joplin, "A Ragtime Two Step" (1902). Public domain. Notes taken
   bar by bar from the original edition (via the Mutopia Project's public-domain engraving),
   re-scored for a little marble ragtime band. Straight eighths, as Joplin wrote it: ragtime
   is NOT swung, and the score's only tempo mark is "Not fast".

   KEY: C major (the score's F-major trio and D strain are left for another night). 2/4,
   counted in QUARTER beats: a bar = 2 beats, a sixteenth = .25.

   TEMPO / THE SEAM: bpm = 60·6/3.8 ≈ 94.7, so the loop's fixed 3.8 s breath is exactly 6
   beats = 3 bars. The loop ends the way a ragtime band ends a chorus, on Joplin's own final
   stop (bar 54 of the score: C chord, C, rest, with the left hand's "C G C"). Then the
   breath is the band's rest, and the intro comes in on the downbeat. 104 melody beats
   + 6 = 110 beats = 55 bars, ~69.7 s. The intro's descending octaves are the right call
   after a stop: they are how Joplin opens the piece. (Change the bpm and the seam drifts
   off the pulse; re-solve 6 beats = 3.8 s.)

   FORM (52 bars, the A–B–A arch of the first half of the rag):
     INTRO  bars 1–4    0–8    the famous falling figure D E C A · B G, three times, one octave
                               lower each time (the belt's pads GROW as it falls), landing on
                               G. A brass G-major stab on the accent (score: ^^). Then the
                               pickup D·D#.
     A      bars 5–20   8–40   the tune. Joplin's dynamics: p for the "E C E C" call, cresc.,
                               f for the answer in octaves (E C D E~ B D | C), dim. The 2nd
                               ending: C, then E·F·F# up into B.
     B      bars 21–36  40–72  the strain marked "Repeat 8va", forte: G A G~ over the
                               stride, scale runs, the Bb-A-Ab-G line in the bass, and the
                               D7–G7–C turnaround. Ends on C, then the pickup D·D#.
     A'     bars 37–52  72–104 the tune again, everyone in, and Joplin's final stop.

   WHO PLAYS:
     BELT (lead)     the right hand's top line, every syncopation intact. A tie is one long
                     arc, a run of sixteenths is a flat skim, so the rag's rhythm shows up
                     as arc height. Range G3 (the end of the intro's fall) to E6.
     MARBLE GRAND    the stride LEFT HAND, oom-pah: a bass note on each beat, a chord on each
       (dulcimer)    "and". The score's octave doublings are thinned to single notes so the
                     whole left hand fits on 20 strings (the grand's honest limit, PART_LIMITS):
                     a string per pitch, and the bass notes share strings with the chord tones
                     (C3 D3 D#3 E3 F3 F#3 G2 G3 G#2 G#3 A2 A3 A#2 A#3 B2 B3 C4 D4 E4 F4).
                     The intro is played in unison with the belt, as Joplin wrote it for
                     both hands. Each oom is accented over its pah, and the score's dynamics
                     scale both.
     STRING BASS     the oom an octave down: the band's tuba line, roots and fifths on the
                     beat, plus the walks (G A B → C into the A strain's 3rd phrase, F E D
                     under the B strain's G, Bb A … G). It has 8 strings (C2 D2 E2 F2 G2 A2
                     A#2 B2), so the chromatic passing notes (D#, G#) stay with the grand.
     BELLOWS HORNS   the brass section, used for punctuation. Short STABS on the
                     syncopations: the tied sixteenth (beat .75) of every forte bar, the
                     intro's accent and the final button. They hold a chord only where the
                     tune holds one (A's cadences, B's G). They also play the two lead-ins
                     (E F F# into B) and voice the B strain's turnaround D7–G7–C in sustained
                     chords. 10 horns, D4 to E5.
     MARBLE AUTOHARP the RAGTIME BANJO: chord strums on every eighth (down on the beat, up on
       (strum)       the "and") through B and A'. In A' it only chucks the upbeats during the
                     piano phrases, so the call still breathes. Steel strings, close voicings
                     around middle C.
     DRUMS           a light ragtime "trap set", played like brushes: bass drum on both beats
                     with the string bass, a soft snare on the "and"s with the grand's
                     chords, a hat whisper on the sixteenths between, and a snare accent with
                     every horn stab. A crash and a little snare roll mark the strain changes.

   MIX: the grand is the band's centre (it IS the rag), the belt is the soloist. The banjo
   is a texture under the tune, and the horns cut through on their own (short, bright stabs),
   so they're trimmed below the grand. Velocity carries Joplin's dynamics (p ≈ .55 → f ≈ .9)
   and the oom/pah accent.

   iOS NOTE (§5): the sample path ignores `dur`, so the grand's and horns' held notes ring
   their whole renders there. Every hold is a chord tone of the bar it's in, and the strings
   are damped by the next chord's attack anyway.

   DIRECTOR: nothing is scripted. A scripted key is exempt from its share cap, and in a band
   where everyone plays on almost every downbeat, scripting the wide (or the grand) let that
   one shot take 35–40% of the loop. Weights do the job instead. The banjo plays dense, soft
   chords, so it's weighted up hardest; the horns' stabs are few, so they're weighted up
   too; the trap set's constant ticks are damped. The solved edit (director-audit) runs:
   belt (the falling intro pads) → horns (the G stab) → grand (A's stride) → horns (the
   octave stabs) → string bass (the Bb-A-Ab-G walk into B) → banjo (B) → belt → horns (the
   turnaround) → wide (A', everyone) → bass → banjo → drums (the stop). Shares are about
   horns 23 · strum 20 · grand 14 · stage 14 · belt 13 · bass 13 · drums 5 %. The bass shot
   is re-framed from its wing side (`shots.bass`: the plugin key, though its cut key is `strings`), because its default eye sat between the
   belt's posts in the studio. */

// ---- note helpers (sharps only) --------------------------------------------------
const r5 = x => +x.toFixed(5);
/** 'D6/.25 E6/.25 …' → [['D6', .25], …]: a chained belt line */
const L = s => s.trim().split(/\s+/).map(t => { const [n, d] = t.split('/'); return [n, +d]; });
const sum = line => line.reduce((s, [, d]) => s + d, 0);
const BAR = k => 2 * (k - 1);                         // beat at which loop bar k (1-based) starts

/* JOPLIN'S DYNAMICS, per loop bar → a velocity scale. p .55, f .9; the hairpins (<, >)
   ramp across their bar. The score's dynamics line, transcribed. */
const P = .55, F = .9;
const DYN = {};
const mark = (bars, a, b = a) => bars.forEach(k => { DYN[k] = [a, b]; });
mark([1, 2, 3], F); mark([4], F, P);
for (const o of [4, 36]){                             // A and A': p < f > · p < f > · p < f …
  mark([o + 1, o + 5, o + 9], P); mark([o + 2, o + 6, o + 10], P, F);
  mark([o + 3, o + 7, o + 11, o + 12, o + 13, o + 14, o + 15], F);
  mark([o + 4, o + 8], F, P);
}
mark([20], F, P); mark([52], F);                      // A ends dim. into B; A' ends forte, the stop
mark([21, 22, 23, 24, 25, 26, 27, 28], F);            // B: eight bars forte …
mark([29, 30, 31], P); mark([32], P, .5); mark([33], P); mark([34], P, F); mark([35], F); mark([36], F, P);
const dyn = beat => {
  const k = Math.floor(beat / 2) + 1, [a, b] = DYN[k] ?? [F, F];
  return a + (b - a) * ((beat - BAR(k)) / 2);
};
const vel = (beat, x) => r5(Math.min(1, Math.max(.05, x * dyn(beat))));

// ---- THE TUNE (the belt) — the right hand's top line ----------------------------
const INTRO = L(`
  D6/.25 E6/.25 C6/.25 A5/.5 B5/.25 G5/.5
  D5/.25 E5/.25 C5/.25 A4/.5 B4/.25 G4/.5
  D4/.25 E4/.25 C4/.25 A3/.5 B3/.25 A3/.25 G#3/.25
  G3/1 G5/.5 D4/.25 D#4/.25`);
// A's first fifteen bars, shared by A and A' (only the last bar differs)
const A_BODY = L(`
  E4/.25 C5/.5 E4/.25 C5/.5 E4/.25 C5/1.5
  C6/.25 D6/.25 D#6/.25
  E6/.25 C6/.25 D6/.25 E6/.5 B5/.25 D6/.5
  C6/1.5 D4/.25 D#4/.25
  E4/.25 C5/.5 E4/.25 C5/.5 E4/.25 C5/1.75
  A5/.25 G5/.25
  F#5/.25 A5/.25 C6/.25 E6/.5 D6/.25 C6/.25 A5/.25
  D6/1.5 D4/.25 D#4/.25
  E4/.25 C5/.5 E4/.25 C5/.5 E4/.25 C5/1.5
  C6/.25 D6/.25 D#6/.25
  E6/.25 C6/.25 D6/.25 E6/.5 B5/.25 D6/.5
  C6/1.5 C6/.25 D6/.25
  E6/.25 C6/.25 D6/.25 E6/.5 C6/.25 D6/.25 C6/.25
  E6/.25 C6/.25 D6/.25 E6/.5 C6/.25 D6/.25 C6/.25
  E6/.25 C6/.25 D6/.25 E6/.5 B5/.25 D6/.5`);
const A_TO_B = L('C6/1.25 E5/.25 F5/.25 F#5/.25');           // 2nd ending: C, up into B
const B = L(`
  G5/.5 A5/.25 G5/.5 E5/.25 F5/.25 F#5/.25
  G5/.5 A5/.25 G5/.5 E5/.25 C5/.25 G4/.25
  A4/.25 B4/.25 C5/.25 D5/.25 E5/.25 D5/.25 C5/.25 D5/.25
  G4/.25 E5/.25 F5/.25 G5/.25 A5/.25 G5/.25 E5/.25 F5/.25
  G5/.5 A5/.25 G5/.5 E5/.25 F5/.25 F#5/.25
  G5/.5 A5/.25 G5/.5 G5/.25 A5/.25 A#5/.25
  B5/.25 B5/.5 B5/.5 A5/.25 F#5/.25 D5/.25
  G5/1.25 E5/.25 F5/.25 F#5/.25
  G5/.5 A5/.25 G5/.5 E5/.25 F5/.25 F#5/.25
  G5/.5 A5/.25 G5/.5 E5/.25 C5/.25 G4/.25
  A4/.25 B4/.25 C5/.25 D5/.25 E5/.25 D5/.25 C5/.25 D5/.25
  C5/1.25 G4/.25 F#4/.25 G4/.25
  C5/.5 A4/.25 C5/.5 A4/.25 C5/.25 A4/.25
  G4/.25 C5/.25 E5/.25 G5/.5 E5/.25 C5/.25 G4/.25
  A4/.5 C5/.5 E5/.25 D5/.5 C5/1.75
  D4/.25 D#4/.25`);
const STOP = L('C6/1 C6/1');                                   // the final stop: C, C (the breath follows)

const melody = [...INTRO, ...A_BODY, ...A_TO_B, ...B, ...A_BODY, ...STOP];

// ---- THE STRIDE LEFT HAND (the Marble Grand) -------------------------------------
/* One bar = four eighth-note slots: oom · pah · oom · pah. A slot is a note, a chord
   (notes joined by '.') or '-' (rest). Slots 0/2 are the "oom" (accented), 1/3 the "pah". */
const LH_A = [
  'C3 C4.G3.E3 G2 C4.A#3.G3',        // 5   C   C7
  'F3 C4.A3 E3 C4.G3',               // 6   F   C/E
  'G2 C4.G3.E3 G2 B3.G3.F3',         // 7   C/G G7
  'C3 C4.G3.E3 C4.G3.E3 B3.G3',      // 8   C
  'C3 C4.G3.E3 G2 C4.A#3.G3',        // 9
  'F3 C4.A3 E3 D#3',                 // 10  F   C/E → D# (passing)
  'D3 C4.A3.F#3.D3 D3 C4.A3.F#3',    // 11  D7
  'B3.G3 G2 A2 B2',                  // 12  G — the walk up: G A B → C
  'C3 C4.G3.E3 G2 C4.A#3.G3',        // 13
  'F3 C4.A3 E3 C4.G3',               // 14
  'G2 C4.G3.E3 G2 B3.G3.F3',         // 15
  'C3 C4.G3.E3 E4.C4.G3 -',          // 16  C (a stop for the C6 D6 pickup)
  'C3 E4.C4.G3 A#2 E4.C4.G3',        // 17  C   C7 (Bb in the bass)
  'A2 F4.C4.A3 G#2 F4.C4.G#3',       // 18  F   Fm (A, Ab — the chromatic descent)
  'G2 E4.C4.G3 G2 B3.G3',            // 19  C/G G7
];
const LH_A_END = 'C4.G3.C3 G2 C3 -';  // 20 / 52: the stop, "C G C"
const LH_B = [
  'C3 E4.C4.G3 G2 E4.C4.G3',         // 21  C
  'C3 E4.C4.G3 G2 E4.C4.G3',         // 22
  'F3 F4.C4.A3 F3 F4.C4.G#3',        // 23  F   Fm
  'E3 E4.C4.G3 G2 E4.C4.G3',         // 24  C/E
  'C3 E4.C4.G3 G2 E4.C4.G3',         // 25
  'C3 E4.C4.G3 E3 D#3',              // 26  C → D# (passing)
  'D3 D4.B3.G3 D3 D4.C4.A3',         // 27  G/D D7
  'D4.B3.G3 F3 E3 D3',               // 28  G — walking down under it
  'C3 E4.C4.G3 G2 E4.C4.G3',         // 29
  'C3 E4.C4.G3 G2 E4.C4.G3',         // 30
  'F3 F4.C4.A3 F3 F4.C4.G#3',        // 31
  'E3 E4.C4.G3 C3 E4.C4.A#3',        // 32  C   C7
  'F4.C4.A3.F3 F4.C4.A3.F3 C4.A3.F#3 C4.A3.F#3',   // 33  F   F#dim (the score's D#4 left off: 20 strings)
  'E4.C4.G3 E4.C4.G3 E4.C4.G3 E4.C4.G3',           // 34  C/G
  'C4.D3 A3.D3 B3.G3 B3.G3',         // 35  D7  G7 — the turnaround
  'C4.C3 G2 C3 -',                   // 36  C (the pickup D·D# is the belt's, alone)
];
/** rows of slot strings from bar `k0` → grand events [beat, note, vel, durBeats] */
const stride = (rows, k0) => rows.flatMap((row, r) => row.split(/\s+/).flatMap((slot, s) => {
  if (slot === '-') return [];
  const b = BAR(k0 + r) + .5 * s, oom = s % 2 === 0;
  return slot.split('.').map(n => [b, n, vel(b, oom ? .82 : .6), .45]);
}));
const grandIntro = [
  // bar 2: the left hand joins the belt's fall an octave down (the belt is at D5 here)
  ...[[2, 'D4'], [2.25, 'E4'], [2.5, 'C4'], [2.75, 'A3'], [3.25, 'B3'], [3.5, 'G3']].map(([b, n]) => [b, n, vel(b, .8), .3]),
  // bar 3: in octaves, falling into the bass (the belt plays the top: D4 … G#3)
  ...[[4, 'D3'], [4.25, 'E3'], [4.5, 'C3']].map(([b, n]) => [b, n, vel(b, .8), .3]),
  ...[[4.75, 'A3'], [4.75, 'A2'], [5.25, 'B3'], [5.25, 'B2'], [5.5, 'A3'], [5.5, 'A2'], [5.75, 'G#3'], [5.75, 'G#2']].map(([b, n]) => [b, n, vel(b, .78), .3]),
  // bar 4: the landing G, the accented G, and the G chord under the pickup
  [6, 'G3', vel(6, .85), .9], [6, 'G2', vel(6, .85), .9], [7, 'G2', vel(7, 1), .45], [7.5, 'B3', vel(7.5, .55), .45], [7.5, 'G3', vel(7.5, .55), .45],
];
const dulcimer = [
  ...grandIntro,
  ...stride(LH_A, 5), ...stride([LH_A_END], 20),
  ...stride(LH_B, 21),
  ...stride(LH_A, 37), ...stride([LH_A_END], 52),
];

// ---- THE STRING BASS — the oom an octave down, and the walks --------------------
/* Same four-slot bar as the stride; one note or '-'. 8 strings: C2 D2 E2 F2 G2 A2 A#2 B2. */
const BS_A = [
  'C2 - G2 -', 'F2 - E2 -', 'G2 - G2 -', 'C2 - - -',
  'C2 - G2 -', 'F2 - E2 -', 'D2 - D2 -', '- G2 A2 B2',      // the walk up into the 3rd phrase
  'C2 - G2 -', 'F2 - E2 -', 'G2 - G2 -', 'C2 - - -',
  'C2 - A#2 -', 'A2 - - -', 'G2 - G2 -',                    // C, Bb, A, (the grand's Ab), G
];
const BS_A_END = 'C2 G2 C2 -';
const BS_B = [
  'C2 - G2 -', 'C2 - G2 -', 'F2 - C2 -', 'E2 - G2 -',
  'C2 - G2 -', 'C2 - E2 -', 'D2 - D2 -', '- F2 E2 D2',      // walking down under the G
  'C2 - G2 -', 'C2 - G2 -', 'F2 - C2 -', 'E2 - C2 -',
  'F2 - A2 -', 'G2 - G2 -', 'D2 - G2 -', 'C2 G2 C2 -',
];
const walk = (rows, k0) => rows.flatMap((row, r) => row.split(/\s+/).flatMap((n, s) => {
  if (n === '-') return [];
  const b = BAR(k0 + r) + .5 * s;
  return [[b, n, vel(b, s === 0 ? .95 : .82)]];
}));
const bass = [
  [4.75, 'A2', vel(4.75, .7)], [5.25, 'B2', vel(5.25, .7)], [5.5, 'A2', vel(5.5, .7)],   // intro: down with the piano …
  [6, 'G2', vel(6, .9)], [7, 'G2', vel(7, 1)],                                         // … onto the G, and the accent
  ...walk(BS_A, 5), ...walk([BS_A_END], 20),
  ...walk(BS_B, 21),
  ...walk(BS_A, 37), ...walk([BS_A_END], 52),
];

// ---- THE HORNS — stabs on the syncopations, holds where the tune holds ----------
const CH = {                          // the section's voicings (10 horns: D4 … E5)
  C: ['E4', 'G4', 'C5'], Chi: ['G4', 'C5', 'E5'], G7: ['F4', 'B4', 'D5'], G: ['G4', 'B4', 'D5'],
  D7: ['F#4', 'A4', 'C5'], F: ['F4', 'A4', 'C5'], Gintro: ['D4', 'G4', 'B4', 'D5'],
};
/** a chord at beat b: a STAB (no duration) or a HOLD (durBeats > .5) */
const hit = (b, ch, x, hold) => CH[ch].map(n => hold ? [b, n, vel(b, x), hold] : [b, n, vel(b, x)]);
/** A's brass, for a strain starting at loop bar k0 (A or A') */
const hornsA = k0 => {
  const b = k => BAR(k0 + k - 1);     // strain-relative bar → beat
  return [
    ...hit(b(3) + .75, 'C', .85), ...hit(b(3) + 1.5, 'G7', .75), ...hit(b(4), 'C', .6, 1.25),
    ...hit(b(7) + .75, 'D7', .85), ...hit(b(8), 'G7', .6, 1.25),
    ...hit(b(11) + .75, 'C', .85), ...hit(b(11) + 1.5, 'G7', .75), ...hit(b(12), 'C', .6, 1.25),
    ...hit(b(13) + .75, 'C', .8), ...hit(b(14) + .75, 'F', .8),
    ...hit(b(15) + .75, 'C', .9), ...hit(b(15) + 1.5, 'G7', .8),
  ];
};
const horns = [
  ...hit(7, 'Gintro', 1),                                            // the intro's accent (^^)
  ...hornsA(5),
  ...hit(BAR(20), 'C', .85),                                         // A's 2nd ending …
  [BAR(20) + 1.25, 'E4', .7], [BAR(20) + 1.5, 'F4', .78], [BAR(20) + 1.75, 'F#4', .86],   // … and the brass lead-in to B
  // B — forte: the tied G (beat .75) answered by the section, the lead-ins doubled
  ...hit(BAR(21) + .75, 'C', .9), [BAR(21) + 1.25, 'E4', .6], [BAR(21) + 1.5, 'F4', .65], [BAR(21) + 1.75, 'F#4', .7],
  ...hit(BAR(22) + .75, 'Chi', .85),
  ...hit(BAR(25) + .75, 'C', .9), [BAR(25) + 1.25, 'E4', .6], [BAR(25) + 1.5, 'F4', .65], [BAR(25) + 1.75, 'F#4', .7],
  ...hit(BAR(26) + .75, 'Chi', .85),
  ...hit(BAR(27), 'G', .8), ...hit(BAR(27) + .75, 'D7', .9), ...hit(BAR(28), 'G', .6, 1.25),
  ...hit(BAR(33) + .75, 'F', .75), ...hit(BAR(34) + .75, 'Chi', .85),
  // the turnaround: D7 · G7 · C, sustained, crescendo into A'
  ...hit(BAR(35), 'D7', .75, .9), ...hit(BAR(35) + 1, 'G7', .85, .7), ...hit(BAR(35) + 1.75, 'C', .9, 1.25),
  ...hornsA(37),
  ...hit(BAR(52), 'C', .9), ...hit(BAR(52) + 1, 'Chi', 1),          // the final button
];

// ---- THE AUTOHARP — the ragtime banjo ------------------------------------------
const VO = {
  C: ['C4', 'E4', 'G4', 'C5'], C7: ['C4', 'E4', 'G4', 'A#4'], F: ['C4', 'F4', 'A4', 'C5'], Fm: ['C4', 'F4', 'G#4', 'C5'],
  G: ['B3', 'D4', 'G4', 'B4'], G7: ['B3', 'D4', 'F4', 'G4'], D7: ['D4', 'F#4', 'A4', 'C5'], Fdim: ['C4', 'D#4', 'F#4', 'A4'],
};
/* the harmony, one chord per half bar (the stride's chords, named) */
const HA = ['C C7', 'F C', 'C G7', 'C C', 'C C7', 'F C', 'D7 D7', 'G G7', 'C C7', 'F C', 'C G7', 'C C', 'C C7', 'F Fm', 'C G7'];
const HB = ['C C', 'C C', 'F Fm', 'C C', 'C C', 'C C', 'G D7', 'G G7', 'C C', 'C C', 'F Fm', 'C C7', 'F Fdim', 'C C', 'D7 G7'];
/** strums on every eighth (down on the beat, up on the and); `upOnly` bars only chuck the ands */
const banjo = (chart, k0, upOnly = () => false) => chart.flatMap((bar, r) => {
  const k = k0 + r, [h1, h2] = bar.split(' ');
  return [0, 1, 2, 3].flatMap(s => {
    const up = s % 2 === 1;
    if (upOnly(r + 1) && !up) return [];
    const b = BAR(k) + .5 * s, ch = VO[s < 2 ? h1 : h2];
    return ch.map(n => [b, n, vel(b, up ? .42 : .58)]);
  });
});
const pianoBars = r => [1, 2, 5, 6, 9, 10].includes(r);              // A's quiet "E C E C" calls
const strum = [
  ...banjo(HB, 21),
  ...VO.C.flatMap(n => [[BAR(36), n, vel(BAR(36), .6)], [BAR(36) + .5, n, vel(BAR(36) + .5, .45)], [BAR(36) + 1, n, vel(BAR(36) + 1, .5)]]),
  ...banjo(HA, 37, pianoBars),
  ...VO.C.flatMap(n => [[BAR(52), n, .75], [BAR(52) + 1, n, .85]]),   // the stop
];

// ---- DRUMS — brushes-ish: bass drum with the oom, snare whisper with the pah ------
const kick = [], snare = [], hat = [], crash = [];
for (let k = 5; k <= 52; k++){
  const b0 = BAR(k), stop = k === 20 || k === 36 || k === 52;
  kick.push([b0, vel(b0, .42)]);
  kick.push([b0 + 1, vel(b0 + 1, .3)]);
  snare.push([b0 + .5, vel(b0 + .5, .22)]);
  if (!stop){
    snare.push([b0 + 1.5, vel(b0 + 1.5, .24)]);
    for (const o of [.25, .75, 1.25, 1.75]) hat.push([b0 + o, vel(b0 + o, o === .75 ? .3 : .2)]);
  }
}
// a snare accent with every horn STAB (they're the syncopations); the stabs land on .75 / 1.5
const stabCount = new Map();
for (const e of horns) if (e.length === 3) stabCount.set(e[0], (stabCount.get(e[0]) || 0) + 1);
const stabBeats = [...stabCount].filter(([b, n]) => n >= 3 && b % 1 !== 0).map(([b]) => b);   // chord stabs off the beat
for (const b of stabBeats){
  const i = snare.findIndex(([x]) => Math.abs(x - b) < 1e-9);
  if (i >= 0) snare[i] = [b, vel(b, .45)]; else snare.push([b, vel(b, .42)]);
}
// the intro's accent, the strain changes and the final stop
kick.push([6, .3], [7, .55]); snare.push([7, .5]); crash.push([7, .4]);
for (const [b, v] of [[BAR(20) + 1, .3], [BAR(20) + 1.25, .34], [BAR(20) + 1.5, .38], [BAR(20) + 1.75, .44]]) snare.push([b, v]);   // a roll into B
crash.push([BAR(21), .55], [BAR(37), .45], [BAR(52) + 1, .6]);
snare.push([BAR(52) + 1, .6]);
const lane = xs => [...new Map(xs.map(([b, v]) => [r5(b), [r5(b), v]])).values()].sort((a, b) => a[0] - b[0]);

export default {
  label: 'The Entertainer', sub: 'Joplin · a ragtime two-step for the marble band',
  bpm: 60 * 6 / 3.8,                                  // ≈ 94.7: the 3.8 s breath = 6 beats = 3 bars of 2/4
  scale: ['C', 'D', 'D#', 'E', 'F', 'F#', 'G', 'A', 'A#', 'B'],
  room: 'studio',
  melody,
  parts: { dulcimer, horns, strum, bass },
  mix: { dulcimer: .78, horns: .6, strum: .42, bass: .72 },
  director: {
    dulcimer: 1.2, horns: 2, strum: 3, bass: 1, drums: .5,
    shots: { bass: { x: -5, up: 7.5, dist: 15 } },      // (keyed by the PLUGIN key) the bass bed from its wing side
  },
  drums: { kick: lane(kick), snare: lane(snare), hat: lane(hat), crash: lane(crash) },
};

export const _entertainer = { sum, melodyBeats: sum(melody), dyn };
