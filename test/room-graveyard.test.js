import { describe, it, expect } from 'vitest';
import { planFooting, footingBoxes, rectAabb, FOOT } from '../src/rooms/footing.js';
import { buildFooting } from '../src/rooms/footing3d.js';
import { makePulse } from '../src/rooms/pulse.js';
import { STAGE } from '../src/rooms/common.js';
import { graveyardStyle, archShape } from '../src/rooms/graveyard-footing.js';
import { GY, graveSlots, placeGraves, obstaclesOf, supportRects, rectDist, graveCandles, votives, footLights, wispsFor, VOTIVE_R,
         doorOf, doorApex, doorLamps, towerOf, answerCue, answerTiming } from '../src/rooms/graveyard-place.js';

/* THE MIDNIGHT GRAVEYARD, set round its machines: the room's footing STYLE (graveyard-footing.js — ledger
   stones, chest tombs, mausolea, ruined bell towers, crypt terraces, piers for an open stand) drawn for
   every band and loft, inside the plan's envelopes, one ghost light per machine; and the yard's PROPS
   (graveyard-place.js — graves, candles, votives, lanterns, wisps), a pure fn of the anchors + the plan
   that keeps every one of them clear of every machine and support. */

const FL = STAGE.FLOOR, ROOMB = { x0: -STAGE.HW, x1: STAGE.HW, z0: STAGE.BACK, z1: STAGE.FRONT };
const st = (key, x, z, w, d, h = FOOT.PLINTH, extra = {}) => ({ key, kind: 'station', label: key, color: '#88aaff', x, z, yaw: 0, w, d,
  y: FL + h, bottom: FL + h, low: FL + h, box: [x - w / 2, x + w / 2, FL + h, FL + h + 5, z - d / 2, z + d / 2],
  cue: [{ t: 1 + (key.length % 3), w: 1 }, { t: 6, w: .5 }], P: 20, start: -.6, fixed: false, ...extra });
/* the footing kit's crowd (test/footing3d.test.js): every band, a gallery loft + a mid loft, stair + ladder,
   a cage, a turned riser, an open stand, the organ loft hung over the floor */
const CROWD = [
  { key: 'belt', kind: 'belt', color: '#ffaa55', x: 0, z: -1.17, yaw: 0, w: 21.74, d: 5.77, y: FL, bottom: FL, low: FL, box: [-10.87, 10.87, FL, 15.83, -4.05, 1.72], cue: [{ t: 3, w: 1 }], P: 20, start: -.6, fixed: true },
  { ...st('drums', 19, 19, 18, 5.5), kind: 'kit', color: '#ff8a3d' },
  st('bass', -20, 5, 11.7, 7.8), st('bells', 26, -10, 10.9, 6.85),
  st('dais', -27, 20, 10, 6, 2.4), st('plat', 0, 30, 10, 6, 5), st('platL', 20, 33, 10, 6, 8), st('tower', -20, -10, 12, 6, 14),
  st('g1', -10, -24, 12, 4, 19.33), st('g2', 4.5, -24, 12, 4, 19.33), st('m1', 28, 6, 8, 5, 6), st('m2', 28, -1, 8, 5, 6.2),
  st('yawed', -30, 32, 6, 4, 3, { yaw: .6 }),
  { ...st('tt', -6, 15, 14.2, 14.1, -1.29 - FL), low: -5.1, feet: [[-5.5, -4.5, .7], [5.5, -4.5, .7], [-5.5, 4.5, .7], [5.5, 4.5, .7]], hang: [-6.25, 4.35, 4.8, 5.7] },
  { key: 'organ', kind: 'hung', x: 0, z: -13.65, yaw: 0, w: 13.16, d: 4.64, y: 16, box: [-6.58, 6.58, FL, 24.54, -15.97, -11.33], cue: [], P: 20, start: -.6, fixed: true },
];
const PLAN = planFooting(CROWD, { floor: FL, room: ROOMB }), ENV = footingBoxes(PLAN);
const STYLE = graveyardStyle();
const build = (plan = PLAN) => buildFooting(plan, STYLE, { boxes: footingBoxes(plan) });
const meshes = f => { const out = []; f.group.traverse(o => { if (o.isMesh) out.push(o); }); return out; };
/* a lifted sweep (the kit's pistons, a wide machine, a small one, the open stand) and a song's rear gallery */
const LIFTS = [0, .5, 1.4, 2.5, 3.5, 5, 8, 10, 12, 16, 20, 24];
const tt = (u, x = 0, z = 12, yaw = 0) => ({ ...st('turntable', x, z, 14.22, 14.12, -1.29 - FL + u, { yaw }), y: -.93 + u, ground: -.93, lift: u, low: -5.1 + u,
  feet: [[-5.5, -4.5, .7], [5.5, -4.5, .7], [-5.5, 4.5, .7], [5.5, 4.5, .7]], hang: [-6.25, 4.35, 4.8, 5.7] });
