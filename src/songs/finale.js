/* STARSHIP GROOVE: THE CASCADE FINALE. An original space-funk showpiece (AJ / Orchestrion),
   written for the Starship deck. It is an Animusic homage in spirit only: no borrowed notes.
   Every machine the room owns gets a featured moment, and the order is a real
   arrangement: an intro, then the groove, then each machine's feature, then a tutti.
   The belt marble is the lead singer. Its hook is a tresillo (3 + 3 + 2 sixteenths)
   up the E-minor pentatonic to a held B, and the held notes are the belt's tallest arcs.
   The horns answer in the gaps those arcs leave.

   KEY: E DORIAN (E F# G A B C# D). The vamp is the Dorian i–IV, Em9 → A13. The guitar's
   two voicings share three notes; only D4 → C#4 moves, the funk-guitar trick. The turnaround
   is ♭VI → V7♯9 (Cmaj7 → B7♯9, the "Hendrix" ♯9: D natural over a D# third). The bridge
   leaves for G major (Am9 · D9 · Gmaj7 Cmaj7 · F#m7♭5 B7, a ii–V–I–IV then ii–V home to
   Em). 4/4, straight 16ths.

   TEMPO / THE SEAM: bpm = 60·7/3.8 ≈ 110.53, so the loop's fixed 3.8 s breath is EXACTLY 7
   beats. The melody is 121 beats, and 121 + 7 = 128 = 32 bars, ~69.5 s. Nothing may strike
   inside the breath, so the last thing that plays is the LANDING: at beat 120 the whole room
   hits one B7♯9 and lets it ring through the breath. The dominant hangs over the void and
   resolves to the intro's Em9 on the downbeat (V → i across the seam). The end of the loop
   is the reason its start sounds like an arrival.

   FORM (beats · bars):
     INTRO     0–16   1–4   IGNITION. The light organ breathes Em9 (choir above), the bow
                            wheel holds an E–B fifth, the bells toll. The belt sings a slow,
                            tall-arc preview (B E F# | G…). Cmaj9♯11 · B7sus → B7. The kit
                            ticks in at bar 3, and a snare + tom run takes the room into…
     GROOVE    16–32  5–8   THE HOOK. Kit, string bass (octave pops: E2 · E3) and the RIFF
                            FORGE on a CLEAN amp (':c') come in together. The forge plays
                            16th-note chicken scratch: palm-muted ghosts with open chanks on 2, 4
                            and the "a" of 2. The Marble Grand (e-piano tine voice, ':e') comps
                            Rhodes chords. The belt states the hook twice.
     HORNS     32–48  9–12  CALL AND RESPONSE. The hook again, and the BELLOWS HORNS answer
                            every held note ("ba-ba-BAH"). The phrase turns Cmaj7 → B7♯9, and
                            the horns push the B7 a half beat early, as funk horns do — and the
                            forge's last chanks and the bass push WITH them (PUSH: bars 11, 29,
                            30), so a push never lands on top of the old chord.
     GRAND     48–64  13–16 THE MARBLE GRAND'S SOLO. The band drops to bass, a soft kit and the
                            forge's offbeat chanks. The organ lays a low pad, and the e-piano
                            plays a Dorian solo (8ths + 16ths, a peak on B5). The belt floats
                            above it in whole-bar arcs (E6 D6 | C#6 …): the marble watches.
     HARP +    64–80  17–20 Cmaj7 · D6 · Bm7 · Em9 (♭VI ♭VII v i, the lift). The MARBLE
     MARIMBA                AUTOHARP strums a down-up pattern; the belt sings the second theme.
                            Bars 17–18 the marimba rocks 8ths underneath. At bars 19–20 it takes
                            the feature: true 16th arpeggios across both hands.
     BRIDGE    80–96  21–24 THE STRINGS. The BOW WHEEL sings the bridge melody (E4 … C5, the
                            cello–viola voice). The organ and choir hold each chord, the harp
                            lets one strum ring per chord, the bells toll the chord tones, and
                            the kit goes half-time on the ride. Ends on B7, and D#5 → E.
     VIBES     96–104 25–26 THE TURNTABLE BREAK. The groove comes back under a vibraphone solo
                            read off the record (16th runs, E6 peaks). The belt holds.
     BREAK    104–112 27–28 STOP-TIME. Three Cmaj7 slams (forge DISTORTED now, horns, crash,
                            bass), a B7♯9, the forge's blues run up B (B D E F# A B D D#), and a
                            tom cascade high → floor under it. The drums' feature.
     TUTTI    112–120 29–30 EVERYONE. The hook (climbing to E6) with horn punches, harp
                            backbeats, marimba 8ths, the Grand's comp, organ + choir, bowed
                            sustain and the vibes a sixth under the belt.
     LANDING  120     31    B7♯9, the whole room, ringing through the 7-beat breath → Em9.

   WHO LIVES WHERE (each part sits inside its machine's PART_LIMITS):
     belt (lead)  B4–E6   the singer.
     riff forge   B2–B4   clean 9th / 13th voicings (Em9 G3 D4 F#4 B4 · A13 G3 C#4 F#4 B4 ·
                          Cmaj7 · B7♯9). A muted scratch is dur ≤ .3 ('…:cm'). A 16th on one
                          string is .136 s, over the .13 s comfort floor. The break is the
                          distortion amp (no flag): power chords and a single-note run.
     string bass  E2–E3   exactly 8 strings: E2 F#2 G2 A2 B2 C3 D3 E3. Octave pops, never the
                          same string closer than a dotted 8th (≥ .15 s).
     horns        A2–B4   exactly 12 horns: A2 B2 C3 E3 | C#4 D4 D#4 E4 F#4 G4 A4 B4. One
                          tuba root under a three-note section. Stabs (≤ .5 beat) take the
                          slammed-lid stab voice; holds stay ≤ 4.5 beats (2.44 s < 2.6 s).
     light organ  A2–E5   chords five deep + the choir an octave up (its own pipes).
     bow wheel    E3–D#5  12 strings: E3 G3 A3 B3 E4 F#4 G4 A4 B4 C5 D5 D#5. The bridge
                          melody + the fifth drones. Every hold ≤ 7 beats (3.8 s < 3.9 s).
     Marble Grand A2–B5   ≤ 20 strings, all ':e' (the tine e-piano voice). A pitch never
                          repeats inside .21 s; the solo's 16ths always move.
     autoharp     A2–D5   ≤ 24 strings, ≤ 6 per strum, strums ≥ .27 s apart (8ths).
     marimba      B3–B5   ≤ 4 mallets; 16ths in the feature; the landing chord ROLLS.
     tub. bells   A4–G5   8 bells, one toll per chord change; they ring 4.4 s anyway.
     vibes (turntable)  G4–E6  monophonic. It TRADES with the lead and never doubles it:
                          no onset shares the lead's pitch class, and it never holds the
                          lead's exact note (asserted in test/songs.test.js). In the tutti
                          it plays a sixth below.
   Drums: kick / snare (backbeat + ghost notes) / hat 16ths / hatOpen on the "and" of 4 /
   ride (bridge, grand) / crash (arrivals) / the five toms (the intro run, the break).

   CLASHES THAT ARE MEANT: the belt's D#6 → D6 over B7♯9 (bar 12, the ♯9 rub), and the
   F#5 · A5 tensions against Em9 / A13 (9ths and 13ths are the colour of the style).

   MIX (audio only; velocity stays dynamics): the tutti stacks eleven machines on one
   downbeat. Every bed machine therefore steps down from bar 29, and the belt and horns
   read on top. The forge's 16th scratch sits under the hook. The organ, an ice-blue wall
   of light, is a bed everywhere but the intro.

   DIRECTOR: song.director.at scripts one featured shot per machine, in arrangement order.
   The organ opens, then the bells' toll, the bass entering with the groove, the forge's
   scratch, the horns' answer, the belt's climb, the Grand's solo, the harp, the marimba's
   16ths, the bow wheel's bridge, the bells' second toll, the vibes break and the drums'
   stop-time. The tutti cuts to the wide (every machine in frame for the hook's last
   statement), and the landing rings on the engine's seam wide. director.shots re-frames
   the string bass from its wing side (its slot shot looked through the Grand's case).

   iOS NOTE (§5): the sample path ignores `dur` and volume. The horn stabs have their own
   baked voice, so they stay short anyway. The organ / bow wheel / harp holds ring their
   full render. Drum ghost-note velocity lives on the webaudio path only.
   ============================================================ */

