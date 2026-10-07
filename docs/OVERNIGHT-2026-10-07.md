# Overnight 2026-10-07: changelog

Everything below is on the **`overnight`** integration branch, merged from the `ov/*` feature
branches. It is **not merged to `main`, not deployed, and not pushed**. Every feature was built by
one agent and reviewed by a second; the reviewers' fixes are in. The full suite is green
(44 files, 2489 tests, after the staging fixture was regenerated on the merged tree in `4902a60`).
`npm run build` passes.

The rules held: everything is solved up front, time is the only state, motion is honest, the iOS
audio internals are untouched, and the physics was never changed for visuals. All music in the repo
is public domain or original. The ~/Downloads MIDIs stayed local.

---

## What to look at first (15 minutes)

`npm run dev`, then:

1. **`/?song=finale`**, *Starship Groove*. This is the night in one loop: an original space-funk
   piece for **10 plugin machines plus the full kit** on the Starship. Leave the camera on AUTO.
2. **`/?song=forge`**, *Forge of the Marble King*. The Riff Forge stars in the Metal Arena with pyro
   cued from the drums. Watch the **anvil** at the end of the loop: a B-major hit that rings through
   the breath, holds the riff shot, and resolves onto the E downbeat.
3. **Drop `Metallica - Master Of Puppets.mid`** from ~/Downloads onto the page. Its guitars play on
   the Riff Forge, its bass on the Pogo Bass, and the director gives the riff the most screen time.
   Open **MAP** to see the routing.
4. **`/?solo=<key>`** for each new machine (table below). Each one plays its own demo with the
   camera on its station.
5. On the Quest, follow **docs/XR.md §0**, the morning checklist.

Add `&debug` to any URL for the scrub bar and `window.__dev`. `__dev.strikes()` lists strikes per
machine and any fired voice with no baked sample. `__dev.director()` shows cuts, shares, rides and
the signature machine.

---

## URL parameters (checked in `src/main.js`, `src/rooms/index.js`, `src/xr.js`)

| param | effect |
|---|---|
| `?song=<key>` | open on that song. Without it the page opens on Daybreak Engine, or on Danse Macabre through October. `?debug` pins Daybreak |
| `?room=<key>` | force a room: `grid`, `cathedral`, `studio`, `void`, `graveyard`, `arena`, `starship`, `off`. **R** cycles rooms. A song opens in its own `room` unless `?room` is set or you picked one this session |
| `?solo=<key>` | an instrument's own demo, with the camera on its station |
| `?midi=<url>` | fetch and import a MIDI on boot, e.g. `?midi=/midi/room-tour.mid`. A dropped file goes through the same path |
| `?debug` | scrub bar + `window.__dev` |
| `#s=…` | a share link (the song itself, deflated) |
| `?xr` · `?xremu` · `?ar` · `?xrdetail=full` · `?xrscale=0.8` · `?xrhz=90` | WebXR knobs: see docs/XR.md |

Example: `/?song=finale&room=arena` plays Starship Groove in the Metal Arena.

---

## New instruments (7)

Each one is a single folder in `src/instruments/<key>/` (solve.js pure, voice.js pure DSP,
index.js render) with its own honesty suite in `test/inst-<key>.test.js`. Each suite checks that
hits land on the beat, the struck part is at rest at contact, nothing passes through anything,
motion is continuous through the count-in and the seam, and 500 random events plus garbage input
stay honest. Every machine exports `PART_LIMITS` and is a MIDI routing target.

### The guitar family: a fretboard with a striker per string

| machine | try it | what it is |
|---|---|---|
| **Riff Forge** (`riff`) | `/?solo=riff` | A six-string neck tilted to the audience. A brass **fret carriage** under each string slides to the real fret position and presses. A chrome **stamp** in a glowing solenoid tube lands on the string exactly on the beat and rebounds with loss. Between hits it hops (a 0.136 s chug is a visible hop, not a buzz), and longer gaps park it on a latch. A felt palm-mute bar drops before muted hits, the struck span glows white-hot, and the 4×12 cab pumps. A whole chord is one voice: Karplus-Strong, a 3-stage tanh amp and the cab. Note flags: `:m` mute, `:c` clean. Demo: an original E-minor thrash riff. |
| **Pogo Bass** (`pogo`) | `/?solo=pogo` | A long-scale four-string bass (E1–G2) with fret carriages, and a chrome **pogo stick** per string bouncing on real gravity. The hop height is the gap squared, so a held note is a tall hop. A gap over 1 s parks the pogo on a boom magnet. The pump cylinder supplies each bounce's lost energy. The voice is Karplus-Strong with a split pickup and an ~800 Hz growl path, so the line reads on a phone. Flags: `:s` slap, `:p` pick, `:y` synth. |
| **Marble Autoharp** (`strum`) | `/?solo=strum` | A rosewood harp with one string per pitch. **One** gold marble plectrum on a cable-driven carriage sweeps the whole fan, like a real autoharp. Each string releases at the marble's flight time to it, so the strum spread is visible. Crimson felts on solenoids show the chord shape a beat early and act as the note-off. Down on the beat, up on the "and". Variants: steel, `\|n` nylon, `\|h` harp. |

