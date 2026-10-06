/* ============================================================
   SHOT SOLVE — where the director's camera stands for each station.
   Like everything else in the room, a shot eye is SOLVED, not hand-
   placed: each station's hand-tuned framing (its plugin's `camera`
   {dist, up, x} — the angle its designer wanted) is only the PREFERRED
   candidate. At build, candidate eyes are sampled on rings around the
   aim (swung ±15…±80° about it, lifted, pulled in / pushed back), in
   order of how far they stray from that preference, and the first that
     (a) stays inside the room (with room for the held shot's slow sway),
     (b) stands in clear air (not inside / grazing another machine — a
         near-plane blob of black housing is the worst frame there is),
     (c) SEES its station: ≤ 1 of the 15 probe rays (a 5×3 grid through
         the frame's middle, the same grid __dev.occlusion casts) hits
         another machine first, and
     (d) still frames the station about as well as the preference does, and
     (e) keeps the frame's EDGES free of foreground clutter (≤ FG_MAX of the 27 border rays meet
         another machine — or the room — nearer than .6 × the aim's depth)
   wins; if none is perfect, the least-bad one (blocked rays dominate).
   Pure: the world is reached only through `blocked(eye, dir, far)` — main
   raycasts the real meshes, the unit test ray-boxes a measured table —
   so one layout → one set of eyes, every time. Render-time only.
   ============================================================ */

export const SWAY = .13;                    // camera.js sways a held station shot ±.12 rad about its aim
export const RAYS = (() => { const r = []; for (const sx of [-.3, -.15, 0, .15, .3]) for (const sy of [-.15, 0, .15]) r.push([sx, sy]); return r; })();
export const CLEAR_RAYS = 1;                // ≤ this many of the 15 probe rays may be blocked (≈ 7 %)
const AZ = [0, 15, -15, 30, -30, 45, -45, 60, -60, 80, -80];
const LIFT = [0, 3, 6, -2, 10];
const DIST = [1, 1.15, .88, 1.32];

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = a => Math.hypot(a[0], a[1], a[2]);
const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const rotY = (v, a) => { const c = Math.cos(a), s = Math.sin(a); return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c]; };

/** the probe rays of a shot: unit directions through the frame's middle + the reach (.9 × eye→aim) */
export function probeRays(eye, aim){
  const f = norm(sub(aim, eye)), R = norm(cross(f, [0, 1, 0])), U = cross(R, f), far = len(sub(aim, eye)) * .9;
  return RAYS.map(([sx, sy]) => ({ dir: norm([f[0] + R[0] * sx + U[0] * sy, f[1] + R[1] * sx + U[1] * sy, f[2] + R[2] * sx + U[2] * sy]), far }));
}
/** how many probe rays of eye → aim are blocked (blocked(eye, dir, far) → bool) */
export function blockedRays(eye, aim, blocked, scale = 1){
  let n = 0; for (const r of probeRays(eye, aim)) if (blocked(eye, r.dir, r.far)) n += scale;
  return n;
}
/* FOREGROUND CLUTTER at the frame's EDGES. The 15 probe rays only watch the frame's middle; a
   portrait pull-back (or a low corner) can still bring a neighbour's dark housing into the lower
   third. EDGE: rays round the frame's border (±.85 of the half-frame), aspect-aware — a phone's
   tall frame reaches further up and down.
   A hit counts only when it is FOREGROUND: nearer than `near` × the aim's depth. 27 rays: the
   top / bottom edges, the sides, and the lower third (where a pulled-back eye's neighbours rise). */
export const EDGE = (() => { const r = [];
  for (const sx of [-.85, -.57, -.28, 0, .28, .57, .85]){ r.push([sx, -.85]); r.push([sx, .85]); }   // top + bottom edges
  for (const sy of [-.6, -.3, 0, .3, .6]){ r.push([-.85, sy]); r.push([.85, sy]); }                  // the sides
  for (const sx of [-.5, 0, .5]) r.push([sx, -.6]);                                                 // + the lower third
  return r; })();
export const FG_MAX = .12;                  // ≤ 3 of the 27 edge rays may meet foreground clutter
/* a phone's TALL frame shows a lot more floor and sky: clutter there is judged over the whole frame,
   a 5 × 9 grid (±.85 / ±.88 of the half-frame), nearer than .8 × the aim's depth */
