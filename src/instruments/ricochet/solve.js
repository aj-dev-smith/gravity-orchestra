/* ============================================================
   RICOCHET SCULPTURE — the pure math (no scene, no DOM, no audio).

   A new archetype: a FROZEN PATH. One immortal marble chains a
   monophonic part by ricocheting off a constellation of FIXED, tuned
   plates hung in the air. No motors, no actuators in the orbit:
   every bounce is a perfectly elastic MIRROR reflection, so the
   marble's total energy never changes — visibly perpetual motion that
   still reads as real, because every arc is honest ballistics.

   The closed-form solve (everything follows from energy conservation):
     · energy level H (a height): the marble would come to rest there.
       Speed at height y is |v| = sqrt(2g(H − y)) — on every arc, at
       every plate, forever.
     · hop i → i+1 lasts dt (the gap to the next note) and climbs Δy.
       Its launch v0 = (Δp − ½·G·dt²)/dt has vertical part
       vy = Δy/dt + ½·g·dt, and |v0| must equal sqrt(2g(H − h_i)), so the
       HORIZONTAL distance is forced:
           d = dt · sqrt(2g(H − h_i) − vy²) = dt · sqrt(2g(H − A))
       where A = h_i + vy²/2g is the hop's (virtual) apex. H sits above
       every apex by MARGIN, so the radicand is ≥ 2g·MARGIN > 0 always.
     · headings are FREE (the reach d is forced, its direction isn't).
       Seed: a k-pointed star on a cylinder (each hop a chord). Then a
       deterministic position-based relaxation in PLAN — an arc's plan
       path is a straight segment (constant horizontal velocity), so the
       hop lengths are rigid rods and the arcs are cheap to test — pushes
       plates out of every other arc, off every stem, apart from each
       other and into the footprint. Exact finish: headings from the
       relaxed plan, exact lengths d, and a min-norm Newton solve on the
       headings so the polygon CLOSES (Σ d·e^{iφ} = 0) to 1e-12. Every
       candidate is AUDITED exactly; the first clean one wins (a fixed
       number of seeds — never a time budget: deterministic).
     · each plate's normal is FORCED: n = normalize(vOut − vIn) (a
       mirror). |vIn| = |vOut| by energy ⇒ reflect(vIn, n) = vOut exactly.

   Heights: pitch → a height band (the sculpture reads as a score), then
   relaxed (deterministic gradient descent, analytic gradient) just
   enough that every reach fits (≤ D_MAX) and consecutive plates clear. A gap
   longer than DT_MAX is split evenly by DARK RELAY MIRRORS (silent
   obsidian plates — same physics, no note): this always happens at the
   loop seam (ROLL_T + tail rest) and for very long notes. Documented clamp.
   Each plate is held by ONE rigid chrome STEM, welded to a rim point and
   rising straight up into the canopy (a cable can't hold a tilted plate —
   it carries no torque — and a plate struck from below would slacken it;
   a rigid stem takes torque and compression, so any forced tilt is honest).
   Which rim point is chosen per plate so no arc ever brushes a stem.
   Long parts (> ~56 plates) get a footprint that grows ∝ √plates; if no
   seed clears, the footprint escalates ×1.12 (≤ ESCALATE rounds, count-based).
   A repeated pitch is spread vertically (golden-ratio offsets) so a motif
   doesn't stack its plates on one shelf.

   Count-in: a periodic elastic orbit CANNOT be entered by a fixed
   obstacle course (time-reversibility: the orbit's backward extension
   passes through its own plates). So the marble hangs on a magnet at
   height H — at rest, its entire energy budget, exactly the orbit's
   energy — and drops onto a STARTER GATE: a mirror hung on the closing
   arc, angled so the falling marble leaves along the orbit with exactly
   the orbit's velocity. The gate then swings up out of the path (a
   latch releases) and never returns until the next count-in.
   ============================================================ */
import * as THREE from 'three';
import { G, noteNum, pitchSize, PAD_R, arcPos, arcVel } from '../../engine.js';
import { wrapP, laneClock, at } from '../clock.js';

export const g = -G.y;                    // 14.5
export const BALL_R  = .2;                // the marble
export const PLATE_T = .08;               // plate thickness
export const PLATE_K = 1.05;              // plate radius = PAD_R·PLATE_K·pitchSize(note) — layout-invariant
export const RELAY_R = .42;               // dark relay mirror radius
export const GATE_R  = .4;                // starter-gate mirror radius
export const MARGIN  = .75;               // every apex stays ≥ this below the energy ceiling H
export const DT_MAX  = 2.2;               // longest single hop (s); longer gaps are split by relays
export const DT_MIN  = .06;               // monophonic: events closer than this collapse to one
export const Y_LO = 1.8, Y_SPAN = 7;    // pitch → height band (lowest played note at Y_LO)
export const H_MIN = 1.1;                 // no plate below this (the deck)
export const D_MAX = 8;                   // longest single horizontal reach (keeps the knot compact)
export const HANG_MIN = .5;               // count-in: the marble hangs at least this long before the drop
export const CLEAR = .03;                 // required air between marble and any foreign plate

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

