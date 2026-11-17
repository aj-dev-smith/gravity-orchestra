/* CAMPFIRE — an original folk-pop instrumental (AJ / Orchestrion), written to prove the
   STRUMMED family: a singer-songwriter's acoustic guitar song with nobody singing — the
   belt marble IS the voice. The MARBLE AUTOHARP plays the guitar part (fingerpicked
   intro, then real down/up strum patterns), the BOW WHEEL is the cello that walks the
   bass line and then sings a counter-line, the MARBLE GRAND drops sparse piano fills
   into the tune's held notes, the singing bowls and tubular bells are the shimmer
   off the fire, and the drum machine keeps a soft heartbeat kick and a shaker hat.

   KEY: G major (G A B C D E F#) — the open-guitar key: every chord below is a real
   cowboy-chord shape (G 320003, Cadd9 x32033, Em7 022033, D xx0232, D/F# 2x0232, C
   x32010, Dsus4 xx0233), voiced on the autoharp exactly as a guitar's six strings would
   ring them. The G4 / D4 "drone" strings that Cadd9, Em7 and G share are what make the
   progression shimmer — they never stop sounding.
   4/4, bpm = 60·6/3.8 ≈ 94.74: an easy walking folk-pop tempo, eighths .317 s (the
   harp's honest strum-to-strum gap is .2 s — every strum here fits with room to spare).

   TEMPO / THE SEAM: the loop's fixed 3.8 s breath (ROLL_T + 1.2) is EXACTLY 6 beats.
   The melody is 98 beats; + 6 = 104 = 26 bars, ~65.9 s. The last bar that plays is a
   Cadd9 strummed once and left to RING through the breath, the tune hanging on its 9th
   (D5 — a suspended "…and"); the loop comes back in on G and the hook's own first note
   is that same D5. IV → I across the seam: the campfire "amen".

   FORM (beats · bars):
     INTRO   0–16   1–4   G | Cadd9 | Em7 | D. The autoharp FINGERPICKS alone (an
                          eighth-note Travis-ish pattern: bass, then the treble strings
                          rolling up and back — each pick is a one-note "strum", so the
                          marble's hand is visible picking every string). The belt
                          whistles THE HOOK: D5 · B4 D5 E5 | D5 · B4 G4 (sol-mi-sol-la-
                          sol-mi-do — a tune you can hum after one hearing). The bowls
                          breathe an open G–D fifth; the cello wakes on Em7's E3; the
                          piano's first fill answers the long A4 in bar 4.
     VERSE  16–48   5–12  G | D/F# | Em | C | G | D/F# | C | D. The strum pattern kicks
                          in: D · D U · U D U (beats 1, 2, 2&, 3&, 4, 4& — the hand
                          never stops: down on the beat, up on the "and"). The cello
                          walks the classic descending line G3 F#3 E3 C3 in whole notes.
                          The tune drops low and conversational (D4–D5). Piano fills sit
                          in the tune's holds (bar 8's long E4); shaker hat + a soft
                          kick on 1 and 3 from bar 9.
     CHORUS 48–80  13–20  C | G | D | Em | C | G | D | Dsus4–D. The hook returns a third
                          higher over IV (E5 · D5 E5 G5 | D5 · B4 G4) and climbs to A5 —
                          the tallest arc in the song. Full strums with accents, a bell
                          toll on each C, the cello leaves the bass for a guide-tone
                          counter-line (E4 D4 C4 B3 A3 · G3 B3 C4 E4 D4 G4 …) that
                          moves where the tune holds; the piano answers bars 14 / 18 /
                          20; the kit adds a soft backbeat and a pushed kick. Bar 20's
                          Dsus4 → D (G3 → F#3 in the cello) turns it round.
     BRIDGE 80–88  21–22  Em7 | Cadd9. Everything drops: the harp to two slow down-
                          strums a bar, no drums but the heartbeat kick. The CELLO's
                          moment — a solo phrase B3 D4 E4 D4 | G3 A3 B3 under the
                          tune's long G5; piano chords breathe underneath; bowls swell.
     TAG    88–104 23–26  C | D | Cadd9 (rings). The hook one last time with the A5
                          peak, the band back in full, a strummed push on the "and" of 4
                          into D, then ONE Cadd9 down-strum, the bells' G + D, the
                          piano's last chord and the cello's G3 all ringing through the
                          6-beat breath — the fire settling — back to the intro's G.

   WHO PLAYS (and what each machine honestly allows — PART_LIMITS in each solve.js):
     belt lead  D4–A5   the tune — one voice, one marble. Long notes = tall arcs (the
                        hook's held D5s and bar 18's A5), the conversational verse = skims.
     strum      E2–G4   the guitar: 16 strings (E2 F#2 G2 A2 B2 C3 D3 E3 G3 A3 B3 C4
                        D4 E4 F#4 G4 — limit 24), ≤ 6 notes a strum (limit 6), strums
                        ≥ .317 s apart (limit .2), all steel (a nylon '|n' id would be a
                        SECOND string per pitch — 16 more strings than the fan holds).
                        Felts: dur 0 = let ring until the chord changes, so the shared
                        G4/D4 strings ring straight through Cadd9 → Em7 → G.
     bowwheel   C3–G4   the cello: 11 strings (limit 12), strokes ≤ 2.6 s (limit 3.9),
                        repeated pitches ≥ .55 beat apart (its re-bow hop, ≥ .35 s).
     dulcimer   C3–A6   the Marble Grand: fills of 3–4 eighths, two soft bridge
                        chords and the last chord (≤ 5 notes at once; limit 8), 18
                        strings (limit 20); same-pitch repeats ≥ .5 beat (limit .21 s).
     bowls      D4–D5   three bowls only (G4 D5 D4 — limit 8): open fifths, consonant
                        over every chord in the song (G/D are the 5th/9th of C, the
                        root/5th of G, the 7th/3rd-free sus over D, the 3rd/7th of Em7).
     bells      G4, D5  four tolls — chord tones on C, Em7 and Cadd9 (a 4.4 s ring on
                        every path can't sour a change: G and D sit in all of them).
     drums      kick (soft: 1 & 3, a pushed "and of 2" in the chorus), hat (as a shaker:
                        8ths with the off-beats leaning), snare (a brushed-soft backbeat in
                        the chorus + tag), one quiet crash into the chorus.

   DYNAMICS: the intro is p, the verse mp (the strum leans .78 on the one, ghosts .34 on
   the ups), the chorus mf with accents on 1 and the "and" of 2, the bridge drops to pp,
   the tag back to mf, and the final ring is let go at mp. Velocity = dynamics; the
   machines' geometry never changes with it.

   MIX (audio-only, never > 1): the harp strums constantly, so it sits under the tune
   (.5, .44 in the chorus where it is fullest); the cello is a featured voice and stays
   above the strumming (.72 → .85 in the bridge); piano fills .7; bowls a halo (.5);
   bells .6 (they ring 4.4 s).

   DIRECTOR: the harp plays every bar, so its √-weight is held DOWN (.7) and the sparse
   voices are pulled up (cello 1.8, piano 2, bells 1.5, bowls 1.2). Scripted cuts follow
   the song: the autoharp's fingerpicking intro, the bowls' open fifth, the piano's first
   fill, the tune's entrance, the piano answering the long E4, the kit's heartbeat coming
   in, the cello's walking line, the bells on the
   chorus downbeat, the harp at full strum, the piano's chorus answer, the tune's climb,
   the cello's bridge solo, the hook's last statement — and the final Cadd9 rings on the
   engine's seam wide ('stage' through the breath), the whole fire in frame.

   ROOM: the cathedral nave by candlelight — of the rooms it reads WARMEST (amber pools
   from the pricket stands and coronas on the checker floor, the rose-window shafts
   overhead): the candles are the campfire. (The graveyard at dawn and the greybox at
   dusk were both tried — the graveyard's green fog and crosses read spooky, the grid cold.)

   iOS NOTE (§5): the sample path ignores `dur` and volume — the cello's strokes and the
   piano's damped notes ring their full renders there; every held voice is a chord tone
   of its bar AND of the next (common-tone voice-leading), so nothing curdles. */