export const GRID_TALL = (() => { const r = []; for (const sx of [-.85, -.42, 0, .42, .85]) for (let j = 0; j < 9; j++) r.push([sx, -.88 + 1.76 * j / 8]); return r; })();
export const FG_TALL = { aspect: .46, near: .8, pts: GRID_TALL, max: 2 / 45 };
/** share (0..1) of the edge rays of eye → aim whose first hit is foreground clutter */
export function foreground(eye, aim, blocked, { aspect = 1.5, fov = 55, near = .6, pts = EDGE, stop = Infinity } = {}){
  const v = sub(aim, eye), D = len(v), f = norm(v), R = norm(cross(f, [0, 1, 0])), U = cross(R, f);
  const tv = Math.tan(fov * Math.PI / 360), th = tv * aspect;
  let n = 0;
  for (const [sx, sy] of pts){
    const d = norm([f[0] + R[0] * sx * th + U[0] * sy * tv, f[1] + R[1] * sx * th + U[1] * sy * tv, f[2] + R[2] * sx * th + U[2] * sy * tv]);
    if (blocked(eye, d, near * D / Math.max(.2, dot(d, f))) && ++n > stop) break;   // (depth-based reach: near × the aim's depth; stop: enough to fail)
  }
  return n / pts.length;
}
/** ray (o, unit d) vs box [x0,x1,y0,y1,z0,z1]: entry distance, or Infinity */
export function rayBox(o, d, b){
  let t0 = 0, t1 = Infinity;
  for (let i = 0; i < 3; i++){
    const lo = b[2 * i], hi = b[2 * i + 1];
    if (Math.abs(d[i]) < 1e-12){ if (o[i] < lo || o[i] > hi) return Infinity; continue; }
    let a = (lo - o[i]) / d[i], c = (hi - o[i]) / d[i];
    if (a > c){ const t = a; a = c; c = t; }
    t0 = Math.max(t0, a); t1 = Math.min(t1, c);
    if (t0 > t1) return Infinity;
  }
  return t0;
}
/** distance from point p to box b (0 inside) */
export function boxDist(p, b){
  const dx = Math.max(b[0] - p[0], 0, p[0] - b[1]), dy = Math.max(b[2] - p[1], 0, p[1] - b[3]), dz = Math.max(b[4] - p[2], 0, p[2] - b[5]);
  return Math.hypot(dx, dy, dz);
}
/** fraction of the subject's points inside a fov/aspect frame from eye → aim */
export function framed(eye, aim, pts, fov = 55, aspect = 1.5){
  if (!pts?.length) return 1;
  const f = norm(sub(aim, eye)), R = norm(cross(f, [0, 1, 0])), U = cross(R, f);
  const tv = Math.tan(fov * Math.PI / 360), th = tv * aspect;
  let n = 0;
  for (const p of pts){ const v = sub(p, eye), z = dot(v, f);
    if (z > .1 && Math.abs(dot(v, R) / (z * th)) <= 1 && Math.abs(dot(v, U) / (z * tv)) <= 1) n++; }
  return n / pts.length;
}
/** the 8 corners of a box (from yMin up — a station's legs to the floor may crop) */
export function boxPts(b, yMin = -Infinity){
  const out = [];
  for (const x of [b[0], b[1]]) for (const y of [Math.max(b[2], Math.min(yMin, b[3])), b[3]]) for (const z of [b[4], b[5]]) out.push([x, y, z]);
  return out;
}

/** SOLVE one station's eye.
    aim, pref: [x,y,z] — the aim and the preferred (hand-tuned) eye
    room: { x0, x1, y0, y1, z0, z1 } — where an eye may stand (already inset by a pad)
    blocked(eye, dir, far) → bool — does this probe ray hit ANOTHER machine first
    others: [box] — every other machine's 3D box (clear air: an eye stays ≥ `air` from each)
    subject: [x,y,z][] — the points that should be in frame (framing is kept ≥ the pref's − .15)
    Returns { eye, rays, az, lift, k, cost } — rays = blocked probe rays of the winner. */