// ---- helpers -----------------------------------------------------------------------
const r5 = x => +x.toFixed(5);
const v3 = x => +Math.min(1, Math.max(.05, x)).toFixed(3);
const sum = line => line.reduce((s, [, d]) => s + d, 0);
const byBeat = (a, b) => (Array.isArray(a) ? a[0] : a) - (Array.isArray(b) ? b[0] : b) || String(a[1]).localeCompare(String(b[1]));
const BAR = n => 4 * (n - 1);                    // bar n (1-based) → its first beat
/** a chained [[note, beats]] line → absolute part events from `at` */
const pin = (line, at, vel = .8, durScale = .95) => {
  const out = []; let b = at;
  for (const [n, d, v] of line){ out.push([r5(b), n, v3(v ?? vel), r5(d * durScale)]); b += d; }
  return out;
};

// ---- THE LEAD (belt) -----------------------------------------------------------------
const HOOK_A  = [['E5', .75], ['G5', .75], ['A5', .5], ['B5', 2]];                          // Em9: the tresillo, then the held B
const HOOK_B  = [['D6', .5], ['B5', .5], ['A5', .5], ['G5', .75], ['A5', 1.75]];            // A13: the 16th push onto the held A
const HOOK_C  = [['E5', .75], ['G5', .75], ['A5', .5], ['B5', .75], ['D6', .75], ['E6', .5]];   // Em9: the climb
const HOOK_D  = [['D6', .5], ['B5', .5], ['A5', .5], ['G5', .5], ['A5', .75], ['G5', .75], ['F#5', .5]];
const melody = [
  // INTRO: the hook's shape, slowed into tall arcs
  ['B4', 1.5], ['E5', 1.5], ['F#5', 1],
  ['G5', 3], ['A5', .5], ['G5', .5],
  ['F#5', 1.5], ['E5', 1.5], ['B4', 1],                      // Cmaj9♯11
  ['E5', 2], ['D#5', 2],                                     // B7sus → B7
  // GROOVE: the hook, twice
  ...HOOK_A, ...HOOK_B, ...HOOK_C, ...HOOK_D,
  // HORNS: the hook answered; the turnaround
  ...HOOK_A, ...HOOK_B,
  ['E5', .75], ['G5', .75], ['B5', .5], ['E6', 2],           // Cmaj7
  ['D#6', .75], ['D6', .75], ['B5', .5], ['A5', .5], ['F#5', .5], ['D#5', 1],   // B7♯9: the ♯9 rub
  // GRAND: the marble floats over the e-piano solo
  ['E6', 2], ['D6', 2], ['C#6', 4], ['B5', 2], ['D6', 2], ['E6', 2], ['C#6', 2],
  // HARP + MARIMBA: the second theme
  ['G5', 1.5], ['E5', .5], ['B5', 2],                        // Cmaj7
  ['A5', 1.5], ['F#5', .5], ['B5', 2],                       // D6
  ['A5', 1], ['F#5', 1], ['D5', 1], ['F#5', 1],              // Bm7
  ['G5', 3], ['F#5', 1],                                     // Em9
  // BRIDGE: long tones over the bow wheel's melody
  ['B5', 4], ['A5', 4], ['B5', 2], ['G5', 2], ['A5', 2], ['F#5', 2],
  // VIBES: the belt holds
  ['E5', 3], ['D5', 1], ['C#5', 4],
  // BREAK: stop-time
  ['E6', 1.5], ['B5', 1.5], ['G5', 1],                       // Cmaj7 slams
  ['F#5', 2], ['D#5', 2],                                    // B7♯9
  // TUTTI
  ...HOOK_C,
  ['D6', .5], ['B5', .5], ['A5', .5], ['G5', .5], ['E5', .75], ['G5', .75], ['A5', .5],
  // LANDING
  ['B5', 1],
];

