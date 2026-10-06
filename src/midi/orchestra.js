// orchestra.js — MIDI → the whole room. Pure (no THREE / DOM / audio).
//
// convert.js turns a parsed file into a song; this module decides WHO PLAYS WHAT:
// it reads each melodic voice's General-MIDI program and routes it to the belt
// (the melodic spine: lead + alto/bass belts) or to one of the instrument plugins
// (src/instruments/<key>), then SHAPES each plugin part to what that machine can
// honestly play: octave-transposed into its sweet range, pitch count capped (one
// lane/string/bowl per pitch), polyphony thinned, repeats spaced. Anything that
// can't be honoured is dropped or folded and REPORTED (warnings), never hidden.
//
// Parts come out in the plugin contract's format (src/instruments/README.md):
//     song.parts[key] = [[beat, note, vel, durBeats?], ...]
// absolute beats ∈ [0, loopBeats), lead-aligned and quantized exactly like drums.
// Two machines read a duration: the bowls (a sustained voice: every note carries one)
// and the marimba (a held note ≥ `roll` beats becomes a ROLL — how a real marimbist
// sustains — so only those notes carry one).

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
export const midiToName = m => NOTE_NAMES[m % 12] + (Math.floor(m / 12) - 1);

/* ---- the General-MIDI program table ------------------------------------- */
export const GM_NAMES = [
  'Acoustic Grand Piano','Bright Acoustic Piano','Electric Grand Piano','Honky-tonk Piano','Electric Piano 1','Electric Piano 2','Harpsichord','Clavinet',
  'Celesta','Glockenspiel','Music Box','Vibraphone','Marimba','Xylophone','Tubular Bells','Dulcimer',
  'Drawbar Organ','Percussive Organ','Rock Organ','Church Organ','Reed Organ','Accordion','Harmonica','Tango Accordion',
  'Nylon Guitar','Steel Guitar','Jazz Guitar','Clean Guitar','Muted Guitar','Overdriven Guitar','Distortion Guitar','Guitar Harmonics',
  'Acoustic Bass','Fingered Bass','Picked Bass','Fretless Bass','Slap Bass 1','Slap Bass 2','Synth Bass 1','Synth Bass 2',
  'Violin','Viola','Cello','Contrabass','Tremolo Strings','Pizzicato Strings','Orchestral Harp','Timpani',
  'String Ensemble 1','String Ensemble 2','Synth Strings 1','Synth Strings 2','Choir Aahs','Voice Oohs','Synth Voice','Orchestra Hit',
  'Trumpet','Trombone','Tuba','Muted Trumpet','French Horn','Brass Section','Synth Brass 1','Synth Brass 2',
  'Soprano Sax','Alto Sax','Tenor Sax','Baritone Sax','Oboe','English Horn','Bassoon','Clarinet',
  'Piccolo','Flute','Recorder','Pan Flute','Blown Bottle','Shakuhachi','Whistle','Ocarina',
  'Square Lead','Saw Lead','Calliope Lead','Chiff Lead','Charang Lead','Voice Lead','Fifths Lead','Bass + Lead',
  'New Age Pad','Warm Pad','Polysynth Pad','Choir Pad','Bowed Pad','Metallic Pad','Halo Pad','Sweep Pad',
  'Rain FX','Soundtrack FX','Crystal FX','Atmosphere FX','Brightness FX','Goblins FX','Echoes FX','Sci-fi FX',
  'Sitar','Banjo','Shamisen','Koto','Kalimba','Bagpipe','Fiddle','Shanai',
  'Tinkle Bell','Agogo','Steel Drums','Woodblock','Taiko Drum','Melodic Tom','Synth Drum','Reverse Cymbal',
  'Guitar Fret Noise','Breath Noise','Seashore','Bird Tweet','Telephone Ring','Helicopter','Applause','Gunshot',
];

/* Program → destination.
     'belt'     a melodic voice: candidate for the belt lead / alto / bass
     <key>      an instrument plugin (marimba, musicbox, bells, bass, bowls)
     'sustain'  strings / ensembles / choir / organ: chordal or very long → bowls,
                a single moving line → belt (Canon's violins are melodies, not pads)
     null       no honest home (sound effects) → dropped + warned            */
const BY_FAMILY = [                 // one entry per 8-program GM family
  'belt',     //   0–7   pianos (GM default: a file with no program changes is all piano)
  'marimba',  //   8–15  chromatic percussion (refined in SPECIAL)
  'sustain',  //  16–23  organs
  'belt',     //  24–31  guitars
  'bass',     //  32–39  basses → the string-bass machine
  'sustain',  //  40–47  strings (refined in SPECIAL)
  'sustain',  //  48–55  ensembles / choir
  'belt',     //  56–63  brass
  'belt',     //  64–71  reed
  'belt',     //  72–79  pipe
  'belt',     //  80–87  synth lead
  'bowls',    //  88–95  synth pad — always a bed
  'bowls',    //  96–103 synth fx (atmospheres) (refined in SPECIAL)
  'belt',     // 104–111 ethnic (sitar, koto, fiddle…) (refined in SPECIAL)
  'marimba',  // 112–119 percussive (refined in SPECIAL)
  null,       // 120–127 sound effects
];
const SPECIAL = {
  8: 'musicbox', 9: 'musicbox', 10: 'musicbox',           // celesta, glockenspiel, music box
  11: 'marimba', 12: 'marimba', 13: 'marimba',            // vibraphone, marimba, xylophone
  14: 'bells',                                            // tubular bells
  15: 'marimba',                                          // dulcimer (hammered strings)
  21: 'belt', 22: 'belt', 23: 'belt',                     // accordion, harmonica, tango accordion: reed MELODY instruments
  43: 'bass',                                             // contrabass is a bass
  45: 'marimba', 46: 'marimba',                           // pizzicato strings, harp: plucked → struck bars
  47: 'bass',                                             // timpani: low, pitched, struck
  98: 'musicbox',                                         // crystal
  108: 'musicbox',                                        // kalimba: a comb of tines
  112: 'musicbox',                                        // tinkle bell
  119: null,                                              // reverse cymbal
};
export function routeProgram(p){
  if (p in SPECIAL) return SPECIAL[p];
  return BY_FAMILY[Math.max(0, Math.min(127, p | 0)) >> 3];
}

