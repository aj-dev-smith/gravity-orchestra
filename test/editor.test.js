import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseMidi } from '../src/midi/parse.js';
import { convertToSong } from '../src/midi/convert.js';
import { PART_SPEC } from '../src/midi/orchestra.js';
import { validateSong } from '../src/share.js';
import { SONGS } from '../src/songs/index.js';
import { layoutStations } from '../src/instruments/stations.js';
import { noteNum } from '../src/engine.js';
import { buildMidi } from './helpers/midi-builder.js';
import * as M from '../src/editor/mapping.js';
import * as P from '../src/editor/placement.js';

const NOTE_RE = /^[A-G]#?\d$/;
const sum = notes => notes.reduce((s, [, b]) => s + b, 0);
const chain = d => Array.isArray(d) ? { notes: d, delay: 0 } : d;
const midiFile = f => parseMidi(new Uint8Array(fs.readFileSync(path.join(__dirname, '../public/midi', f))));
/** every belt track obeys THE LOCK RULE; every part event is in the loop window with a real note */
function checkSong(song){
  validateSong(song);                                        // lock rule + note names (the share-link gate)
  const loop = sum(song.melody);
  for (const role of ['alto', 'bass']) if (song[role]){ const d = chain(song[role]); expect(sum(d.notes) + (d.delay || 0)).toBeCloseTo(loop, 9); }
  for (const [key, part] of Object.entries(song.parts || {})){
    expect(part.length, key).toBeGreaterThan(0);
    for (const e of part){ expect(e[0]).toBeGreaterThanOrEqual(0); expect(e[0]).toBeLessThan(loop); expect(e[1]).toMatch(NOTE_RE); }
  }
}
const PPQ = 480;
function trk(name, program, ch, notes){
  const events = [{ tick: 0, type: 'name', text: name }];
  if (program != null) events.push({ tick: 0, type: 'pc', program, channel: ch });
  for (const [b, m, len = 1] of notes){
    events.push({ tick: Math.round(b * PPQ), type: 'on', note: m, vel: 90, channel: ch });
    events.push({ tick: Math.round((b + len) * PPQ) - 4, type: 'off', note: m, channel: ch });
  }
  return { events };
}
const line = (base, n, step = 1) => Array.from({ length: n }, (_, i) => [i * step, base + [0, 2, 4, 5, 7, 9, 11, 12][i % 8], step]);