// ---- chord vocabulary ------------------------------------------------------------------
// the forge's clean voicings (D-G-B-E strings, plus a root for C and B)
const GTR = {
  Em9: ['G3', 'D4', 'F#4', 'B4'], A13: ['G3', 'C#4', 'F#4', 'B4'],
  Cmaj7: ['C3', 'G3', 'B3', 'E4'], B7s9: ['B2', 'D#3', 'A3', 'D4'],
};
const BASS_BAR = {                 // [offset, string, vel]
  Em9:   [[0, 'E2', 1], [.75, 'E2', .62], [1, 'E3', .86], [1.5, 'D3', .7], [2.5, 'E2', .86], [3, 'G2', .7], [3.5, 'A2', .7], [3.75, 'B2', .66]],
  A13:   [[0, 'A2', 1], [.75, 'A2', .62], [1, 'E3', .82], [1.5, 'G2', .7], [2.5, 'A2', .86], [3, 'B2', .7], [3.5, 'D3', .72]],
  Cmaj7: [[0, 'C3', 1], [.75, 'C3', .62], [1, 'G2', .8], [1.5, 'B2', .7], [2.5, 'C3', .86], [3, 'E2', .7], [3.5, 'G2', .72]],
  B7s9:  [[0, 'B2', 1], [.75, 'B2', .62], [1.5, 'A2', .72], [2, 'F#2', .76], [2.5, 'B2', .86], [3, 'A2', .7], [3.5, 'G2', .7], [3.75, 'F#2', .7]],
};
const RHODES = {                   // the Grand's comp (all ':e')
  Em9: ['E3', 'D4', 'F#4', 'G4', 'B4'], A13: ['A2', 'C#4', 'F#4', 'G4', 'B4'],
  Cmaj7: ['C3', 'E4', 'G4', 'B4'], B7s9: ['B2', 'D#4', 'A4', 'D5'],
};
const HORN = {                     // one tuba root + the section
  Em: ['E3', 'D4', 'G4', 'B4'], EmUp: ['E3', 'E4', 'G4', 'B4'],
  A13: ['A2', 'C#4', 'G4', 'B4'], A13b: ['A2', 'C#4', 'F#4', 'A4'],
  C: ['C3', 'E4', 'G4', 'B4'], B7: ['B2', 'D#4', 'F#4', 'A4'],
};
const HARP = {                     // the autoharp's fan (≤ 6 per strum)
  Cmaj7: ['C3', 'G3', 'C4', 'E4', 'G4', 'B4'], D6: ['D3', 'A3', 'D4', 'F#4', 'A4', 'B4'],
  Bm7: ['B2', 'F#3', 'A3', 'D4', 'F#4', 'B4'], Em9: ['E3', 'B3', 'D4', 'F#4', 'G4', 'B4'],
  A13: ['A2', 'G3', 'C#4', 'F#4', 'B4'],
  Am9: ['A2', 'E3', 'G3', 'C4', 'E4', 'B4'], D9: ['D3', 'F#3', 'C4', 'E4', 'A4'],
  Gmaj7: ['G2', 'D3', 'F#3', 'B3', 'D4'], F7b5: ['F#3', 'C4', 'E4', 'A4'],
  B7: ['B2', 'F#3', 'A3', 'D#4', 'F#4'], B7s9: ['B2', 'F#3', 'A3', 'D#4', 'F#4', 'D5'],
};

// the groove's chord per bar (1-based bar → chord); bars not listed have no groove
const GROOVE_BARS = {};
[5, 7, 9, 13, 15, 25, 29].forEach(b => { GROOVE_BARS[b] = 'Em9'; });
[6, 8, 10, 14, 16, 26, 30].forEach(b => { GROOVE_BARS[b] = 'A13'; });
GROOVE_BARS[11] = 'Cmaj7'; GROOVE_BARS[12] = 'B7s9';
// the PUSHES: where the horns hit the next chord on the "and" of 4, the rhythm section goes
// with them (the forge's last two 16ths, the bass's last 8th, the harp) — a horn B7 over a
// guitar Cmaj7 chank on the same 16th is a clash, not a push
const PUSH = { 11: 'B7s9', 29: 'A13', 30: 'B7s9' };

