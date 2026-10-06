/* ============================================================
   TUBULAR BELLS — the pure math (no THREE scene, no DOM, no audio).

   THE MECHANISM (one lane = one pitch = one tube + its own striker):
   · a hanging chrome tube (length ∝ f^-1/2, real chime scaling) on a cord;
   · in front of it, its OWN PENDULUM STRIKER: a heavy marble on a rigid rod,
     pivoting on the gantry's axle beam. Hanging straight down (θ = 0), the
     marble's surface just touches the tube — so every strike happens at the
     bottom of the swing, at full pendulum speed;
   · a MOTORISED CATCHER ARM on the same axle (a fork with an electromagnet
     shoe behind the marble). It holds the marble back at the release angle A
     (A grows with the note's velocity: forte = a big swing), cuts, and the
     marble falls under real gravity — the EXACT large-amplitude pendulum,
     via Jacobi elliptic functions, so the quarter period K(k)/ω lands it on
     the beat to the microsecond;
   · the bounce is lossy: the marble leaves with e·v and swings out to the
     lower REBOUND apex B (sin B/2 = e·sin A/2). The shoe has followed it down
     and meets it there AT ZERO SPEED (a kiss), latches, and the motor carries
     it back up to the next release angle — the visible energy supply.
   · DENSE repeats (a gap shorter than rebound + fall — a pendulum is
     isochronous, so a smaller swing is NOT faster): the shoe catches the
     marble EARLY on the rebound, velocity-matched (no jolt), and the motor
     THROWS it — a cubic Hermite drive that ends exactly on the next release
     orbit with that orbit's speed, so the final free flight is still the
     honest pendulum arc onto the beat. The marble is free at every contact.
   · the tube swings on its cord after each hit (pushed away, decaying) and is
     tapered back to rest by the next contact, so contact is always honest.

   Time is the only state: every function here is a pure fn of songTime.
   ============================================================ */
import { laneClock, at, wrapP } from '../clock.js';

export const g = 14.5;                       // |G| — engine.js gravity
export const ROD = 1.5;                      // pendulum length (pivot → marble centre)
export const BALL_R = .30;                   // striker marble radius
export const TUBE_R = .18;                   // chime tube outer radius
export const HANG = .45;                     // cord: hanger rail → tube top
export const STRIKE_DEPTH = .36;             // contact point below the tube's top cap
export const E = .6;                         // restitution: marble ↔ tube
export const OMEGA = Math.sqrt(g / ROD);     // pendulum ω (small-angle) — the elliptic fns use it exactly
export const A_MIN = 30 * Math.PI / 180;     // release angle at vel 0 …
export const A_MAX = 80 * Math.PI / 180;     // … and at vel 1
export const DWELL = .07;                    // the shoe holds the caught marble a beat before carrying (the "clack")
export const CARRY_T = .55;                  // motor carry time, rebound apex → release angle
export const FREE_MIN = DWELL + .2;          // a gap needs this much coupled time to take the free (catch-at-apex) path
export const DENSE_FRAC = .38;               // dense gaps: fraction of the gap the motor drives
export const TUBE_K = .016;                  // tube swing (rad) per unit impact speed …
export const TIP_MAX = .55;                  // … soft-capped so the tube's FOOT never travels more than this
export const ROLL_K = .2;                    // sideways roll as a fraction of the swing (the tube never swings true)
export const TUBE_DAMP = .55;                // tube swing decay (1/s)
// the tube's own BENDING shiver (the shader displaces the tube by this; the clearance test includes it)
export const SHIVER_A = .03, SHIVER_F = 9, SHIVER_D = 6;

/* ---- the lane SLAB: every part of a lane (marble, rod, fork, crossbar, motor, axle stub,
   tube + its roll) lives within ±SLAB_HW of the lane's swing plane. Neighbouring planes are
   laid out ≥ PLANE_MIN apart, so lanes CANNOT touch whatever angles they swing to. ---- */