/* ---- plate size encodes pitch: the engine's own law (a pure fn of the note) ---- */
export function plateSizer(notes){
  const nums = notes.map(noteNum);
  const lo = Math.min(...nums), span = Math.max(1, Math.max(...nums) - lo);
  return note => PAD_R * PLATE_K * pitchSize(note, lo, span);
}

/* ---- events → the node ring (notes + relay mirrors), cyclic ---- */
export function makeNodes(events, P){
  const ev = events.map(e => ({ ...e, t: +wrapP(e.t, P).toFixed(9) })).sort((a, b) => a.t - b.t);
  const mono = [];
  for (const e of ev){
    const last = mono[mono.length - 1];
    if (last && e.t - last.t < DT_MIN){ if (noteNum(e.note) > noteNum(last.note)) Object.assign(last, e); continue; }
    mono.push({ ...e });
  }
  if (mono.length > 1 && mono[0].t + P - mono[mono.length - 1].t < DT_MIN) mono.pop();   // wrap collision
  const nodes = [];
  mono.forEach((e, i) => {
    const tn = i + 1 < mono.length ? mono[i + 1].t : mono[0].t + P;
    const gap = tn - e.t;
    const k = Math.max(1, Math.ceil(gap / DT_MAX - 1e-9));
    for (let j = 0; j < k; j++){
      const t = e.t + j * gap / k;
      nodes.push(j === 0 ? { t, note: e.note, vel: e.vel, relay: false, ev: i }
                         : { t: +wrapP(t, P).toFixed(9), note: null, vel: 0, relay: true, ev: i });
    }
  });
  nodes.sort((a, b) => a.t - b.t);
  nodes.forEach((n, i) => { n.dt = (i + 1 < nodes.length ? nodes[i + 1].t : nodes[0].t + P) - n.t; });
  return nodes;
}

/* ---- the hop kinematics of a height assignment ---- */
const LSE_T = .06;
export function hops(h, dt){
  const N = h.length, vy = new Array(N), apex = new Array(N);
  let m = -Infinity;
  for (let i = 0; i < N; i++){
    const j = (i + 1) % N;
    vy[i] = (h[j] - h[i]) / dt[i] + .5 * g * dt[i];
    apex[i] = h[i] + vy[i] * vy[i] / (2 * g);
    if (apex[i] > m) m = apex[i];
  }
  let s = 0;
  for (let i = 0; i < N; i++) s += Math.exp((apex[i] - m) / LSE_T);
  const H = m + LSE_T * Math.log(s) + MARGIN;             // smooth max (≥ the true max) + margin
  const d = apex.map((a, i) => dt[i] * Math.sqrt(2 * g * (H - a)));
  return { vy, apex, H, d };
}

/* ---- heights: pitch band, relaxed until every hop's horizontal reach fits ----
   Objective (smooth, analytic gradient, deterministic Armijo descent):
     stay near the pitch height · keep d ≤ D_MAX · keep d ≥ the two plates' reach
     · stay above the deck · keep the ceiling H low. */
export function heightCost(h, nodes, aux){
  const { dt, target, wT, dmin } = aux, N = h.length;
  const { vy, apex, H, d } = hops(h, dt);
  let m = -Infinity; for (const a of apex) if (a > m) m = a;
  const w = apex.map(a => Math.exp((a - m) / LSE_T)); const ws = w.reduce((a, b) => a + b, 0);
  let f = .02 * H;
  const Gd = new Array(N), grad = new Array(N).fill(0);
  for (let k = 0; k < N; k++){
    const over = d[k] - D_MAX, under = dmin[k] - d[k], low = H_MIN - h[k];
    Gd[k] = 0;
    if (over > 0){ f += 4 * over * over; Gd[k] += 8 * over; }
    if (under > 0){ f += 4 * under * under; Gd[k] -= 8 * under; }
    if (low > 0){ f += 4 * low * low; grad[k] -= 8 * low; }
    f += wT[k] * (h[k] - target[k]) ** 2; grad[k] += 2 * wT[k] * (h[k] - target[k]);
  }
  // d_k = dt·sqrt(2g(H − A_k)) ⇒ ∂d_k = (g·dt²/d_k)(∂H − ∂A_k);  H = LSE(A) + MARGIN ⇒ ∂H/∂A_k = w_k
  let GH = .02;
  const c = d.map((dk, k) => g * dt[k] * dt[k] / dk);
  for (let k = 0; k < N; k++) GH += Gd[k] * c[k];
  for (let k = 0; k < N; k++){
    const GA = -Gd[k] * c[k] + GH * w[k] / ws;
    const j = (k + 1) % N, s = vy[k] / (g * dt[k]);       // A_k = h_k + vy_k²/2g
    grad[k] += GA * (1 - s); grad[j] += GA * s;
  }
  return { f, grad };
}
export function heightAux(nodes, rOf){
  const N = nodes.length;
  const played = nodes.filter(n => !n.relay).map(n => noteNum(n.note));
  const lo = Math.min(...played), span = Math.max(1, Math.max(...played) - lo);
  // a REPEATED pitch is spread vertically (its k-th occurrence offset by a golden-ratio
  // sequence) and held more loosely, so a repeated motif doesn't stack its plates on one
  // shelf where every arc between them skims the rest. The narrower the part's range, the
  // more spread (a one-note part still needs a 3-D cloud). Pitch still reads as height.
  const occ = new Map(), VAR = Y_SPAN * Math.max(.07, .3 / Math.sqrt(new Set(played).size));
  const off = nodes.map(n => {
    if (n.relay) return 0;
    const k = occ.get(n.note) || 0; occ.set(n.note, k + 1);
    return VAR * (((k * .6180339887 + .5) % 1) - .5) * 2;
  });
  return {
    dt: nodes.map(n => n.dt),
    target: nodes.map((n, i) => n.relay ? Y_LO + .5 * Y_SPAN : Y_LO + Y_SPAN * (noteNum(n.note) - lo) / span + off[i]),
    wT: nodes.map((n, i) => n.relay ? .004 : off[i] ? .035 : .05),
    dmin: nodes.map((n, i) => 1.35 * (rOf(n) + rOf(nodes[(i + 1) % N]))),
  };
}
export function solveHeights(nodes, rOf){
  const N = nodes.length, aux = heightAux(nodes, rOf);
  let h = aux.target.slice();
  nodes.forEach((n, i) => { if (n.relay) h[i] = h[(i - 1 + N) % N] - .3; });
  let { f, grad } = heightCost(h, nodes, aux), step = .5;
  for (let it = 0; it < 600 && step > 1e-7; it++){
    const gn = Math.hypot(...grad);
    if (gn < 1e-8) break;
    for (;;){                                               // Armijo backtracking on a normalised step
      const hn = h.map((x, i) => x - step * grad[i] / gn);
      const r = heightCost(hn, nodes, aux);
      if (r.f < f - 1e-4 * step * gn){ h = hn; f = r.f; grad = r.grad; step *= 1.6; break; }
      step *= .5;
      if (step < 1e-7) break;
    }
  }
  return h;
}

