/* ============================================================
   IDLE — rest-pose personality (Animusic's Starship Groove robots:
   a resting machine never looks dead, and you can feel its next
   entrance coming). Shared, PURE curves; each plugin owns its own
   "where is this lane resting" window and spends these on parts whose
   motion has a visible cause (a coil's current, a ram, a key, a cable).

   THE CONTRACT (test/idle.test.js proves it for every machine):
     · a pure fn of the lane clock (`since` the rest began, `until` it
       ends) — scrub-safe, no state, no integrator
     · EXACTLY zero (value and slope) within `guard` of either end of a
       rest — so every strike, every catch, every contact pose is
       byte-identical with idle on or off
     · subtle: millimetres and a little glow, never a gesture that reads
       as a note
   No new materials, no lights: idle motion re-uses the parts and the
   emissive channels a machine already drives.
   ============================================================ */
import { smooth } from './clock.js';

/** The master switch (tests flip it to prove contact poses are untouched; a perf
    governor or a "still" mode could too). */
export const IDLE = { on: true };

/** 0 near either end of a rest, 1 well inside it. Exactly 0 for since < guard or
    until < guard (non-finite since/until = an open-ended rest: that side is 1).
    Smoothstep ramps → zero slope at the guard edges, nothing snaps. */
export function restEnv(since, until, guard = .2, ramp = .45){
  if (!IDLE.on) return 0;
  if (!(since >= guard) || !(until >= guard)) return 0;
  const a = since === Infinity ? 1 : smooth(guard, guard + ramp, since);
  const b = until === Infinity ? 1 : smooth(guard, guard + ramp, until);
  return a * b;
}

/** Anticipation: 0 while `until` ≥ lead, rising (smoothstep) to 1 as `until` falls
    to `at`. Glow-only uses may keep it up to the strike; MOTION uses must multiply
    by a restEnv (which owns the zero-at-contact guarantee). */
export function anticip(until, lead = .9, at = 0){
  if (!IDLE.on || !(until >= 0)) return 0;
  return smooth(lead, at, until);
}

/** A slow sway / breath, a pure fn of songTime (phase per lane so a rank never moves in
    lock-step). */
export const sway = (t, hz, phase = 0) => Math.sin(2 * Math.PI * hz * t + phase);

/** A TWITCH train: short one-sided pulses (0..1), `hz` per second — a solenoid ticking.
    sharp = the pulse's narrowness (an even power of a sine). */
export function twitch(t, hz, phase = 0, sharp = 8){
  const s = Math.sin(Math.PI * hz * t + phase);
  return Math.pow(s * s, sharp / 2);
}