describe('instrument map — MIDI imports', () => {
  for (const f of ['room-tour.mid', 'night-mallets.mid', 'canon-in-d.mid']){
    it(`${f}: the default map reproduces the importer's own song exactly`, () => {
      const parsed = midiFile(f), base = convertToSong(parsed, { label: 'x' }).song;
      const def = M.defaultMidiMapping(parsed, { label: 'x' });
      expect(Object.keys(def).sort()).toEqual(M.midiSources(parsed).map(s => s.id).sort());
      const re = M.applyMidiMapping(parsed, def, { label: 'x' }).song;
      expect(re.melody).toEqual(base.melody);
      expect(re.alto).toEqual(base.alto); expect(re.bass).toEqual(base.bass);
      expect(re.drums).toEqual(base.drums); expect(re.parts).toEqual(base.parts);
    });
  }
  it('routes a voice onto a LINE machine (the turntable) and doubles the lead on the music box', () => {
    const parsed = midiFile('room-tour.mid');
    const def = M.defaultMidiMapping(parsed);
    const lead = Object.keys(def).find(k => M.isLead(def[k])), mar = Object.keys(def).find(k => def[k] === 'marimba');
    const { song } = M.applyMidiMapping(parsed, { ...def, [lead]: 'lead+musicbox', [mar]: 'turntable' });
    checkSong(song);
    expect(song.parts.marimba).toBeUndefined();
    expect(song.parts.turntable.length).toBeGreaterThan(20);
    // one marble, one line: no two turntable notes share a beat
    expect(new Set(song.parts.turntable.map(e => e[0])).size).toBe(song.parts.turntable.length);
    expect(song.parts.musicbox.length).toBeGreaterThan(convertToSong(parsed).song.parts.musicbox.length);
  });
  it('drums can be switched off; a map with no lead is refused', () => {
    const parsed = midiFile('room-tour.mid');
    const def = M.defaultMidiMapping(parsed);
    expect(M.applyMidiMapping(parsed, { ...def, drums: 'off' }).song.drums).toBeUndefined();
    const lead = Object.keys(def).find(k => M.isLead(def[k]));
    expect(() => M.applyMidiMapping(parsed, { ...def, [lead]: 'marimba' })).toThrow(/LEAD/);
  });
  it('a file with no program changes (the belts-only import — Fireflies): the default is the legacy 3 busiest lines; the map puts the rest on machines', () => {
    const bytes = buildMidi({ format: 1, ppq: PPQ, tracks: [
      trk('Lead', null, 0, line(72, 32, .5)), trk('Counter', null, 1, line(64, 16)),
      trk('Bass', null, 2, line(40, 16)), trk('Sparkle', null, 3, line(84, 8, 2)),
      { events: [36, 38, 36, 38].flatMap((n, i) => [{ tick: i * PPQ, type: 'on', note: n, vel: 100, channel: 9 }, { tick: i * PPQ + 100, type: 'off', note: n, channel: 9 }]) },
    ] });
    const parsed = parseMidi(bytes);
    expect(parsed.hasPrograms).toBe(false);
    const def = M.defaultMidiMapping(parsed);
    expect(def).toEqual({ t0p0: 'lead', t1p0: 'belt', t2p0: 'belt', t3p0: 'off', drums: 'drums' });
    const base = convertToSong(parsed).song;
    expect(base.parts).toBeUndefined();                       // what the importer did alone: belts only
    const { song } = M.applyMidiMapping(parsed, { ...def, t3p0: 'musicbox', t1p0: 'turntable', t2p0: 'bass' });
    checkSong(song);
    expect(Object.keys(song.parts).sort()).toEqual(['bass', 'musicbox', 'turntable']);
    expect(song.alto).toBeUndefined(); expect(song.bass).toBeUndefined();
    expect(song.melody).toEqual(base.melody);                 // the lead's belt is untouched
    for (const e of song.parts.musicbox) expect(noteNum(e[1])).toBeGreaterThanOrEqual(PART_SPEC.musicbox.lo);
  });
});

describe('instrument map — authored songs', () => {
  it('the default map is the song itself', () => {
    for (const k of ['daybreak-engine', 'fur-elise', 'canon-orchestra', 'mountain-king']){
      const S = SONGS[k], { song } = M.applySongMapping(S, M.defaultSongMapping(S));
      expect(song.melody).toBe(S.melody); expect(song.alto).toBe(S.alto); expect(song.bass).toBe(S.bass);
      expect(song.drums).toBe(S.drums); expect(song.parts ?? {}).toEqual(S.parts ?? {});
    }
  });
  it('a belt track moves onto a machine; a machine part becomes a harmony belt (lock rule by construction)', () => {
    const fe = SONGS['fur-elise'];
    const a = M.applySongMapping(fe, { ...M.defaultSongMapping(fe), bass: 'musicbox' }).song;
    checkSong(a);
    expect(a.bass).toBeUndefined(); expect(a.parts.musicbox.length).toBeGreaterThan(10);
    const db = SONGS['daybreak-engine'];
    const b = M.applySongMapping(db, { ...M.defaultSongMapping(db), 'part:marimba': 'belt', 'part:turntable': 'belt', drums: 'off' }).song;
    checkSong(b);
    expect(b.parts.marimba).toBeUndefined(); expect(b.parts.turntable).toBeUndefined();
    expect(b.alto && b.bass).toBeTruthy();                     // two harmony belts, by register
    expect(b.drums).toBeUndefined();
  });
  it('two sources on one machine are fitted together; the melody can be doubled', () => {
    const S = SONGS['canon-orchestra'];
    const { song } = M.applySongMapping(S, { ...M.defaultSongMapping(S), melody: 'lead+turntable', 'part:bells': 'musicbox' });
    checkSong(song);
    expect(song.melody).toBe(S.melody);
    expect(song.parts.turntable.length).toBeGreaterThan(10);
    expect(song.parts.bells).toBeUndefined();
    expect(song.parts.musicbox).not.toEqual(S.parts.musicbox);
  });
});

