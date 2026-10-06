/* ============================================================
   SINGING BOWLS — pure timing/physics (no THREE scene, no DOM, no audio).

   The one sustained voice. Every pitch owns ONE bowl and ONE marble that
   never leaves it (the dribble lesson: lanes never interact). A note is
   held by the marble ROLLING AROUND THE INSIDE OF THE BOWL just under the
   rim — the rim-rubbed wine glass — for exactly the note's duration.

   THE ORBIT (conical-pendulum balance). The inner wall is a sphere of
   radius Rb. A ball (radius rb) whose centre rides the sphere Rc = Rb − rb
   at polar angle θ (measured from the bottom) sits at horizontal radius
   r = Rc·sinθ, and the wall's slope there is θ. The wall's push is along
   the normal through the ball's centre, so it balances gravity and
   supplies the centripetal force exactly when
                    v² = g·r·tanθ        (ω² = g / (Rc·cosθ))
   We pick θ from the geometry (a band just under the rim) and solve ω.
   The ball circles at that constant speed for the whole note — a free,
   self-sustaining orbit, nothing pushing it.

   THE ROTOR (the visible cause of every change of motion). Over each
   bowl hangs a motor with a vertical spindle and a radial arm whose tip
   carries an electromagnet; the marble hangs from it at rest between
   notes. To START a note the rotor spins up while high (clear of the
   rim), reaches exactly ω, then lowers the marble straight down at
   radius r — a smoothstep, so it arrives with ZERO vertical speed and
   exactly the orbit's tangential speed — and lets go the instant it
   touches the wall: the strike. The magnet then lifts away, spins down,
   and (knowing the future) re-positions so that it can spin back up,
   phase-lock over the rolling ball, descend onto it, and PLUCK it off the
   wall at the note-off instant, again with matched velocity. It carries
   the ball up, spins down, and swings home. A short note keeps the rotor
   hovering in sync above the free ball instead of spinning down.

   So the ball's motion is C¹ everywhere (no velocity jump at hand-off),
   it never penetrates the wall, the empty magnet only ever descends onto
   the ball phase-locked to it, and everything is a closed-form function
   of songTime. Time is the only state.
   ============================================================ */
import { G, noteNum } from '../../engine.js';
import { laneClock, at, lastIndex, wrapP, smooth } from '../clock.js';

export const g = -G.y;                                   // |gravity| = 14.5

// ---- geometry knobs ----
export const THETA_RIM = 1.32;                           // inner rim edge, polar angle from the bottom (≈76°: a flared singing-bowl lip)
export const THETA_ORB = 1.20;                           // the orbit band (≈69°) — the ball rides AT the rim: its top shows above the lip

// ---- the sound a held note can carry (voice.js renders a rubbed tone that holds this
// long, then dies away). The orbit is clamped to it, so the rotor plucks the ball off
// exactly when the sound releases — the visible cause never outlives the sound. ----
export const HOLD_MAX = 5.0;      // longest single orbit per note (s)
export const SOUND_MAX = 5.5;     // the voice holds full this long (a merged re-strike may stretch a note's sound to here)
// the (2,0) wine-glass mode: the RUBBING point is a radial NODE (the wall doesn't move
// under the ball); the radial antinodes sit ±45° from it.
export const RIM_NODE = Math.PI / 4;
export const rimMode = (ang, phiBall) => Math.cos(2 * (ang - phiBall - RIM_NODE));

// ---- rotor choreography (seconds) ----
export const D_LOWER = .34;          // lower / lift time (synced, at ω)
export const S_SPIN  = .5;           // spin-up / spin-down time (while high)
export const R_MIN   = .5;           // minimum return-home time between sessions (scaled with compression)
export const R_HOME  = 1.1;          // nominal return-home swing
export const MERGE   = .9;           // notes on one bowl closer than this (s) → one continuous orbit
export const M_MIN   = .8;           // a note needs this much free time mid-orbit for the rotor to spin down
export const MIN_GAP = 1.0;          // a lone loop-long note leaves at least this much off-time per loop
export const HOME    = -Math.PI / 2; // home angle: the arm points at the audience (+z)

