# CASCADE — marble melody machine
## Handoff brief for Claude Code

This project began as "a shiny track, a glowing marble, surfaces to bounce off" in
a Claude.ai chat artifact and grew into a multi-track ballistic music engine.
It went mildly viral after the three.js account reposted it (~30k views).
It is now a Vite + ES-module repo (`src/`). The single self-contained
`marble-cascade.html` still exists as the shareable "viral unit" — but it is a
BUILD ARTIFACT (`npm run build:single`), not the source of truth. Live at
https://cascade.ajsmithhq.com.

This document is the scar tissue: what the architecture means, what must never
break, what we already learned the hard way. The *north star* — where this is
all heading (a 3D music **creation + visualization tool**) — lives in
[`VISION.md`](VISION.md). Read that for the "why"; read this for the "how".

---

## ⚠️ 0. BRANCH & DEPLOY STATUS — read before you ship anything

**Production = `main`.** On 2026-10-06 the whole v2 engine (static-band conveyor, marble
drum machine, instrument plugins, rooms, room director, creation tools, phrase-loop MIDI
import) was fast-forwarded into `main`, the `v2` branch was deleted, and `main` was
deployed to cascade.ajsmithhq.com. Work on feature branches off `main`.

`convDbgOn` (the conveyor debug HUD — rulers + height graph, key `G`) now defaults to
**`false`**. Keep it off in anything you ship.

`npm run deploy` builds + ships to production. It does not care which branch you're
on. Treat it as live, and confirm with the human before running it.

---

