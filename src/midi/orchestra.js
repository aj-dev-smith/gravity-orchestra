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
// Only the bowls read a duration (sustained voice), so only bowls carry one.

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
     'sustain'  strings / ensembles / organ: chordal or very long → bowls,
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
   lo/hi     the sweet range (MIDI). Parts are octave-shifted as a WHOLE so their
             median sits at `center`, then stray notes fold by octaves into [lo, hi].
   pitches   max distinct pitches = lanes / strings / bowls / tines
   poly      max notes per onset (bowls: max SOUNDING at once)
   gap       min seconds between two hits on the SAME pitch (lane recovery)
   ioi       min seconds between successive onsets of the whole part (bells: sparse)
   Derived from each plugin's solve.js + demo:
     marimba   keyboard spans C..C over the played range (11.2 u) — 3 octaves keeps bars wide;
               one dribbling marble per pitch, fast repeats fine (demo: 16ths @100)
     musicbox  tine L ∝ f^−½ clamps past ~2.5 octaves; comb spacing shrinks past ~14 tines;
               fast repeats split onto twin tines
     bells     real chimes C4–F5 (demo C4–C6); the pendulum needs ~.36 s to come round
     bass      8 strings max (the bed scales uniformly past that); E1–E3
     bowls     two rows on a 10 u deck; a bowl's size is its note (C3 big … G5 small);
               HOLD_MAX 5 s per orbit                                              */
export const PART_SPEC = {
  marimba:  { lo: 48, hi: 84,  center: 66, pitches: 37, poly: 6, gap: .1,  ioi: 0 },
  musicbox: { lo: 72, hi: 100, center: 84, pitches: 20, poly: 5, gap: .08, ioi: 0 },
  bells:    { lo: 60, hi: 84,  center: 70, pitches: 10, poly: 3, gap: .36, ioi: .2 },
  bass:     { lo: 28, hi: 52,  center: 38, pitches: 8,  poly: 2, gap: .25, ioi: 0 },
  bowls:    { lo: 48, hi: 79,  center: 62, pitches: 8,  poly: 4, gap: 0,   ioi: 0,
              sustain: true, maxDur: 5, minDur: .3 },
};
export const PICKUP_BEATS = 4;      // pre-lead notes within this many beats wrap to the loop tail

/* ---- per-voice statistics ------------------------------------------------ */
const median = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** How chordal a voice is: max(fraction of onsets that are chords, fraction of notes
    that start while another is still sounding). notes: raw parse notes. */
export function polyphony(notes, quantizeTick){
  if (!notes.length) return 0;
  const byOnset = new Map();
  for (const n of notes){ const q = quantizeTick(n.tick); byOnset.set(q, (byOnset.get(q) || 0) + 1); }
  const chordFrac = [...byOnset.values()].filter(c => c > 1).length / byOnset.size;
  const sorted = [...notes].sort((a, b) => a.tick - b.tick);
  let overlaps = 0, reach = -Infinity;
  for (const n of sorted){
    if (n.tick < reach) overlaps++;
    if (n.dur != null) reach = Math.max(reach, n.tick + n.dur * .9);    // a hair of legato is not polyphony
  }
  return Math.max(chordFrac, overlaps / notes.length);
}

/* ---- routing: melodic voices → belt candidates + plugin parts -------------
   tracks: [{ name, notes }] (percussion already removed). Each track is split by
   program into VOICES (a track that switches instrument is two players).
   Returns { belt: [{name, notes}], parts: [{key, name, notes, program}], warnings }.
   The belt list holds the lead first-come by the legacy rules (convert.js picks
   roles); non-lead belt voices that are chordal, or overflow beyond 3 belts, go to
   the marimba (struck bars keep the chords a belt would have to drop).           */
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
      const onsets = new Set(notes.map(n => q12(n.tick))).size;
      const mean = notes.reduce((s, n) => s + n.midi, 0) / notes.length;
      const first = Math.min(...notes.map(n => n.tick)) / ppq;           // beats
      voices.push({ name, notes, program, onsets, mean, first, poly: polyphony(notes, q12) });
    }
  }

  const belt = [], parts = [];
  for (const v of voices){
    let dest = routeProgram(v.program);
    if (dest === 'sustain'){
      const durs = v.notes.filter(n => n.dur != null).map(n => n.dur * secPerTick);
      dest = v.poly >= .25 || median(durs) >= 2 ? 'bowls' : 'belt';
    }
    if (dest === null){
      warnings.push(`dropped "${v.name}" (${GM_NAMES[v.program]}: no instrument in the room plays sound effects)`);
      continue;
    }
    if (dest === 'belt') belt.push(v);
    else parts.push({ key: dest, name: v.name, notes: v.notes, program: v.program });
  }

  // no melodic spine at all (a mallet / pad / bass-only file): the belt lead DOUBLES the
  // most melodic routed voice (top line), which keeps playing its own machine too.
  // The lead zeroes the timeline (anything > a pickup before it is lost), so prefer the
  // voice that ENTERS first (to the bar), then the most melodic kind, then the busiest.
  if (belt.length === 0){
    const rank = { musicbox: 0, marimba: 0, bells: 1, bowls: 2, bass: 3 };
    const pick = parts
      .map(p => ({ p, v: voices.find(v => v.notes === p.notes) }))
      .sort((a, b) => (Math.floor(a.v.first / 4) - Math.floor(b.v.first / 4)) || (rank[a.p.key] - rank[b.p.key]) ||
                      (b.v.onsets - a.v.onsets) || (b.v.mean - a.v.mean))[0];
    if (pick){
      belt.push(pick.v);
      warnings.push(`no piano/lead voice — the belt lead doubles the top line of "${pick.v.name}" (${pick.p.key})`);
    }
    return { belt, parts, warnings };
  }

  // the lead: legacy rule — the highest mean among the 3 busiest belt voices
  const busiest = [...belt].sort((a, b) => b.onsets - a.onsets);
  const lead = busiest.slice(0, 3).sort((a, b) => b.mean - a.mean)[0];
  const keep = [lead];
  for (const v of busiest){
    if (v === lead) continue;
    if (v.poly >= .25){
      parts.push({ key: 'marimba', name: v.name, notes: v.notes, program: v.program });
      warnings.push(`"${v.name}" is chordal — on the marimba (struck bars keep its chords) instead of a belt`);
    } else if (keep.length < 3) keep.push(v);
    else {
      parts.push({ key: 'marimba', name: v.name, notes: v.notes, program: v.program });
      warnings.push(`dropped track "${v.name}" from the belts (3 kept) — it plays on the marimba`);
    }
  }
  return { belt: keep.map(v => ({ name: v.name, notes: v.notes })), parts, warnings };
}

