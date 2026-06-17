# PLAN — Seamless conveyor (spawner + recirculating belt)

> Working doc for the next build chunk. Uncommitted, lives alongside the
> conveyor prototype already in the working tree. Execution guidance for
> "future me" after a context compaction. Read this + the current `src/main.js`
> / `src/engine.js` before starting.

## Goal of THIS bite

Make the melodic cascade **fully seamless** — no loop jump at all — by combining
the two ideas we landed on:

1. **Spawner / mortal balls** — kills the *marble teleport* half of the seam.
2. **Recirculating belt** — kills the *pad-structure snap* half of the seam.

Scope is **melodic (conveyor) tracks only**. Percussion / stationary instruments
are the NEXT bite, not this one. This bite must leave `npm test` green and the
machine visibly seamless across the loop.

## Where the prototype is now (baseline)

Already in the tree (uncommitted), from the conveyor prototype:
- `engine.js`: `DESCENT = 2.2` exported; `layoutPads` uses it.
- `main.js`: global `lift = DESCENT*T`; `world.position.y = lift`; marble + trails
  + strike juice individually lifted; camera vertical pinned to
  `STAGE_Y = DESCENT*ROLL_T (~5.72)`; debug HUD + world rulers on **G**.
- Known-bad: `lift` is a **sawtooth** → whole world snaps at the seam; the marble
  also teleports (trackPos wraps T). THIS bite replaces both.

## The model (decoupled by construction)

Two mechanisms that never share mutable state; they align only **at strikes**, by
construction:

### A. Belt — pads recirculate, pure function of songTime
- Let `P = ROLL_T + LOOP_T` (loop period; LOOP_T is per-song).
- For pad `i` of track `tr`, its strike time within a loop is
  `s_i = tr.rollT + tr.pads[i].t`.
- **Centered belt phase:** `c_i = mod(songTime - s_i + P/2, P) - P/2`  ∈ [-P/2, P/2),
  so `c_i = 0` exactly at each strike (every loop), negative just before (pad below
  band, rising up to meet the ball), positive just after (risen above band).
- **Rendered pad Y:** `beltY_i = STAGE_Y + DESCENT * c_i`.
  - At strike (`c_i=0`) → `STAGE_Y` (band). The wrap (`c_i: +P/2 → -P/2`) is a jump
    from `+DESCENT*P/2` (far above, off-screen) to `-DESCENT*P/2` (far below,
    off-screen) → **invisible**. No global snap; each pad wraps on its own off-screen.
- Pad **x,z stay world** (the weave / clearance / tilt we built — untouched). Only
  Y is remapped over time. So it's a *vertical* belt: each pad rises in its own
  x,z column, the field staggered by the weave.
- **padOffset (flipper swing) phase = `c_i`** (it already wants `now - hitTime`, and
  `c_i` IS time-since-strike near the strike). Anticipation glow still comes from
  the ACTIVE ball's `nextIdx`/`prog` (below).
- **Cull** pads with `|DESCENT*c_i| > ~10` to `visible=false` (perf; avoids drawing
  the whole offscreen column).
- Remove `world.position.y = lift` entirely. `world` sits at y=0; each `po.g` is
  positioned individually:
  `po.g.position.set(po.base.x, beltY_i, po.base.z).addScaledVector(po.n, padOffset(c_i, po.amp))`.

### B. Balls — mortal, born each loop, per-ball lift
- Per track: `tr.balls = []`, each `{ rig, birthT, lastIdx }`.
- Local time `τ = songTime - ball.birthT` (NOT wrapped).
- Position via `ballPos(tr, τ)` (= today's `trackPos` but taking local τ, no wrap,
  and NOT doing the strike side-effect — it just returns state incl. current `idx`).
- **Per-ball lift = `DESCENT * τ`** → rendered Y = `ballPos(tr,τ).y + DESCENT*τ`,
  which juggles around `STAGE_Y`. Because lift is tied to birth and monotonic, there
  is **no sawtooth on the ball** — the dying ball just has large τ and is deep in
  plunge (rendered below band, fading away).
- **Consistency check (must hold):** active ball born at `birthT = k*P` strikes pad
  i at `τ = s_i`; rendered ball Y `= ballPos(s_i).y + DESCENT*s_i = (-DESCENT*pad.t)
  + DESCENT*(rollT+pad.t) = DESCENT*rollT = STAGE_Y`. Pad rendered Y at that moment
  `= STAGE_Y + DESCENT*0 = STAGE_Y`. **They meet at STAGE_Y.** ✓ (verified in design)
- **Spawn cadence:** track `loopIndex = floor(songTime / P)`. When it increments
  (and at first start), spawn one ball per track: `birthT = loopIndex*P`, `lastIdx=-1`,
  check a rig out of the pool.
- **Death:** when `τ > P + FADE_TAIL` (ball fully plunged+faded), return rig to pool,
  splice from `tr.balls`. FADE_TAIL ~1.0s; pool size **3 per role** for safety (≤2
  normally alive; 3 guards the overlap).
- **Active ball** = youngest alive (max birthT) per track → drives camera focus and
  pad anticipation. Dying balls are render-only (no strike, weight 0 in camera).
