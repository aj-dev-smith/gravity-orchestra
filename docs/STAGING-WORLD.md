# Staging world, 2026-10-25: changelog and guide

Everything below is on the **`staging-world`** branch (off `main` 6db6c8c; 103 commits, HEAD
d172126). It is **not merged to `main`, not deployed, and not pushed**. The suite was 63 files /
2891 tests on the merged wave-4 tree, and the staging fixture was regenerated on it. Nothing here was
seen on a real iPhone or worn on a real Quest 2; all of it was checked in headless Chrome (desktop and
a 390x844 touch emulation) and by IWER draw counts.

The rules held: the physics and the music engine were never touched, time is the only state (every
reaction is a pure function of `songTime`), rooms own no lights (the 14-light set is constant), a
room swap never rebuilds the song's world or restarts the timeline, and per-frame room work is
uniforms only.

---

## Why

AJ, 2026-10-25: "the one thing I don't love is how the machines sit in the rooms. it's kind of static
and out of place." Then: "almost like rollercoaster tycoon style height placement? I don't love height
being predetermined. not everything needs to be on scaffolding in the air. you could just set things in
the world. why not? but I do like the idea of scaffolding being different when you raise the height."

The diagnosis was measured. `STAGE.FLOOR` was **-22**, a leftover from the June conveyor that reached far
down. Every machine's deck sat near y = 0, so each stood on about 22 u (15 m) of legs, risers and black
boxes, and the gallery machines stood on about 36 u towers. Every support was the same generic black
leg in every room, room props were dressed for a floor 15 m below and nothing kept them out of a
machine's footprint, and only the arena reacted to the music.

## What changed

1. **The floor came up.** `STAGE.FLOOR` is **-5.5** (`src/rooms/common.js`). Every room derives its
   floor from it, so a room swap stays instant. The hard-coded -22 / -21 / -20 assumptions outside the
   plugins were removed.
2. **Machines are set IN the world.** main builds every floor station once with `floorY: 0` (no legs,
   no riser, no pedestal). A machine's `ground` is where it stands on the floor:
   `ground = FLOOR + FOOT.PLINTH - low`, with `low` the lowest SOLID part (no glows, wires or beams)
   over the rest pose plus 12 loop samples. The kit stands on its own deck slab (`DECK_UNDER` -.34) on a
   pad with a WELL for its pistons' deepest dip (`pistonDip`). The turntable declares `stand: -.36`
   because its resonator tubes hang: its footing is an OPEN stand (a post under each foot, beams kept
   out of what hangs).
3. **Height is the user's: a per-machine LIFT.** Deck y = ground + lift. 0 = on the floor. A floor
   station's change is a rigid y-move (`rig.setLift`, no rebuild); the kit is rebuilt at its deck. The
   belt never moves (its own posts, a kerb under them) and hung stations (organ loft, chandelier, court)
   keep hanging. The layout's old GALLERY raise is just a lift now.
4. **Footing: supports that change with height, dressed by the room.** `src/rooms/footing.js` (pure)
   plans a pad per machine by support height h above the floor: **flush** h <= .8 (plinth) · **low**
   <= 3.5 (dais + stair) · **mid** <= 10 (braced platform, rails, stair or ladder) · **high** > 10
   (truss tower, caged ladder, rest landings). Raised neighbours at one height (|d top| <= .6, <= 3 u
   apart) share ONE **LOFT**. Each room supplies a style that swaps forms and materials per band.
5. **Rooms react.** Every anchor carries its machine's strike cue; `src/rooms/pulse.js` turns it into an
   envelope (afterglow, max not sum, plus anticipation), silent in the count-in. The default footing has
   a glowing EDGE per pad in the machine's colour; each room adds its own answer (below).
6. **Props clear the machines.** Each room's `place(anchors, plan)` keeps graves, pews, candles, gear,
   pyro, crates and mic stands out of every footprint and every footing envelope.
7. **Floor-first layout, the star front and centre** (below), and **height editing in EDIT STAGE**
   (below).

## Wave 3 (merged)

- **Drum riser.** While a band machine (riff / strum / horns / pogo) plays, the kit stands on the right
  wing on a 3 u dais (`KIT_RISER` in stations.js), the drummer behind the band.
- **Tiered risers.** A band seat hidden behind the front row takes the smallest riser (1.5 or 3 u).
- **loneTurn.** A star standing alone with a `turn` hint (the grand, .55 rad) is turned before it is
  measured: Piano Man's grand is a three-quarter view.
