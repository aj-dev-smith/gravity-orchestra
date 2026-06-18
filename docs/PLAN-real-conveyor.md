# PLAN — The real conveyor (a visible belt machine on a wall)

> Make the conveyor *physically real*: arrange the tracks as **tidy side-by-side
> bays on a common wall**, then give each its own scrolling belt wall, spinning
> pulleys, and a bracket per pad that clips the pad to the belt so it visibly
> **rides up**. Brackets-to-belt mount (AJ, 2026-06-17). Read this + current
> `src/main.js` / `src/engine.js` before building.

## The one idea that keeps this honest

The machine only **draws what the math already implies**. Every pad rises at a
constant `DESCENT` (belt-phase derivative is constant except at the off-screen
wrap). So the belt is a **constant-speed scroll with zero drift** — no songTime,
no physics, no state to sync. Engine stays pure; this is render-only. A texture
scrolling at `DESCENT` and pads rising at `DESCENT` are slip-free forever, free.

---

## PHASE 0 — Track placement: side-by-side bays on a wall

This comes FIRST, ships on its own, and is the foundation everything else sits on.
It's also **the first brick of the product vision's "user-placed instruments"** —
we're introducing a real placement transform per track, defaulted to a tidy wall.

### Today
Tracks overlap in x and are staggered in z (`zBase`: lead 0, alto −3.4, bass +4.2).
Pads are added straight to `world`; marbles render at absolute pad coords.

### Target
Every track builds in its **own local frame** (around x=0, z=0, z-weave intact),
and is placed by a per-track **`origin`** via a **`stage` group**:

```
   ┌── bay 0 ──┐  ┌── bay 1 ──┐  ┌── bay 2 ──┐
   ║▓║ LEAD    ║  ║▓║ ALTO    ║  ║▓║ BASS    ║     ← all on one wall, common z
   ║▓║ pads…   ║  ║▓║ pads…   ║  ║▓║ pads…   ║
```

- `tr.stage = new THREE.Group()` → `world.add(tr.stage)`. **All** of the track's
  geometry (pads now, machine later) lives under `tr.stage`. Pads are added to the
  stage, not `world`.
- `tr.origin = new THREE.Vector3(bayX, 0, 0)` → `tr.stage.position.copy(tr.origin)`.
  Common wall ⇒ `origin.z = 0`, `origin.y = 0` for all. Only x differs (the bay).
- `buildTrack` builds at **z origin** (pass `zBase = 0`; the z-weave still wiggles
  ±~1.4 around 0 so arcs keep their depth — NOT flattened dead-wall, by choice).

### Bay layout (in `buildWorld`, after all tracks built, before stageView)
```js
const GAP = 3;
let cursor = 0;
tracks.forEach(tr => {
  const xs = tr.padObjs.map(po => po.base.x);
  const lo = Math.min(...xs), hi = Math.max(...xs);
  tr.origin = new THREE.Vector3(cursor - lo, 0, 0);   // shift field's left edge to cursor
  cursor += (hi - lo) + GAP;
});
const total = cursor - GAP;                            // centre the whole wall on x=0
tracks.forEach(tr => { tr.origin.x -= total/2; tr.stage.position.copy(tr.origin); });
```
Order = build order = **lead, alto, bass** left→right.

### Why physics is untouched
Sliding a track sideways is a rigid translation; gravity is vertical. `arcPos(p0+Δ,
v0, t) = arcPos(p0,v0,t)+Δ`, velocities unchanged. `ballPos` stays pure/local; we
add `tr.origin` only at **render** time.

### Render touch points (all just `+ tr.origin`)
- Marble: `rpos.add(tr.origin)` before `rig.group.position.copy(rpos)` (rigs stay in
  `scene`, positioned in world — simplest; don't re-parent pooled rigs under a
  per-song stage). `marblePts` push the origin-shifted `rpos`.
- Trails: spawn at the origin-shifted `rpos`.
- `strike(tr,i,rig)`: `padR = (pad.pos.x, STAGE_Y, pad.pos.z) + tr.origin`.
- Belt loop is UNCHANGED: `po.g` lives under `tr.stage`, so setting its **local**
  position (`po.base.x`, `STAGE_Y-.12+DESCENT*c`, `po.base.z`) is correct — the stage
  applies x/z. (`STAGE_Y` is world-y and `origin.y=0`, so local-y == world-y. ✓)