- **Strike** moves to the per-ball update: after `ballPos`, if `idx !== ball.lastIdx`
  and `idx` in `[0, pads.length)` and `!skipStrikes` → `strike(tr, idx)` and set
  `ball.lastIdx = idx`. (Dying ball's idx is past the end → never strikes. Good.)

## Rail & pool — simplify to fit the belt (FEEL DECISION, recommended)

The intro **rail** and landing **pool** don't fit a continuous belt (shared static
geometry can't be per-ball lifted). Recommended for this bite:
- **Drop the rail** for conveyor tracks. Ball is **born just above pad 0 and drops
  in** over a short pre-roll (reuse `tr.rollT` window but render as a vertical
  drop-in above the band, not a rail curve). Don't build the rail tube meshes in
  `buildTrack` when conveyor.
- **Drop the pool basin.** Death = ball falls below the band and fades (the existing
  plunge-fade); spawn the splash burst at the ball's **rendered** fade position
  instead of a fixed `poolPos`.
- These declutter and read more "machine." If they feel worse, fallback options:
  keep a camera-pinned rail/pool rig per active ball. Flag for AJ after first look —
  he'll have taste opinions (he wants juice subtle, premium, not loud).

## Per-file change list

**engine.js**
- Add `export function beltPhase(songTime, strikeTime, period)` → centered phase
  `c` (pure). Unit-test it.
- (Optional) `export const STAGE_Y`? No — STAGE_Y depends on ROLL_T*DESCENT, keep in
  main as `const STAGE_Y = DESCENT * ROLL_T` hoisted to module scope.

**main.js**
- Hoist `const STAGE_Y = DESCENT * ROLL_T;` to module scope.
- Rename/rework `trackPos(tr,T)` → `ballPos(tr, τ)`: same body, take local τ, no
  `% `, REMOVE the inline strike/`lastIdx` side effect, RETURN `idx` in the result.
- buildTrack: gate out rail meshes + pool basin for conveyor; keep pads/arcs/padObjs.
  (Stationary tracks later will branch here too.)
- Replace single `tr.rig` usage with `tr.balls[]` + a rig **pool per role**
  (`makeRig` ×3 per role; check-out/in). Keep `rigs` visual params per role.
- animate():
  - Compute `P = ROLL_T + LOOP_T`, `loopIndex = floor(songTime/P)`; spawn on increment.
  - Ball loop: per track per ball → τ, `ballPos`, render rig at pos + `DESCENT*τ` on Y,
    squash/trail (trail at lifted pos), strike detection, death check, track active.
  - Pad/belt loop: per padObj → `c_i = beltPhase(songTime, s_i, P)`, set `po.g`
    position via beltY + padOffset(c_i), flash decay, anticipation from `tr.active`,
    cull offscreen.
  - DELETE global `lift` + `world.position.y`. Strike juice spawns at pad rendered
    pos `(base.x, STAGE_Y + DESCENT*c_i, base.z)` (≈ band at strike).
  - Camera: focus from ACTIVE balls only; vertical stays pinned (already done).
  - Debug HUD: track active-lead-ball rendered Y (keep G + rulers; they're still the
    acceptance instrument).
- Recording seam (`beginRec`/`finishRec`) currently keyed on `T < prevT`. Re-key on
  `loopIndex` increment so seam-to-seam capture still works with continuous songTime.

**test/**
- `engine.test.js`: add `beltPhase` tests — `c=0` at `songTime=strikeTime` and at
  `+k*period`; `c ∈ [-P/2, P/2)`; continuity (no jump within a period); symmetry.
- `layout.test.js` unaffected (geometry unchanged).

## Acceptance criteria

1. `npm test` green (incl. new beltPhase tests).
2. Debug graph: the active-ball green line **flows continuously across the loop
   seam** (no vertical teleport); band stays ~`STAGE_Y..STAGE_Y+~1`.
3. Visually: pads stream up and recirculate with **no global snap**; at the seam you
   can see the old ball falling away/fading below while the new one drops in above.
4. Camera stays pinned; rulers dead still.
5. No double-strikes / missed strikes (audio matches today's, one hit per pad/loop).

## Known deferred (NOT this bite)
- **Tall-arc clipping** (camera doesn't crane) — dolly-back-on-tall-arc later.
- **Literal belt geometry** (pulleys, belt surface connecting the pad columns) —
  visual polish after motion is right.
- **Stationary instruments + percussion** (multi-ball spawner at fixed drums) — the
  next bite; this one just proves the spawner+belt on the existing melodic tracks.
- **Short-loop wrap visibility**: if a very short song makes `DESCENT*P/2` small
  enough to be on-screen, the belt wrap could peek. Check Prelude/Gymnopédie; if so,
  scale the visible band or hold pads longer. Likely fine; verify.

## Risks / gotchas
- Rig pool exhaustion if FADE_TAIL ≥ P (3+ alive) — keep pool 3, assert on checkout.
- Dying ball must never strike (guard idx range) and must not pull the camera (active
  only).
- `skipStrikes` (scrub) still honored in the per-ball strike path.
- Delayed tracks: `s_i` uses `tr.rollT` (includes delay) so belt phase is naturally
  offset; the ball pre-rolls during the delay. Verify alto/bass on Canon/Dies Irae.
- Per-song `P` changes on `buildWorld`; recompute each frame, reset `loopIndex`/balls
  on song change.
