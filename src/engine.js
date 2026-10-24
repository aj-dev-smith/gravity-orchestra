import * as THREE from 'three';

/* ============================================================
   ENGINE — the pure heart. No scene, no DOM, no audio.
   The melody is authored first; the physics is solved backward
   from it. Each pad's launch velocity is the closed-form
   ballistic solution that lands the marble on the next pad in
   exactly the note's duration. No integrator → no drift →
   audio/visual sync is structurally perfect forever.
   ============================================================ */

export const G   = new THREE.Vector3(0, -14.5, 0);   // gravity
export const UP  = new THREE.Vector3(0, .26, 0);     // marble render lift off the pad
export const UPY = new THREE.Vector3(0, 1, 0);       // world up
export const ROLL_T = 2.6;                            // seconds on the intro rail
export const DESCENT = 2.2;                           // world units/sec each track sinks (time-proportional,
                                                      // identical for every track → one upward conveyor of the
                                                      // SAME speed cancels it: marble juggles in a static band)

/* Solve the launch velocity that carries `from` to `to` in time `dt`:
   to = from + v0·dt + ½·g·dt²   ⇒   v0 = (to − from − ½·g·dt²) / dt   */
export function solveLaunch(from, to, dt){
  return to.clone().sub(from).addScaledVector(G, -.5*dt*dt).divideScalar(dt);
}

/* Analytic position along an arc: P(t) = P0 + v0·t + ½·g·t² */
export function arcPos(p0, v0, t){
  return p0.clone().addScaledVector(v0, t).addScaledVector(G, .5*t*t);
}

/* Analytic velocity along an arc: V(t) = v0 + g·t */
export function arcVel(v0, t){
  return v0.clone().addScaledVector(G, t);
}

/* Flipper pad swing. phase = now − hit time; A = impulse-scaled amplitude.
   CONTRACT: offset is exactly 0 at phase 0 — the pad arrives at rest at the
   instant of impact, so contact is honest. */
export function padOffset(phase, A){
  const W = .3 + A*.35;                                 // bigger hits telegraph longer
  const S = .1;                                         // stroke time
  if (phase < -W || phase > .6) return 0;
  if (phase < -S){                                      // wind-up: ease into retraction
    const u = (phase + W) / (W - S);
    return -A * u*u;
  }
  if (phase < 0){                                       // the stroke: swing hard into contact
    const u = (phase + S) / S;
    return -A * (1 - u*u*u);
  }
  return A * .33 * Math.sin(phase*16) * Math.exp(-phase*8);  // follow-through wobble
}

/* Recirculating belt phase. Maps absolute songTime to a CENTERED phase for a
   pad whose strike happens at `strikeTime` within each loop of `period`:
   c = 0 exactly at every strike (and every strike + k·period), negative just
   before (pad still rising toward the band), positive just after (risen above).
   c ∈ [−period/2, period/2), so the wrap from +period/2 to −period/2 is a jump
   from far-above-band to far-below-band — off-screen, hence invisible. This is
   what lets pads stream upward forever with no global loop snap. Pure. */
export function beltPhase(songTime, strikeTime, period){
  const half = period / 2;
  return (((songTime - strikeTime + half) % period) + period) % period - half;
}

