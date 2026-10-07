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

// the newer machines publish their own honest limits (pure solve modules: no THREE, no DOM) —
// their PART_SPEC entries below are DERIVED from these, never copied (test/midi-routing asserts it)
import { PART_LIMITS as RIFF_LIMITS } from '../instruments/riff/solve.js';
import { PART_LIMITS as STRUM_LIMITS } from '../instruments/strum/solve.js';
import { PART_LIMITS as ORGAN_LIMITS } from '../instruments/organ/solve.js';
import { PART_LIMITS as HORNS_LIMITS } from '../instruments/horns/solve.js';
import { PART_LIMITS as BOWWHEEL_LIMITS } from '../instruments/bowwheel/solve.js';
import { PART_LIMITS as DULCIMER_LIMITS } from '../instruments/dulcimer/solve.js';
import { PART_LIMITS as POGO_LIMITS } from '../instruments/pogo/solve.js';

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
  55: 'marimba',                                          // orchestra hit: a struck stab, not a bed
  98: 'musicbox',                                         // crystal
  108: 'musicbox',                                        // kalimba: a comb of tines
  112: 'musicbox',                                        // tinkle bell
  114: 'volley',                                          // steel drums: the volley's walls ARE a steel pan
  119: null,                                              // reverse cymbal
};
export function routeProgram(p){
  if (p in SPECIAL) return SPECIAL[p];
  return BY_FAMILY[Math.max(0, Math.min(127, p | 0)) >> 3];
}

/* ---- THE FAMILY MACHINES: a voice's program + its SHAPE → a purpose-built machine ------
   PREFER is consulted BEFORE the tables above (first match wins), but only for a machine that
   has a PART_SPEC entry. A match takes the machine NATIVELY: the voice never competes for a
   belt. shape (v = the voice's statistics, voiceStats):
     'chordal'  poly ≥ LINE (chords / comping)
     'riff'     chordal, or RIFF-LIKE (power chords in the guitar register — polyphony() reads a
                power-chord chug as ONE line, so 'chordal' alone would hand MoP's riff to a belt)
     'riffOnly' riff-like only (a CLEAN guitar playing power chords — MoP's Guitar 1, program 27,
                doubles the distortion riff; its ordinary chords go on to the strummer)
     'sustain'  the old bowls rule: poly ≥ MONO or a long median note (≥ 2 s) — a single moving
                line stays a belt melody (Canon's violins)
     'any'      always
   few: a sustained voice that needs FEW bowls (≤ BOWL_FEW pitches, long notes) stays a bowls
   bed — the organ takes the big chords (corpus: Titanic 30 pitches, Queen's choir 33).
   The numbers come from the corpus study (research midi-routing.md §4–§5).               */
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
export const PREFER = [
  { key: 'riff',     programs: [28, 29, 30], shape: 'riff' },             // muted / overdriven / distortion: riffs, chugs
  { key: 'riff',     programs: [27], shape: 'riffOnly' },                 // a clean electric playing power chords
  { key: 'strum',    programs: [24, 25, 26, 27], shape: 'chordal' },      // nylon / steel / jazz / clean: strummed chords
  { key: 'strum',    programs: [46], shape: 'any' },                      // the harp: a fan of open strings is a harp
  { key: 'bowwheel', programs: [...range(40, 44), ...range(48, 51)], shape: 'sustain' },   // bowed: violin … contrabass, tremolo, ensembles
  { key: 'organ',    programs: [...range(16, 20), ...range(52, 54)], shape: 'sustain', few: true },   // organs, choir / voice
  { key: 'organ',    programs: [21, 22, 23], shape: 'chordal' },          // accordion / harmonica: a melody, unless it plays chords
  { key: 'organ',    programs: range(88, 95), shape: 'any', few: true },  // synth pads: always a bed
  { key: 'horns',    programs: range(56, 71), shape: 'chordal' },         // brass / reed SECTIONS (a single horn line is a melody)
  // ELECTRIC / SYNTH basses (fingered, picked, fretless, slap ×2, synth ×2) → the Pogo Bass. The
  // ACOUSTIC bass (32 — the upright / jazz bass) stays on the string bass's winched heavy balls.
  { key: 'pogo',     programs: range(33, 39), shape: 'any' },
];
/* LINE_HOME: a voice's family machine when it is a LINE the belts can't take (the lead is
   chosen; ≤ 3 belts) or a CHORDAL voice that may still lead (a piano: comping, unless it IS
   the tune) — tried before the generic spare-line chain and the marimba. */
export const LINE_HOME = [
  { key: 'riff',     programs: range(24, 31) },                         // a spare guitar line: the fretboard plays lines too
  { key: 'dulcimer', programs: range(0, 7) },                           // a spare / comping piano: the Marble Grand
  { key: 'horns',    programs: range(56, 71) },                         // a spare brass / reed line
  { key: 'bowwheel', programs: [...range(40, 44), ...range(48, 51)] },  // a spare string line (Canon's 4th violin)
  { key: 'organ',    programs: [...range(16, 23), ...range(52, 54)] },  // a spare organ / choir line
];
export const BOWL_FEW = 8;
/* OVERFLOW_TO: where a FULL machine's voices go next (instead of being dropped) — a guest
   there, subject to that machine's own voice cap (the marimba also caps its guests). A chain
   is processed upstream-first (bowwheel → organ → bowls), so it may not loop.              */
export const OVERFLOW_TO = {
  volley: 'marimba',          // a second steel-pan voice → struck bars
  riff: 'marimba',            // a third guitar → struck bars (the legacy guitar home)
  pogo: 'bass',               // a second electric bass → the string bass
  strum: 'dulcimer',          // a third comping guitar → struck strings
  dulcimer: 'marimba',
  bowwheel: 'organ',          // a big string section → the organ's pad voice (C4|pad)
  horns: 'organ',             // a third horn section → organ pipes
  organ: 'bowls',             // a fourth bed → the singing bowls
};
/** the PREFER machine for a voice, or null. v: voice statistics ({program, poly, medDur, riff,
    pitches}) — or the legacy (program, chordal) pair */
