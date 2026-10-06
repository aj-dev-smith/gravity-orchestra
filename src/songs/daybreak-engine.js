/* ============================================================
   DAYBREAK ENGINE — an original, written for every machine in the room.

   The showcase piece: the melody belt, the marble drum machine and all
   seven instrument plugins (music box, singing bowls, marimba, string
   bass, tubular bells — and, added after the first draft, the TURNTABLE
   vibes and the RICOCHET glass sculpture), arranged so the director has a deliberate
   spotlight to cut to in every section, and so the loop seam is
   invisible (the piece ends on the dominant and falls back into its
   own first bar).

   KEY: D minor (natural minor, with the raised C# on the dominant A).
   112 bpm, 4/4, 32 bars = 128 beats (~69 s) — one loop is the whole piece.

   THE CHART (one chord per bar):

     A  intro      bars  1–4   beats   0–16   Dm  | Bb  | Gm  | A
        the machine wakes: music box alone, a bowl pad underneath,
        one soft bell toll, a kick heartbeat and a bass note so every
        machine stirs. The lead lobs 3+1 figures — tall, but saving its
        tallest arc for the climax. High in the chandelier the RICOCHET
        glass answers each bar a beat and a half late, an octave up — a
        quiet ECHO of the lead's long notes (the sculpture wakes too).
     B  ostinato   bars  5–8   beats  16–32   Dm  | Bb  | Gm  | A
        marimba ostinato + string bass enter. Lead moves in halves and
        quarters. Hi-hat teases in bar 7 (and the TURNTABLE vibes drop
        their first three soft notes — the record has been spinning since
        the count-in); a tom fill throws us into…
     C  groove     bars  9–16  beats  32–64   Dm  | Bb  | F   | C
                                              Dm  | Bb  | Gm  | A
        drums in, crash. The lead states the theme (dotted figures, an
        eighth-note skim up in bar 12). The TURNTABLE vibes TRADE with it:
        wherever the lead holds a long note (bars 10, 15) the vibes answer
        with a quick arpeggio, wherever the lead runs the vibes hold — a
        call-and-response, never on top of each other. They lay out under
        the bass walk-up (bar 12) and the marimba cascade (bar 16). Bar 16: the lead steps aside
        (short notes, low arcs) while the marimba throws a 16th-note cascade
        across its whole keyboard — its spotlight — and a tom fill launches…
     D  climax     bars 17–24  beats  64–96   Bb  | C   | Dm  | Dm
                                              Bb  | C   | A   | A
        tubular bells ring every big downbeat (VI → VII → i, the
        "rising" cadence), ride + crashes, bowls swell. Bars 19–20 are
        the money shot: the lead SKIMS a 16th-note run D5→D6 (doubled by
        the music box an octave up) and launches a whole-bar D6 arc — the
        tallest of the climax, with the bells holding their breath (the ONLY
        whole-bar lob in the piece). Bar 24: the bells peal through the A
        chord under the falling lead run and a tom cascade, landing on C#5
        (the leading tone). Above it all the RICOCHET sings a DESCANT in
        half notes (C6–A6, a third to a sixth over the lead),
        resting through the 16th skim and returning on the soaring D6 arc
        (A6 → F6 over it, the vibes walking a Dm arpeggio underneath); the
        vibes keep trading — answering the lead's held D6, C6 and E6.
     E  breakdown  bars 25–32  beats  96–128  Dm  | Bb  | Gm  | A   (×2)
        a big bell toll, then the drums thin to a half-time kick and
        vanish, the bass walks out on whole notes, the marimba thins to
        quarters and stops — leaving the intro texture (music box + bowls +
        the heartbeat kick) so beat 128 IS beat 0 — the vibes fade on four
        lone quarter-notes and park on their magnet, the glass echoes come
        back over the last four bars exactly as in the intro. The last bowls chord is
        held across the engine's loop seam (~3.8 s of roll-in) so the
        C#5 → D5 that opens the loop never hangs over silence.

   VOICING / RANGES (who lives where, so nobody steps on anybody):
     string bass   G1–F2   roots + fifths (7 strings: G1 A1 A#1 C2 D2 E2 F2)
     bowls         D3–F4   sustained pads (full chords only where the marimba
                           rests; low drones under it), common tones held
     marimba       E3–A4   eighth-note broken-chord ostinato, voiced A3–G4 (the
                           cascade runs E3–A4) — clear of the bowls' D3 floor
     lead belt     G4–F6   the tune (long notes = tall arcs, runs = flat skims)
     bells         D4–A5   climax 2-note chords + tolls (7 tubes)
     turntable     G4–A5   vibes counter-line, monophonic: it plays only in the
                           lead's holes (a trade, never a doubling — songs.test.js
                           fails any note on a lead onset with the lead's pitch
                           class, or on the exact pitch the lead holds), 8ths at most
                           (the record's pads must clear — turntable/solve.js)
     music box     G5–C7   the sparkle above everything
     ricochet      C#6–A6  glass descant + echoes, monophonic; ≤ A6 (the glass's
                           8.9× partial must stay under its sample rate's Nyquist).
                           Each note is its own plate and a long rest is carried
                           by silent relay mirrors (one per 2.2 s), so the part is
                           kept to ~24 notes → ~42 plates: the chandelier stays
                           a compact knot (ricochet/solve.js footFor / escalation)

   Every part below is generated from the chart by the helpers at the top;
   accents/ghosts are velocity (dynamics), never geometry.

   MIX: the plugin voices are loud and long next to the belt's pluck, and
   audio.js has no limiter — so each part is TRIMMED (MIX below) to sit
   under the lead (offline render: the lead is the top pitched voice in
   every section; climax clipping ~14% → ~2%). Spotlights (the marimba
   cascade, the bass walk-up) are trimmed less so they still pop.
   ============================================================ */