// ---- helpers -----------------------------------------------------------------------
const r5 = x => +x.toFixed(5);
const v3 = x => +Math.min(1, x).toFixed(3);
const sum = line => line.reduce((s, [, d]) => s + d, 0);
const bar = n => (n - 1) * 4;                              // beat of bar n (1-based)
const sortHits = hs => hs.sort((a, b) => (Array.isArray(a) ? a[0] : a) - (Array.isArray(b) ? b[0] : b));

// ---- the chart (one chord per bar; 'ring' = bar 26, the breath) -----------------------
const CHART = [
  'G', 'Cadd9', 'Em7', 'D',                                  // INTRO   1–4
  'G', 'D/F#', 'Em', 'C', 'G', 'D/F#', 'C', 'D',             // VERSE   5–12
  'C', 'G', 'D', 'Em', 'C', 'G', 'D', 'Dsus4',               // CHORUS 13–20
  'Em7', 'Cadd9',                                            // BRIDGE 21–22
  'C', 'D', 'Cadd9',                                         // TAG    23–25 (+ 26, the breath)
];

// the autoharp = the guitar's six strings, low → high (real open-chord shapes)
const HARP = {
  G:       ['G2', 'B2', 'D3', 'G3', 'B3', 'G4'],             // 320003
  Cadd9:   ['C3', 'E3', 'G3', 'D4', 'G4'],                   // x32033
  Em7:     ['E2', 'B2', 'E3', 'G3', 'D4', 'G4'],             // 022033
  Em:      ['E2', 'B2', 'E3', 'G3', 'B3', 'E4'],             // 022000
  D:       ['D3', 'A3', 'D4', 'F#4'],                        // xx0232
  'D/F#':  ['F#2', 'A2', 'D3', 'A3', 'D4', 'F#4'],           // 2x0232
  C:       ['C3', 'E3', 'G3', 'C4', 'E4'],                   // x32010
  Dsus4:   ['D3', 'A3', 'D4', 'G4'],                         // xx0233
};