export const FORK_X = .2;                    // fork arms either side of the rod (arm radius .035)
export const SLAB_HW = .31;
export const PLANE_MIN = 2 * SLAB_HW + .04;
export const YAW_MAX = .87;                  // preferred swing-plane turn (~50° off the audience axis)

/** Lay n lanes across a station of width W: the row's x positions, plane spacing and the
    swing-plane yaw. The yaw is relaxed toward 0 (swinging straight at the audience) only when
    the lanes would otherwise crowd closer than PLANE_MIN. Also returns the tower x (TX). */
export function layoutBells(n, W = 11){
  const TX = W / 2 - .45;
  let out;
  for (let yaw = YAW_MAX; yaw >= -1e-9; yaw -= .01){
    const y = Math.max(0, yaw), sx = Math.sin(y);
    // low end: the longest tube's foot, pushed away along −swing, stays clear of the left tower
    const xLo = -TX + .13 + TUBE_R + TIP_MAX * sx + .15;
    // high end: the striker's full reach (fork crossbar ≈ ROD + .2 out from the pivot) clears the right tower
    const xHi = TX - .13 - (TUBE_R + BALL_R + ROD + .2) * sx - .2;
    const SP = n > 1 ? Math.min(1.3, (xHi - xLo) / (n - 1)) : 0;
    out = { yaw: y, SP, TX, x0: (xLo + xHi) / 2 - (n - 1) * SP / 2, plane: n > 1 ? SP * Math.cos(y) : Infinity };
    if (out.plane >= PLANE_MIN) break;
  }
  return out;
}

/* ---- Jacobi elliptic machinery (A&S 16.4, AGM descent; m = k²) ---- */
export function ellipK(k){
  let a = 1, b = Math.sqrt(1 - k * k);
  for (let n = 0; n < 30 && Math.abs(a - b) > 1e-15; n++){ const a1 = (a + b) / 2; b = Math.sqrt(a * b); a = a1; }
  return Math.PI / (2 * a);
}
export function ellipSnCn(u, k){
  const m = k * k;
  if (m < 1e-14) return [Math.sin(u), Math.cos(u)];
  const A = [1], C = [k];
  let b = Math.sqrt(1 - m), n = 0;
  while (Math.abs(C[n]) > 1e-15 && n < 20){
    const a = A[n];
    A.push((a + b) / 2); C.push((a - b) / 2); b = Math.sqrt(a * b); n++;
  }
  let phi = Math.pow(2, n) * A[n] * u;
  for (let j = n; j > 0; j--) phi = (Math.asin(C[j] * Math.sin(phi) / A[j]) + phi) / 2;
  return [Math.sin(phi), Math.cos(phi)];
}

/* ---- the exact pendulum ---- */
const kOf = A => Math.sin(A / 2);
/** Quarter period at amplitude A: rest at A → bottom (θ = 0). Exact: K(sin A/2)/ω. */
export const quarter = A => ellipK(kOf(A)) / OMEGA;
/** Release angle for a note's velocity (dynamics → a bigger swing → a faster strike). */
export const ampForVel = v => A_MIN + (A_MAX - A_MIN) * Math.max(0, Math.min(1, v));
/** Rebound apex after a lossy strike from amplitude A. */
export const reboundAmp = A => 2 * Math.asin(E * Math.sin(A / 2));
/** Linear impact speed at the bottom of a swing of amplitude A. */
export const hitSpeed = A => 2 * ROD * OMEGA * Math.sin(A / 2);

/** Released from rest at A, s seconds later (falling branch, s ∈ [0, quarter(A)]): [θ, θ'].
    θ = 2·asin(k·sn(K − ωs)),  θ' = −2kω·cn(K − ωs). */
