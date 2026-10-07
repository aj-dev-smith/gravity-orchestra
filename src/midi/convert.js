// convert.js — convert parseMidi output to the cascade song format
// returns { song, warnings }

import { GM_DRUMS, drumByGm } from '../drumkit.js';
import { orchestrate, orchestrateByRole, shapePart, PART_SPEC, ROLL_T, nameRole, riffLike } from './orchestra.js';
import { PHRASE, barGrid, barAt, barStart, findPhrase, vocalLead } from './phrase.js';

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
// stable lane order for the emitted drums block (registry order → consistent
// left-to-right kit layout in the render)
const LANE_ORDER = Object.keys(GM_DRUMS);

function midiToName(midi) {
  return NOTE_NAMES[midi % 12] + (Math.floor(midi / 12) - 1);
}

// round to nearest multiple of 1/12 (the quantize grid)
function quantize(beats) {
  return Math.round(beats * 12) / 12;
}

// keep beats clean after the leadOffset subtraction (still on the 1/12 grid)
function tidy(beats) {
  return Math.round(beats * 12000) / 12000;
}

/** the beat-weighted median tempo over [b0, b1) beats of a tempo map ([{ tick, bpm }]); null if none */
export function windowBpm(tempos, ppq, b0, b1) {
  if (!tempos.length) return null;
  const spans = [];
  for (let i = 0; i < tempos.length; i++) {
    const s0 = tempos[i].tick / ppq, s1 = i + 1 < tempos.length ? tempos[i + 1].tick / ppq : Infinity;
    const w = Math.min(s1, b1) - Math.max(s0, b0);
    if (w > 0) spans.push({ bpm: tempos[i].bpm, w });
  }
  if (!spans.length) return tempos[0].bpm;          // (every change comes after the window)
  const total = spans.reduce((s, e) => s + e.w, 0);
  let acc = 0;
  for (const e of spans.sort((a, b) => a.bpm - b.bpm)) { acc += e.w; if (acc >= total / 2) return e.bpm; }
  return spans[spans.length - 1].bpm;
}

const BUDGET_W = .25;          // phrase re-rank: score cost of overflowing a solve budget by a full budget
const DRUM_NAMED = .9;         // a drum-NAMED track off channel 10 is percussion when this share of its keys are GM drums
// …unless its program is a PITCHED percussion instrument (chromatic percussion 8–15, timpani,
// kalimba, tinkle bell, steel drums): a "Percussion" staff of glockenspiel / timpani is a melody,
// and nearly every key from 35 to 81 maps to SOME kit piece, so the key test alone can't tell
const PITCHED_PERC = p => (p >= 8 && p <= 15) || p === 47 || p === 108 || p === 112 || p === 114;
const mmss = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/* opts.window — WHICH PART of the song becomes the loop (phrase.js):
     'auto' (default)   songs longer than PHRASE.AUTO_SEC loop their best phrase window
                        (the chorus / the most-repeated, lead-active, seamless 8–32 bars);
                        shorter ones (and songs with no loopable window) import whole
     'full'             the whole song, as ever
     { fromBar, bars }  this window: 1-based bar number + length in bars (the file's meter)
   The result carries `phrase` (the window used, or null for the whole song). */
