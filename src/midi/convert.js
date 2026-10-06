// convert.js — convert parseMidi output to the cascade song format
// returns { song, warnings }

import { GM_DRUMS, drumByGm } from '../drumkit.js';
import { orchestrate, orchestrateByRole, shapePart, PART_SPEC, ROLL_T } from './orchestra.js';

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
  const drumNotes = [];
  const melodicTracks = inputTracks
    .map(tr => {
      const mel = [];
      for (const n of tr.notes) (n.channel === 9 ? drumNotes : mel).push(n);
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
    let r;
    if (mode === 'programs' || (mode === 'auto' && parsed.hasPrograms)) {
      r = orchestrate(melodicTracks, { ppq, bpm });
      if (mode === 'auto' && !r.parts.length && (r.squashed || r.voices >= 2))
        r = orchestrateByRole(melodicTracks, { ppq, bpm, programs: true, reason: 'its programs give the room nothing to play' });
    } else {
      r = orchestrateByRole(melodicTracks, { ppq, bpm, programs: !!parsed.hasPrograms,
                                             reason: parsed.hasPrograms ? 'forced' : 'no program data' });
    }
    beltTracks = r.belt;
    routed = r.parts;
    warnings.push(...r.warnings);
  }

  // --- step 2: monophonic reduction per track ---
  // group by quantized onset, keep highest midi pitch per group
  const monoTracks = beltTracks.map(tr => {
    const byOnset = new Map();
    for (const n of tr.notes) {
      const onsetBeats = quantize(n.tick * beatsPerTick);
      const existing = byOnset.get(onsetBeats);
      if (!existing || n.midi > existing.midi) {
        byOnset.set(onsetBeats, n);
      }
    }

    // count chords trimmed
    const chordCount = tr.notes.length - byOnset.size;
    if (chordCount > 0) {
      const label = tr.name || '(unnamed)';
      warnings.push(`${label}: kept top note of ${chordCount} chord${chordCount > 1 ? 's' : ''}`);
    }

    // sorted by onset
    const onsets = [...byOnset.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([onset, n]) => ({ onset, midi: n.midi, dur: n.dur }));

    return { name: tr.name, onsets };
  }).filter(t => t.onsets.length > 0);

  // --- step 3: keep at most 3 tracks (busiest by onset count) ---
  let kept = monoTracks;
  if (!orchestra && monoTracks.length > 3) {
    const sorted = [...monoTracks].sort((a, b) => b.onsets.length - a.onsets.length);
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
  else withMean.sort((a, b) => b.mean - a.mean); // highest first

  let lead, alto, bass;
  if (withMean.length === 1) {
    [lead] = withMean;
  } else if (withMean.length === 2) {
    [lead, bass] = withMean;
  } else {
    [lead, alto, bass] = withMean;
  }

  // --- step 5: zero the timeline on the lead ---
  const leadOffset = lead.onsets[0].onset;
  const shiftOnsets = t => t.onsets.map(n => ({ ...n, onset: n.onset - leadOffset }));

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
    const lane = drumByGm(n.midi);
    if (!lane) { unmappedGm.set(n.midi, (unmappedGm.get(n.midi) || 0) + 1); continue; }
    const beat = tidy(quantize(n.tick * beatsPerTick) - leadOffset);
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
      list.push({
        voice: p.voice, src: p.name,
        beat: tidy(quantize(n.tick * beatsPerTick) - leadOffset),
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
  const loopBeats = Math.ceil(maxEnd / 4) * 4;

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
  const sub = `MIDI import · ${trackCount} track${trackCount > 1 ? 's' : ''}`;

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
  for (const key of Object.keys(PART_SPEC)) {
    if (!partNotes[key]) continue;
    const r = shapePart(key, partNotes[key], { bpm, loopBeats });
    warnings.push(...r.warnings);
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

  return { song, warnings };
}