// inclusive-of-`from`, exclusive-of-`to` beat grid — for steady subdivisions
const every = (from, to, step) => {
  const out = [];
  for (let b = from; b < to - 1e-9; b += step) out.push(+b.toFixed(5));
  return out;
};
const r5 = x => +x.toFixed(5);

/* MIX trims (velocity × k) per plugin part — see the header. */
const MIX = { marimba: .38, bowls: .55, bass: .6, musicbox: .8, turntable: .62, ricochet: .55 };
const lvl = (hits, k) => hits.map(([b, n, v, ...d]) => [b, n, +Math.min(1, v * k).toFixed(3), ...d]);

/* ---- the chart: bar index (0-based) → chord name ---- */
const CHART = [
  'Dm', 'Bb', 'Gm', 'A',   'Dm', 'Bb', 'Gm', 'A',             // A intro, B ostinato
  'Dm', 'Bb', 'F',  'C',   'Dm', 'Bb', 'Gm', 'A',             // C groove
  'Bb', 'C',  'Dm', 'Dm',  'Bb', 'C',  'A',  'A',             // D climax
  'Dm', 'Bb', 'Gm', 'A',   'Dm', 'Bb', 'Gm', 'A',             // E breakdown
];
const bars = (from, to) => { const out = []; for (let i = from; i < to; i++) out.push([i * 4, CHART[i]]); return out; };

/* per-chord voicings, one table per instrument (each in its sweet range) */
const BASS = {            // [root, fifth] — 7 strings total
  Dm: ['D2', 'A1'], Bb: ['A#1', 'F2'], Gm: ['G1', 'D2'], A: ['A1', 'E2'],
  F: ['F2', 'C2'], C: ['C2', 'G1'],
};
const MARIMBA = {         // [low, mid, high] broken-chord tones — a fourth up from the floor:
  Dm: ['A3', 'D4', 'F4'], Bb: ['A#3', 'D4', 'F4'], Gm: ['G3', 'D4', 'G4'], A: ['A3', 'C#4', 'E4'],   // shorter ring,
  F: ['A3', 'C4', 'F4'], C: ['G3', 'C4', 'E4'],                                                    // D3 left to the bowls
};
const BOX = {             // four music-box tones, low → high
  Dm: ['A5', 'D6', 'F6', 'A6'], Bb: ['A#5', 'D6', 'F6', 'A#6'], Gm: ['A#5', 'D6', 'G6', 'A#6'],
  A: ['A5', 'C#6', 'E6', 'A6'], F: ['A5', 'C6', 'F6', 'A6'], C: ['G5', 'C6', 'E6', 'G6'],
};

