import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import * as THREE from 'three';
import { STATIONS, SEATS, stationFor } from '../../src/instruments/stations.js';
import { nextVoiceEpoch, sweepVoiceCaches } from '../../src/instruments/voicecache.js';
import { eventTimes, wrapP } from '../../src/instruments/clock.js';
import { ARM_AT } from '../../src/transport.js';
import { ROLL_T } from '../../src/engine.js';

/* ============================================================
   THE PLUGIN CONTRACT — describeContract(I) registers every check src/instruments/README.md
   promises for ONE instrument descriptor: the descriptor's shape, a valid demo, voices that are
   deterministic / finite / non-silent / bounded / cached in a voiceCache, voiceIds that bake
   every id the machine fires, strikes ON their beats and never before `start`, a pose that is a
   pure fn of songTime (scrub-safe: no accumulated state), a bake budget.
   test/inst-contract.test.js runs it over every plugin the registry's glob finds (a contributed
   machine included, no list to edit); test/scaffold.test.js runs it over a freshly generated one.
   A plugin's OWN mechanism (lands on the beat, at rest at contact, no penetration) is proven in
   its test/inst-<key>.test.js — this suite requires that file to exist.

   KNOWN EXCEPTIONS: a shipped machine that genuinely departs from a check by DESIGN is listed
   here with the reason — never by weakening the check for everyone. A new machine should
   need none.
   ============================================================ */
/* "every strike lands ON a part event": the shipped machines whose mechanism ALSO fires strikes that
   are not a note's onset, each allowed exactly that and nothing more. ok(h, near) — h = the strike
   ({ t, note }), near(note, from, to, held) = is there an event of `note` (null: any) whose loop
   time τ has from ≤ (h.t − τ) mod P ≤ to (held: ≤ the event's own duration instead), + one frame. */
export const KNOWN_OFFBEAT = {
  // a held marimba note ROLLS (the robot's tremolo): repeated strikes of that note through its duration
  marimba: { why: 'a held note rolls (repeated strikes through its duration)', ok: (h, near) => near(h.note, 0, 0, true) },
  // the autoharp's plectrum SWEEPS the chord: string j sounds at the marble's flight time to it, after the beat —
  // and a string still RINGING (inside its own held note) that the sweep crosses on its way is re-plucked (a soft
  // "brush", CLAUDE.md §8 honest-motion compromises)
  strum: { why: 'the plectrum sweeps a chord (each string ≤ .15 s after the beat) and brushes strings still ringing as it travels',
    ok: (h, near) => near(h.note, 0, .15) || near(h.note, 0, 0, true) },
  // a long organ hold is carried by a crossfaded continuation voice '<note>/c' (CLAUDE.md §8: no loop-sustain seam)
  organ: { why: 'a long hold re-fires a crossfaded continuation voice "<note>/c" inside the note', ok: (h, near) => h.note.endsWith('/c') && near(h.note.slice(0, -2), 0, 0, true) },
  // the chandelier's mechanism has voices of its own: the entry GATE's clink and the relay mirrors' tock
  ricochet: { why: 'mechanism sounds (the entry gate, the relay mirrors) are strikes, not notes', ok: h => h.note === 'gate' || h.note === 'relay' },
};

const POSE = { started: true, skipStrikes: true, onStrike(){} };
const LEAD_IN = 2.4;                                 // main.js: the count-in (songTime starts at −LEAD_IN)
const H = 1 / 120;                                   // the frame step the strike checks run at (s)
const BAKE_MS = 2500;                                // a demo's whole voice bake, cold, CPU ms (shipped worst: marimba ≈ .4–.65 s, 41 voices)
const BELT_KEYS = new Set(['lead', 'alto', 'bass', 'belt', 'drums', 'stage', 'ride', 'all', 'auto', 'fixed', 'free']);

const timing = (I, bpm = I.demo.bpm) => {
  const beat = 60 / bpm, loopBeats = I.demo.beats;
  return { beat, bpm, rollT: ROLL_T, P: ROLL_T + loopBeats * beat + 1.2, loopBeats };
};
const buildDemo = (I, { bpm, start = ARM_AT } = {}) => {
  const tm = timing(I, bpm), inst = I.make({ envMap: null, glowTex: null, THREE });
  const group = inst.build(I.demo.part, { rollT: tm.rollT, beat: tm.beat, P: tm.P, start, station: stationFor(I.key, 0, I),
    floorY: STATIONS[I.key]?.hang ? -20 : 0, ceilY: 30, loopBeats: tm.loopBeats });
  return { inst, group, ...tm };
};
const idsOf = (I, ctx) => I.voiceIds ? I.voiceIds(I.demo.part, ctx) : [...new Set(I.demo.part.map(e => e[1]))];

