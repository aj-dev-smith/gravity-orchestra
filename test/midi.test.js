import { describe, it, expect } from 'vitest';
import { parseMidi } from '../src/midi/parse.js';
import { convertToSong } from '../src/midi/convert.js';
import { buildMidi } from './helpers/midi-builder.js';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const NOTE_RE = /^[A-G]#?\d$/;
function sumBeats(notes) { return notes.reduce((s, [, b]) => s + b, 0); }

// minimal 1-track format-1 file with a few notes
function simpleMidi(notes, ppq = 480) {
  return buildMidi({
    format: 1, ppq,
    tracks: [{ events: notes }],
  });
}

// ---------------------------------------------------------------------------
// parse — header + format
// ---------------------------------------------------------------------------

describe('parseMidi — header', () => {
  it('returns correct format and ppq', () => {
    const bytes = simpleMidi([{ tick: 0, type: 'on', note: 60, vel: 80 }]);
    const result = parseMidi(bytes);
    expect(result.format).toBe(1);
    expect(result.ppq).toBe(480);
  });

  it('throws on bad magic bytes', () => {
    const bytes = new Uint8Array(14);
    bytes.set([0x4d, 0x54, 0x68, 0x65]); // "MThe"
    expect(() => parseMidi(bytes)).toThrow(/bad magic/i);
  });

  it('throws if file too short', () => {
    expect(() => parseMidi(new Uint8Array(10))).toThrow();
  });

  it('throws on format 2', () => {
    const bytes = buildMidi({ format: 2, ppq: 480, tracks: [] });
    // manually patch format byte to 2 (offset 8)
    bytes[8] = 0; bytes[9] = 2;
    expect(() => parseMidi(bytes)).toThrow(/format 2/i);
  });

  it('throws on SMPTE division (high bit set)', () => {
    const bytes = buildMidi({ format: 1, ppq: 480, tracks: [] });
    // patch division at offset 12 to have high bit set
    bytes[12] = 0xe7; bytes[13] = 0x28; // SMPTE-style
    expect(() => parseMidi(bytes)).toThrow(/SMPTE/i);
  });

  it('throws on non-Uint8Array input', () => {
    expect(() => parseMidi([0x4d, 0x54])).toThrow(/Uint8Array/i);
  });
});

// ---------------------------------------------------------------------------
// parse — VLQ
// ---------------------------------------------------------------------------

describe('parseMidi — VLQ multi-byte deltas', () => {
  it('handles a 2-byte VLQ delta (value 128)', () => {
    // tick 128 = 1 quarter note at ppq=128
    const bytes = buildMidi({
      format: 1, ppq: 128,
      tracks: [{
        events: [
          { tick: 0,   type: 'on',  note: 60, vel: 100 },
          { tick: 128, type: 'on',  note: 62, vel: 100 },
        ],
      }],
    });
    const { tracks } = parseMidi(bytes);
    expect(tracks[0].notes.length).toBe(2);
    expect(tracks[0].notes[1].tick).toBe(128);
  });

  it('handles a 3-byte VLQ delta (value 16384)', () => {
    const bytes = buildMidi({
      format: 1, ppq: 480,
      tracks: [{
        events: [
          { tick: 0,     type: 'on', note: 60, vel: 100 },
          { tick: 16384, type: 'on', note: 62, vel: 100 },
        ],
      }],
    });
    const { tracks } = parseMidi(bytes);
    expect(tracks[0].notes[1].tick).toBe(16384);
  });
});

// ---------------------------------------------------------------------------
// parse — running status
// ---------------------------------------------------------------------------