/* ---- pattern helpers ---- */

/* marimba ostinato for one bar: low–mid–high–mid ×2 in eighths; the downbeat leans,
   the off-beats float. `lift` scales the whole bar (sections get louder). */
function marimbaBar(b0, chord, lift = 1){
  const [lo, mid, hi] = MARIMBA[chord];
  const seq = [lo, mid, hi, mid, lo, mid, hi, mid];
  const vel = [.72, .4, .58, .38, .6, .4, .55, .38];
  return seq.map((n, i) => [r5(b0 + i * .5), n, +(Math.min(1, vel[i] * lift)).toFixed(3)]);
}

/* string bass for one bar. 'walk' = the groove (root, push, fifth on the and-of-3
   — locked with the kick —, root);
   'enter' = the B-section figure; 'whole' = one long note. */
function bassBar(b0, chord, kind, v = 1){
  const [root, fifth] = BASS[chord];
  const k = x => +(Math.min(1, x * v)).toFixed(3);
  if (kind === 'whole') return [[b0, root, k(.9)]];
  if (kind === 'enter') return [[b0, root, k(.95)], [b0 + 2.5, root, k(.5)], [b0 + 3, fifth, k(.65)]];
  return [[b0, root, k(1)], [b0 + 1.5, root, k(.5)], [b0 + 2.5, fifth, k(.72)], [b0 + 3, root, k(.7)]];
}

/* music box: 'figure' = the twinkling eighth-note arpeggio (up, then turning back);
   'quarters' = a lighter four-note version; 'ping' = one high bell-tone per bar. */
function boxBar(b0, chord, kind, v = 1){
  const t = BOX[chord];
  const k = x => +(Math.min(1, x * v)).toFixed(3);
  if (kind === 'figure'){
    const idx = [0, 1, 2, 3, 2, 1, 2, 1], vel = [.78, .5, .6, .72, .55, .45, .55, .42];
    return idx.map((j, i) => [r5(b0 + i * .5), t[j], k(vel[i])]);
  }
  if (kind === 'quarters') return [[b0, t[0], k(.6)], [b0 + 1, t[2], k(.45)], [b0 + 2, t[3], k(.55)], [b0 + 3, t[1], k(.4)]];
  return [[b0, t[3], k(.75)], [b0 + 2.5, t[2], k(.52)]];
}

/* drums: one bar of the GROOVE, appended lane by lane into `D`.
   kick 1 + the and-of-3 (+ the and-of-2 on even bars), snare 2 & 4 with ghosts,
   hats in eighths (accented on the beat) or — in the climax — ride quarters with
   off-beat hats; an open hat breathes on the and-of-4 every other bar.
   hatFrom skips the hats before that beat (to clear the air for a spotlight). */
function grooveBar(D, b0, { even = false, climax = false, noHatTail = false, hatFrom = 0 } = {}){
  D.kick.push([b0, 1], [b0 + 2.5, .85]);
  if (even || climax) D.kick.push([b0 + 1.5, .6]);
  D.kick.sort((a, b) => a[0] - b[0]);
  D.snare.push([b0 + 1, .9], [b0 + 1.75, .22], [b0 + 2.75, .2], [b0 + 3, .95]);
  const end = noHatTail ? 3 : 4;
  for (const s of every(hatFrom, end, .5)){
    if (!climax && even && s === 3.5) continue;                     // the open hat takes this one
    if (climax && s % 1 === 0) continue;                            // the ride owns the beat
    D.hat.push([r5(b0 + s), s % 1 === 0 ? .95 : .65]);
  }
  if (climax) for (const s of every(0, 4, 1)) D.ride.push([b0 + s, s === 0 ? 1 : .8]);
  if (!climax && even && !noHatTail) D.hatOpen.push([b0 + 3.5, .85]);
}