export function preferFor(v, chordal){
  if (typeof v === 'number') v = { program: v, poly: chordal ? 1 : 0, medDur: 0, riff: false, pitches: Infinity };
  for (const p of PREFER){
    if (!PART_SPEC[p.key] || !p.programs.includes(v.program)) continue;
    const ok = p.shape === 'any' ? true
      : p.shape === 'chordal' ? v.poly >= LINE
      : p.shape === 'riff' ? v.poly >= LINE || v.riff
      : p.shape === 'riffOnly' ? v.riff
      : v.poly >= MONO || v.medDur >= 2;                                 // 'sustain'
    if (!ok) continue;
    // a machine with a part-wide onset floor (the autoharp: strums ≥ .2 s apart) must KEEP the voice —
    // a harp's running arpeggio would lose a third of its notes there; it falls through to the next home
    const S = PART_SPEC[p.key];
    if (S.ioi && v.notes && v.spt && ioiFit(v.notes, S.ioi, v.spt, S.chordEps || 0) < PREFER_FIT) continue;
    if (p.few && PART_SPEC.bowls && v.pitches <= BOWL_FEW && v.medDur >= ROLE.SUSTAIN) return 'bowls';
    return p.key;
  }
  return null;
}
/** the share of a voice's ONSETS a machine with a part-wide onset floor `ioi` (s) keeps (greedy, as
    shapePart thins; onsets within `eps` s are one strum — the machine's chordEps). secPerTick: the tempo. */
export const PREFER_FIT = .85;
export function ioiFit(notes, ioi, secPerTick, eps = 0){
  const ts = [...new Set(notes.map(n => Math.round(n.tick * secPerTick * 1e6) / 1e6))].sort((a, b) => a - b);
  let last = -Infinity, prev = -Infinity, all = 0, kept = 0;
  for (const t of ts){
    if (t - prev <= eps + 1e-9) continue;                          // (the same strum)
    prev = t; all++;
    if (t - last >= ioi - 1e-9){ kept++; last = t; }
  }
  return all ? kept / all : 1;
}
/** a voice's family machine for a spare line / a comping voice (LINE_HOME), or null */
export function lineHome(v){
  for (const h of LINE_HOME) if (PART_SPEC[h.key] && h.programs.includes(v.program)) return h.key;
  return null;
}
/* ---- per-machine TIMBRE / ARTICULATION on the note id (each plugin's own id grammar) ----
   A part event's note may carry a suffix the machine reads (see each index.js header):
     riff      'E2:m' palm mute (the MIDI note is shorter than RIFF_MUTE_SEC, or every voice on it
               is a Muted Guitar, 28) · ':c' the clean amp (every voice on it is a clean / acoustic
               guitar, 24–27 — a clean guitar DOUBLING a distortion riff plays through the dirt)
     strum     'E3|n' nylon (24) · 'E3|h' harp (46) · steel otherwise
     organ     'C4|choir' (choir / voice 52–54, voice lead 85) · 'C4|pad' (strings 40–51, synth
               pads 88–95) · the organ otherwise
     dulcimer  'C4:e' the tine e-piano (Rhodes / DX 4–5, clavinet 7)
     pogo      'E1:s' slap (36 / 37) · 'E1:p' picked (34) · 'E1:y' synth bass (38 / 39) · fingered otherwise
   The bowwheel and horns have one voice (the horns pick tuba / trombone / trumpet by register);
   a merged note (two voices on one beat + pitch) takes the louder one's timbre.            */
export const RIFF_MUTE_SEC = .15;
/* ctx (shapePart's whole-part view — optional): onsetProgs = the programs sounding at each beat; prog =
   the part's dominant program. The Riff Forge's amp is per HIT (the plugin makes a whole hit clean if ANY
   note says ':c'), so clean needs EVERY voice on that onset clean — a clean guitar's extra note beside a
   distortion chord must not clean the chord. The autoharp's strings are keyed by id (pitch + variant), so
   its variant is one per PART (mixed variants would string the same pitch twice). */
export function noteSuffix(key, n, spb, ctx = null){
  const p = n.prog ?? 0, ps = n.progs || [p];
  switch (key){
    case 'riff': {
      const mute = ps.every(x => x === 28) || (n.dur != null && n.dur * spb < RIFF_MUTE_SEC);
      const clean = (ctx?.onsetProgs?.get(n.beat) || ps).every(x => x >= 24 && x <= 27);
      return mute || clean ? ':' + (mute ? 'm' : '') + (clean ? 'c' : '') : '';
    }
    case 'strum': { const q = ctx?.prog ?? p; return q === 24 ? '|n' : q === 46 ? '|h' : ''; }
    case 'organ': return (p >= 52 && p <= 54) || p === 85 ? '|choir' : (p >= 40 && p <= 51) || (p >= 88 && p <= 95) ? '|pad' : '';
    case 'dulcimer': return p === 4 || p === 5 || p === 7 ? ':e' : '';
    case 'pogo': return p === 36 || p === 37 ? ':s' : p === 34 ? ':p' : p === 38 || p === 39 ? ':y' : '';
    default: return '';
  }
}

/* ---- TRACK NAMES: programs lie, names don't ----------------------------------
   A sequenced file's programs are often placeholders (Master of Puppets' bass tracks are
   programs 26/28 — jazz / muted guitar — and its vocals 31/21), while the names a person
   typed are right. nameRole reads a TRACK name (never the GM fallback name) → a role, or
   null when it says nothing ("ch3", "Track 2", "81", "Staff-1"):
     'drums'    a kit (not steel drums / synth drum / melodic toms) — convert.js moves a
                drum-named track OFF channel 10 to the drum lanes when its keys are GM drums
     'bass'     a bass line → the string bass ("Bass (left)", "Synth Bass", "Bass Lead")
     'lead'     the tune → the belt lead, ahead of busier voices ("Vocals", "Melody", "Lead")
                — not a counter-melody / backing / harmony / fill / solo
     'guitar'   a guitar ("Rhythm Guitar", "Gtr", "Riff"): a belt voice, never a "low line"
     'sustain'  strings / choir / organ / pad / ensemble → bowls when chordal, else belt     */