- `stageView` (FIXED cam): compute min/max over `po.base.x + tr.origin.x` (world x)
  across ALL tracks → frames the whole wall.

### Phase 0 acceptance
- All songs play: marbles strike on the beat, audio matches, no desync.
- Tracks visibly sit in separate side-by-side bays on a common wall.
- AUTO / ALL / per-track / FIXED cams all still frame sensibly (ALL & FIXED now span
  the wider wall; the FIXED `z` cap may engage sooner — see Risks).
- `npm test` green (render-only; no engine change).
- Commit Phase 0 on its own before touching the machine.

---

## Module: `src/conveyor.js` — "the visible machine"

Third render subsystem in the shape of `juice.js` / `audio.js` (thin seam, DI'd
deps). Builds **in each track's local frame** (added under `tr.stage`), so bays are
already separated for it — no neighbours to fight. `main.js` grows ~4 lines.

```js
import * as THREE from 'three';

export function makeConveyorShop({ chrome, envMap, beltSpeed, bandY, reach }) {
  const beltCanvas = makeBeltCanvas();        // expensive raster, ONCE
  return { buildMachine };

  function buildMachine(track) {              // once per track, in buildWorld
    const style = MACHINE_STYLE[track.role];
    const wall     = buildBeltWall(track, style, beltCanvas, { envMap, bandY, reach });
    const pulleys  = buildPulleys(track, style, { chrome, bandY, reach });
    const brackets = mountBrackets(track, style, { chrome });   // one per pad
    const group = new THREE.Group().add(wall.group, pulleys.group, brackets.group);
    return {
      group,                                  // caller adds to tr.stage (local frame)
      update(dt){                             // call AFTER the belt loop sets po.g.position
        wall.scroll(beltSpeed * dt);
        pulleys.spin(beltSpeed * dt);
        brackets.sync();                      // mirror each pad's belt-Y + visibility
      },
      dispose(){ wall.dispose(); brackets.dispose(); },
    };
  }
}
```

Every sub-builder is a **small pure function returning a Group** — the file reads
like describing a machine. Style is **data, per voice** (like songs):

```js
const MACHINE_STYLE = {
  lead: { gauge:.22, pulleyR:.50, tint:0x9aa6bd, slat:0xb9c2d4 },
  bass: { gauge:.30, pulleyR:.70, tint:0x7e8db0, slat:0x97a3bf },  // beefier machine
  alto: { gauge:.18, pulleyR:.42, tint:0xa99ec4, slat:0xc6bcdc },
};
const BELT_DEPTH = -2.6;   // belt sits this far behind its OWN pads (uniform now —
                           // bays separate the tracks, so depth no longer staggers).
```

### The pieces (geometry + the bit of math each needs)

**`makeBeltCanvas()` → canvas.** Vertical slat pattern (~64×128): dark metallic base,
evenly-spaced slats with a 1px bevel hi/lo so tiling + scroll reads as moving
segments. Subtle/premium, not loud. Returned as a **canvas** so each track wraps its
own `new THREE.CanvasTexture(canvas)` → independent `offset`, trivial disposal.

**`buildBeltWall(track, style, canvas, {envMap,bandY,reach})`** (local frame)
- x-extent from `track.padObjs` → `minX,maxX,cx,width`.
- `PlaneGeometry(width+2m, 2*reach)` at `(cx, bandY, BELT_DEPTH)`, facing +z.
- `tex.wrapT = RepeatWrapping; tex.repeat.y = 2*reach/SLAT_WORLD`. Material
  `MeshStandardMaterial({map:tex, color:tint, metalness:.6, roughness:.5, envMap})`.
- Side frame: two thin chrome posts at the field edges, full height.
- `scroll(d)`: `tex.offset.y -= d/SLAT_WORLD` (slats travel **up**; verify sign live).
- `dispose()`: geo + tex.

**`buildPulleys(track, style, {chrome,bandY,reach})`** (local frame)
- Two `CylinderGeometry(pulleyR,pulleyR,width,16)`, axis = **x**, at `(cx, bandY±reach,
  BELT_DEPTH)`, chrome.
