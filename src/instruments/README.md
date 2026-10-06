# Instrument plugins — the contract

An instrument is **one folder**: `src/instruments/<key>/`. The registry
(`index.js`, a Vite glob) picks it up; **no shared file is edited to add one**.
Main runs a generic loop over every registered instrument that has a part in the
current song. Read CLAUDE.md §2–§4 first (time is the only state; visuals drive
audio; a hit = a target + a launch solve) and study `src/marbledrums.js`, the
reference instrument (it predates this seam, so it's wired by hand, but every
idea here was extracted from it).

## The aesthetic law

**An impossible machine that reads as real because the motion is honest.** Every
change of motion has a *visible cause* (a piston kicks, a magnet holds, a latch
releases, a string sags); contact is honest (the struck surface is exactly at rest
and exactly at the contact point at the strike); nothing teleports, pops in, or
passes through anything. The drum machine's hard-won heuristics:

- **Design for marbles, not for an acoustic original.** Real instruments are built
  for hands and sticks; copy their *sound and silhouette*, not their mechanics.
- **No plumbing.** Every failed drum design spent its complexity getting balls TO
  targets. Give each lane (one pitch / one striker) its *own conserved* ball or
  striker that only ever touches its *own* target. Lanes never interact →
  polyphony is free, conservation is automatic, no allocator.
- **Long gaps park at a physical feature** at the apex of the motion (magnet,
  latch, cradle) — arrive at zero speed, hold, release so the fall lands on the beat.
- **Real = lossy.** A bounce keeps only `e` of its speed; something visible
  supplies the difference every hit (see `dribblePiston`).
- **Pure math first** (a `solve.js` with no THREE scene, + honesty tests:
  at-rest-at-contact, no-penetration, lands-exactly-on-the-beat), then greybox,
  then juice.

## Files

    src/instruments/<key>/index.js   the descriptor (default export) — REQUIRED
    src/instruments/<key>/solve.js   pure timing/physics math — no scene/DOM/audio
    src/instruments/<key>/voice.js   pure DSP: note → {samples: Float32Array, sr}
    test/inst-<key>.test.js          vitest: solve honesty + voice sanity + demo validity

Import helpers from `../clock.js` (lane clock, strike edges, event parsing) and
`../../engine.js` (`G`, `solveLaunch`, `arcPos`, `arcVel`, `noteHz`, `noteNum`,
`dribbleLane`/`dribbleAt`/`dribblePiston`, `padOffset`…). Use `glowTex`/`envMap`
handed to `make`. **Do not edit** main.js, audio.js, engine.js, camera.js, other
instruments, or the songs — if the seam is missing something, say so in your report.

## The descriptor

```js
export default {
  key: 'marimba',                 // = folder name = song.parts key
  label: 'Marimba',
  wet: false,                     // true → voice also feeds the melody's echo
  lookHeight: 3,                  // y the station camera aims at (local)
  // optional STAGING hints (main.js syncDirector / camera.js):
  camera: { dist: 15, up: 5, x: 0 },   // the director's shot: eye at (x, lookHeight+up, dist) local
  color: '#ff8a5a',               // cam-button / shot tint
  directorWeight: 1,              // × the look-ahead score (sparse voices boost; song.director overrides)
  cameraKey: 'strings',           // the shot / cam-button key when `key` collides with a belt
                                  // role (lead / alto / bass) — the instrument keeps its key

  // PURE DSP, deterministic, no AudioContext: one render feeds BOTH the live
  // Web Audio path (AudioBuffer, gain = vel) and the iOS <audio> fallback (WAV).
  // id = an event's note field. Keep peak ≤ ~.9; keep it short (≤ ~3 s) — every
  // unique id in the song is pre-rendered on song load. sr 22050–44100.
  voice(id){ return { samples, sr }; },
  voiceIds(part){ ... },          // optional: unique ids to bake (default: unique e[1])

  make({ envMap, glowTex, THREE }){
    return {
      // Rebuild everything for a song. Return a THREE.Group in the instrument's
      // LOCAL frame (see stations.js: +x across, +y up, +z toward the audience,
      // y=0 = deck top, stay inside |x|≤w/2, |z|≤d/2). main parents it to the
      // station. The group is disposed on song change (main traverses + disposes).
      build(part, { rollT, beat, P, start, station, floorY, loopBeats }){ ... },

      // Per frame. A PURE fn of songTime (scrub-safe: ?debug can jump anywhere).
      // !started → render the ARMED pose at t = start. Fire each strike ONCE
      // (clock.js makeEdge; pass skipStrikes as `skip`). For each strike call
      //   onStrike({ note, vel, pos, color, dur, shake, sparks, light })
      // pos = Vector3 in YOUR local frame (main maps it through the station),
      // dur = seconds (sustained voices release there), shake ≈ .02–.1 for big
      // hits only, sparks = count (0 = none), light = strike-light scale (1).
      update(songTime, P, dt, { started, skipStrikes, onStrike }){ ... },
    };
  },

  // A self-demo for ?solo=<key>: loads this part on a minimal melodic spine and
  // frames the camera on the station. beats must be a multiple of 4.
  demo: { bpm: 100, beats: 16, part: [[0, 'C4'], [1, 'E4', .7], ...] },
};
```