/* ---- the layout SEED: the hops as consecutive chords of a cylinder of radius R ---- */
export function cylinderSeed(d, R){
  const X = []; let th = 0;
  for (const x of d){ X.push([R * Math.cos(th), R * Math.sin(th)]); th += 2 * Math.asin(Math.min(1, x / (2 * R))); }
  return X;
}

/* ---- EXACT edges from headings: X_{i+1} = X_i + d_i·(cos φ_i, sin φ_i), with the
   polygon closed by a min-norm Newton solve on the headings (Σ d_i·e^{iφ_i} = 0) ---- */
export function closeHeadings(phi, d){
  phi = phi.slice();
  for (let it = 0; it < 30; it++){
    let ex = 0, ez = 0;
    for (let i = 0; i < d.length; i++){ ex += d[i] * Math.cos(phi[i]); ez += d[i] * Math.sin(phi[i]); }
    if (Math.hypot(ex, ez) < 1e-12) break;
    // J rows: ∂ex/∂φ_i = −d sinφ, ∂ez/∂φ_i = d cosφ;  δφ = −Jᵀ(JJᵀ)⁻¹ e
    let a = 0, b = 0, c = 0;
    for (let i = 0; i < d.length; i++){ const s = -d[i] * Math.sin(phi[i]), co = d[i] * Math.cos(phi[i]); a += s * s; b += s * co; c += co * co; }
    const det = a * c - b * b, lx = (c * ex - b * ez) / det, lz = (a * ez - b * ex) / det;
    for (let i = 0; i < d.length; i++) phi[i] -= -d[i] * Math.sin(phi[i]) * lx + d[i] * Math.cos(phi[i]) * lz;
  }
  return phi;
}
export function polygonFrom(phi, d){
  const X = [[0, 0]];
  for (let i = 0; i < d.length - 1; i++) X.push([X[i][0] + d[i] * Math.cos(phi[i]), X[i][1] + d[i] * Math.sin(phi[i])]);
  let cx = 0, cz = 0; for (const [x, z] of X){ cx += x; cz += z; }
  cx /= X.length; cz /= X.length;
  return X.map(([x, z]) => [x - cx, z - cz]);
}

/* ---- the geometry from plan positions X (|X_{i+1} − X_i| = d_i exactly) ---- */
export function placeFrom(nodes, h, X, rOf, hang = true){
  const N = nodes.length, dt = nodes.map(n => n.dt);
  const p = X.map(([x, z], i) => V(x, h[i], z));
  const v0 = p.map((pi, i) => {
    const q = p[(i + 1) % N], T = dt[i];
    return q.clone().sub(pi).addScaledVector(G, -.5 * T * T).divideScalar(T);
  });
  const vIn = v0.map((_, i) => { const a = (i - 1 + N) % N; return arcVel(v0[a], dt[a]); });
  const nrm = v0.map((vo, i) => vo.clone().sub(vIn[i]).normalize());
  const r = nodes.map(rOf);
  // the plate's surface touches the marble at p − n·BALL_R; its centre sits half a thickness further in
  const c = p.map((pi, i) => pi.clone().addScaledVector(nrm[i], -(BALL_R + PLATE_T / 2)));
  const geo = { p, v0, vIn, n: nrm, r, c };
  if (hang){ const { H } = hops(h, dt); geo.rim = chooseHangers(nodes, geo, H + CEIL_GAP, hang === true ? HANG_CANDS : hang); }
  return geo;
}