// ---- RIFF FORGE: clean scratch, the distorted break ----------------------------------------
const riff = [];
const OPEN_SLOTS = new Set([4, 7, 12, 14]);        // 2 · the "a" of 2 · 4 · the "and" of 4
const GHOST_REST = new Set([2, 10]);               // two breaths in the 16th wall
const scratch = (b0, ch0, s = 1, sparse = false, push = null) => {
  for (let k = 0; k < 16; k++){
    const b = r5(b0 + k / 4), open = OPEN_SLOTS.has(k), ch = push && k >= 14 ? push : ch0;
    if (sparse && !open) continue;
    if (!open && GHOST_REST.has(k)) continue;
    for (const n of GTR[ch]) riff.push(open ? [b, n + ':c', v3((k === 4 || k === 12 ? .82 : .7) * s), .45]
                                            : [b, n + ':cm', v3((k % 4 ? .34 : .46) * s), .2]);
  }
};
for (const [bar, ch] of Object.entries(GROOVE_BARS)){
  const n = +bar;
  if (n >= 13 && n <= 16) scratch(BAR(n), ch, .7, true);       // under the Grand: chanks only
  else scratch(BAR(n), ch, n >= 29 ? .85 : 1, false, PUSH[n]);
}
{ // the BREAK (bars 27–28): distortion. Three Cmaj7 slams, a B7♯9, the blues run up B
  const P5 = (b, ns, v, d) => ns.forEach(n => riff.push([r5(b), n, v, d]));
  P5(104, ['C3', 'G3', 'C4'], 1, 1.2); P5(105.5, ['C3', 'G3', 'C4'], .92, .45); P5(106.5, ['C3', 'G3', 'C4'], .96, .4);
  [['E4', 107], ['G4', 107.25], ['A4', 107.5], ['B4', 107.75]].forEach(([n, b], i) => riff.push([b, n, v3(.72 + .06 * i), .35]));
  P5(108, GTR.B7s9, 1, 1.4);
  ['B3', 'D4', 'E4', 'F#4', 'A4', 'B4', 'D5', 'D#5'].forEach((n, i) => riff.push([r5(109.5 + i / 4), n, v3(.7 + .04 * i), .35]));
  riff.push([111.5, 'F#4', .92, .45], [111.5, 'B4', .92, .45]);   // the double-stop that lands the tutti
}
GTR.B7s9.forEach(n => riff.push([120, n, 1, 8]));             // the landing: the forge's B7♯9, distorted, ringing
riff.sort(byBeat);

// ---- STRING BASS -----------------------------------------------------------------------------
const bass = [];
for (const [bar, ch] of Object.entries(GROOVE_BARS)){
  const n = +bar, s = n >= 13 && n <= 16 ? .85 : 1;
  for (const [o, nt, v] of BASS_BAR[ch]) bass.push([r5(BAR(n) + o), PUSH[n] && o === 3.5 ? (PUSH[n] === 'B7s9' ? 'F#2' : 'A2') : nt, v3(v * s)]);
}
// intro: the bass wakes on the B7 (bar 4), a pickup into the groove
bass.push([14, 'B2', .7], [15, 'A2', .6], [15.5, 'F#2', .66], [15.75, 'D3', .7]);
// harp + marimba (17–20): Cmaj7 D6 Bm7 Em9, a lighter two-feel with the octave pops
for (const [n, r, hi] of [[17, 'C3', 'G2'], [18, 'D3', 'A2'], [19, 'B2', 'F#2'], [20, 'E2', 'E3']]){
  const b0 = BAR(n);
  bass.push([b0, r, .9], [b0 + 1.5, hi, .66], [b0 + 2, r, .78], [b0 + 3, hi, .62], [b0 + 3.5, r, .7]);
}
// bridge (21–24): half-time roots, one per chord
for (const [b, r, v] of [[80, 'A2', .86], [82.5, 'E3', .6], [84, 'D3', .86], [86.5, 'A2', .6], [88, 'G2', .86], [90, 'C3', .82],
                          [92, 'F#2', .82], [94, 'B2', .86], [95.5, 'A2', .62], [95.75, 'G2', .66]]) bass.push([b, r, v]);
// the break (27–28): with the slams, then walking up under the forge's run
for (const [b, r, v] of [[104, 'C3', 1], [105.5, 'C3', .9], [106.5, 'C3', .94], [108, 'B2', 1], [111, 'B2', .8], [111.5, 'A2', .84], [111.75, 'F#2', .86]])
  bass.push([b, r, v]);
bass.push([120, 'B2', 1]);
bass.sort(byBeat);

