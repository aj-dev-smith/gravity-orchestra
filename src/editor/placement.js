/* ============================================================
   PLACEMENT — the human-curated stage (PLAN-staging "Placement":
   a per-instrument transform applied at RENDER TIME ONLY; the solve
   never knows). Pure: no THREE, no DOM.

   A layout is { <station key>: { x, z, yaw, lift? } } — x RELATIVE to the
   belt wall's centre (like a slot in stations.js), z world, yaw about +y,
   lift = the user's HEIGHT (u above the machine's ground — rooms/footing.js;
   absent = the room solve's: on the floor, or up on the rear gallery; 0 = ON
   THE FLOOR, the user's word for it). The drum machine's entry is its KIT
   slot ({ x, z, lift? }: it faces the audience). A placed station is PINNED
   in the room solve: it stays exactly where the user put it, and the
   auto-placed rest step around it.

   THE BELT has an entry too once the user moves it: `belt: { x, z, yaw }` — its group's place in the ROOM
   (src/stagepose.js: the stage pose — no entry, as every layout before it had none, = where it always stood).
   The machines nobody pinned stand round the belt wherever it goes (the room solve runs in its frame); a
   pinned one stays exactly where the user put it, in the room.

   Persisted per song (localStorage) and carried in share links as
   song.stage = { key: [x, z, yaw?, lift?] } (compact, sanitized on the way
   in — share links are untrusted input; old 2- / 3-element entries read as
   before).
   ============================================================ */

import { clampLift } from '../rooms/footing.js';

export const SNAP = .5;                       // the floor grid (world units)
export const YAW_SNAP = Math.PI / 12;         // 15°
export const BOUND = 90;                      // |x|, |z| sanity bound (the largest room is far smaller)
const KEY_RE = /^[a-z][a-z0-9_-]{0,31}$/i;

export const BELT = 'belt';                   // the belt's layout key (its stage pose — src/stagepose.js)
export const snap = (v, s = SNAP) => Math.round(v / s) * s + 0;
/** wrap to (−π, π], then snap */
export function snapYaw(y, s = YAW_SNAP){
  const w = Math.atan2(Math.sin(y), Math.cos(y));
  const r = s ? Math.round(w / s) * s : w;
  return Math.abs(r + Math.PI) < 1e-9 ? Math.PI : r + 0;
}
const r3 = v => Math.round(v * 1000) / 1000;

/** untrusted → a clean layout (drops anything malformed; clamps to BOUND; a lift that is a finite
    number is kept, clamped to 0 … FOOT.LIFT_MAX — anything else leaves the height to the room solve) */
export function sanitizeLayout(obj){
  const out = {};
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
  for (const [k, v] of Object.entries(obj)){
    if (!KEY_RE.test(k)) continue;
    const [x, z, yaw0, lift] = Array.isArray(v) ? v : v && typeof v === 'object' ? [v.x, v.z, v.yaw, v.lift] : [];
    const yaw = yaw0 ?? 0;                               // (absent / null: unturned)
    if (![x, z, yaw].every(Number.isFinite)) continue;
    const c = a => Math.max(-BOUND, Math.min(BOUND, a));
    out[k] = { x: r3(c(x)), z: r3(c(z)), yaw: r3(Math.atan2(Math.sin(yaw), Math.cos(yaw))) };
    if (Number.isFinite(lift)) out[k].lift = r3(clampLift(lift));
  }
  return out;
}
/** layout → the compact share-link form { key: [x, z, yaw?, lift?] } — a lift is written whenever the
    user set one, 0 included (an explicit "on the floor" outranks the room solve's gallery raise) */
export const encodeLayout = layout => Object.fromEntries(Object.entries(sanitizeLayout(layout)).map(([k, p]) =>
  [k, p.lift !== undefined ? [p.x, p.z, p.yaw, p.lift] : p.yaw ? [p.x, p.z, p.yaw] : [p.x, p.z]]));

/** a station's slot with the user's placement on top (pinned), or the base slot untouched. A placement
    may carry a LIFT (u above the machine's ground — rooms/footing.js; main clamps it): kept only when
    it is a finite number ≥ 0 */
export function placeSlot(base, placed){
  if (!placed) return base;
  const lift = Number.isFinite(placed.lift) && placed.lift >= 0 ? { lift: placed.lift } : {};
  return { ...base, x: placed.x, z: placed.z, yaw: Number.isFinite(placed.yaw) ? placed.yaw : base.yaw, pin: true, ...lift };
}

