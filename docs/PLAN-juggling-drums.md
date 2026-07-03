# PLAN — Juggling drums

*(Design session 2026-07-02. Decisions marked ✅ are locked with AJ; knobs marked 🎛
are feel-tunables we expect to adjust live in Chrome.)*

## Why the melody machine feels real (and the drum PoC doesn't)

Four rules the conveyor obeys that the mortal-ball drums break:

1. **Conservation of matter** — you can follow one marble forever; nothing pops
   in/out of existence on camera. Drum balls materialize at a nozzle and evaporate
   mid-bounce.
2. **Visible causation** — every launch has an on-screen cause (pad wind-up →
   stroke). Drum balls depart a static cone for no visible reason.
3. **Anticipation** — the machine visibly prepares (wind-up, rim glow). The kit's
   first sign of a hit is the hit.
4. **Rhythm made visible** — belt arcs scale with dt² (long note = tall arc). Every
   drum arc is identical (`FLIGHT`), so flight carries zero musical information.

## The idea ✅

**Drum hits chain, exactly like melody pads chain.** A small set of IMMORTAL balls
juggles across the kit: the bounce-out of one hit IS the solved flight to that
ball's next hit — same `solveLaunch`, same closed form, same dt² grammar. The
melody archetype applied to stationary targets.

This is also structurally anti-busy (AJ's Wintergatan experiment showed many-balls
reads as noise): density becomes *one ball moving faster*, not more balls. Ball
count is set by simultaneity, not by hits-per-bar. A standard groove ≈ 2–3 balls.

Between consecutive strikes a ball does exactly one of three things, chosen purely
by gap length:

- **Dribble** (same drum, short gap) — a hat run is one ball bouncing in place;
  subdivision reads as dribble height.
- **Chain** (different drum, gap ≤ `dtMax`) — the exit arc off drum A lands on
  drum B at exactly the next hit time.
- **Transit** (gap > aerial range) — the exit arc lands in the **basin** and the
  ball travels *through the machine* back to a nozzle (below). Dwelling inside
  machinery is the honest equivalent of off-screen.

## The pieces

### Allocator (pure, `engine.js`) ✅
`allocateJuggle(hits, P, opts)` — no THREE, unit-tested (finally gives drum timing
the pure test it never had). Sort the loop's hits; walk in time order; each hit is
taken by the **most-recently-struck** ball that can make the flight (MRU keeps arcs
low and keeps a run dribbling on ONE ball); no aerial candidate → oldest transit
candidate; none → new ball. Close every ball's cycle across the seam (last strike →
first strike + P, classified the same way). Output: per-ball cyclic schedules
`{strikes, legs[{mode:'air'|'plumb', dt}]}` — everything downstream is solved from
this at build time. Time stays the only state.

- 🎛 `dtMax` ~1.7 s — longest aerial gap (apex ≈ |G|·dt²/8 ≈ 5 u; ceiling is 36, fine).
- 🎛 `minTransit` ~2.2 s — below this a plumb trip looks rushed; gaps in the dead
  zone between the two get a new ball instead.
- Beater lanes (kick) are excluded before allocation.

### Aiming heads ✅ — the pads' magic, ported
A solved exit is generally not the natural reflection of the entry, so **the head
micro-aims before each strike**: the piece gimbals (about the contact point) toward
the bisector `normalize(vOut − vIn)`, eased between strikes, **settled before
impact** (same contract as `padOffset(0)===0`). The existing head-punch flex stops
being decoration and becomes causation — a powered trampoline kicking the ball out.
🎛 max deviation from the layout tilt (~0.4 rad) — clamp and let the flash sell the rest.

### Kick beater ✅
The kick face is perpendicular to everything else — juggling onto it is the one
awkward case, and the pedal beater is the most iconic drum mechanism there is, so
the kick is struck by a **mallet on a pivot arm**, not by balls. Swing = wind-up →
stroke → follow-through, reusing the `padOffset` envelope; contact exactly at the
strike. Kick hits keep their audio/flex edge; they just never enter the allocator.

### Plumbing v1 ✅ — basin → lift → manifold → nozzle, as OPEN RAILS
One catch **basin** behind the kit (single basin over a perimeter trough: less
clutter, one lift; trough can come later). A transit leg is a piecewise path, all
parameterized by songTime:

1. **Catch arc** (`CATCH_T`): solved launch from the drum to the basin mouth.
2. **Rail ride**: basin → vertical lift → overhead manifold spine → branch down to
   the target drum's nozzle. Rendered as **open rails/channels, not closed pipes**,
   so the ball stays visible the whole way — conservation you can literally watch.
   One precomputed curve per drum (CatmullRom, arc-length param), constant ride
   speed 🎛.
3. **Dwell**: leftover time is spent sitting visibly in the nozzle mouth, glowing —
   the anticipation beat the kit lacked, exactly where the eye needs it. (Short
   gaps compress the ride instead; dwell can be zero.)
4. **Fire arc** (`FIRE_T` ≈ the old `FLIGHT`): nozzle → head, the existing spout solve.

This retroactively makes the nozzles honest: mouths of a circulation system, not
ball printers. Nozzles are only built for drums that actually receive transits.

### Ball identity
Each ball gets its own hue from a small palette (strike flash still uses the drum's
color). Trackable identity is the point of juggling — "follow the orange ball."

## Deferred (noted, liked, not v1)

- **Rest domes** — silent chrome bounce surfaces the allocator could bank a
  medium-long arc off to keep it airborne instead of ducking into the gutter. Pure
  spectacle; add when the kit earns it.
- Perimeter gutter trough; multiple basins.
- Closed glass/chrome tubes with glow-bulge transit (open rails first).

## What one bar of backbeat looks like

Hat eighths = ball A dribbling in place all loop. Snare 2 & 4 = ball B dribbling a
tall two-beat arc. Kick 1 & 3 = the beater. A crash once per loop = ball C: fire →
smash → catch arc into the basin → the whole rest of the loop riding the rails home.
Its journey IS "once per bar," written in chrome.

## Invariants that must survive

- Physics never altered for visuals; every leg is `solveLaunch`/`arcPos` or an
  arc-length curve — **no integrator, no scheduler, no per-ball state**.
- Render is a pure function of songTime (scrub-safe, seam-safe, count-in-safe;
  negative pickup beats normalize mod P).
- Strike-edge detection + audio stay on the existing per-hit scan, untouched.
- Velocity stays *dynamics* (gain + flash), never geometry.

## Build order

1. Allocator + tests (`test/juggle.test.js`).
2. `drums.js`: chained arcs from schedules (transit legs as a plain held ball at the
   nozzle first, if needed to land the core).
3. Aiming heads + kick beater.
4. Plumbing rails + dwell glow.
5. Live tuning session (dtMax, aim clamp, ride speed, ball palette) — in Chrome,
   together; this is the part that can't be done blind (launcher-plan lesson).