describe('instrument map — rules', () => {
  const src = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }, { id: 'd', name: 'D' }];
  it('one lead: a new lead demotes the old one; a leaving lead hands over to its busiest harmony belt (or stays)', () => {
    const m = { a: 'lead', b: 'marimba', c: 'off', d: 'off' };
    expect(M.setTarget(m, 'b', 'lead', src).mapping).toEqual({ a: 'belt', b: 'lead', c: 'off', d: 'off' });
    expect(M.setTarget(m, 'a', 'bells', src).mapping).toBe(m);
    const counted = src.map((s, i) => ({ ...s, count: [10, 5, 40, 1][i] }));
    const r = M.setTarget({ a: 'lead', b: 'belt', c: 'belt', d: 'off' }, 'a', 'musicbox', counted);
    expect(r.mapping).toEqual({ a: 'musicbox', b: 'belt', c: 'lead', d: 'off' }); expect(r.note).toMatch(/"C" now leads/);
    expect(M.setTarget(m, 'a', 'lead+bells', src).mapping.a).toBe('lead+bells');
  });
  it('≤ 2 harmony belts', () => {
    const m = { a: 'lead', b: 'belt', c: 'belt', d: 'off' };
    const r = M.setTarget(m, 'd', 'belt', src);
    expect(r.mapping).toBe(m); expect(r.note).toMatch(/room for 2/);
    expect(M.setTarget({ a: 'belt', b: 'belt', c: 'marimba', d: 'off' }, 'c', 'lead', src).mapping).toEqual({ a: 'belt', b: 'belt', c: 'lead', d: 'off' });
  });
  it('fitLine: one line, in range, with air between hops', () => {
    const notes = [{ beat: 0, midi: 30, vel: .5 }, { beat: 0, midi: 34, vel: .9 }, { beat: .01, midi: 60, vel: 1 }, { beat: 1, midi: 110, vel: 1 }, { beat: -1, midi: 60, vel: 1 }];
    const { part, warnings } = M.fitLine('turntable', notes, { bpm: 120, loopBeats: 4 });
    expect(part.map(e => e[0])).toEqual([0, 1]);
    for (const e of part){ expect(noteNum(e[1])).toBeGreaterThanOrEqual(M.LINE_SPEC.turntable.lo); expect(noteNum(e[1])).toBeLessThanOrEqual(M.LINE_SPEC.turntable.hi); }
    expect(warnings.length).toBeGreaterThan(0);
  });
  it('a stored map is sanitized + only saved when it differs from the default', () => {
    expect(M.sanitizeMapping({ t0p0: 'lead+musicbox', melody: 'lead', 'x y': 'off', drums: 4, alto: '<b>' })).toEqual({ t0p0: 'lead+musicbox', melody: 'lead' });
    const mem = new Map(), st = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: k => mem.delete(k) };
    M.saveMapping(st, 's', { melody: 'lead' }, { melody: 'lead' });
    expect(M.loadMapping(st, 's')).toBeNull();
    M.saveMapping(st, 's', { melody: 'lead+bells' }, { melody: 'lead' });
    expect(M.loadMapping(st, 's')).toEqual({ melody: 'lead+bells' });
  });
});

