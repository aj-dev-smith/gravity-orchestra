/* THE TRANSPORT — how songTime moves (pure; test/transport.test.js). main.js's animate is its only
   caller; everything else that sets songTime (a song build, RESTART, a scrub) just assigns it.
   · THE PLANNER GATE: a song NEVER reaches its start (songTime 0) before its belt's plan is in.
     The count-in runs while the plan is solved, and the timeline WAITS at −RUN_IN until the plan
     is in — so the belt always has at least RUN_IN to spin up. A song already past that point when
     its plan went stale (a MAP re-route keeps the time) holds where it is.
   · THE MACHINES SIT OUT THE COUNT-IN: every station, the drum kit and the room's cues are built
     with start = ARM_AT (the plugin contract: a strike before `start` never happened — a machine
     sits ARMED, loaded and waiting, until its first strike after it). ARM_AT lies in the loop's
     strike-free breath tail (every event is pinned before its last 1.2 s — juggle.js P), so nothing
     strikes before songTime 0; and a drum ball's drop from its magnet (DT_MAX/2, drumparts.js) onto
     a pickup right after 0 starts after it, so nothing hangs mid-air while the count-in waits.
   · STOP / START: a stopped song is a frozen frame (time is the only state).
   · The belt's SPIN-UP (spinTime): its count-in clock — at rest at −R, full speed (1) at songTime
     0, covering d s of the plan, all of it after the last ball docked; d ≤ R/2, so the start is
     smooth. A plan that lands mid-count-in spins up over what is left of it (spinFor). */
export const RUN_IN = 1.2, ARM_AT = -.6;

/* songTime after a frame of dt s (rate: the ?debug / XR playback rate) */
export function advance(t, dt, { playing = true, ready = true, rate = 1 } = {}){
  if (!playing || !(dt > 0)) return t;
  const next = t + dt * rate;
  return ready ? next : Math.min(next, Math.max(t, -RUN_IN));
}

/* the belt's clock: before songTime 0 its spin-up, after it songTime itself */
export function spinTime(t, { R, d }){
  if (t >= 0) return t;
  return -d * (1 - Math.max(0, 1 + t / R) ** (R / d));
}

/* the spin-up for a plan mounted at songTime t whose breath is d0 (plan time before songTime 0 with
   every ball home): the rest of the count-in (past 0 — a re-route kept mid-song — the full one,
   for the next RESTART) */
export function spinFor(t, d0, leadIn){
  const R = t < 0 ? Math.max(-t, 1e-3) : leadIn;
  return { R, d: Math.min(d0, R / 2) };
}