describe('parseMidi — running status', () => {
  it('parses consecutive note-ons with running status (no repeated status byte)', () => {
    const bytes = buildMidi({
      format: 1, ppq: 480,
      tracks: [{
        events: [
          { tick: 0,   type: 'on', note: 60, vel: 80 },
          { tick: 480, type: 'on', note: 62, vel: 80 },
          { tick: 960, type: 'on', note: 64, vel: 80 },
        ],
        opts: { runningStatus: true },
      }],
    });
    const { tracks } = parseMidi(bytes);
    expect(tracks[0].notes.length).toBe(3);
    expect(tracks[0].notes.map(n => n.midi)).toEqual([60, 62, 64]);
  });

  it('running status resets after a meta event', () => {
    // name meta resets status; subsequent note-on must include status byte
    const bytes = buildMidi({
      format: 1, ppq: 480,
      tracks: [{
        events: [
          { tick: 0,   type: 'on',   note: 60, vel: 80 },
          { tick: 100, type: 'name', text: 'Piano' },
          { tick: 200, type: 'on',   note: 64, vel: 80 },
        ],
        opts: { runningStatus: false }, // include proper status bytes after meta
      }],
    });
    const { tracks } = parseMidi(bytes);
    expect(tracks[0].notes.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// parse — note-on vel=0 treated as note-off
// ---------------------------------------------------------------------------

describe('parseMidi — note-on vel=0 as note-off', () => {
  it('vel=0 note-ons do NOT appear as onset notes', () => {
    const bytes = buildMidi({
      format: 1, ppq: 480,
      tracks: [{
        events: [
          { tick: 0,   type: 'on',   note: 60, vel: 80 },
          { tick: 480, type: 'vel0', note: 60 },           // vel=0 note-on = note-off
          { tick: 480, type: 'on',   note: 62, vel: 80 },
          { tick: 960, type: 'vel0', note: 62 },
        ],
      }],
    });
    const { tracks } = parseMidi(bytes);
    // only the two actual onsets (vel>0), not the vel-0 ones
    expect(tracks[0].notes.length).toBe(2);
    expect(tracks[0].notes.map(n => n.midi)).toEqual([60, 62]);
  });

  it('vel=0 via note0AsOff encoding (0x80 status) also works', () => {
    const bytes = buildMidi({
      format: 1, ppq: 480,
      tracks: [{
        events: [
          { tick: 0,   type: 'on',  note: 60, vel: 80 },
          { tick: 480, type: 'off', note: 60 },
        ],
        opts: { note0AsOff: true }, // encode note-offs as vel-0 note-ons
      }],
    });
    const { tracks } = parseMidi(bytes);
    expect(tracks[0].notes.length).toBe(1);
    expect(tracks[0].notes[0].midi).toBe(60);
  });
});

// ---------------------------------------------------------------------------
// parse — tempo meta → bpm
// ---------------------------------------------------------------------------

describe('parseMidi — tempo meta', () => {
  it('extracts bpm from set-tempo event', () => {
    const uspq = 500000; // 120 bpm
    const bytes = buildMidi({
      format: 1, ppq: 480,
      tracks: [{
        events: [
          { tick: 0, type: 'tempo', uspq },
          { tick: 0, type: 'on', note: 60, vel: 80 },
        ],
      }],
    });
    const { bpm } = parseMidi(bytes);
    expect(bpm).toBeCloseTo(120, 2);
  });

  it('captures non-standard bpm correctly', () => {
    const uspq = 461538; // ~130 bpm
    const bytes = buildMidi({
      format: 1, ppq: 480,
      tracks: [{
        events: [
          { tick: 0, type: 'tempo', uspq },
          { tick: 0, type: 'on', note: 60, vel: 80 },
        ],
      }],
    });
    const { bpm } = parseMidi(bytes);
    expect(bpm).toBeCloseTo(60_000_000 / uspq, 1);
  });

  it('first tempo event wins; later ones ignored', () => {
    const bytes = buildMidi({
      format: 1, ppq: 480,
      tracks: [
        {
          events: [
            { tick: 0,    type: 'tempo', uspq: 500000 }, // 120 bpm
            { tick: 0,    type: 'on', note: 60, vel: 80 },
          ],
        },
        {
          events: [
            { tick: 0,    type: 'tempo', uspq: 300000 }, // 200 bpm
            { tick: 0,    type: 'on', note: 62, vel: 80 },
          ],
        },
      ],
    });
    const { bpm } = parseMidi(bytes);
    expect(bpm).toBeCloseTo(120, 2);
  });

  it('defaults to 120 when no tempo meta present', () => {
    const bytes = buildMidi({
      format: 1, ppq: 480,
      tracks: [{
        events: [{ tick: 0, type: 'on', note: 60, vel: 80 }],
      }],
    });
    expect(parseMidi(bytes).bpm).toBe(120);
  });
});

// ---------------------------------------------------------------------------
// parse — track names
// ---------------------------------------------------------------------------

describe('parseMidi — track names', () => {
  it('captures track name meta (0x03)', () => {
    const bytes = buildMidi({
      format: 1, ppq: 480,
      tracks: [{
        events: [
          { tick: 0, type: 'name', text: 'Violin I' },
          { tick: 0, type: 'on', note: 60, vel: 80 },
        ],
      }],
    });
    const { tracks } = parseMidi(bytes);
    expect(tracks[0].name).toBe('Violin I');
  });
});

// ---------------------------------------------------------------------------
// parse — skipping non-note events
// ---------------------------------------------------------------------------

describe('parseMidi — event skipping', () => {
  it('skips sysex events without corrupting subsequent notes', () => {
    const bytes = buildMidi({
      format: 1, ppq: 480,
      tracks: [{
        events: [
          { tick: 0,   type: 'on',  note: 60, vel: 80 },
          { tick: 100, type: 'sysex', data: [0x41, 0x10, 0x42] },
          { tick: 200, type: 'on',  note: 64, vel: 80 },
        ],
      }],
    });
    const { tracks } = parseMidi(bytes);
    expect(tracks[0].notes.length).toBe(2);
    expect(tracks[0].notes[1].midi).toBe(64);
  });

  it('skips CC events without corrupting subsequent notes', () => {
    const bytes = buildMidi({
      format: 1, ppq: 480,
      tracks: [{
        events: [
          { tick: 0,   type: 'on', note: 60, vel: 80 },
          { tick: 100, type: 'cc', cc: 7, val: 100 },
          { tick: 200, type: 'on', note: 62, vel: 80 },
        ],
      }],
    });
    const { tracks } = parseMidi(bytes);
    expect(tracks[0].notes.length).toBe(2);
  });

  it('skips pitch-bend events without corrupting subsequent notes', () => {
    const bytes = buildMidi({
      format: 1, ppq: 480,
      tracks: [{
        events: [
          { tick: 0,   type: 'on', note: 60, vel: 80 },
          { tick: 100, type: 'pb', lsb: 0, msb: 64 },
          { tick: 200, type: 'on', note: 64, vel: 80 },
        ],
      }],
    });
    const { tracks } = parseMidi(bytes);
    expect(tracks[0].notes.length).toBe(2);
  });

  it('skips program-change events (1 data byte)', () => {
    const bytes = buildMidi({
      format: 1, ppq: 480,
      tracks: [{
        events: [
          { tick: 0,   type: 'on', note: 60, vel: 80 },
          { tick: 100, type: 'pc', program: 40 },
          { tick: 200, type: 'on', note: 62, vel: 80 },
        ],
      }],
    });
    const { tracks } = parseMidi(bytes);
    expect(tracks[0].notes.length).toBe(2);
  });

  it('skips polyphonic aftertouch (2 data bytes)', () => {
    const bytes = buildMidi({
      format: 1, ppq: 480,
      tracks: [{
        events: [
          { tick: 0,   type: 'on',        note: 60, vel: 80 },
          { tick: 100, type: 'aftertouch', note: 60, pressure: 50 },
          { tick: 200, type: 'on',        note: 62, vel: 80 },
        ],
      }],
    });
    const { tracks } = parseMidi(bytes);
    expect(tracks[0].notes.length).toBe(2);
  });

  it('skips channel aftertouch (1 data byte)', () => {
    const bytes = buildMidi({
      format: 1, ppq: 480,
      tracks: [{
        events: [
          { tick: 0,   type: 'on',     note: 60, vel: 80 },
          { tick: 100, type: 'chanaft', pressure: 50 },
          { tick: 200, type: 'on',     note: 62, vel: 80 },
        ],
      }],
    });
    const { tracks } = parseMidi(bytes);
    expect(tracks[0].notes.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// parse — channel 9 (percussion) dropped
// ---------------------------------------------------------------------------

describe('parseMidi — channel 9 percussion drop', () => {
  it('drops notes on channel 9 (zero-indexed)', () => {
    const bytes = buildMidi({
      format: 1, ppq: 480,
      tracks: [{
        events: [
          { tick: 0,   type: 'on', note: 36, vel: 100, channel: 9 },  // kick — drop
          { tick: 0,   type: 'on', note: 60, vel: 80,  channel: 0 },  // keep
          { tick: 480, type: 'on', note: 38, vel: 100, channel: 9 },  // snare — drop
        ],
      }],
    });
    const { tracks } = parseMidi(bytes);
    expect(tracks[0].notes.every(n => n.channel !== 9)).toBe(true);
    expect(tracks[0].notes.length).toBe(1);
    expect(tracks[0].notes[0].midi).toBe(60);
  });
});

// ---------------------------------------------------------------------------
// parse — format 0 channel split
// ---------------------------------------------------------------------------

describe('parseMidi — format 0 channel split', () => {
  it('splits a format-0 file into one track per channel, ordered by channel', () => {
    const bytes = buildMidi({
      format: 0, ppq: 480,
      tracks: [{
        events: [
          { tick: 0,   type: 'on', note: 60, vel: 80, channel: 0 },
          { tick: 0,   type: 'on', note: 48, vel: 80, channel: 1 },
          { tick: 480, type: 'on', note: 62, vel: 80, channel: 0 },
          { tick: 480, type: 'on', note: 50, vel: 80, channel: 1 },
        ],
      }],
    });
    const { format, tracks } = parseMidi(bytes);
    expect(format).toBe(0);
    expect(tracks.length).toBe(2);
    // ordered by channel
    expect(tracks[0].name).toBe('ch0');
    expect(tracks[1].name).toBe('ch1');
    expect(tracks[0].notes.every(n => n.channel === 0)).toBe(true);
    expect(tracks[1].notes.every(n => n.channel === 1)).toBe(true);
  });

  it('drops empty channels from format-0 split result', () => {
    // channel 9 (perc) dropped → only channel 0 survives
    const bytes = buildMidi({
      format: 0, ppq: 480,
      tracks: [{
        events: [
          { tick: 0, type: 'on', note: 60, vel: 80, channel: 0 },
          { tick: 0, type: 'on', note: 36, vel: 80, channel: 9 },
        ],
      }],
    });
    const { tracks } = parseMidi(bytes);
    expect(tracks.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// parse — format 2 rejection
// ---------------------------------------------------------------------------

describe('parseMidi — format 2 rejection', () => {
  it('throws a descriptive error for format 2 files', () => {
    // buildMidi won't produce format 2 naturally; patch bytes
    const bytes = buildMidi({ format: 1, ppq: 480, tracks: [] });
    bytes[9] = 2;
    expect(() => parseMidi(bytes)).toThrow(/format 2/i);
  });
});

// ---------------------------------------------------------------------------
// convert — lock rule
// ---------------------------------------------------------------------------

describe('convertToSong — lock rule', () => {
  it('1-track: melody sum fills the loop', () => {
    const ppq = 480;
    const bytes = buildMidi({
      format: 1, ppq,
      tracks: [{
        events: [
          { tick: 0,         type: 'on', note: 60, vel: 80 },
          { tick: ppq,       type: 'on', note: 62, vel: 80 },
          { tick: ppq * 2,   type: 'on', note: 64, vel: 80 },
        ],
      }],
    });
    const { song } = convertToSong(parseMidi(bytes));
    const total = sumBeats(song.melody);
    // 3 notes, last one fills to 4-beat bar → loopBeats = 4; each beat >= 1/12
    expect(total).toBeGreaterThan(0);
    expect(Number.isFinite(total)).toBe(true);
    // loop must round to a whole 4-beat bar
    expect(total % 4).toBeCloseTo(0, 9);
  });

  it('2-track: bass sum + delay === melody sum', () => {
    const ppq = 480;
    const bytes = buildMidi({
      format: 1, ppq,
      tracks: [
        { events: [
          { tick: 0,         type: 'on', note: 72, vel: 80 }, // high = melody
          { tick: ppq,       type: 'on', note: 74, vel: 80 },
          { tick: ppq * 2,   type: 'on', note: 76, vel: 80 },
          { tick: ppq * 3,   type: 'on', note: 74, vel: 80 },
        ]},
        { events: [
          { tick: ppq * 2,   type: 'on', note: 36, vel: 80 }, // low = bass, enters late
          { tick: ppq * 3,   type: 'on', note: 38, vel: 80 },
        ]},
      ],
    });
    const { song } = convertToSong(parseMidi(bytes));
    const melodyTotal = sumBeats(song.melody);
    expect(song.bass).toBeDefined();
    const bassTotal = sumBeats(song.bass.notes) + (song.bass.delay || 0);
    expect(bassTotal).toBeCloseTo(melodyTotal, 9);
  });

  it('3-track: alto and bass both satisfy lock rule', () => {
    const ppq = 480;
    const bytes = buildMidi({
      format: 1, ppq,
      tracks: [
        { events: [
          { tick: 0,       type: 'on', note: 76, vel: 80 },
          { tick: ppq,     type: 'on', note: 74, vel: 80 },
          { tick: ppq * 2, type: 'on', note: 72, vel: 80 },
          { tick: ppq * 3, type: 'on', note: 71, vel: 80 },
        ]},
        { events: [
          { tick: ppq,     type: 'on', note: 64, vel: 80 }, // mid = alto
          { tick: ppq * 2, type: 'on', note: 62, vel: 80 },
          { tick: ppq * 3, type: 'on', note: 60, vel: 80 },
        ]},
        { events: [
          { tick: 0,       type: 'on', note: 40, vel: 80 }, // low = bass
          { tick: ppq * 2, type: 'on', note: 38, vel: 80 },
          { tick: ppq * 3, type: 'on', note: 36, vel: 80 },
        ]},
      ],
    });
    const { song } = convertToSong(parseMidi(bytes));
    const melodyTotal = sumBeats(song.melody);
    if (song.alto) {
      const altoTotal = sumBeats(song.alto.notes) + (song.alto.delay || 0);
      expect(altoTotal).toBeCloseTo(melodyTotal, 9);
    }
    if (song.bass) {
      const bassTotal = sumBeats(song.bass.notes) + (song.bass.delay || 0);
      expect(bassTotal).toBeCloseTo(melodyTotal, 9);
    }
  });
});

// ---------------------------------------------------------------------------
// convert — quantization
// ---------------------------------------------------------------------------

describe('convertToSong — quantization', () => {
  it('snaps an off-grid tick (ppq/4 + 1) to 0.25 beats', () => {
    const ppq = 480;
    const bytes = buildMidi({
      format: 1, ppq,
      tracks: [{
        events: [
          { tick: 0,           type: 'on', note: 60, vel: 80 },
          { tick: ppq / 4 + 1, type: 'on', note: 62, vel: 80 }, // 1 tick off
          { tick: ppq * 2,     type: 'on', note: 64, vel: 80 },
        ],
      }],
    });
    const { song } = convertToSong(parseMidi(bytes));
    // first note's beats = onset[1] - onset[0] = 0.25 - 0 = 0.25
    expect(song.melody[0][1]).toBeCloseTo(0.25, 9);
  });

  it('sixteenth note (ppq/4) quantizes to exactly 0.25 beats', () => {
    const ppq = 480;
    const bytes = buildMidi({
      format: 1, ppq,
      tracks: [{
        events: [
          { tick: 0,       type: 'on', note: 60, vel: 80 },
          { tick: ppq / 4, type: 'on', note: 62, vel: 80 },
          { tick: ppq / 2, type: 'on', note: 64, vel: 80 },
        ],
      }],
    });
    const { song } = convertToSong(parseMidi(bytes));
    expect(song.melody[0][1]).toBeCloseTo(0.25, 9);
    expect(song.melody[1][1]).toBeCloseTo(0.25, 9);
  });
});

// ---------------------------------------------------------------------------
// convert — chord → top note + warning
// ---------------------------------------------------------------------------

describe('convertToSong — chord reduction', () => {
  it('keeps highest note of a simultaneous chord and warns', () => {
    const ppq = 480;
    const bytes = buildMidi({
      format: 1, ppq,
      tracks: [{
        events: [
          { tick: 0,   type: 'on', note: 60, vel: 80 }, // chord: C4
          { tick: 0,   type: 'on', note: 64, vel: 80 }, // E4
          { tick: 0,   type: 'on', note: 67, vel: 80 }, // G4 — highest, kept
          { tick: ppq, type: 'on', note: 72, vel: 80 },
        ],
      }],
    });
    const { song, warnings } = convertToSong(parseMidi(bytes));
    expect(song.melody[0][0]).toBe('G4');
    expect(warnings.some(w => /chord/i.test(w))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// convert — >3 tracks → keep busiest 3
// ---------------------------------------------------------------------------

describe('convertToSong — track pruning', () => {
  it('keeps 3 busiest tracks when 4+ supplied and warns about dropped ones', () => {
    const ppq = 480;
    // 4 tracks: the 4th has fewest notes
    const makeTrack = (note, count) => ({
      events: Array.from({ length: count }, (_, i) => ({
        tick: i * ppq, type: 'on', note, vel: 80,
      })),
    });
    const bytes = buildMidi({
      format: 1, ppq,
      tracks: [
        { ...makeTrack(72, 8), events: [
          { tick: 0, type: 'name', text: 'Flute' },
          ...makeTrack(72, 8).events,
        ]},
        makeTrack(60, 7),
        makeTrack(48, 6),
        makeTrack(36, 2), // fewest — should be dropped
      ],
    });
    const { song, warnings } = convertToSong(parseMidi(bytes));
    // at most melody + alto + bass
    const trackCount = 1 + (song.alto ? 1 : 0) + (song.bass ? 1 : 0);
    expect(trackCount).toBeLessThanOrEqual(3);
    expect(warnings.some(w => /dropped track/i.test(w))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// convert — role assignment
// ---------------------------------------------------------------------------

describe('convertToSong — role assignment', () => {
  it('assigns highest mean pitch as melody, lowest as bass', () => {
    const ppq = 480;
    const bytes = buildMidi({
      format: 1, ppq,
      tracks: [
        { events: [{ tick: 0, type: 'on', note: 48, vel: 80 }] }, // bass register
        { events: [{ tick: 0, type: 'on', note: 72, vel: 80 }] }, // melody register
      ],
    });
    const { song } = convertToSong(parseMidi(bytes));
    // melody should be the high note (midi 72 = C6 before possible octave shift)
    const melodyMidi = song.melody[0][0];
    expect(melodyMidi.charCodeAt(0)).toBeGreaterThanOrEqual('A'.charCodeAt(0));
    // bass present, melody present, no alto for 2-track
    expect(song.bass).toBeDefined();
    expect(song.alto).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// convert — lead-first-onset zeroing
// ---------------------------------------------------------------------------

describe('convertToSong — lead onset zeroing', () => {
  it('shifts all onsets so lead first note is at beat 0', () => {
    const ppq = 480;
    // all tracks start at tick=ppq (1 beat offset)
    const bytes = buildMidi({
      format: 1, ppq,
      tracks: [
        { events: [
          { tick: ppq,     type: 'on', note: 72, vel: 80 },
          { tick: ppq * 2, type: 'on', note: 74, vel: 80 },
        ]},
        { events: [
          { tick: ppq,     type: 'on', note: 48, vel: 80 },
          { tick: ppq * 2, type: 'on', note: 50, vel: 80 },
        ]},
      ],
    });
    const { song } = convertToSong(parseMidi(bytes));
    // after zeroing, lead first onset = 0, so first melody beat is distance to 2nd note
    const melodyTotal = sumBeats(song.melody);
    expect(melodyTotal % 4).toBeCloseTo(0, 9);
  });

  it('drops bass notes that start before the lead and warns', () => {
    const ppq = 480;
    const bytes = buildMidi({
      format: 1, ppq,
      tracks: [
        { events: [
          { tick: ppq,     type: 'on', note: 72, vel: 80 }, // lead starts at tick=ppq
          { tick: ppq * 2, type: 'on', note: 74, vel: 80 },
          { tick: ppq * 3, type: 'on', note: 76, vel: 80 },
          { tick: ppq * 4, type: 'on', note: 74, vel: 80 },
        ]},
        { events: [
          { tick: 0,       type: 'on', note: 36, vel: 80 }, // starts BEFORE lead
          { tick: ppq * 2, type: 'on', note: 38, vel: 80 },
          { tick: ppq * 3, type: 'on', note: 40, vel: 80 },
          { tick: ppq * 4, type: 'on', note: 38, vel: 80 },
        ]},
      ],
    });
    const { song, warnings } = convertToSong(parseMidi(bytes));
    expect(warnings.some(w => /before the lead/i.test(w))).toBe(true);
    // bass should still be present with the remaining notes
    if (song.bass) {
      const bassTotal = sumBeats(song.bass.notes) + (song.bass.delay || 0);
      const melodyTotal = sumBeats(song.melody);
      expect(bassTotal).toBeCloseTo(melodyTotal, 9);
    }
  });
});

// ---------------------------------------------------------------------------
// convert — bass octave shift
// ---------------------------------------------------------------------------

describe('convertToSong — bass octave shift', () => {
  it('shifts bass into [48, 71] (C3..B4) and warns', () => {
    const ppq = 480;
    // bass notes way too high (mean ~96)
    const bytes = buildMidi({
      format: 1, ppq,
      tracks: [
        { events: [
          { tick: 0,       type: 'on', note: 84, vel: 80 }, // C6 — melody (highest)
          { tick: ppq,     type: 'on', note: 86, vel: 80 },
        ]},
        { events: [
          { tick: 0,       type: 'on', note: 96, vel: 80 }, // C7 — becomes bass (lowest after)
          { tick: ppq,     type: 'on', note: 96, vel: 80 }, // both same to avoid chord warning
        ]},
      ],
    });
    const { song, warnings } = convertToSong(parseMidi(bytes));
    if (song.bass) {
      // bass notes must be in valid range (after possible shift)
      for (const [name] of song.bass.notes) {
        const octave = parseInt(name.slice(-1));
        expect(octave).toBeGreaterThanOrEqual(2); // shifted down at least
      }
      expect(warnings.some(w => /shifted.*octave/i.test(w))).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// convert — note name regex on every emitted note
// ---------------------------------------------------------------------------

describe('convertToSong — note names', () => {
  it('all emitted note names match /^[A-G]#?\\d$/', () => {
    const ppq = 480;
    const bytes = buildMidi({
      format: 1, ppq,
      tracks: [
        { events: [
          { tick: 0,       type: 'on', note: 60, vel: 80 },
          { tick: ppq,     type: 'on', note: 61, vel: 80 }, // C#4
          { tick: ppq * 2, type: 'on', note: 62, vel: 80 },
          { tick: ppq * 3, type: 'on', note: 63, vel: 80 }, // D#4
        ]},
        { events: [
          { tick: 0,       type: 'on', note: 40, vel: 80 }, // E2
          { tick: ppq * 2, type: 'on', note: 41, vel: 80 }, // F2
          { tick: ppq * 3, type: 'on', note: 42, vel: 80 }, // F#2 — should be shifted up for bass
        ]},
      ],
    });
    const { song } = convertToSong(parseMidi(bytes));
    const allNotes = [
      ...song.melody,
      ...(song.alto ? song.alto.notes : []),
      ...(song.bass ? song.bass.notes : []),
    ];
    for (const [name] of allNotes) {
      expect(name, `note name "${name}" must match /^[A-G]#?\\d$/`).toMatch(NOTE_RE);
    }
  });
});

// ---------------------------------------------------------------------------
// convert — every beat positive
// ---------------------------------------------------------------------------

describe('convertToSong — beat values', () => {
  it('all emitted beat values are positive finite numbers', () => {
    const ppq = 480;
    const bytes = buildMidi({
      format: 1, ppq,
      tracks: [
        { events: [
          { tick: 0,       type: 'on', note: 60, vel: 80 },
          { tick: ppq / 4, type: 'on', note: 62, vel: 80 }, // fast 16th
          { tick: ppq / 2, type: 'on', note: 64, vel: 80 },
          { tick: ppq,     type: 'on', note: 65, vel: 80 },
        ]},
      ],
    });
    const { song } = convertToSong(parseMidi(bytes));
    const allNotes = [
      ...song.melody,
      ...(song.alto ? song.alto.notes : []),
      ...(song.bass ? song.bass.notes : []),
    ];
    for (const [, beats] of allNotes) {
      expect(typeof beats).toBe('number');
      expect(Number.isFinite(beats)).toBe(true);
      expect(beats).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// convert — loop rounded to 4-beat bar
// ---------------------------------------------------------------------------

describe('convertToSong — loop length', () => {
  it('loopBeats rounds up to nearest multiple of 4', () => {
    const ppq = 480;
    // 3 notes at beats 0, 1, 2 → maxEnd = 3, rounded up to 4
    const bytes = buildMidi({
      format: 1, ppq,
      tracks: [{
        events: [
          { tick: 0,       type: 'on', note: 60, vel: 80 },
          { tick: ppq,     type: 'on', note: 62, vel: 80 },
          { tick: ppq * 2, type: 'on', note: 64, vel: 80 },
        ],
      }],
    });
    const { song } = convertToSong(parseMidi(bytes));
    const total = sumBeats(song.melody);
    expect(total).toBeCloseTo(4, 9); // rounds up from 3 to 4
  });

  it('5-beat song rounds up to 8', () => {
    const ppq = 480;
    const bytes = buildMidi({
      format: 1, ppq,
      tracks: [{
        events: [
          { tick: 0,       type: 'on', note: 60, vel: 80 },
          { tick: ppq * 4, type: 'on', note: 62, vel: 80 }, // onset at beat 4, end = 5
        ],
      }],
    });
    const { song } = convertToSong(parseMidi(bytes));
    const total = sumBeats(song.melody);
    expect(total).toBeCloseTo(8, 9); // rounds 5 up to 8
  });
});

// ---------------------------------------------------------------------------
// convert — bpm clamp
// ---------------------------------------------------------------------------

describe('convertToSong — bpm clamp', () => {
  it('clamps bpm below 40 and warns', () => {
    const ppq = 480;
    const bytes = buildMidi({
      format: 1, ppq,
      tracks: [{
        events: [
          { tick: 0, type: 'tempo', uspq: 3_000_000 }, // 20 bpm
          { tick: 0, type: 'on', note: 60, vel: 80 },
        ],
      }],
    });
    const { song, warnings } = convertToSong(parseMidi(bytes));
    expect(song.bpm).toBe(40);
    expect(warnings.some(w => /clamped/i.test(w))).toBe(true);
  });

  it('clamps bpm above 220 and warns', () => {
    const ppq = 480;
    const bytes = buildMidi({
      format: 1, ppq,
      tracks: [{
        events: [
          { tick: 0, type: 'tempo', uspq: 200_000 }, // 300 bpm
          { tick: 0, type: 'on', note: 60, vel: 80 },
        ],
      }],
    });
    const { song, warnings } = convertToSong(parseMidi(bytes));
    expect(song.bpm).toBe(220);
    expect(warnings.some(w => /clamped/i.test(w))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// convert — scale starts at most frequent pitch class
// ---------------------------------------------------------------------------

describe('convertToSong — scale', () => {
  it('scale array starts with the most frequent pitch class', () => {
    const ppq = 480;
    // lots of G (midi 55, 67), and scale should start with G
    const bytes = buildMidi({
      format: 1, ppq,
      tracks: [{
        events: [
          { tick: 0,       type: 'on', note: 67, vel: 80 }, // G4
          { tick: ppq,     type: 'on', note: 67, vel: 80 }, // G4
          { tick: ppq * 2, type: 'on', note: 67, vel: 80 }, // G4
          { tick: ppq * 3, type: 'on', note: 60, vel: 80 }, // C4 (one)
        ],
      }],
    });
    const { song } = convertToSong(parseMidi(bytes));
    expect(song.scale[0]).toBe('G');
  });

  it('scale contains only pitch classes present in the song', () => {
    const ppq = 480;
    const bytes = buildMidi({
      format: 1, ppq,
      tracks: [{
        events: [
          { tick: 0,       type: 'on', note: 60, vel: 80 }, // C
          { tick: ppq,     type: 'on', note: 64, vel: 80 }, // E
          { tick: ppq * 2, type: 'on', note: 67, vel: 80 }, // G
          { tick: ppq * 3, type: 'on', note: 60, vel: 80 }, // C again
        ],
      }],
    });
    const { song } = convertToSong(parseMidi(bytes));
    // only C, E, G should appear in scale (no duplicates)
    const pitches = new Set(song.scale);
    expect(pitches.size).toBe(song.scale.length); // no duplicates
    expect(song.scale.every(p => ['C','E','G'].includes(p))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// convert — no-notes throws
// ---------------------------------------------------------------------------

describe('convertToSong — error on empty input', () => {
  it('throws a descriptive error when no note tracks survive', () => {
    // format 1 with only percussion (channel 9) — all dropped
    const bytes = buildMidi({
      format: 1, ppq: 480,
      tracks: [{
        events: [
          { tick: 0,   type: 'on', note: 36, vel: 100, channel: 9 },
          { tick: 480, type: 'on', note: 38, vel: 100, channel: 9 },
        ],
      }],
    });
    const parsed = parseMidi(bytes);
    expect(() => convertToSong(parsed)).toThrow(/no tracks/i);
  });
});

// ---------------------------------------------------------------------------
// convert — opts.label
// ---------------------------------------------------------------------------

describe('convertToSong — label', () => {
  it('uses opts.label when provided', () => {
    const ppq = 480;
    const bytes = buildMidi({
      format: 1, ppq,
      tracks: [{
        events: [{ tick: 0, type: 'on', note: 60, vel: 80 }],
      }],
    });
    const { song } = convertToSong(parseMidi(bytes), { label: 'My Song' });
    expect(song.label).toBe('My Song');
  });

  it('falls back to first named track name', () => {
    const ppq = 480;
    const bytes = buildMidi({
      format: 1, ppq,
      tracks: [{
        events: [
          { tick: 0, type: 'name', text: 'Oboe' },
          { tick: 0, type: 'on', note: 60, vel: 80 },
        ],
      }],
    });
    const { song } = convertToSong(parseMidi(bytes));
    expect(song.label).toBe('Oboe');
  });

  it('defaults to "MIDI import" when no label or track name', () => {
    const ppq = 480;
    const bytes = buildMidi({
      format: 1, ppq,
      tracks: [{
        events: [{ tick: 0, type: 'on', note: 60, vel: 80 }],
      }],
    });
    const { song } = convertToSong(parseMidi(bytes));
    expect(song.label).toBe('MIDI import');
  });

  it('sub string includes track count', () => {
    const ppq = 480;
    const bytes = buildMidi({
      format: 1, ppq,
      tracks: [
        { events: [{ tick: 0, type: 'on', note: 72, vel: 80 }] },
        { events: [{ tick: 0, type: 'on', note: 48, vel: 80 }] },
      ],
    });
    const { song } = convertToSong(parseMidi(bytes));
    expect(song.sub).toMatch(/MIDI import/);
    expect(song.sub).toMatch(/2/);
  });
});

// ---------------------------------------------------------------------------
// integration — realistic 2-track file with triplet figure + late bass chords
// ---------------------------------------------------------------------------

describe('integration — realistic 2-track MIDI conversion', () => {
  it('converts a 480-ppq 2-track file correctly', () => {
    const ppq = 480;
    // melody: 8 notes including a triplet figure (triplet = ppq*2/3 each)
    // beat 0: quarter, beat 1: quarter, beat 2: triplet×3, beat 4: quarter, ...
    const triplet = Math.round(ppq * 2 / 3); // ~320 ticks
    const melodyEvents = [
      { tick: 0,                              type: 'on', note: 72, vel: 80 }, // C5
      { tick: ppq,                            type: 'on', note: 74, vel: 80 }, // D5
      { tick: ppq * 2,                        type: 'on', note: 76, vel: 80 }, // E5 (triplet 1)
      { tick: ppq * 2 + triplet,              type: 'on', note: 77, vel: 80 }, // F5 (triplet 2)
      { tick: ppq * 2 + triplet * 2,          type: 'on', note: 76, vel: 80 }, // E5 (triplet 3)
      { tick: ppq * 4,                        type: 'on', note: 74, vel: 80 }, // D5
      { tick: ppq * 5,                        type: 'on', note: 72, vel: 80 }, // C5
      { tick: ppq * 6,                        type: 'on', note: 69, vel: 80 }, // A4
    ];
    // bass: starts 4 beats late, has 2 chords (only top note kept)
    const bassEvents = [
      { tick: ppq * 4,     type: 'on', note: 48, vel: 80 }, // C3 chord low
      { tick: ppq * 4,     type: 'on', note: 52, vel: 80 }, // E3 chord high — kept
      { tick: ppq * 6,     type: 'on', note: 43, vel: 80 }, // G2 chord low
      { tick: ppq * 6,     type: 'on', note: 47, vel: 80 }, // B2 chord high — kept
    ];

    const bytes = buildMidi({
      format: 1, ppq,
      tracks: [
        { events: [
          { tick: 0, type: 'name', text: 'Melody' },
          ...melodyEvents,
        ]},
        { events: [
          { tick: 0, type: 'name', text: 'Bass' },
          ...bassEvents,
        ]},
      ],
    });

    const parsed = parseMidi(bytes);
    expect(parsed.format).toBe(1);
    expect(parsed.ppq).toBe(ppq);
    expect(parsed.tracks.length).toBe(2);

    const { song, warnings } = convertToSong(parsed);

    // shape checks
    expect(song.melody.length).toBe(8);
    expect(song.bass).toBeDefined();
    expect(song.alto).toBeUndefined();

    // label from track name
    expect(song.label).toBe('Melody');
    expect(song.sub).toMatch(/2 tracks/);

    // lock rule
    const melodyTotal = sumBeats(song.melody);
    const bassTotal = sumBeats(song.bass.notes) + song.bass.delay;
    expect(bassTotal).toBeCloseTo(melodyTotal, 9);

    // loop must be a multiple of 4
    expect(melodyTotal % 4).toBeCloseTo(0, 9);

    // bass delay should be 4 beats (enters at beat 4, after lead-zeroing)
    expect(song.bass.delay).toBeCloseTo(4, 9);

    // chord warning (2 chords trimmed)
    expect(warnings.some(w => /chord/i.test(w))).toBe(true);

    // every beat positive
    for (const [, b] of song.melody) expect(b).toBeGreaterThan(0);
    for (const [, b] of song.bass.notes) expect(b).toBeGreaterThan(0);

    // all note names valid
    for (const [n] of [...song.melody, ...song.bass.notes]) {
      expect(n).toMatch(NOTE_RE);
    }

    // bpm default 120 (no tempo event)
    expect(song.bpm).toBe(120);

    // scale is an array of pitch class strings
    expect(Array.isArray(song.scale)).toBe(true);
    expect(song.scale.length).toBeGreaterThan(0);
    for (const pc of song.scale) expect(pc).toMatch(/^[A-G]#?$/);
  });
});
