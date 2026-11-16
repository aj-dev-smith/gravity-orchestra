# Contributing to Gravity Orchestra

Thanks for wanting to build a machine. There are three easy ways in, roughly from most to
least code:

1. **An instrument**: one folder in `src/instruments/<key>/`. `npm run new:machine <key>` stamps
   out a working one to start from; [`src/instruments/README.md`](src/instruments/README.md) is the
   contract.
2. **A song**: pure data in `src/songs/`. Public domain or your own original work only (see below).
3. **A room**: pure set dressing in `src/rooms/`. No lights of its own, no per-frame allocation.

Bugs, ideas and "I want to build X" issues are all welcome. Opening an issue before a big
change saves everyone time.

## The rules that keep it working

These come from [`CLAUDE.md`](CLAUDE.md), the architecture notes. Read §2 before anything else.

- **Time is the only state.** Every position must be a pure function of `songTime`. No
  integrators, no accumulated state, no schedulers. Visuals trigger audio, never the reverse.
- **Solve up front.** A new instrument is a target plus a launch solve (`solveLaunch`, `arcPos`
  in `src/engine.js`). The physics is never bent to make a visual work.
- **Honest motion.** Contact happens at rest, exactly on the beat, with no penetration, and every
  change of motion has a visible cause. Your instrument's tests should prove all three.
- **A note's look depends only on the note**, never on its neighbours or the layout.

## Before you open a PR

```bash
npm test          # the whole suite; must pass (CI retries the few timing-sensitive tests)
npm run build
```

- Adding a song? Add it to `SONGS` + a shelf in `src/songs/index.js`, add its key to
  `EXPECTED_KEYS` in `test/songs.test.js`, and regenerate the staging fixture (command in
  CLAUDE.md §1).
- Adding an instrument? Your PR should be that one folder plus `test/inst-<key>.test.js` (its own
  honesty suite), with no edits to shared files. `test/inst-contract.test.js` checks every plugin
  against the shared contract automatically, yours included.
- Keep PRs focused: one instrument, one song or one fix per PR.

## Music and copyright

Only add songs that are **public domain** (composition *and* your arrangement of it) or **your
own original work**. No transcriptions of copyrighted songs, game music or film scores, even
"just the melody". MIDI files you import locally are your business. Files committed to this repo
are everyone's.

## License

By contributing you agree your contribution is licensed under the project's [MIT License](LICENSE).
