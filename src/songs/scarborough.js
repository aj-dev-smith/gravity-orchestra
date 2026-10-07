/* SCARBOROUGH FAIR — the traditional English ballad (the riddle song, "The Elfin
   Knight" family; the tune as it was collected in the 19th–20th c.). Public domain.
   This is the TUNE only — not Simon & Garfunkel's arrangement, and none of their
   "Canticle" countermelody: every counter-line here is original, written for the
   machines. A gentle candlelit setting for tonight's new machines.

   KEY: D DORIAN (D E F G A B C — the raised 6th, B natural, is the mode's colour; the
   tune's two B's sit on a G MAJOR chord, the Dorian IV, on purpose). 3/4, a bar = 3
   beats. The tune is the common folk-book version (Ddor):
       D2 D | A2 A | E>F E | D3 |        Are you going to Scarborough Fair?
       A2 c | d2 c | A B G | A3 |        Parsley, sage, rosemary and thyme
       d2 d | c2 A | A G F | E D C |     Remember me to one who lives there
       D2 A | G2 F | E D C | D3 ||       She once was a true love of mine

   HARMONY (one chord per bar, modal — no leading tone anywhere, the ♭VII C does the
   cadencing):  Dm Dm C Dm | F Dm G Am | Dm Am F C | Dm G C Dm.

   TEMPO / THE SEAM: bpm = 60·6/3.8 ≈ 94.7, so the loop's fixed 3.8 s breath (ROLL_T +
   1.2) is EXACTLY 6 beats = 2 bars of 3/4. The last verse ends on D (bar 16, "mine"),
   the drone, the choir, a flue D3 and two bells RING through those two bars (the
   harp's last down-strum decays under them), and the
   loop comes back in on the intro's Dm downbeat — the vamp the song ended on. Melody
   108 beats + 6 = 114 = 38 bars, ~72.2 s.

   FORM (beats):
     INTRO    0–12   the AUTOHARP alone vamps Dm | C | Dm | C (down on the beat, up on
                     the "and"), a church bell tolls D far off, the BOW WHEEL's drone
                     (D3 + A3, the hurdy-gurdy's open fifth) wakes under it; the belt
                     marble walks a slow falling tetrachord A G F E (tall 1.9 s arcs)
                     that drops onto the tune's first D.
     VERSE 1 12–60   the tune on the belt; the harp strums the bars lightly; the
                     drone holds; the MUSIC BOX answers each long note (Fair · thyme ·
                     mine) with a glint an octave up.
     VERSE 2 60–108  the LIGHT ORGAN's CHOIR enters as a soft pad (one chord a bar,
                     common tones TIED, never re-sounded); the bow wheel leaves the
                     open fifth and bows an original COUNTER-LINE in the tenor —
                     A · G F · A · B C D (climbing under "Remember me", the Dorian B on
                     the G chord) · C A G · F G E · F — over the D3 drone; the harp
                     fills in its up-strums; bells mark the verse and "Remember me";
                     the final D is a held choir chord + a flue-pipe D3, two bells
                     (D4, A4) and the drone, ringing into the breath.

   DYNAMICS: verse 1 p–mp; verse 2 swells to mf at "Remember me to one who lives
   there" (bars 9–12: the harp's down-strums, the counter-line's climb, the choir) and
   falls back to p for "She once was a true love of mine".

   WHO PLAYS:
     belt lead   the tune (C4–D5), alone — one voice, one marble
     strum       the AUTOHARP: every bar's chord, whole-fan strums, 15 strings
                 (Dm D3 A3 D4 F4 A4 · C C3 G3 C4 E4 G4 · F F3 A3 C4 F4 A4 ·
                 G G2 D3 G3 B3 D4 G4 · Am A2 E3 A3 C4 E4 A4); ≤ 6 notes a strum,
                 strums ≥ .32 s apart (its limit is .2 s)
     bowwheel    the drone (D3, A3) in 2-bar bow strokes (3.45 s — the wheel's limit
                 is 3.9), then the counter-line; 8 strings
     organ       the choir pad, verse 2 only ('|choir' timbre) + a flue D3 at the end
     musicbox    the glints (D5–F6, 7 tines)
     bells       six tolls: D tonic / A fifth only, so a 4.4 s ring can't sour a chord
   No drums: it is a ballad by candlelight.

   ROOM: the cathedral — the organ loft is its gallery, the candle coronas are the
   candlelight. DIRECTOR: scripted on the story — the harp's intro, the tune's
   entrance, the choir's entrance, the counter-line's climb, the bell on "Remember
   me", the wide last line — and √-weights so the sparse bow wheel / organ / bells win
   their moments over the harp's constant strumming (director-audit: strum 25 ·
   bowwheel 16 · organ 12 · lead 11 · musicbox 10 · belt 9 · stage 9 · bells 7 %).
   The bow wheel's shot is pulled back past its gantry posts so the wheel and the
   bowed strings read under the rose window.

   iOS NOTE (§5): the sample path ignores `dur` — the bow wheel's and organ's held
   notes ring their full renders there; both are chord/drone tones (A, D, F, G, C)
   that never sit a semitone from the next chord's notes for longer than a passing
   bar, so nothing curdles. */