export function solveShotEye({ aim, pref, room, blocked, others = [], subject = null, air = 1.2, fov = 55, aspect = 1.5, fgMax = FG_MAX, fgNear = .6, fgPts = EDGE, fgBudget = 40, maxCands = Infinity }){
  const off0 = sub(pref, aim);
  const inRoom = e => e[0] >= room.x0 && e[0] <= room.x1 && e[1] >= room.y0 && e[1] <= room.y1 && e[2] >= room.z0 && e[2] <= room.z1;
  const swayIn = e => { const o = sub(e, aim); return [-SWAY, 0, SWAY].every(a => { const r = rotY(o, a); return inRoom([aim[0] + r[0], aim[1] + r[1], aim[2] + r[2]]); }); };
  const fr0 = subject ? framed(pref, aim, subject, fov, aspect) : 1;
  // candidates in order of how far they stray from the preference (the designer's angle first)
  const cands = [];
  for (const az of AZ) for (const lift of LIFT) for (const k of DIST){
    const dev = Math.abs(az) / 90 + Math.abs(lift) / 12 + Math.abs(k - 1) * 1.2;
    cands.push({ az, lift, k, dev });
  }
  cands.sort((a, b) => a.dev - b.dev);
  let best = null;
  for (const c of cands){
    if (maxCands-- <= 0) break;                                       // (a bounded search: the best so far wins)
    const r = rotY(off0, c.az * Math.PI / 180);
    const eye = [aim[0] + r[0] * c.k, aim[1] + r[1] * c.k + c.lift, aim[2] + r[2] * c.k];
    if (!swayIn(eye)) continue;
    if (others.some(b => boxDist(eye, b) < air)) continue;
    const rays = blockedRays(eye, aim, blocked);
    const fr = subject ? framed(eye, aim, subject, fov, aspect) : 1;
    // (cast only for an eye that already sees its station; it stops counting once it has failed)
    if (rays <= CLEAR_RAYS && fgBudget-- <= 0) break;               // (a bounded search: the best so far wins)
    const fg = rays <= CLEAR_RAYS ? foreground(eye, aim, blocked, { aspect, fov, near: fgNear, pts: fgPts, stop: Math.floor(fgMax * fgPts.length) + 2 }) : 1;
    const cost = rays * 10 + c.dev + Math.max(0, fr0 - .15 - fr) * 8 + Math.max(0, fg - fgMax) * 12;
    if (!best || cost < best.cost) best = { eye, rays, fg, az: c.az, lift: c.lift, k: c.k, cost, framed: fr };
    if (rays <= CLEAR_RAYS && fr >= fr0 - .15 && fg <= fgMax) break;   // the first clean one in preference order wins
  }
  return best || { eye: pref, rays: blockedRays(pref, aim, blocked), fg: 0, az: 0, lift: 0, k: 1, cost: Infinity, framed: fr0, none: true };   // (none: no candidate stood in the room)
}

/* ---- the BELT's follow shot (camera.js 'all' / 'lead' / 'alto' / 'bass' in a full room) ----
   The follow cam rides the marble: eye = focus + (ox, ·, oz)·back, at height stageY + oy, aiming
   at the band. Its offset used to be fixed (4.5, 3.4, 13) — on a phone (back ≈ 2.8) that parks
   the eye behind the front row, looking at the belt THROUGH the drums' bandshell. So the offset
   is SOLVED per room, once per aspect class: swung about the vertical and lifted, the first
   (in order of how far it strays from the classic offset) whose probe rays clear every other
   machine's box for marbles anywhere along the wall, at every pull-back the class uses. */
export const FOLLOW_BASE = [4.5, 3.4, 13];
const F_AZ = [0, -10, 10, -20, 20, -30, 30, -40, 40];
const F_Y = [3.4, 6, 9, 12, 15, 18];
/** wall: [x0,x1,y0,y1,z0,z1] (the belt bays); boxes: every OTHER machine's 3D box;
    backs: the pull-back factors this aspect class uses (portrait: a phone's tall frame);
    room: eye bounds; blocked(eye, dir, far): does a ray hit another machine first (default: the
    boxes — conservative; main raycasts the real meshes).
    What must stay SEEN is the belt's strike BAND: targets across the bays' front at the band's
    heights; every one inside the frame (fov 55°, the class's aspect) is cast to from the eye.
    Returns { off: [ox, oy, oz], rays } — rays = the worst blocked share over the samples, ×15. */
