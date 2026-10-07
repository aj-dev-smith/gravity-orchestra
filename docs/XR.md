# Cascade in VR: testing on the Quest 2

Branch `ov/xr`. The code lives in `src/xr.js` (the render subsystem) and `src/xrplan.js` (pure: anchors, tour, scale, teleport arc, head-space audio; tested in `test/xrplan.test.js`).

Nothing changes on a page that doesn't support WebXR. The **ENTER VR** button only appears when `navigator.xr.isSessionSupported('immersive-vr')` says yes, so desktop Chrome without a headset, iOS Safari and the Claude iOS iframe never see it.

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

Production (cascade.ajsmithhq.com) is already HTTPS, so it works there after a deploy. **Only deploy with AJ's OK** (CLAUDE.md §0).

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
| **Y** | Next song |

The wrist label on the back of your left hand shows the song, the pad (`→ PAD` while aiming), TOUR/FREE, PAUSED, and the song time.

---

## 3. What to try (in this order)

1. **Für Elise** (`?song=fur-elise&xr`). It's light (≈ 470 draw calls per frame, both eyes). You start on the **lead belt's pad**, with your eyes level with the strike band. Watch a long note lob: **that fall is 9.81 m/s²**. The rig is scaled so 1 world unit = 0.677 m, and every marble falls at true gravity. A marble is about the size of a bowling ball, and the hall is about 51 × 39 m.
2. Throw yourself to **STAGE** (the wide). You'll be high up on a catwalk pad, so check how the height feels. Then try the bass belt's pad.
3. Press **A** for the tour. The pads follow the director's edit (≥ 3 s per shot).
4. Press **B**, then scrub with the left stick. Strikes are suppressed while scrubbing, and the machines re-derive instantly.
5. **Mountain King**: the belt plus the marble drums. Stand on the drums' pad.
6. **Daybreak Engine** (the default full room). This is the **perf stress test** (see §5). Expect it to struggle. Tell us how bad it is.
7. Turn your head while a strike sounds. The pan follows your head and distance follows the pad you stand on. This is the live Web Audio path; the Quest Browser is Chromium, so the iOS sample path is never used there.
8. Optional: **ENTER AR** (shown in the Quest browser, or with `?ar`). This is experimental. It gives grayscale passthrough, with no room, no sky and no fog, and the machines float at true scale in your space. It's the same pads and controls. The band is 18.7 m up, so it's a first look, not a design.

URL knobs: `?xrhz=90` (target frame rate, default 72), `?xrscale=0.8` (framebuffer scale; lower means faster and blurrier).

---

## 4. How it works (one paragraph per seam)

- **The loop.** `renderer.setAnimationLoop(animate)` replaces window rAF. A headset session runs its own frame loop, and the 2D page behaves identically. `songTime += dt` is unchanged, so 72 or 90 Hz both work and strikes quantize to ≤ 13.9 ms.
- **No composer in XR.** EffectComposer can't render stereo, so while presenting main calls `renderer.render(scene, camera)` directly. ACES and the exposure kicks still apply, because three tone-maps XR targets. To make up for the lost bloom, the marble halos and emissive cores step up (`XR_HALO_A .34`, `XR_EMI 2.1`), and the 9 marble lamp PointLights go dark. That light set is constant, so there is one recompile, which happens behind the entry blink. The perf governor and the camera rig are both skipped.
- **Pads.** `xrplan.planAnchors` turns each director shot eye (already solved to sit in clear air and see its subject) into a catwalk pad: feet = eye − 1.6 m, facing the aim, pulled 15 % closer, and backed off if a standing user would intersect a machine's box. It also adds one pad per belt bay at band height, plus the wide. The pad under you is solid brass. The others are faint glass discs with a lit rim, so they don't litter other shots.
- **Teleport arc.** It is the engine's own `solveLaunch` + `arcPos`, a solved marble throw onto the pad: a target plus a launch solve.
- **Audio.** ENTER VR calls `enterSound()` inside the click, and every controller `selectstart` calls `audio.gestureRetry()`. `audio.js` is untouched. `placeAt()` places strikes against the **head pose** (`xrplan.earFrame`: head frame, world units, tanH 1, focus = head → the pad's aim), and `spatial.js` keeps its contract.
- **Leaving VR.** Leaving restores the camera's parent, pose, fov and near/far, and re-syncs the renderer, composer and room sizes. The 2D director picks up where it left off.

---

## 5. Known limits / honest status

- **Perf is the real risk, and the emulator can't measure Quest GPU time.** Draw calls per frame, both eyes, measured under IWER (`scripts/xr-shot.mjs` prints them):

  | Song | Draw calls per frame |
  |---|---|
  | Für Elise from the belt pad | ≈ 470 |
  | Für Elise from the stage pad | ≈ 575 |
  | Ode to Joy | ≈ 350 |
  | Daybreak Engine (full room) from a station pad | ≈ 290 |
  | Daybreak Engine (full room) from the stage | **≈ 1500** |

  three r184's WebGLRenderer has no multiview, so every eye is a full pass. Light songs should hold 72 Hz. The full room from the wide will not, without an XR LOD pass: merge the belt's per-pad meshes, a lighter room, and fewer additive halos. Real frame timing needs the headset: use `chrome://inspect` → Performance, or OVR Metrics Tool.
- **Studio room**: its floor is a three.js `Reflector`, which renders the scene again **per eye**. Avoid it in VR for now (press R to cycle rooms before entering VR, or use `?room=grid`).
- **The DOM HUD is invisible in VR.** Only the wrist label shows state. You can't use the song menu, MAP or EDIT STAGE from inside; press Y for the next song.
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
- B pause, scrub, A tour, snap turn, Y next song
- exit back to 2D

It also saves the side-by-side stereo frame.

Gotcha: desktop Chrome ships a native `navigator.xr`, so IWER must be installed with `installRuntime({forceInstall: true})`, or `requestSession` fails with "configuration not supported". `src/xr.js` already does this.

For hands-on desktop poking, open `http://localhost:5173/?xremu` in Chrome and click ENTER VR. In the console, `__xrdev` is the emulated device: `__xrdev.controllers.right.updateAxes('thumbstick', 0, -1)` and similar. `__dev.xr.info()` shows the pads and pose. Add `?debug` to get `__dev`.