export function nameRole(name = ''){
  const s = String(name || '').toLowerCase().trim();
  if (!s || /^(ch|tk|track|staff|part|inst(rument)?)?[\s#_-]*\d+$/.test(s)) return null;
  if (/\b(bass\s*drum|kick)\b/.test(s)) return 'drums';
  if (/\b(drums?|drum\s*kit|drumset|percussion|perc|kit)\b/.test(s) && !/steel|synth\s*drum|melodic|taiko/.test(s)) return 'drums';
  if (/\b(bass|contra\s*bass|double\s*bass|basse|bajo)\b/.test(s) || /\bbass(line|es)?\b/.test(s)) return 'bass';
  if (/\b(vocals?|voc|voice|vox|sing(er|ing)?|lyrics?|melody|melodie|lead)\b/.test(s) &&
      !/counter|support|harmon|backing|back(ground)?\b|bgv|choir|oohs?|aahs?|\bfill|\bsolo/.test(s)) return 'lead';
  if (/guitar|gtr|guit\b|riff|rhythm|rhthym|rythm|strum|power\s*chord/.test(s)) return 'guitar';
  if (/string|violin|viola|cello|choir|aahs?\b|oohs?\b|organ|\bpad\b|ensemble/.test(s)) return 'sustain';
  return null;
}
const NAME_HOME = { bass: 'bass', lead: 'belt', guitar: 'belt', sustain: 'sustain' };
/** the share of a voice's onsets a machine with a same-pitch recovery `gap` (s) keeps (greedy, as
    shapePart thins). secPerTick: the tempo. A NAMED bass goes to the string bass only if it fits
    (≥ BASS_FIT). What a .15 s gap thins is SAME-PITCH repeats: MoP's 8th-note bass at 220 bpm (.136 s
    on one string) keeps 75% — every pitch change, its pedal E as quarters, while the Riff Forge and
    the kit carry the 8th-note chug. (It was .8 while no guitar machine held the pulse; a bass that is
    all one-pitch 8ths keeps 50% and stays a belt line.) */
export const BASS_FIT = .7;
export function gapFit(notes, gap, secPerTick){
  const by = new Map();
  for (const n of notes){ const t = Math.round(n.tick * secPerTick * 1e6) / 1e6; if (!by.has(n.midi)) by.set(n.midi, new Set()); by.get(n.midi).add(t); }
  let all = 0, kept = 0;
  for (const ts of by.values()){
    let last = -Infinity;
    for (const t of [...ts].sort((a, b) => a - b)){ all++; if (t - last >= gap - 1e-9){ kept++; last = t; } }
  }
  return all ? kept / all : 1;
}
const isGuitar = v => (v.program >= 24 && v.program <= 31) || v.role === 'guitar';
/** an ELECTRIC bass voice (→ the Pogo Bass): an electric / synth bass program (33–39), or a NAMED bass on
    any program but the acoustic bass (32) and the orchestral families (strings, ensembles, brass, reed:
    40–71 — "Contrabass", "Strings (as bass)", a tuba). Needs the machine (PART_SPEC.pogo). */
export const UPRIGHT_BASS = new Set([32, ...Array.from({ length: 32 }, (_, i) => 40 + i)]);
export const electricBass = v => !!PART_SPEC.pogo && ((v.program >= 33 && v.program <= 39) || (v.role === 'bass' && !UPRIGHT_BASS.has(v.program)));

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
  // volley: ONE marble volleyed between two pad walls (a steel pan's voice): monophonic; a hop
  // no quicker than VOLLEY_MIN_HOP (its solver's measured floor, GEOM.MIN_HOP); the staff is
  // vertical so any range reads, but a pan's sweet range is G3–E6; 160 pads = editor LINE_SPEC
  volley:    { lo: 55, hi: 88, center: 72, pitches: 24, poly: 1, gap: .2,  ioi: .2,  voices: 1, maxEvents: 160 },
  /* ---- the family machines: each spec is its plugin's own PART_LIMITS (solve.js) ----
     riff      a six-string fretboard: poly = the strings; gap = one STRING's re-strike floor (a
               repeat may also move to another string — the solver fingers it); pitches is only a
               fold cap (the lanes are strings, not pitches). Its budget counts HITS (a chord is
               one): ×2 notes ≈ a power-chord riff's hits. durs: every hit carries its length
               (the hook lifts — and the live voice releases — at the note's end).
     strum     an autoharp fan: one string per pitch; strums ≥ .2 s apart always fit
     organ     a pipe per pitch, 12 voices per onset; sustained .06–8 s
     horns     a horn per pitch (≤ 12); a stab or a held note (≤ 2.6 s)
     bowwheel  ≤ 12 bowed strings; same-pitch onsets ≥ MIN_REPEAT (closer MERGE into one stroke);
               poly 6 is musical (a section), not mechanical (all 12 can bow at once)
     dulcimer  the Marble Grand: ≤ 20 strings, ≤ 8 per onset, the damper honours ≤ 4.5 s      */
  riff:      { lo: RIFF_LIMITS.lo, hi: RIFF_LIMITS.hi, center: RIFF_LIMITS.center, pitches: 36, poly: RIFF_LIMITS.poly,
               gap: RIFF_LIMITS.gap, ioi: 0, voices: 2, maxEvents: 2 * RIFF_LIMITS.maxEvents, durs: true },
  strum:     { lo: STRUM_LIMITS.lo, hi: STRUM_LIMITS.hi, center: STRUM_LIMITS.center, pitches: STRUM_LIMITS.pitches, poly: STRUM_LIMITS.poly,
               gap: STRUM_LIMITS.gap, ioi: STRUM_LIMITS.ioi, voices: STRUM_LIMITS.voices, maxEvents: STRUM_LIMITS.maxEvents,
               chordEps: STRUM_LIMITS.chordEps, sustain: true, minDur: STRUM_LIMITS.minDur, maxDur: STRUM_LIMITS.maxDur },
  organ:     { lo: ORGAN_LIMITS.lo, hi: ORGAN_LIMITS.hi, center: ORGAN_LIMITS.center, pitches: ORGAN_LIMITS.pitches, poly: ORGAN_LIMITS.poly,
               gap: ORGAN_LIMITS.gap, ioi: 0, voices: ORGAN_LIMITS.voices, maxEvents: ORGAN_LIMITS.maxEvents,
               sustain: true, minDur: ORGAN_LIMITS.minDur, maxDur: ORGAN_LIMITS.maxDur },
  horns:     { lo: HORNS_LIMITS.lo, hi: HORNS_LIMITS.hi, center: HORNS_LIMITS.center, pitches: HORNS_LIMITS.pitches, poly: HORNS_LIMITS.poly,
               gap: HORNS_LIMITS.gap, ioi: 0, voices: HORNS_LIMITS.voices, maxEvents: HORNS_LIMITS.maxEvents,
               sustain: true, minDur: HORNS_LIMITS.minDur, maxDur: HORNS_LIMITS.maxDur },
  bowwheel:  { lo: BOWWHEEL_LIMITS.lo, hi: BOWWHEEL_LIMITS.hi, center: 62, pitches: BOWWHEEL_LIMITS.pitches, poly: 6,
               gap: BOWWHEEL_LIMITS.gap, ioi: 0, voices: 4, maxEvents: BOWWHEEL_LIMITS.maxEvents,
               sustain: true, minDur: BOWWHEEL_LIMITS.minDur, maxDur: BOWWHEEL_LIMITS.maxDur },
  dulcimer:  { lo: DULCIMER_LIMITS.lo, hi: DULCIMER_LIMITS.hi, center: DULCIMER_LIMITS.center, pitches: DULCIMER_LIMITS.pitches,
               poly: DULCIMER_LIMITS.poly, gap: DULCIMER_LIMITS.gap, ioi: 0, voices: DULCIMER_LIMITS.voices,
               maxEvents: DULCIMER_LIMITS.maxEvents, sustain: true, minDur: DULCIMER_LIMITS.minDur, maxDur: DULCIMER_LIMITS.maxDur },
  /* pogo      the POGO BASS: a four-string electric bass, one pogo stick bouncing on each string, fret
               carriages pre-move (pitch = position). E1–G3; a line + the odd double stop (poly 2 — the
               strings voice 4); gap = one PITCH's re-strike floor (.1 s: 220-bpm 8ths are .136 s); pitches
               is only a fold cap (the lanes are strings: E1–G3 = 28 semitones); every hit carries its length
               (the hook lifts — and the live voice releases — at the note's end) */
  pogo:      { lo: POGO_LIMITS.lo, hi: POGO_LIMITS.hi, center: POGO_LIMITS.center, pitches: POGO_LIMITS.hi - POGO_LIMITS.lo + 1,
               poly: POGO_LIMITS.poly, gap: POGO_LIMITS.gap, ioi: POGO_LIMITS.ioi, voices: POGO_LIMITS.voices,
               maxEvents: POGO_LIMITS.maxEvents, durs: true },
};
export const VOLLEY_MIN_HOP = .2;   // mirrors volley GEOM.MIN_HOP (asserted in test/midi-orchestra)
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
  const seen = new Set(), ns0 = [];
  for (const n of notes){ const k = `${quantizeTick(n.tick)}|${n.midi % 12}`; if (!seen.has(k)){ seen.add(k); ns0.push(n); } }
  // a POWER CHORD (root + fifth, ± octaves) is one note too — a riff's chug is a line, not comping:
  // keep the root (the lowest) of an onset whose pitch classes are exactly {r, r + 7}
  const at = new Map();
  for (const n of ns0){ const q = quantizeTick(n.tick); if (!at.has(q)) at.set(q, []); at.get(q).push(n); }
  const ns = [];
  for (const g of at.values()){
    if (g.length === 2 && Math.min(g[0].midi, g[1].midi) < RIFF.MAX_MEAN && isPowerChord(g.map(n => n.midi))) ns.push(g[0].midi < g[1].midi ? g[0] : g[1]);
    else ns.push(...g);
  }
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
/* ---- chord → ONE note: the top, or the ROOT of a riff ------------------------
   A one-marble line (a belt, the turntable, the ricochet, the volley) plays one note per
   onset. For a piano / lead / brass chord the TOP note is the melody (the legacy rule). For a
   RIFF it is not: a power chord (root + fifth, ± octaves — MoP's 0·7 ×414, 0·7·12 ×140) puts the
   fifth or the octave on top, so a top-note line loses the riff's identity: its ROOT MOTION.
   riffLike: a voice in the guitar/bass register (mean < RIFF.MAX_MEAN — a high voice's fifths
   are a harmonised melody) whose chords (≥ RIFF.MIN_CHORDS) are mostly (≥ RIFF.SHARE) power
   chords. Its every chord reduces to its LOWEST note. onsetOf(n) → the note's onset key.   */
export const RIFF = { MAX_MEAN: 64, SHARE: .5, MIN_CHORDS: 4 };
export function isPowerChord(midis){
  const lo = Math.min(...midis);
  return midis.length > 1 && midis.every(m => (m - lo) % 12 === 0 || (m - lo) % 12 === 7) && midis.some(m => (m - lo) % 12 === 7);
}
export function riffLike(notes, onsetOf){
  if (!notes.length) return false;
  const mean = notes.reduce((s, n) => s + n.midi, 0) / notes.length;
  if (mean >= RIFF.MAX_MEAN) return false;
  const by = new Map();
  for (const n of notes){ const k = onsetOf(n); if (!by.has(k)) by.set(k, new Set()); by.get(k).add(n.midi); }
  let chords = 0, power = 0;
  for (const s of by.values()){
    if (new Set([...s].map(m => m % 12)).size < 2) continue;      // (an octave doubling is one note, not a chord)
    chords++;
    if (isPowerChord([...s])) power++;
  }
  return chords >= RIFF.MIN_CHORDS && power >= RIFF.SHARE * chords;
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
      // role: what the TRACK's own name says (never the GM fallback name)
      voices.push(voiceStats({ name, notes, program, channel: notes[0].channel, role: nameRole(nm) }, q12, secPerTick, ppq));
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
    riff: riffLike(notes, n => q12(n.tick)),                              // power chords in the guitar register
    spt: secPerTick,
    pitches: new Set(notes.map(n => n.midi)).size,
  });
}