describe('stage placement', () => {
  it('snaps to the ½-unit grid and 15°', () => {
    expect(P.snap(3.26)).toBe(3.5); expect(P.snap(-0.2)).toBe(0);
    expect(P.snapYaw(.3)).toBeCloseTo(Math.PI / 12, 9);
    expect(P.snapYaw(Math.PI * 2 + .01)).toBeCloseTo(0, 9);
    expect(P.snapYaw(-Math.PI)).toBeCloseTo(Math.PI, 9);
  });
  it('sanitizes untrusted layouts (share links) and round-trips the compact form', () => {
    const L = P.sanitizeLayout({ marimba: [1.23456, -4, 7], bells: { x: 2, z: 3, yaw: 0 }, drums: [5, 6], bad: ['a', 1], 'x y': [1, 2], huge: [1e9, 0] });
    expect(L.marimba).toEqual({ x: 1.235, z: -4, yaw: +Math.atan2(Math.sin(7), Math.cos(7)).toFixed(3) });
    expect(L.drums).toEqual({ x: 5, z: 6, yaw: 0 });
    expect(L.bad).toBeUndefined(); expect(L['x y']).toBeUndefined();
    expect(L.huge.x).toBe(P.BOUND);
    expect(P.sanitizeLayout(P.encodeLayout(L))).toEqual(L);
    expect(P.sanitizeLayout('nope')).toEqual({}); expect(P.sanitizeLayout([1, 2])).toEqual({});
  });
  it('persists per song', () => {
    const mem = new Map(), st = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: k => mem.delete(k) };
    P.saveLayout(st, 'song-a', { bowls: { x: -3, z: 20, yaw: .5 } });
    expect(P.loadLayout(st, 'song-a')).toEqual({ bowls: { x: -3, z: 20, yaw: .5 } });
    expect(P.loadLayout(st, 'song-b')).toEqual({});
    P.saveLayout(st, 'song-a', {});
    expect(mem.size).toBe(0);
    mem.set(P.layoutKey('bad'), '{oops'); expect(P.loadLayout(st, 'bad')).toEqual({});
  });
  it('overlap checks: a shared edge is clear; belt / station / room conflicts are named', () => {
    expect(P.overlaps([0, 2, 0, 2], [2, 4, 0, 2])).toBe(false);
    expect(P.overlaps([0, 2, 0, 2], [1.5, 4, 1, 3])).toBe(true);
    const room = { x0: -30, x1: 30, z0: -20, z1: 30 };
    expect(P.conflicts([-1, 1, -1, 1], [{ key: 'bells', box: [0, 3, 0, 3] }], [-10, -5, -2, 2], room)).toEqual([{ key: 'bells', kind: 'overlap' }]);
    expect(P.conflicts([-8, -6, 0, 1], [], [-10, -5, -2, 2], room)).toEqual([{ key: 'belt', kind: 'belt' }]);
    expect(P.conflicts([25, 35, 0, 1], [], null, room)).toEqual([{ key: 'room', kind: 'room' }]);
    expect(P.describeConflicts([{ key: 'bells', kind: 'overlap' }, { key: 'belt', kind: 'belt' }], k => k.toUpperCase())).toBe('overlaps BELLS · overlaps the belt');
  });
  it('a placed slot is pinned; the room solve keeps it exactly and steps the rest around it', () => {
    expect(P.placeSlot({ x: 1, z: 2, yaw: .3, w: 9 }, null)).toEqual({ x: 1, z: 2, yaw: .3, w: 9 });
    expect(P.placeSlot({ x: 1, z: 2, yaw: .3, w: 9 }, { x: 5, z: 6, yaw: 0 })).toEqual({ x: 5, z: 6, yaw: 0, w: 9, pin: true });
    const wall = [-12, 12, -4, 2], room = { x0: -35, x1: 35, z0: -30, z1: 31 };
    // the user parks the bells right on the marimba's slot
    const items = [
      { key: 'marimba', x: -25, z: -10, box: [-6, 6, -4, 4] },
      { key: 'bells', x: -24, z: -9, box: [-5, 5, -3, 3], pin: true },
    ];
    const out = layoutStations(items, wall, room);
    expect(out.bells).toEqual({ x: -24, z: -9 });
    const mb = [out.marimba.x - 6, out.marimba.x + 6, out.marimba.z - 4, out.marimba.z + 4], bb = [-29, -19, -12, -6];
    expect(P.overlaps(mb, bb, 0)).toBe(false);
  });
});