// ---- THE TUNE (belt) ---------------------------------------------------------------
const HOOK_LO = [['D5', 1.5], ['B4', .5], ['D5', 1], ['E5', 1],   ['D5', 1.5], ['B4', .5], ['G4', 2]];
const HOOK_HI = [['E5', 1.5], ['D5', .5], ['E5', 1], ['G5', 1]];          // the hook a third up, over IV
const melody = [
  // INTRO — the whistled hook
  ...HOOK_LO,
  ['B4', 1.5], ['A4', .5], ['B4', 1], ['D5', 1],
  ['A4', 2], ['F#4', 1], ['A4', 1],
  // VERSE — low and conversational
  ['B4', 1], ['B4', .5], ['A4', .5], ['G4', 1], ['A4', 1],
  ['B4', 1.5], ['A4', .5], ['F#4', 2],
  ['G4', 1], ['G4', .5], ['F#4', .5], ['E4', 1], ['G4', 1],
  ['E4', 3], ['D4', 1],
  ['B4', 1], ['B4', .5], ['A4', .5], ['G4', 1], ['D5', 1],
  ['D5', 1.5], ['C5', .5], ['B4', 1], ['A4', 1],
  ['E4', 1], ['G4', 1], ['C5', 1], ['B4', .5], ['A4', .5],
  ['A4', 2], ['B4', .5], ['C5', .5], ['D5', 1],
  // CHORUS — the hook up a third, the climb to A5
  ...HOOK_HI, ['D5', 1.5], ['B4', .5], ['G4', 2],
  ['A4', 1], ['B4', 1], ['D5', 1], ['F#5', 1],
  ['E5', 2], ['D5', 1], ['B4', 1],
  ...HOOK_HI, ['A5', 1.5], ['G5', .5], ['D5', 2],
  ['F#5', 1.5], ['E5', .5], ['D5', 1], ['E5', 1],
  ['D5', 2], ['E5', 1], ['F#5', 1],
  // BRIDGE — long notes, the cello moves underneath
  ['G5', 3], ['F#5', .5], ['E5', .5],
  ['D5', 3], ['B4', .5], ['D5', .5],
  // TAG — the hook's last statement, hanging on the 9th
  ...HOOK_HI,
  ['A5', 1.5], ['G5', .5], ['F#5', 1], ['E5', 1],
  ['D5', 2],                                                  // + the 6-beat breath: it rings over Cadd9
];