/* ---- what each machine can honestly play --------------------------------
   lo/hi     the sweet range (MIDI). Each VOICE is octave-shifted as a whole so its
             median sits near `center`, then stray notes fold by octaves into [lo, hi].
   pitches   max distinct pitches = lanes / strings / bowls / tines
   poly      max notes per onset (bowls: max SOUNDING at once)
   gap       min seconds between two hits on the SAME pitch (lane recovery)
   ioi       min seconds between successive onsets of the whole part (bells: sparse)
   voices    max source voices (MIDI track × program) merged onto the machine — one
             machine playing four unrelated parts at once is mush, not an arrangement
   Derived from each plugin's solve.js + demo:
     marimba   keyboard spans C..C over the played range (11.2 u) — 3 octaves keeps bars wide;
               a robot FOUR-MALLET marimbist: ≤ 4 notes at once (2 per hand), fast lines
               hand off between the hands (demo: 16ths @100); a note held ≥ 1 beat ROLLS
     musicbox  tine L ∝ f^−½ clamps past ~2.5 octaves; comb spacing shrinks past ~14 tines.
               Its pin gap is NOT a constant: the cylinder turns once per LOOP, so two pins
               on one tine must sit MB_MIN_ANGLE apart = MB_MIN_ANGLE·P/2π seconds (≈ 2 s on
               a 200-beat loop); fast repeats go round-robin onto ≤ MB_TWINS twin tines, and
               twins spend the comb's tine budget (`tines`) — see fitMusicbox
     bells     real chimes C4–F5 (demo C4–C6); the pendulum needs ~.36 s to come round
     bass      8 strings max (the bed scales uniformly past that); E1–E3. solveLane's
               dense-repeat floor: Tc = .4·gap and the ball falls back to V_MIN, so
               Tc + e·V/g + winch + V/g ≤ gap holds down to gap ≈ .146 s → .15
     bowls     two rows on a 10 u deck; a bowl's size is its note (C3 big … G5 small);
               HOLD_MAX 5 s per orbit
     turntable ONE marble reading a record: a monophonic line (poly 1 keeps the TOP note,
               as its own chainEvents does); grooves are a staff, so any range reads (demo
               F3–F6); onsets < MIN_GAP merge. Rests park on the tonearm magnet: a long
               loop costs nothing. Clearance holds for ≥ .1 s onsets at any length.
     ricochet  ONE marble on a FROZEN elastic orbit: monophonic. Its relaxation solve is
               ~1 s at 40–60 plates and every rest > 2.2 s adds a relay mirror, so it only
               takes a SHORT part (≤ maxEvents) on a short loop (≤ maxLoop s).
   maxEvents   a solve budget: past it the part keeps ONE CONTIGUOUS WINDOW from its entrance
               (a phrase, never a sieve of the "strongest" notes — that punches holes in a
               groove). The marimbist's beam search costs up to ~8 ms/event on hard parts.  */
export const PART_SPEC = {
  marimba:  { lo: 48, hi: 84,  center: 66, pitches: 37, poly: 4, gap: .1,  ioi: 0,  voices: 4, roll: 1, rollSec: .5, maxRoll: 8,
              maxEvents: 256 },
  musicbox: { lo: 72, hi: 100, center: 84, pitches: 14, poly: 5, gap: .08, ioi: 0,  voices: 2, tines: 20 },
  bells:    { lo: 60, hi: 84,  center: 70, pitches: 10, poly: 3, gap: .36, ioi: .2, voices: 2 },
  bass:     { lo: 28, hi: 52,  center: 38, pitches: 8,  poly: 2, gap: .15, ioi: 0,  voices: 1, maxEvents: 256 },
  bowls:    { lo: 48, hi: 79,  center: 62, pitches: 8,  poly: 4, gap: 0,   ioi: 0,  voices: 2,
              sustain: true, maxDur: 5, minDur: .3 },
  turntable: { lo: 53, hi: 89, center: 72, pitches: 24, poly: 1, gap: .1,  ioi: .1, voices: 1, maxEvents: 192 },
  ricochet:  { lo: 55, hi: 91, center: 74, pitches: 24, poly: 1, gap: .15, ioi: .15, voices: 1, maxEvents: 40, maxLoop: 60 },
};
export const PICKUP_BEATS = 4;      // pre-lead notes within this many beats wrap to the loop tail
export const OVERFLOW_VOICES = 2;   // belt voices (chordal / beyond 3 belts) the marimba takes in
export const LEAD_INTRO = 4;        // beats of intro (beyond a pickup) a lead may cost the others
export const LEAD_GAP = 32;         // beats: a lead may not rest longer than this mid-song (or span/8, if longer)
// mirrored engine/plugin constants (kept pure: no THREE import here) — test/midi-orchestra
// asserts they equal engine.ROLL_T and musicbox GEOM.MIN_ANGLE / splitTwins' twin ceiling
export const ROLL_T = 2.6, MB_MIN_ANGLE = .13, MB_TWINS = 4;

/* ---- per-voice statistics ------------------------------------------------ */
const median = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** How chordal a voice is: max(fraction of onsets that are chords, fraction of notes
    that start while another is still sounding). OCTAVE DOUBLINGS are not chords (a
    calliope lead or a brass section in octaves is still one line): notes are reduced
    to one per (onset, pitch class) first. notes: raw parse notes. */
export function polyphony(notes, quantizeTick){
  if (!notes.length) return 0;
  const seen = new Set(), ns = [];
  for (const n of notes){ const k = `${quantizeTick(n.tick)}|${n.midi % 12}`; if (!seen.has(k)){ seen.add(k); ns.push(n); } }
  const byOnset = new Map();
  for (const n of ns){ const q = quantizeTick(n.tick); byOnset.set(q, (byOnset.get(q) || 0) + 1); }
  const chordFrac = [...byOnset.values()].filter(c => c > 1).length / byOnset.size;
  const sorted = [...ns].sort((a, b) => a.tick - b.tick);
  let overlaps = 0, reach = -Infinity;
  for (const n of sorted){
    if (n.tick < reach) overlaps++;
    if (n.dur != null) reach = Math.max(reach, n.tick + n.dur * .9);    // a hair of legato is not polyphony
  }
  return Math.max(chordFrac, overlaps / ns.length);
}
const MONO = .25;                   // polyphony below this = a single line (strings: a melody, not a pad)
const LINE = .35;                   // a belt voice below this still reads as a line (a harmonica's odd double-stop)

