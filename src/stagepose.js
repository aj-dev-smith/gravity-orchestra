/* ============================================================
   THE STAGE POSE — where the belt stands in the room (stage edit: the belt
   moves like any machine). Pure: no THREE, no DOM.

   T = { x, z, yaw }: the belt's rigid render-time transform (its group's
   position + turn about +y, three.js sense). The STAGE FRAME is the belt's
   own: the frame every staging rule was written in (stations.js — the
   wings ride out with the belt's edges, the audience stands at +z, the star
   front and centre). The room solve, the hung stations, the kit slot, the
   director's wide and the follow / ride cams all run in the stage frame, as
   they always did; their outputs are mapped into the room by T. Nothing is
   ever re-solved for a move: the plans live in the belt's own frame.

   IDENTITY (no layout entry for the belt — every old layout and share link)
   = today's stage exactly: every helper returns its input untouched then, so
   the default build is bit-for-bit what it was.
   ============================================================ */

export const IDENTITY = Object.freeze({ x: 0, z: 0, yaw: 0 });
export const isIdentity = T => !T || (!T.x && !T.z && !T.yaw);

/** a stage-frame point (x, z) → the room (world) */
export function toWorld(T, x, z){
  if (isIdentity(T)) return { x, z };
  const c = Math.cos(T.yaw), s = Math.sin(T.yaw);
  return { x: T.x + x * c + z * s, z: T.z - x * s + z * c };
}
/** a room (world) point → the stage frame */
export function toStage(T, x, z){
  if (isIdentity(T)) return { x, z };
  const c = Math.cos(T.yaw), s = Math.sin(T.yaw), dx = x - T.x, dz = z - T.z;
  return { x: dx * c - dz * s, z: dx * s + dz * c };
}
/** a stage-frame DIRECTION → the room (a turn only) */
export function dirToWorld(T, x, z){
  if (isIdentity(T) || !T.yaw) return { x, z };
  const c = Math.cos(T.yaw), s = Math.sin(T.yaw);
  return { x: x * c + z * s, z: -x * s + z * c };
}
/** a rigid pose { x, z, yaw } in the stage frame → the room, and back */
export const poseToWorld = (T, p) => isIdentity(T) ? { ...p } : { ...p, ...toWorld(T, p.x, p.z), yaw: (p.yaw || 0) + T.yaw };
export const poseToStage = (T, p) => isIdentity(T) ? { ...p } : { ...p, ...toStage(T, p.x, p.z), yaw: (p.yaw || 0) - T.yaw };

/** a stage-frame box [x0, x1, z0, z1] → its 4 room corners (boxCorners order) */
export function boxToWorld(T, b){
  return [[b[0], b[2]], [b[1], b[2]], [b[1], b[3]], [b[0], b[3]]].map(([x, z]) => { const p = toWorld(T, x, z); return [p.x, p.z]; });
}
/** a stage-frame 3-D box [x0, x1, y0, y1, z0, z1] → the room's axis-aligned box around it */
export function box6ToWorld(T, b){
  if (isIdentity(T)) return b.slice();
  const c = boxToWorld(T, [b[0], b[1], b[4], b[5]]);
  const xs = c.map(q => q[0]), zs = c.map(q => q[1]);
  return [Math.min(...xs), Math.max(...xs), b[2], b[3], Math.min(...zs), Math.max(...zs)];
}

/** is a point inside the axis-aligned room rect { x0, x1, z0, z1 } */
const inRect = (r, x, z, e = 1e-9) => x >= r.x0 - e && x <= r.x1 + e && z >= r.z0 - e && z <= r.z1 + e;

/** THE ROOM IN THE STAGE FRAME: the largest-ish axis-aligned rect (in the stage frame) whose image in the
    room lies inside `room` ({ x0, x1, z0, z1 }, world) — the room solve (stations.js) tests footprints
    against an axis-aligned room. Exact for a move with no turn (and a quarter-turn); between, conservative
    (the inscribed rect grown from `seed` — the belt's own box — side by side). Identity → room untouched. */
export function stageRoom(room, T, seed = [-1, 1, -1, 1]){
  if (isIdentity(T)) return { ...room };
  const q = ((T.yaw % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
  if (Math.min(q, Math.PI / 2 - q) < 1e-9){                  // a move, or a quarter-turn: the room maps exactly
    const c = [[room.x0, room.z0], [room.x1, room.z0], [room.x1, room.z1], [room.x0, room.z1]].map(([x, z]) => toStage(T, x, z));
    const xs = c.map(p => p.x), zs = c.map(p => p.z);
    return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
  }
  const fits = r => [[r.x0, r.z0], [r.x1, r.z0], [r.x1, r.z1], [r.x0, r.z1]].every(([x, z]) => { const p = toWorld(T, x, z); return inRect(room, p.x, p.z, 1e-6); });
  // (the seed shrinks toward its centre until it fits — a belt hard against a wall still gets a room)
  let r = { x0: seed[0], x1: seed[1], z0: seed[2], z1: seed[3] };
  for (let k = 0; k < 40 && !fits(r); k++){
    const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
    r = { x0: cx + (r.x0 - cx) * .85, x1: cx + (r.x1 - cx) * .85, z0: cz + (r.z0 - cz) * .85, z1: cz + (r.z1 - cz) * .85 };
  }
  if (!fits(r)) return r;
  // grow every side in turn by halving steps (a side stops when it would leave the room)
  const sides = ['x0', 'x1', 'z0', 'z1'], sign = { x0: -1, x1: 1, z0: -1, z1: 1 };
  for (let step = 8; step > .05; step /= 2){
    let grew = true;
    while (grew){
      grew = false;
      for (const s of sides){
        const t = { ...r, [s]: r[s] + sign[s] * step };
        if (fits(t)){ r = t; grew = true; }
      }
    }
  }
  return r;
}

/** the pose shifted (never turned) so the belt's stage-frame box `local` [x0, x1, z0, z1] stands inside
    `room` (world): an untrusted layout (a share link) can't put the belt through a wall. Identity stays. */
export function clampPose(T, local, room){
  if (isIdentity(T)) return IDENTITY;
  const c = boxToWorld(T, local), xs = c.map(q => q[0]), zs = c.map(q => q[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
  const shift = (lo, hi, a, b) => hi - lo > b - a ? (a + b) / 2 - (lo + hi) / 2 : lo < a ? a - lo : hi > b ? b - hi : 0;
  return { x: T.x + shift(x0, x1, room.x0, room.x1), z: T.z + shift(z0, z1, room.z0, room.z1), yaw: T.yaw };
}

/** a layout's belt entry ({ x, z, yaw } — editor/placement.js) → the stage pose (absent: identity) */
export function poseOf(entry){
  if (!entry || ![entry.x, entry.z].every(Number.isFinite)) return IDENTITY;
  const yaw = Number.isFinite(entry.yaw) ? Math.atan2(Math.sin(entry.yaw), Math.cos(entry.yaw)) : 0;
  return isIdentity({ x: entry.x, z: entry.z, yaw }) ? IDENTITY : { x: entry.x, z: entry.z, yaw };
}
