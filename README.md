# Gravity Orchestra

**Marbles play music, and every arc is solved from the melody.**

**▶ Live: [cascade.ajsmithhq.com](https://cascade.ajsmithhq.com)** · drop any `.mid` file on the page and the solver orchestrates it.

![Gravity Orchestra](public/og.png)

An open-source love letter to [Animusic](https://en.wikipedia.org/wiki/Animusic): impossible
machines that play real music in 3D. Wayne Lytle's films taught a generation that you could
*watch* a song. Gravity Orchestra tries to make that interactive, live in the browser, for any song.

## The idea

**The melody is authored first; the physics is solved backward from it.**

Nothing is simulated. Each launch is the closed-form ballistic solution that lands the marble
on its target in exactly the note's duration:

```
v0 = (ΔP − ½·g·dt²) / dt
```

Position along an arc is the analytic `P(t) = P0 + v0·t + ½·g·t²`. There is no integrator,
so there is no drift, so audio/visual sync is structurally perfect forever. You can *see*
rhythm: long notes throw tall arcs, fast runs are flat skims.

**Time is the only state.** Every marble, piston, magnet and camera cut is a pure function of
`songTime`. That's why the director camera can cut to the action *before it happens*, why you
can scrub the timeline (`?debug`), and why a recording started at the loop seam loops seamlessly.

## What's in the box

- **15 instruments, each a different honest machine**: a robot marimbist, a pinned music-box
  cylinder, a hurdy-gurdy bow wheel, a piano action made of marbles, a light organ whose
  marbles sink the bellows, pogo-stick bass strings, a riff forge with solenoid stamps, and more.
  Plus a marble drum machine: one ball per drum, pistons and electromagnets, real cymbals.
- **25 songs** (public domain or original): Bach, Beethoven, Grieg, Holst, Joplin, Saint-Saëns,
  Vivaldi, and a few written for the machines.
- **MIDI import**: drop a file and it's routed by General MIDI program (or by musical role)
  onto the right machines, channel 10 becomes the drum kit, and long songs import as their
  best loopable phrase.
- **A room director** that solves the whole camera edit from the song data, plus a ride cam
  that sits on the marble.
- **7 rooms**: grid, cathedral, studio, void, graveyard, metal arena (with pyro solved from the
  drums) and a starship.
- **Share links** (the whole song travels in the URL, no backend), **one-perfect-loop video
  recording**, and **WebXR** (Quest: stand inside the machine at true 9.81 m/s² gravity).

## Run it

```bash
npm install
npm run dev           # vite dev server — open the printed URL
npm test              # vitest (~2–3 min)
npm run build         # production build → dist/
```

Handy URL flags: `?song=<key>` · `?room=<key>` · `?solo=<instrument>` (one machine's demo) ·
`?midi=/midi/room-tour.mid` · `?debug` (scrub bar + `window.__dev`).

## Build an instrument

This is the best part to contribute to. An instrument is **one folder** in
`src/instruments/<key>/`, auto-registered with no shared-file edits. The scaffold gives you a
small working machine to start from:

```bash
npm run new:machine chimes     # then: npm run dev, and open ?solo=chimes
```

```
solve.js   pure timing/physics: where's the ball at songTime t? (no THREE, no DOM)
voice.js   pure DSP: note → Float32Array samples
index.js   the 3D build + per-frame update
test/inst-<key>.test.js   honesty tests: lands on the beat, at rest at contact, no penetration
```

The design rule is **a hit = a target + a launch solve**. Every change of motion needs a visible
cause (a piston kicks, a magnet holds, a latch releases), and contact is honest. Read
[`src/instruments/README.md`](src/instruments/README.md) for the full contract, then try
`npm run dev` with `?solo=marimba` to see one machine on its own.

Songs (pure data in `src/songs/`) and rooms (pure set dressing in `src/rooms/`) are the other
two easy ways in. See [CONTRIBUTING.md](CONTRIBUTING.md) for the lanes, and point your coding
agent at [AGENTS.md](AGENTS.md).

## Docs

- [`CLAUDE.md`](CLAUDE.md) is the architecture notes and scar tissue: the static-band conveyor,
  the instrument seam, the song format and its lock rule, and the four-round iOS audio war.
  It's written as a handoff brief for AI coding agents, and it reads fine for humans too.
- [`VISION.md`](VISION.md) is where this is heading: a 3D music creation and visualization tool.
- [`docs/XR.md`](docs/XR.md) covers testing on a Quest.

## Credits

Inspired by Animusic (Wayne Lytle and Animusic, LLC). This project isn't affiliated with or
endorsed by them. Built on [three.js](https://threejs.org). It started as a single-file
[Claude](https://claude.ai) artifact and was raised into a repo with Claude Code.

[MIT](LICENSE) © 2026 AJ Smith