/* ---- the hanger: each plate is welded at ONE rim point to a rigid stem straight up to
   the canopy (rigid ⇒ any tilt is statically honest). Which rim point is free, so pick
   the one whose stem column stays farthest from every arc that passes above it. ---- */
export const HANG_CANDS = 40;
export function rimPoint(geo, i, ang, f = .92){
  const n = geo.n[i];
  let u = V(0, 1, 0).cross(n); if (u.lengthSq() < 1e-8) u.set(1, 0, 0); u.normalize();
  const w = n.clone().cross(u);
  return geo.c[i].clone().addScaledVector(u, geo.r[i] * f * Math.cos(ang)).addScaledVector(w, geo.r[i] * f * Math.sin(ang));
}
export function chooseHangers(nodes, geo, ceil, cands = HANG_CANDS){
  const N = nodes.length, step = cands < HANG_CANDS ? .04 : .02, CAP = 1;
  const grid = new Map();                                  // arc sample points, hashed in plan (cell = CAP)
  for (let i = 0; i < N; i++) for (let s = 0; s <= nodes[i].dt + 1e-9; s += step){
    const q = arcPos(geo.p[i], geo.v0[i], Math.min(s, nodes[i].dt));
    if (q.y > ceil) continue;
    const key = ((Math.floor(q.x / CAP) + 512) << 10) | (Math.floor(q.z / CAP) + 512);
    const c = grid.get(key); if (c) c.push(q.x, q.y, q.z); else grid.set(key, [q.x, q.y, q.z]);
  }
  return nodes.map((_, i) => {
    let best = null, bestScore = -Infinity;
    for (let c = 0; c < cands; c++){
      const K = rimPoint(geo, i, c / cands * Math.PI * 2);
      let m = CAP;
      const gx = Math.floor(K.x / CAP) + 512, gz = Math.floor(K.z / CAP) + 512;
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++){
        const pts = grid.get(((gx + dx) << 10) | (gz + dz));
        if (pts) for (let k = 0; k < pts.length; k += 3){
          if (pts[k + 1] < K.y - BALL_R - .02) continue;
          const dd = Math.hypot(pts[k] - K.x, pts[k + 2] - K.z);
          if (dd < m) m = dd;
        }
      }
      for (let b = 0; b < N; b++){                           // the stem must not pierce a plate above
        if (b === i || geo.c[b].y <= K.y) continue;
        if (Math.hypot(geo.c[b].x - K.x, geo.c[b].z - K.z) > geo.r[b] + CAP) continue;
        const dd = discDist(V(K.x, geo.c[b].y, K.z), geo.c[b], geo.n[b], geo.r[b]) + BALL_R;
        if (dd < m) m = dd;
      }
      // prefer the high side of the plate (a stem from the low rim would cross the plate itself)
      const score = m + .15 * (K.y - geo.c[i].y) / geo.r[i];
      if (score > bestScore){ bestScore = score; best = K; }
    }
    return best;
  });
}

/* ---- distance from a point to a solid disc (centre c, normal n, radius r) ---- */
const _w = V(), _q = V();
export function discDist(q, c, n, r){
  _w.subVectors(q, c);
  const a = _w.dot(n);
  _q.copy(_w).addScaledVector(n, -a);
  const rad = _q.length();
  return rad <= r ? Math.abs(a) : Math.hypot(rad - r, a);
}

/* ---- the plan relaxation: headings are free, so let the chain of fixed-length hops
   settle (position-based, deterministic) until no arc grazes a foreign plate or stem,
   no two plates crowd, and everything sits inside the footprint. The horizontal path
   of an arc is a straight segment (constant horizontal velocity), so this is cheap. ---- */