/** A PINNED lead (convert.js's phrase window: the loop keeps the whole song's lead): the voice that
    is mostly (≥ half) pin notes, the most of them; null when none is. pin: a Set of note objects. */
function pinnedVoice(vs, pin){
  if (!pin) return null;
  let best = null, bn = 0;
  for (const v of vs){
    let k = 0; for (const n of v.notes) if (pin.has(n)) k++;
    if (k >= .5 * v.notes.length && k > bn){ best = v; bn = k; }
  }
  return best;
}

/** The lead rule (see above), shared by program and role routing. vs: candidates.
    A NAMED lead (nameRole 'lead': "Vocals", "Melody") is the file author's word for the tune: among
    the candidates that pass the rules it wins over busier voices (a chugging rhythm guitar out-notes
    a sung line 8:1), when it is a real line (≥ NAMED_MIN onsets and ≥ NAMED_SHARE of the busiest's).
    windowed: the import will loop a PHRASE window (convert.js), where the lead's intro / tail / long
    mid-song rests don't cost the loop anything (the window is chosen where the lead plays) — so when
    no named lead passes the rules, one that spans ≥ NAMED_SPAN of the song may still lead (a singer
    who enters after a long guitar intro). */
export const NAMED_MIN = 16, NAMED_SHARE = .1, NAMED_SPAN = .25;
function pickLead(vs, span0, span1, { windowed = false } = {}){
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
  const pool = present.length ? present : ok;
  const busiest = Math.max(...vs.map(v => v.onsets));
  const real = v => v.role === 'lead' && v.onsets >= Math.max(NAMED_MIN, NAMED_SHARE * busiest);
  let named = pool.filter(real);
  if (!named.length && windowed) named = vs.filter(v => real(v) && v.last - v.first >= NAMED_SPAN * span);
  return legacy(named.length ? named : pool);
}

