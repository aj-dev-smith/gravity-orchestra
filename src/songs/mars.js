/* MARS, THE BRINGER OF WAR — Gustav Holst, The Planets, Op. 32 (1914–16). Public domain in
   the US (published 1921). Re-scored for tonight's machines, in the VOID — the starfield and
   its ringed planet, the only room that is literally the piece's subject. The skeleton is
   Holst's: the 5/4 col-legno ostinato on G (exact rhythm), the first theme rising out of the
   bass (a FIFTH up, then a SEMITONE down: G·D·D♭), the triads sliding chromatically over the
   G pedal, the call-and-response fanfare (tenor tuba, answered by the trumpets), the broad
   5/2 middle, the recapitulation fff, and the coda's crushing chord — Holst's own voicing,
   A♭·D♭·G over a C bass — its frantic scramble, the stabs, the silence, the last C. Pitches
   of the fanfare and the 5/2 theme are transcribed IN GESTURE (the shapes, intervals and
   harmony of the score, compressed to fit a 64 s loop), not bar-for-bar.

   KEY / METER: a G pedal (the dominant of C — the war never resolves until the very end),
   coloured Phrygian/Locrian: A♭, B♭, D♭, E♭. 5/4 throughout; §5 is two bars of 5/2 (= four
   5/4 bars of beats). song.barBeats = 5 tells the director that bar lines fall every 5 beats
   (its cut grid prefers bar lines; it assumed 4).

   THE OSTINATO (the spine — every 5/4 bar outside §5):  1-&-a  2  3  4-&  5
       onsets 0 ⅓ ⅔ | 1 | 2 | 3 3½ | 4      (triplet eighths, quarter, quarter, two eighths, quarter)

   TEMPO / THE SEAM: bpm = 60·9/3.8 ≈ 142.1 (a heavy, grinding Allegro), so the loop's fixed
   3.8 s breath is EXACTLY 9 beats. Melody 151 beats + 9 = 160 = 32 bars of 5/4 (~67.6 s): the
   last C lands on bar 31's downbeat, rings through a bar and four beats of silence (the
   score's own grand pause before the end), and the pp col legno G picks up on the downbeat as
   if the war were starting again — the dominant growing out of the tonic's dying ring.
   Why 142, not Holst's faster pulse: the BOW WHEEL's same-string re-bow floor is .40 s; at
   142.1 a beat is .422 s, so its low G can strike on EVERY beat (see WHO PLAYS).

   FORM (beats · bars of 5):
     §1   0–10   OSTINATO alone, pp: col legno on the bow wheel, the timpani (kick) and the
                 harps (autoharp, harp timbre) on G. The lead marble paces the bar.
     §2  10–40   THE FIRST THEME, rising out of the bass on the LIGHT ORGAN (low pipes in
                 octaves, the bassoons/horns): G · D · D♭ (the fifth, the semitone), then a
                 third higher B♭ · F · E — the belt doubles it two octaves up. The RIFF FORGE
                 creeps in under the ostinato, palm-muted (it IS col legno: wood on string).
     §3  40–60   THE BUILD: parallel triads climb chromatically over the G pedal — D♭ · D · E♭
                 — the bellows horns stabbing the ostinato's beats, the riff tearing open
                 power chords on each downbeat; bar 12 the whole room hammers a unison G.
     §4  60–90   THE FANFARE: the tenor tuba's call on the low horns (G · triplet up · D ·
                 E♭ falling home), the trumpets' answer a fifth higher (high horns + the belt),
                 the side drum's triplets; then together, up to the A♭ — the Phrygian
                 semitone over G — and back down.
     §5  90–110  THE BROAD 5/2: everything doubles in length. The bow wheel stops striking
                 and BOWS — long sustained chords (Gm · E♭ · Cm · A♭ · Gm · Cm · Gm), the
                 organ's CHOIR hums under them, the harps arpeggiate, the riff rings clean;
                 the belt sings the fanfare broadened in the tallest arcs of the loop.
     §6 110–130  RECAPITULATION fff: the ostinato returns at full cry (riff open on every
                 downbeat on the organ's root, the fifth G–D in the ostinato's "&" once the
                 organ leaves C minor), call + answer fff on
                 the horn rank, the belt an octave over it, full organ under them.
     §7 130–151  CODA: THE CHORD — A♭·D♭·G over C, hammered in the ostinato rhythm by every
                 machine (toms on its C and A♭); the frantic chromatic scramble; three D♭
                 stabs (the Neapolitan of C); silence; the last C, everyone, fff.

   WHO PLAYS (each machine's honest limits, checked):
     bow wheel   col legno strokes .2 beat (.084 s, ≥ HOLD_MIN .08). The ostinato is shared
                 across octave strings so no string re-bows faster than its .40 s floor:
                 G2 on every beat (0 1 2 3 4: the pulse, .422 s apart), G3 the triplet's ⅓ +
                 beat 3's "&", G4 the ⅔ + the "&" (the climax ostinato swaps that "&" to D3/D4:
                 the G–D fifth — only in the recap; §3's D♭/E♭ triads keep the bare G). §5 = long bowed chords. 12 strings: C3 D3 D#3 G2 G#2 G3 G4
                 A#3 C4 D4 D#4 G#3.
     riff        palm-muted chugs (':m') double the ostinato's full rhythm (.14 s re-strikes,
                 ≥ the forge's .13 s comfort); open power chords on the downbeats; clean (':c')
                 ringing fifths in §5; the coda chord hammered open; the final C rings.
     horns       12 pitches exactly (C3 G3 G#3 A#3 C4 C#4 D4 D#4 F4 G4 A4 A#4): the call
                 (G3–D#4) and answer (D4–A#4) share one rank; the coda chord is C3·G#3·C#4·G4
                 (Holst's voicing); stabs ≤ .5 beat, held notes ≤ 2.6 s; no pitch re-struck
                 closer than .21 s (MIN_GAP .18).
     organ       the first theme (G2–F3 in octaves), the sliding triads + the G pedal, the
                 choir under §5, full organ in §6–§7, the final C held 8.5 beats (3.6 s —
                 released before the seam).
     strum       harp timbre ('|h'): the ostinato's beats 1 2 3 4 5 in §1–§2 (strums ≥ .42 s
                 apart; the triplet and the "&" are left to the wheel), arpeggiated chords in §5.
     lead (belt) G4–C#6: the pacing G, the first theme 8va, the triads' thirds in the
                 ostinato rhythm (flat .14 s skims for the triplets), the trumpet's answer,
                 the broad theme (4-beat arcs), the scramble, the stabs, the C.
   Drums: kick = the timpani on G (thinned in §1–§2 — the pp — full rhythm from §3), snare = side drum (§4/§6
   triplets), crash on the big downbeats, toms only in the coda — tomLow ≈ C3 (131 Hz) and
   tomHigh ≈ A♭3 (207 Hz) are the chord's own C and A♭, a tom cascade under the scramble.
   (The kit has no G tom, so no tom plays under the G pedal.)

   CLASHES THAT ARE MEANT: every triad over the G pedal (D♭/G is a tritone — that's Mars), the
   G–A♭ semitone in the coda chord and in §4's peak, the scramble's chromatic run over it.

   MIX: the ostinato machines (wheel, riff, kick) sit low under the themes and step up for
   the recap; the organ is under the brass; velocity stays pure dynamics (pp → fff).
   BELT DYNAMICS (the melody's 3rd element, dynamics.js): the pacing G is pp (.2 — it used to
   be the loudest thing in the pp bars), the theme p → mp, the triads crescendo into the
   unison G at full, the belt steps back under the tuba's call, the broad 5/2 sung at .7, and
   the recap + coda are fff (no 3rd element = full). The kick's pp now really is pp too —
   hitDrum's velocity law no longer floors at −9 dB.
   iOS (§5): the sample path ignores `dur` — the organ/horn/bow-wheel renders ring their full
   length there; every held chord here resolves into a chord that contains it or follows a
   rest, so the ring-on is consonant with what comes next (§5's pads are the risk: their
   chords share G or C with the next).

   DIRECTOR: song.director.at scripts each machine's moment — the wheel's col legno
   opening, the organ's theme, the riff's power chords, the wheel's unison G, the tuba call
   (horns), the answer (belt), the wheel BOWING in §5, the harps, the recap on the forge, the
   coda chord on the organ, the scramble on the belt, the stabs + the last C on the forge.
   The wide opens the loop (the reveal). director.shots.horns looks down the brass rank from
   the stage side: the solved room parks the horns behind the bow wheel, and the default
   front shot looked straight through the wheel.
   ============================================================ */