export const FOOT_R = 6.2;                 // plan radius every plate + stem stays inside
export const CABLE_R = .025;              // the rigid chrome STEM each plate hangs from (name kept: the audit's 'cable')
const PUSH_CLR = .22, CABLE_CLR = .14, PUSH_K = 1, SHELL_K = .07;
export const SHELL = .7;
export function relaxPlan(nodes, h, d, rOf, X0, { iters = 240, raw = false, footR = FOOT_R, shell = SHELL_K } = {}){
  const N = nodes.length, dt = nodes.map(n => n.dt);
  const x = new Float64Array(N), z = new Float64Array(N);
  X0.forEach(([a, b], i) => { x[i] = a; z[i] = b; });
  const r = nodes.map(rOf);
  const vy = h.map((hi, i) => (h[(i + 1) % N] - hi) / dt[i] + .5 * g * dt[i]);
  const S = d.map(di => 2 + Math.ceil(di / .25));          // arc samples ≤ .25 u apart
  const cx = new Float64Array(N), cy = new Float64Array(N), cz = new Float64Array(N);
  const kx = new Uint8Array(N);                                  // stem known yet?
  const OFF = BALL_R + PLATE_T / 2;
  const ox = new Float64Array(N), oz = new Float64Array(N);   // each stem's plan offset from its ball point
  const grid = new Map(), seen = new Int32Array(N); let stampN = 0;
  const CELL = Math.max(1.2, Math.max(...r) + BALL_R + PUSH_CLR), NEED_C = BALL_R + CABLE_R + CABLE_CLR;
  let calm = 0;
  for (let it = 0; it < iters; it++){
    let moved = 0;
    if (it % 50 === 25){                                    // where would the stems hang right now?
      const geo = placeFrom(nodes, h, Array.from(x, (xi, i) => [xi, z[i]]), rOf, 12);
      geo.rim.forEach((K, i) => { ox[i] = K.x - x[i]; oz[i] = K.z - z[i]; kx[i] = 1; });
    }
    // the plate centres implied by the current plan (n = normalize(vOut − vIn))
    for (let i = 0; i < N; i++){
      const a = (i - 1 + N) % N, j = (i + 1) % N;
      const nx = (x[j] - x[i]) / dt[i] - (x[i] - x[a]) / dt[a];
      const ny = vy[i] - (vy[a] - g * dt[a]);
      const nz = (z[j] - z[i]) / dt[i] - (z[i] - z[a]) / dt[a];
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      cx[i] = x[i] - nx / l * OFF; cy[i] = h[i] - ny / l * OFF; cz[i] = z[i] - nz / l * OFF;
    }
    // (1) arcs vs foreign plates (≈ spheres) + their stems. A uniform plan grid of plate
    //     centres keeps this ~linear: each arc sample only meets the plates in its 3×3 cells.
    grid.clear();
    for (let m = 0; m < N; m++){
      const key = ((Math.floor(cx[m] / CELL) + 512) << 10) | (Math.floor(cz[m] / CELL) + 512);
      const c = grid.get(key); if (c) c.push(m); else grid.set(key, [m]);
    }
    for (let i = 0; i < N; i++){
      const j = (i + 1) % N, ax = x[i], az = z[i], bx = x[j], bz = z[j];
      const stamp = ++stampN;
      for (let s = 1; s < S[i]; s++){
        const f = s / S[i], T = f * dt[i];
        const qx = ax + (bx - ax) * f, qz = az + (bz - az) * f, qy = h[i] + vy[i] * T - .5 * g * T * T;
        const gx = Math.floor(qx / CELL) + 512, gz = Math.floor(qz / CELL) + 512;
        for (let ddx = -1; ddx <= 1; ddx++) for (let ddz = -1; ddz <= 1; ddz++){
          const cell = grid.get(((gx + ddx) << 10) | (gz + ddz));
          if (!cell) continue;
          for (const m of cell){
            if (m === i || m === j) continue;
            if (seen[m] !== stamp){                         // once per (arc, plate): its stem's closest approach
              seen[m] = stamp;
              if (kx[m]){
                const ex = bx - ax, ez = bz - az, L2 = ex * ex + ez * ez || 1e-9, Kx = x[m] + ox[m], Kz = z[m] + oz[m];
                const fc = Math.min(1, Math.max(0, ((Kx - ax) * ex + (Kz - az) * ez) / L2)), Tc = fc * dt[i];
                const yc = h[i] + vy[i] * Tc - .5 * g * Tc * Tc;
                const dx = ax + ex * fc - Kx, dz = az + ez * fc - Kz, hd = Math.sqrt(dx * dx + dz * dz) || 1e-6;
                if (yc > cy[m] - BALL_R && hd < NEED_C){
                  const k = PUSH_K * (NEED_C - hd), ux = dx / hd, uz = dz / hd; moved += k;
                  x[m] -= ux * k; z[m] -= uz * k;
                  x[i] += ux * k * (1 - fc); z[i] += uz * k * (1 - fc);
                  x[j] += ux * k * fc; z[j] += uz * k * fc;
                }
              }
            }
            const need = r[m] + BALL_R + PUSH_CLR;
            const dx = qx - cx[m], dz = qz - cz[m], dy = qy - cy[m], d3 = Math.sqrt(dx * dx + dz * dz + dy * dy);
            if (d3 >= need) continue;
            const hd = Math.sqrt(dx * dx + dz * dz) || 1e-6, ux = dx / hd, uz = dz / hd, k = PUSH_K * (need - d3);
            moved += k;
            x[m] -= ux * k; z[m] -= uz * k;
            x[i] += ux * k * (1 - f); z[i] += uz * k * (1 - f);
            x[j] += ux * k * f; z[j] += uz * k * f;
          }
        }
      }
    }
    // (2) plates vs plates (and a lower plate's stem vs a higher plate)
    for (let a = 0; a < N; a++) for (let b = a + 1; b < N; b++){
      const dx = x[a] - x[b], dz = z[a] - z[b], hd2 = dx * dx + dz * dz;
      let need = Math.max(r[a], r[b]) + CABLE_CLR + .12;
      if (Math.abs(h[a] - h[b]) < r[a] + r[b] + .3) need = Math.max(need, r[a] + r[b] + .25);
      if (hd2 >= need * need) continue;
      const hd = Math.sqrt(hd2) || 1e-6, k = .5 * (need - hd) / hd;
      moved += k * hd;
      x[a] += dx * k; z[a] += dz * k; x[b] -= dx * k; z[b] -= dz * k;
    }
    // (3) the footprint — and a weak pull onto a HOLLOW SHELL (plates prefer r ≈ SHELL·footR),
    //     so the arcs cross an open interior instead of threading a packed core: the frozen
    //     knot reads through the glass from any side. Fades out over the run (it only shapes).
    const kS = shell * Math.max(0, 1 - it / (iters * .6));
    for (let i = 0; i < N; i++){
      let l = Math.sqrt(x[i] * x[i] + z[i] * z[i]);
      if (kS && l > 1e-6){ const f = 1 + kS * (SHELL * footR - l) / l; x[i] *= f; z[i] *= f; l *= f; }
      const lim = footR - r[i];
      if (l > lim){ x[i] *= lim / l; z[i] *= lim / l; }
    }
    // (4) the hop lengths (stiff: two Gauss–Seidel passes)
    let err = 0;
    for (let pass = 0; pass < 2; pass++) for (let i = 0; i < N; i++){
      const j = (i + 1) % N, ex = x[j] - x[i], ez = z[j] - z[i], L = Math.sqrt(ex * ex + ez * ez) || 1e-6;
      const c = .5 * (L - d[i]) / L;
      if (pass) err = Math.max(err, Math.abs(L - d[i]));
      x[i] += ex * c; z[i] += ez * c; x[j] -= ex * c; z[j] -= ez * c;
    }
    // settled: nothing pushed and the hops hold their lengths (after the stems are known)
    calm = moved < 1e-4 && err < 1e-3 && it > 30 ? calm + 1 : 0;
    if (calm >= 6) break;
  }
  // settle the hop lengths alone (least-change, still recentred into the footprint)
  for (let pass = 0; pass < 400; pass++){
    if (pass % 8 === 0) for (let i = 0; i < N; i++){
      const l = Math.sqrt(x[i] * x[i] + z[i] * z[i]), lim = footR - r[i];
      if (l > lim){ x[i] *= lim / l; z[i] *= lim / l; }
    }
    for (let i = 0; i < N; i++){
    const j = (i + 1) % N, ex = x[j] - x[i], ez = z[j] - z[i], L = Math.sqrt(ex * ex + ez * ez) || 1e-6;
    const c = .5 * (L - d[i]) / L;
    x[i] += ex * c; z[i] += ez * c; x[j] -= ex * c; z[j] -= ez * c;
  } }
  if (raw) return Array.from(x, (xi, i) => [xi, z[i]]);
  // exact finish: headings → exact lengths → min-norm closure
  const phi = Array.from(x, (xi, i) => Math.atan2(z[(i + 1) % N] - z[i], x[(i + 1) % N] - xi));
  return polygonFrom(closeHeadings(phi, d), d);
}