/* ---- shaping one instrument's part ---------------------------------------
   notes: [{ beat, midi, vel, dur }] — beat lead-aligned + quantized (may be < 0 for
   a pickup), dur in beats or null. Returns { part, warnings }.                   */
export function shapePart(key, notes, { bpm, loopBeats }){
  const S = PART_SPEC[key];
  if (!S) throw new Error(`orchestra: no part spec for instrument "${key}"`);
  const warnings = [], say = m => warnings.push(`${key}: ${m}`);
  const spb = 60 / bpm;                                  // seconds per beat
  const tidy = b => Math.round(b * 12000) / 12000;
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

  // 1. the loop window: a short pickup wraps to the tail (where it leads into the
  //    downbeat on every loop after the first); a long pre-lead intro can't be kept.
  let ns = [], early = 0, wrapped = 0;
  for (const n of notes){
    let beat = n.beat;
    if (beat < 0){
      if (beat < -PICKUP_BEATS){ early++; continue; }
      beat = tidy(beat + loopBeats); wrapped++;
    }
    if (beat >= loopBeats) beat = tidy(beat % loopBeats);
    ns.push({ ...n, beat });
  }
  if (early) say(`dropped ${plural(early, 'note')} more than ${PICKUP_BEATS} beats before the lead`);
  if (wrapped) say(`wrapped ${plural(wrapped, 'pickup note')} to the loop tail`);
  if (!ns.length) return { part: [], warnings };

  // 2. octave-transpose the whole part toward the machine's centre, 3. fold strays
  const shift = 12 * Math.round((S.center - median(ns.map(n => n.midi))) / 12);
  if (shift) say(`shifted ${plural(Math.abs(shift / 12), 'octave')} ${shift > 0 ? 'up' : 'down'} into its range`);
  let folded = 0;
  ns = ns.map(n => {
    let m = n.midi + shift;
    while (m < S.lo){ m += 12; folded++; }
    while (m > S.hi){ m -= 12; folded++; }
    return { ...n, midi: m };
  });
  if (folded) say(`folded ${plural(folded, 'note')} by octaves into ${midiToName(S.lo)}–${midiToName(S.hi)}`);

  // 4. pitch cap: keep the most-used pitches (ties → nearer the centre); fold the rest
  //    by octave onto a kept pitch of the same pitch class, else drop
  const use = new Map();
  for (const n of ns) use.set(n.midi, (use.get(n.midi) || 0) + 1);
  if (use.size > S.pitches){
    const ranked = [...use.keys()].sort((a, b) => (use.get(b) - use.get(a)) || (Math.abs(a - S.center) - Math.abs(b - S.center)) || a - b);
    const kept = new Set(ranked.slice(0, S.pitches));
    let moved = 0, lost = 0;
    ns = ns.flatMap(n => {
      if (kept.has(n.midi)) return [n];
      const twin = [...kept].filter(k => (k - n.midi) % 12 === 0).sort((a, b) => Math.abs(a - n.midi) - Math.abs(b - n.midi))[0];
      if (twin === undefined){ lost++; return []; }
      moved++; return [{ ...n, midi: twin }];
    });
    say(`${use.size} pitches > ${S.pitches} ${key === 'bowls' ? 'bowls' : key === 'bass' ? 'strings' : 'lanes'}: kept the most-used, ` +
        `folded ${plural(moved, 'note')} by octave${lost ? `, dropped ${plural(lost, 'note')} with no octave twin` : ''}`);
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
  const groups = [];
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
  const out = [];
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
  // the loop seam is a gap too: a repeat at the tail can't crowd the head's same pitch
  for (const [m, last] of lastAt){
    const first = out.find(n => n.midi === m);
    if (first && first.beat !== last && (first.beat + loopBeats - last) * spb < S.gap - 1e-9){
      out.splice(out.lastIndexOf(out.filter(n => n.midi === m).pop()), 1); spaced++;
    }
  }
  if (spaced) say(`thinned ${plural(spaced, 'note')} too close together for the machine (${S.ioi ? `≥ ${S.ioi}s apart` : `≥ ${S.gap}s per pitch`})`);

  const part = out.map(n => {
    const vel = Math.round(Math.max(.05, Math.min(1, n.vel)) * 100) / 100;
    const e = [n.beat, midiToName(n.midi), vel];
    if (S.sustain) e.push(Math.round(n.dur * 1000) / 1000);
    return e;
  });
  return { part, warnings };
}