// ---- MARBLE GRAND (e-piano) --------------------------------------------------------------------
const dulcimer = [];
const ep = (b, ns, v, d) => ns.forEach((n, j) => dulcimer.push([r5(b), n + ':e', v3(v * (1 - .04 * j)), d]));
for (const [bar, ch] of Object.entries(GROOVE_BARS)){
  const n = +bar, b0 = BAR(n);
  if (n >= 13 && n <= 16){ ep(b0, [RHODES[ch][0], RHODES[ch][1]], .42, 1.5); continue; }   // the left hand under the solo
  const s = n >= 29 ? .8 : 1;
  ep(b0, RHODES[ch], .46 * s, 1.5); ep(b0 + 2.5, RHODES[ch].slice(1), .4 * s, 1);
}
// the SOLO (bars 13–16): Dorian, 8ths + 16ths, every 16th moves (one string never re-strikes inside .21 s)
const SOLO = [
  // bar 13 · Em9
  [48, 'B4', .5], [48.5, 'D5', .5], [49, 'E5', .25], [49.25, 'F#5', .25], [49.5, 'G5', .5], [50, 'F#5', .25], [50.25, 'E5', .25],
  [50.5, 'D5', .5], [51, 'B4', 1],
  // bar 14 · A13
  [52, 'C#5', .75], [52.75, 'E5', .25], [53, 'G5', .5], [53.5, 'F#5', .5], [54, 'E5', .25], [54.25, 'C#5', .25], [54.5, 'B4', .5],
  [55, 'A4', .5], [55.5, 'B4', .5],
  // bar 15 · Em9: up to the peak
  [56, 'E5', .5], [56.5, 'G5', .5], [57, 'B5', .75], [57.75, 'A5', .25], [58, 'G5', .5], [58.5, 'E5', .5], [59, 'F#5', .25],
  [59.25, 'G5', .25], [59.5, 'A5', .5],
  // bar 16 · A13: the peak and the tumble
  [60, 'B5', 1], [61, 'A5', .25], [61.25, 'G5', .25], [61.5, 'F#5', .25], [61.75, 'E5', .25], [62, 'C#5', .5], [62.5, 'B4', .5],
  [63, 'A4', .5], [63.5, 'D5', .5],
];
const SOLO_VEL = b => .62 + .3 * Math.min(1, Math.max(0, (b - 48) / 12));   // the solo builds to the B5 at bar 16
for (const [b, n, d] of SOLO) dulcimer.push([b, n + ':e', v3(SOLO_VEL(b) * (Math.abs(b % 1) < 1e-9 ? 1 : .88)), d]);
ep(120, RHODES.B7s9, .7, 7);                                    // the landing
dulcimer.sort(byBeat);

// ---- BELLOWS HORNS ---------------------------------------------------------------------------
const horns = [];
const hh = (b, ch, v, d = .25) => HORN[ch].forEach((n, j) => horns.push([r5(b), n, v3(v * (1 - .05 * j)), d]));
// the call-and-response (bars 9–12): "ba-ba-BAH" into every held note
hh(34.5, 'Em', .82); hh(35, 'Em', .86); hh(35.5, 'EmUp', .95, .5);
hh(38.5, 'A13', .82); hh(39, 'A13', .86); hh(39.5, 'A13b', .95, .5);
hh(42.5, 'C', .82); hh(43, 'C', .88); hh(43.5, 'B7', 1, 1.5);                    // the push: B7 a half beat early
hh(46.5, 'B7', .84); hh(47.5, 'B7', .9, .5);
// bridge: a swell on the B7 that hands off to the vibes
hh(94, 'B7', .6, 2);
// the BREAK: slams with the forge and crash
hh(104, 'C', 1, .5); hh(105.5, 'C', .94); hh(106.5, 'C', .97); hh(108, 'B7', 1, 1.5); hh(111.5, 'B7', .9);
// the TUTTI: punches against the hook
hh(112, 'Em', .95, .5); hh(114, 'Em', .82); hh(114.5, 'EmUp', .9, .5); hh(115.5, 'A13b', .86);
hh(116, 'A13', .92, .5); hh(118, 'A13', .82); hh(118.5, 'A13b', .9, .5); hh(119.5, 'B7', .9);
hh(120, 'B7', 1, 4.5);                                          // the landing (2.44 s, under the 2.6 s cap)
horns.sort(byBeat);

// ---- LIGHT ORGAN [beat, note(|choir), vel, beats] ----------------------------------------------
const organ = [];
const oc = (b, ns, v, d, choir = []) => {
  ns.forEach((n, j) => organ.push([r5(b), n, v3(v * (1 - .04 * j)), d]));
  choir.forEach((n, j) => organ.push([r5(b), n + '|choir', v3(v * .82 * (1 - .05 * j)), d]));
};
// intro: Em9 · Cmaj9♯11 · B7sus → B7 (the B2 F#3 A3 hold; the 4th falls to the 3rd)
oc(0, ['E3', 'B3', 'D4', 'F#4', 'G4'], .48, 8, ['B4', 'D5']);
oc(8, ['C3', 'G3', 'B3', 'E4', 'F#4'], .54, 4, ['B4', 'D5']);
oc(12, ['B2', 'F#3', 'A3'], .62, 4); oc(12, ['E4'], .58, 2, ['A4']); oc(14, ['D#4'], .6, 2, ['D#5']);
// under the Grand: a low pad, Em9 / A13
for (const [b, ch] of [[48, 'Em9'], [52, 'A13'], [56, 'Em9'], [60, 'A13']])
  oc(b, ch === 'Em9' ? ['E3', 'B3', 'D4', 'F#4'] : ['A2', 'G3', 'C#4', 'F#4'], .34, 4);