/* ---- routing: melodic voices → belt + plugin parts --------------------------
   tracks: [{ name, notes }] (percussion already removed). Each track is split by
   program into VOICES (a track that switches instrument is two players).
   Returns { belt: [{name, notes}], parts: [{key, name, notes, program, voice}], warnings,
   squashed }. belt[0] is THE LEAD (convert.js keeps it first); the rest become alto/bass
   belts. `squashed` = a CHORDAL voice ended up on the belt (its chords would be cut to
   the top note) — convert.js then re-routes by role if the programs gave the room nothing.

   THE LEAD zeroes the timeline: everything more than a pickup before its first note is
   lost, and after its last note the marble is in one long flight. So a lead must
   ENTER early (≤ LEAD_INTRO beats of intro lost beyond the pickup), LAST (its tail
   gap ≤ a quarter of the song) and stay PRESENT (no interior silence longer than
   LEAD_GAP — a voice that rests 90 s mid-song parks the marble on its magnet while the
   room plays on); among those the legacy rule picks: the highest mean pitch among the 3
   busiest. Candidates: belt programs + strings/choir/organ (even chordal ones — the belt
   plays the top line, as the legacy importer always did).
   Other belt voices: single lines fill the alto/bass belts (busiest × longest first);
   spare lines go by register to a FREE machine (string bass low, music box high, else
   the turntable, the ricochet sculpture on a short loop); chordal ones and the rest go to
   the marimba (≤ OVERFLOW_VOICES, ranked); what's left drops with a warning.        */

/** Per-voice statistics. A voice = one track × one program. */
function makeVoices(tracks, { ppq, bpm }){
  const q12 = tick => Math.round(tick / ppq * 12) / 12;
  const secPerTick = 60 / bpm / ppq;
  const voices = [];
  for (const tr of tracks){
    const byProg = new Map();
    for (const n of tr.notes){
      const p = n.program ?? 0;
      if (!byProg.has(p)) byProg.set(p, []);
      byProg.get(p).push(n);
    }
    for (const [program, notes] of byProg){
      const nm = (tr.name || '').trim();
      const base = nm && !/^ch\d+$/.test(nm) ? nm : GM_NAMES[program];      // format-0 'chN' → the instrument
      const name = byProg.size > 1 ? `${base} (${GM_NAMES[program]})` : base;
      voices.push(voiceStats({ name, notes, program, channel: notes[0].channel }, q12, secPerTick, ppq));
    }
  }
  // names must tell voices apart in warnings: a repeated name gets its channel
  const count = new Map();
  for (const v of voices) count.set(v.name, (count.get(v.name) || 0) + 1);
  for (const v of voices) if (count.get(v.name) > 1) v.name = `${v.name} (ch${v.channel + 1})`;
  return voices;
}
function voiceStats(v, q12, secPerTick, ppq){
  const { notes } = v;
  const ticks = notes.map(n => n.tick);
  const on = [...new Set(notes.map(n => q12(n.tick)))].sort((a, b) => a - b);
  let gap = 0;
  for (let i = 1; i < on.length; i++) gap = Math.max(gap, on[i] - on[i - 1]);
  const durs = notes.filter(n => n.dur != null).map(n => n.dur * secPerTick);
  return Object.assign(v, {
    onsets: on.length,
    mean: notes.reduce((s, n) => s + n.midi, 0) / notes.length,
    first: Math.min(...ticks) / ppq, last: Math.max(...ticks) / ppq,      // beats
    gap,                                                                  // longest interior rest (beats)
    medDur: durs.length ? median(durs) : 0,                               // seconds
    poly: polyphony(notes, q12),
  });
}

/** The lead rule (see above), shared by program and role routing. vs: candidates. */
function pickLead(vs, span0, span1){
  const span = Math.max(1, span1 - span0);
  const intro = v => Math.max(0, v.first - PICKUP_BEATS - span0);
  const tail = v => Math.max(0, span1 - v.last);
  const legacy = c => [...c].sort((a, b) => b.onsets - a.onsets).slice(0, 3).sort((a, b) => b.mean - a.mean)[0];
  let ok = vs.filter(v => intro(v) <= LEAD_INTRO && tail(v) <= Math.max(16, span / 4));
  if (!ok.length){                      // nobody both enters early and lasts: least total loss (to 2 bars)
    const best = Math.min(...vs.map(v => intro(v) + tail(v)));
    ok = vs.filter(v => intro(v) + tail(v) <= best + 8);
  }
  const present = ok.filter(v => v.gap <= Math.max(LEAD_GAP, span / 8));
  return legacy(present.length ? present : ok);
}

