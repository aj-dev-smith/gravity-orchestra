# CASCADE — marble melody machine
## Handoff brief for Claude Code

This project began as "a shiny track, a glowing marble, surfaces to bounce off" in
a Claude.ai chat artifact and grew into a multi-track ballistic music engine.
It went mildly viral after the three.js account reposted it (~30k views).
It is now a Vite + ES-module repo (`src/`) bundling three.js r128. The single
self-contained `marble-cascade.html` still exists as the shareable "viral unit"
— but it is now a BUILD ARTIFACT (`npm run build:single`), not the source of
truth. Live at https://cascade.ajsmithhq.com.
This document is the scar tissue: what the architecture means, what must never
break, and what we already know we want next.

---

## 0. Repo layout, build & deploy (added when we repo-ified)

    src/engine.js   pure physics/music — solver, arcPos/arcVel, padOffset, noteHz (unit-tested)
    src/audio.js    dual-path Web Audio + iOS sample fallback — ported VERBATIM (see §3)
    src/juice.js    trail / ripple / spark / dust pools, spawnBurst, glowTex
    src/songs/*.js  one module per song (the comments are sacred), aggregated by index.js
    src/main.js     scene, rigs, buildWorld, trackPos, animate(), controls — the orchestrator
    test/           Vitest: song lock-rule + engine ballistics

    npm run dev            # vite dev server (add --host to reach a phone on the LAN)
    npm test               # vitest — run after ANY song or engine edit
    npm run build          # → dist/  (hashed assets; what deploy.sh ships)
    npm run build:single   # → marble-cascade.html  (self-contained viral artifact)
    npm run deploy         # build + ./deploy.sh → S3 sync + CloudFront invalidation

Deploy: private S3 bucket `cascade.ajsmithhq.com` (CloudFront OAC) → CloudFront
`E1U4B3EV2WPMZS` → ACM cert + Route53 alias. three.js is r128 pinned in
package.json. The module seams are deliberately thin: audio takes `setBeat(beat)`
+ `rebuildBank(tracks)`; juice takes `initJuice(scene)` then `spawn*`/`updateJuice`.

---

## 1. The core idea (do not lose this)

**The melody is authored first; the physics is solved backward from it.**
Pads are not simulated — each pad's launch velocity is the closed-form ballistic
solution that lands the marble on the next pad in exactly the note's duration:

    v0 = (ΔP − ½·g·dt²) / dt

Position during an arc is the analytic `P(t) = P0 + v0·t + ½·g·t²`. There is no
integrator, therefore no drift, therefore audio/visual sync is structurally
perfect forever. Rhythm is literally visible: long notes = tall arcs, fast runs
= flat skims (apex height scales with dt²).

**Visuals drive audio.** Notes trigger when the timeline crosses a segment
boundary in `trackPos()`, never from a scheduler. If you add a scheduler you
will create drift. Don't.

**Time is the only state.** `T = clock.elapsedTime % (ROLL_T + LOOP_T)`. Every
marble position, pad swing, and anticipation glow is a pure function of T.
This is why the director camera can "see the future" — keep it that way.

## 2. Architecture map (sections of the file, in order)

- `SONGS` — all musical content. Pure data. See §4.
- Mutable song state + camera mode + `renderCamButtons()`
- Renderer/scene/env: one-shot procedural env map via CubeCamera → real chrome
  (`MeshStandardMaterial` metalness 1). No image assets anywhere.
- Marble rigs (`makeRig`): lead amber r=.26, bass ice-blue r=.36, alto violet
  r=.21. Each has a `deform` group (squash & stretch) inside the position group.
- Pools: trail sprites (shared, tinted per spawn), ripples, spark particles
  (`spawnBurst`), dust field (spans y +16..−144 for long songs).
- `buildTrack(melody, zBase, role, rig, delayBeats, deep)` — solver + rail +
  pads + landing pool for one track. `buildWorld(key)` — disposes old world
  group, assembles lead/alto/bass lanes, rebuilds sample bank, revalidates
  camera mode.
- Audio (§3 — read it twice).
- `padOffset(phase, A)` — the flipper curve (§5).
- `trackPos(tr, T)` — position, velocity, plunge flag, next pad index,
  progress, current & next note durations. The heart.
- `animate()` — per-track marble/rig/pad updates, particles, director,
  camera, shake, exposure pop.
- Controls: play (gesture → clock + audio + wake lock), song select,
  camera buttons, mute.

## 3. THE iOS AUDIO WAR (most expensive knowledge in this file)

We fought four rounds getting sound to work in the Claude iOS app's artifact
iframe. The final system is dual-path. Symptoms → causes we hit, in order:

1. **Tone.js silently failing** — its Reverb generates an impulse response
   asynchronously; a ConvolverNode with no buffer outputs pure silence with no
   error. We removed Tone entirely. The synth is ~40 lines of raw Web Audio
   (triangle + detuned 2.004× partial + inharmonic 2.76× "music-box tine" +
   4.2× sparkle; bass voice = sine + sub-octave 0.5× partial + 2.002×).
2. **Zombie AudioContext** — an AudioContext created *before* the first user
   gesture in iOS WebKit can report `state === "running"` while
   `currentTime` stays frozen at 0 and emits nothing. Fix: construct the
   ENTIRE context inside the gesture (`buildAudio()` from the play tap).
3. **Watchdog rebuild trap** — our first watchdog rebuilt the context from a
   `setInterval`. A context born outside a gesture is guaranteed-suspended, so
   it rebuilt 4 zombies in a row. Rebuilds may ONLY happen inside tap handlers.
   The watchdog now only reports; `touchend`/`pointerdown` handlers retry.
4. **The iframe denies AudioContext activation outright** (permissions policy
   in the artifact preview) — `resume()` from a genuine gesture still left it
   suspended, while `<audio>` element playback was allowed. This is the wall
   no JS climbs, hence:

**Plan B — the path that actually plays in the iOS app:** every unique
(note, timbre) pair is synthesized in pure JS (`renderNoteWav`: 22050 Hz,
16-bit mono WAV with the echo BAKED IN, ~2.6s lead / 3.0s bass), wrapped in a
Blob URL, loaded into its own `<audio playsinline>` element, and
**primed** on the first tap (`play()` then `pause()` inside the gesture —
this unlocks each element for later programmatic playback). `playNote()`
prefers the live Web Audio path when `ctx.state==='running' &&
ctx.currentTime > .05`, else fires the element. The status readout
(bottom-right) shows state / clock / active path — keep it, it's how we debug.

Hard-won iOS facts: `el.volume` is **ignored** on iOS (you cannot mix element
levels — that's why timbre/level differences are baked into the WAV renders);
element playback has ±30–50 ms latency jitter (audible swing on <0.3s runs —
acceptable; the webaudio path is tight); phone speakers roll off below
~200 Hz, so all bass lines are written in octave 3/4 with a sub-octave
partial supplying depth on real speakers; bank keys are `note + '|b'` flagged
by `tr.deep` so the same pitch can exist in both voices.

Also: `MediaStreamDestination → <audio el>.srcObject` is wired as a parallel
output on iOS. The wake lock (`navigator.wakeLock`) keeps the screen on.

## 4. Song data format & THE LOCK RULE

```js
'song-key': {
  label, sub, bpm,
  scale: [...pitch classes...],        // drives pad-rim hue mapping
  melody: [['F#5', 1], ...],           // [note, beats-until-next-hit]
  alto:  [...] | {delay, deep, notes}, // optional; delay = beats of rest
  bass:  [...] | {delay, notes},       // optional
}
```

**THE LOCK RULE: for every track, sum(beats) + delay must equal the melody's
sum exactly**, or it desyncs at the loop seam. Verify after ANY song edit:

```js
// node verify.js — extract SONGS, then:
const sum = a => a.reduce((s,[,b])=>s+b,0);
// assert sum(part.notes) + (part.delay||0) === sum(melody) for alto & bass
```
(Port the inline checker we used in chat into a real `verify.js` / test.)

Notes are `[A-G]#?\d` (sharps only — translate flats). `deep:true` on a
non-bass track selects the sub-octave voice (used by Dies Irae's echo).
`delay` makes the marble roll its rail lazily and its chain start lower
(`y0 = −2.2·delay·BEAT`) so delayed entries still descend in formation —
descent is time-proportional (`Δy = 2.2·dt`) precisely so parallel tracks
fall together. bpm is the single tempo knob; everything re-solves from it.

Current catalog (9): Für Elise (duo, rolling arpeggio LH, 4-beat entry rest),
Ode to Joy (trio, thirds alto), Canon in D (TRUE canon — alto = lead's exact
line one full 16-beat ground later, octave down; 4 escalating variation
cycles), Greensleeves (6/8 lilt), Gymnopédie 1 (slow float), Prelude in C
(single track — harmony lives in the line; camera buttons auto-hide),
Mountain King (accelerando: same phrase at 1/.75/.5/.375 scale),
Toccata in Dm (a 6.5-beat pedal lob — the engine's biggest launch),
Dies Irae (deep canon echo, delay 5).

## 5. Juice systems (and their contracts)

- **Flipper pads** (`padOffset`): wind-up (W = .3 + A·.35), stroke (last
  100 ms), follow-through wobble. CONTRACT: offset must be ~0 at phase 0 —
  the pad arrives at rest exactly at impact so contact is honest. Amplitude
  `A = clamp(launchVelocity·padNormal × .07, .05, 1.6)` — fast notes barely
  move (gravity sells them), big lobs telegraph like catapults.
- **Squash & stretch**: `deform` node oriented along velocity; stretch
  `1 + min(speed·.014, .4)`, impact squash to .55 decaying ×(1−9dt).
- **Anticipation glow**: next pad's rim brightens with `prog²` — possible
  only because the timeline is analytic.
- **Sparks** (`spawnBurst`), camera micro-shake (lead strikes, capped .15,
  skipped under `prefers-reduced-motion`), exposure pop (ACES exposure
  1.15 + kick·.2), pool splash on plunge.
- **Director cam** (`camMode='auto'`, default): cuts to any track whose
  current-or-imminent note dt ≥ 1.05s (it pre-cuts during wind-up via
  `nextDt` once prog > .55); lead shred-cam when lead dt ≤ .33; else wide.
  2.2 s cut hysteresis. Cuts are lerps, not snaps.

## 6. Known issues / honest limitations

- Sample-path latency jitter on fast runs (iOS element playback). Unfixable
  in the iframe; fine in Safari/desktop where webaudio path wins.
- Same-note retrigger cuts its own tail (one element per note+voice). Could
  pool 2 elements per note if it ever bothers anyone.
- Camera can briefly lose a marble during extreme spread if AUTO is off and
  a single-track cam is chosen — by design (user's choice).
- Greensleeves uses the F#/dorian variant; Gymnopédie is the theme stated
  twice (a tasteful excerpt, not the full form); Canon cycles 3–4 are
  faithful-in-gesture simplifications of the violin figuration.
- r128 is old. Upgrading three.js means: `outputEncoding` →
  `outputColorSpace`, geometry/material API audits, but BUYS postprocessing
  (UnrealBloom would replace the fake sprite glow beautifully).

## 7. Roadmap (discussed and wanted, in rough priority)

1. **Repo-ify** ✅ DONE — Vite + ES modules (engine/audio/juice/songs split,
   `verify` is now a Vitest suite, single-file build via vite-plugin-singlefile).
   Songs are `.js` not `.json` to preserve their commentary. See §0.
2. **Recording/share**: canvas `captureStream()` + MediaRecorder; mix audio
   in via the webaudio path's MediaStreamDestination. This is why the dual
   output bus already exists — recording was anticipated.
3. **MIDI import**: parse type-0/1 MIDI → tracks (quantize dt to the data
   format). Instantly unlocks the whole public-domain repertoire.
4. **Melody editor**: tap-out rhythm + piano-roll lite, exports song JSON.
5. **Bloom + color grading** post-upgrade.
6. AJ's personal wishlist: Zelda transcriptions for private use (Nintendo
   IP — keep out of the public repo/demo), more Peer Gynt, possibly a
   percussion track type (click-transient-only pads).

## 8. Working agreements that served us well

- Verify lock totals after every song edit (it caught real mistakes).
- `node --check` the extracted script after every hand-edit batch.
- New features as data first, engine second — alto, delay, deep, and the
  director all fell out of making `trackPos` richer rather than adding state.
- When iOS audio misbehaves: read the status line, check `t=` motion, and
  remember rounds 1–4 above before writing any new code.

— Claude (chat-side), handing the marble to Claude (code-side). It's a good
machine. Keep the physics honest.