export function orchestrate(tracks, { ppq, bpm, pin = null, windowed = false }){
  const warnings = [];
  const q12 = tick => Math.round(tick / ppq * 12) / 12;
  const voices = makeVoices(tracks, { ppq, bpm });

  const routed = [];
  for (const v of voices){
    v.home = routeProgram(v.program);
    // the track's NAME before its program (a "Bass" played by a guitar program is a bass)
    let byName = nameHome(v);
    // a NAMED bass that is ELECTRIC (any program but the upright / orchestral ones — a rock file's
    // "Bass" is a bass guitar, often on a placeholder guitar program: MoP's are 26 / 28) bounces on
    // the Pogo Bass when it keeps up with the line (its .1 s same-pitch floor: 220-bpm 8ths fit)
    if (byName === 'bass' && electricBass(v) && gapFit(v.notes, PART_SPEC.pogo.gap, 60 / bpm / ppq) >= BASS_FIT) byName = 'pogo';
    if (byName === 'bass' && v.home !== 'bass'){
      const fit = gapFit(v.notes, PART_SPEC.bass.gap, 60 / bpm / ppq);
      if (fit < BASS_FIT){
        warnings.push(`"${v.name}" is named a bass, but the string bass could play only ${Math.round(fit * 100)}% of it at ${bpm} bpm ` +
                      `(its repeats come faster than ${PART_SPEC.bass.gap}s) — it stays a belt line`);
        byName = null;
      }
    }
    if (byName && byName !== v.home && !(byName === 'pogo' && v.home === 'bass'))
      warnings.push(`"${v.name}" plays as a ${v.role === 'sustain' ? 'sustained part' : v.role} by its name (its program is ${GM_NAMES[v.program]})`);
    if (byName && byName !== v.home) v.home = byName;
    if (v.home === null){
      warnings.push(`dropped "${v.name}" (${GM_NAMES[v.program]}: no instrument in the room plays sound effects)`);
      continue;
    }
    v.dest = v.home;
    if (v.home === 'sustain') v.dest = v.poly >= MONO || v.medDur >= 2 ? 'bowls' : 'belt';
    v.home0 = v.home;                                       // (the family home, before a purpose-built machine)
    // a purpose-built machine for this program + shape (a NAMED bass / lead keeps its name's home;
    // a named bass's program never names a machine anyway — MoP's bass tracks are 26 / 28)
    const pref = v.role !== 'bass' && v.role !== 'lead' && (v.home === 'belt' || v.home === 'sustain' || v.home === routeProgram(v.program))
      ? preferFor(v) : null;
    if (pref) v.dest = v.home = pref;
    else if (v.home === 'sustain' && v.dest === 'bowls' && v.role === 'sustain'){
      // a NAMED string / choir / organ track with a piano program: its family machine by the name
      const k = /string|violin|viola|cello|fiddle/i.test(v.name) ? 'bowwheel' : 'organ';
      if (PART_SPEC[k] && !(v.pitches <= BOWL_FEW && v.medDur >= ROLE.SUSTAIN)) v.dest = v.home = k;
    }
    routed.push(v);
  }
  if (!routed.length) return { belt: [], parts: [], warnings, squashed: false, voices: 0 };

  const span0 = Math.min(...routed.map(v => v.first)), span1 = Math.max(...routed.map(v => v.last));
  const span = Math.max(1, span1 - span0);
  for (const v of routed) v.score = v.onsets * Math.max(.05, (v.last - v.first) / span);   // busy AND lasting
  const byScore = (a, b) => b.score - a.score || a.first - b.first;

  // --- the lead ---
  // candidates by FAMILY home (before the purpose-built machines): who may lead is exactly the
  // legacy rule. A lead that has a family machine (a chordal string section, an accordion playing
  // chords, a power-chord riff) plays its top line on the belt AND keeps its machine — its chords
  // would be lost otherwise.
  const eligible = routed.filter(v => v.home0 === 'belt' || v.home0 === 'sustain');
  let lead = null, doubled = false;
  if (eligible.length){
    lead = pinnedVoice(eligible, pin) || pickLead(eligible, span0, span1, { windowed });
    if (lead.home !== lead.home0 && lead.dest !== 'belt' && lead.dest !== 'bowls'){
      warnings.push(`"${lead.name}" leads the belt (its top line) and still plays the ${lead.dest}`);
      lead.doubles = true;
    } else if (lead.dest !== 'belt'){
      warnings.push(`"${lead.name}" leads the belt (its top line) instead of the ${lead.dest}`);
      lead.dest = 'belt';
    }
  } else {
    // no melodic spine at all (a mallet / pad / bass-only file): the belt lead DOUBLES the
    // most melodic routed voice (top line), which keeps playing its own machine too.
    // Prefer the voice that ENTERS first (to the bar), then the most melodic kind, then the busiest.
    const rank = { musicbox: 0, marimba: 0, dulcimer: 0, turntable: 0, volley: 0, ricochet: 0, bells: 1, riff: 1, strum: 1, horns: 1,
                   bowls: 2, organ: 2, bowwheel: 2, bass: 3, pogo: 3 };
    const rk = v => rank[v.dest] ?? 2;
    lead = [...routed].sort((a, b) => (Math.floor(a.first / 4) - Math.floor(b.first / 4)) || (rk(a) - rk(b)) ||
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
    // a DOUBLED track (the same line panned left + right — exact pitches: an octave doubling stays a second belt) is one belt, not two
    const dup = belt.find(b => twins(b.notes, v.notes, q12));
    if (dup){ warnings.push(`belt: "${v.name}" doubles "${dup.name}" — merged`); continue; }
    if (v.poly < LINE && belt.length < 3) belt.push(v);
    else overflow.push(v);
  }
  for (const v of routed) if (v.dest !== 'belt' && (doubled || v !== lead || v.doubles)) put(v.dest, v, true);
  const loopSec = ROLL_T + (span1 - lead.first + 1) * 60 / bpm;   // ≈ the loop the machines will see
  const room = k => !!PART_SPEC[k] && (want.get(k)?.length ?? 0) < PART_SPEC[k].voices;
  for (const v of overflow){
    const free = k => !want.has(k);
    const fam = lineHome(v);
    if (v.poly < LINE && lowLine(v) && free('bass')){ put('bass', v, false); v.why = 'a spare low line'; }
    else if (v.poly < LINE && v.mean >= 76 && free('musicbox')){ put('musicbox', v, false); v.why = 'a spare high line'; }
    else if (fam && room(fam)){ put(fam, v, false); v.why = v.poly >= LINE ? `chordal — its family's machine keeps its chords` : `a spare ${GM_NAMES[v.program].toLowerCase()} line`; }
    else if (v.poly < LINE && free('turntable')){ put('turntable', v, false); v.why = 'a spare melodic line'; }
    else if (v.poly < LINE && free('ricochet') && loopSec <= PART_SPEC.ricochet.maxLoop){ put('ricochet', v, false); v.why = 'a spare melodic line'; }
    else if (v.poly < LINE && free('volley')){ put('volley', v, false); v.why = 'a spare melodic line'; }
    else { put('marimba', v, false); v.why = v.poly >= LINE ? 'chordal — struck bars keep its chords' : 'no belt left'; }
  }

  // --- each machine takes its best voices (natives first), the rest are reported ---
  const parts = [];
  let vid = 0;
  // upstream machines first (an OVERFLOW_TO chain: bowwheel → organ → bowls — their spare voices
  // become guests downstream); stable registry order within a depth
  const keys = Object.keys(PART_SPEC), order = overflowOrder(keys);
  for (const key of order){
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
        const to = OVERFLOW_TO[key];
        if (to && PART_SPEC[to]){ v.why = `the ${key} already plays ${kept.length} voice${kept.length > 1 ? 's' : ''}`; put(to, v, false); continue; }
        warnings.push(`dropped "${v.name}" (${GM_NAMES[v.program]}): the ${key} already plays ${kept.length} voice${kept.length > 1 ? 's' : ''}`);
        continue;
      }
      if (!native){ guests++; warnings.push(`"${v.name}" (${GM_NAMES[v.program]}) plays on the ${key} (${v.why})`); }
      v.vid = vid++;
      kept.push(v);
      parts.push(entry(key, v, v.vid));
    }
  }
  parts.sort((a, b) => keys.indexOf(a.key) - keys.indexOf(b.key));     // registry order (stable)
  return { belt: belt.map(v => ({ name: v.name, notes: v.notes })), parts, warnings, squashed: belt.some(v => v.poly >= LINE), voices: routed.length };
}
/** PART_SPEC keys, every machine before the ones it overflows into (OVERFLOW_TO depth, deepest
    upstream first; registry order within a depth). Throws on a cycle (a config error). */