- `spin(d)`: `rot.x += d/pulleyR` (angular = linear/radius; sign to match belt-up).
  Mostly off-screen — the "it's a loop" tell when FIXED pulls back.

**`mountBrackets(track, style, {chrome})`** (local frame)
- Per pad: a thin arm (`BoxGeometry`) from the pad front (`z≈0`) back to the belt
  (`BELT_DEPTH`), length fixed per pad. Built at the pad's `base.x, base.z`, **in the
  machine group (NOT a child of `po.g`)** → never inherits the pad's tilt/scale.
- `sync()`: for each `{mesh,po}` → `mesh.position.y = po.g.position.y; mesh.visible =
  po.g.visible`. Rides the pad's bob, culls with it, no recompute (po.g already
  positioned this frame).
- Perf path if needed: one `InstancedMesh`/track, `setMatrixAt` in `sync()`. Start
  with individual meshes.
- Known minor: bracket stays at `base.x,z`, so it ignores the pad's small `padOffset`
  flipper nudge on a strike. Negligible; revisit only if it reads.

## main.js touch points (machine, ~4 lines + 1 edit)

1. After envMap/chrome exist: `const shop = makeConveyorShop({ chrome, envMap,
   beltSpeed: DESCENT, bandY: STAGE_Y, reach: 16 });` (fixed `reach=16` covers the ±14
   cull for every song).
2. `buildWorld`, per track: `tr.machine = shop.buildMachine(tr); tr.stage.add(tr.machine.group);`
   (under the **stage**, so it inherits the bay placement for free).
3. `animate`, at the **end of each track's block** (after the belt loop positions
   `po.g`): `tr.machine.update(dt);`
4. Dispose: in `buildWorld`'s traverse, also dispose non-chrome material maps
   (`if (o.material && o.material !== chrome && o.material.map) o.material.map.dispose();`)
   so per-song belt textures don't leak. chrome stays exempt → envMap untouched.
5. Debug: key **M** toggles all `tr.machine.group.visible` for A/B while tuning.
   Freeze belt scroll under `prefers-reduced-motion`.

## Build order (each step shows something on screen)

0. **Phase 0 — placement (bays on a wall).** Own commit. Verify play + cameras.
1. `makeBeltCanvas` + `buildBeltWall` on the **lead bay only**. Confirm slats scroll
   in **lock-step** with the rising pads — the honesty check.
2. `buildPulleys` — drums at the ends, spinning at belt speed.
3. `mountBrackets` — clip pads to the belt. **Payoff frame: pads ride the machine.**
4. Roll out to all bays + the `MACHINE_STYLE` per-voice pass.
5. Taste tuning: slat density, tint, opacity, fog, pulley size, bracket shape.
   Optional extra layer: independent guide rails (composes in as one more builder).

## Risks / gotchas

- **(RESOLVED) z-stacking.** Bays separate the tracks in x, so the three machines no
  longer occlude each other — the depth-muddle risk is gone. This is *why* Phase 0
  comes first.
- **Wider wall → FIXED cam.** Side-by-side bays make the overall field wider than the
  old overlapped layout, so the FIXED cam pulls back further and may hit `FIXED_ZMAX`
  (=30) sooner on big songs (overflow rather than black — by design). Re-check the cap
  value once bays land; nudge if needed.
- **GAP tuning.** `GAP=3` is a guess; tune so bays read as distinct but the wall isn't
  sparse. AUTO cuts now jump between bays (could be nice — cutting between machines).
- **Scroll sign / pulley dir.** Trivial to get backwards — eyeball it.
- **Texture disposal.** Per-track CanvasTextures dispose on song change (edit #4).
- **Belt vs marbles.** Belt at `BELT_DEPTH` (behind pads), low emissive so it doesn't
  bloom or steal focus. Keep it backdrop.

## Acceptance (machine)

1. `npm test` still green (render-only).
2. Slats scroll in lock-step with pad rise — no slip across the loop seam.
3. Pads read as **carried by the belt** (brackets track + cull with them).
4. Pulleys spin at belt speed; **M** toggles the whole machine for A/B.
5. Three-bay songs read as three clean machines side by side (no mud).
6. No per-song texture/geometry leak (watch `renderer.info.memory` across songs).