- **Host prewarm.** Idle time builds every unvisited room, places it on the current anchors, builds its
  footing and single-passes it before compiling. A swap compiles 0 programs in every room (it was 1 to 4)
  and the R handler takes 0.1-0.5 ms.
- **Style hooks may return `true`**; `kit.slot(name)` / `kit.unit`; `gapOf` and `landings` exported;
  `__dev.footStats` counts only what the GPU draws.
- **`beamMat` cap.** The facing term is capped at 1 (MSAA extrapolation pushed it past 1 and bloom smeared
  a white blob under a lifted kit). The Void's keel shader still lacks it (open issues).
- **Edit x layout.** AUTO re-asks the room solve where the machine stands now (pinned), so it agrees with
  a reload. A MOVE takes the height the solve gives its new spot. REDO. One tool on the screen at a time
  (MAP and EDIT STAGE). A grab frames headroom for the raise.
- **Per-room perf.** Graveyard arch courses are adaptive (1401 to 1113 boxes), starship towers rail only
  their front, the studio atlas is 2048x1024.

## Wave 4 (per-room polish)

A critic pass per room on the merged tree (every room shot across several songs, a lifted machine, the
drum riser), then the worst things fixed, each reviewed. Merged at d172126; 63 files / 2891 tests; the
fixture now records room solids PER SONG.

- **Every room** dropped its wave-2 workarounds now that the host supports them: style hooks return `true`
  instead of an empty claim Group, `gapOf` / `landings` / `onSide` come from footing3d.js, `kit.slot(name)`
  replaces `kit._bufs`. The cathedral's own warm-up is gone (the host prewarm covers it: 0 fresh programs
  per swap, measured). The Void keeps its local forceSinglePass (dropping it compiled on swap).
- **Cathedral**: candles flank a machine on ITS OWN sides, whatever its yaw (they went to a turned machine's
  back corners), and never stand in front of it; limestone tops read as flagstones, not boards.
  `staging-audit.mjs` checks an owned solid (a candlestick, `userData.owners`) against its owner's turned
  footprint.
- **Greybox**: the floor stage plot is for walkers only (gone from the director's film); towers and lofts
  are Warren-braced, one diagonal a panel, no lace on back faces; the ripple pass walks only lit machines.
- **Metal Arena**: the backline is a wall of 4×12 cabs (grille, piping, logos) that answers the riff and
  pogo only; a lifted-off flame column's foot burns away instead of cutting flat.
- **Void**: the keel beam's facing term is capped like beamMat; raised rock and stone walls catch the
  nebula (cairns no longer navy cut-outs), stopping under the ceiling.
- **Starship**: rams are turned (16 sides, smooth normals; round scissor rams), the steel is warmed gunmetal,
  the umbilical bend is a round tube with a coupling.
- **Graveyard + Studio**: the studio's epoxy mirror blurs with a turned Vogel disc (no pixel mosaic).
  Graveyard fog measured ≤ .24 ms of the main pass on a laptop GPU.
- **Host**: an open stand's access goes by its deck HEIGHT, not its lift — the turntable (≈ 4.2 u up at
  lift 0) gets a ladder in every room's materials. `staging-audit.mjs` records every room's solids per song.

Measured on the merged tree: only Starship Groove sends machines to the gallery (horns + riff at lift
18.9); Forge, Mars and The Entertainer put the kit on its 3 u drum riser; every other catalog song stands
everything on the floor.

## How to try each piece

`npm run dev`, then:

| try | URL / action |
|---|---|
| the full cast on a floor | `/?song=finale&room=starship` (10 machines + kit; two climb to a loft) |
| the drum riser | `/?song=forge` (kit on the right wing, riff centre) or `/?song=mars` |
| a room, any song | `/?song=daybreak-engine&room=<grid\|cathedral\|studio\|void\|graveyard\|arena\|starship\|off>`; **R** cycles |
| a machine on a riser | `/?song=daybreak-engine&lift=marimba:4` (u above its ground; `lift=marimba:4,drums:2.5`) |
| a tower | `&lift=bells:14` (high band: truss, caged ladder, landings) |
| a lone star turned | the Piano Man MIDI (a lone grand, three-quarter) |
| the dev hooks | add `&debug` (below) |
| height editing | **EDIT STAGE** on a floor machine (below) |

Lift is page-wide dev input; a layout entry's own lift (set in EDIT STAGE) wins over `?lift=`.
Compare heights in metres (1 u = 0.677 m).

### `?debug` hooks (`window.__dev`)