/* ---- the honesty audit: min air between the marble and every FOREIGN plate and
   every stem, and between plates; plus the footprint ---- */
export function audit(nodes, geo, { step = .02, ceil = Infinity } = {}){
  const N = nodes.length;
  let arcPlate = Infinity, plates = Infinity, arcCable = Infinity, foot = 0, worst = null;
  for (let i = 0; i < N; i++){
    const j = (i + 1) % N, T = nodes[i].dt, p0 = geo.p[i], v0 = geo.v0[i];
    // plates: sampled at ≤ .06 u of travel (speed is bounded by sqrt(2gH))
    const sp = Math.max(v0.length(), geo.vIn[j].length()), ds = Math.min(step, .06 / sp);
    for (let s = ds; s < T - ds * .5; s += ds){
      const q = arcPos(p0, v0, s);
      for (let k = 0; k < N; k++){
        if (k === i || k === j) continue;
        const dd = discDist(q, geo.c[k], geo.n[k], geo.r[k]) - BALL_R - PLATE_T / 2;
        if (dd < arcPlate){ arcPlate = dd; worst = { arc: i, plate: k, s }; }
      }
    }
    // stems: EXACT. The plan path is a straight line at constant speed, the stem a vertical
    // line from its rim point up; the arc is above y0 on one time interval → clamp into it.
    const vx = v0.x, vz = v0.z, h2 = vx * vx + vz * vz || 1e-12;
    for (let k = 0; k < N; k++){
      const K = geo.rim[k], y0 = K.y - BALL_R;
      // y(s) = p0.y + v0.y·s − ½g s² ≥ y0  ⇔  s ∈ [s1, s2]
      const A = -.5 * g, B = v0.y, C = p0.y - y0, disc = B * B - 4 * A * C;
      if (disc < 0) continue;
      const r1 = (-B + Math.sqrt(disc)) / (2 * A), r2 = (-B - Math.sqrt(disc)) / (2 * A);
      const s1 = Math.max(0, Math.min(r1, r2)), s2 = Math.min(T, Math.max(r1, r2));
      if (s1 > s2) continue;
      let s = ((K.x - p0.x) * vx + (K.z - p0.z) * vz) / h2;
      s = Math.min(s2, Math.max(s1, s));
      const qy = p0.y + v0.y * s - .5 * g * s * s;
      if (qy > ceil) continue;
      const dc = Math.hypot(p0.x + vx * s - K.x, p0.z + vz * s - K.z) - BALL_R - CABLE_R;
      if (dc < arcCable) arcCable = dc;
    }
  }
  for (let a = 0; a < N; a++){
    foot = Math.max(foot, Math.hypot(geo.c[a].x, geo.c[a].z) + geo.r[a]);
    for (let b = a + 1; b < N; b++){
      if (geo.c[a].distanceTo(geo.c[b]) > geo.r[a] + geo.r[b] + .5) continue;
      const n = geo.n[a], u = V(1, 0, 0).cross(n); if (u.lengthSq() < 1e-6) u.set(0, 0, 1).cross(n); u.normalize();
      const w = n.clone().cross(u);
      for (let m = 0; m <= 24; m++){
        const ang = m / 24 * Math.PI * 2, rr = m === 24 ? 0 : geo.r[a];
        const q = geo.c[a].clone().addScaledVector(u, rr * Math.cos(ang)).addScaledVector(w, rr * Math.sin(ang));
        const dd = discDist(q, geo.c[b], geo.n[b], geo.r[b]) - PLATE_T;
        if (dd < plates) plates = dd;
      }
    }
  }
  // a lower plate's stem must not pierce a higher plate
  let cablePlate = Infinity;
  for (let a = 0; a < N; a++) for (let b = 0; b < N; b++){
    if (a === b || geo.c[b].y <= geo.rim[a].y) continue;
    const q = V(geo.rim[a].x, geo.c[b].y, geo.rim[a].z);
    const dd = discDist(q, geo.c[b], geo.n[b], geo.r[b]);
    if (dd < cablePlate) cablePlate = dd;
  }
  return { arcPlate, plates, arcCable, cablePlate, foot, worst };
}