// ---- STRUM (the autoharp) -------------------------------------------------------------
// one strum = every note of the shape at one beat (the harp's sweep spreads them 8–26 ms)
const strum = [];
const hitChord = (b, ch, v, d = 0) => HARP[ch].forEach(n => strum.push([r5(b), n, v3(v), d]));
// patterns: [offset, vel] — down on the beat, up on the "and" (the solver's direction rule)
const FOLK  = [[0, .78], [1, .5], [1.5, .34], [2.5, .4], [3, .56], [3.5, .38]];   // D · D U · U D U
const DRIVE = [[0, .9], [1, .58], [1.5, .64], [2.5, .48], [3, .66], [3.5, .44]];  // accent on the "and" of 2
const strumBar = (n, pat, amp = 1, ch = CHART[n - 1]) => pat.forEach(([o, v]) => hitChord(bar(n) + o, ch, v * amp));

// INTRO: fingerpicked — one string per eighth (bass, then the treble rolling up and back)
const PICK = {                // the order the "thumb + fingers" pick the shape (indices into HARP[ch])
  G:     [0, 3, 4, 5, 2, 4, 3, 4],
  Cadd9: [0, 2, 3, 4, 1, 3, 2, 3],
  Em7:   [0, 3, 4, 5, 2, 4, 3, 4],
  D:     [0, 1, 2, 3, 0, 2, 1, 2],
};
for (let n = 1; n <= 4; n++){
  const ch = CHART[n - 1], shape = HARP[ch];
  // each pick RINGS a beat (the thumb's bass two) — its felt stays up. dur 0 would mean
  // "until the chord changes", and every one-note pick is a new "chord": it would choke the
  // last pick. The bar's LAST pick stops at the bar line (a guitarist's chord change lifts it —
  // B3 hanging over Cadd9's C3 bass was a semitone rub). Longer holds were tried (to the bar
  // line): every pass of the marble BRUSHES a ringing string, and four rings deep that turned
  // the picking to mush (+86 re-plucks a loop).
  PICK[ch].forEach((k, i) => strum.push([r5(bar(n) + i / 2), shape[k], v3((i === 0 ? .62 : i === 4 ? .48 : .36) * (n === 1 ? .9 : 1)), i === 0 ? 2 : i === 7 ? .5 : 1]));
}
// VERSE: the folk pattern, a little lift into the second half
for (let n = 5; n <= 12; n++) strumBar(n, FOLK, n < 9 ? .92 : 1);
// bar 12 pushes into the chorus: the last up-strum is the chorus's C, anticipated
const drop = pred => strum.splice(0, strum.length, ...strum.filter(e => !pred(e[0])));
drop(b => b === bar(12) + 3.5);
hitChord(bar(12) + 3.5, 'C', .66);
// CHORUS: drive, with the hand pushing each 2-bar phrase
for (let n = 13; n <= 20; n++) strumBar(n, DRIVE, n === 13 || n === 17 ? 1.05 : 1);
// bar 20: Dsus4 for 2 beats → D for 2 (the cello's G3 → F#3 is the same turn)
drop(b => b >= bar(20) + 2 && b < bar(21));
[[2.5, .48], [3, .66], [3.5, .5]].forEach(([o, v]) => hitChord(bar(20) + o, 'D', v));
// BRIDGE: two slow down-strums a bar, let ring
for (const n of [21, 22]) [[0, .6], [2, .42]].forEach(([o, v]) => hitChord(bar(n) + o, CHART[n - 1], v));
hitChord(bar(22) + 3.5, 'Cadd9', .36);                        // a single soft up-strum lifts into the tag
// TAG: drive again, a push on the "and" of 4 into D, then one Cadd9 left ringing
strumBar(23, DRIVE, 1.04);
drop(b => b === bar(23) + 3.5);
hitChord(bar(23) + 3.5, 'D', .7);                             // the push: D arrives an eighth early
[[1, .56], [1.5, .58], [2.5, .46], [3, .62], [3.5, .4]].forEach(([o, v]) => hitChord(bar(24) + o, 'D', v));
hitChord(bar(25), 'Cadd9', .74);                              // the last strum: rings through the breath
sortHits(strum);

// ---- BOW WHEEL (the cello) [beat, note, vel, beats] ------------------------------------
const STROKE = .12;                                            // a hair of air between strokes (re-bows are on other strings)
const cello = [];
const bow = (b, line, v0, v1 = v0) => {
  let t = b;
  line.forEach(([n, d], i) => {
    cello.push([r5(t), n, v3(v0 + (v1 - v0) * (line.length > 1 ? i / (line.length - 1) : 0)), r5(d - STROKE)]);
    t += d;
  });
};
bow(bar(3), [['E3', 4], ['D3', 4]], .36, .42);                 // wakes under Em7 / D
bow(bar(5), [['G3', 4], ['F#3', 4], ['E3', 4], ['C3', 4]], .5, .56);      // the walking line
bow(bar(9), [['G3', 4], ['F#3', 4], ['C3', 2], ['E3', 2], ['D3', 2], ['A3', 2]], .56, .66);
bow(bar(13), [['E4', 4], ['D4', 2], ['B3', 2], ['A3', 4], ['G3', 2], ['B3', 2],
              ['C4', 2], ['E4', 2], ['D4', 2], ['G4', 2], ['D4', 2], ['A3', 2], ['G3', 2.5], ['F#3', 1.5]], .62, .74);