export function fall(A, s){
  const k = kOf(A), K = ellipK(k);
  const [sn, cn] = ellipSnCn(K - OMEGA * s, k);
  return [2 * Math.asin(Math.max(-1, Math.min(1, k * sn))), -2 * k * OMEGA * cn];
}
/** Leaving the bottom outward, swinging to apex B, s seconds after the strike: [θ, θ']. */
export function rise(B, s){
  const k = kOf(B);
  const [sn, cn] = ellipSnCn(OMEGA * s, k);
  return [2 * Math.asin(Math.max(-1, Math.min(1, k * sn))), 2 * k * OMEGA * cn];
}

/* cubic Hermite (value + derivative) over duration D, at local time s */
function herm(p0, m0, p1, m1, D, s){
  const u = Math.max(0, Math.min(1, s / D)), u2 = u * u, u3 = u2 * u;
  const p = (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * D * m0 + (-2 * u3 + 3 * u2) * p1 + (u3 - u2) * D * m1;
  const v = ((6 * u2 - 6 * u) * p0 + (3 * u2 - 4 * u + 1) * D * m0 + (-6 * u2 + 6 * u) * p1 + (3 * u2 - 2 * u) * D * m1) / D;
  return [p, v];
}

/* ---- a lane: strikes → a per-gap plan, solved once at build ----
   strikes = loop-local seconds, vels parallel to it, len = the tube's length (its cord
   swing rate). Gap i runs strike i → strike i+1. */
export function bellLane(strikes, vels, P, { len = 6 } = {}){
  const L = laneClock(strikes, P);
  const n = L.s.length;
  const vel = L.s.map(si => {
    let v = 0;
    strikes.forEach((t, k) => { if (Math.abs(+wrapP(t, P).toFixed(9) - si) < 1e-9) v = Math.max(v, vels[k] ?? 1); });
    return v;
  });
  const A = vel.map(ampForVel), B = A.map(reboundAmp);
  const qA = A.map(quarter), qB = B.map(quarter);
  const plan = L.gaps.map((gap, i) => {
    const j = (i + 1) % n, sum = qB[i] + qA[j];
    if (gap - sum >= FREE_MIN){                         // FREE: catch at the rebound apex, carry, hold, release from rest
      const Dc = gap - sum;
      return { mode: 'free', gap, tc: qB[i], tr: qA[j], Dc, Dcar: Math.min(CARRY_T, Dc - DWELL),
               thc: B[i], wc: 0, thr: A[j], wr: 0 };
    }
    const Dc = Math.max(gap * DENSE_FRAC, gap - sum);   // DENSE: catch on the fly, motor throws onto the next orbit
    const f = (gap - Dc) / sum, tc = f * qB[i], tr = f * qA[j];
    const [thc, wc] = rise(B[i], tc);
    const [thr, wr] = fall(A[j], qA[j] - tr);
    return { mode: 'dense', gap, tc, tr, Dc, thc, wc, thr, wr };
  });
  const lane = { L, n, vel, A, B, qA, qB, plan, vHit: A.map(hitSpeed), len, tubeW: tubeOmega(len) };
  // the free shoe's lift over each uncoupled window (normal + count-in variants), solved once
  plan.forEach((p, i) => { p.lam = shoeLift(lane, i, false); p.lamArmed = shoeLift(lane, i, true); });
  return lane;
}

/* ---- the FREE shoe: between the release before strike i and the catch after it, the
   magnet is cut and the motor alone moves the fork. Its path is the cubic Hermite from the
   release state to the catch state (velocity-matched at both ends: no jolt) PLUS a sin²
   lift λ·sin²(πu) — zero at both ends, so the matching survives — with λ solved at build
   so the shoe always trails the marble's V-shaped swing (fall → strike → rebound). ---- */
function shoeWindow(lane, i, armed){
  const { n, A, qA, plan } = lane, p = plan[i], pr = plan[(i - 1 + n) % n];
  return armed ? { D: qA[i] + p.tc, pre: qA[i], th0: A[i], w0: 0 }
               : { D: pr.tr + p.tc, pre: pr.tr, th0: pr.thr, w0: pr.wr };
}
/* the marble during that window, x = seconds since release */
function freeBall(lane, i, x, pre){
  if (x <= pre) return fall(lane.A[i], lane.qA[i] - pre + x);
  return rise(lane.B[i], x - pre);
}
function shoeLift(lane, i, armed){
  const W = shoeWindow(lane, i, armed), p = lane.plan[i];
  let lam = 0;
  for (let k = 1; k < 200; k++){
    const u = k / 200, x = u * W.D;
    const h = herm(W.th0, W.w0, p.thc, p.wc, W.D, x)[0];
    const b = freeBall(lane, i, x, W.pre)[0];
    const bump = Math.sin(Math.PI * u) ** 2;
    lam = Math.max(lam, (b - h) / bump);
  }
  return lam > 0 ? lam * 1.15 + .02 : 0;                // a hair of daylight between shoe and marble
}
function shoeFree(lane, i, x, armed){
  const W = shoeWindow(lane, i, armed), p = lane.plan[i];
  const [h, hv] = herm(W.th0, W.w0, p.thc, p.wc, W.D, x);
  const lam = armed ? p.lamArmed : p.lam, u = Math.max(0, Math.min(1, x / W.D));
  return [h + lam * Math.sin(Math.PI * u) ** 2, hv + lam * Math.PI * Math.sin(2 * Math.PI * u) / W.D];
}

/* the coupled (marble latched on the shoe) path inside gap plan p, at s since its strike */
function coupled(p, s){
  const x = s - p.tc;
  if (p.mode === 'dense') return herm(p.thc, p.wc, p.thr, p.wr, p.Dc, x);
  if (x <= DWELL) return [p.thc, 0];
  const u = Math.min(1, (x - DWELL) / p.Dcar);
  return [p.thc + (p.thr - p.thc) * u * u * (3 - 2 * u), (p.thr - p.thc) * 6 * u * (1 - u) / p.Dcar * (u < 1 ? 1 : 0)];
}

/** The lane at songTime t. Returns
    { th, w, phi, wphi, latched, armed, i, since, until, gap, abs, first, tube:{psi, roll} }
    th/w   = striker angle from vertical (+ = out, away from the tube) and its rate
    phi    = the catcher shoe's angle (it touches the marble when phi == th)
    latched= the marble is held/driven by the shoe (the coil is energised). */
export function bellAt(lane, t, start = -Infinity){
  const { L, n, A, qA, plan } = lane;
  const c = at(L, t, start);
  if (c.armed){
    const j = c.next, s = qA[j] - c.until;              // s = time since the armed release
    if (s <= 0) return { th: A[j], w: 0, phi: A[j], wphi: 0, latched: true, armed: true, ...c, tube: TUBE0 };
    const [th, w] = fall(A[j], s);
    const [phi, wphi] = shoeFree(lane, j, s, true);
    return guard({ th, w, phi, wphi, latched: false, armed: true, ...c, tube: TUBE0 });
  }
  const i = c.i, p = plan[i], s = c.since, j = (i + 1) % n;
  const tube = tubeAt(lane, i, s, c.gap);
  if (s < p.tc){                                        // free rebound off strike i
    const [th, w] = rise(lane.B[i], s);
    const firstHit = Math.abs(c.abs - c.first) < 1e-6;  // the count-in strike was released from rest at A
    const pre = firstHit ? qA[i] : plan[(i - 1 + n) % n].tr;
    const [phi, wphi] = shoeFree(lane, i, pre + s, firstHit);
    return guard({ th, w, phi, wphi, latched: false, armed: false, ...c, tube });
  }
  if (s < p.gap - p.tr){                                // latched: dwell, carry / drive
    const [th, w] = coupled(p, s);
    return { th, w, phi: th, wphi: w, latched: true, armed: false, ...c, tube };
  }
  const r = s - (p.gap - p.tr);                         // released: the honest pendulum fall onto strike i+1
  const [th, w] = fall(A[j], qA[j] - p.tr + r);
  const [phi, wphi] = shoeFree(lane, j, r, false);
  return guard({ th, w, phi, wphi, latched: false, armed: false, ...c, tube });
}
/* the shoe never sits inside the marble (belt-and-braces; the tests show the Hermite never needs it) */
function guard(o){ if (o.phi < o.th){ o.phi = o.th; o.wphi = o.w; o.guarded = true; } return o; }

/* ---- the struck TUBE swinging on its cord ----
   Pushed away (ψ < 0 = away from the striker), decaying at the cord's pendulum rate,
   with a smaller sideways roll (the tube never swings perfectly true), both TAPERED to
   exactly rest — position and speed — by the next contact. */
const TUBE0 = { psi: 0, roll: 0, shiver: 0 };
export const tubeOmega = len => Math.sqrt(g / (HANG + len * 2 / 3));   // ≈ physical-pendulum rate of a hung rod
/** Swing amplitude (rad) for an impact speed v on a tube of length len: ∝ v, soft-capped so
    the foot never moves more than TIP_MAX (neighbours + the tower stay clear). */
export function tubeAmp(v, len){
  const cap = TIP_MAX / (HANG + len);
  return cap * Math.tanh(TUBE_K * v / cap);
}
/** The bending SHIVER's sideways displacement (along the swing axis, − = away from the striker)
    at depth d below the tube's top, s seconds after a hit of visual strength amp (0..1). Zero at
    the strike (sin 0) and tapered to zero by the next one — contact stays honest. The shader in
    index.js evaluates exactly this. */
export const shiverShape = (d, len) => -Math.cos(4.73 * d / len - 2.365) / .714;   // free-free mode 1 ≈ (ends +1, middle −1.4)
export function shiverAt(amp, s, gap, d, len){
  const taper = Math.max(0, 1 - s / gap) ** 2;
  return -SHIVER_A * amp * Math.exp(-SHIVER_D * s) * Math.sin(2 * Math.PI * SHIVER_F * s) * taper * shiverShape(d, len);
}
export const glowAmp = vel => .35 + .65 * vel;
function tubeAt(lane, i, s, gap){
  const W = lane.tubeW ?? 1.5, amp = tubeAmp(lane.vHit[i], lane.len);
  const taper = Math.max(0, 1 - s / gap) ** 2, d = Math.exp(-TUBE_DAMP * s) * taper;
  return { psi: -amp * Math.sin(W * s) * d, roll: ROLL_K * amp * Math.sin(1.37 * W * s) * d,
           shiver: shiverAt(glowAmp(lane.vel[i]), s, gap, STRIKE_DEPTH, lane.len) };
}

/* ---- geometry in the lane's (y, z) plane: origin = the strike contact point on the
   tube's front surface's axis height; the tube axis at z = 0, hanger at y = HANG + STRIKE_DEPTH ---- */
export const PIVOT = { y: ROD, z: TUBE_R + BALL_R };
export const ballYZ = th => ({ y: PIVOT.y - ROD * Math.cos(th), z: PIVOT.z + ROD * Math.sin(th) });
/** Clearance (≥ 0 = no penetration) between the marble and the tube (a rectangle in the
    swing plane, tilted ψ about its hanger). len = tube length. */
export function clearance(th, psi, len, shiver = 0){
  const b = ballYZ(th), hy = HANG + STRIKE_DEPTH;
  // into the tube's frame: undo its tilt about the hanger (z = d·sinψ at depth d below it)
  const dy = b.y - hy, dz = b.z;
  const c = Math.cos(psi), s = Math.sin(psi);
  const ly = dy * c - dz * s, lz = dy * s + dz * c;    // render tilts the tube by rotation.x = −ψ; undo it
  const qy = Math.max(-HANG - len - ly, 0, ly + HANG);  // outside the [−HANG−len, −HANG] span
  const qz = Math.max(Math.abs(lz - shiver) - TUBE_R, 0);
  return Math.hypot(qy, qz) - BALL_R;
}