/* a descending tom fill over the last two beats of a bar (b0 = its first beat), with
   a snare pickup — high → mid → floor reads as a wave across the machine */
function tomFill(D, b0, v = 1){
  const k = x => +(Math.min(1, x * v)).toFixed(3);
  D.tomHigh.push([b0, k(.65)], [b0 + .25, k(.72)]);
  D.tomMid.push([b0 + .5, k(.75)], [b0 + .75, k(.8)]);
  D.floorHigh.push([b0 + 1, k(.88)], [b0 + 1.25, k(.92)]);
  D.snare.push([b0 + 1.5, k(.8)], [b0 + 1.75, k(1)]);
}

/* ============================================================ */

/* ---- LEAD (the melody belt — chained, THE LOCK RULE: sums to 128) ---- */
const melody = [
  // A  intro — 3+1 lobs: the machine waking (tall, but the whole-bar arc is saved for bar 20)
  ['D5', 3], ['A4', 1],                                            // Dm
  ['F5', 3], ['E5', 1],                                            // Bb
  ['G5', 2], ['F5', 2],                                            // Gm
  ['E5', 3], ['C#5', 1],                                           // A
  // B  ostinato — halves and quarters
  ['A4', 1], ['D5', 1], ['F5', 2],                                 // Dm
  ['D5', 1], ['F5', 1], ['A#5', 2],                                // Bb
  ['A#5', 1], ['G5', 1], ['D5', 2],                                // Gm  (A#5 = the box's downbeat, not a semitone off it)
  ['E5', 2], ['C#5', 1], ['E5', 1],                                // A
  // C  groove — the theme
  ['D5', 1.5], ['E5', .5], ['F5', 1], ['A5', 1],                   // Dm
  ['A#5', 2], ['A5', .5], ['G5', .5], ['F5', 1],                   // Bb
  ['A5', 1.5], ['G5', .5], ['F5', 1], ['C5', 1],                   // F
  ['E5', 2], ['C5', .5], ['D5', .5], ['E5', .5], ['G5', .5],       // C   (eighth skim up)
  ['F5', 1.5], ['E5', .5], ['D5', 1], ['A5', 1],                   // Dm
  ['A#5', 1], ['D6', 1], ['C6', .5], ['A#5', .5], ['A5', 1],       // Bb
  ['G5', 2], ['A#5', 1], ['A5', .5], ['G5', .5],                   // Gm
  ['A5', 1.5], ['E5', .5], ['C#5', 1], ['E5', 1],                 // A   (stepping aside — the marimba's spotlight)
  // D  climax
  ['D6', 2], ['C6', .5], ['A#5', .5], ['A5', .5], ['A#5', .5],     // Bb
  ['C6', 1.5], ['A#5', .5], ['A5', .5], ['G5', .5], ['E5', 1],     // C
  ['D5', .25], ['E5', .25], ['F5', .25], ['G5', .25],              // Dm  — the 16th-note SKIM …
  ['A5', .25], ['A#5', .25], ['C6', .25], ['D6', .25],
  ['E6', .5], ['F6', 1.5],                                         //       … to the top
  ['D6', 4],                                                       // Dm  — the soaring arc: a whole bar in the air
  ['A#5', 1.5], ['A5', .5], ['G5', .5], ['F5', .5], ['D5', 1],     // Bb
  ['E5', 1], ['G5', 1], ['C6', 1], ['E6', 1],                      // C   — quarter-note climb
  ['E6', 2], ['C#6', 1], ['A5', 1],                                // A
  ['G5', .5], ['F5', .5], ['E5', .5], ['D5', .5], ['C#5', 2],      // A   — falling run onto the leading tone
  // E  breakdown — long arcs back down to the top of the loop
  ['D5', 2], ['A4', 2],                                            // Dm
  ['A#4', 2], ['D5', 2],                                           // Bb
  ['D5', 1], ['A#4', 1], ['G4', 2],                                // Gm
  ['A4', 2], ['C#5', 2],                                           // A
  ['F5', 3], ['E5', 1],                                            // Dm
  ['D5', 3], ['F5', 1],                                            // Bb
  ['A#4', 3], ['A4', 1],                                           // Gm
  ['A4', 2], ['C#5', 2],                                           // A   → (loop) D5
];