export function orchestrate(tracks, { ppq, bpm }){
  const warnings = [];
  const q12 = tick => Math.round(tick / ppq * 12) / 12;
  const voices = makeVoices(tracks, { ppq, bpm });

  const routed = [];
  for (const v of voices){
    v.home = routeProgram(v.program);
    if (v.home === null){
      warnings.push(`dropped "${v.name}" (${GM_NAMES[v.program]}: no instrument in the room plays sound effects)`);
      continue;
    }
    v.dest = v.home;
    if (v.home === 'sustain') v.dest = v.poly >= MONO || v.medDur >= 2 ? 'bowls' : 'belt';
    routed.push(v);
  }
  if (!routed.length) return { belt: [], parts: [], warnings, squashed: false, voices: 0 };

  const span0 = Math.min(...routed.map(v => v.first)), span1 = Math.max(...routed.map(v => v.last));
  const span = Math.max(1, span1 - span0);
  for (const v of routed) v.score = v.onsets * Math.max(.05, (v.last - v.first) / span);   // busy AND lasting
  const byScore = (a, b) => b.score - a.score || a.first - b.first;

  // --- the lead ---
  const eligible = routed.filter(v => v.home === 'belt' || v.home === 'sustain');
  let lead = null, doubled = false;
  if (eligible.length){
    lead = pickLead(eligible, span0, span1);
    if (lead.dest !== 'belt'){
      warnings.push(`"${lead.name}" leads the belt (its top line) instead of the ${lead.dest}`);
      lead.dest = 'belt';
    }
  } else {
    // no melodic spine at all (a mallet / pad / bass-only file): the belt lead DOUBLES the
    // most melodic routed voice (top line), which keeps playing its own machine too.
    // Prefer the voice that ENTERS first (to the bar), then the most melodic kind, then the busiest.
    const rank = { musicbox: 0, marimba: 0, bells: 1, bowls: 2, bass: 3 };
    lead = [...routed].sort((a, b) => (Math.floor(a.first / 4) - Math.floor(b.first / 4)) || (rank[a.dest] - rank[b.dest]) ||
                                      (b.onsets - a.onsets) || (b.mean - a.mean))[0];
    doubled = true;
    warnings.push(`no piano/lead voice — the belt lead doubles the top line of "${lead.name}" (${lead.dest})`);
  }

  // --- the other belts: single lines, busiest × longest first ---
  const belt = [lead];
  const want = new Map();                          // plugin key → [{ v, native }]
  const put = (key, v, native) => { if (!want.has(key)) want.set(key, []); want.get(key).push({ v, native }); };
  const overflow = [];
  for (const v of routed.filter(v => v !== lead && v.dest === 'belt').sort(byScore)){
    if (v.poly < LINE && belt.length < 3) belt.push(v);
    else overflow.push(v);
  }
  for (const v of routed) if (v.dest !== 'belt' && (doubled || v !== lead)) put(v.dest, v, true);
  const loopSec = ROLL_T + (span1 - lead.first + 1) * 60 / bpm;   // ≈ the loop the machines will see
  for (const v of overflow){
    const free = k => !want.has(k);
    if (v.poly < LINE && v.mean < 50 && free('bass')){ put('bass', v, false); v.why = 'a spare low line'; }
    else if (v.poly < LINE && v.mean >= 76 && free('musicbox')){ put('musicbox', v, false); v.why = 'a spare high line'; }
    else if (v.poly < LINE && free('turntable')){ put('turntable', v, false); v.why = 'a spare melodic line'; }
    else if (v.poly < LINE && free('ricochet') && loopSec <= PART_SPEC.ricochet.maxLoop){ put('ricochet', v, false); v.why = 'a spare melodic line'; }
    else { put('marimba', v, false); v.why = v.poly >= LINE ? 'chordal — struck bars keep its chords' : 'no belt left'; }
  }

  // --- each machine takes its best voices (natives first), the rest are reported ---
  const parts = [];
  let vid = 0;
  for (const key of Object.keys(PART_SPEC)){
    const list = want.get(key);
    if (!list) continue;
    list.sort((a, b) => (b.native - a.native) || byScore(a.v, b.v));
    const kept = [];
    let guests = 0;
    for (const { v, native } of list){
      // a near-duplicate of a kept voice (doubled tracks are common in sequenced files)
      const dup = kept.find(k => covers(k.notes, v.notes, q12));
      if (dup){ warnings.push(`${key}: "${v.name}" doubles "${dup.name}" — merged`); parts.push(entry(key, v, dup.vid)); continue; }
      if (kept.length >= PART_SPEC[key].voices || (!native && guests >= OVERFLOW_VOICES && key === 'marimba')){
        warnings.push(`dropped "${v.name}" (${GM_NAMES[v.program]}): the ${key} already plays ${kept.length} voice${kept.length > 1 ? 's' : ''}`);
        continue;
      }
      if (!native){ guests++; warnings.push(`"${v.name}" (${GM_NAMES[v.program]}) plays on the ${key} (${v.why})`); }
      v.vid = vid++;
      kept.push(v);
      parts.push(entry(key, v, v.vid));
    }
  }
  return { belt: belt.map(v => ({ name: v.name, notes: v.notes })), parts, warnings, squashed: belt.some(v => v.poly >= LINE), voices: routed.length };
}
const entry = (key, v, voice) => ({ key, name: v.name, notes: v.notes, program: v.program, voice });

/* ---- routing by ROLE: a file whose programs say nothing --------------------------
   A file with NO program changes is GM piano on every channel — a sequencer sketch, a
   piano reduction, a game rip — and the program table would put every voice on the belt
   (the room stands empty, chords cut to their top note). Same when the programs exist
   but give the room nothing (all pianos / guitars / leads, a chord-squashed lead). So
   each voice is read by its MUSICAL SHAPE instead and sent to the machine that plays
   that shape (each machine's limits are then honoured by shapePart, as ever):

     chordal + sustained (median note ≥ ROLE.SUSTAIN s)  → singing bowls (a bed)
     chordal + high (mean ≥ ROLE.HIGH−3)                 → music box
     chordal otherwise (comping, arpeggios)              → marimba (struck bars keep chords)
     a low line (mean < ROLE.LOW)                        → string bass, else a bass belt
     a high (mean ≥ ROLE.HIGH), staccato (< ROLE.SPARK s) line → music box, else turntable
     any other line                                      → the LEAD (the legacy belt-lead
          choice, pickLead); the next lines: turntable, the alto belt, the ricochet
          sculpture (short loops only), the last belt; overflow → marimba
   A machine that is full passes the voice down its list; a near-duplicate merges; what
   fits nowhere drops (warned). No line that could lead (a two-hand piano on one track —
   Tetris, a game rip)? The busiest chordal voice is SPLIT into its hands: the top line
   (the melody → the lead), the bottom line (the left hand's bass → string bass) and the
   inner notes (the chords → bowls / marimba by their sustain).                         */
export const ROLE = { LOW: 50, HIGH: 79, SPARK: .3, SUSTAIN: 1.2, SPLIT: 12 };

