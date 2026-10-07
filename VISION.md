# CASCADE — the north star

> Status: **vision, not a spec.** This is where we're headed, built incrementally.
> Nothing here is a commitment to build it all at once. The day-to-day truth —
> architecture, invariants, what must never break — lives in `CLAUDE.md`.

## The shift

Cascade started as a shiny marble on a glowing track, grew into a multi-track
ballistic music engine, and went mildly viral as a *thing to look at*. The next
turn is the important one: it becomes a **thing to play with** — a 3D music
creation and visualization tool that anyone can pick up.

What told us it was real: **MIDI import** is the most fun the project has been —
hearing a song you know rendered as falling, bouncing, perfectly-synced physics.
But it gets old, because there's **no user control**. You watch; you don't make.
The product closes that gap.

## The core experience

- **Pick an instrument. Place it in the world wherever you like.** Composition is
  spatial, not just musical.
- **Move the camera as the song plays.** A **director mode** lets people frame and
  record slick videos of their own creations. (We already have a director cam that
  can *see the future* — because the whole timeline is solved before the first
  frame — and that property generalizes to any layout we throw at it.)

## Two ways to create — both work for MIDI and hand-made songs

1. **Import a MIDI.** Drag in a file, **map each track to whatever instrument you
   want**, and place each one in the scene. (Builds on the shipped MIDI parser; adds
   instrument mapping + world placement.)
2. **Build your own.** Pick an instrument and author it directly — a **piano roll**
   for melodic voices, a **drum-loop grid** for rhythm. Output is the same song
   format the rest of the app speaks, so a creation is instantly a shareable link.

## Extensibility — the bet

Adding a new instrument should mean two things and no more: **design a 3D
representation, and solve its physics.** Two archetypes already cover an enormous
amount of musical ground:

- **Conveyor — single marble, moving instrument.** A belt *manufactures* the
  perfect pad for each note: sized to its register, tilted to its bounce, with all
  the juice. Expressive and effectively unlimited in range — a fixed xylophone
  can't span four octaves gracefully, but a belt that produces the right pad on
  demand can. This is the melodic voice.
- **Stationary — many marbles, fixed instrument.** Pipe Dream: balls spawned to
  strike a fixed instrument, each one born, flying a solved arc, striking on the
  beat, and dying. Punchy and dense — the rhythmic voice.

The unifying runtime primitive is a **ball spawner**: mortal balls, born → fly a
solved arc → strike → die. The conveyor spawns one per loop; a drum spawns many.
Same machine.

**The invariant that makes all of this possible — protect it like gravity:**

> **Everything is always solved up front.** Closed-form ballistic solution, no
> integrator, no drift, structurally perfect audio/visual sync — forever.

This is the moat. A generic visualizer reacts to audio frame by frame; Cascade
solves the entire timeline analytically before it draws anything. That's why sync
is perfect, why the camera can anticipate, and why a new instrument is *tractable*
— you don't simulate it, you give it a shape and a backward solve and it drops
into the same honest engine. We design the **sound of each hit** ourselves, too,
per instrument — the audio is part of the instrument, not an afterthought.

## How the existing work fits

None of what's built gets thrown away — the vision is mostly *reframing* it:

- **MIDI import** → creation mode 1.
- **Melody editor** (long on the roadmap) → creation mode 2.
- **Share links** (deflate → base64url) → the export format for both modes.
- **The conveyor + spawner + percussion** work → the instrument-type framework and
  its first two instruments.

The first domino is the **spawner** (mortal balls, born and dying each loop): it
removes the loop seam *and* is the shared primitive every instrument reuses.

## Where we are (2026-10-07)

What moved from vision to shipped (the last three ticks on the `overnight` branch, not yet on
`main` — see `docs/OVERNIGHT-2026-10-07.md`):

- [x] **The instrument-type framework.** The two archetypes became a plugin seam
  (`src/instruments/`), and the bet paid: 15 machines, each "a 3D shape + a backward solve".
  The newest seven came in two families: **guitar** (Riff Forge, Pogo Bass, Marble Autoharp:
  a fretboard with a striker on every string) and **sustain** (Light Organ, Bellows Horns,
  Bow Wheel, Marble Grand: a note lasts exactly as long as a visible motion takes). The drum
  machine gained **real cymbals** that swing and get choked by a magnet clamp.
- [x] **Import a MIDI → every family machine plays it.** Routing goes by GM program, track name
  and the shape of each voice, so guitars go to the forge, basses to the pogo, strings to the
  wheel, organ and choir to the pipes, brass to the horns, and piano to the grand. Master of
  Puppets now plays its riff on the Riff Forge and its bass on the Pogo Bass, and the director
  gives the song's **signature** machine the most screen time. *(Mode 1's mapping half is
  shipped: the MAP panel re-routes any track.)*
- [x] **Place it in the world.** EDIT STAGE moves stations; the stage grew a raised **gallery**
  tier so 14 machines fit. *(Open: an import's star doesn't yet get moved to the front.)*
- [x] **Direct the camera.** The room director solves the whole edit at load; the **ride cam**
  lets you sit on the marble and fly its arc, scrubbable like everything else.
- [x] **Staging is half the product.** There are now 7 rooms. Two came tonight: a **Metal Arena**
  whose pyro is a cue sheet solved from the drum lanes, and a **Starship** whose sky banks with
  the phrase.
- [x] **Dynamics.** The belt has velocity, and quiet is genuinely quiet.
- [x] **Step inside it.** WebXR on the Quest: stand in the room at true gravity, teleport along
  the director's shots, use the in-world menu. *(Not yet worn on a real headset.)*
- [ ] **Build your own** (mode 2: piano roll + drum grid). This is the next big creation lever.
- [ ] **AR performer-in-the-loop**: you play a real instrument while the machines hold time.
  The seam is ready (rooms off, true scale); the design is single-station AR on your floor.

— Keep the physics honest. Make it something anyone can play.