const sweep = u => [
  { ...st('drums', -20, 22, 18, 5.5, FOOT.PLINTH + u), kind: 'kit', color: '#ff8a3d', low: FL + FOOT.PLINTH + u - .335 },
  st('marimba', 18, 22, 14, 6, FOOT.PLINTH + u), st('bells', 22, -10, 6.4, 4.2, FOOT.PLINTH + u), tt(u, -14),
];
const GALLERY = [st('riff', -28, -22, 12, 4.4, 19.33), st('strum', -15, -22, 12, 4.4, 19.33), st('horns', 22, -20, 9, 5, 19.33),
  { ...st('drums', 0, 20, 18, 5.5), kind: 'kit', color: '#ff8a3d', low: FL + FOOT.PLINTH - .335 }];
/* the same machines TURNED (a station's yaw turns its pad, its stair, its feet) at one lift per band */
const turned = u => [
  { ...st('drums', -24, 27, 18, 5.5, FOOT.PLINTH + u, { yaw: .4 }), kind: 'kit', color: '#ff8a3d', low: FL + FOOT.PLINTH + u - .335 },
  st('marimba', 20, 25, 14, 6, FOOT.PLINTH + u, { yaw: -.5 }), st('bells', 25, -12, 6.4, 4.2, FOOT.PLINTH + u, { yaw: .7 }), tt(u, 0, 8, .3),
];
const TURNS = [0, 2.5, 6, 14];
const PLANS = [['crowd', PLAN], ...LIFTS.map(u => [`lift ${u}`, planFooting(sweep(u), { floor: FL, room: ROOMB })]), ['gallery', planFooting(GALLERY, { floor: FL, room: ROOMB })],
  ...TURNS.map(u => [`turned ${u}`, planFooting(turned(u), { floor: FL, room: ROOMB })])];
const anchorsOf = name => name === 'crowd' ? CROWD : name === 'gallery' ? GALLERY : name.startsWith('turned') ? turned(+name.split(' ')[1]) : sweep(+name.split(' ')[1]);

