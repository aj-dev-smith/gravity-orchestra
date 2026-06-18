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
   the note changed with context, which is a lie). Overlap is solved by spacing
   the pads apart, never by shrinking them. */
export const PITCH_AMP = .28;          // ± size swing across a voice's own range
export const PAD_R     = .58;          // pad world radius at scale 1 (rim outer edge)
export const CLEAR     = 1.06;         // neighbours kept ≥ (r_a+r_b)·CLEAR apart

/* register → size multiplier within a voice's [loN, span] note range */
export function pitchSize(note, loN, span){
  return 1 + PITCH_AMP * (1 - 2 * (noteNum(note) - loN) / span);
}

/* Base pad scale per voice — bass pads read heavier, alto lighter. The ONE
   source of truth: buildTrack and the overlap test both size pads from this,
   so the no-overlap guarantee can't drift out of sync with the geometry. */
export const voiceScale = role => role === 'bass' ? 1.4 : (role === 'alto' ? .85 : 1);

/* A track's pad radius as a pure function of the note: base voice scale × the
   register size, in world units. radOf(note) → radius, layout-invariant. */
export function padRadius(notes, role){
  const nums = notes.map(([note]) => noteNum(note));
  const loN = Math.min(...nums), span = Math.max(1, Math.max(...nums) - loN);
  return note => PAD_R * voiceScale(role) * pitchSize(note, loN, span);
}

/* Lay out a track's pad chain. Positions are AUTHORING (ΔP), not physics:
   gravity is one global constant and is NEVER touched here. The vertical drop
   is locked to dt·2.2 so parallel tracks fall in sync (and apex height stays =
   duration); every bit of extra room for fast runs comes out of the horizontal
   axis. radOf(note) → world radius (pure fn of the note); the horizontal step
   is widened until neighbours clear by (r_i + r_{i+1})·clear. */
export function layoutPads(melody, { zBase, isBass, delayBeats = 0, beat, radOf, clear = CLEAR }){
  const pads = []; let t = 0;
  let p = new THREE.Vector3(0, -DESCENT * delayBeats * beat, zBase), dir = isBass ? -1 : 1;
  melody.forEach(([note, beats], i) => {
    const dt = beats * beat;
    pads.push({ pos: p.clone(), note, dt, t, r: radOf(note) });
    t += dt;
    if (i % 4 === 3) dir *= -1;                          // weave
    const next = melody[i+1];
    const y = -dt * DESCENT;                             // time-proportional drop — LOCKED (track sync)
    const z = Math.sin(i * (isBass ? 1.1 : 1.3)) * (isBass ? 1.0 : 1.4);
    const need = next ? (radOf(note) + radOf(next[0])) * clear : 0;
    const xMin = Math.sqrt(Math.max(0, need*need - y*y - z*z));   // widen x until they clear
    const x = dir * Math.max(0.9 + dt * 2.0, xMin);
    p = p.clone().add(new THREE.Vector3(x, y, z));
  });
  // The weave folds x back every 4 notes, so a pad can still drift near a
  // NON-neighbour (i vs i+2). Relax those out: push the lower pad sideways only
  // — y is locked (sync) and size is sacred, so all clearance comes from the
  // horizontal plane. Pad 0 is pinned (it's never the lower index of a pair).
  for (let pass = 0; pass < 80; pass++){
    let moved = false;
    for (let i = 0; i < pads.length; i++){
      for (let j = i + 1; j < pads.length; j++){
        const a = pads[i].pos, b = pads[j].pos, need = (pads[i].r + pads[j].r) * clear;
        if (a.distanceTo(b) >= need) continue;
        const dy = b.y - a.y;                            // fixed — we never move vertically
        const hx = b.x - a.x, hz = b.z - a.z;
        let hlen = Math.hypot(hx, hz), ux, uz;
        if (hlen < 1e-6){ ux = 1; uz = 0; hlen = 0; }    // coincident in-plane → pick an axis
        else { ux = hx / hlen; uz = hz / hlen; }
        const push = Math.sqrt(Math.max(0, need*need - dy*dy)) - hlen;  // exact horizontal clearance
        if (push <= 0) continue;
        b.x += ux * push; b.z += uz * push;              // move the lower pad clear of the upper
        moved = true;
      }
    }
    if (!moved) break;
  }
  return pads;
}