### The sustain family: a note lasts exactly as long as a visible motion takes

| machine | try it | what it is |
|---|---|---|
| **Light Organ** (`organ`) | `/?solo=organ&room=cathedral` | An organ loft hung behind the belt, in front of the cathedral's rose window. Each pipe has its own bellows and one conserved marble. The marble lands on the lid and its weight sinks it for exactly the note, so **duration is the distance the lid travels**. A light packet 7× the duration long runs up the pipe. Between notes the marble rides the refilling lid, hops a solved arc, or parks on its magnet. Timbres: organ, `\|choir`, `\|pad`. |
| **Bellows Horns** (`horns`) | `/?solo=horns` | A brass section played by gravity. A magnet drops each horn's marble onto its bellows; the lid sinks for the note (a stab slams it, a held note sinks it slowly), and a ram throws the marble back at note-off. Tuba, trombone or trumpet is chosen by register, with real slide positions and valve fingerings. Ids `C4` (held) and `stab:C4`. |
| **Bow Wheel** (`bowwheel`) | `/?solo=bowwheel` | A hurdy-gurdy for marbles. A rosined wheel turns at constant speed. A marble drops into each string's tangent cup, and its weight presses the string onto the rim exactly on the beat; held means bowed. Strings glow crimson, rosin dust flies, and the vibrato shimmer matches the voice. At note-off the marble hops back for a re-bow or parks on its magnet. |
| **Marble Grand** (`dulcimer`) | `/?solo=dulcimer` | An open grand whose action is made of marbles. A piston kicks each pearl hammer-ball **up** into its string at the 1/7 point, it rebounds into a cup waiting at rest, and fast repeats use a double-escapement lever. Dampers lift 85 ms before the strike. The voice is a modal stiff-string piano with a soft layer; `:e` gives an FM Rhodes. |

### Real cymbals (drum kit)

Crash, ride (with a **ride bell**: a second ball on the same cymbal), china and splash are now
pieces of their own, voiced by `src/cymbals.js` (clawd-o-matic's `metal()`; one render feeds both
the live and the iOS path). Each hangs on a boom and swings as a damped pendulum after a hit. A
**magnet clamp** under the bell levels it before every strike, parks it, and **chokes** it when a
hit says `[beat, vel, chokeBeats]`. A closed hat chokes a ringing open hat. Try **`/?song=backbeat`**
(ride bell, a choked china stab on 4, a splash).

---

## New rooms (2)

| room | try it | what it is |
|---|---|---|
| **Metal Arena** (`arena`) | `/?song=forge` (its home), or `/?song=mountain-king&room=arena` | A black stage, box truss, 37 par cans with beams through the haze, a 144-lamp blinder wall, amp stacks and phone-lit seating. **Pyro, CO2 and blinders are a cue sheet solved from the song's drum lanes at load**: crash = flame jets, loop downbeat or drums returning = CO2, kick on a bar = a jet pair. Every flame and ember is a closed-form function of "seconds since fired", so scrubbing is exact. It adds no lights and costs about 26 draw calls. |
| **Starship** (`starship`) | `/?song=finale` (its home) | A plated deck under a ribbed glass canopy, engine nacelles that pulse with the beat, star streaks and nebulae. **Only the sky banks**: about 5.7° per 4-bar phrase, alternating, level through the breath. The deck and the instruments never move. Streaks repeat exactly every wrap period, so there is no drift or snap. |

---

## New songs (8, on the "Tonight's machines" shelf)

Each song sets its bpm so the 3.8 s breath is a whole number of beats, and lets its last chord
ring through the breath into the downbeat.

