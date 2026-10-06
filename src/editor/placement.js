/* ============================================================
   PLACEMENT — the human-curated stage (PLAN-staging "Placement":
   a per-instrument transform applied at RENDER TIME ONLY; the solve
   never knows). Pure: no THREE, no DOM.

   A layout is { <station key>: { x, z, yaw } } — x RELATIVE to the belt
   wall's centre (like a slot in stations.js), z world, yaw about +y. The
   drum machine's entry is its KIT slot ({ x, z }: it faces the audience).
   A placed station is PINNED in the room solve: it stays exactly where
   the user put it, and the auto-placed rest step around it.

   Persisted per song (localStorage) and carried in share links as
   song.stage = { key: [x, z, yaw] } (compact, sanitized on the way in —
   share links are untrusted input).
   ============================================================ */

export const SNAP = .5;                       // the floor grid (world units)
export const YAW_SNAP = Math.PI / 12;         // 15°
export const BOUND = 90;                      // |x|, |z| sanity bound (the largest room is far smaller)
const KEY_RE = /^[a-z][a-z0-9_-]{0,31}$/i;

export const snap = (v, s = SNAP) => Math.round(v / s) * s + 0;
/** wrap to (−π, π], then snap */
export function snapYaw(y, s = YAW_SNAP){
  const w = Math.atan2(Math.sin(y), Math.cos(y));
  const r = s ? Math.round(w / s) * s : w;
  return Math.abs(r + Math.PI) < 1e-9 ? Math.PI : r + 0;
}
const r3 = v => Math.round(v * 1000) / 1000;

/** untrusted → a clean layout (drops anything malformed; clamps to BOUND) */
export function sanitizeLayout(obj){
  const out = {};
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
  for (const [k, v] of Object.entries(obj)){
    if (!KEY_RE.test(k)) continue;
    const [x, z, yaw = 0] = Array.isArray(v) ? v : v && typeof v === 'object' ? [v.x, v.z, v.yaw] : [];
    if (![x, z, yaw].every(Number.isFinite)) continue;
    const c = a => Math.max(-BOUND, Math.min(BOUND, a));
    out[k] = { x: r3(c(x)), z: r3(c(z)), yaw: r3(Math.atan2(Math.sin(yaw), Math.cos(yaw))) };
  }
  return out;
}
/** layout → the compact share-link form { key: [x, z, yaw] } */
export const encodeLayout = layout => Object.fromEntries(Object.entries(sanitizeLayout(layout)).map(([k, p]) => [k, p.yaw ? [p.x, p.z, p.yaw] : [p.x, p.z]]));

/** a station's slot with the user's placement on top (pinned), or the base slot untouched */
export function placeSlot(base, placed){
  if (!placed) return base;
  return { ...base, x: placed.x, z: placed.z, yaw: Number.isFinite(placed.yaw) ? placed.yaw : base.yaw, pin: true };
}

/* ---- footprints: [x0, x1, z0, z1] world XZ boxes ---- */
/** do two footprints overlap by more than `tol` in BOTH axes (a shared edge is not an overlap) */
export const overlaps = (a, b, tol = .05) =>
  Math.min(a[1], b[1]) - Math.max(a[0], b[0]) > tol && Math.min(a[3], b[3]) - Math.max(a[2], b[2]) > tol;
export const moveBox = (rel, x, z) => [rel[0] + x, rel[1] + x, rel[2] + z, rel[3] + z];

/** What's wrong with putting `box` here: [{ key, kind: 'overlap' | 'belt' | 'room' }].
    others: [{ key, box }] (the other placed stations), wall: the belt's footprint (or null),
    room: { x0, x1, z0, z1 } (or null). Empty = a clean spot. */
export function conflicts(box, others, wall, room){
  const out = [];
  if (wall && overlaps(box, wall)) out.push({ key: 'belt', kind: 'belt' });
  for (const o of others) if (o.box && overlaps(box, o.box)) out.push({ key: o.key, kind: 'overlap' });
  if (room && (box[0] < room.x0 - .05 || box[1] > room.x1 + .05 || box[2] < room.z0 - .05 || box[3] > room.z1 + .05))
    out.push({ key: 'room', kind: 'room' });
  return out;
}
export function describeConflicts(cs, label = k => k){
  if (!cs.length) return '';
  return cs.map(c => c.kind === 'belt' ? 'overlaps the belt' : c.kind === 'room' ? 'outside the room' : `overlaps ${label(c.key)}`).join(' · ');
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
