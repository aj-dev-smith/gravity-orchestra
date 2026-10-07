# Instrument plugins — the contract

An instrument is **one folder**: `src/instruments/<key>/`. The registry
(`index.js`, a Vite glob) picks it up; **no shared file is edited to add one** — except ONE
`STATIONS` slot in `stations.js` (where it stands; the floor is full — see "Gallery raise" below),
and, if MIDI should route to it, the routing owner's `orchestra.js` entries (see `PART_LIMITS`).
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
  cameraKey: 'strings',           // the shot / cam-button key when `key` collides with a belt
                                  // role (lead / alto / bass) — the instrument keeps its key
  xrGlow: 1.55,                   // optional, VR: there is no bloom in a headset, so main multiplies
                                  // your emissive intensities by this (and additive opacities by a
                                  // matching factor) for the headset render only. Default 1.55; 1 = off

  // PURE DSP, deterministic, no AudioContext: one render feeds BOTH the live
  // Web Audio path (AudioBuffer, gain = vel) and the iOS <audio> fallback (WAV).
  // id = an event's note field. Keep peak ≤ ~.9; keep it short (≤ ~3 s) — every
  // unique id in the song is pre-rendered on song load (on the bank's bake budget). sr 22050–44100.
  // Its LEVEL is what plays on iOS too (the WAV keeps it — src/wavlevel.js). Memoise renders in a
  // `voiceCache()` (../voicecache.js), never a plain Map: main frees what the next song doesn't use.
  voice(id){ return { samples, sr }; },
  // optional: the unique ids to bake (default: unique e[1]). ctx = { beat, bpm, rollT, P, loopBeats }
  // (main passes the song's tempo + loop: bucket voices by a note's length in SECONDS, exactly as
  // build() will; an old caller may omit it — fall back to a superset)
  voiceIds(part, ctx){ ... },
  // SUSTAINED voices (the iOS <audio> path can't release at `dur` — it plays the whole WAV): fire a
  // DURATION BUCKET id '<base>~<hold>' (../sustain.js: bucketId / planLadder / cutHold) whose render
  // has the release baked in at .5 / 1 / 2 s. Plan ONE ladder per part from the same [base, hold]
  // pairs in build() and voiceIds (capped: BUCKET_CAP). main bakes a '~' id's bare base LIVE-ONLY
  // and the live path plays that base, releasing at `dur` exactly. organ / bowwheel / horns /
  // dulcimer / bowls do this; test/sustain.test.js runs the checks on each.
  // optional: an id's pitch in Hz for the spatial pan width (low voices sit near the centre).
  // Default: the FIRST pitch in the id ('E2+B2:m', 'C4|choir', 'stab:D4') — list chord notes low → high.
  voiceHz(id){ ... },
  // optional, for the MIDI importer: your solve.js PART_LIMITS (lo/hi/center/pitches/poly/gap/ioi/
  // voices/maxEvents/sustain/minDur/maxDur). orchestra.js derives its PART_SPEC from it (imports
  // it — the numbers are never copied) and routes programs to you in PREFER / LINE_HOME.
  PART_LIMITS,

  make({ envMap, glowTex, THREE }){
    return {
      // Rebuild everything for a song. Return a THREE.Group in the instrument's
      // LOCAL frame (see stations.js: +x across, +y up, +z toward the audience,
      // y=0 = deck top, stay inside |x|≤w/2, |z|≤d/2). main parents it to the
      // station. The group is disposed on song change (main traverses + disposes).
      // floorY = the room floor in your local y (grow legs down to it). A crowded
      // room may raise your station onto the rear GALLERY behind the belt (deck ≈
      // the belt's top housing − 2): build() is then called again with a much
      // lower floorY (~ −36) — legs must stretch, nothing else changes.
      build(part, { rollT, beat, P, start, station, floorY, loopBeats }){ ... },

      // Per frame. A PURE fn of songTime (scrub-safe: ?debug can jump anywhere).
      // !started → render the ARMED pose at t = start. Fire each strike ONCE
      // (clock.js makeEdge; pass skipStrikes as `skip`). For each strike call
      //   onStrike({ note, vel, pos, color, dur, shake, sparks, light })
      // pos = Vector3 in YOUR local frame (main maps it through the station),
      // dur = seconds (sustained voices release there), shake ≈ .02–.1 for big
      // hits only, sparks = count (0 = none), light = strike-light scale (1;
      // < .2 skips the shared strike-light pool — a chord's faint inner strings
      // must not steal another machine's flash).
      update(songTime, P, dt, { started, skipStrikes, onStrike }){ ... },

      // optional: WebXR. Called with true when a headset session starts (and after every build
      // while one runs), false when it ends. For a look that needs MORE than xrGlow without
      // bloom (a hotter core, a bigger halo). Render-only — never change timing or geometry.
      xr(on){ ... },
    };
  },

  // A self-demo for ?solo=<key>: loads this part on a minimal melodic spine and
  // frames the camera on the station. beats must be a multiple of 4.
  demo: { bpm: 100, beats: 16, part: [[0, 'C4'], [1, 'E4', .7], ...] },
};
```

## The family machines (2026-10-07) — what they taught the seam

Seven plugins were built in parallel overnight (riff, strum, pogo — the GUITAR family; organ, horns,
bowwheel, dulcimer — the SUSTAIN family; CLAUDE.md §4). Their seam gaps became contract:

- **`voiceIds(part, ctx)` gets the tempo** — `ctx = { beat, bpm, rollT, P, loopBeats }`. Name voices
  by a note's length in SECONDS (a stab vs a held horn, a damped piano note, a bucket rung) with the
  SAME pure helper build() uses, so the bake and the strikes can never disagree (`__dev.strikes()`
  lists any fired id with no baked voice — keep it empty). No ctx (an old caller) → return a superset.
  main calls `build()` before `voiceIds` today, but don't rely on it (the organ's old WeakMap trick
  is gone).
- **Timbre / articulation ride on the note id** — there is no per-event timbre field. Parse your
  suffix tolerantly (`'E2:m'`, `'C4|choir'`, `'C4:e'`, `'stab:C4'`, `'E1:s'`) and document the grammar
  in solve.js; the importer writes it (`src/midi/orchestra.js noteSuffix`) and the MAP panel keeps it.
  One id = one baked voice: a variant that is a separate STRING (strum `|n`) must be one per part.
- **`voiceHz(id)`** (optional): the id's pitch for the pan width. The default parses the FIRST pitch
  in the id, so list chord notes low → high (`'E2+B2+E3'`) and you rarely need it.
- **`light < .2` skips the shared strike-light pool** — a strum / chord fires one bright strike for
  the chord and faint ones (`light: .12`) for the inner strings; draw those flashes locally.
- **`PART_LIMITS`** (export from solve.js, re-export on the descriptor): `{lo, hi, center, pitches,
  poly, gap, ioi, voices, maxEvents, sustain, minDur, maxDur}` + anything your fitter needs. The
  ROUTING CONTRACT: orchestra.js builds `PART_SPEC.<key>` FROM it (imports it; a test asserts the
  match — never copy numbers), routes programs to you in `PREFER` (program + shape) / `LINE_HOME`
  (spare lines of your family) / `OVERFLOW_TO` (where you spill when full; no loops), and writes your
  suffixes in `noteSuffix`. Your build() must still FIT ANY input itself — fold out-of-range notes by
  octaves, cap lanes (rarest first), thin repeats under `gap`, clamp durations, drop the softest past
  `maxEvents`, skip garbage, NEVER throw — and `console.warn('[<key>] …')` what it did. Stress-test
  500 random events + garbage in your test file.
- **Sustained voices fire DURATION BUCKETS** (below) — a plugin whose notes have a held length longer
  than ~.5 s and a render longer than that should.
- **Gallery raise / floorY**: a crowded room may raise your station onto the rear gallery; build() is
  called again with floorY ≈ −36. Grow legs/plinth to floorY; nothing else may change. Measure your
  footprint honestly (`STATIONS` w/d) — `test/stations.test.js` runs every key at once in 1–3 bays.
- **Count-in pose**: during the LEAD_IN every lane is ARMED (marble on its magnet / latch); a lane
  whose first reachable stroke is mid-loop must ENTER honestly (bowwheel `entryAt`: release from the
  magnet so the fall lands at rest before the first stroke) — or loop 1 is silent there.
- **Metal shader gotcha**: `pow(0.0, y)` in a fragment shader returned NaN on Metal and bloom smeared
  it over the whole frame (black screen). Use `x*x`-style forms.

### Duration buckets (src/instruments/sustain.js)

The iOS `<audio>` path plays a WAV to its end (no `dur` release, `el.volume` ignored). So a sustained
note fires `'<base>~<hold>'`: its render = the base render CUT at a rung of the ladder `[.5, 1, 2]` s
with the release baked in (`cutHold`, `relFor`). The fired rung is the one nearest the note's hold in
LOG time (≤ √2 off below 2.8 s) — or the bare base when the render's own hold is nearer.
- Plan ONE ladder per part from the same `[base, hold]` pairs in build() AND voiceIds (`planLadder`,
  `bucketIds`). A part over `BUCKET_CAP` (40) bucket ids coarsens: `[.5, 2]` → `[.6]` → none; pass a
  `floor` to never go below a rung (the organ floors at `[.6]` — it replaced its old per-note '/s' tier).
- Without a tempo, `allBucketIds` = every rung of every base (a superset).
- main bakes a '~' id's bare BASE live-only (Float32, no `<audio>`); the live path plays the base and
  releases at `dur` exactly, so desktop sounds as before. Bucket cuts are slices (cheap); horns
  re-render the exhale natively with the same seed.
- Users today: organ, bowwheel, horns, dulcimer, bowls. test/sustain.test.js runs the shared checks.

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
  - **VR detail profile** (src/xrdetail.js + src/xrbatch.js, headset render ONLY, undone
    right after it): opaque plain-material meshes that share a LOOK (same material, or
    separately-made materials with identical properties) are mirrored into one
    BatchedMesh draw each — a part whose material is mid-flash draws as itself that frame,
    so one material per part for independent flashes is fine. Parts smaller than ~7 px
    in the headset are skipped (balls / sphere geometry never are); tag a part
    `userData.xrKeep = true` if it must always draw, `userData.xrNoBatch = true` to keep
    it out of the batch. A part with `onBeforeCompile` / a custom `onBeforeRender` /
    ShaderMaterial / transparency is never batched. A skipped or batched part is hidden by
    LAYER MASK (the part alone) for that render — its children (a halo, the ball on a tiny
    arm) still draw, so parenting a ball under a small part is safe. Don't use `layers`
    for your own visibility logic.
  - **Fade gate**: every ADDITIVE transparent non-shader material under the world
    gets `material.visible = opacity > .002` each frame (an idle glow at opacity 0
    still costs a draw call). Don't drive `material.visible` yourself on those; opt
    out with `material.userData.noFadeGate = true` (or on the object).

## Rest-pose personality (`idle.js`)

A resting machine should never look dead, and its next entrance should be felt coming
(Animusic's Starship Groove robots). `idle.js` holds the shared pure curves: `restEnv(since,
until)` (exactly 0, value and slope, within a guard of either end of a rest), `anticip(until)`,
`sway`, `twitch`, and the `IDLE.on` switch. Each machine exports a pure REST WINDOW from its
solve (`latchRest`, `hangRest`, `dockRest`, `heldRest`, `parkAt`, `damperRest`) and spends the
envelope on a part with a visible cause (a coil's current, a ram, a key, the drive cable) — a
few cm and a little glow, never a gesture that reads as a note. Lanes with no notes stay still
(no entrance to anticipate). `test/idle.test.js` proves it: every rest window is a real rest
clear of the lane's strikes, and the render is byte-identical with idle on/off around every
strike. No new materials or lights.

## Dev loop

    npm run dev -- --port <yours>
    http://localhost:<port>/?solo=<key>&debug     # your demo, camera on your station
    window.__dev.station('<key>', dist, up)       # re-frame; __dev.t = 3.2 scrubs; __dev.rate = .25
    npx vitest run test/inst-<key>.test.js