/* ---- the whole orbit ----
   Multi-start: seed the plan relaxation from k-pointed star cylinders of several radii,
   audit each EXACTLY (marble vs every foreign plate + every cable, plate vs plate, the
   footprint), keep the first clean one (or the best). Deterministic. */
export const FOOT_MAX = 7.25;              // plan radius of the furthest plate edge (≈ a 14.5 × 14.5 footprint)
export const SEEDS = [3.8, 4.2, 4.6, 5.0, 4.0, 4.4, 4.8, 5.8, 5.4, 3.6, 5.2, 5.6, 6.0, 6.2, 3.4, 6.4];
export const scoreOf = (a, footMax = FOOT_MAX) => Math.min(a.arcPlate, a.plates, a.arcCable, a.cablePlate, footMax - a.foot);
/* a long part needs more air: the footprint grows ∝ √(plates) past ~56 of them (documented clamp) */
export const footFor = N => FOOT_MAX * Math.max(1, Math.sqrt(N / 56));
/* a FIXED number of starts (never a time budget: the layout must not depend on machine speed) */
export const startsFor = N => N > 60 ? 3 : N > 40 ? 6 : SEEDS.length;
export const ESCALATE = 4;                 // footprint growth rounds when nothing clears (×1.12 each)
export const CEIL_GAP = 1.0;               // the canopy hangs this far above the energy ceiling H
export function buildOrbit(events, { P, start = -Infinity, rOf: rOfIn } = {}){
  const nodes = makeNodes(events, P);
  const sizer = plateSizer(nodes.filter(n => !n.relay).map(n => n.note));
  const rOf = rOfIn || (n => n.relay ? RELAY_R : sizer(n.note));
  const h = solveHeights(nodes, rOf);
  const { H, d } = hops(h, nodes.map(n => n.dt));
  const foot0 = footFor(nodes.length);
  let best = null, tried = 0, grow = 0;
  // ESCALATION (deterministic, count-based — never a time budget): if no seed clears at
  // this footprint, give the knot more air (×1.12 per round) and run the seeds again.
  // Stop at the first clean layout. Only if every round fails is the least-bad kept.
  for (let k = 0; k <= ESCALATE && !(best && best.score >= CLEAR); k++){
    const footMax = foot0 * Math.pow(1.12, k), footR = footMax - (FOOT_MAX - FOOT_R), sc = footMax / FOOT_MAX;
    const maxTries = k ? Math.min(3, startsFor(nodes.length)) : startsFor(nodes.length);
    let n = 0;
    for (const R0 of SEEDS){
      const R = R0 * sc;
      if (R < Math.max(...d) / 2) continue;
      const X = relaxPlan(nodes, h, d, rOf, cylinderSeed(d, R), { footR });
      const geo = placeFrom(nodes, h, X, rOf);
      const a = audit(nodes, geo, { step: .03, ceil: H + CEIL_GAP });
      const score = scoreOf(a, footMax);
      tried++; n++;
      // a clean layout at a bigger footprint always beats a dirty one at a smaller
      if (!best || score > best.score) best = { X, geo, a, score, seed: R, footMax, grow: k };
      if (score >= CLEAR || n >= maxTries) break;
    }
  }
  const L = laneClock(nodes.map(n => n.t), P);
  const orbit = { nodes, h, H, d, ceilY: H + CEIL_GAP, ...best.geo, X: best.X, audit: best.a, score: best.score, seed: best.seed, tried,
                  footMax: best.footMax, grow: best.grow, L, P };
  orbit.entry = solveEntry(orbit, start);
  return orbit;
}