export function convertToSong(parsed, opts = {}) {
  const { ppq, bpm: rawBpm, tracks: inputTracks } = parsed;
  const warnings = [];

  // --- step 10: bpm clamp ---
  let bpm = rawBpm;
  if (bpm < 40)  { warnings.push(`bpm ${bpm} clamped to 40`);  bpm = 40; }
  if (bpm > 220) { warnings.push(`bpm ${bpm} clamped to 220`); bpm = 220; }

  // --- step 1: quantize onsets (not intervals) ---
  // grid = 1/12 beat
  const beatsPerTick = 1 / ppq;

  // --- step 0: split percussion (channel 9) from the melodic material ---
  // Drums are defined as channel 9, gathered from EVERY input track. The melodic
  // pipeline below runs only on what's left; the drum lanes are built in step 12
  // once we know the lead's timeline offset and the loop length.
  // A track NAMED as a kit ("Drums", "Percussion" — orchestra nameRole) but written on another
  // channel is percussion too, when its keys are GM drum keys (≥ DRUM_NAMED of its notes map):
  // played as melody it would be a belt of drum-key gibberish.
  const drumNotes = [];
  const melodicTracks = inputTracks
    .map(tr => {
      const mel = [];
      for (const n of tr.notes) (n.channel === 9 ? drumNotes : mel).push(n);
      if (mel.length && nameRole(tr.name) === 'drums' && !mel.some(n => PITCHED_PERC(n.program ?? 0)) && mel.filter(n => drumByGm(n.midi)).length >= DRUM_NAMED * mel.length) {
        warnings.push(`"${tr.name.trim()}": a drum track on channel ${mel[0].channel + 1} (not 10) — played on the drum machine by its name`);
        drumNotes.push(...mel);
        return { ...tr, notes: [] };
      }
      return { ...tr, notes: mel };
    })
    .filter(tr => tr.notes.length > 0);

  if (melodicTracks.length === 0) {
    throw new Error('midi: only channel-9 percussion found — need at least one melodic track to drive the engine');
  }

  // --- step 0b: ORCHESTRA — who plays what (orchestra.js) ---
  // opts.route: 'auto' (default) | 'programs' | 'roles' | 'legacy'
  //   programs  route each voice by its GM program: pianos / guitars / leads stay belt
  //             candidates (the melodic spine); mallets, chimes, basses, pads/strings go to
  //             the room's instrument plugins as song.parts
  //   roles     route each voice by its musical SHAPE (orchestrateByRole) — for files
  //             whose programs say nothing
  //   legacy    the classic belts-only importer: the busiest 3 tracks, top notes
  //   auto      programs when the file has them; ROLES when it has none (GM default =
  //             piano everywhere: a bare sketch / reduction / rip), or when the programs
  //             give the room nothing to play (all pianos / leads: belts only) while there
  //             are ≥ 2 voices or a chordal voice squashed onto the belt
  // opts.orchestra (older flag) still works: true = 'programs', false = 'legacy'.
  const mode = opts.orchestra === true ? 'programs' : opts.orchestra === false ? 'legacy' : (opts.route || 'auto');
  const orchestra = mode !== 'legacy';
  let beltTracks = melodicTracks;
  let routed = [];                                  // [{ key, name, notes }] raw parse notes
  if (orchestra) {
    // the AUTO router (programs → orchestrate; no program data → by musical role)
    const autoRoute = (tracks, o) => {
      if (mode === 'programs' || (mode === 'auto' && parsed.hasPrograms)) {
        const ro = orchestrate(tracks, o);
        if (mode === 'auto' && !ro.parts.length && (ro.squashed || ro.voices >= 2))
          return orchestrateByRole(tracks, { ...o, programs: true, reason: 'its programs give the room nothing to play' });
        return ro;
      }
      return orchestrateByRole(tracks, { ...o, programs: !!parsed.hasPrograms,
                                         reason: parsed.hasPrograms ? 'forced' : 'no program data' });
    };
    // opts.router: a caller-supplied router (orchestrate's signature + result shape), handed the
    // auto router too — the creation tools' instrument-mapping panel (src/editor/mapping.js)
    // routes by hand, or spies on what auto would do
    // (a phrase window's second pass PINS the whole song's lead: o.pin — see step 4b)
    // windowed: this import will loop a PHRASE window (a long song on 'auto', or a chosen window), so
    // the lead rule may hand the belt to a named lead ("Vocals") that enters late (see pickLead)
    const ro = { ppq, bpm, ...(opts._pin ? { pin: opts._pin } : {}),
                 ...(!opts._phrase && willWindow(parsed, opts, melodicTracks, drumNotes, bpm) ? { windowed: true } : {}) };
    const r = opts.router ? opts.router(melodicTracks, ro, autoRoute) : autoRoute(melodicTracks, ro);
    beltTracks = r.belt;
    routed = r.parts;
    warnings.push(...r.warnings);
  }
  // --- step 0c: the PINNED lead (a phrase window's second pass) ---
  // The window was chosen because the WHOLE SONG's lead strikes through it; the window-only
  // re-route must not hand the belt to someone else (a busier voice in these bars, a pad that
  // happens to start first). The routers honour o.pin; this backstop catches what they can't
  // (a hand router, a two-hand split, legacy routing): the pinned notes become belt[0] and leave
  // whatever else they were routed to.
  let pinnedFirst = false;
  if (opts._pin){
    const pin = opts._pin, has = n => pin.has(n);
    const count = tr => { let k = 0; for (const n of tr.notes) if (has(n)) k++; return k; };
    const total = melodicTracks.reduce((s, tr) => s + count(tr), 0);
    if (total){
      let bi = -1, bk = 0;
      beltTracks.forEach((tr, i) => { const k = count(tr); if (k > bk){ bi = i; bk = k; } });
      const own = bi >= 0 && bk >= .8 * total && bk >= .5 * beltTracks[bi].notes.length;
      if (own){ if (bi > 0) beltTracks = [beltTracks[bi], ...beltTracks.filter((_, i) => i !== bi)]; }
      else {
        const strip = tr => ({ ...tr, notes: tr.notes.filter(n => !has(n)) });
        beltTracks = [{ name: opts._pinName || 'the lead', notes: melodicTracks.flatMap(tr => tr.notes.filter(has)) },
                      ...beltTracks.map(strip).filter(tr => tr.notes.length)];
        if (orchestra) beltTracks = beltTracks.slice(0, 3);
        routed = routed.map(strip).filter(p => p.notes.length);
        warnings.push(`phrase: "${opts._pinName || 'the lead'}" keeps the belt lead in the loop (the whole song's lead)`);
      }
      pinnedFirst = true;
    }
  }

  // --- step 2: monophonic reduction per track ---
  // group by quantized onset, keep highest midi pitch per group
  // (orchestra mode: a RIFF — power chords in the guitar register — keeps its ROOT, the lowest
  // note: its top is a fifth or an octave, its identity is the root motion. orchestra.riffLike.)
  const monoTracks = beltTracks.map(tr => {
    const riff = orchestra && riffLike(tr.notes, n => quantize(n.tick * beatsPerTick));
    const byOnset = new Map();
    for (const n of tr.notes) {
      const onsetBeats = quantize(n.tick * beatsPerTick);
      const existing = byOnset.get(onsetBeats);
      if (!existing || (riff ? n.midi < existing.midi : n.midi > existing.midi)) {
        byOnset.set(onsetBeats, n);
      }
    }

    // count chords trimmed
    const chordCount = tr.notes.length - byOnset.size;
    if (chordCount > 0) {
      const label = tr.name || '(unnamed)';
      warnings.push(riff ? `${label}: kept the root (lowest note) of ${chordCount} chord${chordCount > 1 ? 's' : ''} — power chords: a riff's line is its root motion`
                         : `${label}: kept top note of ${chordCount} chord${chordCount > 1 ? 's' : ''}`);
    }

    // sorted by onset
    const onsets = [...byOnset.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([onset, n]) => ({ onset, midi: n.midi, dur: n.dur }));

    return { name: tr.name, onsets, src: tr.notes, pinned: pinnedFirst && tr === beltTracks[0] };
  }).filter(t => t.onsets.length > 0);

  // --- step 3: keep at most 3 tracks (busiest by onset count) ---
  let kept = monoTracks;
  if (!orchestra && monoTracks.length > 3) {
    const sorted = [...monoTracks].sort((a, b) => (b.pinned - a.pinned) || b.onsets.length - a.onsets.length);
    kept = sorted.slice(0, 3);
    for (const dropped of sorted.slice(3)) {
      warnings.push(`dropped track "${dropped.name || '(unnamed)'}" (${dropped.onsets.length} notes, not in busiest 3)`);
    }
  }

  if (kept.length === 0) {
    throw new Error('midi: no tracks with notes after processing');
  }

  // --- step 4: assign roles by mean midi pitch ---
  const withMean = kept.map(t => {
    const mean = t.onsets.reduce((s, n) => s + n.midi, 0) / t.onsets.length;
    return { ...t, mean };
  });
  // legacy: the highest mean leads. Orchestra mode: orchestrate() already chose the lead
  // (it must enter early and last — see orchestra.js) and put it first; the rest by mean.
  if (orchestra) withMean.splice(1, Infinity, ...withMean.slice(1).sort((a, b) => b.mean - a.mean));
  else withMean.sort((a, b) => (b.pinned - a.pinned) || b.mean - a.mean); // highest first (a pinned lead first)

  let lead, alto, bass;
  if (withMean.length === 1) {
    [lead] = withMean;
  } else if (withMean.length === 2) {
    [lead, bass] = withMean;
  } else {
    [lead, alto, bass] = withMean;
  }

  // --- step 4b: PHRASE WINDOW — which bars become the loop (phrase.js) ---
  // Chosen AFTER routing + roles (both judged on the whole song, so a re-map in the
  // MAP panel can't move the window under the user), BEFORE timeline zero. The window
  // is a circle [startBeat, endBeat): it is cut at the lead's first note inside it, and
  // anything earlier in the window (a pickup, the fill) rotates to the loop's tail.
  let finishWin = w => w;
  const picks = opts._phrase ? null : pickWindow({ parsed, opts, bpm, lead, melodicTracks, drumNotes, beatsPerTick, warnings, setFinish: f => (finishWin = f) });
  if (picks) {
    // RE-IMPORT THE WINDOW ALONE: the orchestra must route what plays IN the loop (a voice that
    // only plays in the bridge can't take a machine from one that plays in the chorus), and
    // every fit (budgets, ranges) is judged on the loop's own material — but the LEAD is PINNED
    // (_pin: the whole song's lead, the one the window was chosen around). Then the final belt is
    // CHECKED: an auto window whose lead strikes in fewer than its floor of bars falls back to the
    // next-ranked window, and past those, to the whole song.
    // A window that overflows a machine's solve budget for real (the detector's density term is a
    // proxy) is weighed against shorter windows inside it: score − BUDGET_W·dropped/BUDGET.
    const pin = new Set(lead.src), rejected = [];
    const span = w => `bars ${w.fromBar}–${w.fromBar + w.bars - 1}`;
    const run = w => {
      const lo = w.startBeat - 1e-9, hi = w.endBeat - 1e-9;
      const clipped = { ...parsed, bpm: w.bpm, tracks: parsed.tracks
        .map(tr => ({ ...tr, notes: tr.notes.filter(n => { const b = quantize(n.tick * beatsPerTick); return b >= lo && b < hi; }) }))
        .filter(tr => tr.notes.length > 0) };
      try { return convertToSong(clipped, { ...opts, _phrase: w, _pin: pin, _pinName: lead.name }); }
      catch (e) { rejected.push(`${span(w)} (${e.message})`); return null; }
    };
    const holds = (w, r) => !w.auto || r.phrase.leadFrac >= w.floor - 1e-9;
    const worth = (w, r) => w.score - BUDGET_W * Math.min(1, r.phrase.budgetDropped / PHRASE.BUDGET);
    for (const w of picks) {
      let r = run(w);
      if (!r) continue;
      if (!holds(w, r)) { rejected.push(`${span(w)} (the lead strikes in only ${Math.round(r.phrase.leadFrac * 100)}% of its bars)`); continue; }
      if (w.auto && r.phrase.budgetDropped > 0) {
        for (const sw of (w.siblings || []).map(finishWin)) {
          const sr = run(sw);
          if (sr && holds(sw, sr) && worth(sw, sr) > worth(r.phrase, r)) {
            sr.warnings.push(`phrase: ${span(sw)} instead of ${span(w)} — the longer loop overflowed a machine's solve budget by ${r.phrase.budgetDropped} notes`);
            r = sr;
          }
        }
      }
      if (rejected.length) r.warnings.push(`phrase: passed over ${rejected.join('; ')}`);
      r.warnings.unshift(...warnings.filter(x => x.startsWith('phrase:')));   // what the choosing pass had to say
      return r;
    }
    warnings.push(`phrase: no window kept the lead striking through the loop — imported the whole song (${rejected.join('; ')})`);
  }
  const phrase = opts._phrase ? { ...opts._phrase } : null;
  if (phrase) { delete phrase.alts; delete phrase.siblings; }
  const W = phrase ? phrase.endBeat - phrase.startBeat : 0;
  const inWin = b => !phrase || (b >= phrase.startBeat - 1e-9 && b < phrase.endBeat - 1e-9);
  if (phrase) {
    lead = { ...lead, onsets: lead.onsets.filter(n => inWin(n.onset)) };
    if (alto) alto = { ...alto, onsets: alto.onsets.filter(n => inWin(n.onset)) };
    if (bass) bass = { ...bass, onsets: bass.onsets.filter(n => inWin(n.onset)) };
    // the HONEST lead figures, measured on what the belt will play: the share of the window's bars
    // the lead STRIKES in, and its longest rest (the seam's wrap included) in beats
    const struck = new Set(lead.onsets.map(n => phrase.barLines ? barAt({ starts: phrase.barLines }, n.onset)
                                                                 : Math.floor((n.onset - phrase.startBeat) / phrase.barBeats + 1e-9)));
    phrase.leadFrac = struck.size / phrase.bars;
    const on = lead.onsets.map(n => n.onset);
    let gap = on.length ? W - (on[on.length - 1] - on[0]) : W;
    for (let i = 1; i < on.length; i++) gap = Math.max(gap, on[i] - on[i - 1]);
    phrase.leadGap = tidy(gap);
    sayPhrase(phrase, warnings);
    if (phrase.bpm !== phrase.songBpm)
      warnings.push(`phrase: the loop plays at ${phrase.bpm} bpm — the window's own tempo (the song's dominant tempo is ${phrase.songBpm})`);
  }

  // --- step 5: zero the timeline on the lead ---
  const leadOffset = lead.onsets[0].onset;
  // windowed: the circle cut at the lead (pre-lead material wraps to the tail, never < 0)
  const place = b => { const r = tidy(b - leadOffset); return phrase && r < 0 ? tidy(r + W) : r; };
  const shiftOnsets = t => t.onsets.map(n => ({ ...n, onset: place(n.onset) })).sort((a, b) => a.onset - b.onset);

  // --- step 5b: prepare drum hits (mapped + lead-aligned), pre-loop ---
  // Map each ch9 note to a registry lane and quantize + shift onto the lead's
  // zero. Unknown GM notes are dropped. Hits BEFORE the lead (a pickup fill — the
  // iconic intro tom roll, say) are NOT dropped: they keep their NEGATIVE beat and
  // render in the roll-in window just before the downbeat (step 12), leading into
  // the first note exactly as a pickup should, instead of stranding at the tail.
  // A pickup only has the ROLL-IN to live in (beat ≥ −ROLL_T/BEAT: the render's t ≥ 0).
  // Anything earlier is an intro the lead doesn't play: the dribble lane would wrap it
  // mod the loop, right on top of the real groove mid-song — so it's dropped (warned).
  const drumHits = [];                              // [{ lane, beat, vel }]  (beat may be < 0)
  const unmappedGm = new Map();                     // gm → hits
  const pickupFloor = -ROLL_T * bpm / 60;
  let pickups = 0, intro = 0;
  for (const n of drumNotes) {
    const q = quantize(n.tick * beatsPerTick);
    if (!inWin(q)) continue;
    const lane = drumByGm(n.midi);
    if (!lane) { unmappedGm.set(n.midi, (unmappedGm.get(n.midi) || 0) + 1); continue; }
    const beat = place(q);
    if (beat < pickupFloor - 1e-9) { intro++; continue; }
    if (beat < 0) pickups++;
    drumHits.push({ lane, beat, vel: Math.max(0.01, Math.min(1, n.vel / 127)) });
  }
  if (unmappedGm.size > 0) {
    const hits = [...unmappedGm.values()].reduce((s, c) => s + c, 0);
    warnings.push(`drums: dropped ${unmappedGm.size} unmapped percussion note${unmappedGm.size > 1 ? 's' : ''} (GM ${[...unmappedGm.keys()].sort((a, b) => a - b).join(', ')}; ${hits} hit${hits > 1 ? 's' : ''})`);
  }
  if (pickups > 0) {
    warnings.push(`drums: kept ${pickups} pickup hit${pickups > 1 ? 's' : ''} before the downbeat (the lead-in fill)`);
  }
  if (intro > 0) {
    warnings.push(`drums: dropped ${intro} hit${intro > 1 ? 's' : ''} more than the roll-in (${(-pickupFloor).toFixed(1)} beats) before the lead — an intro the belt doesn't play`);
  }

  // --- step 5c: plugin part notes, lead-aligned + quantized like the drums ---
  const partNotes = {};                             // key -> [{ beat, midi, vel, dur }]
  for (const p of routed) {
    const list = (partNotes[p.key] ||= []);
    for (const n of p.notes) {
      const q = quantize(n.tick * beatsPerTick);
      if (!inWin(q)) continue;
      list.push({
        voice: p.voice, src: p.name,
        beat: place(q),
        midi: n.midi,
        vel: Math.max(0.01, Math.min(1, n.vel / 127)),
        dur: n.dur == null ? null : Math.max(1 / 12, quantize(n.dur * beatsPerTick)),
      });
    }
  }

  lead = { ...lead, onsets: shiftOnsets(lead) };
  if (alto) {
    const shifted = shiftOnsets(alto);
    const before = shifted.filter(n => n.onset < 0);
    if (before.length > 0) {
      warnings.push(`alto: dropped ${before.length} note${before.length > 1 ? 's' : ''} that start${before.length === 1 ? 's' : ''} before the lead`);
    }
    alto = { ...alto, onsets: shifted.filter(n => n.onset >= 0) };
  }
  if (bass) {
    const shifted = shiftOnsets(bass);
    const before = shifted.filter(n => n.onset < 0);
    if (before.length > 0) {
      warnings.push(`bass: dropped ${before.length} note${before.length > 1 ? 's' : ''} that start${before.length === 1 ? 's' : ''} before the lead`);
    }
    bass = { ...bass, onsets: shifted.filter(n => n.onset >= 0) };
  }

  // --- step 6: octave shift ---
  function shiftMidi(onsets, rangeMin, rangeMax, role) {
    if (onsets.length === 0) return onsets;
    const mean = onsets.reduce((s, n) => s + n.midi, 0) / onsets.length;
    let shifted = 0;
    let midis = onsets.map(n => n.midi);
    let m = mean;
    while (m < rangeMin) { m += 12; shifted++; midis = midis.map(v => v + 12); }
    while (m > rangeMax) { m -= 12; shifted--; midis = midis.map(v => v - 12); }
    if (shifted !== 0) {
      const dir = shifted > 0 ? 'up' : 'down';
      warnings.push(`${role}: shifted ${Math.abs(shifted)} octave${Math.abs(shifted) > 1 ? 's' : ''} ${dir} to bring mean pitch into range`);
    }
    return onsets.map((n, i) => ({ ...n, midi: midis[i] }));
  }

  lead.onsets  = shiftMidi(lead.onsets, 36, 96, 'melody');
  if (alto) alto.onsets = shiftMidi(alto.onsets, 36, 96, 'alto');
  if (bass) bass.onsets = shiftMidi(bass.onsets, 48, 71, 'bass');

  // --- step 7: loop length and beat intervals ---
  // loopBeats = max of all tracks' last onset + 1 (a beat's grace — the seam keeps a
  // breath), rounded up to a 4-beat bar. (Deliberately NOT the note's real release: that
  // changed every existing import's loop — golden-tested in test/midi-orchestra.)
  const endOf = n => n.onset + 1;
  let maxEnd = endOf(lead.onsets[lead.onsets.length - 1]);
  if (alto && alto.onsets.length > 0) {
    maxEnd = Math.max(maxEnd, endOf(alto.onsets[alto.onsets.length - 1]));
  }
  if (bass && bass.onsets.length > 0) {
    maxEnd = Math.max(maxEnd, endOf(bass.onsets[bass.onsets.length - 1]));
  }
  // a trailing drum hit (e.g. a final crash) must fit inside the loop window too —
  // one grid cell past it is enough to keep the strict `beat < loopBeats` invariant.
  // (negative beats are pickups; they wrap into the existing window, never extend it.)
  for (const h of drumHits) if (h.beat > 0) maxEnd = Math.max(maxEnd, h.beat + 1 / 12);
  // …and so must every plugin note (pickups wrap to the tail, never extend it)
  for (const list of Object.values(partNotes)) for (const n of list) if (n.beat > 0) maxEnd = Math.max(maxEnd, n.beat + 1 / 12);
  // a phrase window IS the loop: exactly its bars (every onset is already inside [0, W))
  const loopBeats = phrase ? tidy(W) : Math.ceil(maxEnd / 4) * 4;

  function onsetsToNotes(onsets, role) {
    if (onsets.length === 0) return [];
    const notes = [];
    for (let i = 0; i < onsets.length; i++) {
      const name = midiToName(onsets[i].midi);
      // last note: IOI = loopBeats - thisOnset (fills the loop)
      const nextOnset = i + 1 < onsets.length ? onsets[i + 1].onset : loopBeats;
      const beats = nextOnset - onsets[i].onset;
      if (beats <= 0) throw new Error(`midi: internal error — non-positive beat at ${role} note ${i}`);
      notes.push([name, beats]);
    }
    return notes;
  }

  // for delayed tracks, last note's beats brings track total to loopBeats
  function onsetsToNotesDelayed(onsets) {
    if (onsets.length === 0) return [];
    const notes = [];
    for (let i = 0; i < onsets.length; i++) {
      const name = midiToName(onsets[i].midi);
      // last note: IOI = loopBeats - thisOnset (same rule as lead, lock rule holds by construction)
      const nextOnset = i + 1 < onsets.length ? onsets[i + 1].onset : loopBeats;
      const beats = nextOnset - onsets[i].onset;
      if (beats <= 0) throw new Error(`midi: internal error — non-positive beat in delayed track note ${i}`);
      notes.push([name, beats]);
    }
    return notes;
  }

  const melodyNotes = onsetsToNotes(lead.onsets, 'melody');

  // --- step 9: scale — pitch classes in chromatic order from most frequent ---
  const freq = new Array(12).fill(0);
  const allOnsets = [
    ...lead.onsets,
    ...(alto ? alto.onsets : []),
    ...(bass ? bass.onsets : []),
  ];
  for (const n of allOnsets) freq[n.midi % 12]++;
  let mostFreqPc = 0;
  for (let i = 1; i < 12; i++) if (freq[i] > freq[mostFreqPc]) mostFreqPc = i;
  // collect distinct pitch classes used, then order chromatically starting from mostFreqPc
  const usedPcs = new Set(allOnsets.map(n => n.midi % 12));
  const scale = [];
  for (let i = 0; i < 12; i++) {
    const pc = (mostFreqPc + i) % 12;
    if (usedPcs.has(pc)) scale.push(NOTE_NAMES[pc]);
  }

  // --- step 10: label ---
  const firstNamedTrack = inputTracks.find(t => t.name && t.name.trim());
  const label = opts.label || (firstNamedTrack && firstNamedTrack.name) || 'MIDI import';

  // track count for sub
  const trackCount = 1 + (alto ? 1 : 0) + (bass ? 1 : 0);
  let sub = `MIDI import · ${trackCount} track${trackCount > 1 ? 's' : ''}`;

  // --- step 11: build song object ---
  const song = { label, sub, bpm, scale, melody: melodyNotes };

  if (alto && alto.onsets.length > 0) {
    const altoDelay = alto.onsets[0].onset;
    const altoNotes = onsetsToNotesDelayed(alto.onsets);
    song.alto = { delay: altoDelay, notes: altoNotes };
  }
  if (bass && bass.onsets.length > 0) {
    const bassDelay = bass.onsets[0].onset;
    const bassNotes = onsetsToNotesDelayed(bass.onsets);
    song.bass = { delay: bassDelay, notes: bassNotes };
  }

  // --- step 12: drum lanes ---
  // Group the prepared hits by lane, drop the rare hit that lands at/after the
  // loop seam, dedup same-beat retriggers (keep the loudest), and emit each lane
  // as ascending hits — a bare beat at full velocity, [beat, vel] otherwise.
  const laneMap = new Map();              // lane -> Map(beat -> vel)
  for (const h of drumHits) {
    // PICKUPS keep their NEGATIVE beat: the render places beat b at ROLL_T + b·BEAT,
    // so a pre-lead hit lands in the roll-in window just ahead of the downbeat — the
    // intro fill butts up against the first note instead of stranding at the loop
    // tail. Only a rare hit past the seam folds back to the front.
    let beat = h.beat;
    if (beat >= loopBeats) beat = tidy(beat % loopBeats);
    if (!laneMap.has(h.lane)) laneMap.set(h.lane, new Map());
    const beats = laneMap.get(h.lane);
    beats.set(beat, Math.max(beats.get(beat) ?? 0, h.vel));
  }
  if (laneMap.size > 0) {
    const drums = {};
    for (const lane of LANE_ORDER) {
      if (!laneMap.has(lane)) continue;
      drums[lane] = [...laneMap.get(lane).entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([beat, vel]) => (vel >= 0.97 ? beat : [beat, Math.round(vel * 100) / 100]));
    }
    song.drums = drums;
    const laneCount = Object.keys(drums).length;
    song.sub += ` + drums (${laneCount} lane${laneCount > 1 ? 's' : ''})`;
  }

  // --- step 13: instrument parts (orchestra mode) ---
  // Each plugin's notes are shaped to what its machine can honestly play (range,
  // lanes, polyphony, recovery) — see orchestra.js PART_SPEC. Keys in registry order.
  const parts = {};
  let budgetDropped = 0;                            // notes the machines' solve budgets dropped (orchestra budgetWindow)
  for (const key of Object.keys(PART_SPEC)) {
    if (!partNotes[key]) continue;
    const r = shapePart(key, partNotes[key], { bpm, loopBeats });
    warnings.push(...r.warnings);
    for (const w of r.warnings) { const m = /kept the first (\d+) of (\d+) notes/.exec(w); if (m) budgetDropped += m[2] - m[1]; }
    if (r.part.length) parts[key] = r.part;
    else warnings.push(`${key}: no playable notes left — part dropped`);
  }
  if (Object.keys(parts).length > 0) {
    song.parts = parts;
    // no curator placed this room: let the stations make way for a wide belt wall and the
    // director re-aim a blocked station shot (main.js; hand-authored songs keep their framing)
    song.staging = 'auto';
    song.sub += ` + ${Object.keys(parts).join(', ')}`;
  }
  if (phrase) phrase.budgetDropped = budgetDropped;
  if (phrase) song.sub += ` · looping bars ${phrase.fromBar}–${phrase.fromBar + phrase.bars - 1}${phrase.label ? ` — ${phrase.label}` : ''}`;

  return { song, warnings, phrase };
}