/* ---- DRUMS (the marble drum machine — absolute beats by lane) ---- */
const drums = { kick: [], snare: [], hat: [], hatOpen: [], crash: [], ride: [], tomHigh: [], tomMid: [], floorHigh: [] };
{
  const D = drums;
  // A (and its mirror, the last bar-group of E): a soft kick HEARTBEAT, one per bar —
  // the drum machine wakes with the room instead of sitting parked for 24 s
  for (const [s, v] of [[0, .35], [4, .3], [8, .35], [12, .45], [112, .3], [116, .3], [120, .35], [124, .45]]) D.kick.push([s, v]);
  // B: the hat teases in (bar 7, soft quarters, rising), then the entrance fill
  for (const [s, v] of [[24, .35], [25, .4], [26, .45], [27, .5], [28, .55], [28.5, .38], [29, .6], [29.5, .42]]) D.hat.push([s, v]);
  D.kick.push([28, .55]);
  tomFill(D, 30, .85);
  // C: groove bars 9–15, fill into the climax in bar 16
  D.crash.push([32, 1]);
  for (let bar = 8; bar < 15; bar++) grooveBar(D, bar * 4, { even: bar % 2 === 1 });
  grooveBar(D, 60, { noHatTail: true, hatFrom: 2 });              // no hats under the cascade's first half
  D.snare.pop(); D.snare.pop();                                  // bar 16's backbeat-4 makes room for the fill…
  D.snare.push([63, .95]);
  tomFill(D, 62);
  // D: the climax — ride + off-beat hats, crashes on every two-bar downbeat
  for (let bar = 16; bar < 23; bar++) grooveBar(D, bar * 4, { climax: true });
  D.crash.push([64, 1], [72, .9], [80, 1], [88, .9]);
  // bar 24: the big cascade — two descending passes, snare roll, kick stabs
  D.kick.push([92, 1], [93.5, .7]);
  D.tomHigh.push([92, .7], [92.25, .75], [93.5, .8]);
  D.tomMid.push([92.5, .78], [92.75, .82], [93.75, .85]);
  D.floorHigh.push([93, .9], [93.25, .92], [94, 1]);
  D.snare.push([94.5, .6], [94.75, .7], [95, .8], [95.25, .85], [95.5, .92], [95.75, 1]);
  D.hat.push([92.5, .3], [93, .35]);
  // E: breakdown — crash + kick on the toll, then a half-time kick and fading hats
  D.crash.push([96, 1]);
  for (const [s, v] of [[96, 1], [100, .7], [104, .55], [108, .4]]) D.kick.push([s, v]);
  for (const s of every(97, 111, 1)) D.hat.push([s, +(.36 - (s - 97) * .016).toFixed(3)]);
  for (const lane of Object.keys(D)) D[lane].sort((a, b) => a[0] - b[0]);
}

/* ---- INSTRUMENT PLUGINS (song.parts — [beat, note, vel?, durBeats?]) ---- */

// MUSIC BOX — alone in the intro, quarters under the ostinato, pings in the groove,
// a run doubling the lead's skim in the climax, and the full figure again to close
const musicbox = lvl([
  ...bars(0, 4).flatMap(([b, c]) => boxBar(b, c, 'figure', .85)),
  ...bars(4, 8).flatMap(([b, c]) => boxBar(b, c, 'quarters', .85)),
  ...bars(8, 16).flatMap(([b, c]) => boxBar(b, c, 'ping')),
  ...bars(16, 18).flatMap(([b, c]) => boxBar(b, c, 'ping', 1.15)),
  // bar 19: doubling the lead's 16th skim an octave up (D6 → C7) — kept UNDER the
  // lead, a shimmer on its run rather than a rival for it (or for the camera)
  ...['D6', 'E6', 'F6', 'G6', 'A6', 'A#6', 'C7'].map((n, i) => [r5(72 + i * .25), n, +(.3 + i * .035).toFixed(3)]),
  [74, 'D6', .7], [74, 'A6', .8],
  ...bars(20, 24).flatMap(([b, c]) => boxBar(b, c, 'ping', 1.15)),
  ...bars(24, 28).flatMap(([b, c]) => boxBar(b, c, 'quarters', .8)),
  ...bars(28, 32).flatMap(([b, c]) => boxBar(b, c, 'figure')),
  [127.5, 'A6', .45],                                              // a high A over the seam: its ring carries the hole
], MIX.musicbox);