describe('graveyard footing: the yard\'s own masonry under every machine', () => {
  it('the plans cover every form: each band, open stands low to high, a high + a mid loft, stairs, ladders, a cage', () => {
    const bands = new Set(PLANS.flatMap(([, p]) => p.pads.map(q => (q.open ? 'open:' : '') + q.band)));
    for (const b of ['flush', 'low', 'mid', 'high', 'open:mid', 'open:high']) expect(bands.has(b), b).toBe(true);
    expect(new Set(PLANS.flatMap(([, p]) => p.lofts.map(L => L.band)))).toEqual(new Set(['mid', 'high']));
    const acc = PLANS.flatMap(([, p]) => [...p.pads, ...p.lofts].filter(q => q.access).map(q => q.access));
    expect(acc.map(a => a.kind)).toContain('stair'); expect(acc.map(a => a.kind)).toContain('ladder');
    expect(acc.some(a => a.cage)).toBe(true); expect(acc.some(a => a.flights > 1)).toBe(true);
    expect(PLANS.some(([, p]) => p.lofts.some(L => L.access?.kind === 'stair')), 'a terrace climbed by its stair').toBe(true);
  });
  it('five merged slots + the ghost light: one draw each, every mesh tagged as footing, one shared empty hook group', () => {
    for (const [name, plan] of PLANS){
      const f = build(plan), M = meshes(f);
      expect(M.length, name).toBeLessThanOrEqual(6);
      for (const m of M){ expect(['footing:base', 'footing:ashlar', 'footing:moss', 'footing:steel', 'footing:deck', 'footing:edge'], name).toContain(m.name); expect(m.userData.footing).toBe(true); }
      expect(f.group.children.length, name).toBeLessThanOrEqual(M.length + 1);
      f.dispose();
    }
  });
  it('everything it draws stays inside the plan\'s envelopes (what the shot solve keeps an eye out of)', () => {
    for (const [name, plan] of PLANS){
      const f = build(plan), B = footingBoxes(plan).map(e => e.box);
      for (const m of meshes(f)){
        const p = m.geometry.attributes.position.array;
        let worst = 0, at = null;
        for (let i = 0; i < p.length; i += 3){
          const x = p[i], y = Math.max(p[i + 1], FL), z = p[i + 2];
          if (p[i + 1] < FL - .2){ worst = Infinity; at = [x, p[i + 1], z]; break; }
          let d = Infinity;
          for (const b of B) d = Math.min(d, Math.hypot(Math.max(b[0] - x, 0, x - b[1]), Math.max(b[2] - y, 0, y - b[3]), Math.max(b[4] - z, 0, z - b[5])));
          if (d > worst){ worst = d; at = [x, y, z]; }
        }
        expect(worst, `${name} ${m.name}: ${worst.toFixed(3)} u out at ${at && at.map(v => v.toFixed(2))}`).toBeLessThanOrEqual(.035);
      }
      f.dispose();
    }
  });
  it('…and inside the supports as the plan TURNS them (a turned pad\'s AABB is far bigger than the pad)', () => {
    for (const [name, plan] of PLANS){
      const f = build(plan), R = supportRects(plan);
      for (const m of meshes(f)){
        const p = m.geometry.attributes.position.array;
        let worst = 0, at = null;
        for (let i = 0; i < p.length; i += 3){
          let d = Infinity;
          for (const r of R){ d = Math.min(d, rectDist(r, p[i], p[i + 2])); if (d === 0) break; }
          if (d > worst){ worst = d; at = [p[i], p[i + 1], p[i + 2]]; }
        }
        expect(worst, `${name} ${m.name}: ${worst.toFixed(3)} u out at ${at && at.map(v => v.toFixed(2))}`).toBeLessThanOrEqual(.035);
      }
      f.dispose();
    }
  });
  it('every face looks out (a flipped face would be culled away)', () => {
    for (const [name, plan] of PLANS){
      const f = build(plan);
      for (const m of meshes(f)){
        const g = m.geometry, p = g.attributes.position.array, n = g.attributes.normal?.array, I = g.index.array;
        if (!n) continue;
        let bad = 0;
        for (let t = 0; t < I.length; t += 3){
          const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
          const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
          const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx, L = Math.hypot(cx, cy, cz);
          if (L > 1e-9 && (cx * n[a] + cy * n[a + 1] + cz * n[a + 2]) / L < .99) bad++;
        }
        expect(bad, `${name} ${m.name}`).toBe(0);
      }
      f.dispose();
    }
  });
  it('every machine\'s ghost light is where the audience sees it: at its support\'s edge or out past its own footprint', () => {
    /* how far in from a turned rect's edge a point lies (negative: outside it) */
    const inset = (r, x, z) => { const c = Math.cos(r.yaw || 0), s = Math.sin(r.yaw || 0), dx = x - r.x, dz = z - r.z;
      const u = c * dx - s * dz, v = s * dx + c * dz; return Math.min(r.hw - Math.abs(u), r.hd - Math.abs(v)); };
    for (const [name, plan] of PLANS){
      const f = build(plan), g = meshes(f).find(m => m.name === 'footing:edge').geometry, P = g.attributes.position.array, S = g.attributes.aPulse.array;
      const AN = new Map(anchorsOf(name).map(a => [a.key, a]));
      for (const p of plan.pads){
        const a = AN.get(p.key), foot = { x: a.x, z: a.z, yaw: a.yaw || 0, hw: a.w / 2, hd: a.d / 2 }, sup = p.loft ? plan.lofts.find(L => L.id === p.loft) : p;
        let seen = 0, all = 0;                                                     // (≥ 12 vertices: a run of strip)
        for (let i = 0; i < S.length; i++) if (Math.round(S[i]) === p.pulse){
          all++;
          if (rectDist(foot, P[3 * i], P[3 * i + 2]) > .005 || inset(sup, P[3 * i], P[3 * i + 2]) <= .12) seen++;
        }
        expect(seen, `${name}: ${p.key} (${p.open ? 'open ' : ''}${p.band}${p.loft ? ' on ' + p.loft : ''}) lit only deep under itself (${seen}/${all})`).toBeGreaterThanOrEqual(12);
      }
      f.dispose();
    }
  });
  it('every machine has its own ghost light (a lit joint under its stone\'s lip, a door seam, a lantern, a kerb, its stretch of a terrace) — a pure fn of songTime', () => {
    for (const [name, plan] of PLANS){
      const f = build(plan), edge = meshes(f).find(m => m.name === 'footing:edge');
      const slots = new Set(edge.geometry.attributes.aPulse.array);
      for (const p of plan.pads) expect(slots.has(p.pulse), `${name}: ${p.key} (${p.open ? 'open ' : ''}${p.band}${p.loft ? ' on ' + p.loft : ''}) unlit`).toBe(true);
      const U = edge.material.uniforms.uPulse.value, P = plan.pulses.map(s => makePulse(s.cue, { P: s.P, start: s.start }));
      for (const t of [-2.4, -.3, 1.05, 3.2, 6.1, 27.3]){
        f.update(t);
        P.forEach((q, i) => expect(U[i], `${name} slot ${i} @${t}`).toBeCloseTo(Math.min(1, q.at(t) + .35 * q.next(t)), 6));
      }
      f.update(-2.4); expect(Array.from(U.slice(0, P.length)).every(v => v === 0), 'the count-in is dark').toBe(true);
      f.dispose();
    }
  });
  it('its materials are the room\'s: made once, shared by every build, readable (no near-black, no mirror), the room\'s to dispose', () => {
    const s = graveyardStyle().warm(null), a = buildFooting(PLAN, s, { boxes: ENV }), b = buildFooting(PLAN, s, { boxes: ENV });
    const mat = (f, slot) => meshes(f).find(m => m.name === 'footing:' + slot).material;
    for (const slot of ['base', 'ashlar', 'moss', 'steel', 'deck', 'edge']) expect(mat(a, slot), slot).toBe(mat(b, slot));
    for (const slot of ['base', 'ashlar', 'moss', 'steel', 'deck']){
      const m = mat(a, slot), c = m.color, lum = .2126 * c.r + .7152 * c.g + .0722 * c.b;
      expect(lum, `${slot} albedo`).toBeGreaterThan(.08);
      expect(m.metalness, `${slot} metalness`).toBeLessThanOrEqual(.55);
    }
    let gone = 0; mat(a, 'base').addEventListener('dispose', () => gone++);
    a.dispose(); b.dispose(); expect(gone).toBe(0);
    s.dispose(); expect(gone).toBe(1);
  });
  it('what dips into its deck (the kit\'s pistons) stays in stone or timber: a roof / a deck at least the well deep', () => {
    for (const u of [.5, 2.5, 6, 14]){
      const plan = planFooting([{ ...st('drums', 0, 12, 18, 5.5, FOOT.PLINTH + u), kind: 'kit', low: FL + FOOT.PLINTH + u - .335 }], { floor: FL, room: ROOMB });
      const q = plan.pads[0], f = build(plan), M = meshes(f);
      // the solid under the pad's middle, from its top down: every slot's triangles crossing the vertical there
      const ys = [];
      for (const m of M) if (m.name !== 'footing:edge'){
        const a = m.geometry.attributes.position.array, I = m.geometry.index.array, x = q.x + .37, z = q.z - .21;
        for (let t = 0; t < I.length; t += 3){
          const [p, r, s] = [I[t] * 3, I[t + 1] * 3, I[t + 2] * 3];
          const d = (a[r] - a[p]) * (a[s + 2] - a[p + 2]) - (a[s] - a[p]) * (a[r + 2] - a[p + 2]);
          if (Math.abs(d) < 1e-12) continue;
          const uu = ((x - a[p]) * (a[s + 2] - a[p + 2]) - (a[s] - a[p]) * (z - a[p + 2])) / d, vv = ((a[r] - a[p]) * (z - a[p + 2]) - (x - a[p]) * (a[r + 2] - a[p + 2])) / d;
          if (uu >= 0 && vv >= 0 && uu + vv <= 1) ys.push(a[p + 1] + uu * (a[r + 1] - a[p + 1]) + vv * (a[s + 1] - a[p + 1]));
        }
      }
      const under = ys.filter(y => y < q.top - .08).sort((a, b) => b - a);
      // under its carved top (≤ .05) / its planks (.07): the first surface is the slab's own underside — deeper than the well
      expect(q.top - under[0], `${q.band}: solid ${(q.top - under[0]).toFixed(3)} under the top`).toBeGreaterThanOrEqual(q.well + .03);
      f.dispose();
    }
  });
});

