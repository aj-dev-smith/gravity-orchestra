# Rooms: the contract

A room ("map") is the environment the machines stand in: set dressing in a static world. It never
touches the solve, the music or a machine. Rooms are swapped live with `R`, mid-song, with no rebuild.

## Quick start: your first room

```bash
npm run new:room lanterns             # key: lowercase letters/digits, no hyphen. It is the file name and ?room=<key>
npm run dev                           # then open http://localhost:5173/?room=lanterns&song=daybreak-engine
npx vitest run test/room-lanterns.test.js test/room-contract.test.js
```

1. **Scaffold.** `new:room` writes `src/rooms/lanterns.js` and `test/room-lanterns.test.js`. The room
   already works: a flagstone court under a dusk sky, a colonnade outside the stage walls, fireflies, and
   a lantern beside every machine that flares on that machine's strikes. Each rule below appears once in
   it, commented. Options: `-- --label "Lantern Court" --color "#ffb45a"`, `--dry`.
2. **Make it yours.** Split big rooms into helpers named `src/rooms/<key>-*.js` (for example
   `lanterns-props.js`). The hyphen marks a helper, so the registry never loads it as a room.
3. **Look at it.** `R` cycles rooms (yours comes after the shipped seven, before "no room"). Try a dense
   song (`?song=finale`, which has machines up on towers) and a sparse one. `?debug` adds a scrub bar:
   scrub backwards and the room must look the same at the same time.
4. **Prove it.** `test/room-contract.test.js` runs every registered room through the contract below
   (yours included, automatically). Your own test covers what is particular to your room. Then run
   `npm test` and `npm run build`.
5. **PR = `src/rooms/<key>*.js` + `test/room-<key>.test.js`.** You don't edit `src/rooms/index.js` (a
   Vite glob registers `src/rooms/<key>.js`) and you don't regenerate the staging fixture
   (`test/fixtures/staging-rooms.json` pins the shipped rooms only; a guest room is not in it and
   nothing fails). Attach a screenshot of `?room=<key>`.

## The module

`src/rooms/<key>.js` default-exports `{ key: '<key>', label, build(scene, { envMap, renderer }) }`, with
`key` the same as the file name. `build()` returns:

| field | |
|---|---|
| `group` | everything the room draws (the host adds it to the scene and hides it when you're not in this room) |
| `FLOOR, CEIL, HW, BACK, FRONT` | `...STAGE` from `./common.js`. **FLOOR must stay `STAGE.FLOOR`.** The others may widen, never narrow |
| `fog`, `background` | a `THREE.FogExp2` (the host copies its colour + density) and a `Color` or `Texture` |
| `mood?` | `{ ambient: [hex, intensity], hemi: [sky, ground, intensity] }` re-tints the two global fill lights |
| `footing?` | how the supports look: `tintStyle({ base, steel, deck })` from `./footing3d.js` (or a full style, see its header) |
| `place?(anchors, plan)` | where the machines stand this song: one anchor per machine (footprint, deck, box, strike `cue`), and the footing plan |
| `update?(dt, songTime, camera, energy, cues)` | per frame |
| `xr?(on)`, `resize?(w, h, pr)` | the headset variant; render-target rooms |
| `dispose()` | free what is NOT in `group` (the host runs `disposeTree(group)` itself) |

The full header contract is at the top of [`index.js`](index.js), the footing kit's at the top of
[`footing3d.js`](footing3d.js), and the story behind both is in
[`docs/STAGING-WORLD.md`](../../docs/STAGING-WORLD.md). Import shared pieces from `./common.js`
(`STAGE`, `rng`, `canvasTex`, `glowPoints`, `instanced`, `trs`), `./footing.js` (`footingBoxes`),
`./footing3d.js` (`tintStyle`) and `./pulse.js` (`makePulse`). **Never import `./index.js`** (that
creates an import cycle).

## The rules (each one is checked by `test/room-contract.test.js`)

- **The floor contract.** `FLOOR === STAGE.FLOOR`, so a room swap never moves a machine. `STAGE` is never
  mutated. A room may widen its bounds (put things outside the stage walls), never narrow them.
- **No lights of your own.** The light set is constant, so a swap never recompiles a shader. Glow comes
  from emissive or unlit materials (bloom picks up anything brighter than 1). `mood` may re-tint the fills.
- **Props stay out of the way.** Whatever the shot solve treats as solid (opaque meshes standing taller
  than 1 u over the floor) stays out of every machine's box and every footing envelope
  (`footingBoxes(plan)`: pads, lofts, stairs, ladders). Place props in `place()` around the anchors, or
  stand them outside the stage walls. `place()` runs again on every stage edit, so it must be cheap.
- **Time is the only state.** `update()` is a pure function of its arguments: scrub to any `songTime`
  and the frame is identical. No `+= dt`, no smoothing that remembers the last frame.
- **No per-frame allocation.** No new THREE object, geometry, material or texture in `update()`, and the
  scene graph keeps its shape. Write uniforms (and, if needed, instance colours). Make constant pools at
  build and show `count` of them.
- **The prewarm rules.** The host builds and compiles every room in idle time before you visit it. So
  an `InstancedMesh` you colour later needs `instanceColor` from `build()` (call `setColorAt` once), and
  nothing after `place()` may change a material's program (defines, maps, `onBeforeCompile`) or swap a
  mesh's material.
- **React through the cue seam.** `makePulse(anchor.cue, { P: anchor.P, start: anchor.start })` gives
  `at(t)` (afterglow) and `next(t)` (anticipation), pure in songTime and silent in the count-in. Make
  them in `place()`, read them in `update()`.
- **The footing style builds** on the plan and stays inside its envelopes (a `tintStyle` always does).
- **`xr(true)` then `xr(false)`** gives back the desktop frame.
- **Dispose leaves nothing behind.** After the host's teardown, every geometry, material and texture
  the room ever drew has been disposed: a geometry you swap in `place()` frees the old one, and the
  footing style's materials are freed in `dispose()`.

The contract builds rooms under Node with a fake DOM (blank canvases, no renderer): it checks
structure, not pixels. Only your eyes in `npm run dev` can tell whether the room looks good, so look
at it from the wide shot, from a station shot and from the ride cam.

**Known exceptions** (shipped rooms only, each with its reason, in `test/helpers/room-contract.js`
`KNOWN`): the arena's own tests have other names, the graveyard's front fence narrows `FRONT` to 40,
and the graveyard's fog density isn't scrub-pure after a dawn cue. A new room should need none.