// SINGING BOWLS — the pad. 8 bowls (D3 G3 A3 A#3 C#4 D4 E4 F4); common tones ring on
// across the bar line (F4 through Dm→Bb, A#3 + D4 through Bb→Gm). [beat, note, vel, beats]
// `seam` holds the closing A chord (A3 + E4) 9 beats (4.8 s, under the 5 s cap) — across
// the engine's ~3.8 s loop seam, so the leading tone never hangs over silence.
const padCycle = (b0, v, { seam = false } = {}) => [
  [b0,      'D3', .7 * v, 4], [b0,      'A3', .55 * v, 4], [b0,      'F4', .5 * v, 8],    // Dm
  [b0 + 4,  'A#3', .55 * v, 8], [b0 + 4,  'D4', .5 * v, 8],                                 // Bb (F4 rings on)
  [b0 + 8,  'G3', .6 * v, 4],                                                               // Gm (A#3, D4 ring on)
  [b0 + 12, 'A3', .6 * v, seam ? 9 : 4], [b0 + 12, 'C#4', .5 * v, 4], [b0 + 12, 'E4', .5 * v, seam ? 9 : 4],   // A
];
const bowls = lvl([
  ...padCycle(0, 1),                                               // A — the pad under the music box
  // B — low drones only: the marimba OWNS bar 5 (a pad doubling the ostinato note for
  // note would smear its entrance)
  [16, 'D3', .8, 8], [24, 'G3', .8, 4], [28, 'A3', .8, 4],
  // C — low drones, two bars at a time
  [32, 'D3', .5, 8], [40, 'A3', .42, 4], [44, 'G3', .42, 4], [48, 'D3', .5, 8], [56, 'G3', .5, 4], [60, 'A3', .5, 4], [60, 'E4', .4, 4],
  // D — the swell: full chords with the bells (Bb and C a bar each, Dm and A held two)
  [64, 'A#3', .75, 4], [64, 'D4', .65, 4], [64, 'F4', .6, 4],
  [68, 'G3', .7, 4], [68, 'E4', .6, 4],
  [72, 'D3', .85, 8], [72, 'A3', .7, 8], [72, 'F4', .6, 8],
  [80, 'A#3', .75, 4], [80, 'D4', .65, 4], [80, 'F4', .6, 4],
  [84, 'G3', .7, 4], [84, 'E4', .6, 4],
  [88, 'A3', .8, 8], [88, 'C#4', .65, 8], [88, 'E4', .65, 8],
  ...padCycle(96, .85),                                            // E — the pad returns…
  ...padCycle(112, 1, { seam: true }),                             // …and becomes the intro again
], MIX.bowls);