- `__dev.footing()` the footing plan (pads, lofts) · `__dev.footBoxes()` its envelopes · `__dev.footStats()`
  `{draws, tris, ms, room}`: the draws are what the GPU draws (visible meshes with geometry), and `ms` is the
  last build.
- `__dev.lift(key, u)` set a station's or the kit's height live (re-anchors the room, rebuilds the
  footing, re-solves the director); `u` undefined = AUTO.
- `__dev.anchors()` what the room was last told stands where · `__dev.stage` the floor contract.
- `__dev.room()` the live room object (null for `off`).

### EDIT STAGE: height

Select a floor machine; a **height handle** stands at the footprint corner nearest the eye: a pole with
a tick every metre, a knob, a readout chip (`+12.8 m · TOWER · LOFT · RIFF FORGE`), a floor shadow and
dashed drop lines. Heights are said in metres with the band name: FLOOR / RISER / PLATFORM / TOWER.

- **Drag the knob.** Relative, snaps to half a unit (34 cm), Shift = free. MAGNETS: the floor, and a
  neighbour's deck within `LOFT_DY` (.6 u), so the two share a loft.
- **Keys.** PgUp / PgDn and `]` / `[` step half a unit (Shift 2 u). Home = floor.
- **Dock buttons.** ▲ RAISE · ▼ LOWER · FLOOR (an explicit 0, which outranks the gallery raise) · AUTO
  (forget the height; the layout decides, exactly what a reload would give).
- **Undo / redo.** One undo step per gesture; REDO is Cmd-Shift-Z / Ctrl-Y (and a ↷ button when there is one).
- **Views.** Grabbing the knob in the plan view eases to an elevated 3/4 view with 8 u of raise framed;
  PLAN | 3D in the bar flips. The camera never moves during a drag.
- **Limits.** `FOOT.LIFT_MAX` (24 u) and the machine's top stays 1 u under the ceiling. The belt and hung
  stations are clicked for a "why" line.
- **Saved** per song, and share links carry `[x, z, yaw, lift]` (lift 0 kept; absent = AUTO). Old links work.

The gesture moves the machine rigidly and re-plans the footing every frame (2-5 ms). At the gesture's end
(700 ms settle) the kit is rebuilt and the director re-solves once (0.3-0.7 s pause).

---

## The layout rules (`src/instruments/stations.js`, `layoutStations`)

- **Floor first.** riff / strum / horns / pogo carry `floor: [seat...]` (centre, left, right, wingL/R,
  cornerL/R, backL/R). Each takes the first free seat within `SEAT_R` 4.5. A seat where the audience's
  eyes see the machine more than `HIDE_MAX` .3 hidden does not count as free. Floor passes (margin 1,
  .7, .45) come before any gallery pass.
- **The gallery is a loft, the overflow.** When the floor is full the fewest machines climb, beside one
  already up (one loft, `FOOT.LOFT_GAP`). Only Starship Groove climbs (horns + riff, measured on the merged tree). A pinned
  gallery-born machine behind the belt goes up.
- **The star.** main passes the director's signature (imports, or a song's `director.signature`) to
  `layoutStations({star})`. It stands at `STAR` (belt centre, z 10) and never climbs. Nobody taller than
  the sightline to its base stands in its foreground, and a tall star steps forward.
- **The drum riser.** The kit moves to the right wing on a 3 u dais while the band plays, only if the
  wing is free and the kit is seen there. A user's lift 0 keeps it down; a kit pinned on the wing stands
  on the riser. Campfire (bells would hide) and Starship Groove (music box holds the wing) keep it front-right.
- **Balance.** A band machine tries the side with fewer machines first.
- **Tiered risers.** Back seats (z < 10) hidden behind the front row take 1.5 or 3 u. Front seats never rise.
- **It never costs the floor a machine.** Floor passes run with all of the above, then without it (the
  old solve), and only then the gallery opens.
- **Pins win.** A machine the user placed or lifted stays.

---

## The footing contract (adding or changing a room)

A room is `{key, label, build, place?, update?, xr?, dispose}`; rooms/index.js has the full header.
For its supports a room returns **`footing: Style`** from `build()`.

1. **Style hooks.** `{ key, mats?(kit, ctx), flush?, low?, mid?, high?, loft?, edge?, dispose? }`. Each
   form hook is `(spec, kit) -> null | true | Object3D`:
   - `null` / undefined: the kit draws its own form;
   - `true`: handled, nothing to add (the hook wrote into the merged slots);
   - an Object3D: handled, and it joins the footing group (tagged `userData.footing`).
   An `edge` hook returning non-null suppresses that pad's strip. There is **no `open` hook**: an open
   stand reaches its band's hook with `spec.open`, `spec.feet`, `spec.hang` set. Every pad has
   `spec.foot = [w, d]`.