bow(bar(21), [['B3', 1.5], ['D4', .5], ['E4', 1], ['D4', 1], ['G3', 2], ['A3', 1], ['B3', 1]], .62, .8);   // the solo
bow(bar(23), [['C4', 4], ['A3', 2], ['F#3', 2]], .66, .6);
cello.push([bar(25), 'G3', .5, 4.1]);                          // the common tone of Cadd9 → G, through the breath (2.6 s)
sortHits(cello);

// ---- MARBLE GRAND (piano fills) [beat, note, vel, beats] ------------------------------
const piano = [];
const fill = (b, notes, v0, v1 = v0, step = .5, d = 1) => notes.forEach((n, i) =>
  piano.push([r5(b + i * step), n, v3(v0 + (v1 - v0) * i / Math.max(1, notes.length - 1)), d]));
const chordP = (b, notes, v, d) => notes.forEach((n, i) => piano.push([r5(b), n, v3(v * (1 - .05 * i)), d]));
fill(bar(4) + .5, ['F#5', 'A5', 'D6'], .42, .5);                // bar 4: answers the long A4
fill(bar(8) + .5, ['G5', 'E5', 'C5', 'D5', 'E5'], .48, .38);    // bar 8: falling into the held E4
fill(bar(14) + 2, ['D6', 'B5', 'G5', 'A5'], .55, .48);          // bar 14: the tune holds G4
fill(bar(16) + 2.5, ['G5', 'B5', 'E6'], .44, .5);               // bar 16: Em's tail
fill(bar(18) + 2, ['G5', 'A5', 'B5', 'D6'], .52, .6);           // bar 18: the tune holds D5 after the A5 peak
fill(bar(20) + 2, ['A5', 'D6', 'F#6', 'A6'], .5, .62);          // bar 20: the turnaround sparkles
chordP(bar(21), ['E3', 'B3', 'D4', 'G4'], .34, 3.6);            // bridge: soft held chords
fill(bar(21) + 3, ['B5', 'A5'], .4, .36);                       //   and a two-note sigh under the long G5
chordP(bar(22), ['C3', 'G3', 'D4', 'E4'], .32, 3.6);
fill(bar(22) + 3, ['G5', 'A5'], .36, .42);
fill(bar(24) + 2.5, ['F#5', 'A5', 'D6'], .42, .5);             // tag: one more answer, landing on D6 — the 9th the last chord keeps
chordP(bar(25), ['C3', 'G3', 'E4', 'D5'], .46, 6);               // the last chord, held through the breath (damper ≤ 4.5 s)
piano.push([r5(bar(25) + .5), 'G5', .36, 5], [r5(bar(25) + 1), 'D6', .3, 5]);   // rolled up an octave
sortHits(piano);

// ---- SINGING BOWLS (the halo) [beat, note, vel, beats] ---------------------------------
const bowls = [
  [bar(2), 'G4', .4, 7], [bar(2) + 2, 'D5', .32, 6],           // the intro's open fifth, under Cadd9 → Em7
  //   (bar 2, not bar 1: the director's bowls shot at beat 6 sees both rims singing)
  [bar(13), 'G4', .44, 7], [bar(13) + 1, 'D5', .36, 6],        // chorus
  [bar(17), 'D4', .4, 7], [bar(17) + 1, 'G4', .34, 6],
  [bar(21), 'G4', .5, 7], [bar(21) + 2, 'D5', .42, 6],         // bridge swell
  [bar(25), 'G4', .42, 6], [bar(25), 'D4', .36, 6],            // the last ring (6 beats: it must breathe before beat 0's G4)
].map(([b, n, v, d]) => [b, n, v, Math.min(d, 7.5)]);
sortHits(bowls);

