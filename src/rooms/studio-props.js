/* ============================================================
   MIDNIGHT STUDIO — where its props stand. PURE (no THREE, no DOM): a function of the anchors (what
   the machines are, where) and the footing plan (what they stand on), so a song's props are the same
   every load, and testable (test/room-studio.test.js).

   Every prop keeps PROP_CLEAR (1 u ≈ .68 m) from every OBSTACLE: each machine's solid box — the hung
   ones (organ loft, chandelier, court) too — and every support's envelope (rooms/footing.js
   footingBoxes: pads, lofts, stairs, ladders). The practicals stand in the aisles, where nothing else
   ever does (|x| > STAGE.HW + 4 · z < STAGE.BACK); the MIC STANDS come to the machines:

     micStands(anchors, plan, room) → [{ key, x, z, heading, box }]
       a boom stand per machine standing on the floor (a flush or low support — not the belt), on the
       side the house sees, its boom reaching toward the machine and its mic stopping PROP_CLEAR short
       of it; the corners first (a stand never parks in front of the middle of what it mics); none when
       nothing fits. heading: the boom's world direction (radians: (cos, sin) in (x, z)).
   ============================================================ */
import { footingBoxes, rectAabb, sideNormal } from './footing.js';

export const PROP_CLEAR = 1;
/* the boom stand (u): its tripod's reach, pole, boom (from the pole's top, rising), mic + counterweight */
export const MIC = { LEG: .62, POLE: 2.35, BOOM: 1.5, RISE: .45, CW: .55, R: .16, TOP: 2.8 };   // (TOP: the boom tip's height)
export const AUDIENCE = [0, 40];                         // (x, z) the house looks from (studio-footing.js too)

/** the gap between two AABBs [x0, x1, y0, y1, z0, z1] (0 when they touch or overlap) */
export function boxGap(a, b){
  const dx = Math.max(0, a[0] - b[1], b[0] - a[1]), dy = Math.max(0, a[2] - b[3], b[2] - a[3]), dz = Math.max(0, a[4] - b[5], b[4] - a[5]);
  return Math.hypot(dx, dy, dz);
}
/** does `box` keep `g` from every obstacle? */
export const clearOf = (box, obs, g = PROP_CLEAR) => obs.every(o => boxGap(box, o) >= g - 1e-9);

/** every obstacle a prop keeps clear of (world AABBs) */
export function obstacles(anchors = [], plan = null){
  const out = [], F = plan?.floor ?? -5.5;
  for (const a of anchors || []){
    if (!a) continue;
    if (Array.isArray(a.box) && a.box.length >= 6 && a.box.every(Number.isFinite)) out.push(a.box.slice(0, 6));
    else if (a.w > 0 && a.d > 0 && Number.isFinite(a.x) && Number.isFinite(a.z)){
      const [x0, x1, z0, z1] = rectAabb({ x: a.x, z: a.z, hw: a.w / 2, hd: a.d / 2, yaw: a.yaw || 0 });
      out.push([x0, x1, F, F + 40, z0, z1]);              // (no box: the whole column over its footprint)
    }
  }
  if (plan) for (const e of footingBoxes(plan)) out.push(e.box);
  return out;
}

/** a stand's world AABB: pole at (x, z), boom toward heading h */
export function micBox(x, z, h, F){
  const c = Math.cos(h), s = Math.sin(h), tx = x + c * MIC.BOOM, tz = z + s * MIC.BOOM, bx = x - c * MIC.CW, bz = z - s * MIC.CW;
  return [Math.min(x - MIC.LEG, tx - MIC.R, bx - MIC.R), Math.max(x + MIC.LEG, tx + MIC.R, bx + MIC.R), F,
          F + MIC.TOP + MIC.R, Math.min(z - MIC.LEG, tz - MIC.R, bz - MIC.R), Math.max(z + MIC.LEG, tz + MIC.R, bz + MIC.R)];
}

/** the boom stands: see the header. room: { x0, x1, z0, z1 } — the floor they may stand on */
export function micStands(anchors = [], plan = null, room = { x0: -49, x1: 49, z0: -33, z1: 64 }){
  if (!plan) return [];
  const F = plan.floor, obs = obstacles(anchors, plan), out = [], taken = [];
  for (const p of plan.pads){
    if (p.fixed || p.loft || p.open || !(p.band === 'flush' || p.band === 'low')) continue;
    // the side the house sees (its outward normal toward AUDIENCE)
    let side = '+v', best = -Infinity;
    const ax = AUDIENCE[0] - p.x, az = AUDIENCE[1] - p.z, an = Math.hypot(ax, az) || 1;
    for (const sd of ['+v', '+u', '-u', '-v']){ const [nx, nz] = sideNormal(p, sd), d = (nx * ax + nz * az) / an; if (d > best + 1e-9){ best = d; side = sd; } }
    const [nx, nz] = sideNormal(p, side), tu = [-nz, nx];  // outward normal · along the side
    const half = side[1] === 'v' ? p.hw : p.hd, edge = side[1] === 'v' ? p.hd : p.hw;
    let got = null;
    for (const t of [.95, -.95, 1.15, -1.15, .7, -.7]) {
      for (const o of [2.7, 3.3, 4]){
        // the pole: out from the side's edge by o, along it by t · half; the boom toward the pad's centre
        const x = p.x + nx * (edge + o) + tu[0] * t * half, z = p.z + nz * (edge + o) + tu[1] * t * half;
        const h = Math.atan2(p.z - z, p.x - x), box = micBox(x, z, h, F);
        if (box[0] < room.x0 || box[1] > room.x1 || box[4] < room.z0 || box[5] > room.z1) continue;
        if (!clearOf(box, obs) || !clearOf(box, taken)) continue;
        got = { key: p.key, x, z, heading: h, box };
        break;
      }
      if (got) break;
    }
    if (got){ out.push(got); taken.push(got.box); }
  }
  return out;
}