/* everything a frame can change in what is DRAWN, flattened in traversal order: every rendered
   object's WORLD matrix + its materials' animated scalars, an InstancedMesh's matrices / colours,
   any geometry attribute rewritten after build (version > 0 — warm() first, so that set is
   stable), morph influences. An object that isn't drawn (hidden, or a fully faded transparent
   glow — main's fade gate never draws those) records only that: a parked, invisible trail sprite
   may keep a stale position without lying to anyone. */
const faded = m => !m.visible || (m.transparent && (m.opacity ?? 1) <= .002);
/* a Points cloud (halos, ghost trails): a point whose colour is black (additive: nothing) or whose
   alpha / size is 0 isn't drawn — only the drawn points count */
function livePoints(g){
  const n = g.attributes.position?.count ?? 0, live = new Uint8Array(n).fill(1);
  for (const [name, a] of Object.entries(g.attributes)){
    if (/col/i.test(name) && a.itemSize >= 3) for (let i = 0; i < n; i++){ if (!a.array[i * a.itemSize] && !a.array[i * a.itemSize + 1] && !a.array[i * a.itemSize + 2]) live[i] = 0; }
    else if (/alpha|size/i.test(name) && a.itemSize === 1) for (let i = 0; i < n; i++){ if (!a.array[i]) live[i] = 0; }
  }
  return live;
}
/* a uniformly-scaled whole sphere looks the same at any rotation: its orientation (a squash axis left
   from the last time it moved) isn't state anyone can see */
const roundBall = o => o.geometry?.type === 'SphereGeometry' && !(o.material?.map) && (o.geometry.parameters.phiLength ?? 7) >= 2 * Math.PI - 1e-6
  && (o.geometry.parameters.thetaLength ?? 4) >= Math.PI - 1e-6;
const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
function snapshot(group){
  const out = [];
  const put = v => out.push(typeof v === 'boolean' ? +v : v);
  group.updateMatrixWorld(true);
  const walk = o => {
    put(o.visible);
    if (!o.visible) return;
    const mats = [o.material].flat().filter(Boolean);
    for (const m of mats){ put(m.visible); put(m.opacity ?? 0); }
    if (mats.length && !mats.every(faded)){
      o.matrixWorld.decompose(_p, _q, _s);
      if (roundBall(o) && Math.max(_s.x, _s.y, _s.z) - Math.min(_s.x, _s.y, _s.z) < 1e-3){ _p.toArray().forEach(put); _s.toArray().forEach(put); }
      else o.matrixWorld.elements.forEach(put);
      for (const m of mats){
        put(m.emissiveIntensity ?? 0); put(m.rotation ?? 0);
        if (m.color) m.color.toArray().forEach(put);
        if (m.emissive) m.emissive.toArray().forEach(put);
      }
      if (o.isInstancedMesh){                          // (only the first `count` instances are drawn)
        put(o.count); o.instanceMatrix.array.subarray(0, o.count * 16).forEach(put); o.instanceColor?.array.subarray(0, o.count * 3).forEach(put);
      }
      if (o.morphTargetInfluences) o.morphTargetInfluences.forEach(put);
      const g = o.geometry;
      if (g?.attributes){
        const live = o.isPoints ? livePoints(g) : null;
        for (const a of Object.values(g.attributes)) if (a.version > 0 && a.array){
          if (!live) a.array.forEach(put);
          else for (let i = 0; i < a.count; i++) if (live[i]) for (let k = 0; k < a.itemSize; k++) put(a.array[i * a.itemSize + k]);
        }
      }
      if (g?.drawRange){ put(g.drawRange.start); put(Number.isFinite(g.drawRange.count) ? g.drawRange.count : -1); }
    }
    for (const c of o.children) walk(c);
  };
  walk(group);
  return out;
}
/* pose the whole loop once first (so every attribute a frame ever rewrites has done so) */
const warm = (inst, P) => { for (let t = -LEAD_IN; t < P + 1; t += .05) inst.update(t, P, .05, POSE); };
const sameSnap = (a, b, msg) => {
  expect(b.length, `${msg}: the scene graph changed shape`).toBe(a.length);
  let worst = 0, at = -1;
  for (let i = 0; i < a.length; i++){
    const d = Object.is(a[i], b[i]) ? 0 : Math.abs(a[i] - b[i]);
    if (!(d <= worst)){ worst = Number.isNaN(d) ? Infinity : d; at = i; }
  }
  expect(worst, `${msg}: value #${at} differs (${a[at]} vs ${b[at]})`).toBeLessThanOrEqual(1e-9);
};
/** Register the whole contract for descriptor I. root: the tree it lives in (a URL ending in '/',
    holding src/instruments/<key>/ and test/inst-<key>.test.js) — the repo by default. */