function followKit({ wall, boxes, stageY, backs = [1, 1.6], room, blocked = null, portrait = false }){
  const zc = (wall[4] + wall[5]) / 2, foci = [], band = [];
  for (let i = 0; i < 3; i++) foci.push([wall[0] + 2 + (wall[1] - wall[0] - 4) * i / 2, stageY + .6, zc]);
  for (let i = 0; i < 7; i++) for (const dy of [-2, 1, 4]) band.push([wall[0] + 1 + (wall[1] - wall[0] - 2) * i / 6, stageY + dy, zc]);
  blocked ??= (e, d, far) => boxes.some(b => rayBox(e, d, b) < far);
  const inRoom = e => !room || (e[0] >= room.x0 && e[0] <= room.x1 && e[1] >= room.y0 && e[1] <= room.y1 && e[2] >= room.z0 && e[2] <= room.z1);
  const aspect = portrait ? .46 : 1.5, tv = Math.tan(55 * Math.PI / 360), th = tv * aspect;
  const seenBand = (eye, aim, quick) => {                     // blocked share (×15) of the band targets in frame (quick: any → 15)
    const f = norm(sub(aim, eye)), R = norm(cross(f, [0, 1, 0])), U = cross(R, f);
    let n = 0, b = 0;
    for (const p of band){
      const v = sub(p, eye), z = dot(v, f);
      if (z < .1 || Math.abs(dot(v, R) / (z * th)) > 1 || Math.abs(dot(v, U) / (z * tv)) > 1) continue;
      n++; const L = len(v); if (blocked(eye, [v[0] / L, v[1] / L, v[2] / L], L - .3)){ if (quick) return 15; b++; }
    }
    return n ? Math.round(b / n * 15) : 15;
  };
  const eyes = (ox, oy, oz) => { const out = []; for (const f of foci) for (const k of backs) out.push([[f[0] + ox * k, stageY + oy, f[2] + oz * k], f]); return out; };
  return { seenBand, eyes, inRoom };
}
/** a follow offset's score under these opts: { rays: worst blocked band share ×15, out: eyes outside the room, graze: eyes within `air` of a machine } */
export function followScore(opts, off){
  const K = followKit(opts), air = opts.air ?? .8;
  let rays = 0, out = 0, graze = 0;
  for (const [e, f] of K.eyes(...off)){
    if (!K.inRoom(e)) out++;
    if (opts.boxes.some(b => boxDist(e, b) < air)) graze++;
    rays = Math.max(rays, K.seenBand(e, f));
  }
  return { rays, out, graze };
}
export function solveFollow({ wall, boxes, stageY, backs = [1, 1.6], room, base = FOLLOW_BASE, blocked = null, air = .8, portrait = false, prefer = null }){
  const { seenBand, eyes, inRoom } = followKit({ wall, boxes, stageY, backs, room, blocked, portrait });
  const cands = [];
  for (const a of F_AZ) for (const oy of F_Y) cands.push({ a, oy, dev: Math.abs(a) / 60 + (oy - base[1]) / 10 });
  cands.sort((p, q) => p.dev - q.dev);                       // the classic offset first, then the nearest
  const offOf = a => { const c = Math.cos(a * Math.PI / 180), s = Math.sin(a * Math.PI / 180); return [base[0] * c + base[2] * s, base[0] * -s + base[2] * c]; };
  const clean = (ox, oy, oz) => { const E = eyes(ox, oy, oz);
    return !E.some(([e]) => !inRoom(e) || boxes.some(b => boxDist(e, b) < air)) && E.every(([e, f]) => seenBand(e, f, true) === 0); };
  // pass 0 — a previous solve (the room changed under the song): kept when it is still clean
  if (prefer && clean(...prefer)) return { off: prefer.slice(), rays: 0 };
  // pass 1 — the first candidate (in preference order) that is CLEAN: in room, in clear air, every
  // in-frame band target seen. A candidate drops out at its first blocked ray, so it is cheap.
  for (const { a, oy } of cands){
    const [ox, oz] = offOf(a);
    if (clean(ox, oy, oz)) return { off: [ox, oy, oz], rays: 0 };
  }
  // pass 2 (a floor with no clean follow): the least blocked, then the least strayed
  let best = null;
  for (const { a, oy, dev } of cands){
    const [ox, oz] = offOf(a);
    let worst = 0, sum = 0, out = 0;
    for (const [eye, f] of eyes(ox, oy, oz)){
      if (!inRoom(eye)) out++;
      if (boxes.some(b => boxDist(eye, b) < air)){ worst = 15; sum += 15; break; }
      const n = seenBand(eye, f); worst = Math.max(worst, n); sum += n;
      if (best && worst * 10 >= best.cost) break;           // (can't win any more)
    }
    const cost = worst * 10 + sum * .5 + out * 40 + dev;          // (an eye out through the wall sees the wall: worse than a blocked ray)
    if (!best || cost < best.cost) best = { off: [ox, oy, oz], rays: worst, cost };
  }
  return best;
}