| key | title | room | machines | note |
|---|---|---|---|---|
| `finale` | **Starship Groove** (original space-funk) | starship | riff (clean chicken-scratch, then distorted), bass, Grand (Rhodes solo), horns, organ + choir, bow wheel, autoharp, marimba, bells, turntable, full kit | One featured shot per machine, then the tutti. Every part fits its machine whole. |
| `forge` | **Forge of the Marble King** (original thrash) | arena | riff (star), bass, horns, organ + choir, kit | The anvil B-major rings through the breath. |
| `mars` | **Mars** (Holst, 5/4) | void | bow wheel col legno, organ, riff, horns, autoharp (harps), toms tuned to the coda | `barBeats: 5`. pp is truly pp now (belt and kick velocity). Faithful in shape; there was no score to hand. |
| `toccata-loft` | **Toccata in the Loft** (Bach BWV 565) | cathedral | organ (star), bow wheel pedal, Grand | The dim-7 builds one pipe at a time: 8 light columns at once. |
| `entertainer` | **The Entertainer** (Joplin) | studio | Grand (stride), horns (stabs), autoharp (banjo chucks), string bass, brushes | Joplin's own p/f markings scale the velocities. Weights only, no scripted cuts. |
| `winter` | **Winter** (Vivaldi RV 297 i) | void | bow wheel (the shiver, 12 strings), Grand as harpsichord, bass | From memory, faithful in gesture. The freeze holds the wheel through the breath. |
| `scarborough` | **Scarborough Fair** (trad., D Dorian, 3/4) | cathedral | autoharp, bow wheel drone and counter-line, organ choir, music box, bells | |
| `campfire` | **Campfire** (original folk-pop) | cathedral | autoharp (fingerpicked intro, then strums), cello wheel, Grand fills, bowls, bells, light kit | |

`/?song=<key>` opens each one in its own room.

---

## Engine and seam work

- **Belt dynamics** (`src/dynamics.js`). Melody, alto and bass notes take an optional velocity:
  `['G4', 1, .6]`. It drives the live pluck gain and the strike juice (pad flash, sparks, shake,
  exposure), never the solve. `velGain` is now the single velocity law for the belt and the drums:
  unchanged from 0.5 up, and genuinely quiet below (0.1 ≈ −19 dB). Songs mixed under the old floor
  wrap those lanes in `legacyLane`. MIDI import writes belt velocity from note velocity.
- **A script can own the seam.** A `director.at` hold that runs past the last note now keeps its
  shot through the breath instead of the forced wide shot (Forge's anvil, Winter's freeze).
- **iOS sustain: duration buckets.** Sustained plugins (organ, bowwheel, horns, dulcimer, bowls)
  fire `'<base>~<hold>'` voices cut at 0.5 / 1 / 2 s with the release baked in, so on the iOS
  sample path a held note no longer rings its whole 4–5 s render. Desktop is unchanged. The
  **song-change `ERR_FILE_NOT_FOUND` console noise** was found and fixed in `rebuildBank`'s teardown
  only: late priming promises were swapping revoked blob URLs back in.
- **Plugin seams** (`src/instruments/README.md`): `voiceIds(part, {beat, bpm, rollT, P, loopBeats})`,
  optional `voiceHz(id)` (chord and suffixed ids now pan at their real pitch), `light < .2` skips the
  shared strike-light pool, `PART_LIMITS` on the descriptor, gallery raise / `floorY`, and `xrGlow` /
  `inst.xr(on)`.
- **clock.js fix**: on loop 1, a lane's first strike could go silent if it fell just before one of the
  static-merge pose times (finale's bells, Daybreak's beat-0 bell). Edges now re-arm when time goes
  backwards.
- **Gallery staging tier.** The floor was full, so a raised rear gallery behind the belt now holds
  riff, strum, horns and pogo either side of the hung organ loft. The Grand and the Bow Wheel take the
  front corners, and the wide shot no longer cuts corner machines in half.
- **Ride cam** (`src/ridecam.js`, the **RIDE** button). You sit just behind the lead marble and look
  where it's going. It's comfort-limited: the horizon never rolls and view rotation is capped. The
  director rides the loop's biggest flight sparingly (share ≤ 0.14; on short loops only every n-th
  pass). Try `/?song=toccata` with AUTO (it rides the 6.5-beat pedal lob), or press RIDE on any multi-track song.

---

## The MIDI routing story

Imports used to send everything that wasn't a belt to the marimba, bowls or string bass. Now
`src/midi/orchestra.js` routes by **GM program + the voice's shape + its track name** to the family
machines:

- **Guitars**: distortion, overdrive and muted (28–30) go to the **Riff Forge**. A clean electric (27)
  goes there only when it plays power chords; otherwise its chords go to the **Autoharp**. Nylon,
  steel and jazz chords (24–26) and the harp (46) go to the Autoharp. Palm mutes (`:m`) are written
  for notes under 0.15 s; the clean amp (`:c`) only when every guitar on that beat is clean.
- **Basses**: electric and synth basses (33–39) go to the **Pogo Bass** with slap, pick or synth
  articulation. The acoustic upright (32) stays on the String Bass. A track *named* "Bass" on a
  placeholder program goes to the pogo if the pogo can keep up.