/* step 4b: resolve opts.window → the window (1-based fromBar, bars, startBeat, endBeat, …) or null
   (the whole song). Warns what it chose and why, in plain words. */
function sayPhrase(w, warnings) {
  const a = w.fromBar, b = w.fromBar + w.bars - 1;
  warnings.push(`phrase: looping bars ${a}–${b} of ${w.totalBars} (${w.bars} bars, ${mmss(w.sec)} of ${mmss(w.songSec)})` +
                `${w.label ? ` — ${w.label}` : ''}${w.leadFrac != null ? `; the lead strikes in ${Math.round(w.leadFrac * 100)}% of its bars` : ''}` +
                ` · opts.window 'full' imports the whole song`);
}

/* → the windows to try, best first ([] never: null = the whole song). Each: 1-based fromBar, bars,
   startBeat, endBeat, bpm, sec, label, auto, floor (the lead-activity floor an auto window must hold
   on the final belt) … The song's END is where its notes end — a note after PHRASE.SILENCE_BARS
   empty bars is stray (a sequencer's forgotten event), and at most PHRASE.MAX_BARS bars are
   analysed, so one stray event at hour 2 can't make the O(bars²) detector freeze the tab. */
/** the song's END: the last note before a long silence (PHRASE.SILENCE_BARS empty bars — the rest is stray) */
function songEnd(parsed, melodicTracks, drumNotes) {
  const grid0 = barGrid(parsed.timeSigs || [], parsed.ppq, 0);
  const ticks = [];
  for (const tr of melodicTracks) for (const n of tr.notes) ticks.push(n.tick);
  for (const n of drumNotes) ticks.push(n.tick);
  ticks.sort((a, b) => a - b);
  const silence = PHRASE.SILENCE_BARS * grid0.barBeats * parsed.ppq;
  let endTick = ticks[0] ?? 0, stray = 0;
  for (let i = 1; i < ticks.length; i++) { if (ticks[i] - ticks[i - 1] > silence) { stray = ticks.length - i; break; } endTick = ticks[i]; }
  return { endTick, stray };
}
/** will this import loop a phrase window? (an object window, or 'auto' on a song past PHRASE.AUTO_SEC —
    the same test pickWindow makes; it can still fall back to the whole song if no window holds) */