// MARIMBA — enters with the bass at bar 5, ostinato through the climax, a full-keyboard
// cascade in bar 16 (its spotlight — trimmed less, so it pops), thins to quarters in the
// breakdown and fades out under the last bars
// (it lands E3 → A3, not A3 → E3: the robot marimbist can't hop a mallet from the sharp
// row (C#4) to the natural row between two 16ths — and A3 → the next bar's A#3 is a
// chromatic step into the climax)
const cascade = ['E3', 'F3', 'G3', 'A3', 'A#3', 'C#4', 'D4', 'E4', 'F4', 'G4', 'A4', 'G4', 'E4', 'C#4', 'E3', 'A3'];
const marimba = [
  ...lvl([
    ...bars(4, 8).flatMap(([b, c]) => marimbaBar(b, c, .85)),
    ...bars(8, 15).flatMap(([b, c]) => marimbaBar(b, c, 1)),
    ...bars(16, 24).flatMap(([b, c]) => marimbaBar(b, c, 1.2)),
  ], MIX.marimba),
  ...lvl(cascade.map((n, i) => [r5(60 + i * .25), n, i < 11 ? .5 + i * .05 : 1 - (i - 10) * .08]), .7),
  ...bars(24, 30).flatMap(([b, c], i) => {                        // breakdown: quarters, fading to a whisper
    const [lo, mid, hi] = MARIMBA[c], v = .34 - i * .028;
    return [[b, lo, +v.toFixed(3)], [b + 1, mid, +(v * .7).toFixed(3)], [b + 2, hi, +(v * .8).toFixed(3)], [b + 3, mid, +(v * .6).toFixed(3)]];
  }),
  // …and the last two bars: a whispered D-minor ROLL under the outro (how a marimba holds)
  [120, MARIMBA.Dm[0], .2, 6], [120, MARIMBA.Dm[2], .18, 6],
];

// STRING BASS — wakes with the room (a low D under the intro), enters for real at bar 5,
// walks the groove, takes a walk-up spotlight into bar 13, whole notes out
const bass = [
  ...lvl([
    [0, 'D2', .85], [12, 'A1', .8],                                // waking: a low pulse under the box
    ...bars(4, 8).flatMap(([b, c]) => bassBar(b, c, 'enter')),
    ...bars(8, 11).flatMap(([b, c]) => bassBar(b, c, 'walk')),
    ...bars(12, 23).flatMap(([b, c]) => bassBar(b, c, 'walk', b >= 64 ? 1.1 : 1)),
    [92, 'A1', 1], [93.5, 'E2', .8], [94.5, 'A1', .85],            // bar 24: stabs with the cascade
    ...bars(24, 28).flatMap(([b, c], i) => bassBar(b, c, 'whole', 1 - i * .14)),
    [112, 'D2', .85], [124, 'A1', .8],                             // the waking pulse again, into the seam
  ], MIX.bass),
  // bar 12 (C → Dm): the bass's spotlight — a walk-up onto the D2 of bar 13
  ...lvl([[44, 'C2', 1], [45.5, 'G1', .7], [46, 'A1', .8], [47, 'A#1', .85], [47.5, 'C2', .9]], .78),
].sort((a, b) => a[0] - b[0]);

// TUBULAR BELLS — a tube rings ~4 s, so every chord is two notes (root + one) and only
// tones that survive the NEXT chord: nothing rings a semitone into the bar after.
// 7 tubes: D4 A4 A#4 C5 D5 E5 A5.
const bells = [
  [0, 'D4', .4],                                                    // the machine wakes
  [8, 'A4', .3],                                                    // …a second, softer toll
  [32, 'D4', .55], [32, 'A4', .4],                                  // the groove's crash
  [48, 'D5', .4],
  [64, 'A#4', .6], [64, 'D5', .45],                                 // Bb
  [68, 'C5', .6], [68, 'E5', .35],                                  // C
  [72, 'D4', .65], [72, 'A4', .45],                                 // Dm — the arrival
  [80, 'A#4', .6], [80, 'D5', .45],                                 // Bb
  [84, 'E5', .55], [84, 'A4', .35],                                 // C   (E + A: both live on in the A bars)
  [88, 'A4', .6], [88, 'E5', .45],                                  // A
  // bar 24: the peal — chord tones of A only, under the lead's falling run onto C#5
  [92, 'A5', .5], [92.5, 'E5', .42], [93, 'A4', .42], [93.5, 'E5', .36], [94, 'A4', .58],
  [96, 'D4', .7], [96, 'D5', .45],                                  // the breakdown toll
];