/* Smoothstep on [e0,e1], clamped. The easing vocabulary for render choreography. */
function smoothstep(e0, e1, x){
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/* Deploy envelope for a pad's entrance/exit on the belt. Pure fn of the centered
   belt phase `c`: how far the pad has unfolded from STOWED (flat & flush on the
   belt) to DEPLOYED (tilted to its catch normal, telescoped forward).
     `inner` — |c| at/inside which the pad is fully deployed (the working band).
     `edge`  — |c| at which the pad first appears, flat & retracted.
   Returns {extend, tilt}, each in [0,1], SEQUENCED: the arm extends to reach
   first, THEN the disc tips into position — so the unfold reads as a real
   mechanism, not a single blended pop. Both are 0 at the edge and 1 within the
   band, so the entire strike region is rock-solid and only the screen-edge
   thirds animate (subtle by construction — it never steals the marble's show). */
export function deployPose(c, inner, edge){
  const u = smoothstep(edge, inner, Math.abs(c));   // 0 at the appear edge → 1 inside the band
  return {
    extend: smoothstep(0,   .55, u),                // telescope out over the first ~55%
    tilt:   smoothstep(.45, 1,   u),                // then tip up over the last ~55% (slight overlap)
  };
}

/* ============================================================
   DRIBBLE — the marble drum machine's solve. One immortal
   ball per drum, and it only ever bounces on THAT drum: the
   vertical flight between two strikes is the solved arc for the
   gap (apex = |G|·gap²/8 — the belt's dt² grammar, so the groove
   is readable as bounce height). Lanes never interact, so there
   is no allocator, no feed, no plumbing: polyphony is free and
   conservation is automatic.

   A gap longer than dtMax can't be flown honestly (the apex would
   leave the screen), so above every drum hangs an ELECTROMAGNET at
   exactly the max apex H = |G|·dtMax²/8. The ball flies the max arc,
   reaches the magnet AT its apex with zero velocity (a kiss, not a
   slam), is held, and is released dtMax/2 before the next strike —
   the free fall from H takes exactly that long. So a long gap is
   just the max arc with a pause at the top: continuous, no snap.

   The bounce is not elastic — each strike's out-speed is set by the
   NEXT gap, not the last — and a real bounce is lossy anyway. The
   drumhead rides a PISTON that supplies the difference every strike
   (a kick up, harder before a taller arc; a soft give when even the
   lossy bounce would overshoot): dribblePiston. That visible cause is what keeps
   it honest, same as the belt's flipper pads.

   Pure schedule math in ONE dimension (height above the head), no
   THREE: the render places the lane in the world. Time is the only
   state. */
const g = -G.y;                                          // |gravity| (scalar — the dribble is 1-D)

export function dribbleLane(strikes, P, { dtMax = 1.2 } = {}){
  const wrapP = s => ((s % P) + P) % P;                 // pickup fills keep negative beats — wrap them in
  const s = [...new Set(strikes.map(wrapP))].sort((a, b) => a - b);
  const n = s.length;
  const gaps = s.map((si, i) => (i + 1 < n ? s[i + 1] : s[0] + P) - si);   // cyclic: the last gap closes the seam
  const flight = gaps.map(gp => Math.min(gp, dtMax));   // the airborne part of each gap
  return {
    s, gaps, P, dtMax, H: g * dtMax * dtMax / 8,
    vOut: flight.map(f => g * f / 2),                    // launch speed leaving strike i
    vIn:  flight.map((_, i) => g * flight[(i - 1 + n) % n] / 2),   // impact speed arriving at strike i
  };
}

/* Index of the strike that most recently happened at wrapped time τ (binary search). */
function lastStrike(s, tau){
  let lo = 0, hi = s.length - 1;
  if (tau < s[0]) return hi;                             // before the first strike → the last one (previous loop)
  while (lo < hi){ const m = (lo + hi + 1) >> 1; if (s[m] <= tau) lo = m; else hi = m - 1; }
  return lo;
}

/* The ball at songTime t. `start` is when the song started (the count-in): until the
   lane's first strike after it, the ball hangs ARMED on its magnet, then drops onto the
   downbeat — so every song opens with the whole machine loaded and waiting.
   Returns { y, vy, mode:'arc'|'hold'|'drop', i, since, until }: y = height of the
   ball's underside above the head; i = the strike it last left; since/until = time
   from the last strike / to the next. */
export function dribbleAt(L, t, start = -Infinity){
  const { s, gaps, P, dtMax, H } = L, half = dtMax / 2;
  if (t < start) t = start;
  const first = firstStrike(L, start);                  // armed until the lane's first strike after `start`
  if (t < first){
    const until = first - t;
    if (until > half) return { y: H, vy: 0, mode: 'hold', i: -1, since: Infinity, until };
    const f = half - until;                               // time spent falling from the magnet
    return { y: H - .5 * g * f * f, vy: -g * f, mode: 'drop', i: -1, since: Infinity, until };
  }
  const tau = ((t % P) + P) % P;
  const i = lastStrike(s, tau);
  const since = ((tau - s[i]) % P + P) % P, gap = gaps[i], until = gap - since;
  if (gap <= dtMax){                                     // a plain solved arc: v0 = g·gap/2, lands at gap
    const v0 = g * gap / 2;
    return { y: v0 * since - .5 * g * since * since, vy: v0 - g * since, mode: 'arc', i, since, until };
  }
  if (since < half){                                     // rise to the magnet, arriving at zero velocity
    const v0 = g * half;
    return { y: v0 * since - .5 * g * since * since, vy: v0 - g * since, mode: 'arc', i, since, until };
  }
  if (until > half) return { y: H, vy: 0, mode: 'hold', i, since, until };
  const f = half - until;                                // released: free fall, lands exactly at the strike
  return { y: H - .5 * g * f * f, vy: -g * f, mode: 'drop', i, since, until };
}

/* The drumhead's piston travel at songTime t — the visible force behind every bounce.
   A real marble on a real head is NOT elastic: it keeps only `e` of its speed (the
   coefficient of restitution). So every strike the piston must supply what the bounce
   alone can't: Δv = vOut − e·vIn. Positive (almost always) = a kick up through contact,
   bigger for heavier arcs; negative = the next arc is so much shorter that even a lossy
   bounce overshoots, so the head reaches up and gives with the ball, catching it like an
   egg. Each strike contributes a padOffset-shaped envelope (wind-up → stroke →
   follow-through) scaled by k·Δv.
   CONTRACT: exactly 0 at every strike — contact is honest (padOffset's contract).
   `maxA` clamps the travel. During the armed count-in the ball falls from the magnet,
   so the first strike's vIn is the full drop speed. */
export function dribblePiston(L, t, { e = .6, k = .08, maxA = .45, start = -Infinity } = {}){
  const { s, gaps, P, vIn, vOut, dtMax } = L, n = s.length;
  const first = firstStrike(L, start);
  const vin = (i, armed) => armed ? g * dtMax / 2 : vIn[i];   // the armed drop lands at full speed
  const amp = (i, armed) => Math.max(-maxA, Math.min(maxA, k * (vOut[i] - e * vin(i, armed))));
  if (t < first){                                        // count-in: only the first strike's wind-up
    const i = s.indexOf(((first % P) + P) % P);
    return windup(t - first, amp(i, true), first - start, vin(i, true));
  }
  // between strike i (just left) and strike j (next): i's follow-through + j's wind-up,
  // each squeezed to fit inside THIS gap, so dense runs never bleed across a contact
  const tau = ((t % P) + P) % P;
  const i = lastStrike(s, tau), j = (i + 1) % n, gap = gaps[i];
  const since = ((tau - s[i]) % P + P) % P;
  const armedI = Math.abs((t - since) - first) < 1e-6;
  return follow(since, amp(i, armedI), gap) + windup(since - gap, amp(j, false), gap, vin(j, false));
}

/* padOffset's wind-up/stroke, compressed to fit `room` and signed: c ≤ 0 is time to
   the strike. A > 0 retracts then strokes UP through contact (a kick); A < 0 reaches up
   then gives DOWN into contact (a catch). Exactly 0 at c = 0 and at c = −room.
   A catch reaches up INTO the falling ball's path, so its reach is capped by the ball's
   arrival speed `vi`: the head's stroke (slope ≈ 3|A|/S) must stay slower than the ball,
   or the head would rise through it. A kick retracts away from the ball — no cap. */
function windup(c, A, room, vi){
  if (c > 0 || Math.abs(A) < 1e-4) return 0;
  const W = Math.min(.3 + Math.abs(A) * .35, room * .6), S = Math.min(.1, W * .5);
  if (A < 0) A = Math.max(A, -.3 * vi * S);
  if (c < -W) return 0;
  if (c < -S){ const u = (c + W) / (W - S); return -A * u * u; }
  const u = (c + S) / S; return -A * (1 - u * u * u);
}
/* padOffset's follow-through wobble, tapered to exactly 0 by `room` (the next strike). */
function follow(c, A, room){
  if (c < 0 || c >= room || Math.abs(A) < 1e-4) return 0;
  const taper = (1 - c / room) ** 2;
  return A * .33 * Math.sin(c * 16) * Math.exp(-c * 8) * taper;
}

/* The lane's first strike at or after `start`, in absolute time (−∞ start → −∞: no count-in). */
export function firstStrike(L, start){
  if (!isFinite(start)) return -Infinity;
  if (L._fsStart === start) return L._fs;               // memo: called every frame per trail sample
  const { s, P } = L;
  let first = Infinity;
  for (const si of s){ const a = si + Math.ceil((start - si) / P) * P; if (a < first) first = a; }
  L._fsStart = start; L._fs = first;
  return first;
}

/* Note name → frequency (Hz). Sharps only, e.g. F#5, A3. */
const NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
export function noteHz(n){
  const m = n.match(/^([A-G]#?)(\d)$/);
  return 440 * Math.pow(2, (NAMES.indexOf(m[1]) - 9)/12 + (+m[2] - 4));
}
/* Note name → absolute semitone (MIDI: C4=60). Register, for size encoding. */
export function noteNum(n){
  const m = n.match(/^([A-G]#?)(\d)$/);
  return NAMES.indexOf(m[1]) + 12 * (+m[2] + 1);
}

/* ---- pad size encodes register (smaller = higher, like real resonators) ----
   A pad's size is a PURE FUNCTION OF ITS NOTE — same note, same size, always.
   It never depends on layout/spacing (that would imply the physics of sounding
   the note changed with context, which is a lie). Crowding is solved by placing
   the pads apart (the belt's lanes: juggle.js LANE_D, NUDGE), never by shrinking them. */
export const PITCH_AMP = .28;          // ± size swing across a voice's own range
export const PAD_R     = .58;          // pad world radius at scale 1 (rim outer edge)

/* register → size multiplier within a voice's [loN, span] note range */
export function pitchSize(note, loN, span){
  return 1 + PITCH_AMP * (1 - 2 * (noteNum(note) - loN) / span);
}

/* Base pad scale per voice — bass pads read heavier, alto lighter. The ONE
   source of truth: the belt sizes every tone-plate from this (juggle.js:
   padRadius → each plate's scale). */
export const voiceScale = role => role === 'bass' ? 1.4 : (role === 'alto' ? .85 : 1);

/* A track's pad radius as a pure function of the note: base voice scale × the
   register size, in world units. radOf(note) → radius, layout-invariant. */
export function padRadius(notes, role){
  const nums = notes.map(([note]) => noteNum(note));
  const loN = Math.min(...nums), span = Math.max(1, Math.max(...nums) - loN);
  return note => PAD_R * voiceScale(role) * pitchSize(note, loN, span);
}