export function overflowOrder(keys){
  const depth = k => { let d = 0; for (let x = k, seen = new Set(); OVERFLOW_TO[x]; x = OVERFLOW_TO[x]){
    if (seen.has(x)) throw new Error(`orchestra: OVERFLOW_TO loops at "${x}"`); seen.add(x); d++; } return d; };
  return [...keys].sort((a, b) => depth(b) - depth(a) || keys.indexOf(a) - keys.indexOf(b));
}
/** the home a voice's NAME gives it (nameRole), or null to keep its program's. A name only
    overrules a program that agrees on register: a "Bass" track must sit low, and a "Vocals" /
    "Guitar" / "Strings" track keeps a plugin program that already names its machine. */
function nameHome(v){
  if (!v.role || v.role === 'drums') return null;
  if (v.role === 'bass') return v.mean < ROLE.BASS_MAX ? 'bass' : null;
  const prog = routeProgram(v.program);
  if (v.role === 'sustain') return prog === 'belt' ? 'sustain' : null;   // (a named pad keeps bowls; a "String" piano becomes sustain)
  return prog === 'bass' || prog === 'sustain' || prog === 'belt' ? NAME_HOME[v.role] : null;   // lead / guitar → a belt voice
}
/** a LOW LINE (a bass line): below ROLE.LOW — or, for a guitar, below its lowest string (a "guitar"
    whose mean sits under E2 is a mislabelled bass: MoP's bass tracks are programs 26/28) */
export const lowLine = v => v.role === 'bass' || v.mean < (isGuitar(v) ? ROLE.GTR_LOW : ROLE.LOW);
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
/* ROLE.LOW — the bass/line register boundary. It was 50 (D3); the corpus (57 files, research
   midi-routing.md §2) puts every bass-program voice at mean 30–42 (the octave-3 synth basses at
   53–58 route by their program anyway) and the rhythm guitars at 42–80, six of them at 46–49 —
   MoP's distortion rhythm guitar (47) was routed as "a low line" onto the string bass while the
   real bass went to the belts. 46 (A#2) clears the highest bass by a major third and lets those
   guitars be guitars; a guitar (program 24–31 / a guitar-named track) is a low line only below
   GTR_LOW (E2, its lowest open string — a "guitar" lower than that is a mislabelled bass). The
   lead floor stays where it was (LEAD_MIN = the old LOW + 5): who may lead did not change.
   BASS_MAX: a "Bass"-named track goes to the string bass only if it sits below this. */