// ---- helpers -------------------------------------------------------------------
const r5 = x => +x.toFixed(5);
const sum = line => line.reduce((s, [, d]) => s + d, 0);
const BAR = 3;
const INTRO = 0, V1 = 12, V2 = 60, END = 108;       // section starts (beats)
const bar = (verse, n) => verse + (n - 1) * BAR;     // beat of bar n (1-based) of a verse

// ---- the tune ------------------------------------------------------------------
const VERSE = [
  ['D4', 2], ['D4', 1], ['A4', 2], ['A4', 1], ['E4', 1.5], ['F4', .5], ['E4', 1], ['D4', 3],
  ['A4', 2], ['C5', 1], ['D5', 2], ['C5', 1], ['A4', 1], ['B4', 1], ['G4', 1], ['A4', 3],
  ['D5', 2], ['D5', 1], ['C5', 2], ['A4', 1], ['A4', 1], ['G4', 1], ['F4', 1], ['E4', 1], ['D4', 1], ['C4', 1],
  ['D4', 2], ['A4', 1], ['G4', 2], ['F4', 1], ['E4', 1], ['D4', 1], ['C4', 1], ['D4', 3],
];
const INTRO_WALK = [['A4', 3], ['G4', 3], ['F4', 3], ['E4', 3]];   // the falling tetrachord onto D
const melody = [...INTRO_WALK, ...VERSE, ...VERSE];

// ---- harmony -------------------------------------------------------------------
const CHORDS = ['Dm','Dm','C','Dm', 'F','Dm','G','Am', 'Dm','Am','F','C', 'Dm','G','C','Dm'];
const INTRO_CHORDS = ['Dm','C','Dm','C'];
// the autoharp's voicings: one string per pitch, ≤ 6 a strum
const HARP = {
  Dm: ['D3','A3','D4','F4','A4'],
  C:  ['C3','G3','C4','E4','G4'],
  F:  ['F3','A3','C4','F4','A4'],
  G:  ['G2','D3','G3','B3','D4','G4'],
  Am: ['A2','E3','A3','C4','E4','A4'],
};
// the choir's close voicings (tenor/alto, under the tune)
const CHOIR = {
  Dm: ['A3','D4','F4'],
  C:  ['G3','C4','E4'],
  F:  ['A3','C4','F4'],
  G:  ['G3','B3','D4'],
  Am: ['A3','C4','E4'],
};

// ---- strum: whole-fan strums, down on the beat / up on the "and" ------------------
// pattern = [[beat-in-bar, velocity], …]; `amp` scales a bar's dynamics
const LIGHT = [[0, .72], [1, .44], [2, .46], [2.5, .3]];
const FULL  = [[0, .86], [1, .52], [1.5, .36], [2, .56], [2.5, .4]];
const strumBar = (at, chord, pat, amp = 1) =>
  pat.flatMap(([b, v]) => HARP[chord].map(n => [r5(at + b), n, +Math.min(1, v * amp).toFixed(3)]));
// verse 2's arc: mp → mf at "Remember me" (bars 9–12) → p for the last line
const V2_AMP = [.95, .95, .95, .95, 1, 1, 1.05, 1.08, 1.15, 1.15, 1.12, 1.05, .92, .88, .84, 1];
const strum = [
  ...INTRO_CHORDS.flatMap((c, i) => strumBar(INTRO + i * BAR, c, LIGHT, i ? .95 : 1.05)),
  ...CHORDS.flatMap((c, i) => strumBar(bar(V1, i + 1), c, LIGHT, .9)),
  ...CHORDS.slice(0, 15).flatMap((c, i) => strumBar(bar(V2, i + 1), c, FULL, V2_AMP[i])),
  // the last bar: one slow down-strum, left to ring through the breath
  ...HARP.Dm.map(n => [bar(V2, 16), n, .62]),
];

// ---- bow wheel: the drone, then the counter-line ---------------------------------
const STROKE = .55;                                  // beats between strokes: the marble's re-bow hop (.35 s ≥ the
                                                     // machine's T_PRESS + F_MIN = .32 s, so no stroke is clipped short)
const drone = [];
for (let b = 0; b < 102; b += 6) drone.push([b, 'D3', b < V1 ? .34 : b < V2 ? .4 : .44, 6 - STROKE]);
drone.push([102, 'D3', .4, 3 - STROKE], [105, 'D3', .42, 6.1]);   // the last stroke rings into the breath
for (let b = 0; b < V2; b += 6) drone.push([b, 'A3', b < V1 ? .28 : .34, 6 - STROKE]);
// original tenor counter-line, a chord tone each bar (see header), crescendo to bar 9
const COUNTER = [
  ['A3', 6], ['G3', 3], ['F3', 3], ['A3', 6], ['B3', 3], ['C4', 3],
  ['D4', 3], ['C4', 3], ['A3', 3], ['G3', 3], ['F3', 3], ['G3', 3], ['E3', 3], ['F3', 6.1],
];
const CV = [.5, .5, .52, .58, .66, .72, .8, .76, .7, .64, .56, .52, .48, .5];
const counter = [];
{ let b = V2; COUNTER.forEach(([n, d], i) => { counter.push([b, n, CV[i], i === COUNTER.length - 1 ? d : d - STROKE]); b += d; }); }
const bowwheel = [...drone, ...counter].sort((a, b) => a[0] - b[0]);

