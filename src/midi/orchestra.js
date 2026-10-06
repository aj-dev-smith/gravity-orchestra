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
               HOLD_MAX 5 s per orbit                                              */
export const PART_SPEC = {
  marimba:  { lo: 48, hi: 84,  center: 66, pitches: 37, poly: 4, gap: .1,  ioi: 0,  voices: 4, roll: 1, rollSec: .5, maxRoll: 8 },
  musicbox: { lo: 72, hi: 100, center: 84, pitches: 14, poly: 5, gap: .08, ioi: 0,  voices: 2, tines: 20 },
  bells:    { lo: 60, hi: 84,  center: 70, pitches: 10, poly: 3, gap: .36, ioi: .2, voices: 2 },
  bass:     { lo: 28, hi: 52,  center: 38, pitches: 8,  poly: 2, gap: .15, ioi: 0,  voices: 1, maxEvents: 256 },
  bowls:    { lo: 48, hi: 79,  center: 62, pitches: 8,  poly: 4, gap: 0,   ioi: 0,  voices: 2,
              sustain: true, maxDur: 5, minDur: .3 },
};
export const PICKUP_BEATS = 4;      // pre-lead notes within this many beats wrap to the loop tail
export const OVERFLOW_VOICES = 2;   // belt voices (chordal / beyond 3 belts) the marimba takes in
export const LEAD_INTRO = 4;        // beats of intro (beyond a pickup) a lead may cost the others
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
   Returns { belt: [{name, notes}], parts: [{key, name, notes, program, voice}], warnings }.
   belt[0] is THE LEAD (convert.js keeps it first); the rest become alto/bass belts.

   THE LEAD zeroes the timeline: everything more than a pickup before its first note is
   lost, and after its last note the marble is in one long flight. So a lead must
   ENTER early (≤ LEAD_INTRO beats of intro lost beyond the pickup) and LAST (its tail
   gap ≤ a quarter of the song); among those the legacy rule picks: the highest mean
   pitch among the 3 busiest. Candidates: belt programs + strings/choir/organ (even
   chordal ones — the belt plays the top line, as the legacy importer always did).
   Other belt voices: single lines fill the alto/bass belts (busiest × longest first);
   chordal ones and overflow go to the marimba (≤ OVERFLOW_VOICES, ranked), or by
   register to a FREE bass / music box; the rest drop with a warning.            */
export function orchestrate(tracks, { ppq, bpm }){
  const warnings = [];
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
      const ticks = notes.map(n => n.tick);
      voices.push({
        name, notes, program, channel: notes[0].channel,
        onsets: new Set(notes.map(n => q12(n.tick))).size,
        mean: notes.reduce((s, n) => s + n.midi, 0) / notes.length,
        first: Math.min(...ticks) / ppq, last: Math.max(...ticks) / ppq,      // beats
        poly: polyphony(notes, q12),
      });
    }
  }
  // names must tell voices apart in warnings: a repeated name gets its channel
  const count = new Map();
  for (const v of voices) count.set(v.name, (count.get(v.name) || 0) + 1);
  for (const v of voices) if (count.get(v.name) > 1) v.name = `${v.name} (ch${v.channel + 1})`;

  const routed = [];
  for (const v of voices){
    v.home = routeProgram(v.program);
    if (v.home === null){
      warnings.push(`dropped "${v.name}" (${GM_NAMES[v.program]}: no instrument in the room plays sound effects)`);
      continue;
    }
    v.dest = v.home;
    if (v.home === 'sustain'){
      const durs = v.notes.filter(n => n.dur != null).map(n => n.dur * secPerTick);
      v.dest = v.poly >= MONO || median(durs) >= 2 ? 'bowls' : 'belt';
    }
    routed.push(v);
  }
  if (!routed.length) return { belt: [], parts: [], warnings };

  const span0 = Math.min(...routed.map(v => v.first)), span1 = Math.max(...routed.map(v => v.last));
  const span = Math.max(1, span1 - span0);
  for (const v of routed) v.score = v.onsets * Math.max(.05, (v.last - v.first) / span);   // busy AND lasting
  const byScore = (a, b) => b.score - a.score || a.first - b.first;

  // --- the lead ---
  const intro = v => Math.max(0, v.first - PICKUP_BEATS - span0);
  const tail = v => Math.max(0, span1 - v.last);
  const legacy = vs => [...vs].sort((a, b) => b.onsets - a.onsets).slice(0, 3).sort((a, b) => b.mean - a.mean)[0];
  const eligible = routed.filter(v => v.home === 'belt' || v.home === 'sustain');
  let lead = null, doubled = false;
  if (eligible.length){
    let ok = eligible.filter(v => intro(v) <= LEAD_INTRO && tail(v) <= Math.max(16, span / 4));
    if (!ok.length){                    // nobody both enters early and lasts: least total loss (to 2 bars)
      const best = Math.min(...eligible.map(v => intro(v) + tail(v)));
      ok = eligible.filter(v => intro(v) + tail(v) <= best + 8);
    }
    lead = legacy(ok);
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
  for (const v of overflow){
    const free = k => !want.has(k);
    if (v.poly < LINE && v.mean < 50 && free('bass')){ put('bass', v, false); v.why = 'a spare low line'; }
    else if (v.poly < LINE && v.mean >= 76 && free('musicbox')){ put('musicbox', v, false); v.why = 'a spare high line'; }
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
  return { belt: belt.map(v => ({ name: v.name, notes: v.notes })), parts, warnings };
}
const entry = (key, v, voice) => ({ key, name: v.name, notes: v.notes, program: v.program, voice });
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
  //     up-front solving on load. Past it, keep the strongest (loudest, then downbeats).
  if (S.maxEvents && out.length > S.maxEvents){
    const cut = out.length - S.maxEvents;
    const keep = new Set([...out].sort((a, b) => b.vel - a.vel || (a.beat % 1) - (b.beat % 1) || a.beat - b.beat).slice(0, S.maxEvents));
    out = out.filter(n => keep.has(n));
    say(`kept the ${S.maxEvents} strongest of ${S.maxEvents + cut} notes (the machine's solve budget) — dropped ${plural(cut, 'note')}`);
  }

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