// ---- TUBULAR BELLS (tolls) ------------------------------------------------------------
const bells = [
  [bar(13), 'G4', .5], [bar(17), 'D5', .46],
  [bar(21), 'G4', .38],
  [bar(25), 'G4', .5], [bar(25), 'D5', .42],
];

// ---- DRUMS (light: heartbeat kick, shaker hat, a soft backbeat) ------------------------
const D = { kick: [], snare: [], hat: [], crash: [] };
const shaker = (n, v = 1) => { for (let k = 0; k < 8; k++) D.hat.push([r5(bar(n) + k / 2), v3((k % 2 ? .3 : .2) * v)]); };
for (let n = 3; n <= 4; n++) for (let k = 0; k < 8; k += 2) D.hat.push([r5(bar(n) + k / 2 + .5), .16]);   // the shaker wakes on the "ands"
for (let n = 5; n <= 12; n++){ shaker(n, n < 9 ? .9 : 1.05); if (n >= 9) D.kick.push([bar(n), .5], [bar(n) + 2, .42]); }
D.kick.push([bar(12) + 3.5, .48]);                             // the push into the chorus
D.crash.push([bar(13), .42]);
for (let n = 13; n <= 20; n++){
  shaker(n, 1.2);
  D.kick.push([bar(n), .62], [bar(n) + 1.5, .44], [bar(n) + 2, .54]);
  D.snare.push([bar(n) + 1, .34], [bar(n) + 3, n === 20 ? .46 : .36]);
}
for (const n of [21, 22]) D.kick.push([bar(n), .4], [bar(n) + 2, .3]);   // bridge: just the heartbeat
for (const n of [23, 24]){
  shaker(n, 1.2);
  D.kick.push([bar(n), .62], [bar(n) + 1.5, .44], [bar(n) + 2, .54]);
  D.snare.push([bar(n) + 1, .34], [bar(n) + 3, .38]);
}
D.kick.push([bar(23) + 3.5, .5]);                              // with the harp's push into D
D.crash.push([bar(23), .36]);
D.kick.push([bar(25), .5]); D.hat.push([bar(25), .22]);
for (const l of Object.keys(D)){
  const seen = new Set();
  D[l] = sortHits(D[l]).filter(e => { const b = Array.isArray(e) ? e[0] : e; return !seen.has(b) && seen.add(b); });
}

export default {
  label: 'Campfire', sub: 'original folk-pop · autoharp, cello wheel & marble grand',
  bpm: 60 * 6 / 3.8,                                   // ≈ 94.74: the 3.8 s breath = 6 beats; 98 + 6 = 26 bars
  scale: ['G', 'A', 'B', 'C', 'D', 'E', 'F#'],
  room: 'cathedral',
  melody,
  parts: { strum, bowwheel: cello, dulcimer: piano, bowls, bells },
  mix: {
    strum:    [[0, .5], [bar(13), .44], [bar(21), .52], [bar(23), .44]],
    bowwheel: [[0, .72], [bar(21), .85], [bar(23), .72]],
    dulcimer: .7,
    bowls:    .5,
    bells:    .6,
  },
  director: {
    strum: .7, bowwheel: 1.8, dulcimer: 2, bells: 1.5, bowls: 1.2, drums: .6,
    at: [
      [0, 'strum', 6],           // the autoharp fingerpicks alone
      [6, 'bowls', 5],           // the bowls' open fifth under the Cadd9 → Em7 roll
      [11, 'dulcimer', 5],       // the piano's first fill answers the long A4
      [16, 'lead', 11],          // the tune enters, low and close
      [27, 'dulcimer', 6],       // the fill falling into the held E4
      [32, 'drums', 6],          // the heartbeat kick + shaker come in
      [38, 'bowwheel', 9],       // the cello's walking line (F# · C E D A)
      [47, 'bells', 6],          // the chorus downbeat: the first toll
      [53, 'strum', 9],          // the harp at full strum
      [62, 'dulcimer', 10],       // the piano's answers (bar 16, bar 18)
      [72, 'lead', 8],           // the climb out of the chorus
      [80, 'bowwheel', 8],       // the cello's bridge solo
      [88, 'lead', 8],           // the hook, one last time
      // (the final Cadd9 rings on the engine's seam wide — 'stage' through the breath)
    ],
  },
  drums: D,
};

export const _campfire = { sum, melodyBeats: sum(melody), CHART, HARP };