// the bridge: Am9 · D9 · Gmaj7 Cmaj7 · F#m7♭5 B7, the choir an octave over the strings
oc(80, ['A2', 'E3', 'G3', 'B3', 'C4'], .6, 4, ['C5', 'E5']);
oc(84, ['D3', 'A3', 'C4', 'E4', 'F#4'], .6, 4, ['C5', 'E5']);
oc(88, ['G2', 'D3', 'F#3', 'B3'], .62, 2, ['B4', 'D5']);
oc(90, ['C3', 'G3', 'B3', 'E4'], .62, 2, ['B4', 'E5']);
oc(92, ['F#2', 'E3', 'A3', 'C4'], .64, 2, ['C5', 'E5']);
oc(94, ['B2', 'F#3', 'A3', 'D#4'], .68, 2, ['B4', 'D#5']);
// the tutti
oc(112, ['E3', 'B3', 'D4', 'F#4', 'G4'], .58, 3.5, ['B4', 'D5']);      // (lifts for the horns' push on the "and" of 4)
oc(116, ['A2', 'E3', 'G3', 'C#4', 'F#4'], .58, 3.5, ['B4', 'E5']);
// the landing, held through the breath
oc(120, ['B2', 'F#3', 'A3', 'D#4'], .6, 7.6, ['A4', 'D#5']);
organ.sort(byBeat);

// ---- BOW WHEEL --------------------------------------------------------------------------------
const bowwheel = [];
const bw = (b, n, v, d) => bowwheel.push([r5(b), n, v3(v), d]);
// intro: the fifth drone, then the chord's guide tones
bw(0, 'E3', .46, 7); bw(0, 'B3', .42, 7);
bw(8, 'G3', .58, 3.5); bw(8, 'E4', .54, 3.5);
bw(12, 'A3', .6, 3.6); bw(12, 'E4', .58, 1.8); bw(14, 'D#5', .5, 1.8);
// the BRIDGE MELODY (bars 21–24)
for (const [b, n, d, v] of [
  [80, 'E4', 1.5, .7], [81.5, 'G4', .5, .66], [82, 'A4', 1, .72], [83, 'B4', 1, .76],     // Am9
  [84, 'C5', 2, .86], [86, 'B4', 1, .74], [87, 'A4', 1, .72],                             // D9
  [88, 'B4', 1.5, .8], [89.5, 'A4', .5, .7], [90, 'G4', 2, .76],                          // Gmaj7 · Cmaj7
  [92, 'A4', 1, .74], [93, 'C5', 1, .82], [94, 'B4', 1, .8], [95, 'D#5', 1, .9],          // F#m7♭5 · B7: D#5 → E
]) bw(b, n, v, d * .96);
// the tutti: a bowed bed (Em9 · A13)
bw(112, 'E3', .55, 3.4); bw(112, 'B3', .5, 3.4); bw(112, 'F#4', .5, 3.4); bw(112, 'D5', .48, 3.4);   // (off before the push)
bw(116, 'A3', .55, 3.4); bw(116, 'E4', .5, 3.4); bw(116, 'G4', .5, 3.4); bw(116, 'B4', .48, 3.4);
// the landing: B7 (A3 · B3 · F#4 · D#5), 7 beats = 3.8 s
bw(120, 'B3', .66, 7); bw(120, 'A3', .6, 7); bw(120, 'F#4', .6, 7); bw(120, 'D#5', .64, 7);
bowwheel.sort(byBeat);

// ---- MARBLE AUTOHARP ---------------------------------------------------------------------------
const strum = [];
const sw = (b, ch, v, d = 0) => HARP[ch].forEach(n => strum.push([r5(b), n, v3(v), d]));
const STRUM_PAT = [[0, .92], [1, .7], [1.5, .62], [2.5, .7], [3, .86], [3.5, .6]];   // D · D U · U D U
for (const [bar, ch, s] of [[17, 'Cmaj7', 1], [18, 'D6', 1], [19, 'Bm7', .72], [20, 'Em9', .72]])
  for (const [o, v] of STRUM_PAT) sw(BAR(bar) + o, ch, v * s);
// the bridge: one let-ring strum per chord
for (const [b, ch] of [[80, 'Am9'], [84, 'D9'], [88, 'Gmaj7'], [90, 'Cmaj7'], [92, 'F7b5'], [94, 'B7']]) sw(b, ch, .56);
// the tutti: backbeats + the "and" of 4
for (const [bar, ch] of [[29, 'Em9'], [30, 'A13']]) for (const [o, v] of [[1, .7], [2.5, .56], [3, .72], [3.5, .56]]) sw(BAR(bar) + o, o === 3.5 ? PUSH[bar] : ch, v);
sw(120, 'B7s9', .9);
strum.sort(byBeat);

// ---- MARIMBA (the robot marimbist) ---------------------------------------------------------------
const marimba = [];
const mm = (b, n, v, d) => marimba.push([r5(b), n, v3(v), d]);
// bars 17–18: rocking 8ths under the harp
[['G4', 'E5', 'B4', 'E5', 'G4', 'E5', 'B4', 'D5'], ['A4', 'F#5', 'B4', 'F#5', 'A4', 'F#5', 'B4', 'D5']]
  .forEach((row, i) => row.forEach((n, k) => mm(64 + 4 * i + k / 2, n, k % 2 ? .44 : .52, .5)));