/* ---- HUNG machines (stations.js `hang`: the organ loft, the ricochet chandelier, the volley court) ----
   With no layout entry a hung station hangs exactly where the stage hangs it (off the belt's top housing
   — an old layout / share link has no entry for it: it loads as it always did). With one, the user has
   taken it DOWN: it STANDS in the room like any floor machine — pinned at x/z/yaw, at its lift (u above
   its ground; the room builds its support by height band, rooms/footing.js). `unhung` tells main to build
   it as a standing machine (no columns / ceiling rods / floor marks: the room's footing holds it). */
export function standSlot(base, placed){
  if (!base?.hang || !placed) return placeSlot(base, placed);
  return { ...placeSlot(base, placed), hang: false, unhung: true };
}
/** the layout without `key`'s entry (a hung machine dropped back on the belt: it re-hangs as built). Pure */
export function dropEntry(L0, key){
  const L = { ...L0 }; delete L[key]; return L;
}
export const REHANG_R = 1;                    // a HANGING machine nudged less than this from where it hangs stays hung (a nudge, not a move)
/** Does a hung machine dropped with its footprint centred at `at` ({ x, z }) RE-HANG? — over the belt's top
    (`wall` [x0, x1, z0, z1], grown by `pad`), or — `home`, given only for one HANGING now — within REHANG_R
    of where it hangs (a nudge). The magnet; else it stands where it is dropped. A STANDING one is passed no
    home: it may stand anywhere off the belt's top, right where it used to hang included (the organ on a
    tower behind the belt, where its loft hung). */
export function rehangs(at, wall, home = null, { pad = .5, r = REHANG_R } = {}){
  if (!at) return false;
  // (wall: the belt's box [x0, x1, z0, z1] — or its TURNED footprint, 4 corners: a belt stage edit turned)
  if (wall && (Array.isArray(wall[0]) ? inRectPoly([at.x, at.z], wall, pad)
    : at.x >= wall[0] - pad && at.x <= wall[1] + pad && at.z >= wall[2] - pad && at.z <= wall[3] + pad)) return true;
  return !!home && Math.hypot(at.x - home.x, at.z - home.z) <= r;
}

/* ---- footprints ----
   A machine's footprint is its LOCAL box [x0, x1, z0, z1] (measured once, unrotated, about
   its pivot) turned by its yaw and moved to its pivot: an ORIENTED rectangle, given as its 4
   world XZ corners [[x, z] ×4]. The belt and the room are axis-aligned boxes. Overlap is a
   2-D separating-axis test, so a machine turned 45° is judged by what it occupies — not by
   the much larger axis-aligned box around it. */
/** do two axis-aligned footprints overlap by more than `tol` in BOTH axes (a shared edge is not an overlap) */
export const overlaps = (a, b, tol = .05) =>
  Math.min(a[1], b[1]) - Math.max(a[0], b[0]) > tol && Math.min(a[3], b[3]) - Math.max(a[2], b[2]) > tol;
export const moveBox = (rel, x, z) => [rel[0] + x, rel[1] + x, rel[2] + z, rel[3] + z];
/** an axis-aligned box → its 4 corners */
export const boxCorners = b => [[b[0], b[2]], [b[1], b[2]], [b[1], b[3]], [b[0], b[3]]];
/** a local box turned by yaw (about +y, three.js sense) and moved to (x, z) → 4 world corners */
export function footprint(rel, x, z, yaw = 0){
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return boxCorners(rel).map(([lx, lz]) => [x + lx * c + lz * s, z - lx * s + lz * c]);
}
/** the axis-aligned bounds of a corner list → [x0, x1, z0, z1] */
export function bounds(poly){
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of poly){ x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  return [x0, x1, z0, z1];
}
/** convex polygons (corner lists) overlap by more than `tol` along every separating axis */
export function polysOverlap(a, b, tol = .05){
  for (const poly of [a, b]) for (let i = 0; i < poly.length; i++){
    const [x0, z0] = poly[i], [x1, z1] = poly[(i + 1) % poly.length];
    let nx = z0 - z1, nz = x1 - x0;
    const L = Math.hypot(nx, nz); if (L < 1e-9) continue;
    nx /= L; nz /= L;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const [x, z] of a){ const d = x * nx + z * nz; a0 = Math.min(a0, d); a1 = Math.max(a1, d); }
    for (const [x, z] of b){ const d = x * nx + z * nz; b0 = Math.min(b0, d); b1 = Math.max(b1, d); }
    if (Math.min(a1, b1) - Math.max(a0, b0) <= tol) return false;
  }
  return true;
}
/** is the point inside a convex polygon (either winding) */
export function inPoly([px, pz], poly){
  let sign = 0;
  for (let i = 0; i < poly.length; i++){
    const [x0, z0] = poly[i], [x1, z1] = poly[(i + 1) % poly.length];
    const c = (x1 - x0) * (pz - z0) - (z1 - z0) * (px - x0);
    if (Math.abs(c) < 1e-12) continue;
    if (sign && Math.sign(c) !== sign) return false;
    sign = Math.sign(c);
  }
  return true;
}
/** is the point inside a footprint rectangle (4 corners, boxCorners / footprint order) grown by `pad` */
export function inRectPoly([px, pz], poly, pad = 0){
  const [a, b, , d] = poly, ux = b[0] - a[0], uz = b[1] - a[1], vx = d[0] - a[0], vz = d[1] - a[1];
  const lu = Math.hypot(ux, uz) || 1e-9, lv = Math.hypot(vx, vz) || 1e-9;
  const u = ((px - a[0]) * ux + (pz - a[1]) * uz) / lu, v = ((px - a[0]) * vx + (pz - a[1]) * vz) / lv;
  return u >= -pad && u <= lu + pad && v >= -pad && v <= lv + pad;
}
const asPoly = f => Array.isArray(f?.[0]) ? f : boxCorners(f);