const TAU = Math.PI * 2;
/* how long one note can hold the ball on the rim (≥ .3 s so it reads, ≤ what the voice sustains) */
export const holdDur = (d, P) => Math.min(Math.max(d || 0, .3), HOLD_MAX, P - MIN_GAP);
const wrapPi = a => a - TAU * Math.round(a / TAU);       // → (−π, π]
const sm = x => { const u = Math.min(1, Math.max(0, x)); return u * u * (3 - 2 * u); };
const smd = x => (x <= 0 || x >= 1) ? 0 : 6 * x * (1 - x);   // d/dx smoothstep

/* Angular ramp: speed goes w0 → w1 over `dur` along a smoothstep; returns the angle
   travelled after x seconds (closed-form integral: ∫ smoothstep = u³ − u⁴/2). */
export function rampAngle(x, dur, w0, w1){
  if (dur <= 0) return 0;
  const u = Math.min(1, Math.max(0, x / dur));
  return dur * (w0 * u + (w1 - w0) * (u * u * u - u * u * u * u / 2));
}
export function rampSpeed(x, dur, w0, w1){
  if (dur <= 0) return w1;
  const u = Math.min(1, Math.max(0, x / dur));
  return w0 + (w1 - w0) * u * u * (3 - 2 * u);
}

/* ---- one bowl's geometry: a PURE FUNCTION OF THE NOTE (bigger = lower). ----
   Bowl-local frame: axis at x = z = 0, y = 0 = underside of the foot. */
export function bowlGeom(note){
  const n = noteNum(note);
  const rimR = Math.min(1.75, Math.max(.45, 1.3 * Math.pow(2, -(n - 48) / 24)));   // C3 1.3 · C4 .92 · C5 .65
  const Rb = rimR / Math.sin(THETA_RIM);                 // inner sphere radius
  const wall = .045 + .045 * Rb;                         // shell thickness
  const foot = .07 + .05 * Rb;                           // solid base under the bowl's floor
  const cy = foot + Rb;                                  // sphere centre height
  const rb = Math.max(.08, .15 * Rb);                    // marble radius
  const Rc = Rb - rb;                                    // the sphere the ball's centre rides
  const r = Rc * Math.sin(THETA_ORB);                    // orbit radius (ball centre)
  const yo = cy - Rc * Math.cos(THETA_ORB);              // orbit height (ball centre)
  const rimY = cy - Rb * Math.cos(THETA_RIM);            // inner rim edge height
  const v = Math.sqrt(g * r * Math.tan(THETA_ORB));      // conical-pendulum balance
  const omega = v / r;
  const hoverY = rimY + rb + .22 + .25 * rimR;           // ball centre while parked: clear above the rim
  // rolling without slipping on the wall: contact velocity = 0 with the orbit's own yaw
  // (ω about +y) plus the ball's spin about (v̂ × n̂) → spin rate ω·(r/rb + sinθ)
  const spin = omega * (r / rb + Math.sin(THETA_ORB));
  return { note, n, rimR, Rb, wall, foot, cy, rb, Rc, r, yo, rimY, v, omega, hoverY, lift: hoverY - yo, spin };
}

/* ---- a lane: one bowl's notes → rotor SESSIONS (each = one continuous orbit) ----
   notes: [{t, tDur, vel}] loop-local seconds. Notes closer than MERGE merge into one
   orbit (each still re-strikes the sound). The hand-off choreography around each
   session is compressed, per gap, so dense lanes still fit (k ≤ 1). */
