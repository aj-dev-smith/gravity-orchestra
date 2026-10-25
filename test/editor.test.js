import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseMidi } from '../src/midi/parse.js';
import { convertToSong } from '../src/midi/convert.js';
import { PART_SPEC } from '../src/midi/orchestra.js';
import { validateSong, encodeSong, decodeSong } from '../src/share.js';
import { FOOT } from '../src/rooms/footing.js';
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
  it('a file with no program changes (Fireflies): the default map is what the importer routes BY ROLE (the sparkle line → music box), and the map re-routes on top', () => {
    const bytes = buildMidi({ format: 1, ppq: PPQ, tracks: [
      trk('Lead', null, 0, line(72, 32, .5)), trk('Counter', null, 1, line(64, 16)),
      trk('Bass', null, 2, line(40, 16)), trk('Sparkle', null, 3, line(84, 8, 2)),
      { events: [36, 38, 36, 38].flatMap((n, i) => [{ tick: i * PPQ, type: 'on', note: n, vel: 100, channel: 9 }, { tick: i * PPQ + 100, type: 'off', note: n, channel: 9 }]) },
    ] });
    const parsed = parseMidi(bytes);
    expect(parsed.hasPrograms).toBe(false);
    const def = M.defaultMidiMapping(parsed);
    // the panel's default IS the importer's own routing (role routing, for no-program files):
    // every source assigned, nothing invented, and re-applying it reproduces the plain import
    const base = convertToSong(parsed).song;
    expect(Object.values(def).filter(v => v === 'lead' || v.startsWith('lead+')).length).toBe(1);
    expect(def.drums).toBe('drums');
    expect(Object.keys(base.parts || {}).length).toBeGreaterThan(0);          // no longer belts-only
    for (const k of Object.keys(base.parts)) expect(Object.values(def).some(v => v === k || v === 'lead+' + k)).toBe(true);
    const again = M.applyMidiMapping(parsed, def).song;
    expect(again.melody).toEqual(base.melody);
    expect(Object.keys(again.parts || {}).sort()).toEqual(Object.keys(base.parts || {}).sort());
    // re-route on top: everything but the lead onto machines (a hand map overrides the auto one)
    const leadId = Object.keys(def).find(k => def[k] === 'lead' || def[k].startsWith('lead+'));
    const others = ['t0p0', 't1p0', 't2p0', 't3p0'].filter(k => k !== leadId);
    const hand = { ...def, [leadId]: 'lead', [others[0]]: 'musicbox', [others[1]]: 'turntable', [others[2]]: 'bass' };
    const { song } = M.applyMidiMapping(parsed, hand);
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
  it('carries a machine\'s HEIGHT (lift: rooms/footing.js) — sanitized, clamped, round-tripped; old entries read as before', () => {
    const L = P.sanitizeLayout({
      bells: [2, 3, 0, 4.23456], marimba: { x: 1, z: 2, yaw: .5, lift: 6 }, horns: [0, -20, 0, 0],   // (0: the user's "on the floor")
      riff: [1, 1, 0, -3], strum: [1, 1, 0, 1e6], pogo: [1, 1, 0, 'up'], dulcimer: [1, 1, null, 2], organ: [1, 1, 0, null],
      drums: [5, 6, 0, 2.5], bass: [7, 8], bowls: [7, 8, .25],
    });
    expect(L.bells).toEqual({ x: 2, z: 3, yaw: 0, lift: 4.235 });
    expect(L.marimba).toEqual({ x: 1, z: 2, yaw: .5, lift: 6 });
    expect(L.horns).toEqual({ x: 0, z: -20, yaw: 0, lift: 0 });
    expect(L.riff.lift).toBe(0); expect(L.strum.lift).toBe(FOOT.LIFT_MAX);           // (clamped: 0 … LIFT_MAX)
    for (const k of ['pogo', 'organ']) expect(L[k], k).toEqual({ x: 1, z: 1, yaw: 0 });   // (no number: the room solve's height)
    expect(L.dulcimer).toEqual({ x: 1, z: 1, yaw: 0, lift: 2 });                       // (a null yaw — JSON's hole — is unturned)
    expect(L.drums).toEqual({ x: 5, z: 6, yaw: 0, lift: 2.5 });                        // (the kit's entry too)
    expect(L.bass).toEqual({ x: 7, z: 8, yaw: 0 }); expect(L.bowls).toEqual({ x: 7, z: 8, yaw: .25 });
    // the compact form: [x, z, yaw, lift] when there is a height (0 included), else as before
    const E = P.encodeLayout(L);
    expect(E.bells).toEqual([2, 3, 0, 4.235]); expect(E.horns).toEqual([0, -20, 0, 0]);
    expect(E.bass).toEqual([7, 8]); expect(E.bowls).toEqual([7, 8, .25]);
    expect(P.sanitizeLayout(P.encodeLayout(L))).toEqual(L);
    expect(P.sanitizeLayout(JSON.parse(JSON.stringify(E)))).toEqual(L);
    // stored per song, and a placed slot stands at it (main clamps it again)
    const mem = new Map(), st = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: k => mem.delete(k) };
    P.saveLayout(st, 's', L);
    expect(P.loadLayout(st, 's')).toEqual(L);
    expect(P.placeSlot({ x: 0, z: 0, yaw: 0, w: 9 }, P.loadLayout(st, 's').bells)).toEqual({ x: 2, z: 3, yaw: 0, w: 9, pin: true, lift: 4.235 });
    expect(P.placeSlot({ x: 0, z: 0, yaw: 0, w: 9 }, P.loadLayout(st, 's').bass)).not.toHaveProperty('lift');
    // undo remembers heights too
    const H = P.makeHistory(); H.push('s', L); expect(H.pop('s')).toEqual(L);
  });
  it('a share link carries the stage\'s heights (song.stage, untrusted: sanitized on the way in)', async () => {
    const S = { ...SONGS['ode-to-joy'], stage: P.encodeLayout({ bells: { x: 2, z: 3, yaw: 0, lift: 4 }, drums: { x: 5, z: 6, yaw: 0, lift: 0 } }) };
    const back = await decodeSong(await encodeSong(S));
    expect(P.sanitizeLayout(back.stage)).toEqual({ bells: { x: 2, z: 3, yaw: 0, lift: 4 }, drums: { x: 5, z: 6, yaw: 0, lift: 0 } });
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

describe('stage edit — oriented footprints, undo, share ids (polish pass)', () => {
  it('a footprint turns WITH its machine (no growing axis-aligned box)', () => {
    const rel = [-4, 4, -1, 1];
    const f0 = P.footprint(rel, 10, 5, 0);
    expect(P.bounds(f0)).toEqual([6, 14, 4, 6]);
    const f90 = P.footprint(rel, 10, 5, Math.PI / 2).map(([x, z]) => [+x.toFixed(9), +z.toFixed(9)]);
    expect(P.bounds(f90)).toEqual([9, 11, 1, 9]);              // 8 × 2 turned → 2 × 8, same area
    const f45 = P.footprint(rel, 0, 0, Math.PI / 4);
    const area = poly => Math.abs(poly.reduce((a, [x, z], i) => { const [x2, z2] = poly[(i + 1) % poly.length]; return a + x * z2 - x2 * z; }, 0)) / 2;
    expect(area(f45)).toBeCloseTo(16, 9);
  });
  it('SAT: a turned machine clear of a box is clear, though its axis-aligned bounds overlap it', () => {
    const bar = P.footprint([-5, 5, -.5, .5], 0, 0, Math.PI / 4);   // a long thin diagonal
    const corner = [3, 5, 3, 5];                                    // sits in the bar's AABB, off the bar itself
    expect(P.overlaps(P.bounds(bar), corner)).toBe(true);
    expect(P.polysOverlap(bar, P.boxCorners(corner))).toBe(false);
    expect(P.conflicts(bar, [{ key: 'bells', box: corner }], null, null)).toEqual([]);
    expect(P.conflicts(bar, [{ key: 'bells', box: [-1, 1, -1, 1] }], null, null)).toEqual([{ key: 'bells', kind: 'overlap' }]);
    // the old axis-aligned API still answers the same
    expect(P.conflicts([-8, -6, 0, 1], [], [-10, -5, -2, 2], null)).toEqual([{ key: 'belt', kind: 'belt' }]);
    expect(P.polysOverlap(P.boxCorners([0, 2, 0, 2]), P.boxCorners([2, 4, 0, 2]))).toBe(false);   // a shared edge
    expect(P.inPoly([0, 0], bar)).toBe(true); expect(P.inPoly([3, -3], bar)).toBe(true); expect(P.inPoly([4, 4], bar)).toBe(false);
  });
  it('undo history: per song, newest first, bounded', () => {
    const h = P.makeHistory(3);
    h.push('a', {}); h.push('a', { bells: { x: 1, z: 2, yaw: 0 } });
    expect(h.size('a')).toBe(2); expect(h.size('b')).toBe(0);
    expect(h.pop('a')).toEqual({ bells: { x: 1, z: 2, yaw: 0 } });
    expect(h.pop('b')).toBe(null);
    expect(h.pop('a')).toEqual({}); expect(h.pop('a')).toBe(null);
    for (let i = 0; i < 5; i++) h.push('a', { bells: { x: i, z: 0, yaw: 0 } });
    expect(h.size('a')).toBe(3);
    h.push('b', {}); expect(h.size('a')).toBe(0);               // another song: a fresh stack
  });
  it('share-link edit slots are keyed by content, not label', async () => {
    const { fnv1a } = await import('../src/editor/index.js');
    const a = { ...SONGS['fur-elise'], stage: { musicbox: [3, 4] } }, b = { ...SONGS['fur-elise'], stage: { musicbox: [-3, 4] } };
    expect(fnv1a(JSON.stringify(a))).not.toBe(fnv1a(JSON.stringify(b)));
    expect(fnv1a(JSON.stringify(a))).toBe(fnv1a(JSON.stringify({ ...a })));
  });
  it('a part turned into a harmony belt closes the loop EXACTLY (not to ~1e-13)', () => {
    let n = 0;
    for (const S of Object.values(SONGS)){
      const L = sum(S.melody);
      for (const s of M.songSources(S)){
        if (!s.id.startsWith('part:')) continue;
        const m = { ...M.defaultSongMapping(S), [s.id]: 'belt' };
        for (const r of ['alto', 'bass']) if (m[r] === 'belt') m[r] = 'off';
        const { song } = M.applySongMapping(S, m);
        for (const r of ['alto', 'bass']) if (song[r] && !S[r]){ const d = chain(song[r]); expect(sum(d.notes) + (d.delay || 0)).toBe(L); n++; }
      }
    }
    expect(n).toBeGreaterThan(5);
  });
});