/** What's wrong with putting footprint `fp` here: [{ key, kind: 'overlap' | 'belt' | 'room' }].
    fp / others[].box: an oriented footprint (4 corners) or an axis-aligned box [x0, x1, z0, z1];
    wall: the belt's box (or null); room: { x0, x1, z0, z1 } (or null). Empty = a clean spot. */
export function conflicts(fp, others, wall, room){
  const out = [], P = asPoly(fp);
  if (wall && polysOverlap(P, asPoly(wall))) out.push({ key: 'belt', kind: 'belt' });
  for (const o of others) if (o.box && polysOverlap(P, asPoly(o.box))) out.push({ key: o.key, kind: 'overlap' });
  const b = bounds(P);
  if (room && (b[0] < room.x0 - .05 || b[1] > room.x1 + .05 || b[2] < room.z0 - .05 || b[3] > room.z1 + .05))
    out.push({ key: 'room', kind: 'room' });
  return out;
}
export function describeConflicts(cs, label = k => k){
  if (!cs.length) return '';
  return cs.map(c => c.kind === 'belt' ? 'overlaps the belt' : c.kind === 'room' ? 'outside the room' : `overlaps ${label(c.key)}`).join(' · ');
}

/** The layout after the machine `key` is placed at `entry` (an edit's machine — a move, a turn, a height):
    · the FIRST edit pins every machine as it stands (all: [{ key, x (world), z, yaw }]; layout x is
      relative to the belt's centre cx) — what you see is what stays;
    · every machine keeps the HEIGHT the user gave it (liftOf(key): its live one, else its stored one); one
      the room solve raised (the gallery) has none to keep — the solve decides again where it lands;
    · entry.lift: a number = the user's height for `key` (0 = ON THE FLOOR, an explicit word: it outranks
      the gallery raise) · null = forgotten (AUTO: the layout decides) · absent = as it was.
    Pure: L0 is not touched. */
export function placeEntry(L0, key, entry, all = [], { cx = 0, liftOf = () => undefined } = {}){
  const L = { ...L0 };
  const held = (k, e) => { const u = liftOf(k) ?? L[k]?.lift; return Number.isFinite(u) ? { ...e, lift: u } : e; };
  // (moving the BELT pins nobody: the band re-seats round it where it now stands — a belt has no height)
  if (key === BELT){ const { x, z, yaw = 0 } = entry; L[key] = { x, z, yaw }; return L; }
  // (the FIRST edit — of a machine: a belt entry alone pinned nobody, so the stage still stands as the room
  //  solve seated it round the belt; a reload re-solves anything unpinned, so pin it all now, as it stands)
  if (!Object.keys(L).some(k => k !== BELT))
    for (const p of all) L[p.key] = held(p.key, { x: p.x - cx, z: p.z, yaw: p.yaw });
  let e;
  if (!('lift' in entry)) e = held(key, entry);
  else { e = { ...entry }; if (!Number.isFinite(entry.lift)) delete e.lift; }
  L[key] = e;
  return L;
}

/** THE WHOLE STAGE moves (stage edit: the belt dragged with Alt / BAND COMES): every PINNED machine rides the
    belt's rigid move T0 → T1 (stage poses, src/stagepose.js) — its place relative to the belt is kept, as the
    unpinned ones keep theirs through the room solve. Entries are the layout's (x relative to cx, z, yaw world);
    the kit's yaw stays out (it faces the stage's audience: it turns with the stage anyway); heights are kept.
    The belt's own entry is not touched (placeEntry writes it). Pure: L0 is not touched. */