// TURNTABLE (vibes) — the lead's trading partner. Chord tones only, in the lead's holes:
// arpeggio answers under its held notes, single long tones under its runs.
const turntable = lvl([
  [28.5, 'C#5', .35], [29.5, 'A4', .4], [31.5, 'C#5', .45],         // B, bar 8: the first soft notes — off the
                                                                   //   lead's onsets, a third/sixth under its E5s
  // C — the groove
  [32, 'A4', .65], [35.5, 'D5', .4],                               // Dm   (lead runs → hold)
  [36.5, 'D5', .5], [37, 'F5', .55], [37.5, 'D5', .45], [39.5, 'A#4', .4],   // Bb (lead holds A#5 → answer)
  [40, 'C5', .55], [42.5, 'A4', .4], [43.5, 'A4', .35],            // F
  [44, 'G4', .4],                                                  // C    (the bass's walk-up: lay out)
  [48, 'A4', .6], [50.5, 'F5', .45], [51.5, 'D5', .4],             // Dm
  [52, 'D5', .55], [54, 'F5', .5],                                 // Bb
  [56.5, 'D5', .5], [57, 'A#4', .55], [57.5, 'D5', .6], [59, 'D5', .45],     // Gm (lead holds G5 → answer, under it)
  // (bar 16: the marimba's cascade — lay out)
  // D — the climax: answer every held lead note
  [64.5, 'F5', .6], [65, 'D5', .5], [65.5, 'A#4', .5],             // Bb   under the held D6
  [68.5, 'G5', .55], [69, 'E5', .5],                               // C    under the held C6
  [76, 'A4', .6], [77, 'F5', .55], [78, 'A5', .6], [79, 'F5', .5], // Dm   walking under the soaring D6 arc
  [80.5, 'D5', .5], [81, 'F5', .5],                                // Bb
  [88.5, 'C#5', .55], [89, 'E5', .55], [89.5, 'A5', .6],           // A    under the held E6
  // E — the breakdown: four lone quarters stepping down under the lead's long notes (chord
  // tones the lead ISN'T holding), then the magnet holds it across the seam
  [96, 'F5', .5], [100, 'D5', .4], [104, 'A#4', .35], [108, 'E5', .3],
], MIX.turntable);

// RICOCHET (glass) — an ECHO of the lead's long notes in the intro (an octave up, a beat
// and a half late), a DESCANT over the climax, and the intro's echoes again at the end
// (so the seam is invisible here too). Velocity stays low in the echoes: it's the room's
// reverb made visible, not a second tune.
const echo = b0 => [[b0 + 1.5, 'D6', .38], [b0 + 5.5, 'F6', .36], [b0 + 9.5, 'D6', .34], [b0 + 13.5, 'E6', .32], [b0 + 15.5, 'C#6', .3]];
const ricochet = lvl([
  ...echo(0),
  // the descant (C6–A6) in HALF notes — a classic descant, and a sparser knot (every
  // note is a plate: halves keep the chandelier compact and quick to solve)
  [64, 'F6', .65], [66, 'D6', .5],                                 // Bb
  [68, 'G6', .65], [70, 'E6', .5],                                 // C
  // (the 16th skim: the glass rests — the belt's money shot)
  [76, 'A6', .75], [78, 'F6', .6],                                 // Dm   over the soaring D6 arc
  [80, 'F6', .6], [82, 'D6', .5],                                  // Bb
  [84, 'C6', .55], [86, 'G6', .6],                                 // C    (a sixth over the lead's climb, never on its notes)
  [88, 'A6', .7], [90, 'E6', .55],                                 // A
  [92, 'A6', .6], [94, 'E6', .5],                                  // A    (over the peal)
  ...echo(112),
], MIX.ricochet);

export default {
  label: 'Daybreak Engine', sub: 'an original · every machine in the room', bpm: 112,
  scale: ['D', 'E', 'F', 'G', 'A', 'A#', 'C', 'C#'],
  melody,
  drums,
  parts: { musicbox, bowls, marimba, bass, bells, turntable, ricochet },
  // the director's per-song pull (main.js dirWeight): the glass plays few, soft, mix-trimmed
  // notes — its hit density alone would never earn the chandelier a shot
  director: { ricochet: 2.6, turntable: 1.3 },
};