/** Split a chordal voice into top line / bottom line / inner notes. A 2-means split of
    its pitches finds the hands (if the clusters sit < ROLE.SPLIT semitones apart there is
    only one hand: no bottom line). The top line = the highest note of each onset unless a
    higher top note is still sounding (then it's an inner voice); the bottom line mirrors it. */
export function splitHands(notes, q12){
  const ms = notes.map(n => n.midi);
  let c0 = Math.min(...ms), c1 = Math.max(...ms);
  for (let it = 0; it < 12; it++){
    const lo = ms.filter(m => Math.abs(m - c0) <= Math.abs(m - c1)), hi = ms.filter(m => Math.abs(m - c0) > Math.abs(m - c1));
    if (!lo.length || !hi.length) break;
    c0 = lo.reduce((s, m) => s + m, 0) / lo.length; c1 = hi.reduce((s, m) => s + m, 0) / hi.length;
  }
  const twoHands = c1 - c0 >= ROLE.SPLIT;
  const isUpper = n => !twoHands || Math.abs(n.midi - c0) > Math.abs(n.midi - c1);
  const line = (pool, top) => {
    const byOn = new Map();
    for (const n of pool){ const k = q12(n.tick); if (!byOn.has(k)) byOn.set(k, []); byOn.get(k).push(n); }
    const out = new Set();
    let held = null;
    for (const k of [...byOn.keys()].sort((a, b) => a - b)){
      const g = byOn.get(k), c = g.reduce((b, n) => (top ? n.midi > b.midi : n.midi < b.midi) ? n : b);
      const still = held && held.dur != null && held.tick + held.dur * .9 > c.tick;
      if (still && (top ? c.midi < held.midi : c.midi > held.midi)) continue;
      out.add(c); held = c;
    }
    return out;
  };
  const upper = notes.filter(isUpper), lower = twoHands ? notes.filter(n => !isUpper(n)) : [];
  const top = line(upper, true), bottom = lower.length ? line(lower, false) : new Set();
  const order = (a, b) => a.tick - b.tick || a.midi - b.midi;
  return { top: [...top].sort(order), bottom: [...bottom].sort(order),
           inner: notes.filter(n => !top.has(n) && !bottom.has(n)).sort(order) };
}

export function orchestrateByRole(tracks, { ppq, bpm, programs = false, reason = 'no program data' }){
  const warnings = [];
  const q12 = tick => Math.round(tick / ppq * 12) / 12;
  const secPerTick = 60 / bpm / ppq;
  let voices = makeVoices(tracks, { ppq, bpm });
  if (programs) voices = voices.filter(v => {
    if (routeProgram(v.program) !== null) return true;
    warnings.push(`dropped "${v.name}" (${GM_NAMES[v.program]}: no instrument in the room plays sound effects)`);
    return false;
  });
  if (!voices.length) return { belt: [], parts: [], warnings, squashed: false };
  let span0 = Math.min(...voices.map(v => v.first)), span1 = Math.max(...voices.map(v => v.last));
  const intro = v => Math.max(0, v.first - PICKUP_BEATS - span0);
  const tail = v => Math.max(0, span1 - v.last);
  const isLine = v => v.poly < LINE;
  const sparkly = v => v.mean >= ROLE.HIGH && v.medDur < ROLE.SPARK;   // ornament, not the tune
  const canLead = v => isLine(v) && !v.comp && !v.low && !sparkly(v) && v.mean >= ROLE.LOW + 5 && intro(v) <= LEAD_INTRO && tail(v) <= Math.max(16, (span1 - span0) / 4);

  // no line that could lead: split the busiest (× longest) chordal voice into its hands
  if (!voices.some(canLead)){
    const span = Math.max(1, span1 - span0);
    const chordal = voices.filter(v => !isLine(v) && v.notes.length >= 8)
      .sort((a, b) => b.onsets * (b.last - b.first + 1) / span - a.onsets * (a.last - a.first + 1) / span);
    const v = chordal[0];
    if (v){
      const { top, bottom, inner } = splitHands(v.notes, q12);
      const sub = (suffix, notes) => voiceStats({ name: `${v.name} ${suffix}`, notes, program: v.program, channel: v.channel }, q12, secPerTick, ppq);
      const parts = [sub('(melody)', top)];
      if (bottom.length >= 4) parts.push(Object.assign(sub('(left hand)', bottom), { low: true }));
      else inner.push(...bottom);
      if (inner.length >= Math.max(4, .05 * v.notes.length)) parts.push(Object.assign(sub('(chords)', inner), { comp: true }));
      voices = voices.flatMap(x => x === v ? parts : [x]);
      warnings.push(`"${v.name}": one track plays melody + accompaniment — split into ${parts.map(p => `${p.name.slice(v.name.length + 1)} ${p.notes.length}`).join(', ')}`);
    }
  }

  span0 = Math.min(...voices.map(v => v.first)); span1 = Math.max(...voices.map(v => v.last));
  const span = Math.max(1, span1 - span0);
  for (const v of voices) v.score = v.onsets * Math.max(.05, (v.last - v.first) / span);
  const byScore = (a, b) => b.score - a.score || a.first - b.first;

  // each voice's SHAPE → its machines, best first
  for (const v of voices){
    if (!isLine(v) || v.comp){             // (a split's inner notes are the accompaniment, even when they arpeggiate one at a time)
      if (v.medDur >= ROLE.SUSTAIN){ v.kind = 'a sustained chordal bed'; v.prefs = ['bowls', 'marimba']; }
      else if (v.mean >= ROLE.HIGH - 3){ v.kind = 'high chords'; v.prefs = ['musicbox', 'marimba', 'bowls']; }
      else { v.kind = 'chords / arpeggios'; v.prefs = ['marimba', 'bowls']; }
    } else if (v.mean < ROLE.LOW || v.low){ v.kind = v.low ? 'the left hand\'s bass line' : 'a low line'; v.prefs = ['bass', 'belt', 'marimba']; }
    else if (sparkly(v)){ v.kind = 'a high sparkly line'; v.prefs = ['musicbox', 'turntable', 'belt', 'marimba']; }
    else { v.kind = 'a melodic line'; v.prefs = ['turntable', 'alto', 'ricochet', 'belt', 'marimba']; }
  }

  // the lead: the legacy choice among the lines that could lead (else any line, else anyone)
  const lines = voices.filter(v => isLine(v) && !v.comp && !v.low);
  const pool = voices.filter(canLead).length ? voices.filter(canLead) : lines.length ? lines : voices;
  const lead = pickLead(pool, span0, span1);
  const loopSec = ROLL_T + (span1 - lead.first + 1) * 60 / bpm;

  const belt = [lead];
  const kept = new Map();                          // key → [voice]
  const parts = [];
  let vid = 0;
  const route = [];
  for (const v of voices.filter(x => x !== lead).sort(byScore)){
    let placed = false;
    for (const p of v.prefs){
      if (p === 'belt' || p === 'alto'){
        if (belt.length < (p === 'alto' ? 2 : 3) && isLine(v)){ belt.push(v); route.push(`"${v.name}" → ${belt.length === 2 ? 'alto' : 'bass'} belt (${v.kind})`); placed = true; break; }
        continue;
      }
      if (p === 'ricochet' && loopSec > PART_SPEC.ricochet.maxLoop) continue;
      const on = kept.get(p) || [];
      const dup = on.find(k => covers(k.notes, v.notes, q12));
      if (dup){ warnings.push(`${p}: "${v.name}" doubles "${dup.name}" — merged`); parts.push(entry(p, v, dup.vid)); placed = true; break; }
      if (on.length >= PART_SPEC[p].voices) continue;
      v.vid = vid++; on.push(v); kept.set(p, on);
      parts.push(entry(p, v, v.vid));
      route.push(`"${v.name}" → ${p} (${v.kind})`);
      placed = true; break;
    }
    if (!placed) warnings.push(`dropped "${v.name}" (${v.kind}): every machine that plays it is full`);
  }
  warnings.unshift(`routed by musical role (${reason}): "${lead.name}" leads the belt` + (route.length ? '; ' + route.join('; ') : ''));
  // registry order for the parts (stable: the same file always builds the same room)
  const order = Object.keys(PART_SPEC);
  parts.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  return { belt: belt.map(v => ({ name: v.name, notes: v.notes })), parts, warnings, squashed: false };
}
/** does voice a already play ≥ 90% of b's (onset, pitch class)s? */
function covers(a, b, q){
  const A = new Set(a.map(n => `${q(n.tick)}|${n.midi % 12}`));
  let hit = 0;
  for (const n of b) if (A.has(`${q(n.tick)}|${n.midi % 12}`)) hit++;
  return hit >= .9 * b.length;
}

