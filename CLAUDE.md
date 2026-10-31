# GRAVITY ORCHESTRA (née CASCADE) — marble melody machine
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

**The 2026-10-07 overnight wave** (merged from `ov/*` feature branches onto `overnight`) was
fast-forwarded into `main` and deployed on 2026-10-08. What it is and how to try each piece:
[`docs/OVERNIGHT-2026-10-07.md`](docs/OVERNIGHT-2026-10-07.md). Rollback target = 189abf7.

`convDbgOn` (the conveyor debug HUD — rulers + height graph, key `G`) now defaults to
**`false`**. Keep it off in anything you ship.

**Open-source launch (2026-10-08, branch `launch-prep`):** renamed **Gravity Orchestra**, MIT. The
user-visible brand (title, HUD, XR menu, turntable label, studio neon, recording filename) says
Gravity Orchestra; internal names (`cascade:` localStorage keys — renaming them would wipe saved
layouts — console prefixes, `marble-cascade.html`, the domain) are deliberately unchanged.
`deploy.sh` reads `DEPLOY_BUCKET` / `CLOUDFRONT_DISTRIBUTION_ID` / `LIVE_URL` from the environment
or a git-ignored `.env.deploy` (template: `.env.deploy.example`).

**The JUGGLER belt + the Gravity Orchestra rename SHIPPED 2026-10-24:** `main` was fast-forwarded to
`launch-prep` (the rename/MIT commit + the juggler) and deployed — the live site says Gravity
Orchestra now. The melody belt is ONE multiball juggling machine for every belt voice (§3b); the
classic belt (a paternoster bay + one marble per voice) and its crane planner are deleted
(`d6e8758` and earlier have them). Rollback target = `d6e8758` (the 2026-10-08 build). (Pushed to GitHub 2026-10-30 with the staging world; the repo itself is still private.)

**PLANNER-FIRST + the transport SHIPPED 2026-10-24** (AJ: "under no circumstances does a song start
before the planner is done … a start stop and restart button"; `main` fast-forwarded to the
`planner-first` commit, deployed; rollback target = `b0cdc97`): a song never reaches songTime 0 before
its belt's plan is in — the count-in runs while it is solved, then waits (§3b, `src/transport.js`); the
machines sit the count-in out (ARM_AT, §7 Transport); the search runs as parallel worker jobs and a
page remembers its plans (same plans, bit for bit); the HUD has ■ STOP / ▶ START and ↺ RESTART.


**STAGING WORLD SHIPPED 2026-10-30** (`main` fast-forwarded to `staging-world`, deployed, and `main` pushed to
GitHub; rollback target = 6db6c8c). The floor came up (-22 to -5.5), machines are set IN the rooms with a
per-machine lift, supports are styled by each room by height band, rooms react to strikes, the layout is
floor-first, EDIT STAGE edits height, and the belt + the hung machines (organ, ricochet, volley) move (wave 5).
Its changelog and guide: [`docs/STAGING-WORLD.md`](docs/STAGING-WORLD.md).

`npm run deploy` builds + ships to production. It does not care which branch you're
on. Treat it as live, and confirm with the human before running it.

---