export function bowlLane(notes, P, geom){
  const om = geom.omega;
  const REQ = 2 * (D_LOWER + S_SPIN) + R_MIN;
  const iv = notes.map(n => {
    const on = wrapP(n.t, P);
    const dur = holdDur(n.tDur, P);
    return { on, off: on + dur };
  }).sort((a, b) => a.on - b.on);

  // merge (linear), then close the loop seam
  let ses = [];
  for (const x of iv){
    const last = ses[ses.length - 1];
    if (last && x.on - last.off < MERGE) last.off = Math.max(last.off, x.off);
    else ses.push({ ...x });
  }
  while (ses.length > 1){
    const first = ses[0], last = ses[ses.length - 1];
    if (first.on + P - last.off >= MERGE) break;
    last.off = Math.max(last.off, first.off + P);
    ses.shift();
  }
  for (const s of ses) s.off = Math.min(s.off, s.on + P - MIN_GAP);   // a drone still breathes once a loop

  const n = ses.length;
  const kAfter = ses.map((s, i) => {
    const nx = ses[(i + 1) % n];
    const gap = (i + 1 < n ? nx.on : nx.on + P) - s.off;
    return Math.max(.05, Math.min(1, gap / REQ));
  });
  // Where each session's spin-up starts. After a roomy gap the rotor swings HOME (arm
  // toward the audience) during the rest; after a tight one it mostly stays parked
  // where the last pick-up left it. If NO gap is roomy, the chain still has to close
  // over the loop (periodic!), so the leftover angle is shared across every rest,
  // in proportion to its length. All angles shift additively with psi0, so two
  // passes suffice.
  const REQ_HOME = 2 * (D_LOWER + S_SPIN) + R_HOME;
  const gapBefore = ses.map((s, i) => { const pv = ses[(i - 1 + n) % n]; return (i ? s.on : s.on + P) - pv.off; });
  let root = 0;
  gapBefore.forEach((gp, i) => { if (gp > gapBefore[root]) root = i; });
  const roomy = gapBefore.map(gp => gp >= REQ_HOME);
  const make = (i, psi0) => {
    const s = ses[i];
    const kPre = kAfter[(i - 1 + n) % n], kPost = kAfter[i];
    const Dp = D_LOWER * kPre, Sp = S_SPIN * kPre, Dq = D_LOWER * kPost, Sq = S_SPIN * kPost;
    const dur = s.off - s.on;
    const onR = Sp + Dp, offR = onR + dur;
    const phiOn = psi0 + om * (Sp / 2 + Dp);
    const free = dur - 2 * (D_LOWER + S_SPIN) >= M_MIN;
    const S = { on: s.on, off: s.off, dur, c0: wrapP(s.on - Sp - Dp, P), Dp, Sp, Dq, Sq, onR, offR, psi0, phiOn, free, homeDelta: 0 };
    if (free){
      const phi = u => phiOn + om * (u - onR);
      S.a1 = onR + D_LOWER + S_SPIN; S.b1 = offR - D_LOWER - S_SPIN;
      S.psiC = phi(onR + D_LOWER) + om * S_SPIN / 2;
      S.delta = wrapPi(phi(offR - D_LOWER) - om * S_SPIN / 2 - S.psiC);
    }
    S.psiD = phiOn + om * (dur + Dq) + om * Sq / 2;
    return S;
  };
  const rest = gapBefore.map((gp, i) => Math.max(1e-3, gp - 2 * (D_LOWER + S_SPIN) * kAfter[(i - 1 + n) % n]));
  const chain = sw => {                                  // sw[i] = extra swing during the rest BEFORE session i
    const out = new Array(n);
    let prev = null;
    for (let q = 0; q < n; q++){
      const i = (root + q) % n;
      let psi0 = HOME;
      if (q > 0){
        psi0 = roomy[i] ? prev.psiD + wrapPi(HOME - prev.psiD) : prev.psiD + sw[i];
        prev.homeDelta = psi0 - prev.psiD;
      }
      prev = out[i] = make(i, psi0);
    }
    prev.homeDelta = wrapPi(HOME - prev.psiD);           // the last rest closes the loop
    return out;
  };
  let out = chain(new Array(n).fill(0));
  if (!roomy[root]){
    const lastI = (root + n - 1) % n, mm = wrapPi(HOME - out[lastI].psiD);
    const tot = rest.reduce((a, b) => a + b, 0);
    out = chain(rest.map(r => mm * r / tot));
    out[lastI].homeDelta = wrapPi(HOME - out[lastI].psiD);
  }
  out.sort((a, b) => a.c0 - b.c0);
  const c0s = out.map(s => s.c0);
  let cum = 0;
  out.forEach((s, i) => {
    s.W = n === 1 ? P : wrapP(c0s[(i + 1) % n] - s.c0, P) || P;
    s.cum = cum; cum += s.dur;                          // orbit time rolled before this session (per loop)
  });
  return { geom, P, sessions: out, c0s, rollT: cum, rollBase: new Map() };
}

const HOME_POSE = (geom) => ({ attached: true, orbiting: false, angle: HOME, omegaR: 0, lift: geom.lift,
  phiBall: HOME, sinceOn: Infinity, sinceOff: Infinity, armed: true, roll: 0 });