describe('graveyard arches: the masonry behind each ring, in as few courses as hide under it', () => {
  const SHAPES = [[2.6, 1.6], [3.2, 1.2], [3.6, 2.2], [2, .8], [3.4, 1], [4.6, 3.1], [1.4, .45]];
  it('no course fills the opening; nothing behind the ring is left open; far fewer boxes than .26 u courses', () => {
    for (const [span, rise] of SHAPES){
      const a0 = -span / 2, yS = 3, { mid, ring, cx, cy, Rr, xAt, yA, courses } = archShape(a0, a0 + span, yS, rise);
      const tag = `span ${span} rise ${rise}`;
      // contiguous from the springing to the crown
      expect(courses[0][0], tag).toBe(yS); expect(courses[courses.length - 1][1], tag).toBeCloseTo(yA, 9);
      for (let j = 1; j < courses.length; j++) expect(courses[j][0], tag).toBe(courses[j - 1][1]);
      const covered = (x, y) => courses.some(([ya, yb, e]) => y >= ya - 1e-9 && y <= yb + 1e-9 && e - a0 >= .02 && (e >= mid - .01 || x <= e + 1e-9));
      for (let y = yS + .001; y < yA; y += .01){
        const xi = xAt(y);
        // (1) the opening stays open: a course's inner edge is never past the intrados anywhere it stands
        for (const [ya, yb, e] of courses) if (y >= ya && y <= yb && e - a0 >= .02 && e < mid - .01) expect(e, `${tag} y ${y.toFixed(2)}`).toBeLessThanOrEqual(xi + 1e-9);
        // (2) masonry or ring everywhere from the pier to the intrados: past the extrados (the ring's outer edge) it is masonry
        const dy = y - cy, xo = Rr + ring > Math.abs(dy) ? cx - Math.sqrt((Rr + ring) ** 2 - dy * dy) : mid;
        for (let x = a0 + .005; x < Math.min(xo, mid) - .005; x += .02) expect(covered(x, y), `${tag}: open at ${x.toFixed(2)}, ${y.toFixed(2)}`).toBe(true);
      }
      // (3) cheaper than the uniform .26 u courses it replaced
      const n = Math.max(2, Math.ceil(rise / .26)), boxes = cs => cs.reduce((s, [, , e]) => s + (e - a0 < .02 ? 0 : e >= mid - .01 ? 1 : 2), 0);
      const uni = Array.from({ length: n }, (_, j) => [0, 0, Math.min(mid, xAt(yS + rise * j / n))]);
      expect(boxes(courses), tag).toBeLessThanOrEqual(boxes(uni));
    }
  });
});