2. **Stay inside `footingBoxes(plan)`.** Those envelopes are what the shot solve keeps an eye out of,
   what the director's glide test raycasts, what XR keeps its pads out of, and what
   test/staging-audit.test.js re-plans at the solved spots. Merged meshes carry `userData.boxes`.
3. **`tintStyle({ base, steel, deck })`** (footing3d.js) is the cheap way: the kit's forms in the room's
   own materials, made once per built room (the room disposes them). `kit.slot(name)`, `kit.box / bar /
   edge`, `kit.forms.*`, `kit.DIM`, `gapOf`, `landings` are there for real forms; write into the merged
   slots so the footing stays a handful of draws.
4. **Clear props from the anchors.** `place(anchors, plan)` keeps every prop out of every footprint, every
   `footingBoxes` envelope and, for rotated pads, the pad as the plan turned it (`supportRects`), never
   the AABB of a rotated pad. Hide or relocate instances; never park them at the origin (they become bogus
   solids).
5. **No lights.** The 14-light set is constant. Per-frame work is uniforms only, with constant pools and
   no allocation in `update`.
6. **React with `makePulse(a.cue, a)`** (rooms/pulse.js): `.at(songTime)` / `.next(songTime)`, a pure
   envelope, silent before `start`. An accent, never a strobe; busy machines get softened.
7. **Prewarm.** Everything that changes a program must exist by the end of `place()`: create
   `instanceColor` at build if you colour instances in `place()`; never flip a material's defines or map
   presence on the first `update()`; set `userData.boxes` on a merged mesh that spans floor to ceiling.
8. **Test.** A footing-containment test over the staged catalog and with machines lifted (see
   test/room-grid.test.js, test/room-cathedral.test.js), then regenerate the staging fixture once.

---

## Each room's look

| room | footing | the room answers |
|---|---|---|
| **grid** (Greybox) | the grid folds up into graphite volumes edged in light: slab, stepped riser with lit nosings, X-braced deck behind smoked glass, light lattice tower, glass loft (`grid-footing.js`) | strike ripples in the machine's colour across the floor grid (`grid-floor.js`, a pool of 20); a STAGE PLOT names each machine on the floor with its elevation (`grid-plot.js`); the grid is a shader (`grid-shade.js`) |
| **cathedral** | stone and oak: ashlar plinth with brass inlay, chancel dais, arcaded platform, two-storey nave elevation, oak tracery loft; a ladder over 5 u becomes an engaged stair turret (`cathedral-footing.js`) | two brass candlesticks beside every machine, flames flare on its strikes (`cathedral-props.js`); coronas and prickets clear lifted machines |
| **studio** (Midnight Studio) | Persian rug riser, carpeted risers with stage steps, flight-case piers, black truss tower with outriggers, grating catwalk loft with a cable tray, one canvas atlas (`studio-footing.js`, `studio-atlas.js`) | a panel per support: red tally, 12-segment VU with peak hold, the machine's name (`studio-vu.js`); mic stands keep clear (`studio-props.js`) |
| **void** | every machine stands on an ISLAND of dressed stone whose top is the floor; rock terraces, hoodoo pillars, cairns, a floating ridge for a loft (`void-isles.js`, `void-ground.js`, `void-footing.js`); the chandelier hangs from a sky rock | island runes lit by the nearest machine; crystals lift on strikes, posed in the vertex shader |
| **graveyard** | ledger stone, chest tomb with crypt stair, mausoleum, timber scaffold with a gallows lantern bay, crypt terrace loft (`graveyard-footing.js`); high pads read as ruined bell towers | a churchyard planned round the machines (`graveyard-place.js`); flame flare, a per-machine fog glow and a drifting wisp; deliberately quiet |
| **arena** (Metal Arena) | real staging gear: Litedeck with LED line, drum riser with stage stairs, Layher scaffold, half-metal box truss (`arena-footing.js`) | an LED VU RING round every deck that fills with the machine's strikes; the pyro stands clear (`arena-props.js`); beams fade near the eye |
| **starship** | ship hardware: hazard-edged deck plate, scissor lift or jacks, telescoping chrome rams, lattice gantry with grated decks, grated catwalk loft (`starship-footing.js`); tall towers rail only their front | running lights chase each plate's channel from every strike, a status beacon blinks before an entrance (`starship-deck.js`); deck hatches and crates keep clear |
| **off** | the kit's DEFAULT_STYLE (concrete with a steel cap) and its reactive edge | none |

