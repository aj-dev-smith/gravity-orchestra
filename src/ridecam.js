/* RIDE THE BALL — the Pipe Dream shot, solved up front (pure: no THREE, no DOM).

   Every arc is analytic, so the marble's whole future is known: the camera can sit just
   BEHIND it on its own path (where it was LAG s ago) and look where it is going (LOOK s
   ahead). Nothing is integrated and nothing is remembered — the pose is a pure function
   of songTime over a path sampler `path(t) → [x, y, z]` (main: one belt ball, juggle.js ballAt),
   so scrubbing is exact and the shot replays identically every loop.

   COMFORT (no nausea) is designed into the math, not clamped after it:
     • positions are low-passed (a triangle kernel ±SM s) — the bounce at each pad is a
       soft dip, never a jolt; the eye trails the SMOOTHED path, not the marble
     • the heading is the MEAN horizontal travel over ±HW s, mapped through a tanh onto a
       bounded yaw (±MAX_YAW off the audience axis): a zig-zag run averages out to a calm
       chase, a long traverse swings the eye in behind it — and the yaw rate is bounded by
       construction (the tests hold every catalog-shaped path under RATE rad/s)
     • the horizon never rolls; pitch follows the arc through a smoothed look-ahead
     • the eye always stays IN FRONT of the marble's own plane (≥ ZMIN toward the audience):
       the belt's machine, its housings and the crane's lane all live behind/under that
     • a directed ride EASES in and out of a wider chase framing (EASE s each end), so the
       cut lands on a readable shot and the dolly-in is the move, not a lurch
   The director picks rides SPARINGLY (directorplan: CAP.ride) for long flights with a big
   apex — rideMoments() below is that input. */

export const RIDE = {
  DT_MIN: .8,          // s — a flight shorter than this is a skim, not a ride
  APEX_MIN: 1.4,       // u — …and one that barely rises isn't worth a ride either
  APEX_REF: 5.2,       // u — an apex this tall (the open run's ceiling) is the full pull
  LAG: .3,             // s — the eye sits where the (smoothed) marble was LAG ago
  LOOK: .55,           // s — and looks toward where it will be
  AIM_MIX: .45,        // aim = lerp(now, ahead, AIM_MIX)
  SM: .36,             // s — position low-pass half-width
  HW: 1.4,             // s — heading window half-width
  HSCALE: 4.5,         // u/s of mean horizontal travel → tanh(1) of MAX_YAW
  MAX_YAW: .62,        // rad (~36°) — the eye never swings further off the audience axis
  BACK: 5.6, UP: 1.7,  // the ride: this far behind / above the trailing point
  CHASE_BACK: 8.5, CHASE_UP: 3.4,   // …eased in from / out to this wider chase
  EASE: 1.2,           // s each end
  DW: .38,             // s — the look direction's low-pass half-width (the turn's own smoothing)
  ZMIN: 3.2,           // u — the eye stays at least this far in front of the marble's plane
  FOV: 62,             // a touch wider than the room lens: speed reads, the frame breathes
  KEEP: [.55, .85],    // the marble's frame offset (of the half-frame) where the aim starts leaning after it…
  KEEP_SM: .2,         // s — …measured on a lightly smoothed marble (a bounce's V never jolts the aim)
  RATE: 1.6,           // rad/s — the view direction's angular-speed budget (tests hold paths under it)
};

const N_SM = 9;                                   // kernel taps (odd)
/* triangle-weighted mean of path over [t − hw, t + hw] */
export function smoothAt(path, t, hw, n = N_SM){
  let x = 0, y = 0, z = 0, ws = 0;
  for (let i = 0; i < n; i++){
    const u = (i / (n - 1)) * 2 - 1, w = 1 - Math.abs(u) * .85;
    const p = path(t + u * hw); x += p[0] * w; y += p[1] * w; z += p[2] * w; ws += w;
  }
  return [x / ws, y / ws, z / ws];
}
const ss = u => u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u);
const lerp = (a, b, k) => a + (b - a) * k;

/* the un-turned frame at t: the trailing eye and the look-ahead aim */
function frameAt(path, t, win, o){
  const now = smoothAt(path, t, o.SM);
  const trail = smoothAt(path, t - o.LAG, o.SM);
  const ahead = smoothAt(path, t + o.LOOK, o.SM);
  const a = smoothAt(path, t - o.HW, o.SM), b = smoothAt(path, t + o.HW, o.SM);
  const vx = (b[0] - a[0]) / (2 * o.HW);           // mean horizontal travel (u/s) — across the bay
  const yaw = o.MAX_YAW * Math.tanh(vx / o.HSCALE);
  const fx = Math.sin(yaw), fz = -Math.cos(yaw);   // the forward the eye looks along (into the band)
  const u = win ? Math.min(t - win.t0, win.t1 - t) / o.EASE : 1;
  const e = ss(u);
  const back = lerp(o.CHASE_BACK, o.BACK, e), up = lerp(o.CHASE_UP, o.UP, e);
  const eye = [trail[0] - fx * back, trail[1] + up, trail[2] - fz * back];
  eye[2] = Math.max(eye[2], Math.max(now[2], trail[2]) + o.ZMIN);
  const aim = [lerp(now[0], ahead[0], o.AIM_MIX), lerp(now[1], ahead[1], o.AIM_MIX), lerp(now[2], ahead[2], o.AIM_MIX)];
  return { eye, aim };
}