## 1. Repo layout, build & deploy

    src/engine.js    pure physics/music — solver, arcPos/arcVel, padOffset, beltPhase,
                     deployPose, layoutPads, noteHz (unit-tested, no THREE-scene/DOM/audio)
    src/audio.js     dual-path Web Audio + iOS sample fallback (see §5). Melodic voices
                     + percussion voices. Ported VERBATIM from the single-file build.
    src/juice.js     trail / ripple / spark / dust pools, spawnBurst, glowTex
    src/paternoster.js  the visible conveyor MACHINE (render subsystem): open roller chains
                     on toothed sprockets, tuned tone-plates on brass node cradles, sculpted
                     housings. Replaced the solid belt WALL (conveyor.js, deleted 2026-10-05).
    src/crane.js     pure timing for the MAGNET CRANE: the melody marble is CONSERVED — the
                     last pad lobs it up to a magnet (v=0 at apex), a carriage carries it back
                     over pad 0, release lands on the next downbeat. test/crane.test.js.
    src/camera.js    the camera RIG (render subsystem): director / fixed / free-fly /
                     follow modes, orbit + WASD/QE keyboard fly. "Sees the future."
    src/marbledrums.js  the MARBLE DRUM MACHINE (render subsystem): one ball per drum,
                     dribbling on its own head; pistons + electromagnets. Math lives in
                     engine.js (dribbleLane/dribbleAt/dribblePiston), tested in dribble.test.js.
    src/instruments/ INSTRUMENT PLUGINS — one folder per instrument, auto-registered by a
                     Vite glob (adding one edits NO shared file). README.md = the contract.
                     clock.js (shared lane clock / strike edge / event parsing), stations.js
                     (render-time placement: origin + yaw + footprint). Each <key>/ has
                     solve.js (pure) + voice.js (pure DSP) + index.js (render) and
                     test/inst-<key>.test.js. Shipped: marimba, bells, bass, musicbox, bowls.
    src/drumkit.js   the drum REGISTRY: canonical name ↔ GM note ↔ mix gain. One source
                     of truth for the song validator, audio, render, future MIDI import.
    src/midi/        MIDI import: parse.js (type-0/1 → tracks, FAITHFUL — keeps every
                     channel incl. 9, with velocity) + convert.js (→ song JSON, quantized,
                     lock-rule-correct; channel 9 → drum lanes via drumByGm — see §6)
                     + orchestra.js (who plays what: by GM program, or — when a file's
                     programs say nothing — by musical ROLE: line / chords / low / sparkle;
                     a one-track two-hand piano is split into melody / left hand / chords;
                     opts.route 'legacy' keeps the classic belts-only import). parse.js
                     takes the beat-weighted MEDIAN tempo of the map, not the first event.
    src/xr.js        WebXR (Quest 2) render subsystem: ENTER VR/AR (only if supported), the scaled
                     dolly, catwalk pads, solved teleport arc, tour, controllers, head-pose audio.
                     src/xrplan.js = its pure half (anchors from the director's shots, tour, scale
                     U_PER_M = −G/9.81, earFrame) — test/xrplan.test.js. How to test: docs/XR.md
    src/share.js     song ⇄ deflate→base64url share links
    src/record.js    canvas captureStream + MediaRecorder → "one perfect loop" video
    src/songs/*.js   one module per song (the comments are sacred), aggregated by index.js
    src/main.js      scene, rigs, buildWorld, ballPos, animate(), controls — the orchestrator
    test/            Vitest: engine ballistics, song lock-rule, drum validation, MIDI,
                     layout overlap, share round-trip (177 tests)
    VISION.md        the product north star (vision, not spec)
    docs/PLAN-*.md   design notes: PLAN-{real,seamless}-conveyor (how the static band
                     was reasoned out) + PLAN-staging (instrument/room/support/placement
                     abstractions + the human-curation-over-auto-layout decision)

    npm run dev            # vite dev server (add --host to reach a phone on the LAN)
    npm run dev:xr         # https (self-signed) + LAN host → a Quest can open it (docs/XR.md)
    node scripts/xr-shot.mjs  # IWER-emulated Quest 2 in headless Chrome: enter VR, teleport, stereo shot, XR draw calls
                           #   ?solo=<instrument> = that plugin's own demo, camera on its station
    node scripts/shot.mjs  # headless screenshots (own browser per call — parallel-agent safe)
    npm test               # vitest — run after ANY song or engine edit
    npm run build          # → dist/  (hashed assets; what deploy.sh ships)
    npm run build:single   # → marble-cascade.html  (self-contained viral artifact)
    npm run deploy         # build + ./deploy.sh → S3 sync + CloudFront invalidation

Deploy infra: private S3 bucket `cascade.ajsmithhq.com` (CloudFront OAC) → CloudFront
`E1U4B3EV2WPMZS` → ACM cert + Route53 alias. three.js is **r184** (`^0.184.0`),
postprocessing on (EffectComposer → UnrealBloom → ACES OutputPass). The module seams
are deliberately thin and dependency-injected: audio takes `setBeat` + `rebuildBank`;
juice takes `initJuice(scene)` then `spawn*`/`updateJuice`; conveyor/camera/drums are
`make*({deps})` factories that never reach into the engine.

---

## 2. The core idea (do not lose this — it is the moat)

**The melody is authored first; the physics is solved backward from it.**
Pads are not simulated — each launch velocity is the closed-form ballistic solution
that lands the marble on its target in exactly the note's duration:

    v0 = solveLaunch(from, to, dt) = (ΔP − ½·g·dt²) / dt

Position along an arc is the analytic `P(t) = P0 + v0·t + ½·g·t²` (`arcPos`); velocity
is `V(t) = v0 + g·t` (`arcVel`). **There is no integrator, therefore no drift,
therefore audio/visual sync is structurally perfect forever.** Rhythm is literally
visible: long notes = tall arcs, fast runs = flat skims (apex height scales with dt²).

**Visuals drive audio.** Notes trigger when the timeline crosses a segment boundary
(melodic: `ballPos` idx advances; drums: a hit's strike phase wraps), never from a
scheduler. **If you add a scheduler you will create drift. Don't.**

**Time is the only state.** Every marble position, pad swing, drum-ball arc, and
anticipation glow is a pure function of `songTime`. This is why the director camera
can "see the future," why the world can be re-derived from scratch every frame, and
why a new instrument is *tractable*. Protect this invariant like gravity.

---

## 3. The static-band CONVEYOR (v2's big render move)

The original engine let the whole world fall: `T = clock % P`, every track sinking at
`DESCENT` (2.2 u/s), the camera craning down to follow. v2 keeps **all of that physics
untouched** and reframes it at **render time** into a *static band*:

- Each pad **RECIRCULATES**: it rises to a fixed strike band (`STAGE_Y = DESCENT·ROLL_T
  ≈ 5.7`) exactly at its strike, then wraps off-screen and comes around again. The map
  from songTime to a pad's centered height is `beltPhase(songTime, strikeTime, period)`
  — 0 at every strike, negative just before (rising to meet the ball), positive just
  after. The only discontinuity is the off-screen wrap, so pads stream upward forever
  with no global loop snap.
- Each marble is **MORTAL**: born once per loop, it juggles in the band via a per-ball
  render lift `+ DESCENT·τ` (τ = age), then plunges out the bottom and is recycled to a
  per-role rig pool (`RIG_POOL = 3`). Birth is an **honest free-fall** onto pad 0
  (`BIRTH_DROP = 10` u, `BIRTH_FALL ≈ 1.17 s` under the same G as every arc; delayed
  voices just hold longer off-screen, then drop identically).
- The two mechanisms share no state. They meet at the band, at strikes, **by
  construction** (`beltPhase` is 0 at a strike; the ball lift cancels descent there).

This is the key mental model for reading `main.js`: positions come out of `ballPos`/the
arc math in the *falling frame*; the animate loop adds `DESCENT·τ` (balls) or
`DESCENT·beltPhase` (pads) to pin everything in the static band. To express something
directly in rendered-band space inside `ballPos`, subtract `DESCENT·τ` so the re-add
cancels. The visible machine (`conveyor.js`) only ever *draws what the math implies*: a
belt scrolling at `DESCENT` and pads rising at `DESCENT` are slip-free with zero state.

`docs/PLAN-seamless-conveyor.md` and `docs/PLAN-real-conveyor.md` are the reasoning trail.

---

## 4. Two instrument archetypes (the extensibility bet)

VISION.md's core bet: adding an instrument = **design a 3D shape + solve its physics**,
nothing more. The unifying runtime primitive is a **ball spawner** — mortal balls, born
→ fly a solved arc → strike → die. Two archetypes already cover huge musical ground:

1. **CONVEYOR — single marble, moving instrument** (the melodic voice). A belt
   *manufactures* the right pad for each note (sized to register, tilted to its bounce);
   one marble chains pad → pad, each pad launching it to the next. `buildTrack` + the
   conveyor machine. Range is effectively unlimited — the belt produces the pad on demand.
2. **STATIONARY — one marble per drum, fixed instrument** (the rhythmic voice). Each
   drum owns ONE immortal ball that only ever bounces on that drum: the flight between
   strikes is the solved vertical arc for the gap (apex = |G|·gap²/8, the belt's dt²
   grammar — the groove reads as bounce height). A gap longer than `DT_MAX` ends on an
   **electromagnet** hung at exactly the max apex: the ball arrives at zero speed, is
   held, and released so the free fall lands on the beat. Every head rides a **piston**
   that supplies each bounce's lost energy (restitution `e`, Δv = vOut − e·vIn), at rest
   at contact. No allocator, no feed, no plumbing — lanes never interact.
   `engine.js` dribble* + `marbledrums.js` + `drumkit.js`. (History: spouts → bell →
   Doc-Ock → golf club → juggling all drowned in feed plumbing; parked on `juggling-wip`.)

3. **INSTRUMENT PLUGINS** (`src/instruments/`, §4b) — the extensibility bet cashed in: five
   more instruments built in parallel by separate agents against one contract, each a
   different honest mechanism: **marimba** (a ROBOT four-mallet marimbist: belt-driven gantry
   carriages, scissor-yoke grips, marble mallet heads, held notes ROLL, impact speed = loudness —
   allocation + motion solved up front, then verified against the drive limits), **bells**
   (latched pendulum strikers + motorised catcher), **bass** (winched magnets drop heavy balls
   onto strings), **musicbox** (pinned cylinder = one revolution per loop, the cylinder IS the
   score), **bowls** (SUSTAINED — a marble orbits the rim for the note's duration).

**The generalization to hold onto:** a hit = **a target + a launch solve**. The melody
swaps "next pad" for the target; a drum swaps in a stationary drum. Future instruments
(lob / shoot / drop) swap only those two terms and stay just as solved-up-front. Audio
is part of the instrument too — we design the *sound of each hit* per instrument (§5).

Status: drums are implemented (kick/snare/hat + a **five-tom set** voiced + rendered — one
floor tom; GM 41's low floor tom is merged onto it via `GM_MERGE` in drumkit.js, as are the
other kick/snare (35/40/37), pedal hat + shakers (→ hat), extra cymbals and hand drums (→ toms);
clap/crash/ride reserved in the registry, voiced as fallbacks). Toms are **pitched** — each
carries a `tone` (Hz) in the registry and a real membrane voice (downward bend + stick
attack), so a descending fill reads and sounds as a tonal cascade (this is what makes an
imported intro tom roll land). **Mountain King** carries a hand-authored `drums` block; any
song can get one, and **MIDI import now generates drums from channel 9** (§6).

### 4b. The plugin seam (read `src/instruments/README.md` before building an instrument)

- Song data: `song.parts.<key> = [[beat, note, vel?, durBeats?], …]` — absolute beats, pinned
  like drums (no lock rule), validated in `test/instruments.test.js`.
- Descriptor: `{key, label, wet, voice(id) → {samples, sr}, make({envMap, glowTex, THREE}) →
  {build(part, timing) → Group, update(songTime, P, dt, {started, skipStrikes, onStrike})},
  demo}` + optional staging hints `color / camera / lookHeight`.
- main.js runs ONE generic loop: build each part inside its station group, update per frame,
  route `onStrike({note, vel, pos, color, dur, shake})` → sparks + a SHARED constant-size
  strike-light pool + `audio.playVoice('inst:<key>:<note>', vel, {dur})`.
- Audio: one pure `voice()` render feeds BOTH the live path (AudioBuffer, gain = vel, `dur`
  release) and the iOS `<audio>` bank (WAV) — iOS-war internals untouched. On the sample path
  sustained voices ring their full render (no `dur` release; el.volume is ignored anyway).
- **Room director** (src/directorplan.js, pure + tested; main `syncDirector` → camera.js plays it back):
  the song is data, so the loop's whole EDIT is solved at song load. Every machine — **the belt is
  just one of them, no protagonist floor** (AJ: "I don't see the belt as too special") — is scored
  beat by beat for what's SPECIAL: above its own norm, an entrance after a rest, a crescendo, a
  solo, rarity; then a 2nd-order DP over the beat grid cuts the shots (≥ 3 s, on beats, bar lines
  preferred, A-B-A ping-pong priced), share caps (belt .18 / wide .16 / station .24) and coverage
  (every machine that plays is seen once a loop). Scripts (`song.director.at`) are fixed points;
  `song.director.<key>` is a √-weighted hint. The seam's breath is the wide `stage` shot by default; a
  script that runs past the last note OWNS it (directorplan `held`, may wrap into the roll-in — Forge's anvil). The camera's shot is a pure function of songTime.
  `node scripts/director-audit.mjs` prints every song's shares. Songs with stations open on `auto`;
  others keep free-look. `stage` = the wide shot.
- Lessons that made five parallel builds work: design FOR marbles (no feed plumbing — each lane
  owns its own ball/striker); park long gaps at the apex; lossy bounces with a visible energy
  source; honesty tests (lands on the beat, at rest at contact, no penetration) before render.

---

## 5. THE iOS AUDIO WAR (most expensive knowledge in this repo)

We fought four rounds getting sound to work in the Claude iOS app's artifact iframe.
The final system is **dual-path**. Symptoms → causes, in the order we hit them:

1. **Tone.js silently failing** — its Reverb builds an impulse response asynchronously;
   a ConvolverNode with no buffer outputs pure silence, no error. We removed Tone. The
   melodic synth is ~40 lines of raw Web Audio (triangle + detuned 2.004× partial +
   inharmonic 2.76× music-box tine + 4.2× sparkle; bass = sine + 0.5× sub-octave + 2.002×).
2. **Zombie AudioContext** — a context created *before* the first user gesture in iOS
   WebKit can report `state === "running"` while `currentTime` stays frozen at 0 and emits
   nothing. Fix: construct the ENTIRE context inside the gesture (`buildAudio()` from the
   play tap).
3. **Watchdog rebuild trap** — our first watchdog rebuilt the context from a
   `setInterval`; a context born outside a gesture is guaranteed-suspended, so it rebuilt
   4 zombies in a row. Rebuilds may ONLY happen inside tap handlers. The watchdog now only
   reports; `touchend`/`pointerdown` handlers retry.
4. **The iframe denies AudioContext activation outright** (artifact-preview permissions
   policy) — `resume()` from a genuine gesture still left it suspended, while `<audio>`
   element playback was allowed. No JS climbs this wall, hence:

**Plan B — the path that actually plays on iOS:** every unique (note, timbre) and every
drum is synthesized to a 16-bit mono WAV (`renderNoteWav` / `renderDrumWav`, echo baked
into notes, drums dry), wrapped in a Blob URL, loaded into its own `<audio playsinline>`,
and **primed** on the first tap (`play()` then swap in the real src — the activation
sticks to the element). `playNote`/`playDrum` prefer the live Web Audio path when
`ctx.state==='running' && ctx.currentTime > .05`, else fire the element. The status
readout (bottom-right) shows state / clock / active path — keep it; it's how we debug.

Hard-won iOS facts (still true): `el.volume` is **ignored** on iOS (you cannot mix
element levels — timbre/level differences are baked into the WAV renders; **drum per-hit
velocity therefore lives only on the webaudio path**, samples play full). js-set
`el.muted` is ALSO unreliable on `<audio>`, so priming plays a truly-silent WAV and swaps
to the real src after unlock. Never snap the live echo's `delayTime` on song change — glide
it (`setTargetAtTime`), or the delay line replays its buffer as a burst. Element playback
has ±30–50 ms jitter (audible on <0.3 s runs — acceptable; the webaudio path is tight).
Phone speakers roll off below ~200 Hz, so bass lines live in octave 3/4 with a sub-octave
partial. Bank keys: `note` / `note|b` (deep voice) / `drum:<name>`.

**Percussion voices** (added with the drum machine, same dual-path, iOS-war internals
untouched): live `hitDrum` — kick = sine pitch-drop + beater click, snare = highpassed
noise + tonal body, hat = bright noise transient — routed **dry to `busOut`** (past the
melody's echo) so they punch. Baked `renderDrumWav` for the iOS path. Known degradations,
both already in this ledger: iOS drum samples play full-velocity; a dense hat run can clip
its own tail (one `<audio>` element per drum). The webaudio path has neither.

Also: `MediaStreamDestination → <audio>.srcObject` is a parallel iOS output; the recording
tap (`captureStream`) hangs off the final mix. `navigator.wakeLock` keeps the screen on.

**Spatial audio + mix bus (live path only — the war's internals are untouched, nodes were
only INSERTED).** Every live voice takes an optional placement `sp = {pan, gain, shelf, room}`
(`playNote(note, deep, sp)`, `playDrum(name, vel, sp)`, `playVoice(key, vel, {dur, sp})`).
main.js's `placeAt(worldPos)` projects the strike into CAMERA space at strike time (plus the
shot: `tanH` from fov·aspect, `focus` = eye→aim distance) and `src/spatial.js` (pure, tested)
maps it: **pan by FRAME position** (screen x → `PAN_MAX·tanh(PAN_K·sx)`; frame edge ≈ ±.51,
off-screen leans softly to ±`PAN_MAX` .62 — no pile-up at a cap), narrowed for low voices by
`widthFor(hz)` (bass/kick sit near centre — lows don't localize); **distance relative to the
shot** (`d/focus`: the framed subject is always full level/full band; past `NEAR`×focus a gentle
rolloff floored at `MIN_GAIN`, an air high-shelf of a few dB at 7 kHz, and a rising reverb send
`room` — farther = wetter). As the director cuts, the next strike follows the shot. Pan law:
StereoPanner on a mono voice is equal-power (.707/side at centre), so `place()` adds ×`PAN_COMP`
√2 — centre = the old mono upmix, panning costs no level. Graph tail: `out → busTrim → glue →
limiter → makeup → ceiling clipper = mixOut → destination / iOS MediaStreamDestination /
recording tap`. The LAST stage is a WaveShaper whose curve tops out at `MIX.ceiling` (.891 =
−1 dBFS): a per-sample, per-channel guarantee (the compressors aren't brickwall and add their own
makeup). Knobs in `MIX` (audio.js): `voiceTrim`, `busTrim`, `glue`, `limit`, `makeup`, `ceiling`/
`knee`, `revSecs`/`revReturn`, and per-family reverb `send` (belt/drum/voice/wet). The reverb is a
ConvolverNode with its IR computed **synchronously** in `roomIR()` (round 1 was an ASYNC IR
leaving the convolver silent; a same-tick buffer can't be). **Level checks must use a
per-channel SAMPLE-peak meter** (ScriptProcessor/worklet tap) — a stereo AnalyserNode downmixes
L+R and under-reads panned peaks. `?debug` → `__dev.audioProbe()` reports glue/limiter reduction
+ the reverb-return peak since the last call. The iOS `<audio>` sample path can't pan/bus — it
plays exactly as before (centred, un-limited).

---

## 6. Song data format & THE LOCK RULE

```js
'song-key': {
  label, sub, bpm,
  scale: [...pitch classes...],        // drives pad-rim hue mapping
  melody: [['F#5', 1], ['G4', 1, .6], ...],  // [note, beats-until-next-hit, vel?]  (MONOPHONIC, chained;
                                       //  vel 0..1 default 1 = dynamics: live audio + strike juice, never the solve)
  alto:  [...] | {delay, deep, notes}, // optional; delay = beats of rest
  bass:  [...] | {delay, notes},       // optional
  drums: { kick:[0,1,2,3], snare:[1,3], hat:[0,.5,1,...] },   // optional; see below
}
```

**Belt velocity** (optional 3rd element, `src/dynamics.js`): one velocity law (`velGain`) for the belt
pluck AND the drums — the old `.35 + .65·v` line from v = .5 up (existing grooves unchanged, measured
±.5 dB), bent down below it so pp is genuinely quiet (v .1 ≈ −19 dB, 0 ≈ −27). Live path only — iOS
samples play full. MIDI import emits it from note velocity relative to the track's loudest (`^.6`);
a flat-velocity track stays 2-element.

**THE LOCK RULE (melodic tracks): for every track, sum(beats) + delay must equal the
melody's sum exactly**, or it desyncs at the loop seam. These tracks *chain* (each pad
launches the marble to the next), so a wrong total drifts. Verified in
`test/songs.test.js` after ANY song edit. Notes are `[A-G]#?\d` (sharps only). `deep:true`
selects the sub-octave voice. `delay` makes a track enter late (start lower, fall in
formation — descent is time-proportional precisely so parallel tracks fall together).

**Drums are different — DECIDED: absolute beats grouped by lane, NO lock rule.** Each
lane lists the beat positions it strikes (a hit is `beat` or `[beat, velocity]`,
velocity 0..1). Drums don't chain — each hit is an independent mortal ball **pinned** to a
moment — so the lock rule's reason doesn't apply; pinned beats can't desync. For
**hand-authored** songs every hit ∈ `[0, loopBeats)` where `loopBeats = sum(melody beats)`
(validated in `test/drums.test.js`). Velocity is *dynamics* (audio gain + strike flash),
separate from *impact speed* (geometry) — keep them apart. `src/drumkit.js` (`GM_DRUMS`) is
the one source of truth: name ↔ GM note ↔ mix gain (+ `tone` Hz for the pitched toms),
reused by the validator, audio, render, and the MIDI importer. That last reuse is now live:
`convert.js` groups channel-9 notes by GM number → `drumByGm` → a lane of quantized,
lead-aligned beats (velocity = MIDI vel/127). Unmapped GM notes are dropped+warned; a
percussion-only file errors (the engine needs a melodic spine). **A pickup fill before the
lead keeps a NEGATIVE beat** (import-only — the hand-authored `[0, loopBeats)` convention
stands): the render places beat `b` at `ROLL_T + b·BEAT`, so a negative beat lands in the
marble's roll-in window and butts up against the downbeat — the intro tom roll leads into the
first note instead of stranding at the loop tail. Covered in `test/midi.test.js`.

Catalog (9): Für Elise (duo), Ode to Joy (trio thirds), Canon in D (true canon), Greensleeves
(6/8), Gymnopédie 1, Prelude in C (single track — camera buttons auto-hide), Mountain King
(accelerando — **now with a kick/snare/hat groove**), Toccata in Dm (6.5-beat pedal lob),
Dies Irae (deep canon echo, delay 5). bpm is the single tempo knob; everything re-solves.

---

## 7. Render systems & their contracts (juice, camera, machines)

- **Flipper pads** (`padOffset`): wind-up → stroke (last 100 ms) → follow-through wobble.
  CONTRACT: offset is ~0 at phase 0 — the pad arrives at rest exactly at impact, so contact
  is honest (a unit test enforces `padOffset(0,A)===0`). Amplitude `A = clamp(launchVel·
  padNormal × .07, .05, 1.6)`.
- **Pad size encodes register** (`padRadius`/`pitchSize`): smaller = higher, a PURE FUNCTION
  OF THE NOTE — never of layout/spacing (that would imply the physics of sounding a note
  changed with context, a lie). Overlap is solved by spacing pads apart (`layoutPads`'
  relaxation pass), never by shrinking them. `test/layout.test.js` guards no-overlap.
- **Squash & stretch**: a `deform` node oriented along velocity; stretch with speed, impact
  squash decaying.
- **Anticipation glow**: the next pad's rim brightens with `prog²` — possible only because
  the timeline is analytic.
- **Bloom** (r184): EffectComposer → UnrealBloom (`.12, .3, .9`) → ACES OutputPass. The
  sprite halos (`HALO_A=.12`) predate bloom and stay as the soft wide base; emissive cores
  (`EMI=1.2`) feed the real bloom. Exposure pops 1.15 + kick on lead strikes.
- **The visible machine** (`paternoster.js`): two roller chains scrolling at exactly DESCENT
  on phase-matched sprockets, pad carriers between them, tone-plates that unfold out of the
  bottom housing and fold into the top one (visible run ≈ band ± 7). The marble is conserved by
  the magnet crane (`crane.js`) — no more mortal plunge-and-respawn. Key `M` toggles it. It only
  draws what the conveyor math already implies (§3).
- **The drum kit** (`drums.js`): stationary drums + chrome spouts + a shared mortal-ball
  pool (re-derived from songTime every frame — time is the only state). Drum heads flex on
  strike; the `drumStrike` hook in main fires sparks + `audio.playDrum`.
- **Camera rig** (`camera.js`, `makeCameraRig`): modes auto / fixed / free / all / lead /
  alto / bass via the button row (hidden for single-track songs). **auto = DIRECTOR**: it
  cuts to whichever track is about to do something big (current-or-imminent note dt ≥ 1.05 s,
  pre-cutting during wind-up), shred-cam when lead dt ≤ .33, 2.2 s hysteresis, lerps not
  snaps — possible only because the whole timeline is known. **free** hands over orbit-drag +
  WASD/arrows/QE fly (disabled until picked, so it can never swallow the iOS priming tap).
  Vertical is pinned (the band is static); x/z follow with sway + spread-dolly.

- **WebXR** (`xr.js`, docs/XR.md): render-time framing only. The loop is `renderer.setAnimationLoop`
  (a headset has no window rAF); while presenting main renders scene→camera directly (no composer —
  halos/emissive step up, marble lamps off; constant light set), skips the camera rig + perf governor,
  and `placeAt()` reads the head pose. The rig is scaled U_PER_M so marbles fall at a TRUE 9.81 m/s².
  Teleport only (pads = the director's solved eyes; the arc is a solveLaunch throw), tour = the
  director's edit as cuts. IWER is DEV-only (`?xremu`, needs `installRuntime({forceInstall:true})` on
  desktop Chrome). Perf: no multiview in WebGLRenderer r184 — the full room from the wide is ~1500
  calls/frame; light songs ~350–575.

Dev toggles: `G` = conveyor debug HUD (rulers + height graph; `convDbgOn`, OFF by default). `M` = machines on/off. `?debug` = a scrub bar (time is the only
state, so scrubbing is just assigning `songTime`; `skipStrikes` suppresses machine-gunning).

---

## 8. Known issues / honest limitations

- Sample-path latency jitter on fast runs (iOS element playback). Unfixable in the iframe;
  the webaudio path wins on Safari/desktop.
- Same-note / same-drum retrigger cuts its own tail (one element per note+voice / per drum).
- Drum scale ceilings are fine for hand-authored songs, not infinite: the ball pool caps at
  `POOL = 36` (extras drop silently) and the strike/airborne scan is O(hits)/frame. A dense
  MIDI drum import (thousands of hits) would want a windowed scan + a bigger/instanced pool.
- Drum *timing* math lives inside `drums.js` (coupled to THREE), so it has no pure unit test
  — only the underlying `solveLaunch` is covered. Extract it if you want belt-and-suspenders.
- MIDI import now routes **channel 9 → drum lanes**, but a **percussion-only file is rejected**
  (no melodic spine to drive loop length / timeline-zero / camera); unmapped GM notes are
  dropped (warned in console, not surfaced in-UI). Pickup fills are kept as negative beats and
  render in the roll-in; hits earlier than the roll-in (`ROLL_T/BEAT` beats) are dropped+warned
  (they'd wrap mod the loop onto the groove). Full-length songs still import as ONE giant loop
  (solve budgets keep a contiguous window per machine) — phrase detection is the open lever.
  Imported rooms are `staging: 'auto'`: stations step around a wide belt wall and blocked
  station shots re-aim (main.js / stations.js placeStation); hand-authored rooms are untouched.
- **Phrase loops** (`src/midi/phrase.js`): a MIDI longer than 75 s imports as its best LOOPABLE
  window (8–32 bars, ~30–75 s: the most-repeated, lead-active section whose next bar is its first —
  bar-level self-similarity, pure + tested in `test/phrase.test.js`), re-routed on the window alone and
  cut as a circle at the lead's first note. The whole song's LEAD is PINNED through that re-route
  (`_pin`), lead activity is measured on ONSETS (a held note is an idle arc), and the final belt is
  checked — a window whose lead strikes in < 70% of its bars falls back to the next-ranked one.
  `opts.window: 'auto' | 'full' | {fromBar, bars}`; the MAP panel offers LOOP / WHOLE SONG (rows show
  the loop's notes). Labels are guesses: "the chorus" only for a sung (vocal-named) lead.
- Every song now opens with a **`LEAD_IN` count-in** (`main.js`, default 2.4 s): `songTime`
  starts negative, so the machine runs solo before the marble spawns (and the pickup fill plays
  ahead of the downbeat). It's a feel knob — one const; tune freely.
- Greensleeves uses the F#/dorian variant; Gymnopédie is the theme stated twice; Canon's late
  cycles are faithful-in-gesture simplifications.

---

## 9. Roadmap → see [`VISION.md`](VISION.md)

The north star is the 3D music **creation + visualization tool**: pick instruments, place
them in the world, move/director the camera, author via MIDI import or a piano-roll / drum
grid. Shipped toward it: repo-ification, MIDI import (**now incl. channel-9 drums**), share
links, recording, the **conveyor + spawner** (archetype 1), and the **drum machine**
(archetype 2). Near-term, in rough priority:

1. **Drums on more songs**; **more kit pieces** (toms/clap/crash/ride — registry + fallback
   voices already exist, need geometry styling + use).
2. **Instrument mapping + world placement** on MIDI import (creation mode 1).
3. **Melody/drum editor** — piano-roll + drum-grid, exports the same song format (mode 2).
4. Personal/private only: Zelda transcriptions (Nintendo IP — keep out of the public
   repo/demo), more Peer Gynt.

---

## 10. Working agreements that served us well

- **Discuss the approach before editing — even small changes.** Talk through the shape, then
  cut.
- **Verify after every change**: `npm test` after ANY song/engine edit (the lock + drum +
  layout suites catch real mistakes); `node --check` after hand-edit batches; `npm run build`
  before claiming done.
- **Features as data first, engine second.** alto, delay, deep, the director, and the whole
  drum format all fell out of making the *data* richer rather than adding engine state.
- **The engine/physics is NEVER altered for visuals.** All conveyor/camera/drum framing is
  render-time only — "solved up front" is the moat. A note's visual size depends only on the
  note, never on spacing.
- **New instruments = a target + a launch solve.** Reach for `solveLaunch`/`arcPos`, not an
  integrator.
- **When iOS audio misbehaves**: read the status line, check `t=` motion, and remember rounds
  1–4 of §5 before writing any new code.
- Delegate simple, independent tasks to subagents in parallel; prefer light verification.

— Claude (chat-side) handed the marble to Claude (code-side); code-side has since built the
conveyor and the drums. It's a good machine with two instruments now. Keep the physics honest.