## Timing (same as the drums)

- Song data: `song.parts[<key>] = [[beat, note, vel?, durBeats?], …]`, ABSOLUTE
  beats ∈ `[0, loopBeats)` — pinned like drums, never chained, no lock rule.
- `clock.eventTimes(part, {rollT, beat})` → events with `t = rollT + beat·b`
  (loop-local seconds). The loop period is `P`. `songTime` starts at
  `start = −LEAD_IN` (negative): strikes before `start` never happened — the
  instrument sits ARMED (loaded, waiting) until its first strike.
- `clock.laneClock(times, P)` + `clock.at(L, t, start)` → `{i, since, until, gap,
  armed, first, abs, next}`. O(log n). Don't scan every event per frame.
- Static world space. **Never** add `DESCENT`/`beltPhase` (that's only the melody
  conveyor's reframe).

## Rendering budget & juice to reuse

- No new lights (main owns a constant strike-light pool; `onStrike` throws one).
  Shader recompiles kill frames: keep material/light counts constant after build.
- Reuse the drum tricks: ghost trails re-sampled from the pure fn (no ring
  buffer), emissive flashes that decay as pure fns of `since`, membrane-ripple
  `onBeforeCompile` vertex waves, precession wobble tapered to rest by the next
  contact. Bloom (UnrealBloom .12/.3/.9) makes emissive > ~1 glow.
- Materials: chrome = `MeshStandardMaterial({metalness:1, roughness:.12–.2, envMap})`;
  dark structure `0x232733` metalness .7 rough .45. Use the palette of the room
  (deep navy, warm amber/orange glows, ice-blue) and give your instrument its own
  signature glow colour.
- Instance or share geometry when you have many identical parts; ~≤ 150 meshes
  per instrument is a comfortable ceiling.
- main OWNS two render-time passes over your built group — know them:
  - **Static merge** (src/mergestatic.js): after build, main poses your station at
    48 songTimes across the loop; every opaque, plain-material mesh whose world
    matrix and visibility never change is baked into one mesh per material (your
    references to it go dead, its MATERIAL is shared so material animation still
    works). A part that moves only at an instant the sampling could miss, or that
    you'll toggle/raycast later, sets `mesh.userData.noMerge = true`. Custom shaders
    (`onBeforeCompile`, ShaderMaterial) and transparent materials are never merged.
    `userData.frozen = true` (ricochet's own freeze) is the same idea, done in-plugin.
  - **Fade gate**: every ADDITIVE transparent non-shader material under the world
    gets `material.visible = opacity > .002` each frame (an idle glow at opacity 0
    still costs a draw call). Don't drive `material.visible` yourself on those; opt
    out with `material.userData.noFadeGate = true` (or on the object).

## Dev loop

    npm run dev -- --port <yours>
    http://localhost:<port>/?solo=<key>&debug     # your demo, camera on your station
    window.__dev.station('<key>', dist, up)       # re-frame; __dev.t = 3.2 scrubs; __dev.rate = .25
    npx vitest run test/inst-<key>.test.js