// ---- organ: the choir pad in verse 2, common tones TIED across bars --------------
const organ = [];
{
  const open = new Map();                            // pitch → its sounding event
  CHORDS.forEach((c, i) => {
    const at = bar(V2, i + 1), last = i === CHORDS.length - 1;
    const v = +(.42 + .14 * Math.max(0, V2_AMP[i] - .9) / .25).toFixed(3);
    for (const [n, e] of open){                      // a tone that leaves the chord stops at the bar line
      if (!CHOIR[c].includes(n) || last || at + BAR - e[0] > 12){ e[3] = r5(at - e[0] - .15); open.delete(n); }
    }
    for (const n of CHOIR[c]){
      if (open.has(n)) continue;                     // tied: still sounding from the bar before
      const e = [at, n + '|choir', v, 0];
      organ.push(e); if (!last) open.set(n, e);
    }
    if (!last) for (const n of CHOIR[c]) open.get(n)[3] = r5(at + BAR - open.get(n)[0] - .1);
    else for (const e of organ.filter(e => e[0] === at)) e[3] = 9;   // the last chord rings into the breath
  });
  organ.push([bar(V2, 16), 'D3', .5, 9]);            // a flue-pipe D under the final chord
  organ.sort((a, b) => a[0] - b[0]);
}

// ---- music box: the glints on the long notes -----------------------------------
const GLINT = {
  4:  [['D6', .5], ['A5', .5], ['F5', .5], ['A5', .5]],     // "…Scarborough Fair"
  8:  [['E6', .5], ['C6', .5], ['A5', .5], ['C6', .5]],     // "…and thyme"
  16: [['F6', .5], ['E6', .5], ['D6', .5], ['A5', .5]],     // "…of mine"
};
const glints = (verse, v, last = false) => Object.entries(GLINT).flatMap(([n, line]) => {
  let b = bar(verse, +n) + 1; const out = [];
  const l = last && +n === 16 ? [['D6', .5], ['A5', .5], ['F5', .5], ['D5', .5]] : line;
  for (const [p, d] of l){ out.push([r5(b), p, +(v * (out.length ? .82 : 1)).toFixed(3)]); b += d; }
  return out;
});
const musicbox = [...glints(V1, .6), ...glints(V2, .66, true)];

// ---- bells: six tolls, tonic and fifth only ---------------------------------------
const bells = [
  [0, 'D4', .42],                  // the far church bell, under the harp's first strum
  [V2, 'D5', .48], [V2, 'A4', .38], // the last verse
  [bar(V2, 9), 'D5', .6],          // "Remember me…"
  [bar(V2, 16), 'D4', .5], [bar(V2, 16), 'A4', .4],   // "…of mine": rings into the breath
];

export default {
  label: 'Scarborough Fair', sub: 'Traditional · autoharp, bow wheel & choir by candlelight',
  bpm: 60 * 6 / 3.8,                                  // ≈ 94.7: the loop's 3.8 s breath = 6 beats = 2 bars of 3/4
  scale: ['C', 'D', 'E', 'F', 'G', 'A', 'B'],
  room: 'cathedral',
  melody,
  parts: { strum, bowwheel, organ, musicbox, bells },
  // AUDIO-ONLY levels (velocity stays dynamics): the harp is constant, so it sits
  // under the tune; the choir enters soft and stays a pad
  mix: {
    strum:    [[0, .5], [V2, .42]],
    // verse 2's counter-line is a FEATURED voice (it has its own shot): it must sit above
    // the harp's strumming, not under it (a sample-render measured it ~2 dB under at .6)
    bowwheel: [[0, .6], [V2, .85]],
    organ:    .5,
    musicbox: .6,
    bells:    .7,
  },
  director: {
    // the harp strums every beat — it must not outvote the sparse machines
    strum: .6, bowwheel: 1.8, organ: 2, bells: 1.6, musicbox: .9,
    // the bow wheel's money frame: pulled back past its gantry posts, the wheel face + the fanned bed
    shots: { bowwheel: { x: 3.5, up: 4.5, dist: 19 } },
    at: [
      [0, 'strum', 12],            // the intro: the autoharp alone
      [12, 'lead', 12],            // "Are you going to Scarborough Fair?"
      [60, 'organ', 12],           // the choir enters
      [72, 'bowwheel', 11],        // the counter-line leaves the drone and climbs: A · B C…
      [83, 'bells', 7],            // …to D under "Remember me" — cut a beat early: the striker's swing, then the toll
      [96, 'stage', 12],           // the last line, the whole candlelit nave
    ],
  },
};

export const _scarborough = { sum, melodyBeats: sum(melody), END };
