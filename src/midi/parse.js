// parse.js — zero-dependency MIDI parser (format 0 and 1)
// returns { format, ppq, bpm, hasPrograms,
//           tracks: [{ name, notes: [{ midi, tick, channel, vel, dur, program }] }] }
//   dur      sounding length in ticks (note-on → its note-off, FIFO per channel+key);
//            null when the file never releases the note
//   program  the GM program (0–127) in effect on the note's channel at its onset —
//            channel state is GLOBAL across format-1 tracks (it's one synth), so a
//            program change in any track applies. A channel whose first program
//            change comes AFTER its first note (sloppy exports) uses that first one;
//            a channel with none is GM default 0 (acoustic grand piano).
//   hasPrograms  true when any non-percussion channel carries a program change
//
// The parser is FAITHFUL: it decodes every sounding note-on (vel > 0) on every
// channel — including channel 9 (percussion) — and records its velocity. The
// melody-vs-drum policy (which channel is percussion, how to map it) lives one
// layer up in convert.js. Keep this seam clean: parse decodes, convert decides.

// read a variable-length quantity from buf at pos; returns [value, newPos]
function readVlq(buf, pos) {
  let val = 0;
  for (let i = 0; i < 4; i++) {
    const b = buf[pos++];
    val = (val << 7) | (b & 0x7f);
    if (!(b & 0x80)) return [val, pos];
  }
  throw new Error('midi: malformed VLQ — continuation bit set for more than 4 bytes');
}

// read big-endian uint from buf at pos
function readUint(buf, pos, len) {
  let v = 0;
  for (let i = 0; i < len; i++) v = (v * 256) + buf[pos + i];
  return v;
}

// parse a single MTrk chunk; returns { name, notes, bpm, pcs }
function parseTrack(buf, start, end) {
  let pos = start;
  let abs = 0;      // absolute tick counter
  let status = 0;   // running status byte
  const notes = [];
  const pcs = [];          // program changes: { tick, channel, program }
  const open = new Map();  // `${ch}:${key}` → FIFO of indices into notes still sounding
  const release = (ch, key) => {
    const q = open.get(`${ch}:${key}`);
    if (q && q.length) { const i = q.shift(); notes[i].dur = abs - notes[i].tick; }
  };
  let name = '';
  let bpm = null;

  while (pos < end) {
    let [delta, p] = readVlq(buf, pos);
    pos = p;
    abs += delta;

    const b = buf[pos];

    // sysex: 0xF0 or 0xF7 — VLQ length then skip
    if (b === 0xf0 || b === 0xf7) {
      pos++;
      const [len, p2] = readVlq(buf, pos);
      pos = p2 + len;
      status = 0; // sysex clears running status
      continue;
    }

    // meta: 0xFF type VLQ-length data
    if (b === 0xff) {
      pos++;
      const type = buf[pos++];
      const [len, p2] = readVlq(buf, pos);
      pos = p2;
      if (type === 0x03) {
        // track name
        name = String.fromCharCode(...buf.slice(pos, pos + len));
      } else if (type === 0x51 && len === 3) {
        // set tempo: 3 bytes = microseconds per quarter note
        const uspq = readUint(buf, pos, 3);
        if (bpm === null) bpm = Math.round((60_000_000 / uspq) * 100) / 100;
      }
      pos += len;
      status = 0; // meta clears running status
      continue;
    }

    // midi event — determine status byte (running status or new)
    let ev;
    if (b & 0x80) {
      status = b;
      ev = b;
      pos++;
    } else {
      // running status: reuse last status, don't advance pos
      if (!status) throw new Error('midi: data byte with no prior status');
      ev = status;
    }

    const type = (ev >> 4) & 0xf;
    const ch   = ev & 0xf;

    switch (type) {
      case 0x8: { // note-off: two data bytes
        release(ch, buf[pos]);
        pos += 2;
        break;
      }
      case 0x9: { // note-on: two data bytes
        const midi = buf[pos++];
        const vel  = buf[pos++];
        // vel 0 = note-off. Every other note-on is kept, channel 9 included —
        // convert.js decides what's melody and what's percussion.
        if (vel > 0) {
          const k = `${ch}:${midi}`;
          if (!open.has(k)) open.set(k, []);
          open.get(k).push(notes.length);
          notes.push({ midi, tick: abs, channel: ch, vel, dur: null, program: 0 });
        } else {
          release(ch, midi);
        }
        break;
      }
      case 0xa: // polyphonic aftertouch: two data bytes
      case 0xb: // control change: two data bytes
      case 0xe: // pitch bend: two data bytes
        pos += 2;
        break;
      case 0xc: // program change: one data byte — kept (convert routes by it)
        pcs.push({ tick: abs, channel: ch, program: buf[pos] & 0x7f });
        pos += 1;
        break;
      case 0xd: // channel aftertouch: one data byte
        pos += 1;
        break;
      default:
        throw new Error(`midi: unknown event type 0x${type.toString(16)} at byte ${pos}`);
    }
  }

  return { name, notes, bpm, pcs };
}