export function carryEntries(L0, T0, T1, { cx = 0 } = {}){
  const L = { ...L0 };
  const c0 = Math.cos(T0.yaw || 0), s0 = Math.sin(T0.yaw || 0), c1 = Math.cos(T1.yaw || 0), s1 = Math.sin(T1.yaw || 0);
  for (const k of Object.keys(L)){
    if (k === BELT) continue;
    const e = L[k], dx = e.x + cx - (T0.x || 0), dz = e.z - (T0.z || 0);
    const lx = dx * c0 - dz * s0, lz = dx * s0 + dz * c0;                    // (into the old stage frame…)
    const n = { ...e, x: (T1.x || 0) + lx * c1 + lz * s1 - cx, z: (T1.z || 0) - lx * s1 + lz * c1 };   // (…and out of the new)
    if (k !== 'drums' && Number.isFinite(e.yaw)) n.yaw = Math.atan2(Math.sin(e.yaw + (T1.yaw || 0) - (T0.yaw || 0)), Math.cos(e.yaw + (T1.yaw || 0) - (T0.yaw || 0)));
    L[k] = n;
  }
  return L;
}

/** An undo that changes only HEIGHTS (prev → cur: the layout it restores → the layout now) → the lifts to
    set live, [{ key, lift }] (lift undefined = AUTO: the layout decides) — or null when anything else
    differs (a move, a turn, a machine pinned or unpinned): the stage must be rebuilt. prev = {} (the
    solved stage, before the first edit pinned it as it stood): `base` says where that solved stage stands
    (same frame as a layout: { key: { x, z, yaw } }) — every machine still there goes back to AUTO; one
    moved or turned since (the first edit was a MOVE), or no base to compare with → null (only a rebuild
    puts it back — a live undo would leave it where it was dragged, and the next edit would pin it there).
    Pure. */
export function liftOnlyUndo(prev, cur, eps = 2e-3, base = null){
  const P = Object.keys(prev || {}), C = Object.keys(cur || {});
  if (P.length && (P.length !== C.length || P.some(k => !cur[k]))) return null;
  const ref = P.length ? prev : base;
  if (!P.length && C.length && (!ref || C.some(k => !ref[k]))) return null;
  const turn = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  const out = [];
  for (const k of C){
    const a = ref[k], b = cur[k];
    if (Math.abs(a.x - b.x) > eps || Math.abs(a.z - b.z) > eps || turn(a.yaw ?? 0, b.yaw ?? 0) > eps) return null;
    const la = P.length && Number.isFinite(a.lift) ? a.lift : undefined, lb = Number.isFinite(b.lift) ? b.lift : undefined;
    if (la !== lb) out.push({ key: k, lift: la });
  }
  return out;
}

/* ---- undo / redo: small stacks of layout snapshots (per song id) ---- */
export function makeHistory(limit = 40){
  let id = null, stack = [], fwd = [];
  const own = songId => { if (songId !== id){ id = songId; stack = []; fwd = []; } };
  const add = (arr, layout) => { arr.push(sanitizeLayout(layout)); if (arr.length > limit) arr.shift(); };
  return {
    /** remember `layout` (the state BEFORE an edit) for song `songId` — a NEW edit: what was undone can't be redone */
    push(songId, layout){ own(songId); add(stack, layout); fwd = []; },
    /** the last remembered layout for `songId`, or null */
    pop(songId){ return songId === id && stack.length ? stack.pop() : null; },
    size(songId){ return songId === id ? stack.length : 0; },
    /** an UNDO remembers the layout it left (for redo) */
    stash(songId, layout){ own(songId); add(fwd, layout); },
    /** a REDO: the last layout undone, or null — and keep(…) remembers the one it leaves, for undo (the redo
        branch stays) */
    unstash(songId){ return songId === id && fwd.length ? fwd.pop() : null; },
    keep(songId, layout){ own(songId); add(stack, layout); },
    redoSize(songId){ return songId === id ? fwd.length : 0; },
  };
}

/* ---- persistence (storage injected: localStorage in the browser; any {getItem,setItem,removeItem}) ---- */
export const layoutKey = songId => `cascade:stage:${songId}`;
export function loadLayout(storage, songId){
  try { return sanitizeLayout(JSON.parse(storage?.getItem(layoutKey(songId)) || 'null')); }
  catch (e){ return {}; }
}
export function saveLayout(storage, songId, layout){
  try {
    const clean = sanitizeLayout(layout);
    if (Object.keys(clean).length) storage?.setItem(layoutKey(songId), JSON.stringify(encodeLayout(clean)));
    else storage?.removeItem(layoutKey(songId));
    return true;
  } catch (e){ return false; }
}
