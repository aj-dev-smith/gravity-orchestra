# PLAN — Staging: instruments, rooms, supports & placement

> The instruments now need to **inhabit a place**, and eventually the user curates
> that place themselves — dragging instruments around a room, framing it with
> cameras, recording the result. This doc fixes the **abstractions and constraints**
> for that layer so it stays clean enough that swappable scenes and (someday) an AR
> mode are a *swap, not a rewrite*. Design session AJ + Claude, 2026-06-19.
> Vision lives in `VISION.md`; built-today truth lives in `CLAUDE.md`. This is the
> bridge: decided constraints for work not yet built.

## The aesthetic law (the thing every instrument obeys)

**An impossible machine that reads as real because the motion is honest.** The
conveyor belt cannot exist — it is infinite — yet it convinces, because the pads
articulate cleanly *in and out* at the contact moment. That is the whole trick, and
it is Animusic's soul: each instrument gets to be a gorgeous perpetual-motion
impossibility, *as long as the moment of contact is mechanically believable.* We
stay "mostly grounded in reality" (legs, mounts, stands, plausible mechanism) while
the mechanism itself is frankly impossible. Don't sand off the impossibility —
sell it with motion and structure.

Corollary already proven: the conveyor reads as a **feasible machine** (console
beam + legs + pads cascading up a slatted belt face). It is grounded; it has a
bottom. We do **not** need to wall-mount it. The grounding move that works is
*believable supports*, not *hiding the ends*.

## The abstraction stack

Four clean concepts. Keep the seams between them thin and DI'd, exactly like the
existing `conveyor.js` / `drums.js` / `camera.js` render subsystems.

### 1. Instrument
A self-contained unit. Already declares: **geometry + a physics solve (target +
`solveLaunch`) + a per-hit sound** (CLAUDE.md §4–5). Add two fields to complete it
for staging:
- **anchor** — how it attaches to the world: `floor` | `wall` | `ceiling` |
  `aimed-at-target`. (Conveyor & drums = `floor`. A hung chime might be `ceiling`.)
- **support generator** — `f(instrument, placement, room) → support geometry`. Grows
  the structure that grounds the instrument *wherever it currently sits*, given the
  room's surfaces. The conveyor's console-legs and the drum stands are this function,
  **hand-built today** — promoting them to a real generator is the keystone (below).

### 2. Room
Deliberately thin: a **coordinate frame + surfaces (floor / walls / ceiling at known
heights) + bounds + valid anchor points.** Nothing else. The greybox grid is **Room
Zero** (`ROOM` const in `main.js` is the seed — floor/ceil/walls already named there).
A cathedral or studio is another Room. **AR is a Room whose surfaces come from the
user's real space.** This thinness is the entire reason to be disciplined now: if the
Room interface stays this small, AR and scene-swapping are swaps, not rewrites.

### 3. Placement
A **per-instrument transform**, applied at **render time only** — physics is provably
untouched (gravity is vertical; sliding an instrument in x/z is a rigid translation of
a pre-solved arc). The engine already anticipated this: `tr.origin` is commented as
"the seed of user-placed instruments." Drag = set that transform + rerun the support
generator. **Invariant: never alter the solve to place something. Placement is
framing, not physics.** (Same law as all conveyor/camera/drum framing — CLAUDE.md §10.)

### 4. Cameras (placeable too)
Same abstraction as instruments. The user drops **static cameras** in the room for the
*shot*; the director cuts between them for a recorded playthrough. Free-fly stays for
*exploring*. So the room holds two kinds of placeable object — instruments and
cameras — under one placement model.

## Per-instrument placement constraints (data, not engine)

Different instruments, different rules — expressed as **data on the instrument**, like
every other feature here (CLAUDE.md §10: "features as data first, engine second").
- **Conveyor** — floor anchor; generates a console base + legs to the floor. Wants
  back clearance for the belt depth.
- **Drums** — floor anchor; *per-piece* supports (a kick squats low; a cymbal booms
  out; a tom sits on a rack). **Today they're one dumb pole each** → the visible
  spindly-poles problem is exactly the support-generator gap, not a styling nit.
- **Future** — a hung instrument anchors to the ceiling (cables down); a harp/strings
  instrument we *shoot* at anchors to the floor, angled toward its shooter.

## Scope — decided, and deliberately deferred

