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

/* Note name → frequency (Hz). Sharps only, e.g. F#5, A3. */
const NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
export function noteHz(n){
  const m = n.match(/^([A-G]#?)(\d)$/);
  return 440 * Math.pow(2, (NAMES.indexOf(m[1]) - 9)/12 + (+m[2] - 4));
}
