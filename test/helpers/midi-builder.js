// midi-builder.js — programmatic MIDI file writer for tests
// buildMidi({ format, ppq, tracks }) → Uint8Array
//
// track event types:
//   { tick, type:'on',  note, vel?, channel? }   note-on
//   { tick, type:'off', note, vel?, channel? }   note-off
//   { tick, type:'vel0', note, channel? }         note-on with vel=0 (encodes as note-off intent)
//   { tick, type:'name', text }                   track name meta
//   { tick, type:'tempo', uspq }                  set-tempo meta (microseconds per quarter)
//   { tick, type:'timesig', num, den }            time-signature meta (den a power of 2)
//   { tick, type:'cc', cc, val, channel? }        control change
//   { tick, type:'pb', lsb, msb, channel? }       pitch bend
//   { tick, type:'pc', program, channel? }        program change
//   { tick, type:'aftertouch', note, pressure, channel? }  poly aftertouch
//   { tick, type:'chanaft', pressure, channel? }  channel aftertouch
//   { tick, type:'sysex', data }                  sysex (Uint8Array or array, without 0xF0/0xF7)
//
// opts per track:
//   runningStatus: true  — omit repeated status bytes to exercise running-status parsing
//   note0AsOff: true     — encode note-on with vel=0 instead of 0x8x for note-offs

function vlq(val) {
  if (val < 0x80) return [val];
  const bytes = [];
  bytes.unshift(val & 0x7f);
  val >>= 7;
  while (val) {
    bytes.unshift((val & 0x7f) | 0x80);
    val >>= 7;
  }
  return bytes;
}

function be4(v) {
  return [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
}

function be2(v) {
  return [(v >>> 8) & 0xff, v & 0xff];
}

function encodeMeta(type, data) {
  return [0xff, type, ...vlq(data.length), ...data];
}

function buildTrackChunk(events, opts = {}) {
  const { runningStatus = false, note0AsOff = false } = opts;
  const bytes = [];
  let lastStatus = -1;
  let absLast = 0;

  // sort by tick ascending
  const sorted = [...events].sort((a, b) => a.tick - b.tick);

  for (const ev of sorted) {
    const delta = ev.tick - absLast;
    absLast = ev.tick;
    bytes.push(...vlq(delta));

    if (ev.type === 'name') {
      const enc = [...ev.text].map(c => c.charCodeAt(0));
      bytes.push(...encodeMeta(0x03, enc));
      lastStatus = -1;
      continue;
    }

    if (ev.type === 'tempo') {
      const uspq = ev.uspq;
      bytes.push(...encodeMeta(0x51, [
        (uspq >>> 16) & 0xff,
        (uspq >>> 8)  & 0xff,
        uspq          & 0xff,
      ]));
      lastStatus = -1;
      continue;
    }

    if (ev.type === 'timesig') {
      bytes.push(...encodeMeta(0x58, [ev.num, Math.round(Math.log2(ev.den)), 24, 8]));
      lastStatus = -1;
      continue;
    }

    if (ev.type === 'sysex') {
      const data = Array.from(ev.data || []);
      bytes.push(0xf0, ...vlq(data.length + 1), ...data, 0xf7);
      lastStatus = -1;
      continue;
    }

    const ch = (ev.channel ?? 0) & 0xf;

    if (ev.type === 'on') {
      const status = 0x90 | ch;
      if (!runningStatus || status !== lastStatus) bytes.push(status);
      lastStatus = status;
      bytes.push(ev.note & 0x7f, (ev.vel ?? 64) & 0x7f);
      continue;
    }

    if (ev.type === 'vel0') {
      // note-on with vel=0 — exercises the vel-0-as-off path
      const status = 0x90 | ch;
      if (!runningStatus || status !== lastStatus) bytes.push(status);
      lastStatus = status;
      bytes.push(ev.note & 0x7f, 0);
      continue;
    }

    if (ev.type === 'off') {
      if (note0AsOff) {
        const status = 0x90 | ch;
        if (!runningStatus || status !== lastStatus) bytes.push(status);
        lastStatus = status;
        bytes.push(ev.note & 0x7f, 0);
      } else {
        const status = 0x80 | ch;
        if (!runningStatus || status !== lastStatus) bytes.push(status);
        lastStatus = status;
        bytes.push(ev.note & 0x7f, (ev.vel ?? 64) & 0x7f);
      }
      continue;
    }

    if (ev.type === 'cc') {
      const status = 0xb0 | ch;
      if (!runningStatus || status !== lastStatus) bytes.push(status);
      lastStatus = status;
      bytes.push(ev.cc & 0x7f, ev.val & 0x7f);
      continue;
    }

    if (ev.type === 'pb') {
      const status = 0xe0 | ch;
      if (!runningStatus || status !== lastStatus) bytes.push(status);
      lastStatus = status;
      bytes.push(ev.lsb & 0x7f, ev.msb & 0x7f);
      continue;
    }

    if (ev.type === 'pc') {
      const status = 0xc0 | ch;
      if (!runningStatus || status !== lastStatus) bytes.push(status);
      lastStatus = status;
      bytes.push(ev.program & 0x7f);
      continue;
    }

    if (ev.type === 'aftertouch') {
      const status = 0xa0 | ch;
      if (!runningStatus || status !== lastStatus) bytes.push(status);
      lastStatus = status;
      bytes.push(ev.note & 0x7f, ev.pressure & 0x7f);
      continue;
    }

    if (ev.type === 'chanaft') {
      const status = 0xd0 | ch;
      if (!runningStatus || status !== lastStatus) bytes.push(status);
      lastStatus = status;
      bytes.push(ev.pressure & 0x7f);
      continue;
    }
  }

  // end-of-track meta
  bytes.push(0x00, 0xff, 0x2f, 0x00);

  return bytes;
}

export function buildMidi({ format = 1, ppq = 480, tracks = [] }) {
  const trackChunks = tracks.map(t => {
    const { events = [], opts = {} } = t;
    return buildTrackChunk(events, opts);
  });

  const header = [
    // MThd
    0x4d, 0x54, 0x68, 0x64,
    ...be4(6),
    ...be2(format),
    ...be2(tracks.length),
    ...be2(ppq),
  ];

  const body = [];
  for (const chunk of trackChunks) {
    body.push(0x4d, 0x54, 0x72, 0x6b); // MTrk
    body.push(...be4(chunk.length));
    body.push(...chunk);
  }

  return new Uint8Array([...header, ...body]);
}