/* ---- the music box's comb: pins on one tine sit ≥ minGap apart ------------
   buildComb deals one pitch's strikes round-robin onto the fewest twin tines (≤ MB_TWINS)
   whose cyclic gaps are all ≥ minGap. twinsFor mirrors splitTwins (0 = can't fit);
   thinTwins keeps the strikes that fit k tines (greedy: a strike needs the one k
   before it ≥ minGap back; then the seam, which wraps through P).               */
export function twinsFor(times, P, minGap){
  const n = times.length;
  for (let k = 1; k <= MB_TWINS; k++){
    const sets = Array.from({ length: k }, (_, j) => times.filter((_, i) => i % k === j)).filter(s => s.length);
    if (sets.every(s => s.every((si, i) => ((i + 1 < s.length ? s[i + 1] : s[0] + P) - si) >= minGap - 1e-9))) return k;
    if (k >= n) return k;
  }
  return 0;
}
function thinTwins(times, P, minGap, k){
  const kept = [];
  for (const t of times) if (kept.length < k || t - kept[kept.length - k] >= minGap - 1e-9) kept.push(t);
  while (kept.length > 1){ const t = twinsFor(kept, P, minGap); if (t && t <= k) break; kept.pop(); }
  return kept;
}

/* ---- shaping one instrument's part ---------------------------------------
   notes: [{ beat, midi, vel, dur, voice?, src? }] — beat lead-aligned + quantized (may
   be < 0 for a pickup), dur in beats or null, voice = source-voice id (each voice is
   octave-shifted on its own), src = its name (for warnings). Returns { part, warnings }. */