The Void drops the flush pad's own edge strip (the island rim is the line).

---

## Test and audit commands

    npm test                                  # 63 files / 2883 tests, ~1.5 min
    npx vitest run test/footing.test.js test/footing3d.test.js test/pulse.test.js \
      test/stations.test.js test/editor-height.test.js test/editor.test.js \
      test/room-grid.test.js test/room-cathedral.test.js test/room-studio.test.js \
      test/room-void.test.js test/room-graveyard.test.js test/room-starship.test.js \
      test/arena-staging.test.js test/arena-props.test.js test/staging-audit.test.js
    # the staging fixture: regenerate ONCE on the merged tree after ANY layout / floor / station / room change
    node scripts/staging-audit.mjs --base http://localhost:<port> --norun 1 \
        --rooms grid,cathedral,studio,void,graveyard,arena,starship \
        --fixture test/fixtures/staging-rooms.json
    node scripts/merge-audit.mjs <url>        # must print all ok after any instrument / station change
    node scripts/director-audit.mjs           # every song's shot shares (unchanged by this work)
    node scripts/xr-perf.mjs                  # draw calls per song x pad
    node scripts/shot.mjs --url 'http://localhost:<port>/?song=finale&room=cathedral&debug' --cam stage --out /tmp/x.png

Wall-clock tests (footing3d "fast", inst-riff bake) can flake under load: re-run the file alone first.

---

## Open issues

Not heard or seen on real hardware: **nothing was tried on a real iPhone or a Quest 2** (headless Chrome,
touch emulation, IWER draw counts only). The edit knob is not wired into the VR menu.

Layout
- The riser and "seen" judgements use the solver's fixed eyes (`OCC_EYES`), not the real wide shot;
  `KIT_RISER.lift` is a fixed 3 u.
- Mars's centre riff is about 35 % hidden behind the kit's arch (under `HIDE_MAX`, so accepted).
- Starship Groove's two climbers are 15.6 u apart, so two towers, not one loft.
- A STAR exists only for imports or `director.signature`; a hand-authored song places the band by seat order.
- Piano Man's grand is a three-quarter but still on the belt's axis in front of its base (the wide's
  `starDirs` swings 12-27 degrees). Alabama's and Rickroll's front-right are empty.
- Danse Macabre's bass is 100 % behind the kit and Daybreak's music box 82-99 % from a low eye (pre-existing).
- On imports the MAP panel auto-opens over the right of the wide, over the kit on its riser.

Editing
- A pause of 0.3-0.9 s once when a height gesture ends (the restage runs synchronously).
- A drag of more than 8 u carries the top under the bar until release (the camera never moves mid-drag).
- Two unselected name tags can overlap. On a phone the knob can land up to ~120 px off the finger.
  Phone drags on finale ran 56-59 fps with one 66-166 ms hitch (probably the first tower build).
- An explicit FLOOR on a gallery machine behind the belt stays there (the bar now warns it is hidden).
- The turntable's open stand at lift 0 is about 4.2 u tall with no ladder or stair (the climb check uses
  lift, not height).

Rooms and host
- The Void's keel-beam shader (`void-ground.js`) still has the uncapped `pow(abs(dot(vN, vV)), uEdge)`.
- The arena's blinders and par cans are sized for the old -22 floor; its front-wash pars aim at y -8.
- The staging audit records room solids from the first song only, so per-layout props (cathedral
  candlesticks, studio mic stands) are frozen at Daybreak's positions.
- First footing builds on finale run 8-16 ms on a loaded machine (target ~10): cathedral and starship
  ~2x the default kit, a finale with two lofts in the graveyard ~23 ms. Prewarm builds each unvisited
  room's footing in idle time (5-20k triangles each).
- Strike reactions are deliberately quiet (graveyard barely visible in a wide). Grid's light lattice
  is brighter than the old dark steel (`glace` in grid-footing.js is the knob); its floor ripple loops
  20 slots per pixel (GPU cost on a phone unmeasured). Grid labels near the front can sit under the HUD
  button bar; finale's strum on the loft gets no floor label.
- Studio VU panels may be hard to read at phone resolution; the pink front LED tube flares into the
  bottom-right of the wides. Starship: flat-shaded rams up close, busy lattice, blue-tinted steel,
  stretched crate labels. Cathedral: a slim single-flight turret reads as a column; two candle pairs can
  read as one cluster.
- Hung machines over another machine's stand do not ripple the grid floor (Daybreak's ricochet).
- Mic stands carry empty `userData.boxes`, so the shot solve looks past them.