export const ROLE = { LOW: 46, GTR_LOW: 40, LEAD_MIN: 55, BASS_MAX: 55, HIGH: 79, SPARK: .3, SUSTAIN: 1.2, SPLIT: 12 };

/** Split a chordal voice into top line / bottom line / inner notes. A 2-means split of
    its pitches finds the hands (if the clusters sit < ROLE.SPLIT semitones apart there is
    only one hand: no bottom line). The top line = the highest note of each onset unless a
    higher top note is still sounding (then it's an inner voice); the bottom line mirrors it. */
export function splitHands(notes, q12, { riff = false } = {}){
  const ms = notes.map(n => n.midi);
  let c0 = Math.min(...ms), c1 = Math.max(...ms);
  for (let it = 0; it < 12; it++){
    const lo = ms.filter(m => Math.abs(m - c0) <= Math.abs(m - c1)), hi = ms.filter(m => Math.abs(m - c0) > Math.abs(m - c1));
    if (!lo.length || !hi.length) break;
    c0 = lo.reduce((s, m) => s + m, 0) / lo.length; c1 = hi.reduce((s, m) => s + m, 0) / hi.length;
  }
  const twoHands = !riff && c1 - c0 >= ROLE.SPLIT;          // (a riff's octave doublings are not a left hand)
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
  // (a RIFF's line is its root motion: one hand of power chords reads bottom-up — see riffLike)
  const top = line(upper, !riff), bottom = lower.length ? line(lower, false) : new Set();
  const order = (a, b) => a.tick - b.tick || a.midi - b.midi;
  return { top: [...top].sort(order), bottom: [...bottom].sort(order),
           inner: notes.filter(n => !top.has(n) && !bottom.has(n)).sort(order) };
}