/* The marble's accumulated rolling angle (rad about its spin axis) is a pure fn of the
   total orbit time since the first live session — it only turns while it rolls on the
   wall and is frozen while the magnet holds it, so its orientation is continuous. */
function rollBase(L, start){
  if (L.rollBase.has(start)) return L.rollBase.get(start);
  const { c0s, P, sessions } = L;
  let b = 0;
  if (sessions.length && isFinite(start)){
    const ts = wrapP(start, P);
    let k = c0s.findIndex(c => c >= ts - 1e-9); if (k < 0) k = 0;
    const s1 = start + wrapP(c0s[k] - ts, P);
    const m = Math.round((s1 - c0s[k]) / P);
    b = m * L.rollT + sessions[k].cum;
  }
  L.rollBase.set(start, b);
  return b;
}

/* The rotor + ball at songTime t. Before the lane's first session after `start` (the
   count-in) — or in any session whose spin-up began before `start` — the rotor sits
   ARMED at home, marble hanging from the magnet. Returns
     { attached, orbiting, angle (rotor), omegaR, lift (hub above its low stop),
       phiBall, x, y, z (ball centre, bowl-local), sinceOn, sinceOff, armed } */
export function bowlAt(L, t, start = -Infinity){
  const { geom, sessions, c0s, P } = L;
  if (t < start) t = start;
  let st;
  if (!sessions.length) st = HOME_POSE(geom);
  else {
    const tau = wrapP(t, P);
    const k = lastIndex(c0s, tau);
    const u = wrapP(tau - c0s[k], P);
    if (t - u < start - 1e-9) st = HOME_POSE(geom);
    else {
      const S = sessions[k];
      st = evalSession(S, u, geom);
      const m = Math.round((t - u - c0s[k]) / P);
      const rolled = m * L.rollT + S.cum + Math.min(S.dur, Math.max(0, u - S.onR));
      st.roll = (rolled - rollBase(L, start)) * geom.spin;
    }
  }
  const a = st.orbiting ? st.phiBall : st.angle;
  const y = geom.yo + (st.orbiting ? 0 : st.lift);
  st.x = geom.r * Math.cos(a); st.y = y; st.z = -geom.r * Math.sin(a);
  return st;
}

function evalSession(S, u, geom){
  const om = geom.omega, Δ = geom.lift;
  const { Sp, Dp, Dq, Sq, onR, offR } = S;
  const phiBall = u2 => S.phiOn + om * (u2 - onR);
  const base = { armed: false, sinceOn: u >= onR ? u - onR : Infinity, sinceOff: u >= offR ? u - offR : Infinity };

  if (u < Sp)                                            // spin up, high, ball on the magnet
    return { ...base, attached: true, orbiting: false, angle: S.psi0 + rampAngle(u, Sp, 0, om), omegaR: rampSpeed(u, Sp, 0, om), lift: Δ, phiBall: NaN };
  if (u < onR)                                           // phase-locked at ω: lower the ball to the wall
    return { ...base, attached: true, orbiting: false, angle: phiBall(u), omegaR: om, lift: Δ * (1 - sm((u - Sp) / Dp)), phiBall: NaN };

  if (u < offR){                                         // the ball ORBITS free; the empty rotor does its own thing
    const o = { ...base, attached: false, orbiting: true, phiBall: phiBall(u), omegaR: om };
    if (!S.free){                                        // short note: hover in sync, lift up then back down
      const h = Math.min(D_LOWER, S.dur / 2);
      o.angle = phiBall(u); o.lift = Δ * Math.min(sm((u - onR) / h), sm((offR - u) / h));
      return o;
    }
    const a = u - onR;
    if (a < D_LOWER){ o.angle = phiBall(u); o.lift = Δ * sm(a / D_LOWER); return o; }
    o.lift = Δ;
    if (a < D_LOWER + S_SPIN){
      o.angle = phiBall(onR + D_LOWER) + rampAngle(a - D_LOWER, S_SPIN, om, 0);
      o.omegaR = rampSpeed(a - D_LOWER, S_SPIN, om, 0); return o;
    }
    if (u < S.b1){                                       // re-position (knowing the future) for the pick-up
      const M = S.b1 - S.a1, x = (u - S.a1) / M;
      o.angle = S.psiC + S.delta * sm(x); o.omegaR = S.delta * smd(x) / M; return o;
    }
    if (u < offR - D_LOWER){                             // spin up so we arrive phase-locked over the ball
      o.angle = S.psiC + S.delta + rampAngle(u - S.b1, S_SPIN, 0, om);
      o.omegaR = rampSpeed(u - S.b1, S_SPIN, 0, om); return o;
    }
    o.angle = phiBall(u);                                // descend onto the ball, in sync
    o.lift = Δ * (1 - sm((u - (offR - D_LOWER)) / D_LOWER));
    return o;
  }
  if (u < offR + Dq)                                     // plucked: lift it out, still at ω
    return { ...base, attached: true, orbiting: false, angle: phiBall(u), omegaR: om, lift: Δ * sm((u - offR) / Dq), phiBall: NaN };
  if (u < offR + Dq + Sq)                                // spin down, high
    return { ...base, attached: true, orbiting: false, angle: phiBall(offR + Dq) + rampAngle(u - offR - Dq, Sq, om, 0),
             omegaR: rampSpeed(u - offR - Dq, Sq, om, 0), lift: Δ, phiBall: NaN };
  const e2 = offR + Dq + Sq, Rt = Math.max(1e-3, Math.min(R_HOME, S.W - e2)), x = (u - e2) / Rt;
  return { ...base, attached: true, orbiting: false, angle: S.psiD + S.homeDelta * sm(x),   // swing home
           omegaR: S.homeDelta * smd(x) / Rt, lift: Δ, phiBall: NaN };
}