describe('graveyard props: the churchyard round its machines (pure)', () => {
  const sets = PLANS.map(([name, plan]) => [name, plan, anchorsOf(name)]);
  it('every grave, candle and votive stands clear of every machine, hung post and support by GY.CLEAR', () => {
    for (const [name, plan, anchors] of sets){
      const obs = obstaclesOf(anchors, plan, FL), G = placeGraves(anchors, plan, { floor: FL, obs });
      for (const g of [...G.tall, ...G.low]) for (const o of obs)
        expect(rectDist(o, g.x, g.z), `${name}: a ${g.kind} at ${g.x.toFixed(1)},${g.z.toFixed(1)} vs ${o.key}`).toBeGreaterThanOrEqual(g.r + GY.CLEAR - 1e-9);
      for (const c of [...graveCandles([...G.tall, ...G.low], obs), ...votives(anchors, plan, obs)]) for (const o of obs)
        expect(rectDist(o, c.x, c.z), `${name}: a candle vs ${o.key}`).toBeGreaterThanOrEqual(VOTIVE_R + GY.CLEAR - 1e-9);
    }
  });
  it('the obstacles are the machines, the hung posts that come down to the floor, and every support envelope', () => {
    const obs = obstaclesOf(CROWD, PLAN, FL), keys = new Set(obs.map(o => o.key));
    for (const a of CROWD) expect(keys.has(a.key), a.key).toBe(true);                       // (the organ's posts reach the floor)
    for (const e of ENV) expect(keys.has(e.unit), e.unit).toBe(true);
    for (const [name, plan] of PLANS){                                                       // footingBoxes = the AABBs of the turned rects
      const R = supportRects(plan), E = footingBoxes(plan);
      expect(R.length, name).toBe(E.length);
      for (const e of E){
        const hit = R.filter(r => r.key === e.unit && r.kind === e.kind).map(r => rectAabb(r));
        expect(hit.some(b => Math.abs(b[0] - e.box[0]) + Math.abs(b[1] - e.box[1]) + Math.abs(b[2] - e.box[4]) + Math.abs(b[3] - e.box[5]) < 1e-9), `${name} ${e.kind} ${e.unit}`).toBe(true);
      }
    }
    const high = obstaclesOf([{ key: 'chandelier', kind: 'hung', x: 0, z: 0, w: 6, d: 6, box: [-3, 3, FL + 14, FL + 20, -3, 3] }], null, FL);
    expect(high.length, 'a machine hung high above the floor is no obstacle').toBe(0);
  });
  it('two votives before every standing machine, turned or not (not the belt, not a loft\'s members)', () => {
    for (const [name, plan, anchors] of sets){
      const obs = obstaclesOf(anchors, plan, FL), V = votives(anchors, plan, obs);
      for (const p of plan.pads.filter(q => !q.fixed && q.kind !== 'belt' && !q.loft))
        expect(V.filter(v => v.key === p.key).length, `${name}: ${p.key}`).toBe(2);
    }
  });
  it('the yard keeps its density: a displaced tall grave moves to a reserve plot further out — none lost', () => {
    const home = graveSlots().home.length;
    for (const [name, plan, anchors] of sets){
      const G = placeGraves(anchors, plan, { floor: FL });
      expect(G.hidden, name).toBe(0);
      expect(G.tall.length, name).toBe(home);
    }
    // a machine set down on the back row inside the stage: its graves move further out, the yard as full
    const back = [...CROWD, st('crypt', 8, -30.5, 12, 3.2)], G = placeGraves(back, planFooting(back, { floor: FL, room: ROOMB }), { floor: FL });
    expect(G.moved).toBeGreaterThan(0); expect(G.hidden).toBe(0); expect(G.tall.length).toBe(home);
  });
  it('the stage keeps a churchyard outline: broken stubs and small crosses among the slabs', () => {
    const L = graveSlots().low, n = k => L.filter(g => g.kind === k).length;
    expect((n('stub') + n('tcross')) / L.length).toBeGreaterThan(.25);
    expect((n('stub') + n('tcross')) / L.length).toBeLessThan(.45);
    expect(n('ledger') + n('plot')).toBeGreaterThan(L.length / 2);
  });
  it('tall graves stand outside the stage room\'s walls (but for one back row); low ones are slabs, kerbed plots, stubs', () => {
    const inStage = g => Math.abs(g.x) - g.r < STAGE.HW && g.z + g.r > STAGE.BACK && g.z - g.r < STAGE.FRONT;
    for (const [name, plan, anchors] of sets){
      const G = placeGraves(anchors, plan, { floor: FL });
      for (const g of G.tall) if (inStage(g)) expect(Math.abs(g.z + 30.5), `${name}: a ${g.kind} at ${g.x.toFixed(1)},${g.z.toFixed(1)} inside the stage`).toBeLessThanOrEqual(.8);
      for (const g of G.tall) expect(['head', 'cross', 'obelisk']).toContain(g.kind);
      for (const g of G.low) expect(['ledger', 'plot', 'stub', 'tcross']).toContain(g.kind);
      for (const g of G.low) if (g.kind === 'stub' || g.kind === 'tcross') expect(g.s, 'a low stone stays under 1 u').toBeLessThanOrEqual(1.1);
      for (const g of G.tall) if (inStage(g)) expect(g.kind, 'no obelisk in the back row').not.toBe('obelisk');
    }
  });
  it('a pure function of the anchors and the plan: the same machines, the same yard', () => {
    const a = placeGraves(CROWD, PLAN, { floor: FL }), b = placeGraves(CROWD.slice(), planFooting(CROWD, { floor: FL, room: ROOMB }), { floor: FL });
    expect(b.tall).toEqual(a.tall); expect(b.low).toEqual(a.low);
    expect(votives(CROWD, PLAN, a.obs)).toEqual(votives(CROWD, PLAN, b.obs));
    expect(footLights(PLAN)).toEqual(footLights(planFooting(CROWD, { floor: FL, room: ROOMB })));
  });
  it('the lanterns hang where the footing draws them: inside the supports\' envelopes, each answering a machine of its own', () => {
    for (const [name, plan] of PLANS){
      const B = footingBoxes(plan).map(e => e.box), keys = new Set(plan.pads.map(p => p.key));
      const f = build(plan), edge = meshes(f).find(m => m.name === 'footing:edge').geometry.attributes.position.array;
      for (const l of footLights(plan)){
        expect(keys.has(l.key), `${name}: ${l.key}`).toBe(true);
        expect(B.some(b => l.x >= b[0] && l.x <= b[1] && l.y >= b[2] && l.y <= b[3] && l.z >= b[4] && l.z <= b[5]), `${name}: a lantern at ${l.x.toFixed(2)},${l.y.toFixed(2)},${l.z.toFixed(2)} outside every support`).toBe(true);
        let near = Infinity;
        for (let i = 0; i < edge.length; i += 3) near = Math.min(near, Math.hypot(edge[i] - l.x, edge[i + 1] - l.y, edge[i + 2] - l.z));
        expect(near, `${name}: the lantern's glass at ${l.x.toFixed(2)},${l.y.toFixed(2)},${l.z.toFixed(2)}`).toBeLessThan(.25);
      }
      f.dispose();
    }
  });
  it('a mausoleum\'s pointed door fits under its cornice at every mid height; its lanterns clear the corner piers', () => {
    for (let h = FOOT.BANDS.low + .05; h <= FOOT.BANDS.mid; h += .25){
      const p = planFooting([st('m', 0, 0, 10.9, 6.85, h)], { floor: FL, room: ROOMB }).pads[0];
      const d = doorOf(p, FL);
      expect(d, `h ${h.toFixed(2)}`).toBeTruthy();
      expect(FL + GY.PLINTH + doorApex(d), `h ${h.toFixed(2)}: the hood under the cornice`).toBeLessThan(p.top - GY.ROOF);
      for (const [u, , v] of doorLamps(p, FL)){
        const a = d.side[1] === 'u' ? v : u, half = (d.side[1] === 'u' ? p.hd : p.hw);
        expect(Math.abs(a) + .135, 'the lantern clears the corner pier').toBeLessThan(half - GY.PIER_IN);
        expect(Math.abs(a) - .135, 'the lantern clears the door surround').toBeGreaterThan(d.w / 2 + .3);
      }
    }
  });
  it('a bell tower: its bell hangs clear of its arcade\'s piers; its lantern in a front arch of the belfry, clear of the ladder', () => {
    for (const u of [10, 14, 20, 24]) for (const [w, d] of [[14, 6], [9, 5], [12, 4.4]]){
      const plan = planFooting([st('m', 0, 0, w, d, FOOT.PLINTH + u)], { floor: FL, room: ROOMB }), p = plan.pads[0], T = towerOf(p, FL);
      expect(p.band).toBe('high'); expect(T, `lift ${u}`).toBeTruthy();
      expect(T.side).toBe('+v');                                              // (yaw 0: +v faces the audience)
      expect(T.bell.r).toBeLessThanOrEqual(Math.min(p.hw, p.hd) - .475 - .63 - .2);
      expect(T.lamp, `lift ${u} ${w}×${d}`).toBeTruthy();
      const [lu, ly] = T.lamp;
      expect(ly, 'in the belfry').toBeGreaterThan(T.tierTop(T.nT - 2 < 0 ? 0 : T.nT - 2) - (T.nT > 1 ? 0 : 99));
      expect(ly + .34).toBeLessThan(T.yC - .45);
      if (p.access?.side === '+v'){ const c = (p.access.a0 + p.access.a1) / 2; expect(Math.abs(lu - c), `lift ${u}`).toBeGreaterThan(1); }
    }
  });
  it('the yard answers each machine in its own measure: weights over its loudest, light decaying within its own tempo', () => {
    const A = answerCue([{ t: 0, w: .3 }, { t: .25, w: .3 }, { t: .5, w: .6 }, { t: .75, w: .3 }, { t: .75, w: .2 }]);
    expect(A.max).toBe(.6); expect(A.gap).toBeCloseTo(.25, 6);
    expect(Math.max(...A.cue.map(c => c.w))).toBe(1); expect(A.cue[0].w).toBeCloseTo(Math.sqrt(.5), 6);
    expect(answerCue([]).cue).toEqual([]);
    for (const gap of [.08, .16, .25, .5, 1, 3]){
      const T = answerTiming(gap);
      for (const e of [T.flame, T.fog]){ expect(e.decay).toBeGreaterThan(0); expect(e.lead).toBeGreaterThan(0); }
      if (gap >= .25){ expect(T.fog.decay).toBeLessThanOrEqual(1.3 * gap + 1e-9); expect(T.flame.decay).toBeLessThanOrEqual(1.1 * gap + 1e-9); }
      // a strike's fog has faded to under half by the next one (it pulses, it doesn't hold)
      if (gap >= .2) expect(Math.exp(-gap / T.fog.decay)).toBeLessThan(.5);
    }
  });
  it('each machine gets its wisp: home off its front corner, drawn in to just off its edge (a hung one: under it)', () => {
    for (const [name, plan, anchors] of sets){
      const W = wispsFor(anchors, plan, FL), hung = anchors.filter(a => a.kind === 'hung');
      expect(W.map(w => w.key).sort(), name).toEqual([...plan.pads.map(p => p.key), ...hung.map(a => a.key)].sort());
      for (const w of W){
        const p = plan.pads.find(q => q.key === w.key);
        if (!p){ const a = hung.find(q => q.key === w.key); expect(w.to[1]).toBeLessThan(a.box[2] + 9); expect(w.to[1]).toBeGreaterThan(FL + 1); continue; }
        expect(rectDist(p, w.to[0], w.to[2]), `${name} ${w.key}`).toBeLessThan(1);
        expect(w.home[1]).toBeGreaterThan(FL + 2); expect(w.to[1]).toBeGreaterThan(FL + 1);
      }
    }
  });
});