export function orchestrateByRole(tracks, { ppq, bpm, programs = false, reason = 'no program data', pin = null, windowed = false }){
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
  // (a NAMED lead — "Vocals", "Melody" — may sit low or sparkle; on a phrase-window import its intro / tail cost nothing)
  const named = v => v.role === 'lead' && v.onsets >= NAMED_MIN;
  const canLead = v => isLine(v) && !v.comp && !v.low && (named(v) || (!sparkly(v) && v.mean >= ROLE.LEAD_MIN)) &&
    ((windowed && named(v)) || (intro(v) <= LEAD_INTRO && tail(v) <= Math.max(16, (span1 - span0) / 4)));

  // no line that could lead: split the busiest (× longest) chordal voice into its hands
  if (!voices.some(canLead)){
    const span = Math.max(1, span1 - span0);
    const chordal = voices.filter(v => !isLine(v) && v.notes.length >= 8)
      .sort((a, b) => b.onsets * (b.last - b.first + 1) / span - a.onsets * (a.last - a.first + 1) / span);
    const v = chordal[0];
    if (v){
      const riff = riffLike(v.notes, n => q12(n.tick));
      const { top, bottom, inner } = splitHands(v.notes, q12, { riff });
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

  // each voice's SHAPE → its machines, best first. The family machines (riff / strum / organ /
  // horns / bowwheel / dulcimer) come first where the shape AND (with program data) the family
  // say so: a sustained bed → the organ (a few long notes: the bowls); comping chords → the Marble
  // Grand (a piano — the GM default, so every program-less file), a guitar's → the autoharp, a
  // power-chord riff → the Riff Forge.
  const fam = v => programs ? v.program : 0;                // (no program data: everything is "piano")
  const isGtr = v => programs && v.program >= 24 && v.program <= 31;
  for (const v of voices){
    const p = fam(v), pref = programs ? preferFor(v) : null;
    if (!isLine(v) || v.comp || (v.riff && isGtr(v))){   // (a split's inner notes are the accompaniment, even when they arpeggiate one at a time)
      if (v.riff && isGtr(v)){ v.kind = 'a power-chord riff'; v.prefs = ['riff', 'strum', 'marimba']; }
      else if (v.medDur >= ROLE.SUSTAIN || v.role === 'sustain'){ v.kind = 'a sustained chordal bed';
        const few = v.pitches <= BOWL_FEW;
        v.prefs = pref === 'bowwheel' ? ['bowwheel', 'organ', 'bowls', 'marimba'] : few ? ['bowls', 'organ', 'marimba'] : ['organ', 'bowls', 'marimba']; }
      else if (v.mean >= ROLE.HIGH - 3){ v.kind = 'high chords'; v.prefs = ['musicbox', 'marimba', 'bowls']; }
      else { v.kind = 'chords / arpeggios';
        v.prefs = isGtr(v) ? ['strum', 'riff', 'marimba', 'bowls']
          : pref === 'horns' ? ['horns', 'marimba', 'organ']
          : pref && pref !== 'bowls' ? [pref, 'marimba', 'bowls']
          : p <= 7 ? ['dulcimer', 'marimba', 'bowls'] : ['marimba', 'dulcimer', 'bowls']; }
    } else if ((lowLine(v) && v.role !== 'lead') || v.low){ v.kind = v.low ? 'the left hand\'s bass line' : v.role === 'bass' ? 'a bass line (by its name)' : 'a low line';
      // (a named bass the string bass can't keep up with — repeats faster than its gap — rides a belt first)
      // (an ELECTRIC bass bounces on the Pogo Bass; any other low line keeps the string bass first — and the pogo
      //  before the struck bars when both are taken)
      v.prefs = programs && electricBass(v) ? ['pogo', 'bass', 'belt', 'marimba']
        : v.role === 'bass' && gapFit(v.notes, PART_SPEC.bass.gap, secPerTick) < BASS_FIT ? ['belt', 'bass', 'pogo', 'marimba'] : ['bass', 'belt', 'pogo', 'marimba']; }
    else if (programs && routeProgram(v.program) === 'volley'){ v.kind = 'a steel-pan line'; v.prefs = ['volley', 'turntable', 'alto', 'belt', 'marimba']; }
    else if (sparkly(v)){ v.kind = 'a high sparkly line'; v.prefs = ['musicbox', 'turntable', 'belt', 'marimba']; }
    else {
      // a guitar / brass / string line: its family's machine first (a piano / organ / accordion line
      // keeps the line machines — the Marble Grand and the organ are for its chords)
      const home = programs && ['riff', 'horns', 'bowwheel'].includes(lineHome(v)) ? lineHome(v) : null;
      v.kind = home ? `a ${GM_NAMES[v.program].toLowerCase()} line` : 'a melodic line';
      v.prefs = home ? [home, 'turntable', 'alto', 'ricochet', 'belt', 'volley', 'marimba']
                                            : ['turntable', 'alto', 'ricochet', 'belt', 'volley', 'marimba'];
    }
    v.prefs = v.prefs.filter(k => k === 'belt' || k === 'alto' || PART_SPEC[k]);
  }

  // the lead: the legacy choice among the lines that could lead (else any line, else anyone)
  const lines = voices.filter(v => isLine(v) && !v.comp && !v.low);
  const pool = voices.filter(canLead).length ? voices.filter(canLead) : lines.length ? lines : voices;
  const lead = pinnedVoice(voices.filter(v => !v.comp), pin) || pickLead(pool, span0, span1, { windowed });
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
        const twin = isLine(v) && belt.find(b => twins(b.notes, v.notes, q12));
        if (twin){ warnings.push(`belt: "${v.name}" doubles "${twin.name}" — merged`); placed = true; break; }
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
/** does voice a already play ≥ 90% of b's (onset, pitch class)s? exact: (onset, PITCH) */
export function covers(a, b, q, exact = false){
  const key = n => `${q(n.tick)}|${exact ? n.midi : n.midi % 12}`;
  const A = new Set(a.map(key));
  let hit = 0;
  for (const n of b) if (A.has(key(n))) hit++;
  return hit >= .9 * b.length;
}
/** TWINS on the belt: each plays ≥ 90% of the other's exact (onset, pitch)s — the same line panned
    left + right (MoP's bass L/R, a lead and its `"` copy). Only a true twin merges: a chordal piano
    that CONTAINS a guitar's line is not its twin, and an octave doubling on another belt is a
    second register the room can see (the belts never fold octaves the way a plugin's lanes do). */
export const twins = (a, b, q) => covers(a, b, q, true) && covers(b, a, q, true);

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

  // a RIFF voice (power chords in the low register) reduces to its root on a one-marble machine
  const riffV = new Set();
  if (S.poly === 1){
    const vs = new Map();
    for (const n of ns){ const v = n.voice ?? 0; if (!vs.has(v)) vs.set(v, []); vs.get(v).push(n); }
    for (const [v, list] of vs) if (riffLike(list, n => n.beat)) riffV.add(v);
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
    return { ...n, midi: m, raw: n.midi };
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
    if (!o) uniq.set(k, { ...n, progs: [n.prog ?? 0] });
    else {
      if (n.vel > o.vel) o.prog = n.prog;                // (the louder voice's timbre — noteSuffix)
      o.progs.push(n.prog ?? 0);
      o.vel = Math.max(o.vel, n.vel); o.dur = Math.max(o.dur ?? 0, n.dur ?? 0) || null;
    }
  }
  ns = [...uniq.values()].sort((a, b) => a.beat - b.beat || a.midi - b.midi);

  // 6. chord thinning: ≤ poly notes per onset — the outer voices first, then the loudest
  let thinned = 0, roots = 0;
  let groups = [];
  for (const n of ns){ const g = groups[groups.length - 1]; if (g && g.beat === n.beat) g.ns.push(n); else groups.push({ beat: n.beat, ns: [n] }); }
  for (const g of groups){
    if (g.ns.length <= S.poly) continue;
    const lo = g.ns[0], hi = g.ns[g.ns.length - 1];
    if (S.poly === 1){                                   // a single marble: the top line — a riff's root
      const root = g.ns.every(n => riffV.has(n.voice ?? 0)) ? g.ns.reduce((a, b) => (b.raw ?? b.midi) < (a.raw ?? a.midi) ? b : a) : null;
      if (root && root !== hi) roots++;
      thinned += g.ns.length - 1; g.ns = [root || hi]; continue;
    }
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
  if (thinned) say(`thinned ${plural(thinned, 'chord note')} (≤ ${S.poly} per onset)` +
                  (roots ? ` — kept the ROOT of ${plural(roots, 'power chord')} (a riff's line is its root motion)` : ''));
  if (released) say(`released ${plural(released, 'note')} early (≤ ${S.poly} sounding at once)`);

  // 8. lane recovery (same pitch) and 9. part-wide sparseness (bells)
  const lastAt = new Map();
  let lastOn = -Infinity, spaced = 0;
  let out = [];
  for (const g of groups){
    // (chordEps: onsets this close are ONE strum — a MIDI guitar's pre-rolled chord, spread over
    // the 1/12-beat grid — the machine merges them itself; the strum's start keeps the spacing)
    const sameStrum = S.chordEps && (g.beat - lastOn) * spb <= S.chordEps + 1e-9;
    if (S.ioi && !sameStrum && (g.beat - lastOn) * spb < S.ioi - 1e-9){ spaced += g.ns.length; continue; }
    let any = false;
    for (const n of g.ns){
      const prev = lastAt.get(n.midi);
      if (prev !== undefined && (n.beat - prev) * spb < S.gap - 1e-9){ spaced++; continue; }
      lastAt.set(n.midi, n.beat); out.push(n); any = true;
    }
    if (any && !sameStrum) lastOn = g.beat;
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
  // the whole-part view noteSuffix needs: every program sounding at each onset; the dominant program
  const onsetProgs = new Map(), progN = new Map();
  for (const n of out){
    const ps = n.progs || [n.prog ?? 0];
    (onsetProgs.get(n.beat) || onsetProgs.set(n.beat, []).get(n.beat)).push(...ps);
    for (const x of ps) progN.set(x, (progN.get(x) || 0) + 1);
  }
  const sfx = { onsetProgs, prog: [...progN.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] };
  const part = out.map(n => {
    const vel = Math.round(Math.max(.05, Math.min(1, n.vel)) * 100) / 100;
    const e = [n.beat, midiToName(n.midi) + noteSuffix(key, n, spb, sfx), vel];
    if (S.sustain) e.push(Math.round(n.dur * 1000) / 1000);
    else if (S.durs){ if (n.dur != null) e.push(Math.round(n.dur * 1000) / 1000); }
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
