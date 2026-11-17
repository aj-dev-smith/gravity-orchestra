# Contributing to Orchestrion

Thanks for wanting to build a machine.

The honest part first: Orchestrion is maintained by **one person**, in spare time. Review
is best-effort and can take a while. To keep that sustainable, contributions come in through the
lanes below. A PR outside them may be closed without a long discussion. That's not a verdict on
you or your idea, it's how one maintainer stays afloat.

If you use a coding agent, point it at [`AGENTS.md`](AGENTS.md). It's the short version of this
file, written for agents.

## The lanes, most welcome first

### 1. A new machine (the fast lane)

One folder and one test file. Nothing else touched.

```
src/instruments/<key>/solve.js   pure timing/physics: where is everything at songTime t?
src/instruments/<key>/voice.js   pure DSP: note id -> samples
src/instruments/<key>/index.js   the 3D build + the per-frame update
test/inst-<key>.test.js          your honesty tests
```

Start from the scaffold. It gives you a small machine that already works:

```bash
npm install
npm run new:machine <key>
npm run dev            # then open the printed URL with ?solo=<key>
```

Read [`src/instruments/README.md`](src/instruments/README.md) (the contract), then make the
machine yours. `test/inst-contract.test.js` checks every plugin against the contract
automatically; your own test file proves your mechanism is honest (lands on the beat, at rest at
contact, nothing passes through anything).

A machine PR needs:

- **Made with the scaffold**, and touching only `src/instruments/<key>/` and
  `test/inst-<key>.test.js`.
- **`npm test` and `npm run build` pass.**
- **A short clip or screenshot of `?solo=<key>`.** A GIF or mp4 dropped into the PR is perfect.
- **The mechanism in 2 or 3 sentences**: what physically causes each note, and where the energy
  comes from. For example: "A solenoid stamp drops onto each string on the beat and rebounds at
  e times its speed; the coil makes up the lost energy every hit. Gaps longer than half a second
  park the stamp on a latch." Honest motion is the bar. If a part moves, something visible moved it.
- **One machine per PR.**
- **A sensible size.** The shipped machines run roughly 750 to 1,700 lines across their folder,
  with up to ~150 meshes. If yours is well past that, say why in the PR.

Where an accepted machine stands on stage, and which MIDI tracks route to it, is curated by the
maintainer after merge. A new machine gets a default seat, so please don't edit `stations.js` or
`src/midi/` to place or route it yourself.

### 2. A song

Pure data in `src/songs/`, **public domain or your own original work only** (see below). Add it to
`SONGS` and a shelf in `src/songs/index.js`, and its key to `EXPECTED_KEYS` in
`test/songs.test.js`. The song format and the lock rule are in [`CLAUDE.md`](CLAUDE.md) §6.

Don't regenerate the staging fixture. The staging test will report your song as missing from it;
that one failure is expected, so mention it in the PR and the maintainer regenerates the fixture
once on the merged tree.

### 3. A room

Pure set dressing, and new files only, like a machine:

```
src/rooms/<key>.js           the room (registered automatically: ?room=<key>, and R cycles to it)
src/rooms/<key>-*.js         optional helpers of your own (the hyphen marks a helper)
test/room-<key>.test.js      your room's own tests
```

Start from the scaffold. It gives you a small room that already obeys the contract:

```bash
npm run new:room <key>
npm run dev            # then open ?room=<key>&song=daybreak-engine
```

Read [`src/rooms/README.md`](src/rooms/README.md) (the contract), then make the room yours.
`test/room-contract.test.js` checks every room automatically: the floor stays put, no lights of its
own, props clear of the machines and their supports, a pure per-frame update with no allocation, the
prewarm rules, and a clean dispose.

A room PR needs:

- **Made with the scaffold**, and touching only `src/rooms/<key>*.js` and `test/room-<key>.test.js`.
  No edit to `src/rooms/index.js`, and **don't regenerate the staging fixture**: it pins the shipped
  rooms only, so a new room fails nothing.
- **`npm test` and `npm run build` pass.**
- **Screenshots of `?room=<key>`** with a dense song (`?song=finale`) and a sparse one.
- **One room per PR**, at a sensible size (the scaffold is about 230 lines; the shipped rooms run
  roughly 1,000 to 1,800 lines across their files).

Whether a song opens in your room (`room:` in its data) is curated by the maintainer after merge, so
please don't edit songs to point at it. Rooms are big, so a quick issue with a sketch first is a good
idea.

### 4. Bug fixes, with a repro

Open an issue (or link one) with a URL that shows the bug: `?song=`, `?room=`, `?solo=`, a share
link, or the `.mid` file. Keep the fix as small as it can be. If the fix lands in the core (list
below), get an OK on the issue first.

## Not accepted without a prior issue and a maintainer OK

These PRs get closed unless an issue agreed on them first:

- **Changes to the core**: `src/engine.js`, `src/audio.js`, `src/juggle*.js`, `src/transport.js`,
  `src/main.js`, `src/instruments/stations.js` (and the other shared files at the top of
  `src/instruments/`), `src/midi/**`, `src/rooms/index.js` and the footing (`src/rooms/footing*.js`),
  and anything in `test/fixtures/`.
- Refactors, reformatting, or style-only changes.
- Dependency bumps or new dependencies.
- TypeScript conversions.
- README, typo or comment-only PRs. (Spotted a real mistake in the docs? Open an issue.)
- New build tooling, linters, formatters or CI.

For a core change, use the "Core change proposal" issue template. Say what's broken or missing,
and why it can't be done inside a plugin.

## AI-assisted work

Welcome, and plenty of this repo was written with Claude. Two conditions:

- **Disclose it** in the PR (the template asks).
- **A human ran it, watched it and listened to it** before opening the PR. You are vouching for
  the motion and the sound, not just the tests.

Unreviewed agent output will be closed. So will a stream of small automated PRs.

## The rules that keep it working

These come from [`CLAUDE.md`](CLAUDE.md), the architecture notes (long; §2 and §4b are the parts
that matter for a machine).

- **Time is the only state.** Every position is a pure function of `songTime`. No integrators,
  no accumulated state, no schedulers. Visuals trigger audio, never the reverse.
- **Solve up front.** A hit is a target plus a launch solve (`solveLaunch`, `arcPos` in
  `src/engine.js`). The physics is never bent to make a visual work.
- **Honest motion.** Contact happens at rest, exactly on the beat, with no penetration, and every
  change of motion has a visible cause. Your tests should prove all three.
- **A note's look depends only on the note**, never on its neighbours or the layout.

## Music and copyright

Only add songs that are **public domain** (composition *and* your arrangement of it) or **your
own original work**. No transcriptions of copyrighted songs, game music or film scores, even
"just the melody". MIDI files you import locally are your business. Files committed to this repo
are everyone's.

## Conduct and security

Be kind: [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md). Found a security problem? Don't open an
issue, see [`SECURITY.md`](SECURITY.md).

## License

By contributing you agree your contribution is licensed under the project's [MIT License](LICENSE).