## 1. Repo layout, build & deploy

    src/engine.js    pure physics/music — solver, arcPos/arcVel, padOffset, beltPhase,
                     deployPose, padRadius, noteHz (unit-tested, no THREE-scene/DOM/audio)
    src/audio.js     dual-path Web Audio + iOS sample fallback (see §5). Melodic voices
                     + percussion voices. Ported VERBATIM from the single-file build.
    src/juice.js     trail / ripple / spark / dust pools, spawnBurst, glowTex
    src/juggle.js    pure: THE BELT's plan — the JUGGLER (§3b): every belt voice on ONE machine,
                     juggled multiball. test/juggle.test.js. src/jugglebelt.js draws it (render
                     subsystem); src/juggle-baked.json = the catalog's solves (scripts/juggle-bake.mjs);
                     anything else: src/jugglejobs.js runs the search as parallel worker JOBS
                     (src/juggle.worker.js hosts one), src/jugglecache.js remembers what this page
                     solved (localStorage). test/jugglejobs.test.js, test/jugglecache.test.js.
    src/transport.js pure: how songTime moves — THE PLANNER GATE (a song never reaches songTime 0
                     before its belt's plan is in), STOP / START, the belt's count-in spin-up, and
                     ARM_AT (every machine's `start`: they sit the count-in out). transport.test.js.
    src/paternoster.js  the belt's PARTS KIT (render, THREE only): tone-plate, brass node cradle,
                     chain sprocket, drive gear, housing wash, merge / bakeStill + the PTGEO
                     dimensions — what's left of the classic per-voice paternoster (retired 2026-10-24).
    src/crane.js     pure: the MAGNET CRANE's limits + motion primitives — CRANE dwells / V / A
                     limits, dtFree (the free-flight cap), segEval (quintic carriage moves),
                     minMoveT. juggle.js plans every carriage with them. test/crane.test.js.
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
                     test/inst-<key>.test.js. Shipped (15): marimba, bells, bass, musicbox,
                     bowls, turntable, ricochet, volley + (2026-10-07) riff, strum, pogo,
                     organ, horns, bowwheel, dulcimer (§4). sustain.js = the shared iOS
                     DURATION-BUCKET ladder ('<base>~<hold>' ids, §4b) — test/sustain.test.js.
    src/drumkit.js   the drum REGISTRY: canonical name ↔ GM note ↔ mix gain. One source
                     of truth for the song validator, audio, render, MIDI import.
    src/cymbals.js   pure cymbal DSP: clawd-o-matic's metal() (40–160 inharmonic modes + noise
                     bands) → crash / ride ×2 / rideBell / china / splash / hatOpen / clap. One
                     render feeds live hitDrum AND the iOS WAV. Pose math: drumparts.js
                     (cymbalPose / cymbalPiston). test/cymbals.test.js.
    src/dynamics.js  pure: belt velocity (3rd melody element), velGain = THE velocity law for the
                     belt pluck + drums, legacyVel/legacyLane. test/dynamics.test.js.
    src/ridecam.js   pure RIDE-THE-BALL pose (ridePose / rideMoments / rideWindowAt): eye on the
                     smoothed marble path LAG behind, aim LOOK ahead, comfort-limited. ridecam.test.js.
    src/rooms/       ROOMS (index.js registry, R cycles, ?room=<key>): grid, cathedral, studio,
                     void, graveyard + arena (Metal Arena — arena-cues.js solves pyro/CO2/
                     blinders from the drum lanes at load, pure, test/arena.test.js) + starship
                     (sky banks per phrase, deck never moves — test/room-starship.test.js).
                     FOOTING — what every machine stands on (§7 Rooms): footing.js (pure planner:
                     pads by height band, lofts, stairs / ladders, envelopes — test/footing.test.js),
                     footing3d.js (the render kit + DEFAULT_STYLE + tintStyle, a room's own
                     materials — test/footing3d.test.js),
                     pulse.js (pure: a strike cue → a light envelope of songTime — test/pulse.test.js).
                     Each room's own footing STYLE + reactions + props: grid-{shade,footing,floor,plot}.js,
                     cathedral-{footing,props}.js, studio-{footing,atlas,vu,props}.js, void-{isles,ground,
                     footing}.js, graveyard-{footing,place}.js, arena-{footing,props,cues}.js,
                     starship-{footing,deck}.js (tests: test/room-<key>.test.js, arena-staging, arena-props).
                     The machines are SET IN the rooms: docs/STAGING-WORLD.md.
    src/editor/      the creation tools: stage-edit.js (EDIT STAGE), placement.js (layout entries
                     [x, z, yaw, lift?], history with undo + redo), mapping.js + panel.js (MAP), and
                     height.js (pure: the RCT-style HEIGHT rules — snap ½ u, magnets, metres, band names,
                     liftMax — test/editor-height.test.js).
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
                     src/xrmenu.js (the in-world menu, Y) · src/xrdetail.js + src/xrbatch.js (the VR
                     DETAIL PROFILE, headset render only, undone after it) — test/xrperf.test.js
    src/stagepose.js pure: the belt's STAGE POSE T = {x, z, yaw} — toWorld / toStage, stageRoom, clampPose,
                     poseOf; every staging solve runs in the belt's frame, placed by T. test/stagepose.test.js
    src/share.js     song ⇄ deflate→base64url share links
    src/record.js    canvas captureStream + MediaRecorder → "one perfect loop" video
    src/songs/*.js   one module per song (the comments are sacred), aggregated by index.js
    src/main.js      scene, rigs, buildWorld, ballPos, animate(), controls — the orchestrator
    test/            Vitest: engine ballistics, song lock-rule, drum validation, MIDI, the
                     juggler's plan audit + bake, share round-trip, every plugin's honesty suite,
                     staging audit + footing, director, XR (64 files / 2913 tests, 2026-10-26; ~1.5 min)
    docs/OVERNIGHT-2026-10-07.md   the night's changelog: what each new machine / room / song
                     is and the URL to try it
    docs/STAGING-WORLD.md   2026-10-25 staging world (branch staging-world): floor, lift, footing, rooms
                     that react, floor-first layout, height editing — changelog + the room footing contract
    VISION.md        the product north star (vision, not spec)
    docs/PLAN-*.md   design notes: PLAN-{real,seamless}-conveyor (how the static band
                     was reasoned out) + PLAN-staging (instrument/room/support/placement
                     abstractions + the human-curation-over-auto-layout decision)

    npm run dev            # vite dev server (add --host to reach a phone on the LAN)
                           #   ?solo=<instrument> = that plugin's own demo, camera on its station
                           #   ?song=<key> · ?room=<key|off> · ?midi=<url> · ?debug (__dev + scrub bar)
                           #   share links are #s=<deflate-b64url>
    npm run dev:xr         # https (self-signed) + LAN host → a Quest can open it (docs/XR.md)
    node scripts/xr-shot.mjs  # IWER-emulated Quest 2 in headless Chrome: enter VR, teleport, stereo shot
    node scripts/xr-perf.mjs  # XR draw calls per song × pad (--detail full = profile off)
    node scripts/shot.mjs  # headless screenshots (own browser per call — parallel-agent safe;
                           #   puppeteer-core is a devDependency — if it's missing, `npm i`)
    node scripts/staging-audit.mjs --base http://localhost:<port> --norun 1 \
        --rooms grid,cathedral,studio,void,graveyard,arena,starship \
        --fixture test/fixtures/staging-rooms.json   # regenerate the staging fixture (every song ×
                           #   room + the 2 MIDI fixtures; the test pins the room list) — re-run on the
                           #   MERGED tree after ANY new song / station / room (one whole-file rewrite)
    node scripts/director-audit.mjs  # every song's shot shares
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

## 3. The STATIC BAND (v2's big render move)

The original engine let the whole world fall: `T = clock % P`, every track sinking at
`DESCENT` (2.2 u/s), the camera craning down to follow. v2 keeps **all of that physics
untouched** and reframes it at **render time** into a *static band*:

- Each tone-plate **RECIRCULATES**: it rides its chain up to a fixed strike band (`STAGE_Y =
  DESCENT·ROLL_T ≈ 5.7`) exactly at its strike, then wraps off-screen and comes around again.
  The map from songTime to a plate's centred height is `beltPhase(songTime, strikeTime, period)`
  — 0 at every strike, negative just before (rising to meet the ball), positive just after. The
  only discontinuity is the off-screen wrap, so plates stream upward forever with no loop snap.
- Every strike happens ON the band, so every flight runs strike line → strike line: an honest
  free arc under the one G (apex = |G|·F²/8 — rhythm as height), or a magnet carriage's catch and
  release when the gap is too long for a free flight (§3b).
- The two mechanisms share no state. They meet at the band, at strikes, **by construction**
  (`beltPhase` is 0 at a strike). The visible machine only ever *draws what the math implies*:
  chains scrolling at `DESCENT` and plates rising at `DESCENT` are slip-free with zero state.

History (gone from the tree since 2026-10-24 — git history on `main` has it): the CLASSIC belt
gave each voice its own paternoster bay (side by side) and ONE marble — first mortal (born each
loop, a per-ball render lift `+ DESCENT·τ` over the falling-frame arcs, plunged out and recycled),
later conserved by a magnet crane (crane hops, apex kisses, early-stowing plates). The juggler
(§3b) replaced it. `docs/PLAN-seamless-conveyor.md` and `docs/PLAN-real-conveyor.md` are the
reasoning trail for the static band itself.

### 3b. THE BELT — the JUGGLER (2026-10-24; the only belt since the classic was removed)

Why: every classic strike was on one strike line, so a ball left at g·F/2 — below F ≈ .30 s it
rose slower than its own plate and got swept sideways (the high-speed "skim", 56–82 % of notes
in the fast songs), and three voices meant three bays side by side (Dies Irae ≈ 56 u wide).

What: ONE machine for every belt voice. Nine keyboard LANES (a note's lane is a pure fn of its
pitch, low left), one roller chain each; each voice its own depth row with TWO HANDS (a ball may
cross hands in flight); M ≤ 4 balls per voice, each held by its own MAGNET CARRIAGE on a rail over
its hand (a catch is a straight-up throw docking at v = 0; a release free-falls onto the beat).
Plates are posed from the strike (normal ∝ Δv, stroke speed w from restitution). Each WINDS UP
(pulls back along −n by amp = .07 × the throw along n — the old pad's swing) and SWINGS into
the ball, arriving at exactly w (a Hermite: the work is visible, the contact honest), then RECOILS
(faster than g), so the minimum flight is F_HARD .22 s, not .30. After the strike a plate HOLDS
out, rising with its chain, up to HOLD_MAX .8 s, then folds (FOLD_T): `holdPlates` (after the
search, ≤ ~.2 s) grants a hold only while the plate AND its arm stay clear of every ball, plate
and arm of the whole machine. The search itself plans every plate folding at once, so a hold
never costs the plan anything; plates whose own ball is still above them when the chain catches
up (mid-length flights to a nearby lane, ~10–40 %) fold at once as before. AJ's note
(2026-10-24): the swing ("the pads did some work") and the hold ("too rushed") came from
watching it; the chains were "too loud" and are now dark rough steel, the return run in shadow.
Every ball is home across the breath. The beam search (who strikes what, on which hand) runs per
voice; the audit (no ball–ball / ball–plate / ball–ARM / carriage contact, limits, conservation,
periodicity) is the test. The arm's geometry (shoe on the chain → hub behind the plate) lives in
the plan (`plateAt` → `hub`, `shoe`; `JUGGLE.ARM`), so the render draws what the check cleared.

How it runs: the SEARCH takes up to seconds (Bald Mountain ≈ 10 s on one core), so a page load
never runs it — `layoutJuggler` (fast) + the BAKED solve (with its holds) keyed by
`jugglerKey(song)` (the belt notes + bpm + `JUGGLE_VERSION`), else a plan THIS page solved before
(`src/jugglecache.js`: localStorage, same key, LRU ≤ 40 plans / 1.5 MB, a bad entry is dropped and
re-solved), else the WORKERS solve it while the machine stands ready but empty, then main swaps the
full machine in. The search is split into pure JOBS — one per (voice, beam width), `solveVoiceAt`,
settled per voice exactly as `solveJuggler` decides (`settleVoice`: the first width whose best plan
is clean, else the best of all), then one HOLDS job — and `src/jugglejobs.js planInWorkers` runs
them side by side (≤ min(3, cores − 1) workers, narrow widths first, a voice's wider job cancelled
once it settles): the SAME plan, bit for bit (test/jugglejobs.test.js checks it against the bake;
all 96 catalog + MIDI plans fingerprinted identical). 71 MIDIs: solve median 1.2 → .9 s, p90 5.0 →
3.2 s, worst 9.9 → 7.3 s. **THE PLANNER GATE (src/transport.js `advance`): a song NEVER reaches
songTime 0 before its plan is in** — the count-in runs WHILE the plan is solved, then WAITS at
−RUN_IN (1.2 s; the note line reads "planning the juggle…"), so a solve under ~1.2 s costs nothing
(a dropped MoP: first note 7.9 → 5.9 s after the drop, its 1.1 s solve hidden in the count-in) and
a long one starts the moment it lands. Every other machine sits the count-in out ARMED (§7
Transport). A failed solve never starts (the note line says so). (History: before the gate, the
timeline held at −LEAD_IN for the whole solve and THEN counted in; before that an import ran on
with a silent belt.) **After ANY change to juggle.js that can change a plan: bump `JUGGLE_VERSION`,
run `node scripts/juggle-bake.mjs`** — test/juggle.test.js fails on a stale or missing bake (it
compares every catalog solve against it); a cached plan simply misses (the key carries the version). `tracks` are thin VIEWS of
the plan's voices (role / pads / rollT / total / deep / V), so the camera, director, audio bank and
rides read them. Ball identity (`ballAt`) is a pure fn: the ride cam rides one ball.
The COUNT-IN spins the machine up (transport.js `spinTime`: a slowed clock, at rest R s before
songTime 0 and at full speed, C1, at 0, covering only the breath after the last dock — R = LEAD_IN
for a plan in at the build, what is left of the count-in (≥ RUN_IN) for a worker's; a pending
machine stands still) — the belt is silent in the count-in; the loop's last bar never plays
before the first note. Key `M` hides the machine's
frame (`jug.frame`: housings, chains, gantry) — plates and balls stay.
Residuals (pinned in the test's KNOWN): Bald Mountain lead 8 limit overruns + 1 alto ball–ball
(6 cm), Mars 1 throw at 10.7 u/s. `node scripts/juggle-report.mjs` prints the catalog's numbers.

---

## 4. Two instrument archetypes (the extensibility bet)

VISION.md's core bet: adding an instrument = **design a 3D shape + solve its physics**,
nothing more. The unifying runtime primitive is a **ball spawner** — mortal balls, born
→ fly a solved arc → strike → die. Two archetypes already cover huge musical ground:

1. **CONVEYOR — juggled balls, moving instrument** (the melodic voice). A belt
   *manufactures* the right plate for each note (sized to register, in its pitch's lane, tilted
   to its bounce); a voice's balls chain plate → plate, each plate launching its ball to that
   ball's next note — a dense line juggles more balls instead of one ball flying faster.
   `juggle.js` + `jugglebelt.js` (§3b). Range is effectively unlimited — the belt produces the
   plate on demand. (The classic was ONE marble per voice, chaining every note: §3 history.)
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
   score), **bowls** (SUSTAINED — a marble orbits the rim for the note's duration). Then
   **turntable** (one marble reads a record), **ricochet** (a FROZEN elastic orbit — one marble,
   phosphor plates), **volley** (two pad walls trade one marble across a flying court — steel pan).

   **2026-10-07 — seven more, built in parallel overnight** (docs/OVERNIGHT-2026-10-07.md). They
   fall into two FAMILIES that share solve ideas (not code — each plugin stays one folder):
   - **The GUITAR family — a fretboard + a striker per string.** A fret CARRIAGE per string slides
     to the luthier fret `L·(1−2^(−f/12))` and presses (pitch is position); a beam search fingers
     notes onto strings within the carriage/striker drive limits, run twice so the seam agrees.
     **riff** (Riff Forge: six strings, a solenoid STAMP per string lands on the beat at V_IN and
     rebounds e·V_IN, Hermite hops between hits, latch-park > .5 s; felt palm-mute bar; chord =
     ONE voice id 'E2+B2+E3'; Karplus-Strong → 3-stage tanh amp → 4×12 cab), **pogo** (Pogo Bass:
     four strings E1–G2, a pogo stick per string bouncing on `dribbleLane` gravity — hop =
     |G|·gap²/8, > 1 s parks on a boom magnet, a pump supplies Δv; KS + split-pickup comb + an
     ~800 Hz growl path so the line reads on phones), **strum** (Marble Autoharp: one string per
     pitch, ONE marble plectrum on a cable-driven carriage sweeps the whole fan like a real
     autoharp — string j releases at the marble's flight time to it, a 2-D stick-and-slip pluck;
     felts on solenoids are the chord shape AND the note-off; down on the beat, up on the "and").
   - **The SUSTAIN family — duration is a visible distance.** The note lasts exactly as long as a
     solved motion takes, and all five fire iOS duration buckets (§4b). **organ** (Light Organ:
     a pipe + bellows + conserved marble per pitch; the marble's weight sinks the lid at s/dur, so
     the pipe sounds while the bellows empties; gap → RIDE the refilling lid / HOP a solved arc /
     PARK on its magnet; a light packet 7×dur long runs up the pipe; organ / '|choir' / '|pad'),
     **horns** (Bellows Horns: a magnet drops each horn's marble onto its bellows lid, the lid
     sinks for the note (speed ∝ 1−(s/h)³, never accelerating down), a ram throws it back at
     note-off; tuba/trombone/trumpet by register with real slide positions + valve fingerings;
     'stab:' ids for short accents), **bowwheel** (Bow Wheel: a hurdy-gurdy — a rosined wheel at
     constant ω, a marble drops into each string's tangent cup and its weight presses the string
     onto the rim exactly on the beat; held = bowed; note-off launches it to hop back or park),
     **dulcimer** (Marble Grand: a real piano action made of marbles — a piston kicks the hammer
     ball UP into the string at the 1/7 point, lossy rebound into a waiting cup, double-escapement
     repetition lever, dampers lift 85 ms before; modal stiff-string voice, ':p' soft layer, ':e'
     FM Rhodes), and the older **bowls**.
   **Real cymbals** joined the kit the same night (§4 Status). Every family machine exports
   `PART_LIMITS` and is a MIDI routing target (§6, `src/midi/orchestra.js` PREFER / LINE_HOME).

**The generalization to hold onto:** a hit = **a target + a launch solve**. The melody
swaps "next pad" for the target; a drum swaps in a stationary drum. Future instruments
(lob / shoot / drop) swap only those two terms and stay just as solved-up-front. Audio
is part of the instrument too — we design the *sound of each hit* per instrument (§5).

Status: drums are implemented (kick/snare/hat + a **five-tom set** voiced + rendered — one
floor tom; GM 41's low floor tom is merged onto it via `GM_MERGE` in drumkit.js, as are the
other kick/snare (35/40/37), pedal hat + shakers (→ hat), crash 2 / ride 2 (57/59) and hand
drums (→ toms)). **REAL CYMBALS**: crash (49), ride (51), ride bell (53), china (52), splash (55)
are pieces of their own, voiced by `src/cymbals.js` (clawd-o-matic's `metal()`: 40–160 inharmonic
modes + decaying noise bands; one pure render feeds the live AND the iOS path; hatOpen + clap use
it too). Each hangs on a boom; its ball strikes its ZONE (crash = edge, ride = bow, ride bell =
bell — the ride's own cymbal, a second ball), the cymbal then swings as a damped pendulum, and a
magnet CLAMP under the bell levels it before every strike, parks it, and CHOKES it when a hit says
`[beat, vel, chokeBeats]` (the choke is a timeline edge → `audio.chokeDrum`; a closed hat strike
chokes a ringing open hat). All pure in drumparts.js (`cymbalPose`, `cymbalPiston`), tested in
`test/cymbals.test.js`. Toms are **pitched** — each
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
  route `onStrike({note, vel, pos, color, dur, shake, sparks, light})` → sparks + a SHARED
  constant-size strike-light pool (a hit with `light < .2` SKIPS the pool — a strum's or chord's
  faint inner strings must not steal another machine's flash) + `audio.playVoice('inst:<key>:<note>',
  vel · song.mix, {dur})`.
- Seams added 2026-10-07 (README has the detail): `voiceIds(part, {beat, bpm, rollT, P, loopBeats})`
  — the tempo, so a plugin can name voices by a note's length in SECONDS exactly as build() will;
  optional `voiceHz(id)` (pan width for chord / suffixed ids — default = the FIRST pitch in the id,
  audio.js's regex now tolerates '~'); `PART_LIMITS` on the descriptor (orchestra.js imports it —
  never copy the numbers); `xrGlow` / `inst.xr(on)` for the headset. A FLOOR station is built ONCE
  with floorY 0 (no legs / riser / pedestal — 2026-10-25) and SET IN THE ROOM by a rigid move: on the
  floor's plinth at its measured ground, or lifted (the user, or the GALLERY raise) — rooms/footing.js;
  a descriptor `stand` (local y it rests on) for a machine whose lowest parts hang (the turntable).
  Timbre / articulation rides ON THE NOTE ID (there is no per-event timbre field) — §6.
- **clock.js makeEdge re-arms when the clock goes BACKWARDS** (finale fix): main's static-merge
  sweep poses every station at 48 songTimes; a first strike within .25 s before one of those poses
  used to stay "fired" and went silent on loop 1 (finale's bells, daybreak's beat-0 bell). Forward
  playback never re-fires (within one strike abs + since is songTime + const).
- Audio: one pure `voice()` render feeds BOTH the live path (AudioBuffer, gain = vel, `dur`
  release) and the iOS `<audio>` bank (WAV) — iOS-war internals untouched. The sample path can't
  release at `dur` (el.volume is ignored), so SUSTAINED plugins (organ, bowwheel, horns, dulcimer,
  bowls) fire **duration buckets** — `'<base>~<hold>'` ids (`src/instruments/sustain.js`) whose
  render is the base cut at .5 / 1 / 2 s with the release BAKED in, the rung nearest the note's
  hold (log-nearest: ≤ √2 off). voiceIds gets the tempo, so build() and voiceIds plan the same
  ladder from the same lane solve; a part over `BUCKET_CAP` (40) bucket ids coarsens the ladder ([.5,2] → [.6] → none; the
  organ floors at [.6] — it replaced the old per-base '/s' tier, so its staccato never regresses).
  main bakes a '~' id's bare base LIVE-ONLY (Float32, no `<audio>`); `playVoice` plays that base
  on the live path and releases at `dur` exactly, as before. Measured (all songs + demos): WAV bank
  −12 %, Float32 sources +32 %, bake time ≈ unchanged (cuts are slices; horns re-render natively).
  `test/sustain.test.js`.
- **Voice LOAD cost + levels (audio QA sweep, 2026-10-07 — `node scripts/audio-sweep.mjs [--solo]`
  renders one steady-state loop per song OFFLINE and reports peak / LUFS / limiter / silence /
  strikes / bake ms + MB / each machine's level under the mix while it plays).** Three rules fell out:
  · **bake budget** — rebuildBank renders voices (soonest machine first) + the cymbals for
    `BAKE_SYNC_MS` (250) and the rest in idle slices; a voice asked for early renders on the spot.
    A full room used to block the song build 1–1.7 s on a laptop (finale ≈ 300 ids).
  · **bounded caches** — every voice.js caches in `voiceCache()` (`src/instruments/voicecache.js`);
    main sweeps what the current build didn't touch (browsing all songs held ~480 MB of heap, now ~230).
    A plain `new Map()` render cache in a plugin fails `test/voicecache.test.js`.
  · **the iOS WAV keeps the render level** (`src/wavlevel.js`) — voice WAVs used to be
    peak-normalised, which silently undid `song.mix`, the dulcimer's soft layer and the riff's
    RMS level on iOS. `song.mix` is now a bank GAIN (applied as the render is wrapped), not a copy.
- **Room director** (src/directorplan.js, pure + tested; main `syncDirector` → camera.js plays it back):
  the song is data, so the loop's whole EDIT is solved at song load. Every machine — **the belt is
  just one of them, no protagonist floor** (AJ: "I don't see the belt as too special") — is scored
  beat by beat for what's SPECIAL: above its own norm, an entrance after a rest, a crescendo, a
  solo, rarity; then a 2nd-order DP over the beat grid cuts the shots (≥ 3 s, on beats, bar lines
  preferred, A-B-A ping-pong priced), share caps (belt .18 / wide .16 / station .24) and coverage
  (every machine that plays is seen once a loop — a PROMISE: an edit that still leaves one unseen is
  re-run with covers that never take another machine's only screen time; Bald Mountain's belt cover
  took the turntable's opening once the juggler's ride held the belt's own moment — the fixture in
  test/directorplan.test.js). Scripts (`song.director.at`) are fixed points;
  `song.director.<key>` is a √-weighted hint. The seam's breath is the wide `stage` shot by default; a
  script that runs past the last note OWNS it (directorplan `held`, may wrap into the roll-in — Forge's anvil). The camera's shot is a pure function of songTime.
  `node scripts/director-audit.mjs` prints every song's shares. An IMPORT also gets a **signature**
  (`signatureOf`: the present, varied, heavy pitched station — MoP's riff, never the belt or the kit):
  pull ×SIG + a floor, its own cap (.34) enforced by a bisected per-beat PRICE (a damped pull jumps).
  Hand-authored songs opt in with `director.signature: '<key>'`; their edits are otherwise unchanged. Songs with stations open on `auto`;
  others keep free-look. `stage` = the wide shot. The edit also plans RIDES (§7 ride cam).
  Composer gotchas (scar tissue from tonight's 8 songs): a key that appears ANYWHERE in
  `director.at` is exempt from its share cap for the WHOLE loop (`isFixedKey`) — in a dense band one
  scripted `stage` or station took 35–42 % (The Entertainer uses weights only, for this reason);
  `director.shots.<key>` (a re-framed station shot `{x, up, dist}`) is keyed by the PLUGIN key
  (`bass`), not its camera key (`strings`) — a camera key there is silently ignored; `song.barBeats`
  (Mars = 5) makes the edit prefer that meter's bar lines (default 4).
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

**Cymbal voices** (`src/cymbals.js`, 2026-10-07): crash / ride (2 round-robin variants) / rideBell /
china (soft-clipped) / splash / hatOpen / clap are ONE deterministic, seeded `metal()` render at 32 kHz
each, rendered at SONG LOAD (≈ 100 ms/voice, ≈ 330 ms a full kit on a laptop — cached per voice),
never on the first hit. Live `hitDrum`: vel sets level AND darkness (a lowpass opening with vel²).
iOS WAV: baked with its PEAK set to the cymbal's registry mix gain (`encodeWav` peak arg) — el.volume
is ignored, so a crash must not ring at kick level. The last 15 % of every render (≤ .5 s) fades on a
smoothstep (the old hard 34 ms cut gated audibly). `audio.chokeDrum(name)` = a choke edge: live path
fades the voice; the sample path pauses the element.

**Duration buckets — the iOS answer to SUSTAIN** (live voices release at `dur`; an `<audio>` element
can't, and its volume is ignored): a sustained plugin fires `'<base>~<hold>'` (e.g. `C4~0.5`,
`C4|choir~2`, `E4:e:p~1`) whose render is the base CUT at a ladder rung with the release BAKED in
(§4b, `src/instruments/sustain.js`). On iOS a note therefore rings ≤ √2 × its length (or the full
render past the top rung). main bakes the bare base LIVE-ONLY (Float32, no element) so desktop is
unchanged. `rebuildBank` skips the `<audio>` element for `live` voices; the iOS internals are untouched.

**`voiceHz` (pan width):** spatial `widthFor(hz)` narrows low voices to the centre. audio.js reads
the voice's `hz` from the plugin's `voiceHz(id)`, else main's first-pitch parse of the id (chord ids
'E2+B2+E3', 'C4|choir', 'stab:D4', 'E1:s', buckets '~' all parse). Before this every chord / suffixed
id read 0 Hz and panned full width.

**Song-change console noise (`ERR_FILE_NOT_FOUND` on a blob URL, + the status line flashing
"audio: sample blocked") — fixed in `rebuildBank`'s teardown only.** Cause: a song change is a
gesture, so main re-primes the new bank; a quick second change tears that bank down while its
elements' priming `play()` promises are still pending. The old teardown revoked each element's
real WAV URL, then the late `.then` in `primeSamples` swapped that dead URL in (`a.src =
a.dataset.real`) on the detached element → a failed load + its `error` listener. (An element
still loading its real WAV when revoked failed the same way.) Fix: the teardown forgets
`dataset.real` before revoking (the late `.then` then finds no WAV and does nothing audible), and
an element whose src IS the real WAV is detached (`removeAttribute('src'); load()`) first. The
unlock dance itself (`primeSamples`, `realSrc`, the silent clip) is untouched.

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
  drums: { kick:[0,1,2,3], snare:[1,3], hat:[0,.5,1,...],      // optional; see below
           china: [[3.5, .9, .5]] },   //   a hit may be [beat, vel, chokeBeats] (cymbals: the clamp chokes it)
  parts: { organ: [[beat, 'C4|choir', vel?, durBeats?], …], … },  // plugin parts (§4b), absolute beats
  mix:   { organ: .6, bowwheel: [[0, .6], [48, .85]] },  // AUDIO-ONLY gain per part (number, or a step
                                       //  envelope by beat) — velocity stays dynamics (light/sparks/layer)
  room:  'arena',                      // the room the song OPENS in (a viewer's ?room / R pick wins)
  barBeats: 5,                         // optional meter (2–16, default 4): the director's bar lines
  director: { at: [[beat, shotKey, holdBeats?], …],   // scripted cuts (fixed points; a hold past the last
                                       //  note OWNS the seam's breath — Forge's anvil, Winter's freeze)
              organ: 1.8, strum: .6,   // √-weighted pull per machine key
              shots: { bass: {x, up, dist} },          // re-frame a station's shot (PLUGIN key!)
              signature: 'riff' | false },             // the machine the song is ABOUT (imports pick it)
}
```

**Timbre / articulation live ON THE NOTE ID** (there is no per-event timbre field; every id is a
separately baked voice, and the importer writes these from GM programs in `orchestra.js noteSuffix`):

| plugin | id grammar | meaning |
|---|---|---|
| riff | `E2` · `E2:m` · `E2:c` · `E2:cm` | palm mute (or every durBeats ≤ .3) · clean amp · both. Notes on one beat are ONE hit: the plugin fires a single chord voice `E2+B2+E3(:flags)`, low → high |
| strum | `E3` · `E3\|n` · `E3\|h` | steel · nylon · harp (ONE variant per part — a mixed part strings a pitch twice) |
| organ | `C4` · `C4\|choir` · `C4\|pad` | principal · 3-singer choir · 3-saw pad (aliases vox/voice/aah, strings/synth/ensemble) |
| horns | `C4` · `stab:C4` | held (≤ 2.6 s) · short accented stab (≤ .5 beat) |
| dulcimer | `C4` · `C4:e` · (`:p`) | piano · FM Rhodes tine; `:p` = soft layer, chosen by the plugin from vel |
| pogo | `E1` · `:s` · `:p` · `:y` | fingered · slap · pick · synth (saw+square, resonant LP) |
| any sustain | `<base>~<hold>` | iOS duration bucket — FIRED by the plugin, never authored |

**MIDI routing contract** (`src/midi/orchestra.js`, research: midi-routing.md): `PART_SPEC.<key>` is
built FROM the plugin's `PART_LIMITS` (a test asserts they match). `PREFER` (program + SHAPE: chordal /
riff / riffOnly / sustain / any; first match wins, only for a machine with a PART_SPEC) runs before the
GM family table: 27–30 riff (27 only on power chords) · chordal 24–27 + harp 46 strum (only if its
.2 s strum spacing keeps ≥ 85 %) · 33–39 pogo (32, the upright, stays on the string bass) · 40–44,
48–51 sustained bowwheel · 16–20, 52–54 sustained + 21–23 chordal + 88–95 organ (≤ 8 pitches with
long notes stays bowls) · chordal 56–71 horns. `LINE_HOME` sends a spare LINE to its family machine
(guitar → riff, piano → dulcimer, brass → horns, strings → bowwheel, organ → organ) before the
generic chain. `OVERFLOW_TO` (upstream-first, a loop throws): riff → marimba, pogo → bass, strum →
dulcimer → marimba, bowwheel → organ, horns → organ, organ → bowls, volley → marimba. Track NAMES beat
programs (`nameRole`: a "Bass" on a guitar program → pogo if it keeps ≥ BASS_FIT .7 of its notes);
belt twins merge only when each covers ≥ 90 % of the other; a copy that lags a few ms merges; a line
with < `BELT_MIN` 4 notes never gets a belt or a machine of its own. The lead is still chosen by family
(a chordal lead keeps its machine AND plays its top line on the belt). Program-less files route by
ROLE (bed → organ/bowls, comping → dulcimer/strum, power-chord riffs → riff, electric bass → pogo).

**Belt velocity** (optional 3rd element, `src/dynamics.js`): one velocity law (`velGain`) for the belt
pluck AND the drums — the old `.35 + .65·v` line from v = .5 up (existing grooves unchanged, measured
±.5 dB), bent down below it so pp is genuinely quiet (v .1 ≈ −19 dB, 0 ≈ −27). Live path only — iOS
samples play full. MIDI import emits it from note velocity relative to the track's loudest (`^.6`);
a flat-velocity track stays 2-element. Songs MIXED under the old floor whose drums live below .5
(Entertainer brushes, Marionette snare, Danse hat — lanes fell 3–7 dB) wrap those lanes in
`legacyLane` (dynamics.js `legacyVel`: the velocity that sounds at the old level) — drop the wrap
to let their quiet hits mean pp. Plugin parts (`playVoice`) are untouched: gain = vel, as before.

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

Catalog (25 — `src/songs/index.js` SONGS; the menu reads SONG_GROUPS shelves; the house song is
Daybreak Engine, Danse Macabre through October, pinned to Daybreak under `?debug`):
- **Showcase**: Daybreak Engine (original; every pre-tonight plugin EXCEPT volley — no hand-authored
  song plays the volley yet: `?solo=volley` or an import that overflows to it).
- **Tonight's machines** (2026-10-07, all PD or original): **finale** Starship Groove (original
  space-funk, 10 plugin machines + full kit, starship) · **forge** Forge of the Marble King (original
  thrash, riff star + horns + organ + bass, arena; the anvil B-major rings through the breath, V → i
  across the seam) · **mars** (Holst, 5/4 — `barBeats: 5`, void) · **toccata-loft** (Bach BWV 565,
  organ + bow wheel + grand, cathedral) · **entertainer** (Joplin, grand + horns + autoharp-banjo +
  bass + brushes, studio) · **winter** (Vivaldi RV 297 i, bow wheel + harpsichord-grand + bass, void)
  · **scarborough** (trad., D Dorian 3/4, autoharp + bow wheel + choir, cathedral) · **campfire**
  (original folk-pop, autoharp + cello wheel + grand, cathedral). Each pins its bpm so the 3.8 s
  breath is a whole number of beats (bpm = 60·n/3.8 — 142.1, 110.53, 94.74, 78.95, 63.16) and the
  last chord rings THROUGH the breath into the downbeat.
- **The Orchestra**: Canon in D — Orchestra, Carol of the Bells, Morning Mood.
- **October** (graveyard): Danse Macabre, Night on Bald Mountain, Funeral March of a Marionette.
- **Classics**: Für Elise (duo), Ode to Joy (trio thirds), Canon in D (true canon), Greensleeves
  (6/8), Gymnopédie 1, Prelude in C (single track), Mountain King
  (accelerando, kick/snare/hat groove), Toccata in Dm (6.5-beat pedal lob), Dies Irae (deep canon
  echo, delay 5).
- **Drum showcase**: Backbeat (every kit piece incl. ride bell, a choked china, a splash).
bpm is the single tempo knob; everything re-solves. Adding a song = SONGS + a shelf + EXPECTED_KEYS
in test/songs.test.js + regenerate the staging fixture (§1) — those three files conflict between
parallel song branches, so merge the key lists and regenerate the fixture ONCE on the merged tree.

---

## 7. Render systems & their contracts (juice, camera, machines)

- **Flipper plates** (`juggle.js flipper` / `windT`): wind-up along −n (amp = clamp(.07 × the
  throw along n, .06, .6), over WIND_T + WIND_K·amp) → a Hermite SWING arriving at the solved
  stroke speed w exactly at contact (from restitution) → RECOIL (A_DROP > g) → the hold / fold.
  CONTRACT (test/juggle.test.js): fully wound (−amp) at −STROKE_S, on its carrier and moving at
  exactly w at contact, never past the face before it. (The classic pad's `padOffset` — at rest
  at impact — lives on in engine.js for the volley / turntable plugins.)
- **Plate size encodes register** (`padRadius`/`pitchSize`): smaller = higher, a PURE FUNCTION
  OF THE NOTE — never of layout/spacing (that would imply the physics of sounding a note
  changed with context, a lie). Crowding is solved by placement — a note's LANE is a pure fn
  of its pitch, a plate that would crowd its slot is NUDGED one lane over — never by shrinking
  it; the juggler's audit (ball–plate / ball–arm, the holds' plate–plate check) guards contact.
- **Squash & stretch**: a `deform` node oriented along velocity; stretch with speed, squash a
  pure fn of the time since the ball's last contact (a strike or a dock).
- **Anticipation glow**: the next plate's rim brightens and swells with `prog²` over its
  incoming flight — possible only because the timeline is analytic.
- **Bloom** (r184): EffectComposer → UnrealBloom (`.12, .3, .9`) → ACES OutputPass. The
  sprite halos (`HALO_A=.12`) predate bloom and stay as the soft wide base; emissive cores
  (`EMI=1.2`) feed the real bloom. Exposure pops 1.15 + kick on lead strikes.
- **The visible machine** (`jugglebelt.js`, built from `paternoster.js`'s parts): one roller
  chain per lane scrolling at exactly DESCENT on phase-matched sprockets, each tone-plate on an
  arm (a shoe on its lane's chain → a hub under the plate), sculpted top + bottom housings
  (visible run ≈ band ± 7) with a lit KEY tile per lane, and the crane GANTRY in front of the
  top housing (a rail per hand per voice, a carriage per ball). Key `M` hides the frame (plates
  and balls stay). It only draws what the plan implies (§3b).
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
- **Ride cam** (`src/ridecam.js` pure, `camera.js` 'ride', the RIDE button after FIXED; manual RIDE
  follows the lead): the eye sits on the SMOOTHED belt-ball path LAG .3 s behind, raised and pushed
  back, aiming LOOK .55 s ahead — the path is ONE ball of the plan (`ballAt`: the ride window's
  longest flight; manual RIDE: the voice's busiest ball), so the pose is a pure fn of
  songTime (scrub-exact). Comfort: low-passed positions, yaw = tanh of mean sideways travel (≤ ±36°),
  a soft edge limit, the horizon NEVER rolls, eye ≥ 3.2 u in front of the marble's plane, 1.2 s ease
  in/out; peak view rotation ≤ 1.36 rad/s on real songs (test budget 1.6). The DIRECTOR rides
  sparingly: `rideMoments` (apex × the loop's biggest free flight), ≤ 1 per 20 s,
  trimmed to the flight (`rideSpan`, ≤ 6.5 s), share cap .14 but never below one ride; on short
  loops `rideEvery` = ⌈share / RIDE_LONGRUN .22⌉ rides only every n-th pass (`round(base/P) %
  rideEvery` — still pure). Reduced-motion viewers never get directed rides; XR never moves the head
  (a ride in TOUR lands you on the lead pad). Only BELT balls are ridden (instrument lobs: open).
- **Staging layout** (`stations.js layoutStations`, main `rig.setLift` + `stageFrame`; was the "gallery
  tier"): **FLOOR FIRST.** riff / strum / horns / pogo carry `floor: [seat…]` (SEATS: centre, left,
  right, wingL/R, cornerL/R, backL/R); each takes the first free seat within `SEAT_R` 4.5, and a seat the
  audience's eyes see > `HIDE_MAX` .3 hidden (OCC_EYES: 3–4 fixed eyes, not the real wide) is not free.
  Floor passes (margin 1 → .7 → .45) come before ANY gallery pass. The rear GALLERY is the overflow and
  is a LOFT: it sits `GALLERY_DROP` (2 u) under the belt's top housing (y ≈ 13.7), the fewest machines
  climb, and a climber goes BESIDE one already up (one loft, `FOOT.LOFT_GAP`) — only Starship Groove
  climbs today. Gallery machines avoid every hung footprint AND the space behind it; drums + turntable
  never go up; a station the user pins behind the belt goes up. A raised station is LIFTED (a rigid move:
  gallery deck − its ground; a user's own lift wins). **The STAR** (imports' signature, or a song's
  `director.signature`; main passes `stageStar`) stands at `STAR` (belt centre, z 10), never climbs, and
  nobody taller than the sightline to its base stands in its foreground. **Stagecraft** (wave 3, tried
  first, dropped if it would cost the floor a machine): the kit's DRUM RISER — while a band machine plays
  the kit stands on the right wing (`KIT_RISER` {x 22.5, z 5, lift 3}) on a 3 u dais if the wing is free and
  the kit is seen there (a user's lift 0 keeps it down; Campfire and Starship Groove keep it front-right);
  the band takes the side with fewer machines first; TIERED RISERS (`SEAT_RISE` [1.5, 3]: a back seat
  z < 10 hidden behind the front row takes the smallest riser that makes it seen; front seats never rise);
  `loneTurn` (a lone star with a `turn` hint, the grand .55 rad, is turned by main before it is measured).
  The solver returns `lift` for a riser; main applies it unless the user set a height (kit: `kitSlot.rise`).
  `stageFrame` keeps every front-row machine's full width + `FRONT_KEEP` .25 of its front half. main
  `bandOn()` keeps the gallery's low wide directions while a gallery-born machine is live. Only stations
  with events are placed. Shared-file scar: STATIONS is the one edit a new floor plugin can't avoid — run
  the slot search against test/stations.test.js (1–3 bays ± turntable) or every other station's solved
  position moves.
- **The BELT and the HUNG machines move** (wave 5; docs/STAGING-WORLD.md): drag the organ / ricochet / volley off
  the belt and it stands on the room's footing (a layout entry for a hung key = standing; none = hung as built);
  drop it over the belt's top and it re-hangs. The belt drags + turns (Q / E, the ring): `src/stagepose.js` T —
  all staging solves run in the belt's frame and are placed by T (identity = bit-for-bit the old stage);
  `belt: [x, z, yaw]` in layouts / share links; unplaced machines re-seat, placed ones stay unless WHOLE STAGE
  (Alt) carries them; refused drops go back. Physics never changes — the plan is in the belt's own frame.
- **STAGE EDIT height** (`src/editor/height.js` pure, `stage-edit.js`; RCT-style): select a floor machine and
  a HEIGHT HANDLE stands at its footprint corner nearest the eye — a pole with a tick per metre, a ▲▼ knob,
  a readout chip (`+12.8 m · TOWER · LOFT · RIFF FORGE`). Heights are SAID in metres (`M_PER_U` ≈ .677 u→m)
  with the band name FLOOR / RISER / PLATFORM / TOWER. Drag the knob (relative; snaps ½ u = `LIFT_STEP`,
  Shift = free; MAGNETS: the floor within .3, a neighbour's deck within `LOFT_DY` so the two share a loft);
  PgUp / PgDn and ] / [ step ½ u (Shift 2 u), Home = floor; the dock has ▲ RAISE · ▼ LOWER · FLOOR (an
  explicit 0, outranks the gallery raise) · AUTO. Limits: `FOOT.LIFT_MAX` and the top ≤ ceiling − `CEIL_GAP` 1 u.
  During a gesture the machine moves rigidly (stations `rig.setLift`, the kit's drumGroup) and the room
  re-anchors + re-plans its footing every frame (~2–5 ms); at its end (`SETTLE_MS` 700) the kit rebuilds
  and the director re-solves once (0.3–0.7 s). Grabbing the knob in the plan view eases to an elevated 3/4
  view with `GRAB_HEAD` 8 u of raise framed (the camera never moves mid-drag); PLAN | 3D flips. One undo step
  per gesture; REDO = ⌘⇧Z / Ctrl+Y (`placement.js makeHistory`). `placeEntry` is the one write path. AUTO,
  an undo back to AUTO and a MOVE of a machine with no user lift all take exactly what a RELOAD would give:
  main `autoLiftOf` re-runs `layoutStations` with the build's args (`lastLayout.args`) and every machine
  pinned where it stands. Share links + saved layouts carry `[x, z, yaw, lift]` (lift 0 kept; absent = AUTO).
  The MAP panel and STAGE EDIT are one tool at a time. Host: `height(key, out)`, `liftLive(key, u)`,
  `liftSettle()`. Dev: `?lift=marimba:4,drums:2` / `__dev.lift(key, u)`.
- **Rooms** (`src/rooms/`): each room is pure set dressing in the static world — `FLOOR` stays
  `STAGE.FLOOR` (−5.5 since 2026-10-25; it was −22, every machine on ~15 m of legs) (HW/BACK/FRONT/
  CEIL may widen, as the studio and arena do); `place(anchors, plan)` gets every machine's footprint, deck,
  ground, lift, bottom, low, solid box and strike cue (rooms/index.js header) + the footing plan (the
  Void's islands carry the pads, stairs and lofts too — `voidIslands`, one rim per island), NO lights of its own
  (14 lights in every room), constant pools, per-frame work = uniforms only, scrub-safe. `rooms.cue()`
  gets `{beat, rollT, P, drums, melody, loopBeats, start}` at song load: **arena** turns the drum
  lanes into a fixed cue sheet over 8 flame jets + 4 CO2 cannons + a blinder wall (crash → every
  free jet; loop downbeat / drums returning / a bar that jumps → CO2; kick on a downbeat → one pair,
  alternating; a device never re-fires while burning, across the seam too; no drums → the melody's
  long notes fire), every flame/ember a closed-form fn of "seconds since fired". **starship** banks
  only the SKY (≈ 5.7° per 4-bar phrase, alternating, level through the breath; `loopBeat()` counts
  from each loop's downbeat — the 1.2 s seam tail isn't whole beats); star streaks move `z0 + v·t mod
  L` with every speed n·L/T_WRAP and songTime mod T_WRAP on the CPU (no float drift, no snap).
  **Each room dresses the footing and answers its machines** (docs/STAGING-WORLD.md has the table): grid =
  graphite volumes edged in light + strike ripples on the floor (pool of 20) + a stage plot naming each
  machine; cathedral = stone and oak, an engaged stair turret over 5 u, brass candlesticks that flare;
  studio = rugs, road cases, truss, a catwalk loft, per-support VU panels; void = every machine on an
  ISLAND whose top is STAGE.FLOOR, crystals that lift on strikes, a sky rock for the chandelier; graveyard =
  ledger / chest tomb / mausoleum / scaffold / crypt terrace, a churchyard planned round the machines,
  flame + fog + wisps; arena = Litedeck / Layher scaffold / box truss, an LED VU ring per deck, pyro that
  stands clear; starship = deck plate / chrome rams / lattice gantry, running lights + beacons. Props keep
  `GY.CLEAR`-style clearance from every footprint and every `footingBoxes` envelope (for a rotated pad use
  the plan's `supportRects`, never its AABB).
- **FOOTING** (2026-10-25 — the machines no longer bring legs; the room holds them up). The host
  (rooms/index.js) plans it once per set of anchors (`planFooting`: a pad per standing machine by
  HEIGHT BAND — flush plinth ≤ .8 · low dais + stair ≤ 3.5 · mid braced platform, rails, stair or
  ladder ≤ 10 · high truss tower, caged ladder, rest landings — raised neighbours at one height
  (|Δtop| ≤ .6, ≤ 3 u apart) share ONE LOFT (the rear gallery is a loft now); an open `stand` gets a
  post under each FOOT, beams kept out of what HANGS; hung stations are anchors of kind 'hung':
  obstacles only) and builds it per room (`buildFooting(plan, room.footing || DEFAULT_STYLE)`:
  merged per material — base / steel / deck + ONE edge draw for every machine — a few ms, rebuilt on
  a lift; swapped with the room). A room styles it by returning `footing: { mats?, flush?, low?,
  mid?, high?, loft?, edge? }` from build() (footing3d.js header) and must stay inside
  `footingBoxes(plan)` — the envelopes the shot solve treats as solid (shotrig roomSolids reads a
  merged mesh's `userData.boxes`), the director's glide test and the wide's band test raycast,
  XR keeps its pads out of, and test/staging-audit.test.js re-plans at the solved spots (the
  fixture's `foot`). A form / edge hook returns `null` (the kit's own form), `true` (handled, nothing to
  add — it wrote into the merged slots) or an Object3D (joins the footing; an empty Group still works);
  there is NO `open` hook (an open stand reaches its band's hook with `spec.open`/`feet`/`hang`); every pad
  has `spec.foot = [w, d]`; `kit.slot(name)` is a style's own slot, `gapOf` / `landings` are exported.
  `footStats` counts only visible meshes with geometry. **HOST PREWARM** (idle, after the first frames):
  every unvisited room is built, PLACED on the current anchors, footed and single-passed (perftune) before
  `renderer.compile` — a swap compiles 0 programs, R takes ~0.1–0.5 ms; a room must create `instanceColor`
  at build and set `userData.boxes` on a merged mesh that spans floor to ceiling. `beamMat`'s facing term is
  capped at 1 (a bloom blob under a lifted kit). THE EDGE: a strip of the machine's colour round its pad answers its own strikes
  (pulse.js over the anchor's cue: afterglow exp(−dt/.45), max not sum, + anticipation; one uniform
  slot per pad, silent in the count-in) — an accent, never a strobe.
  Rooms DRESS it with `tintStyle({ base, steel, deck })` (footing3d.js: the kit's forms in the room's own
  materials, made once per built room, the room disposes them): cathedral limestone / bronze / oak,
  graveyard granite / iron / planks, studio charcoal risers / aluminium truss, arena black decks on
  silver truss, starship hull plating; grid keeps the default concrete (a LIGHT tint — the colour
  multiplies a mid-grey grain, the old mid-grey was a black box in every dim room); the Void dresses its
  pads in its islands' metal and drops the flush pad's own edge (the island rim is the line).
  THE KIT stands on its own DECK slab (drumlook `DECK_UNDER`, −.34 under the kit's local 0) on a flush
  pad whose WELL lets its pistons dip below the deck (drumparts `pistonDip`: the deepest dip over the
  loop, solved round the strikes, not sampled frames). An open `stand` lifted more than `FOOT.CLIMB` (1 u)
  gets a ladder and X-bracing in tiers ≤ `DIM.OPEN_TIER` (6 u), never through what hangs (`pad.hangY`);
  every tower bay is braced in panels. A machine's LIFT is part of the layout: EDIT STAGE / a share link
  stores `[x, z, yaw, lift]` when the user set one (0 = "on the floor", which outranks the gallery
  raise; no lift = the solver decides) — editor/placement.js.

- **Transport** (`#transport` under the song picker; `src/transport.js` pure; main `setPlaying` /
  `restart`). **■ STOP / ▶ START**: `playing = false` freezes the frame (time is the only state —
  juice and the free camera keep their real dt) and `audio.silence()` cuts the sound: every live
  voice reaches the bus through its TAKE's gates (one per destination, made on demand in `place()`),
  which fade out + disconnect; the bus trim ducks so the echo / room tails die with them, until
  START's `unsilence()`; the iOS path pauses only elements playing a real WAV. START plays on from
  the same songTime. **↺ RESTART**: songTime −LEAD_IN (a fresh count-in, gated by the planner like
  any start), the trim ducked through most of it; an ARMED recording then takes the loop from the
  top, a running take is dropped (so is one at STOP). Space = STOP / START (a focused button keeps
  its own Space). XR's B / menu play-pause IS this transport. A song change plays; a MAP re-route
  keeps a stopped song stopped. **The machines sit the count-in out**: main builds every station,
  the kit and the room's cues with `start = ARM_AT` (−.6 s) — per the plugin contract a strike
  before `start` never happened, so each sits ARMED (loaded, waiting) until its first strike after
  it. ARM_AT is inside the loop's strike-free breath tail (every event is pinned before P − 1.2 s),
  after the gate (−RUN_IN), at most −DT_MAX/2 (a drum's magnet drop onto a pickup right after 0
  starts after it) and −T_ENTER (the marimba's glide-in) — test/transport.test.js. (Before: start
  = −LEAD_IN, so the loop's last notes in [P − 2.4, P − 1.2) — riffs, bass, drums — played in the
  count-in, a song "starting" before the planner was done.) `merge-audit` re-proved every bake.
- **WebXR** (`xr.js`, docs/XR.md): render-time framing only. The loop is `renderer.setAnimationLoop`
  (a headset has no window rAF); while presenting main renders scene→camera directly (no composer —
  halos/emissive step up, marble lamps off; constant light set), skips the camera rig + perf governor,
  and `placeAt()` reads the head pose. The rig is scaled U_PER_M so marbles fall at a TRUE 9.81 m/s².
  Teleport only (pads = the director's solved eyes; the arc is a solveLaunch throw), tour = the
  director's edit as cuts. IWER is DEV-only (`?xremu`, needs `installRuntime({forceInstall:true})` on
  desktop Chrome). Perf: no multiview in WebGLRenderer r184, so every object draws once PER EYE. The
  VR DETAIL PROFILE (xrdetail/xrbatch, `?xrdetail=full` = off) mirrors the machines' opaque parts into
  one BatchedMesh multi-draw per look, skips sub-~7-px parts (never balls) + dim glows, boosts glow for
  the missing bloom (descriptor `xrGlow`, optional `inst.xr(on)`), and rooms offer `xr(on)` variants
  (studio: no per-eye Reflector). Daybreak (the full room) from the wide 1451 → 555 calls/frame, both eyes (docs/XR.md table).
  The head is never moved by the director / ride cam — TOUR teleports (blink); Y = in-world menu.

Dev toggles: `Space` = STOP / START. `G` = belt debug HUD (rulers + height graph + the plan's ball count; `convDbgOn`, OFF by default). `M` = the belt's frame on/off (plates + balls stay). `R` = next room. `?debug` = a scrub bar (time is the only
state, so scrubbing is just assigning `songTime`; `skipStrikes` suppresses machine-gunning) + `window.__dev`:
`song(k)`, `t`, `rate`, `cam(mode)`, `station(key, dist, up)`, `strikes()` (strikes per machine — belt voices, plugins, `drums` — with
their songTimes `at`, + any fired id with no baked voice — the sound sweep), `director()` (cuts, shares, rides, rideEvery,
signature), `ride(t)`, `occlusion()`, `audioProbe()` (+ `outPeak`: the final mix — STOP must read 0),
`transport()` / `stop()` / `start()` / `restart()`, `xrPerf()`, `lift(key, u)` / `anchors()` / `stage` (staging:
a floor machine's / the kit's lift, what the room is told stands where, the floor contract; `?lift=marimba:4,drums:2`),
`footing()` / `footBoxes()` / `footStats()` (the footing plan, its envelopes, its draws / tris / build ms).

- **Perf (render-time only — all A/B-able by URL flag).** `mergestatic.js` bakes still parts per
  material AND parts rigid on a moving carriage (piston head, valve slide: merged into the carriage's
  frame); single-material parts with geometry groups (every Box/Cylinder) merge too (`?norigid` = the
  old merge). The stillness proof samples the loop uniformly AND around each lane's first strikes + the
  count-in (a lid pop / bell flex lasts a fraction of a second — uniform samples alone baked 11 moving
  horn/bowl parts still); `node scripts/merge-audit.mjs <url>` re-proves every bake over a dense sweep
  and must print all `ok` after any instrument change. A part that changes in place (material swap, CPU-
  rewritten geometry) never bakes. `raybvh.js` routes big-mesh raycasts (the shot solve) through a BVH — identical hits
  (`?nobvh`; `scripts/same-solve.mjs` proves every shot unchanged). The iOS WAV bank's background
  encode sleeps while the live Web Audio path is healthy (it was eating phone frames for seconds per
  song change). `?batch=1` = opt-in 2D BatchedMesh mirror (no CPU win measured headless; try it on a
  real phone). Tools: `scripts/perf-audit.mjs` (per song: build, first-frame stall, frame/CPU ms,
  calls, heap; `--profile phone` = 390×844@3 + CPU 4×; `--tap 1`; `--prof 1 --incl 1` hot functions),
  `perf-breakdown.mjs` (draws per machine), `perf-firstsecs.mjs`, `merge-ab.mjs`, `batch-ab.mjs`.
  Headless numbers swing ±50 % with machine load — compare interleaved runs only.

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
  starts negative, so the belt spins up before songTime 0 while every other machine sits ARMED
  (§7 Transport — a pickup fill still plays in the roll-in after 0); a song whose juggle isn't in
  yet runs the count-in WHILE the workers solve it, then waits at −RUN_IN (§3b). It's a feel knob
  — one const; tune freely (keep it > RUN_IN).
- Greensleeves uses the F#/dorian variant; Gymnopédie is the theme stated twice; Canon's late
  cycles are faithful-in-gesture simplifications. Mars (no score to hand — the fanfare, the 5/2 theme
  and the recap are faithful in SHAPE) and Winter (arranged from memory) say so in their headers.

**Still open after the 2026-10-07 overnight** (the reviewers' "remaining", minus what later merges
fixed — the 6 station-layout test failures, puppeteer-core, the light-pool seam, voiceHz, voiceIds
tempo, the blob-URL console noise and the forced breath wide shot are all FIXED):
- **Nothing tonight was heard on a real iPhone or worn on a real Quest 2.** iOS buckets were checked
  by unit tests + bank composition; XR by IWER draw-call counts only (GPU time, `WEBGL_multi_draw` on
  Quest Browser, the first-frame batch/shader stall — Bald Mountain ≈ 3,200 parts — unmeasured).
  docs/XR.md §0 is the headset checklist.
- **iOS sustain, still coarse**: a bucket rings ≤ √2 × the note (or the full render past the top rung);
  a part over BUCKET_CAP coarsens (Mars's organ loses its 2 s rung → 1.6–3 s notes ring 5.2 s); bowls
  have no rung between 2 s and their 5.5 s hold; the non-bucket plugins (strum, riff, pogo, bass, …)
  ring their full render on iOS whatever `dur` says (Campfire's intro picks, open riff chords); a
  repeated id still cuts its own tail. A stale priming `play()` rejecting after teardown costs one extra re-prime.
- **No loop-sustain seam**: voices must render ≤ ~4.5–6 s, so the bowwheel caps a stroke at 3.9 s,
  horns hold 2.6 s, the riff's open chord rings 1.6 s (Forge's anvil is carried by organ + horns);
  the organ fakes long holds with a crossfaded '/c' continuation (≈ 1 s overlap on iOS).
- **Timbre gaps**: horns choose timbre by REGISTER only — routed saxes / reeds sound like brass; the
  belt keys notes only by note, so a guitar riff that lands on a BELT sounds like the music box; the
  dulcimer's ':e' e-piano is ≈ 6–9 dB hotter than the piano at equal velocity (matters in mixed parts).
- **Bake cost on dense imports**: every distinct riff chord is its own id (~6.5 ms; a 640-hit part
  with no repeats ≈ 4 s); a 3-timbre organ import ≈ 190 ids ≈ 60 MB Float32; cymbals ≈ 330 ms at load
  (more on a phone — render ride variant 2 lazily if it bites). Consider capping chords / timbres.
- **Staging** (the floor-first layout fixed: the star is front and centre, the band takes the floor, only
  Starship Groove uses the gallery, so the steep gallery wide is rare; the portrait stage shot still frames
  only belt + hung + turntable). Still open: seats and risers are judged from the solver's fixed eyes
  (OCC_EYES), not the real wide; `KIT_RISER.lift` is a fixed 3 u; Mars's centre riff is ~35 % behind the
  kit's arch; Starship Groove's two climbers (15.6 u apart) get two towers, not one loft; a STAR exists
  only for imports or `director.signature`; Piano Man's lone grand is a three-quarter but still on the
  belt's axis; Danse Macabre's bass is 100 % and Daybreak's music box 82–99 % behind the kit from a low eye
  (pre-existing); on imports the MAP panel opens over the kit's riser; Winter's grand is cropped
  bottom-left in the Void's wide; Starship Groove in the graveyard: the riff station's box overlaps a room
  prop (staging-audit `ov:1 riff×room`).
- **Staging world (branch `staging-world`, unmerged; docs/STAGING-WORLD.md has the full list)**: NOTHING was
  seen on a real iPhone or Quest (headless Chrome, 390×844 touch emulation, IWER draw counts; the height
  knob is not in the VR menu). Editing: a 0.3–0.9 s pause when a height gesture ends (synchronous restage);
  a >8 u drag carries the top under the bar until release; unselected name tags can overlap; on a phone the
  knob can land ~120 px off the finger; an explicit FLOOR on a gallery machine behind the belt stays there
  (the bar warns). The turntable's open stand at lift 0 is ~4.2 u tall with no ladder (the climb check uses
  lift, not height). Rooms: the Void's keel shader lacks the `beamMat` cap; the arena's blinders / par cans
  are still sized for −22 and its front-wash pars aim at y −8; the staging audit freezes per-layout room
  props at the first song's positions; first footing builds are 8–16 ms on finale under load (target ~10;
  cathedral / starship ≈ 2× the kit; graveyard with two lofts ~23 ms); strike reactions are quiet by design
  (graveyard barely shows in a wide); grid's light lattice is brighter than the old steel (`glace` knob)
  and its floor ripple loop is unmeasured on a phone GPU.
- **Director**: whole-song imports give `ride` .28–.39 (cap .14 — pre-existing); some rooms can't fit
  every cap (Piano Man's dulcimer .41 vs .34) — the least-over edit wins; a signature's first shot can
  open ~3 beats early on an idle machine (the director pre-cuts); `shares.ride` is one pass — divide
  by `rideEvery`; a key anywhere in `director.at` is cap-exempt all loop (§4b).
- **MIDI import**: the MAP panel can show a merged BELT twin as "off" (it plays — the twin carries
  it) and a drum-named non-ch-10 track as "off"; a hand re-mapping in MAP feeds shapePart notes without
  program/duration, so timbre/articulation flags (':m', '|n', ':e') are lost; volley thinning on
  auto-import isn't reported; GM gives no choke signal (imports never choke a cymbal); GM 31 harmonics
  spare lines land on the riff; the D2 bass centre drops Sweet Child's bass an octave on pogo AND
  string bass; phrase `lenFit` scores jump at the 30 / 75 s edges (fixing it moves 8 corpus windows);
  MoP loops the verse riff (bars 89–120), not the intro; GM-named exports ("Lead 1 (square)") feed
  `nameRole`.
- **The loop seam has ~1.5 s of near-silence** (`P = ROLL_T + LOOP_T` + the 1.2 s tail) — by design,
  but it's audible on recorded rock loops; songs that end on a stop (The Entertainer) add their own.
- **Honest-motion compromises (documented, tested)**: the pogo's foot follows the string's strike
  point (≤ .05 u off pure ballistics when a carriage presses/lifts); the cymbal clamp grips around
  every strike though the audio doesn't choke (it sounds better); the autoharp re-plucks any string
  still ringing as it sweeps (Campfire's intro: 47 soft "brushes" a loop); extreme strum flips can hit
  ~50 000 u/s² on dense random parts (position continuous; needs an asymmetric-flip solve); the
  bowwheel forces one park per loop per string (can shorten a legato line); at 220 bpm the pogo/riff
  hops are ~.03 u — fast chugs read through flashes, not motion.
- **Rooms**: starship banks on 4-beat groups from beat 0 (a 6/8 song banks in 4s) and its rail
  chase jumps part of a beat once a loop in the breath; arena fog/floor pools read grey-blotchy low in
  wide shots, CO2 plumes read as solid cones, and drum-less stretches get no pyro (Canon-Orchestra
  ≈ 60 s); AR exit restores the pre-AR room; long room/song names truncate on the VR menu; AR at true
  scale doesn't fit a room (the band is 18.7 m up); MAP / EDIT STAGE (incl. the height knob) are 2D-only.
- Wall-clock bake-budget tests (e.g. inst-riff "bakes the whole demo fast") can flake when the
  machine is loaded by parallel agents/suites — re-run the file alone before believing it.

---

## 9. Roadmap → see [`VISION.md`](VISION.md)

The north star is the 3D music **creation + visualization tool**: pick instruments, place
them in the world, move/director the camera, author via MIDI import or a piano-roll / drum
grid. Shipped toward it: repo-ification, MIDI import (**now incl. channel-9 drums**), share
links, recording, the **conveyor + spawner** (archetype 1), the **drum machine** (archetype 2),
the plugin seam + 15 instruments, rooms, the room director, the MAP / EDIT STAGE creation tools,
phrase loops — and on 2026-10-07: the guitar + sustain families (7 machines), real cymbals, MIDI
routing to every family machine + the import's signature shot, belt dynamics, iOS duration
buckets, the gallery tier, the ride cam, arena + starship, 8 songs, WebXR with a VR detail profile;
on 2026-10-24 the JUGGLER belt (one multiball machine for every belt voice — the classic removed).
Near-term, in rough priority:

1. **Hear it / wear it**: a real-iPhone listen (buckets, cymbals, velocity) and the Quest 2 pass
   (docs/XR.md §0). Everything after this depends on what those say.
2. **Staging world** (shipped 2026-10-30): hear/wear it. The star is front
   and centre and the gallery is a rare loft now; what's left is real-hardware checks and the open issues in §8.
3. **Timbre seams**: a reed voice for horns, a belt timbre (a guitar line on a belt), a loop-sustain
   seam for voices (drones past 4 s), per-event timbre instead of id suffixes if it keeps growing.
4. **Melody/drum editor** — piano-roll + drum-grid, exports the same song format (mode 2).
5. Personal/private only: Zelda transcriptions (Nintendo IP — keep out of the public
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