export function shapePart(key, notes, { bpm, loopBeats, rollT = ROLL_T }){
  const S = PART_SPEC[key];
  if (!S) throw new Error(`orchestra: no part spec for instrument "${key}"`);
  const warnings = [], say = m => warnings.push(`${key}: ${m}`);
  const spb = 60 / bpm;                                  // seconds per beat
  const P = rollT + loopBeats * spb;                     // the loop period the machine sees
  const seam = (first, last) => (first + loopBeats - last) * spb + rollT;   // the gap across the loop seam (s)
  const tidy = b => Math.round(b * 12000) / 12000;
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

  // 1. the loop window: a short pickup wraps to the tail (where it leads into the
  //    downbeat on every loop after the first) — but only into a FREE tail: it never
  //    lands on the song's own last bar. A long pre-lead intro can't be kept.
  const inside = notes.filter(n => n.beat >= 0);
  const pick = notes.filter(n => n.beat < 0 && n.beat >= -PICKUP_BEATS);
  const early = notes.length - inside.length - pick.length;
  let ns = inside.map(n => ({ ...n, beat: n.beat >= loopBeats ? tidy(n.beat % loopBeats) : n.beat }));
  let wrapped = 0, clash = 0;
  if (pick.length){
    const from = loopBeats + Math.min(...pick.map(n => n.beat));
    if (ns.some(n => n.beat >= from - 1e-9)) clash = pick.length;
    else { for (const n of pick) ns.push({ ...n, beat: tidy(n.beat + loopBeats) }); wrapped = pick.length; }
  }
  if (early) say(`dropped ${plural(early, 'note')} more than ${PICKUP_BEATS} beats before the lead`);
  if (wrapped) say(`wrapped ${plural(wrapped, 'pickup note')} to the loop tail`);
  if (clash) say(`dropped ${plural(clash, 'pickup note')} (the loop tail already plays)`);
  if (!ns.length) return { part: [], warnings };
  if (S.maxLoop && P > S.maxLoop){
    say(`a ${P.toFixed(0)} s loop is too long for one frozen orbit (≤ ${S.maxLoop} s: every rest is a relay mirror) — not played`);
    return { part: [], warnings };
  }

  // 2. octave-transpose each VOICE toward the machine's centre, 3. fold strays
  const byVoice = new Map();
  for (const n of ns){ const v = n.voice ?? 0; if (!byVoice.has(v)) byVoice.set(v, []); byVoice.get(v).push(n.midi); }
  const shiftOf = new Map();
  for (const [v, ms] of byVoice){
    const shift = 12 * Math.round((S.center - median(ms)) / 12);
    shiftOf.set(v, shift);
    if (shift){
      const src = ns.find(n => (n.voice ?? 0) === v)?.src;
      say(`${src ? `"${src}" ` : ''}shifted ${plural(Math.abs(shift / 12), 'octave')} ${shift > 0 ? 'up' : 'down'} into its range`);
    }
  }
  let folded = 0;
  ns = ns.map(n => {
    let m = n.midi + shiftOf.get(n.voice ?? 0);
    while (m < S.lo){ m += 12; folded++; }
    while (m > S.hi){ m -= 12; folded++; }
    return { ...n, midi: m };
  });
  if (folded) say(`folded ${plural(folded, 'note')} by octaves into ${midiToName(S.lo)}–${midiToName(S.hi)}`);

  // 4. pitch cap — COVER THE HARMONY FIRST: one string/bowl/lane per pitch class (its
  //    most-used octave, heaviest classes first), then extra octaves by use. Every other
  //    note folds by octave onto a kept pitch of its class; only a class with no slot drops.
  const use = new Map();
  for (const n of ns) use.set(n.midi, (use.get(n.midi) || 0) + 1);
  if (use.size > S.pitches){
    const near = (a, b) => (use.get(b) - use.get(a)) || (Math.abs(a - S.center) - Math.abs(b - S.center)) || a - b;
    const pcw = new Map();
    for (const [m, c] of use) pcw.set(m % 12, (pcw.get(m % 12) || 0) + c);
    const kept = new Set();
    for (const pc of [...pcw.keys()].sort((a, b) => pcw.get(b) - pcw.get(a) || a - b)){
      if (kept.size >= S.pitches) break;
      kept.add([...use.keys()].filter(m => m % 12 === pc).sort(near)[0]);
    }
    for (const m of [...use.keys()].sort(near)){ if (kept.size >= S.pitches) break; kept.add(m); }
    let moved = 0, lost = 0;
    ns = ns.flatMap(n => {
      if (kept.has(n.midi)) return [n];
      const twin = [...kept].filter(k => (k - n.midi) % 12 === 0).sort((a, b) => Math.abs(a - n.midi) - Math.abs(b - n.midi))[0];
      if (twin === undefined){ lost++; return []; }
      moved++; return [{ ...n, midi: twin }];
    });
    say(`${use.size} pitches > ${S.pitches} ${key === 'bowls' ? 'bowls' : key === 'bass' ? 'strings' : key === 'musicbox' ? 'tines' : 'lanes'}: ` +
        `every pitch class kept first, folded ${plural(moved, 'note')} by octave${lost ? `, dropped ${plural(lost, 'note')} of the rarest classes` : ''}`);
  }

  // 5. dedupe a retrigger at the same beat + pitch (loudest / longest wins)
  const uniq = new Map();
  for (const n of ns){
    const k = `${n.beat}|${n.midi}`, o = uniq.get(k);
    if (!o) uniq.set(k, { ...n });
    else { o.vel = Math.max(o.vel, n.vel); o.dur = Math.max(o.dur ?? 0, n.dur ?? 0) || null; }
  }
  ns = [...uniq.values()].sort((a, b) => a.beat - b.beat || a.midi - b.midi);

  // 6. chord thinning: ≤ poly notes per onset — the outer voices first, then the loudest
  let thinned = 0;
  let groups = [];
  for (const n of ns){ const g = groups[groups.length - 1]; if (g && g.beat === n.beat) g.ns.push(n); else groups.push({ beat: n.beat, ns: [n] }); }
  for (const g of groups){
    if (g.ns.length <= S.poly) continue;
    const lo = g.ns[0], hi = g.ns[g.ns.length - 1];
    if (S.poly === 1){ thinned += g.ns.length - 1; g.ns = [hi]; continue; }   // a single marble: the top line
    const inner = g.ns.slice(1, -1).sort((a, b) => b.vel - a.vel).slice(0, Math.max(0, S.poly - 2));
    thinned += g.ns.length - 2 - inner.length;
    g.ns = [lo, ...inner, hi].slice(0, S.poly).sort((a, b) => a.midi - b.midi);
  }

  // 7. sustain (bowls): every note gets a duration in [minDur, maxDur] s; never more
  //    than `poly` sounding at once — an older note is released when a newer one arrives
  let released = 0;
  if (S.sustain){
    const maxB = S.maxDur / spb, minB = S.minDur / spb;
    const active = [];
    groups.forEach((g, gi) => {
      const nextBeat = gi + 1 < groups.length ? groups[gi + 1].beat : loopBeats;
      for (const n of g.ns) n.dur = Math.min(maxB, Math.max(minB, n.dur ?? (nextBeat - g.beat)));
      for (let i = active.length - 1; i >= 0; i--) if (active[i].beat + active[i].dur <= g.beat + 1e-9) active.splice(i, 1);
      while (active.length && active.length + g.ns.length > S.poly){
        const old = active.shift();                      // oldest first
        old.dur = Math.max(minB, g.beat - old.beat); released++;
      }
      active.push(...g.ns); active.sort((a, b) => a.beat - b.beat);
    });
  }
  if (thinned) say(`thinned ${plural(thinned, 'chord note')} (≤ ${S.poly} per onset)`);
  if (released) say(`released ${plural(released, 'note')} early (≤ ${S.poly} sounding at once)`);

  // 8. lane recovery (same pitch) and 9. part-wide sparseness (bells)
  const lastAt = new Map();
  let lastOn = -Infinity, spaced = 0;
  let out = [];
  for (const g of groups){
    if (S.ioi && (g.beat - lastOn) * spb < S.ioi - 1e-9){ spaced += g.ns.length; continue; }
    let any = false;
    for (const n of g.ns){
      const prev = lastAt.get(n.midi);
      if (prev !== undefined && (n.beat - prev) * spb < S.gap - 1e-9){ spaced++; continue; }
      lastAt.set(n.midi, n.beat); out.push(n); any = true;
    }
    if (any) lastOn = g.beat;
  }
  // the loop seam is a gap too (it includes the roll-in): a repeat at the tail can't crowd
  // the head's same pitch, nor (bells) the head's first onset
  for (const m of [...lastAt.keys()]){
    const same = out.filter(n => n.midi === m);
    while (same.length > 1 && seam(same[0].beat, same[same.length - 1].beat) < S.gap - 1e-9){
      out.splice(out.indexOf(same.pop()), 1); spaced++;
    }
  }
  if (S.ioi) while (out.length > 1 && out[out.length - 1].beat !== out[0].beat && seam(out[0].beat, out[out.length - 1].beat) < S.ioi - 1e-9){
    const lb = out[out.length - 1].beat;
    const n0 = out.length; out = out.filter(n => n.beat !== lb); spaced += n0 - out.length;
  }
  if (spaced) say(`thinned ${plural(spaced, 'note')} too close together for the machine (${S.ioi ? `≥ ${S.ioi}s apart` : `≥ ${S.gap}s per pitch`})`);

  // 10. the music box's comb (see fitMusicbox): pins per tine vs the LOOP's rotation
  if (key === 'musicbox') out = fitMusicbox(out, { spb, rollT, P, tines: S.tines, say, plural });

  // 11. a solve budget: a dense, song-length part can cost the machine seconds of
  //     up-front solving on load (frozen main thread). Past it, keep ONE CONTIGUOUS
  //     WINDOW from the part's entrance — whole onsets, a phrase played as written —
  //     never the "strongest" notes scattered over the song (that sieve punched holes
  //     in every groove it touched).
  out = budgetWindow(out, S.maxEvents, say, plural);

  // a marimba ROLL holds only until the next attack (any pitch): a spread chord or a line
  // over a held note is struck, not rolled — two hands can't sustain six voices
  const beats = [...new Set(out.map(n => n.beat))].sort((a, b) => a - b);
  const nextOn = b => { const i = beats.findIndex(x => x > b + 1e-9); return i >= 0 ? beats[i] : loopBeats + beats[0]; };
  const part = out.map(n => {
    const vel = Math.round(Math.max(.05, Math.min(1, n.vel)) * 100) / 100;
    const e = [n.beat, midiToName(n.midi), vel];
    if (S.sustain) e.push(Math.round(n.dur * 1000) / 1000);
    else if (S.roll){                                    // a held note: a ROLL
      const d = Math.min(n.dur ?? 0, nextOn(n.beat) - n.beat, S.maxRoll);
      if (d >= S.roll && d * spb >= S.rollSec) e.push(Math.round(d * 1000) / 1000);
    }
    return e;
  });
  return { part, warnings };
}