**Strategic lean (AJ, 2026-06-19): favor human curation over procedural scene
generation.** Perfecting an auto-layout that arranges instruments into a good-looking
fixed scene is likely *harder* and *less valuable* than simply letting a human drag
them where they want. Dragging is also the actual product promise ("place it wherever
you like"). So: **build the drag mechanism; ship a few hand-curated default scenes as
starting points — not auto-generated ones.** This sidesteps the hard auto-layout
problem entirely.

Held constraints that keep the doors open without being built now:
- **Few instruments per scene** — a *room* is the right container, not an infinite
  hall/bay. Don't over-build for scale we won't hit.
- **Multiple swappable scenes** — keep Room thin so this is cheap later. For now,
  **keep the placeholder greybox grid.**
- **AR** — out of scope for a long time, but the Room/Instrument/Support/Placement
  seams above are chosen so it stays possible. Don't take a shortcut that assumes a
  fixed virtual room.

## Near-term keystone

**Promote the hand-built supports into a per-instrument support generator**
`f(instrument, placement, room)`. The instant that exists:
- drag-placement works (regenerate supports on move),
- multi-room works (supports adapt to a new floor/ceiling height),
- AR stays reachable (supports adapt to detected surfaces),
- and the spindly drum poles get fixed *as a side effect of doing it right* — a kick
  squats, a cymbal booms — instead of a hardcoded band-aid.

One function is the foundation for placement, scenes, and AR all at once. Build that
before any drag UI.

## Session log — drum-kit PoC → MVP (2026-06-19)

Took the drum kit from "flat disks on spindly poles" to a real kit, the same PoC→MVP
arc the belt got. All in `drums.js` (+ a showcase song), pure render, physics untouched:
- **Greybox dev room** (`main.js`): grid-walled box (toggle `R`), hemisphere fill, the
  `ROOM` const is the single floor/ceiling source of truth the supports plant against.
- **Drum riser**: the kit stands on a deck with legs to the floor — the support-generator
  idea, hand-built. Kills the spindly poles; drums get short stands on the deck.
- **Real kit layout** (`KIT_LAYOUT` data): kick stands up (rx≈π/2, face → drummer), three
  rack toms raked toward the drummer over the kick, floor tom + cymbals on booms, hats/snare
  left. `tilt = [rake, yaw, roll]`; side pieces yaw to wrap the kit around the seat.
- **Real geometry**: lacquered shells + chrome rim hoops + lugs; tilted bronze cymbals;
  per-piece procedural stands (tripod / tom-stub / floor-tom legs / hi-hat / boom).
- **Spawners** feed each face **along its head normal** (`mouth = contact + normal·SPAWN_DIST`)
  so the ball lands square on a raked face. Sleek per-face nozzles for now.
- **One floor tom** (GM 41 merged onto floorHigh via `GM_MERGE` in drumkit.js). Showcase
  song **`backbeat`** added to drive the whole kit.
- **Free-look is now the default camera** (`camera.js` `DEFAULT_MODE`) for moving around scenes.

### Next session — step 2: the LAUNCHER TREE
AJ's mental model for the spawners: a **tree/trunk rising from the drummer's seat** that
**branches out to launchers**, each positioned + angled to fire cleanly at its drum's face.
Order he wants: (1) launcher *position* on the branches, (2) launcher *angle*, after the
drums themselves are perfectly placed (they now are). The nozzles already sit on each face's
normal — the tree is the structure that *connects* them back to a trunk (the deferred
"spawner support"). The vertical kick is the interesting one (its nozzle fires horizontally
at the standing face). This generalizes: every stationary instrument gets a launcher tree.

## AR — performer-in-the-loop (AJ's video idea, 2026-06-19)

A north-star demo to build toward (not now): **AJ himself IN the song** — playing real guitar
in his real room while it's decorated with virtual Cascade instruments looping around him;
together they make one piece. Architecturally clean because it inverts the moat: every Cascade
voice is *solved up front*, a drift-free function of `songTime`; a live human is the opposite —
unsolved, real-time. So the **human is the one un-solved instrument**, the virtual kit/conveyors
are the deterministic loops playing *around* him, holding time perfectly. Rides the Room/Placement
seam above (AR = a `Room` reading real surfaces). The one genuinely-new ingredient is a **shared
audible transport for the human** — a count-in/click + visual downbeat cues to lock to — and most
of that already exists, built for the marbles: the `LEAD_IN` count-in and the `prog²` anticipation
glow ARE a click track + a visible conductor. A human plays to the loops like a marble arrives on
the beat. Small addition, big payoff.