/* ---- the NOTES (strikes + the sounding envelope) ----
   One lane clock over the bowl's note-on times. A note only "happens" if its rotor
   session started after `start` (else the rotor was still armed at home). */
export function noteLane(notes, P, lane){
  const L = laneClock(notes.map(n => n.t), P);
  const rec = L.s.map(s => {
    const same = notes.filter(n => Math.abs(wrapP(n.t, P) - s) < 1e-6);
    const dur = Math.max(...same.map(n => n.tDur || 0)), vel = Math.max(...same.map(n => n.vel ?? 1));
    // lead = time from this note's session spin-up start to the note (for the count-in check)
    let lead = Infinity, ses = null;
    for (const S of lane.sessions){
      const d = wrapP(s - (S.on - S.onR), P);
      if (d >= S.onR - 1e-6 && d <= S.offR + 1e-6 && d < lead){ lead = d; ses = S; }
    }
    return { s, dur: holdDur(dur, P), vel, lead: isFinite(lead) ? lead : 0, ses };
  });
  // The SOUND covers the orbit: a note's sound lasts until the next note-on in the same
  // orbit (a merged re-strike retriggers on top), and never past the pluck.
  const n = rec.length;
  rec.forEach((r, i) => {
    if (!r.ses) return;
    const left = r.ses.offR - r.lead;                   // time from this note to the pluck
    const nx = rec[(i + 1) % n], nextOn = (i + 1 < n ? nx.s : nx.s + P) - r.s;
    const sameOrbit = n > 1 && nx.ses === r.ses && nextOn <= left + 1e-6;
    r.durSnd = Math.min(left, SOUND_MAX, sameOrbit ? Math.max(r.dur, nextOn) : r.dur);
  });
  rec.forEach(r => { if ('durSnd' in r) r.dur = r.durSnd; delete r.durSnd; delete r.ses; });
  return { L, rec };
}

/* The note most recently struck at t — {i, since, abs, rec, live} (live=false if it
   belonged to a session that hadn't begun by `start`, or nothing's struck yet). */
export function noteAt(N, t, start = -Infinity){
  const c = at(N.L, t, start);
  if (c.armed) return { ...c, rec: null, live: false };
  const rec = N.rec[c.i];
  return { ...c, rec, live: c.abs - rec.lead >= start - 1e-9 };
}

/* The bowl's singing envelope (0..1, × vel): soft attack, a slight bloom through the
   sustain, natural decay after the release. Pure fn of the note just struck. */
export function singEnv(since, dur){
  if (!(since >= 0) || !isFinite(since)) return 0;
  const att = smooth(0, .14, since);
  if (since <= dur) return att * (.82 + .18 * smooth(0, 1.2, since));
  return att * Math.exp(-(since - dur) * 2.4);
}