function willWindow(parsed, opts, melodicTracks, drumNotes, bpm) {
  const want = opts.window ?? 'auto';
  if (want === 'full') return false;
  if (typeof want === 'object' && want) return true;
  const { endTick } = songEnd(parsed, melodicTracks, drumNotes);
  return (endTick / parsed.ppq + 1) * 60 / bpm > PHRASE.AUTO_SEC;
}

function pickWindow({ parsed, opts, bpm, lead, melodicTracks, drumNotes, beatsPerTick, warnings, setFinish }) {
  const want = opts.window ?? 'auto';
  if (want === 'full') return null;
  const { endTick, stray } = songEnd(parsed, melodicTracks, drumNotes);
  // the bar grid: the dominant meter, or the WALKED meter map when its bar lines really move (phrase.barGrid)
  const grid = barGrid(parsed.timeSigs || [], parsed.ppq, endTick);
  const songBeats = endTick * beatsPerTick + 1;
  const songSec = songBeats * 60 / bpm;
  const totalBars = Math.max(1, barAt(grid, endTick * beatsPerTick) + 1);
  const pin = new Set(lead.src);
  const tempos = (parsed.tempos || []).map(e => ({ beat: e.tick / parsed.ppq, bpm: e.bpm }));
  const finish = w => {
    w.startBeat = barStart(grid, w.fromBar - 1);
    w.endBeat = barStart(grid, w.fromBar - 1 + w.bars);
    if (grid.starts) w.barLines = Array.from({ length: w.bars + 1 }, (_, i) => barStart(grid, w.fromBar - 1 + i));
    // the engine has ONE tempo: a window plays at the tempo IT is written in (a ballad section of a
    // multi-tempo song must not loop at the rock section's speed) — the beat-weighted median of
    // the tempo map over the window, like parse's dominant tempo over the song
    const wb = windowBpm(parsed.tempos || [], parsed.ppq, w.startBeat, w.endBeat);
    w.bpm = wb && Math.abs(wb - bpm) / bpm > .02 ? Math.max(40, Math.min(220, wb)) : bpm;
    w.sec = grid.starts ? (w.endBeat - w.startBeat) * 60 / w.bpm : w.bars * grid.barBeats * 60 / w.bpm;
    w.totalBars = totalBars; w.songSec = songSec; w.barBeats = grid.barBeats; w.songBpm = bpm;
    return w;
  };
  if (typeof want === 'object' && want) {
    const fromBar = Math.max(1, Math.round(want.fromBar || 1));
    let bars = Math.max(1, Math.round(want.bars || 1));
    if (fromBar > totalBars) {
      warnings.push(`phrase: the song has ${totalBars} bars — bar ${fromBar} is past its end; imported the whole song instead`);
      return null;
    }
    if (fromBar + bars - 1 > totalBars) {         // a window can't loop silence past the song's last bar
      warnings.push(`phrase: bars ${fromBar}–${fromBar + bars - 1} run past the song's end (bar ${totalBars}) — looping bars ${fromBar}–${totalBars}`);
      bars = totalBars - fromBar + 1;
    }
    const w = finish({ fromBar, bars, label: want.label || '', auto: false });
    if (!lead.onsets.some(n => n.onset >= w.startBeat - 1e-9 && n.onset < w.endBeat - 1e-9)) {
      warnings.push(`phrase: the lead never plays in bars ${fromBar}–${fromBar + bars - 1} — imported the whole song instead`);
      return null;
    }
    return [w];
  }
  if (songSec <= PHRASE.AUTO_SEC) return null;      // short songs import whole
  // the detector's view of the song: the lead's line, the other melodic notes (by voice, for the
  // budget term — the lead's own notes carry none), the drums
  const end = endTick * beatsPerTick + 1e-9;
  const events = [];
  for (const n of lead.onsets) if (n.onset <= end) events.push({ beat: n.onset, midi: n.midi, vel: .9, dur: n.dur == null ? null : n.dur * beatsPerTick, kind: 'lead' });
  melodicTracks.forEach((tr, ti) => { for (const n of tr.notes) if (n.tick <= endTick)
    events.push({ beat: n.tick * beatsPerTick, midi: n.midi, vel: n.vel / 127, dur: n.dur == null ? null : n.dur * beatsPerTick, kind: 'mel',
                  voice: pin.has(n) ? null : `${ti}:${n.program ?? 0}` }); });
  for (const n of drumNotes) if (n.tick <= endTick) events.push({ beat: n.tick * beatsPerTick, midi: n.midi, vel: n.vel / 127, dur: null, kind: 'drum' });
  if (stray) warnings.push(`phrase: ignored ${stray} stray note${stray > 1 ? 's' : ''} after ${PHRASE.SILENCE_BARS}+ empty bars when choosing the loop`);
  if (totalBars > PHRASE.MAX_BARS) warnings.push(`phrase: ${totalBars} bars — only the first ${PHRASE.MAX_BARS} were searched for the loop`);

  if (opts.phraseProbe) opts.phraseProbe({ events, grid, bpm, songSec });   // dev / test hook: the detector's input
  const pg = lead.src.find(n => n.program != null)?.program ?? 0;
  const best = findPhrase(events, { barBeats: grid.barBeats, origin: grid.origin, starts: grid.starts, tempos, bpm, vocal: vocalLead(pg, lead.name) });
  if (!best) {
    warnings.push(`phrase: no loopable ${PHRASE.LENGTHS[0]}–${PHRASE.LENGTHS[PHRASE.LENGTHS.length - 1]}-bar window keeps the lead playing — imported the whole song (${mmss(songSec)})`);
    return null;
  }
  const win = c => finish({ fromBar: c.fromBar + 1, bars: c.bars, label: c.label, auto: true, floor: c.floor,
    score: c.score, reps: c.reps, seam: c.seam, leadFrac: c.leadFrac, leadGap: c.leadGap });
  setFinish(win);
  return [best, ...best.alts].map(c => Object.assign(win(c), { siblings: c.siblings }));
}