/* ---- the count-in: magnet at rest at height H → drop → starter gate → the orbit ----
   The gate sits ON the arc into the first NOTE plate (so the drop lands the downbeat),
   low on its descending side (a long, dramatic fall). Falling from rest at H, the
   marble arrives with |v| = sqrt(2g(H − y)) — exactly the orbit's speed there — so a
   mirror n = normalize(vOrbit − vDrop) sends it onward with the orbit's exact velocity. */
export const GATE_FRACS = [.3, .24, .38, .18, .46, .54, .62];
export function solveEntry(orb, start){
  const { nodes, P, H } = orb, N = nodes.length;
  if (!isFinite(start)) start = -P;
  const firstAbs = j => nodes[j].t + Math.ceil((start - nodes[j].t) / P) * P;
  const order = nodes.map((n, j) => ({ j, abs: firstAbs(j), relay: n.relay }))
    .sort((a, b) => (a.relay - b.relay) || (a.abs - b.abs));   // note plates first, earliest first
  const cand = order.concat(order.map(c => ({ ...c, abs: c.abs + P })));
  for (let pass = 0; pass < 2; pass++) for (const { j, abs } of cand){
    const a = (j - 1 + N) % N, T = nodes[a].dt;
    for (const f of GATE_FRACS){
      const tau = f * T, s = T - tau;                      // tau = time from the gate to the plate
      const E = arcPos(orb.p[a], orb.v0[a], s), vOrb = arcVel(orb.v0[a], s);
      if (H - E.y < (pass ? .6 : 1.5)) continue;
      const fall = Math.sqrt(2 * (H - E.y) / g);
      const tE = abs - tau, tRel = tE - fall;
      if (tRel < start + HANG_MIN) continue;
      const vDrop = V(0, -Math.sqrt(2 * g * (H - E.y)), 0);
      const n = vOrb.clone().sub(vDrop).normalize();
      const c = E.clone().addScaledVector(n, -(BALL_R + PLATE_T / 2));
      // the drop line + the rest of the entry hop + the gate itself must clear every plate
      let ok = true;
      for (let k = 0; k < N && ok; k++){
        for (let y = E.y + .3; y <= H; y += .1)
          if (discDist(V(E.x, y, E.z), orb.c[k], orb.n[k], orb.r[k]) < BALL_R + PLATE_T / 2 + CLEAR){ ok = false; break; }
        if (k !== j) for (let u = .04; u < tau - .02 && ok; u += .04)
          if (discDist(arcPos(E, vOrb, u), orb.c[k], orb.n[k], orb.r[k]) < BALL_R + PLATE_T / 2 + CLEAR) ok = false;
        if (discDist(c, orb.c[k], orb.n[k], orb.r[k]) < GATE_R + PLATE_T) ok = false;
      }
      if (!ok && pass === 0) continue;
      return { j, from: a, tau, E, vOrb, vDrop, n, c, Q: V(E.x, H, E.z), tFirst: abs, tE, tRel, fall };
    }
  }
  return null;
}

/* ---- the marble at songTime t: a pure function ---- */
export function marbleAt(orb, t, out = V()){
  const en = orb.entry;
  if (en && t < en.tE){
    if (t < en.tRel) return { phase: 'hang', pos: out.copy(en.Q), vel: V(), i: -1, since: Infinity };
    const s = t - en.tRel;
    return { phase: 'drop', pos: out.set(en.Q.x, orb.H - .5 * g * s * s, en.Q.z), vel: V(0, -g * s, 0), i: -1, since: Infinity };
  }
  const c = at(orb.L, t);
  const i = c.i;
  arcPosInto(orb.p[i], orb.v0[i], c.since, out);
  return { phase: 'orbit', pos: out, vel: arcVel(orb.v0[i], c.since), i, since: c.since, abs: c.abs, gap: c.gap };
}
function arcPosInto(p0, v0, s, out){
  return out.set(p0.x + v0.x * s, p0.y + v0.y * s - .5 * g * s * s, p0.z + v0.z * s);
}

/* ---- time since node j last struck (Infinity if it hasn't since the count-in) ---- */
export function sinceStrike(orb, j, t){
  const tj = orb.nodes[j].t, abs = tj + Math.floor((t - tj) / orb.P) * orb.P;
  const first = orb.entry ? orb.entry.tFirst : -Infinity;
  return abs < first - 1e-6 ? Infinity : t - abs;
}

/* ---- a struck plate's wobble on its rod: zero at the strike, tapered to exactly
   zero by its next strike one loop later. A pure fn of time-since-strike. ---- */
export const WOB_F = 2.1, WOB_D = 2.4;
export function wobble(s, P, amp){
  if (!(s >= 0) || s >= P) return 0;
  const taper = (1 - s / P) ** 2;
  return amp * Math.sin(2 * Math.PI * WOB_F * s) * Math.exp(-WOB_D * s) * taper;
}

/* ---- the starter gate's swing (0 = down in the path, 1 = parked up at the ring) ---- */
export function gateLift(orb, t){
  const en = orb.entry;
  if (!en) return 1;
  const s = (t - en.tE - .12) / .7;
  if (s <= 0) return 0;
  if (s >= 1) return 1;
  return s * s * (3 - 2 * s);
}
