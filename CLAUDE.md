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

**Production ≠ `main`.** As of 2026-10-05, `v2` was fast-forwarded into `main`:

- **Production** (cascade.ajsmithhq.com) still runs the original **falling-world**
  engine (the whole scene sinks; the marble rides it down) plus r184/bloom, MIDI
  import, share links, recording, autostart — i.e. the old `main` tip, `255c7d2`.
- **`main` (and `v2`) = the new engine**: the **static-band CONVEYOR** (§3) and the
  **MARBLE DRUM MACHINE** — the second instrument archetype (§4). **NOT deployed. Do
  not deploy it casually.**

Before any deploy of `main`, the gate is:
1. **Flip `convDbgOn` default → `false`** in `src/main.js` (the conveyor debug HUD —
   rulers + a height-over-time graph — is ON by default for dev; ship it OFF).
2. Confirm with the human. **No v2 deploy until a real v2 is declared ready.**

`npm run deploy` builds + ships to production. It does not care which branch you're
on. Treat it as live.

---

## 1. Repo layout, build & deploy

    src/engine.js    pure physics/music — solver, arcPos/arcVel, padOffset, beltPhase,
                     deployPose, layoutPads, noteHz (unit-tested, no THREE-scene/DOM/audio)
    src/audio.js     dual-path Web Audio + iOS sample fallback (see §5). Melodic voices
                     + percussion voices. Ported VERBATIM from the single-file build.
    src/juice.js     trail / ripple / spark / dust pools, spawnBurst, glowTex
    src/conveyor.js  the visible belt MACHINE (render subsystem): belt wall, pulleys,
                     cowls, articulated per-pad mounts. DI'd seam, no engine reach.
    src/camera.js    the camera RIG (render subsystem): director / fixed / free-fly /
                     follow modes, orbit + WASD/QE keyboard fly. "Sees the future."
    src/marbledrums.js  the MARBLE DRUM MACHINE (render subsystem): one ball per drum,
                     dribbling on its own head; pistons + electromagnets. Math lives in
                     engine.js (dribbleLane/dribbleAt/dribblePiston), tested in dribble.test.js.
    src/drums.js     SUPERSEDED juggling kit — no longer imported; delete when convenient.
    src/drumkit.js   the drum REGISTRY: canonical name ↔ GM note ↔ mix gain. One source
                     of truth for the song validator, audio, render, future MIDI import.
    src/midi/        MIDI import: parse.js (type-0/1 → tracks, FAITHFUL — keeps every
                     channel incl. 9, with velocity) + convert.js (→ song JSON, quantized,
                     lock-rule-correct; channel 9 → drum lanes via drumByGm — see §6).
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

**The generalization to hold onto:** a hit = **a target + a launch solve**. The melody
swaps "next pad" for the target; a drum swaps in a stationary drum. Future instruments
(lob / shoot / drop) swap only those two terms and stay just as solved-up-front. Audio
is part of the instrument too — we design the *sound of each hit* per instrument (§5).

Status: drums are implemented (kick/snare/hat + a **five-tom set** voiced + rendered — one
floor tom; GM 41's low floor tom is merged onto it via `GM_MERGE` in drumkit.js;
clap/crash/ride reserved in the registry, voiced as fallbacks). Toms are **pitched** — each
carries a `tone` (Hz) in the registry and a real membrane voice (downward bend + stick
attack), so a descending fill reads and sounds as a tonal cascade (this is what makes an
imported intro tom roll land). **Mountain King** carries a hand-authored `drums` block; any
song can get one, and **MIDI import now generates drums from channel 9** (§6).

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
only INSERTED).** Every live voice takes an optional placement `sp = {pan, gain, lp}`
(`playNote(note, deep, sp)`, `playDrum(name, vel, sp)`, `playVoice(key, vel, {dur, sp})`).
main.js's `placeAt(worldPos)` projects the strike into CAMERA space at strike time and
`src/spatial.js` (pure, tested) maps it: pan by bearing (eased cubic, clamped ±`PAN_MAX`
.75 — never hard-panned), full gain inside `REF_DIST` 22 u then a gentle rolloff floored at
`MIN_GAIN` .55, and an air lowpass only past 1.25·REF_DIST. As the director cuts, the next
strike's image follows the shot. Graph tail: `out → busTrim → glue comp → limiter → ceiling
= mixOut → destination / iOS MediaStreamDestination / recording tap` — speakers, the iOS
mirror and recordings all get the same never-clipping mix. Knobs live in `MIX` (audio.js):
`voiceTrim` .5 (plugin voices render ~.8 peak — this seats them with the belt), `busTrim`,
`glue`, `limit`, `ceiling` (DynamicsCompressor adds its own makeup gain — re-measure if you
touch these), and the room reverb (`revSecs/revSend/revReturn`): a ConvolverNode on a send
for plugins marked `wet`, its IR computed **synchronously** in `roomIR()` (round 1 was an
ASYNC IR leaving the convolver silent; a same-tick buffer can't be). `?debug` →
`__dev.audioProbe()` reports glue/limiter gain reduction + the reverb-return peak. The iOS
`<audio>` sample path can't pan/bus — it plays exactly as before.

---

## 6. Song data format & THE LOCK RULE

```js
'song-key': {
  label, sub, bpm,
  scale: [...pitch classes...],        // drives pad-rim hue mapping
  melody: [['F#5', 1], ...],           // [note, beats-until-next-hit]  (MONOPHONIC, chained)
  alto:  [...] | {delay, deep, notes}, // optional; delay = beats of rest
  bass:  [...] | {delay, notes},       // optional
  drums: { kick:[0,1,2,3], snare:[1,3], hat:[0,.5,1,...] },   // optional; see below
}
```

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
- **The visible machine** (`conveyor.js`): belt wall + pulleys + cowls + four-post
  articulated per-pad mounts, built per track in its local bay frame (`tr.stage`). Key `M`
  toggles it for A/B. It only draws what the conveyor math already implies (§3).
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

Dev toggles: `G` = conveyor debug HUD (rulers + height graph; `convDbgOn`, ON by default —
**flip before deploy**, §0). `M` = machines on/off. `?debug` = a scrub bar (time is the only
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
  render in the roll-in; a pickup longer than the roll-in (`~ROLL_T/BEAT` beats) can clip.
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
