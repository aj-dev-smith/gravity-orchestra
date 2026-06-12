// convert.js — convert parseMidi output to the cascade song format
// returns { song, warnings }

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

function midiToName(midi) {
  return NOTE_NAMES[midi % 12] + (Math.floor(midi / 12) - 1);
}

// round to nearest multiple of 1/12 (the quantize grid)
function quantize(beats) {
  return Math.round(beats * 12) / 12;
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

  // --- step 2: monophonic reduction per track ---
  // group by quantized onset, keep highest midi pitch per group
  const monoTracks = inputTracks.map(tr => {
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
      .map(([onset, n]) => ({ onset, midi: n.midi }));

    return { name: tr.name, onsets };
  }).filter(t => t.onsets.length > 0);

  // --- step 3: keep at most 3 tracks (busiest by onset count) ---
  let kept = monoTracks;
  if (monoTracks.length > 3) {
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
  withMean.sort((a, b) => b.mean - a.mean); // highest first

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
  // loopBeats = max of all tracks' (lastOnset + 1), rounded up to 4-beat bar
  let maxEnd = lead.onsets[lead.onsets.length - 1].onset + 1;
  if (alto && alto.onsets.length > 0) {
    maxEnd = Math.max(maxEnd, alto.onsets[alto.onsets.length - 1].onset + 1);
  }
  if (bass && bass.onsets.length > 0) {
    maxEnd = Math.max(maxEnd, bass.onsets[bass.onsets.length - 1].onset + 1);
  }
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

  return { song, warnings };
}