// stamp every note with the program in effect on its channel at its onset (see header)
function assignPrograms(rawTracks) {
  const pcs = rawTracks.flatMap(t => t.pcs).sort((a, b) => a.tick - b.tick);
  const byCh = new Map();
  for (const pc of pcs) {
    if (!byCh.has(pc.channel)) byCh.set(pc.channel, []);
    byCh.get(pc.channel).push(pc);
  }
  for (const t of rawTracks) for (const n of t.notes) {
    const list = byCh.get(n.channel);
    if (!list) continue;
    let prog = list[0].program;                       // late first change still names the channel
    for (const pc of list) { if (pc.tick <= n.tick) prog = pc.program; else break; }
    n.program = prog;
  }
  return pcs.some(pc => pc.channel !== 9);
}

export function parseMidi(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new Error('midi: parseMidi expects a Uint8Array');
  }

  // MThd header
  if (bytes.length < 14) throw new Error('midi: file too short to contain a valid MThd header');
  const magic = String.fromCharCode(...bytes.slice(0, 4));
  if (magic !== 'MThd') throw new Error(`midi: bad magic bytes "${magic}" — expected "MThd"`);

  const headerLen = readUint(bytes, 4, 4);
  if (headerLen < 6) throw new Error(`midi: MThd length ${headerLen} < 6`);

  const format   = readUint(bytes, 8, 2);
  const numTracks = readUint(bytes, 10, 2);
  const division = readUint(bytes, 12, 2);

  if (format === 2) throw new Error('midi: format 2 (pattern-based) is not supported');
  if (format > 1)   throw new Error(`midi: unknown MIDI format ${format}`);
  if (division & 0x8000) throw new Error('midi: SMPTE time code division is not supported (only PPQ)');

  const ppq = division;

  // parse each MTrk chunk
  let pos = 8 + headerLen;
  const rawTracks = [];

  for (let i = 0; i < numTracks; i++) {
    if (pos + 8 > bytes.length) throw new Error(`midi: expected track ${i} header but file ended`);
    const chunkId = String.fromCharCode(...bytes.slice(pos, pos + 4));
    const chunkLen = readUint(bytes, pos + 4, 4);
    pos += 8;

    if (chunkId !== 'MTrk') {
      // unknown chunk — skip per spec
      pos += chunkLen;
      continue;
    }

    const end = pos + chunkLen;
    if (end > bytes.length) throw new Error(`midi: MTrk chunk ${i} extends past end of file`);
    rawTracks.push(parseTrack(bytes, pos, end));
    pos = end;
  }

  // first tempo found anywhere
  let bpm = 120;
  for (const t of rawTracks) {
    if (t.bpm !== null) { bpm = t.bpm; break; }
  }

  const hasPrograms = assignPrograms(rawTracks);

  // format 0: split single track by channel
  if (format === 0) {
    if (rawTracks.length === 0) return { format, ppq, bpm, hasPrograms, tracks: [] };
    const src = rawTracks[0].notes;
    const byChannel = new Map();
    for (const n of src) {
      if (!byChannel.has(n.channel)) byChannel.set(n.channel, []);
      byChannel.get(n.channel).push(n);
    }
    const tracks = [];
    for (const [ch, notes] of [...byChannel.entries()].sort((a, b) => a[0] - b[0])) {
      if (notes.length > 0) tracks.push({ name: `ch${ch}`, notes });
    }
    return { format, ppq, bpm, hasPrograms, tracks };
  }

  // format 1: one logical track per MTrk, drop empty
  const tracks = rawTracks
    .filter(t => t.notes.length > 0)
    .map(t => ({ name: t.name, notes: t.notes }));

  return { format, ppq, bpm, hasPrograms, tracks };
}