- **Strings** (40–44, 48–51, sustained) go to the **Bow Wheel**. **Organs, choir and pads** go to the
  **Light Organ** with `|choir` / `|pad`; a small bed with few pitches stays on the bowls. **Brass and
  reed sections** (56–71, chordal) go to the **Horns**. **Piano** comping goes to the **Marble Grand**
  (`:e` for Rhodes, DX and clav). The belt keeps the piano when it's the tune.
- A spare line goes to its family machine (`LINE_HOME`), and a full machine spills along
  `OVERFLOW_TO` (riff → marimba, pogo → string bass, bowwheel → organ → bowls, …) instead of dropping.
- Cleanup: belt twins merge only when each covers 90% of the other; a copy lagging a few ms merges;
  a stray line with fewer than 4 notes gets no belt or machine of its own.
- **The signature shot.** On an import the director now picks the song's main machine (present all
  loop, varied, heavy; never the belt or the kit), pulls harder toward it, and gives it a 0.34 cap.

**Master of Puppets now** (re-run on the merged tree tonight, auto window = bars 89–120 of 410 at
220 bpm, 32 bars ≈ 31.6 s, "a repeated section"):
- Vocals (left) lead the belt; Vocals (right) ride the bass belt as a harmony.
- Guitar 1 (clean, 27, power chords) and Guitar 2 (distortion) merge onto the **Riff Forge**:
  191 events, power chords plus palm-muted chugs.
- Bass (left) and Bass (right) are named basses on guitar programs (26 / 28). They merge onto the
  **Pogo Bass** (132 events; 1 note thinned).
- Drums: 9 lanes, including crash.
- Director: signature = **riff**. Shares: riff 0.32, belt 0.18, ride 0.15, stage 0.13, drums 0.12,
  pogo 0.11.

Screenshot: `/Users/aj/.claude/jobs/86382a54/tmp/shots/docs-mop-import.png` (the MAP panel shows the
routing). To try routing without ~/Downloads: `/?midi=/midi/room-tour.mid` (its strings now go to
the Bow Wheel).

---

## XR (Quest 2)

`npm run dev:xr`, then open `https://<mac-ip>:5173/?xr` in the Quest Browser and tap **ENTER VR**.
**docs/XR.md §0** is the step-by-step morning checklist.

New tonight:
- the **VR detail profile**: batching, skipping sub-7-px parts, and a glow boost for the missing
  bloom. Daybreak Engine from the wide drops from about 1450 to about 555 draw calls (both eyes).
  `?xrdetail=full` turns it off for A/B.
- the **in-world menu** on **Y**: songs, rooms, play/pause, tour, next pad, exit.
- room comfort variants: no studio mirror, tamer arena blinders, half the starship bank.
- `scripts/xr-perf.mjs` and `__dev.xrPerf()`.

The head is never moved by the director or the ride cam. TOUR teleports between pads.

---

## Known issues (the important ones; the full list is CLAUDE.md §8)

- **Nothing was heard on a real iPhone or worn on a real Quest 2.** The iOS buckets were checked by
  tests and bank composition; XR only by emulator draw-call counts.
- **Staging fixture**: `test/fixtures/staging-rooms.json` was regenerated on the merged tree
  (`4902a60`, 7 rooms incl. campfire). Re-run it (CLAUDE.md §1) after ANY new song / station / room.
- **Volley has no song**: the Daybreak Engine plays every pre-tonight plugin except the volley; hear it
  with `/?solo=volley` (or an import that overflows to it).
- **The wide shot goes steep when the gallery is used.** Forge in the arena frames its star small at
  top-left and the kit under the button bar. An import's signature machine isn't moved to the front.
- **Timbre gaps**: saxes on the horns sound brassy; a guitar line that lands on a *belt* sounds like
  the music box; the e-piano is about 6–9 dB hotter than the piano.
- **No loop-sustain**: the bow wheel caps a stroke at 3.9 s, horns hold 2.6 s, and a riff chord rings
  1.6 s.
- **Load cost on dense imports**: many distinct riff chords or a multi-timbre organ part bake slowly
  (seconds, tens of MB); cymbals add about 330 ms at load.
- **Ride share** in whole-song imports runs 0.28–0.39 against its 0.14 cap (pre-existing).
- **About 1.5 s of near-silence at every loop seam** (by design: the roll-in plus the 1.2 s tail).
  It's audible on recorded rock loops.
- `~/Desktop/cascade-video/capture.mjs` still presses `g`, which now turns the debug HUD **on**.
  Delete that line before the next recording.

Screenshots from this docs pass: `/Users/aj/.claude/jobs/86382a54/tmp/shots/docs-solo-riff.png`,
`docs-finale.png`, `docs-forge.png`, `docs-mop-import.png`. Each feature's own screenshots are in the
same folder (`<feature>-*.png`).