export function describeContract(I, { root = new URL('../../', import.meta.url) } = {}){
const key = I.key;
describe(`instrument "${key}" contract`, () => {
  it('has a key, label, make, voice and a demo', () => {
    expect(typeof I.label).toBe('string');
    expect(typeof I.make).toBe('function');
    expect(typeof I.voice).toBe('function');
    expect(I.demo && Array.isArray(I.demo.part)).toBe(true);
    expect(I.demo.beats % 4).toBe(0);
  });

  it('descriptor shape: the README contract\'s fields, each of the right type', () => {
    expect(key).toMatch(/^[a-z][a-z0-9]*$/);
    expect(I.label.trim().length).toBeGreaterThan(0);
    const opt = (v, ok, what) => { if (v !== undefined) expect(ok(v), `${key}.${what} = ${JSON.stringify(v)}`).toBe(true); };
    const num = v => Number.isFinite(v);
    opt(I.wet, v => typeof v === 'boolean', 'wet');
    opt(I.lookHeight, num, 'lookHeight');
    opt(I.camera, v => v && num(v.dist) && v.dist > 0 && num(v.up) && (v.x === undefined || num(v.x)), 'camera');
    opt(I.color, v => /^#[0-9a-f]{6}$/i.test(v), 'color');
    opt(I.cameraKey, v => typeof v === 'string' && !BELT_KEYS.has(v), 'cameraKey');
    opt(I.xrGlow, v => num(v) && v > 0, 'xrGlow');
    opt(I.stand, v => num(v) && v <= 0, 'stand');
    opt(I.voiceIds, v => typeof v === 'function', 'voiceIds');
    opt(I.voiceHz, v => typeof v === 'function', 'voiceHz');
    opt(I.PART_LIMITS, v => v && typeof v === 'object', 'PART_LIMITS');
    opt(I.stage, v => v && typeof v === 'object' && (v.seats === undefined || (Array.isArray(v.seats) && v.seats.every(s => Object.hasOwn(SEATS, s)))), 'stage');
    // a key that is also a belt role / camera mode keeps the machine's key but needs its own shot key
    if (BELT_KEYS.has(key)) expect(I.cameraKey, `"${key}" collides with a belt role / camera mode: give it a cameraKey`).toBeTruthy();
  });

  it('its folder holds solve.js + voice.js, and it has its own test/inst-<key>.test.js', () => {
    for (const f of [`src/instruments/${key}/solve.js`, `src/instruments/${key}/voice.js`, `test/inst-${key}.test.js`])
      expect(fs.existsSync(new URL(f, root)), f).toBe(true);
  });

  it('it can be placed: a STATIONS slot, or a GUEST slot from its descriptor (stations.js guestSlot)', () => {
    const st = stationFor(key, 0, I);
    expect(st).toBeTruthy();
    for (const k of ['x', 'z', 'yaw', 'w', 'd']) expect(Number.isFinite(st[k]), `${key} slot.${k}`).toBe(true);
    if (!STATIONS[key]){
      expect(st.guest).toBe(true);
      expect(st.floor.length).toBeGreaterThan(0);
    }
  });

  it('demo events are inside the loop window', () => {
    for (const [b] of I.demo.part){ expect(b).toBeGreaterThanOrEqual(0); expect(b).toBeLessThan(I.demo.beats); }
  });

  it('the demo is valid song data: [beat, note, vel?, durBeats?], a sane tempo', () => {
    expect(Number.isFinite(I.demo.bpm) && I.demo.bpm >= 30 && I.demo.bpm <= 300, `bpm ${I.demo.bpm}`).toBe(true);
    expect(I.demo.beats).toBeGreaterThan(0);
    expect(I.demo.part.length).toBeGreaterThan(0);
    for (const e of I.demo.part){
      expect(Array.isArray(e) && e.length >= 2 && e.length <= 4, JSON.stringify(e)).toBe(true);
      expect(Number.isFinite(e[0]), JSON.stringify(e)).toBe(true);
      expect(typeof e[1] === 'string' && e[1].length > 0, JSON.stringify(e)).toBe(true);
      if (e[2] !== undefined) expect(e[2] > 0 && e[2] <= 1, `vel ${JSON.stringify(e)}`).toBe(true);
      if (e[3] !== undefined) expect(Number.isFinite(e[3]) && e[3] >= 0, `dur ${JSON.stringify(e)}`).toBe(true);
    }
  });

  it('every demo voice renders finite, bounded, non-silent samples', () => {
    const ids = I.voiceIds ? I.voiceIds(I.demo.part) : [...new Set(I.demo.part.map(e => e[1]))];
    for (const id of ids){
      const { samples, sr } = I.voice(id);
      expect(sr).toBeGreaterThanOrEqual(8000);
      expect(sr).toBeLessThanOrEqual(48000);
      expect(samples.length).toBeLessThan(sr * 6);
      let peak = 0;
      let finite = true;                         // plain loop — one expect per sample took minutes
      for (let n = 0; n < samples.length; n++){ const x = samples[n]; if (!Number.isFinite(x)) finite = false; else if (Math.abs(x) > peak) peak = Math.abs(x); }
      expect(finite, id).toBe(true);
      expect(peak, id).toBeGreaterThan(.01);
      expect(peak, id).toBeLessThanOrEqual(1);
    }
  });

  it('voice() is deterministic and memoised in a bounded voiceCache (cached within a build, freed by the sweep, re-rendered identically)', () => {
    for (const id of idsOf(I, timing(I)).slice(0, 4)){
      nextVoiceEpoch();
      const a = I.voice(id), copy = Float32Array.from(a.samples);
      expect(I.voice(id), `${key}:${id} is cached within a build`).toBe(a);
      nextVoiceEpoch(); sweepVoiceCaches();                // a build that never asked for it → freed
      const b = I.voice(id);
      expect(b, `${key}:${id} was freed by the sweep (a voiceCache, not a forever-Map)`).not.toBe(a);
      expect(b.sr).toBe(a.sr);
      expect(b.samples, `${key}:${id} renders identically`).toEqual(copy);
    }
  });

  it(`bake budget: the demo's whole voice bank renders cold in < ${BAKE_MS} ms of CPU`, () => {
    const ids = idsOf(I, timing(I));
    nextVoiceEpoch(); nextVoiceEpoch(); sweepVoiceCaches();    // (every cache cold)
    // CPU time, not wall time: a machine loaded by other work (parallel suites, CI neighbours) doesn't fail it
    const c0 = process.cpuUsage();
    for (const id of ids) I.voice(id);
    const c = process.cpuUsage(c0), ms = (c.user + c.system) / 1000;
    expect(ms, `${key}: ${ids.length} voices in ${ms.toFixed(0)} ms`).toBeLessThan(BAKE_MS);
  });
});

// ---------------------------------------------------------------------------
// the voice seam: voiceIds(part, ctx) bakes every id a strike fires; voiceHz reads a pitch
// ---------------------------------------------------------------------------
describe(`instrument "${key}" voice seam`, () => {
  const ctxAt = bpm => { const beat = 60 / bpm, loopBeats = I.demo.beats; return { beat, bpm, rollT: ROLL_T, P: ROLL_T + loopBeats * beat + 1.2, loopBeats }; };
  it('voiceIds(part, {beat, bpm, rollT, P, loopBeats}) covers every id the machine fires (at its tempo and at a slow one)', () => {
    for (const bpm of [I.demo.bpm, 50]){
      const ctx = ctxAt(bpm), ids = new Set(I.voiceIds ? I.voiceIds(I.demo.part, ctx) : I.demo.part.map(e => e[1]));
      const M = I.make({ envMap: null, glowTex: null, THREE });
      M.build(I.demo.part, { rollT: ROLL_T, beat: ctx.beat, P: ctx.P, start: -LEAD_IN, station: stationFor(key, 0, I), floorY: -20, ceilY: 30, loopBeats: ctx.loopBeats });
      const fired = new Set();
      for (let t = -LEAD_IN; t < 2 * ctx.P; t += 1 / 60)
        M.update(t, ctx.P, 1 / 60, { started: t >= 0, skipStrikes: false, onStrike: h => fired.add(h.note) });
      expect(fired.size, `${key} fires`).toBeGreaterThan(0);
      for (const id of fired) expect(ids.has(id), `${key} @${bpm} bpm fires "${id}" — not baked`).toBe(true);
    }
  });
  it('voiceHz (when given) reads a positive pitch for every id', () => {
    if (!I.voiceHz) return;
    for (const id of (I.voiceIds ? I.voiceIds(I.demo.part, ctxAt(I.demo.bpm)) : I.demo.part.map(e => e[1]))){
      const hz = I.voiceHz(id);
      expect(Number.isFinite(hz) && hz > 20 && hz < 5000, `${key} ${id} → ${hz}`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// TIME IS THE ONLY STATE: strikes on the beat, nothing before start, a scrub-safe pose
// ---------------------------------------------------------------------------
describe(`instrument "${key}" timeline`, () => {
  it('strikes fire ON their beats (within one frame) and never before `start` (ARM_AT: the count-in is armed)', () => {
    const { inst, P, rollT, beat } = buildDemo(I);
    const evs = eventTimes(I.demo.part, { rollT, beat });
    const evT = [...new Set(evs.map(e => +wrapP(e.t, P).toFixed(9)))];
    const near = (t, note, from, to, held = false) => evs.some(e => {
      if (note !== null && e.note !== note) return false;     // (null: an event of any note)
      const d = wrapP(t - e.t + 1e-9, P) - 1e-9;
      return d >= from - 1e-6 && d <= (held ? e.tDur : to) + H + 1e-6;
    });
    const hits = [];
    for (let k = 0, t = -LEAD_IN; t < 2 * P; t = -LEAD_IN + ++k * H)
      inst.update(t, P, H, { started: true, skipStrikes: false, onStrike: h => hits.push({ t, note: h.note }) });
    expect(hits.length, `${key} fires`).toBeGreaterThan(0);
    const early = hits.filter(h => h.t < ARM_AT);
    expect(early.map(h => `${h.note}@${h.t.toFixed(3)}`), `${key} struck before start`).toEqual([]);
    // each strike lands within one frame AFTER a part event (mod the loop)
    const late = h => Math.min(...evT.map(s => wrapP(h.t - s + 1e-9, P) - 1e-9));
    const known = KNOWN_OFFBEAT[key];
    const off = hits.filter(h => late(h) > H + 1e-6)
      .filter(h => !known?.ok(h, (note, from, to, held) => near(h.t, note, from, to, held)))
      .map(h => `${h.note}@${wrapP(h.t, P).toFixed(3)} (+${late(h).toFixed(3)} s)`);
    expect(off, `${key}: strikes off their beat${known ? ` (beyond its known exception: ${known.why})` : ''}`).toEqual([]);
    // …and every event time of the second loop is struck (within one frame)
    const missed = evT.filter(s => !hits.some(h => { const d = h.t - (s + P); return d >= -1e-6 && d <= H + 1e-6; }));
    expect(missed.map(s => s.toFixed(3)), `${key}: events never struck in loop 2`).toEqual([]);
  });

  it('not started → the ARMED pose at `start`, whatever songTime says, and no strikes', () => {
    const { inst, group, P } = buildDemo(I);
    warm(inst, P);
    let fired = 0;
    const idle = t => inst.update(t, P, H, { started: false, skipStrikes: false, onStrike(){ fired++; } });
    idle(-LEAD_IN); const a = snapshot(group);
    idle(P * .61); const b = snapshot(group);
    idle(ARM_AT); const c = snapshot(group);
    sameSnap(a, b, `${key} (not started at −LEAD_IN vs mid-loop)`);
    sameSnap(a, c, `${key} (not started vs at start)`);
    expect(fired).toBe(0);
  });

  it('the pose is a pure fn of songTime: update(t) → elsewhere → update(t) again is identical (scrub-safe, no accumulated state)', () => {
    const { inst, group, P, rollT, beat } = buildDemo(I);
    warm(inst, P);
    const evT = eventTimes(I.demo.part, { rollT, beat }).map(e => e.t);
    const first = Math.min(...evT), mid = evT[Math.floor(evT.length / 2)];
    // the count-in, just after the first strike, mid-loop, just before a strike, the seam, the second loop
    const T = [-1.9, first + .013, mid - .021, mid + .37, P - .3, P + first + .2, 1.5 * P].filter(t => t > -LEAD_IN);
    for (const t of T){
      inst.update(t, P, H, POSE); const a = snapshot(group);
      for (const u of [t + .37 * P, -LEAD_IN + .1, t - .05]){
        inst.update(u, P, H, POSE);
        inst.update(t, P, H, POSE);
        sameSnap(a, snapshot(group), `${key} @${t.toFixed(3)} after a visit to ${u.toFixed(3)}`);
      }
    }
  });
});
}