/* The ride pose at songTime t. win = {t0, t1} (a directed shot: ease in/out of the chase)
   or null (the manual RIDE mode: always tight); aspect = the frame's (keeps the marble in it).
   Returns {eye, aim, fov} (plain arrays). */
export function ridePose(path, t, win = null, o = RIDE, aspect = 1.5){
  const { eye, aim: aim0 } = frameAt(path, t, win, o);
  const D = Math.hypot(aim0[0] - eye[0], aim0[1] - eye[1], aim0[2] - eye[2]);
  // THE TURN, LOW-PASSED: the look direction is the triangle-weighted mean of the frame's own
  // directions over ±DW s — a launch straight up or a reversal at a pad turns the camera over
  // ~2·DW, never in a frame (a pure fn of t still: no state, scrub-exact)
  const f = [0, 0, 0];
  for (let i = 0; i < N_DIR; i++){
    const u = (i / (N_DIR - 1)) * 2 - 1, w = 1 - Math.abs(u) * .85;
    const fr = frameAt(path, t + u * o.DW, win, o);
    const dx = fr.aim[0] - fr.eye[0], dy = fr.aim[1] - fr.eye[1], dz = fr.aim[2] - fr.eye[2], L = Math.hypot(dx, dy, dz) || 1;
    f[0] += dx / L * w; f[1] += dy / L * w; f[2] += dz / L * w;
  }
  const fl = Math.hypot(f[0], f[1], f[2]) || 1; f[0] /= fl; f[1] /= fl; f[2] /= fl;
  const aim = [eye[0] + f[0] * D, eye[1] + f[1] * D, eye[2] + f[2] * D];
  // KEEP THE MARBLE ITSELF IN FRAME: the low-passed aim can lag a hard bounce (the pad kicks
  // the marble up while the smoothed path is still coming down) — past KEEP[0] of the half-
  // frame the aim leans after it through a smooth knee (no kink, so no jolt), on both axes
  const ball = smoothAt(path, t, o.KEEP_SM, 5);
  const rl = Math.hypot(f[2], f[0]) || 1;
  const R = [-f[2] / rl, 0, f[0] / rl];                       // f × Y (horizontal: the horizon never rolls)
  const U = [R[1] * f[2] - R[2] * f[1], R[2] * f[0] - R[0] * f[2], R[0] * f[1] - R[1] * f[0]];
  const q = [ball[0] - eye[0], ball[1] - eye[1], ball[2] - eye[2]], z = q[0] * f[0] + q[1] * f[1] + q[2] * f[2];
  if (z > .5){
    const tanV = Math.tan(o.FOV * Math.PI / 360), tanH = tanV * Math.min(aspect, 1.6);
    const sv = knee((q[0] * U[0] + q[1] * U[1] + q[2] * U[2]) / (z * tanV), o.KEEP) * tanV * D;
    const sh = knee((q[0] * R[0] + q[2] * R[2]) / (z * tanH), o.KEEP) * tanH * D;
    for (let i = 0; i < 3; i++) aim[i] += U[i] * sv + R[i] * sh;
  }
  return { eye, aim, fov: o.FOV };
}
const N_DIR = 7;                                  // direction low-pass taps
/* a soft dead-zone: 0 inside k0, a quadratic knee to k1, then 1:1 past it (C¹ — no jolt) */
function knee(v, [k0, k1]){
  const x = Math.abs(v), s = Math.sign(v);
  return x <= k0 ? 0 : x < k1 ? s * (x - k0) * (x - k0) / (2 * (k1 - k0)) : s * (x - (k0 + k1) / 2);
}

/* PLANNING: the flights worth a ride. flights = [{t, dt, apex, role}] (loop-local launch
   time, its duration, how far it rises above the higher of its two ends). Returns
   [{t, dt, w, role}] — w ∈ (0, 1]: an ABSOLUTE part (a tall apex is the spectacle) times a
   RELATIVE one (the loop's biggest flight — apex·√dt, so a crane hop's long carry counts —
   takes the pull; the merely-long ones fade: the director rides THE moment, not every arc). */
const spect = f => f.apex * Math.sqrt(Math.min(f.dt, 3));
export function rideMoments(flights, o = RIDE){
  const ok = flights.filter(f => f.dt >= o.DT_MIN && f.apex >= o.APEX_MIN);
  const top = Math.max(1e-6, ...ok.map(spect));
  return ok.map(f => ({ t: f.t, dt: f.dt, role: f.role,
      w: (.45 + .55 * Math.min(1, (f.apex - o.APEX_MIN) / (o.APEX_REF - o.APEX_MIN))) * (spect(f) / top) ** 2 }))
    .sort((x, y) => x.t - y.t);
}

/* the directed ride window at loop-local time now (wins = planEdit().rides) */
export function rideWindowAt(wins, now){
  for (const w of wins) if (now >= w.t0 && now < w.t1) return w;
  return null;
}