/** The solve budget (see PART_SPEC.maxEvents): keep whole onsets from the part's first
    one until the next onset would overflow `max`; drop (and report) the rest. */
export function budgetWindow(out, max, say = () => {}, plural = (n, w) => `${n} ${w}s`){
  if (!max || out.length <= max) return out;
  const sorted = [...out].sort((a, b) => a.beat - b.beat);
  let n = 0;
  while (n < sorted.length){
    let j = n; while (j < sorted.length && sorted[j].beat === sorted[n].beat) j++;
    if (j > max){ if (n === 0) n = max; break; }
    n = j;
  }
  const kept = new Set(sorted.slice(0, n));
  say(`kept the first ${n} of ${out.length} notes — one contiguous window, beats ${sorted[0].beat}–${sorted[n - 1].beat} ` +
      `(the machine's solve budget) — dropped ${plural(out.length - n, 'later note')}`);
  return out.filter(e => kept.has(e));
}

/** Music box: every pitch's strikes must fit its tines (≤ MB_TWINS twins, pins
    MB_MIN_ANGLE apart on the once-per-loop cylinder) and all tines must fit the comb
    (`tines`). Over budget, the pitch with the most twins gives one up (its strikes
    thinned to fit one fewer) until the comb fits. */
function fitMusicbox(out, { spb, rollT, P, tines, say, plural }){
  const minGap = MB_MIN_ANGLE * P / (2 * Math.PI);
  const tOf = n => rollT + n.beat * spb;
  const by = new Map();
  for (const n of out){ if (!by.has(n.midi)) by.set(n.midi, []); by.get(n.midi).push(n); }
  const keepT = new Map(), k = new Map();
  for (const [m, ns] of by){
    const kept = thinTwins(ns.map(tOf), P, minGap, MB_TWINS);
    keepT.set(m, kept); k.set(m, Math.max(1, twinsFor(kept, P, minGap)));
  }
  const total = () => [...k.values()].reduce((s, x) => s + x, 0);
  while (total() > tines){
    const m = [...k.keys()].sort((a, b) => k.get(b) - k.get(a) || keepT.get(a).length - keepT.get(b).length)[0];
    if (k.get(m) <= 1) break;                            // (the pitch cap already bounds this)
    const kept = thinTwins(by.get(m).map(tOf), P, minGap, k.get(m) - 1);
    keepT.set(m, kept); k.set(m, Math.max(1, twinsFor(kept, P, minGap)));
  }
  const ok = new Set();
  for (const [m, ts] of keepT){ const s = new Set(ts.map(t => t.toFixed(9))); for (const n of by.get(m)) if (s.has(tOf(n).toFixed(9))) ok.add(n); }
  const lost = out.length - ok.size;
  if (lost) say(`thinned ${plural(lost, 'pin')} — a tine needs ${minGap.toFixed(2)}s of cylinder between its pins on this ${P.toFixed(0)}s loop ` +
                `(≤ ${MB_TWINS} twin tines per pitch, ${total()} of ${tines} tines used)`);
  return out.filter(n => ok.has(n));
}