// bars 19–20: THE FEATURE: 16th arpeggios, up and back, across both hands
const ARP_BM = ['B3', 'D4', 'F#4', 'A4', 'B4', 'D5', 'F#5', 'A5', 'B5', 'A5', 'F#5', 'D5', 'B4', 'A4', 'F#4', 'D4'];
const ARP_EM = ['E4', 'G4', 'B4', 'D5', 'F#5', 'G5', 'B5', 'A5', 'G5', 'F#5', 'D5', 'B4', 'G4', 'F#4', 'D4', 'B3'];
ARP_BM.forEach((n, k) => mm(72 + k / 4, n, .6 + .12 * (k % 4 === 0) + .1 * k / 15, .25));
ARP_EM.forEach((n, k) => mm(76 + k / 4, n, .72 + .12 * (k % 4 === 0) + .08 * k / 15, .25));
// the tutti: 8ths, Em9 · A13
[['B4', 'E5', 'F#5', 'E5', 'B4', 'G5', 'F#5', 'E5'], ['C#5', 'E5', 'G5', 'E5', 'C#5', 'F#5', 'E5', 'B4']]
  .forEach((row, i) => row.forEach((n, k) => mm(112 + 4 * i + k / 2, n, k % 2 ? .4 : .5, .5)));
['B3', 'D#4', 'F#4', 'A4'].forEach(n => mm(120, n, .7, 4));     // the landing ROLLS (held ≥ 1 beat)
marimba.sort(byBeat);

// ---- TUBULAR BELLS: one toll per chord change ------------------------------------------------------
const bells = [
  [0, 'E5', .72], [4, 'B4', .5], [8, 'G5', .62], [12, 'F#5', .54], [14, 'D#5', .5],                          // intro
  [80, 'E5', .6], [84, 'F#5', .58], [88, 'D5', .56], [90, 'E5', .56], [92, 'C5', .58], [94, 'D#5', .64],     // bridge
  [112, 'E5', .66], [116, 'A4', .58],                                                                          // tutti
  [120, 'B4', .8], [120, 'D#5', .74], [120, 'F#5', .7],                                                        // landing
];

// ---- VIBES (turntable): the break, the tutti's sixth, the landing --------------------------------------
const turntable = [
  // bar 25 · Em9 (the belt holds E5, then D5)
  [96, 'B5', .82, .5], [96.5, 'D6', .7, .25], [96.75, 'B5', .62, .25], [97, 'A5', .74, .5], [97.5, 'G5', .66, .25], [97.75, 'F#5', .62, .25],
  [98, 'G5', .8, .75], [98.75, 'A5', .66, .25], [99, 'B5', .8, .5], [99.5, 'D6', .72, .25], [99.75, 'E6', .8, .25],
  // bar 26 · A13 (the belt holds C#5)
  [100, 'E6', .9, .5], [100.5, 'C#6', .7, .25], [100.75, 'B5', .66, .25], [101, 'A5', .76, .5], [101.5, 'G5', .66, .25], [101.75, 'E5', .62, .25],
  [102, 'F#5', .8, .5], [102.5, 'A5', .68, .25], [102.75, 'B5', .7, .25], [103, 'C#6', .82, .5], [103.5, 'E6', .9, .5],
  // the tutti: a sixth under the hook
  ...[['G4', .75], ['B4', .75], ['C#5', .5], ['D5', .75], ['F#5', .75], ['G5', .5],
      ['F#5', .5], ['D5', .5], ['C#5', .5], ['B4', .5], ['G4', .75], ['B4', .75], ['C#5', .5]]
    .reduce((acc, [n, d]) => { acc.out.push([r5(acc.b), n, .58, d]); acc.b += d; return acc; }, { b: 112, out: [] }).out,
  [120, 'D#6', .72, 4],
];

