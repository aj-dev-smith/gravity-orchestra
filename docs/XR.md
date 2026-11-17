# Orchestrion in VR: testing on the Quest 2

The code lives in `src/xr.js` (the render subsystem), `src/xrplan.js` (pure: anchors, tour, scale, teleport arc, head-space audio; `test/xrplan.test.js`), `src/xrmenu.js` (the in-world menu) and `src/xrdetail.js` + `src/xrbatch.js` (the VR detail profile; `test/xrperf.test.js`).

Nothing changes on a page that doesn't support WebXR. The **ENTER VR** button only appears when `navigator.xr.isSessionSupported('immersive-vr')` says yes, so desktop Chrome without a headset, iOS Safari and the Claude iOS iframe never see it.

---

## 0. Tomorrow morning on the Quest 2: the checklist

Tick these off in order. Each one is a few minutes. Write down what felt wrong; numbers beat adjectives.

**Setup (5 min)**
- [ ] `git checkout overnight` (or the branch you were given), `npm install`, `npm run dev:xr`, `ipconfig getifaddr en0`.
- [ ] Quest Browser → `https://<ip>:5173/?xr` → Advanced → Proceed (once per cert).
- [ ] Optional but worth it: USB + `adb reverse tcp:5173 tcp:5173`, open `http://localhost:5173/?xr`, and keep `chrome://inspect` open on the Mac. The console shows the `astate` audio line and lets you run `__dev.xrPerf()` (add `&debug`).
- [ ] Install **OVR Metrics Tool** (or turn on the browser's FPS overlay) so you can read real frame times. The emulator can't.

**Comfort and scale (10 min)**
- [ ] **Für Elise** (`?song=fur-elise&xr`). Tap **ENTER VR**. You should hear sound within a second and land on the belt's pad, eyes level with the strike band. Does a long lob read as real gravity (1 unit = 0.68 m)?
- [ ] Right stick up, aim at a pad, release. The blink should be quick and never a glide. Try the **STAGE** pad: it's about 16 m up. Is the solid brass disc under you enough, or do you want a railing?
- [ ] Snap-turn (right stick ← →). 30° steps. Too big? Too small?
- [ ] Press **A** for the tour. Every cut should be a blink, never a camera move. Ride-cam shots land you on the belt pad; the headset is never flown.

**The in-world menu (5 min)**
- [ ] Press **Y**. A panel opens about 0.85 m in front of you, where you're looking. Point either controller at it: a ray and a dot appear. Pull the trigger to press.
- [ ] Pick a song, pick a room, PAUSE/PLAY, TOUR, NEXT PAD, CLOSE. Is the text sharp enough? Is the panel too close, too far, or too big?
- [ ] Check that a trigger press that closes the menu never throws you (you have to let go before you can aim).

**Performance: the real reason for the test (15 min)**
Draw calls per frame, both eyes, under the emulator, with the detail profile on (it's on by default):
- [ ] **Daybreak Engine** (`?song=daybreak-engine`, the full room, about 555 from the wide, 313 from the belt). Stand on STAGE and watch. Does it hold 72 Hz? Note the OVR Metrics GPU and CPU %.
- [ ] **Forge of the Marble King** (`?song=forge`, Metal Arena, about 506 / 385). Watch a crash: the pyro, CO2 and blinders are all firing.
- [ ] **The Entertainer** (`?song=entertainer`, Midnight Studio, about 500 / 320). In VR the studio's mirror floor becomes a plain glossy floor, because the mirror would re-render the scene for each eye.
- [ ] A/B the profile: add `&xrdetail=full` to the URL (everything at full detail, as before tonight). Does it feel worse? Do you spot anything the profile drops that you miss?
- [ ] If the GPU is the bottleneck (high GPU %, low CPU), try `&xrscale=0.8`. If you have spare headroom, try `&xrhz=90`.

**Rooms (10 min)**
- [ ] Press Y → **Starship**. The deck under your feet must never tilt. Only the sky banks, at half the 2D amount in VR. Watch one full turn. Any queasiness?
- [ ] Y → **Metal Arena** on Forge. The blinders peak at 45% of the 2D level in VR. Is a crash still exciting without being harsh? Are the flames too close?
- [ ] Y → **Cathedral**, **Graveyard**, **Void**. Just look around: fog, scale, anything floating wrongly.

**Audio (5 min)**
- [ ] Turn your head while a drum hits. The pan should follow your head. Move to a far pad: the hits should get quieter and wetter.

**Report back**: for each song, frame rate from the wide and from a station pad, plus the worst moment. Then note anything that made you want to take the headset off.

---

## 1. Get the dev server onto the headset

WebXR needs a **secure context**. Pick one of the two routes below.

### Route A: Wi-Fi with a self-signed HTTPS cert (no cable)

```sh
cd ~/Code/cascade          # (or this worktree)
npm install                # pulls @vitejs/plugin-basic-ssl + iwer (devDependencies)
npm run dev:xr             # = vite --mode xr → https, listening on the LAN
ipconfig getifaddr en0     # your Mac's LAN IP, e.g. 10.0.0.49
```

1. In the Quest **Browser**, open `https://<that-ip>:5173/?xr`. The `?xr` flag turns on canvas MSAA on any browser. The Quest browser gets MSAA anyway.
2. You'll see the self-signed certificate warning. Choose **Advanced**, then **Proceed**. You only do this once per cert.
3. Tap **ENTER VR** (top right, under ROOM). That one tap does three things: it is the play tap, it builds the audio, and it starts the session.

### Route B: USB cable + `adb reverse` (no certificate, and you get remote DevTools)

This needs the Quest in developer mode (Meta Horizon app → Devices → Developer Mode) and `adb` (`brew install android-platform-tools`).

```sh
npm run dev                            # plain http on :5173
adb devices                            # accept the USB-debugging prompt in the headset
adb reverse tcp:5173 tcp:5173
```

1. In the Quest Browser, open `http://localhost:5173/?xr`. localhost counts as a secure context.
2. On the Mac, Chrome's `chrome://inspect/#devices` shows the Quest tab. **Inspect** gives you the console, the `astate` audio line, and a performance trace.

Production (orchestrion.band) is already HTTPS, so it works there after a deploy. **Only deploy with AJ's OK** (CLAUDE.md §0).

---

## 2. Controls (Touch controllers)

| Input | What it does |
|---|---|
| **Right stick up**, or **hold a trigger** | Aim the throw: a string of marbles arcs from your hand to the pad you're pointing at, and that pad's rim lights up |
| Release | Teleport there (a quick blink, never a glide) |
| Right stick ← / → | Snap-turn 30° |
| **A** | **Tour** on/off: the room director's solved edit, replayed as cuts between pads |
| **B** | Play / pause |
| Left stick ← / → | **Scrub** time, while paused too (time is the only state) |
| **X** | Next pad |
| **Y** | **Menu** on/off: an in-world panel with songs (paged), rooms, PLAY/PAUSE, TOUR, NEXT PAD, CLOSE and EXIT VR. Point with either controller and pull the trigger to press |

While the menu is open, the triggers press buttons instead of throwing. A press that closes the menu has to be released before you can aim again. The menu stays where it opened (it doesn't follow your head), and it moves with you when you teleport.

The wrist label on the back of your left hand shows the song, the pad (`→ PAD` while aiming), TOUR/FREE, PAUSED, the song time and the `Y MENU` reminder.

---

## 3. What to try (in this order)

1. **Für Elise** (`?song=fur-elise&xr`). It's light (≈ 165 draw calls per frame, both eyes, with the detail profile). You start on the **belt's pad**, with your eyes level with the strike band. Watch a long note lob: **that fall is 9.81 m/s²**. The rig is scaled so 1 world unit = 0.677 m, and every marble falls at true gravity. A marble is about the size of a bowling ball, and the hall is about 51 × 39 m.
2. Throw yourself to **STAGE** (the wide). You'll be high up on a catwalk pad, so check how the height feels.
3. Press **A** for the tour. The pads follow the director's edit (≥ 3 s per shot).
4. Press **B**, then scrub with the left stick. Strikes are suppressed while scrubbing, and the machines re-derive instantly.
5. **Mountain King** (`?song=mountain-king`): the belt plus the marble drums. Stand on the drums' pad. Then Y → Starship: only the sky banks.
6. **Daybreak Engine** (`?song=daybreak-engine` — the house song, except through October when the page opens on Danse Macabre).  This is the **perf stress test** (see §5). The detail profile brings it from about 1450 to about 555 draw calls from the wide. Tell us whether it holds 72 Hz.
7. Turn your head while a strike sounds. The pan follows your head and distance follows the pad you stand on. This is the live Web Audio path; the Quest Browser is Chromium, so the iOS sample path is never used there.
8. Optional: **ENTER AR** (shown in the Quest browser, or with `?ar`). This is experimental. It gives grayscale passthrough, with no room, no sky and no fog, and the machines float at true scale in your space. It's the same pads and controls. The band is 18.7 m up, so it's a first look, not a design.

URL knobs: `?xrhz=90` (target frame rate, default 72), `?xrscale=0.8` (framebuffer scale; lower means faster and blurrier).

---

## 4. How it works (one paragraph per seam)

- **The loop.** `renderer.setAnimationLoop(animate)` replaces window rAF. A headset session runs its own frame loop, and the 2D page behaves identically. `songTime += dt` is unchanged, so 72 or 90 Hz both work and strikes quantize to ≤ 13.9 ms.
- **No composer in XR.** EffectComposer can't render stereo, so while presenting main calls `renderer.render(scene, camera)` directly. ACES and the exposure kicks still apply, because three tone-maps XR targets. To make up for the lost bloom, the marble halos and emissive cores step up (`XR_HALO_A .34`, `XR_EMI 2.1`), and the 9 marble lamp PointLights go dark. That light set is constant, so there is one recompile, which happens behind the entry blink. The perf governor and the camera rig are both skipped.
- **The VR detail profile** (`src/xrdetail.js`, `src/xrbatch.js`, headset render only). Everything below is applied just before `renderer.render` and undone right after, so the owners never see it. `?xrdetail=full` turns it off for A/B.
  - **Batch.** three r184 has no multiview, so every object is drawn once per eye. Every opaque, plain-material machine part that shares a look with others is mirrored into one `BatchedMesh` per look. Its instance matrix is the part's `matrixWorld` this frame, and its visibility is the part's own. Separately-made materials that look identical batch together through a frozen copy. A part that is mid-flash (its animated fields differ) draws as itself that frame. This is where most of the savings come from (in Daybreak Engine, about 1376 parts become 68 multi-draws).
  - **Fine detail.** Parts smaller than about 7 px in the headset (angular radius < 0.0065 rad, glows < 0.01, with hysteresis) are skipped. Balls (sphere geometry) are never skipped, and neither is anything tagged `userData.xrKeep`.
  - **Glow.** Additive glows dimmer than 0.025 are skipped. Emissive intensities are multiplied by 1.55 and additive opacities by 1.45 to stand in for the missing bloom. An instrument can set its own factor with the descriptor's `xrGlow` (1 = off), or use the optional `inst.xr(on)` hook (`src/instruments/README.md`).
  - **Dust.** `PointsMaterial` sizes are scaled back by U, because the head-space distances are metres and the motes would otherwise draw 1.48× too big.
  - **Rooms.** A room may implement `xr(on)`. The **studio** swaps its Reflector for a plain glossy floor (no extra scene render per eye). The **arena**'s blinders peak at 45%. The **starship**'s sky banks half as far, and the deck never moves.
- **The director and the ride cam never move the headset.** `cam.update` is skipped while presenting, and only `xr.js` ever reparents the camera. **TOUR** replays the director's edit as blink-teleports between pads; a `ride` shot lands on the belt's pad. `scripts/xr-shot.mjs --tour` asserts the head stays put in the rig with the RIDE camera selected.
- **Pads.** `xrplan.planAnchors` turns each director shot eye (already solved to sit in clear air and see its subject) into a catwalk pad: feet = eye − 1.6 m, facing the aim, pulled 15 % closer, and backed off if a standing user would intersect a machine's box. It also adds one pad at the belt (band height; the juggler is one machine, so one pad), plus the wide. The pad under you is solid brass. The others are faint glass discs with a lit rim, so they don't litter other shots.
- **Teleport arc.** It is the engine's own `solveLaunch` + `arcPos`, a solved marble throw onto the pad: a target plus a launch solve.
- **Audio.** ENTER VR calls `enterSound()` inside the click, and every controller `selectstart` calls `audio.gestureRetry()`. `audio.js` is untouched. `placeAt()` places strikes against the **head pose** (`xrplan.earFrame`: head frame, world units, tanH 1, focus = head → the pad's aim), and `spatial.js` keeps its contract.
- **Leaving VR.** Leaving restores the camera's parent, pose, fov and near/far, and re-syncs the renderer, composer and room sizes. The 2D director picks up where it left off.

---

## 5. Known limits / honest status

- **Perf is the real risk, and the emulator can't measure Quest GPU time.** Draw calls per frame, both eyes, measured under IWER at t = 12 s (`node scripts/xr-perf.mjs --songs … --anchors stage,lead [--detail full]`):

  | Song (room) | Pad | Before (`xrdetail=full`) | Detail profile |
  |---|---|---|---|
  | Für Elise (grid) | stage / belt | 592 / 455 | **193 / 163** |
  | Mountain King (grid) | stage / belt | 614 / 379 | **244 / 143** |
  | Daybreak Engine (grid, full room) | stage / belt | 1451 / 679 | **555 / 313** |
  | Forge of the Marble King (arena) | stage / belt | 1081 / 823 | **506 / 385** |
  | The Entertainer (studio) | stage / belt | 1273 / 853 | **500 / 320** |

  (Measured 2026-10-07 with the classic belt — one paternoster per voice. The juggler belt, one machine since 2026-10-24, changes the belt column; re-measure with the command above.)

  The worst case is about 280 per eye, inside the 300–500 per eye a Quest 2 wants at 72 Hz. Triangles are unchanged (about 1M per frame for the full room, both eyes). If the GPU is the limit, `?xrscale=0.8` is the first knob; foveation is already at its maximum (1). Real frame timing needs the headset: use `chrome://inspect` → Performance, or OVR Metrics Tool. `__dev.xrPerf()` (with `?debug`) shows what the profile is doing: parts batched and drawn, parts drawing as themselves mid-flash, parts hidden, glows dimmed.
- **The DOM HUD is invisible in VR.** The wrist label and the **Y menu** cover songs, rooms and the transport. MAP (re-routing) and EDIT STAGE are still 2D-only.
- **The controllers are procedural chrome wands**, not the Touch models. That's deliberate: no CDN profile fetch. Hand tracking isn't wired yet.
- **AR** is experimental: true scale doesn't fit a room (the band is 18.7 m up). The planned design is single-station AR at true scale on your real floor; see the research notes.
- Standing on the STAGE pad puts you about 16 m above the void floor. The solid pad under your feet is there for that, but tell us if it's too much.

---

## 6. Testing without a headset

IWER (Meta's WebXR emulator) is a devDependency. It is only loaded by `?xremu` on the **dev server** (`import.meta.env.DEV`-gated dynamic import), so it is never in `dist/` or the single-file build.

```sh
npm run dev -- --port 5173
node scripts/xr-shot.mjs --url 'http://localhost:5173/?song=fur-elise&debug&xremu' --anchor lead --t 5 --out /tmp/xr.png
node scripts/xr-shot.mjs --url '…&xremu' --teleport marimba --controls 1 --tour 5     # drives the controllers
node scripts/xr-shot.mjs --url '…&xremu&ar' --mode ar --out /tmp/ar.png
```

The script exits non-zero on any failed check or console error. It covers:
- presenting
- songTime advancing in the XR loop
- the aim → hover → release → landed sequence
- B pause, scrub, A tour, snap turn
- Y opens the menu; pointing + trigger picks a song and a room; CLOSE closes without throwing you
- the RIDE camera selected while presenting: the head stays put in the rig
- exit back to 2D

`scripts/xr-perf.mjs` prints draw calls per song × pad (`--breakdown 1` adds who draws them).

It also saves the side-by-side stereo frame.

Gotcha: desktop Chrome ships a native `navigator.xr`, so IWER must be installed with `installRuntime({forceInstall: true})`, or `requestSession` fails with "configuration not supported". `src/xr.js` already does this.

For hands-on desktop poking, open `http://localhost:5173/?xremu` in Chrome and click ENTER VR. In the console, `__xrdev` is the emulated device: `__xrdev.controllers.right.updateAxes('thumbstick', 0, -1)` and similar. `__dev.xr.info()` shows the pads and pose. Add `?debug` to get `__dev`.