// ---- helpers ---------------------------------------------------------------------
const PC = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const num = n => { const m = /^([A-G]#?)(\d)$/.exec(n); return PC.indexOf(m[1]) + 12 * (+m[2] + 1); };
const name = k => PC[k % 12] + (Math.floor(k / 12) - 1);
const tr = (line, s) => line.map(([n, b]) => [name(num(n) + s), b]);
const r5 = x => +x.toFixed(5);
const v3 = x => +Math.min(1, x).toFixed(3);
const sum = line => line.reduce((s, [, d]) => s + d, 0);
/** a chained line → pinned events from `at` (beats); v = number or fn(i); dur = fn(d) */
const pin = (line, at, v = .8, dur) => {
  let b = at; const out = [];
  for (const [n, d] of line){
    const e = [r5(b), n, typeof v === 'function' ? v3(v(out.length)) : v];
    if (dur) e.push(r5(dur(d)));
    out.push(e); b += d;
  }
  return out;
};
const T = 1 / 3;
const OST = [0, T, 2 * T, 1, 2, 3, 3.5, 4];          // the ostinato's onsets in a bar
const ACC = [1, .62, .72, .9, .9, .8, .7, .9];        // its natural accents (the triplet lifts into 2)
const bar = n => 5 * (n - 1);                         // beat at which 5/4 bar n (1-based) starts
const sortEv = es => es.sort((a, b) => a[0] - b[0] || String(a[1]).localeCompare(String(b[1])));
const sortHits = hs => hs.sort((a, b) => (Array.isArray(a) ? a[0] : a) - (Array.isArray(b) ? b[0] : b));

// ---- THE LEAD (belt) -------------------------------------------------------------
const ostOn = note => OST.map((o, i) => [note, i < 7 ? OST[i + 1] - o : 1]);   // one bar, chained
const CALL   = [['G4', 3], ['G4', T], ['A#4', T], ['C5', T], ['D5', 1], ['D#5', 2], ['D5', 1], ['C5', 1], ['A#4', 1]];
const ANSWER = [['D5', 3], ['D5', T], ['F5', T], ['G5', T], ['A5', 1], ['A#5', 2], ['A5', 1], ['G5', 1], ['F5', 1]];
const TUTTI  = [['G4', T], ['A#4', T], ['C5', T], ['D5', 1], ['D#5', 1], ['F5', 1], ['G5', 1], ['G#5', 3], ['G5', 2]];
const BROAD  = [['G4', 4], ['A#4', 2], ['C5', 4], ['D#5', 4], ['D5', 2], ['C5', 2], ['A#4', 2]];
const SCRAMBLE = ['C5','C#5','D5','D#5','E5','F5','F#5','G5','G#5','A5'].map(n => [n, .5]);

/** belt DYNAMICS: [note, beats] → [note, beats, vel] — v a number, or fn(i, n) for a hairpin
    (velocity is audio + strike juice only; the arcs are the beats', untouched) */
const dyn = (line, v) => line.map(([n, d], i) => [n, d, v3(typeof v === 'function' ? v(i, line.length) : v)]);
const hair = (v0, v1) => (i, n) => v0 + (v1 - v0) * i / Math.max(1, n - 1);
const melody = [
  ...dyn([['G4', 5], ['G4', 5]], .2),                               // §1    0  pp: the marble paces the bar
  ...dyn([['G4', 5], ['D5', 3], ['C#5', 7], ['A#4', 5], ['F5', 3], ['E5', 7]], hair(.3, .5)),   // §2   10  the first theme, 8va — p, growing
  ...dyn([...ostOn('F5'), ...ostOn('F#5'), ...ostOn('G5')], hair(.55, .9)), ['G5', 5],         // §3   40  the triads' thirds, cresc. · the unison G (full)
  ...dyn([['G4', 5], ['G4', 5]], .5), ...dyn(ANSWER, .85), ...TUTTI,  // §4   60  (the tuba calls: the belt steps back) · the answer · together
  ...dyn(BROAD, .7),                                                // §5   90  the broad 5/2 — sung, not shouted
  ...CALL, ...ANSWER,                                               // §6  110  recapitulation fff
  ...ostOn('G5'), ...ostOn('G#5'), ...SCRAMBLE,                     // §7  130  the chord, hammered · the scramble
  ['C#6', 1], ['C#6', 1], ['C#6', 3], ['C6', 1],                    //     145  three stabs · silence · the C (150)
];

// ---- harmony ---------------------------------------------------------------------
// §3's sliding triads over the G pedal (organ voicing; horns take the inner notes)
const SLIDE = [
  { organ: ['G2', 'C#4', 'F4', 'G#4'], horns: ['G#3', 'C#4', 'F4'], riff: ['C#3', 'G#3', 'C#4'] },   // D♭/G
  { organ: ['G2', 'D4', 'F#4', 'A4'],  horns: ['D4', 'A4'],         riff: ['D3', 'A3', 'D4'] },      // D/G
  { organ: ['G2', 'D#4', 'G4', 'A#4'], horns: ['D#4', 'G4', 'A#4'], riff: ['D#3', 'A#3', 'D#4'] },   // E♭/G
];
// §5's broad chords [beat, len, bowwheel strings, organ choir, harp]
const BROAD_CH = [
  [90, 4,  ['G2', 'D3', 'A#3'],  ['G3', 'A#3', 'D4'],  ['G2', 'D3', 'G3', 'A#3']],    // Gm
  [94, 2,  ['G2', 'D#3', 'A#3'], ['G3', 'A#3', 'D#4'], ['D#3', 'G3', 'A#3']],         // E♭
  [96, 4,  ['C3', 'G3', 'D#4'],  ['G3', 'C4', 'D#4'],  ['C3', 'G3', 'C4', 'D#4']],    // Cm
  [100, 4, ['G#2', 'D#3', 'C4'], ['G#3', 'C4', 'D#4'], ['G#2', 'D#3', 'G#3', 'C4']],  // A♭
  [104, 2, ['G2', 'D3', 'A#3'],  ['G3', 'A#3', 'D4'],  ['G2', 'D3', 'A#3']],          // Gm/D
  [106, 2, ['C3', 'G3', 'D#4'],  ['G3', 'C4', 'D#4'],  ['C3', 'G3', 'D#4']],          // Cm
  [108, 2, ['G2', 'D3', 'A#3'],  ['G3', 'A#3', 'D4'],  ['G2', 'D3', 'G3']],           // Gm → the recap
];
const CHORD = ['C3', 'G#3', 'C#4', 'G4'];             // THE CHORD: A♭·D♭·G over C (Holst's voicing)

// ---- BOW WHEEL — col legno (short strokes), bowed in §5 ----------------------------
const CL = .2;                                        // a col legno stroke: .2 beat = .084 s
/** one ostinato bar on the wheel's octave strings: lo = pulse string (every beat),
    mid = triplet ⅓ + the "&", hi = triplet ⅔ + the "&" */
function wheelBar(n, v, { lo = 'G2', mid = 'G3', hi = 'G4', and = null } = {}){
  const b = bar(n), out = [];
  for (const o of [0, 1, 2, 3, 4]) out.push([r5(b + o), lo, v3(v * (o === 0 ? 1 : o === 2 ? .92 : .85)), CL]);
  out.push([r5(b + T), mid, v3(v * .72), CL], [r5(b + 2 * T), hi, v3(v * .78), CL]);
  const [a1, a2] = and || [mid, hi];
  out.push([r5(b + 3.5), a1, v3(v * .75), CL], [r5(b + 3.5), a2, v3(v * .7), CL]);
  return out;
}
const bowwheel = sortEv([
  ...[1, 2, 3, 4, 5, 6, 7, 8].flatMap(n => wheelBar(n, .3 + .035 * (n - 1))),            // §1–§2 pp → mp
  ...[9, 10, 11].flatMap(n => wheelBar(n, .62 + .06 * (n - 9))),   // §3: the pure G pedal (a D here grinds a semitone on the D♭ and E♭ triads)
  ...wheelBar(12, .95),
  ...[13, 14, 15, 16, 17, 18].flatMap(n => wheelBar(n, n < 17 ? .55 : .7)),              // §4 under the fanfare
  // §5: the wheel BOWS — each chord held until just before the next (the solver clips the rest)
  ...BROAD_CH.flatMap(([b, len, ns]) => ns.map((n, j) => [b, n, v3(.42 * (1 - .1 * j) + (b >= 100 ? .06 : 0)), r5(len - .8)])),
  // §6 fff — the G–D fifth on the "&" only over the organ's Dm · Gm (bars 25–26): under its Cm
  // (bars 23–24, D♯4 held) a D4 would grind a semitone against it
  ...[23, 24, 25, 26].flatMap(n => wheelBar(n, .82 + .04 * (n - 23), n >= 25 ? { and: ['D3', 'D4'] } : {})),
  ...[27, 28].flatMap(n => wheelBar(n, 1, { lo: 'C3', mid: 'G3', hi: 'G4', and: ['G#2', 'G#3'] })),   // the chord
  ...[0, 1, 2, 3, 4].map(o => [bar(29) + o, 'C3', .85, CL]),                             // the scramble's pulse
  ...[145, 146, 147].map(b => [b, 'G#2', 1, CL]), ...[145, 146, 147].map(b => [b, 'G#3', .9, CL]),
  [150, 'C3', 1, 2.5], [150, 'C4', .9, 2.5], [150, 'G3', .85, 2.5],                     // the C: one long bow
]);

// ---- RIFF FORGE — muted chugs (the forge's col legno), open chords, clean in §5 ---------
const chug = (n, note, v) => OST.map((o, i) => [r5(bar(n) + o), `${note}:m`, v3(v * ACC[i]), .25]);
const open = (b, notes, v, d) => notes.map(n => [r5(b), n, v3(v), d]);
const riff = sortEv([
  ...[3, 4, 5, 6, 7, 8].flatMap(n => chug(n, 'G2', .32 + .04 * (n - 3))),                 // §2 creeping in
  // §3: open power chords on each downbeat, the chugs between
  ...[9, 10, 11].flatMap((n, i) => [...open(bar(n), SLIDE[i].riff, .8 + .06 * i, 1),
    ...chug(n, 'G2', .66 + .06 * i).filter(e => e[0] > bar(n))]),
  ...open(bar(12), ['G2', 'D3', 'G3'], 1, 2), ...[2, 3, 3.5, 4].map(o => [bar(12) + o, 'G2:m', .9, .25]),
  ...[13, 14, 15, 16].flatMap(n => chug(n, 'G2', .5)),                                    // §4 under the call
  ...[17, 18].flatMap(n => chug(n, 'G2', .62).filter(e => e[0] > bar(n))),   // (the downbeats are open chords)
  ...open(bar(17), ['G2', 'D3', 'G3'], .8, 1), ...open(bar(18), ['G#2', 'D#3', 'G#3'], .9, 2.5),
  // §5: clean, ringing fifths on the broad chords' roots
  ...BROAD_CH.map(([b, len, ns]) => [b, `${{ 90: 'G2', 94: 'D#3', 96: 'C3', 100: 'G#2', 104: 'G2', 106: 'C3', 108: 'G2' }[b]}:c`, .45, len]),
  ...BROAD_CH.map(([b, len]) => [b, `${{ 90: 'D3', 94: 'A#3', 96: 'G3', 100: 'D#3', 104: 'D3', 106: 'G3', 108: 'D3' }[b]}:c`, .4, len]),
  // §6: an open power chord on every downbeat on the organ's root (C5 · C5 · D5 · G5), G chugs
  // between, the fifth's D on the "&" over the Dm · Gm bars
  ...[23, 24, 25, 26].flatMap(n => [...open(bar(n), { 23: ['C3', 'G3', 'C4'], 24: ['C3', 'G3', 'C4'], 25: ['D3', 'A3', 'D4'], 26: ['G2', 'D3', 'G3'] }[n], .95, 1),
    ...chug(n, 'G2', .85).filter(e => e[0] > bar(n) && (n < 25 || e[0] !== r5(bar(n) + 3.5))), ...(n >= 25 ? [[r5(bar(n) + 3.5), 'D3:m', .8, .25]] : [])]),
  // §7: the chord hammered OPEN in the ostinato rhythm (each hit rings to the next)
  ...[27, 28].flatMap(n => OST.map((o, i) => open(bar(n) + o, CHORD, ACC[i], i < 7 ? OST[i + 1] - o : 1)).flat()),
  ...[0, .5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5].map((o, i) => [bar(29) + o, 'C3:m', v3(.7 + .03 * i), .25]),   // the scramble
  ...[145, 146, 147].flatMap(b => open(b, ['C#3', 'G#3', 'C#4'], 1, .8)),                // D♭ stabs
  ...open(150, ['C3', 'G3', 'C4'], 1, 8),                                                 // the C, let ring
]);

// ---- BELLOWS HORNS — the fanfare, the stabs, the chord --------------------------------
const STABS = [0, 1, 2, 3, 3.5, 4];                   // the ostinato's beats a horn can re-strike (≥ .21 s)
const stabBar = (n, notes, v) => STABS.flatMap((o, i) => notes.map(nt => [r5(bar(n) + o), nt, v3(v * (i ? .82 : 1)), .4]));
const held = d => d > .9 ? Math.min(6, d - .35) : .3;   // held: its value less a breath (≤ 2.6 s = 6 beats); short = a stab
const hornsCall = (at, v, oct = [0]) => oct.flatMap(s => pin(tr(CALL, s - 12), at, i => v * (i === 0 || i === 4 ? 1 : .85), held));
const hornsAns  = (at, v, oct = [0]) => oct.flatMap(s => pin(tr(ANSWER, s - 12), at, i => v * (i === 0 || i === 4 ? 1 : .85), held));
const horns = sortEv([
  ...[9, 10, 11].flatMap((n, i) => stabBar(n, SLIDE[i].horns, .55 + .08 * i)),           // §3 stabbing the triads
  ...[0, 1, 2, 3, 3.5, 4].flatMap(o => [[bar(12) + o, 'G3', o ? .85 : 1, .4], [bar(12) + o, 'G4', o ? .8 : .95, .4]]),
  ...hornsCall(60, .62),                                                                  // §4 the tuba's call
  ...pin(tr(ANSWER, -12), 70, i => i === 0 || i === 4 ? .72 : .6, held),                  // the trumpets' answer (8vb: one rank)
  ...pin(tr(TUTTI, -12).map(([n, d], i, a) => i >= a.length - 2 ? [name(num(n) - 12), d] : [n, d]), 80, i => .66 + .03 * i, held),   // (the A♭ sigh 8vb: G#3 → G3)
  // §6 recap fff: the call and the answer
  ...hornsCall(110, .9),
  ...hornsAns(120, .95),
  // §7: THE CHORD in the ostinato's beats, the D♭ stabs, the C
  ...[27, 28].flatMap(n => stabBar(n, CHORD, 1)),
  ...[0, 2].map(o => [bar(29) + o, 'C3', .9, 1.6]), ...[0, 2].map(o => [bar(29) + o, 'C#4', .85, 1.6]),
  ...[145, 146, 147].flatMap(b => ['G#3', 'C#4', 'F4'].map(n => [b, n, 1, .45])),
  [150, 'C3', 1, 6], [150, 'C4', 1, 6], [150, 'G3', .9, 6],
]);

// ---- LIGHT ORGAN — the theme, the pedal, the choir, full organ ----------------------
const THEME1 = [['G2', 5], ['D3', 3], ['C#3', 7], ['A#2', 5], ['F3', 3], ['E3', 7]];
const organ = sortEv([
  ...pin(THEME1, 10, i => .4 + .05 * i, d => d - .15),                                    // §2 the first theme…
  ...pin(tr(THEME1, 12), 10, i => .32 + .05 * i, d => d - .15),                           // …in octaves
  ...[9, 10, 11].flatMap((n, i) => SLIDE[i].organ.map(nt => [bar(n), nt, v3(.62 + .08 * i), 4.8])),   // §3 the triads on the pedal
  ...['G2', 'G3', 'D4', 'G4'].map(n => [bar(12), n, .95, 4.85]),
  ...['G2', 'C4', 'D#4', 'G4'].map(n => [bar(17), n, .6, 4.85]),                          // §4 together: Cm/G…
  ...['G#2', 'C4', 'D#4', 'G#4'].map(n => [bar(18), n, .66, 2.85]),                       // …A♭ (the semitone)…
  ...['G2', 'D4', 'G4'].map(n => [bar(18) + 3, n, .55, 1.85]),                            // …and down to G
  ...BROAD_CH.flatMap(([b, len, , ns]) => ns.map((n, j) => [b, `${n}|choir`, v3(.34 - .03 * j), len - .1])),   // §5 the choir
  ...[[23, ['G2', 'C4', 'D#4', 'G4']], [24, ['G2', 'C4', 'D#4', 'G4']], [25, ['D3', 'A3', 'D4', 'F4']], [26, ['G2', 'D4', 'G4', 'A#4']]]
    .flatMap(([n, ns]) => ns.map(nt => [bar(n), nt, .82, 4.85])),                          // §6 full organ: Cm · Cm · Dm · Gm
  ...['C2', ...CHORD].map(n => [bar(27), n, 1, 9.85]),                                     // §7 THE CHORD, two bars
  ...['C#2', 'C#3', 'G#3', 'F4'].map(n => [bar(29), n, .85, 4.85]),                        // the scramble over D♭
  ...['C#2', 'C#3', 'G#3', 'C#4', 'F4'].flatMap(n => [145, 146, 147].map(b => [b, n, 1, .7])),
  ...['C2', 'C3', 'G3', 'C4', 'C5'].map(n => [150, n, 1, 8.5]),                            // the C (released before the seam)
]);

// ---- STRUM — the harps (harp timbre) ------------------------------------------------
const strum = sortEv([
  ...[1, 2, 3, 4, 5, 6, 7, 8].flatMap(n => [0, 1, 2, 3, 4].flatMap(o =>
    ['G2|h', 'G3|h'].map(id => [bar(n) + o, id, v3((.3 + .03 * (n - 1)) * (o ? .8 : 1))]))),
  // §5: each broad chord arpeggiated, one strum per beat (rolling up the chord)
  ...BROAD_CH.flatMap(([b, len, , , hp]) => Array.from({ length: len }, (_, k) =>
    hp.map(n => [b + k, `${n}|h`, v3((k ? .3 : .42) + (b >= 100 ? .05 : 0))])).flat()),
]);

// ---- DRUMS -------------------------------------------------------------------------------
const D = { kick: [], snare: [], crash: [], floorHigh: [], tomLow: [], tomMid: [], tomHiMid: [], tomHigh: [] };
{
  const timp = (n, v, only) => OST.forEach((o, i) => (!only || only.includes(i)) && D.kick.push([r5(bar(n) + o), v3(v * ACC[i])]));
  // pp → mp by DENSITY and velocity: bars 1–2 the downbeat alone (distant thunder); bars 3–8
  // the downbeat + the bar's tail (4-&-5); the whole rhythm arrives with the build (§3). (The
  // kick voice used to floor at .35 amplitude — vel .1 still sat ~15 dB over the pp strings, so
  // this crescendo was density only. dynamics.js velGain bends below .5: vel .14 ≈ −17 dB, .28 ≈ −10.)
  for (let n = 1; n <= 8; n++) timp(n, .14 + .02 * (n - 1), n <= 2 ? [0] : [0, 5, 6, 7]);
  for (let n = 9; n <= 12; n++) timp(n, .6 + .1 * (n - 9));
  for (let n = 13; n <= 18; n++) timp(n, n < 17 ? .36 : .7);                            // under the tuba's call: keep out of its way
  for (const [b] of BROAD_CH) D.kick.push([b, .4]);                                       // §5: one roll of thunder per chord
  for (let n = 23; n <= 28; n++) timp(n, .9);
  // the side drum: the fanfare's triplets (§4) and the recap's
  for (const n of [13, 14, 15, 16, 17, 18, 23, 24, 25, 26]){
    const v = n >= 23 ? .7 : .45;
    D.snare.push([r5(bar(n)), v], [r5(bar(n) + T), v3(v * .7)], [r5(bar(n) + 2 * T), v3(v * .8)], [r5(bar(n) + 3), v3(v * .75)], [r5(bar(n) + 3.5), v3(v * .65)]);
  }
  D.crash.push([bar(12), 1], [bar(18), .8], [bar(23), 1], [bar(27), 1], [150, 1]);
  // the coda: the chord's C (tomLow ≈ 131 Hz) and A♭ (tomHigh ≈ 207 Hz) in the ostinato
  for (const n of [27, 28]) OST.forEach((o, i) => {
    D.tomLow.push([r5(bar(n) + o), v3(.95 * ACC[i])]);
    if (i === 0 || i === 3 || i === 4) D.tomHigh.push([r5(bar(n) + o), .85]);
  });
  // the scramble: a tom cascade climbing in eighths, low → high
  const UP = ['floorHigh', 'tomLow', 'tomMid', 'tomHiMid', 'tomHigh'];
  for (let i = 0; i < 10; i++) D[UP[i % 5]].push([bar(29) + .5 * i, v3(.6 + .04 * i)]);
  for (const b of [145, 146, 147]){ D.kick.push([b, 1]); D.tomHigh.push([b, 1]); D.snare.push([b, .9]); }
  D.kick.push([150, 1]); D.tomLow.push([150, 1]);                                        // the C (the floor tom is an A: not under the last C)
  for (const l of Object.keys(D)) sortHits(D[l]);
}

// audio-only stage levels — the ostinato under the themes, up for the recap
const mix = {
  bowwheel: [[0, .85], [10, .6], [40, .7], [60, .55], [90, .75], [110, .65], [130, .75]],
  riff:     [[0, .6], [40, .7], [60, .5], [90, .55], [110, .7], [130, .75]],
  horns:    [[0, .85], [110, .8]],
  organ:    [[0, .7], [40, .6], [90, .55], [110, .55], [130, .7]],
  strum:    [[0, .7], [90, .6]],
};

export default {
  label: 'Mars', sub: 'Holst · the Bringer of War, in 5/4',
  bpm: 60 * 9 / 3.8,                                   // ≈ 142.1: the 3.8 s breath = 9 beats; 151 + 9 = 32 bars of 5
  barBeats: 5,                                         // 5/4: the director's bar lines
  scale: ['G', 'G#', 'A#', 'C', 'C#', 'D', 'D#', 'F'],
  room: 'void',                                        // the starfield and its ringed planet
  melody,
  parts: { bowwheel, riff, horns, organ, strum },
  mix,
  director: {
    // the ostinato machines play everything — salience must come from the song's pull
    horns: 1.6, organ: 1.5, bowwheel: 1.2, riff: 1.1, strum: .8, drums: .7, belt: 1,
    // the brass rank stands behind the bow wheel: look down its length from the stage side,
    // under the wheel's gantry, the bells receding (the default front shot looks through the wheel)
    // and the bow wheel's string bed (cups + magnets at y ≈ 10) is framed from above, not up into the wheel
    shots: { horns: { x: -12, up: 3.5, dist: 5 }, bowwheel: { x: 5, up: 7, dist: 13 } },
    at: [
      [0, 'stage', 4],         // the void: the machines waiting under the ringed planet
      [4, 'bowwheel', 14],     // col legno: wood on string, the war's pulse
      [18, 'organ', 12],       // the first theme rises out of the bass (G · D · D♭ … B♭ · F · E)
      [40, 'riff', 15],        // the forge tears open the sliding triads
      [55, 'bowwheel', 5],     // the unison G — the wheel hammering fff
      [60, 'horns', 10],       // the tenor tuba's call
      [70, 'lead', 10],        // the trumpets' answer
      [80, 'horns', 10],       // together, up to the A♭
      [90, 'bowwheel', 10],    // the broad 5/2: the wheel BOWS
      [100, 'strum', 6],       // the harps under the A♭ chord
      [110, 'riff', 10],       // the recapitulation, fff: open power chords
      [120, 'horns', 10],      // the whole section answers
      [130, 'organ', 10],      // THE CHORD — A♭·D♭·G over C
      [140, 'lead', 5],        // the scramble
      [145, 'riff', 5],        // the D♭ stabs, the silence, the last C ringing on the forge
    ],
  },
  drums: D,
};

export const _mars = { sum, melodyBeats: sum(melody) };