// ---- DRUMS ------------------------------------------------------------------------------------------
const D = { kick: [], snare: [], hat: [], hatOpen: [], ride: [], crash: [], tomHigh: [], tomHiMid: [], tomMid: [], tomLow: [], floorHigh: [] };
const push = (lane, b, v) => D[lane].push([r5(b), v3(v)]);
const groove = (b0, s = 1, { open = true, ride = false } = {}) => {
  for (const [o, v] of [[0, 1], [.75, .62], [2.5, .86], [3.25, .6]]) push('kick', b0 + o, v * s);
  push('snare', b0 + 1, .9 * s); push('snare', b0 + 3, .92 * s);
  for (const [o, v] of [[1.75, .26], [2.25, .22], [3.75, .3]]) push('snare', b0 + o, v * s);   // ghost notes
  if (ride) for (let k = 0; k < 8; k++) push('ride', b0 + k / 2, (k % 2 ? .36 : .48) * s);
  else for (let k = 0; k < 16; k++){
    if (open && k === 14) { push('hatOpen', b0 + 3.5, .6 * s); continue; }
    if (open && k === 15) continue;                              // the open hat breathes
    push('hat', b0 + k / 4, (k % 4 === 0 ? .52 : k % 2 ? .24 : .38) * s);
  }
};
// INTRO: the crash that lands the loop, a heartbeat, the hats tick in, the run into the groove
push('crash', 0, .8); push('kick', 0, .8);
for (const b0 of [8, 12]){ push('kick', b0, .6); push('kick', b0 + 2.5, .5); for (let k = 0; k < 8; k++) push('hat', b0 + k / 2, k % 2 ? .2 : .32); }
for (let k = 0; k < 6; k++) push('snare', 14 + k / 4, .32 + .08 * k);              // snare roll…
[['tomHigh', 15.5], ['tomMid', 15.75]].forEach(([l, b]) => push(l, b, .82));        // …down the toms
// GROOVE + HORNS (bars 5–12)
for (let n = 5; n <= 12; n++) groove(BAR(n));
push('crash', 16, 1); push('crash', 32, .9);
[['tomHigh', 30.5], ['tomHiMid', 30.75], ['tomMid', 31], ['tomLow', 31.25], ['floorHigh', 31.5]].forEach(([l, b], i) => push(l, b, .7 + .05 * i));   // the fill into the horns
// strip the bar-8 groove under that fill (the fill IS bar 8's last two beats)
for (const l of ['kick', 'snare', 'hat', 'hatOpen']) D[l] = D[l].filter(([b]) => !(b > 30.4 && b < 32));
push('kick', 31.75, .8);
// GRAND (13–16): the kit drops to the ride, softer
for (let n = 13; n <= 16; n++) groove(BAR(n), .7, { ride: true });
push('crash', 48, .8);
// HARP + MARIMBA (17–20): the hats back, a crash on the lift
for (let n = 17; n <= 20; n++) groove(BAR(n), .85);
push('crash', 64, .85);
// BRIDGE (21–24): half time on the ride, the snare on 3
for (let n = 21; n <= 24; n++){
  const b0 = BAR(n);
  push('kick', b0, .82); push('kick', b0 + 2.75, .5); push('snare', b0 + 2, .72);
  for (let k = 0; k < 8; k++) push('ride', b0 + k / 2, k % 2 ? .3 : .42);
}
push('crash', 80, .8);
for (let k = 0; k < 8; k++) push('snare', 94 + k / 4, .3 + .08 * k);                // the roll into the vibes
// VIBES (25–26)
groove(BAR(25)); groove(BAR(26)); push('crash', 96, .95);
// BREAK (27–28): stop-time with the slams, then the tom cascade under the forge's run
for (const [b, v] of [[104, 1], [105.5, .9], [106.5, .94], [108, 1]]){ push('kick', b, v); push('crash', b, v * .9); }
push('snare', 105.5, .7); push('snare', 106.5, .8);
for (let k = 0; k < 6; k++) push('hat', 107 + k / 4, .3);
const TOMS = ['tomHigh', 'tomHigh', 'tomHiMid', 'tomHiMid', 'tomMid', 'tomMid', 'tomLow', 'tomLow', 'floorHigh', 'floorHigh'];
TOMS.forEach((l, k) => push(l, 109.5 + k / 4, .62 + .04 * k));
push('kick', 110, .7); push('kick', 111, .8); push('snare', 111.5, .9); push('kick', 111.75, .85);
// TUTTI (29–30)
groove(BAR(29)); groove(BAR(30)); push('crash', 112, 1); push('crash', 116, .8);
// LANDING
push('kick', 120, 1); push('snare', 120, 1); push('crash', 120, 1);
for (const l of Object.keys(D)){
  const seen = new Set();
  D[l] = D[l].sort((a, b) => a[0] - b[0]).filter(([b]) => b < 121 && !seen.has(b) && seen.add(b));
  if (!D[l].length) delete D[l];
}

// ---- audio-only stage levels (the tutti stacks eleven machines) ---------------------------------------
const mix = {
  riff:      [[0, .7], [104, .9], [112, .55], [120, .8]],
  bass:      .78,
  dulcimer:  [[0, .5], [48, .78], [64, .5], [112, .4]],
  horns:     [[0, .85], [112, .72]],
  organ:     [[0, .72], [48, .4], [80, .6], [112, .42], [120, .55]],
  bowwheel:  [[0, .65], [80, .85], [112, .5]],
  strum:     [[0, .7], [80, .55], [112, .42]],
  marimba:   [[0, .7], [112, .45]],
  bells:     .6,
  turntable: [[0, .85], [112, .5]],
};

export default {
  label: 'Starship Groove', sub: 'an original space-funk finale · every machine on the deck',
  bpm: 60 * 7 / 3.8,                                   // ≈ 110.53: the 3.8 s breath = 7 beats; 121 + 7 = 32 bars
  scale: ['E', 'F#', 'G', 'A', 'B', 'C#', 'D', 'C', 'D#'],
  room: 'starship',
  melody,
  parts: { riff, bass, dulcimer, horns, organ, bowwheel, strum, marimba, bells, turntable },
  mix,
  director: {
    riff: 1.4, horns: 1.6, organ: 1.4, bowwheel: 1.8, dulcimer: 1.6, strum: 1.6,
    marimba: 1.2, bells: 1.8, turntable: 1.8, bass: .8, drums: 1.1,
    shots: { bass: { x: -5, up: 7.5, dist: 15 } },   // (keyed by the PLUGIN key) the bass bed from its wing side, over the Grand's case
    at: [
      [0, 'organ', 8],          // ignition: the light organ breathes Em9
      [8, 'bells', 8],          // the toll on Cmaj9♯11, B7
      [16, 'strings', 8],       // the groove drops: the string bass's octave pops
      [24, 'riff', 8],          // the forge's chicken scratch (+ the fill into the horns)
      [32, 'horns', 8],         // call and response
      [40, 'lead', 8],          // the belt's E6 and the ♯9 turnaround
      [48, 'dulcimer', 16],     // the Marble Grand's solo
      [64, 'strum', 8],         // the autoharp's down-up
      [72, 'marimba', 8],       // the 16th arpeggios
      [80, 'bowwheel', 8],      // the bridge melody, bowed
      [88, 'bells', 8],         // the bridge's second half: toll, organ + choir
      [96, 'turntable', 8],     // the vibes break
      [104, 'drums', 8],        // stop-time and the tom cascade
      [112, 'stage', 8],        // the TUTTI: every machine in frame for the hook's last statement
      // (the landing at 120 rings on the engine's seam wide: main holds 'stage' through the breath)
    ],
  },
  drums: D,
};

export const _finale = { sum, melodyBeats: sum(melody), HARP, HORN };
