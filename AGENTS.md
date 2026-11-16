# AGENTS.md

You are a coding agent working for someone who wants to contribute to Gravity Orchestra. This file
is your contract. Follow it exactly. The human-facing version is [`CONTRIBUTING.md`](CONTRIBUTING.md).

## What this project is

- A browser music machine (three.js r184 + Web Audio, Vite, vanilla ES modules, Vitest).
- Marbles and mechanisms play music. The melody is authored first; every motion is solved
  backward from it in closed form. Nothing is simulated.
- An instrument ("machine") is a plugin: one folder in `src/instruments/<key>/`, auto-registered.
  A room is one file `src/rooms/<key>.js` (plus `<key>-*.js` helpers), auto-registered too.
- Maintained by one person. Review time is the scarcest resource here. Spend it well.

## Invariants (break one and the PR is closed)

1. **Time is the only state.** Every position, pose and glow is a pure function of `songTime`.
   Scrubbing (`?debug`) can jump anywhere, backwards too, and the frame must be identical.
2. **Solve up front.** No integrators, no physics engine, no per-frame velocity accumulation, no
   timers, no audio schedulers. A hit is a target plus a launch solve (`solveLaunch`, `arcPos`,
   `arcVel` from `src/engine.js`, or the same closed form written out). Strikes fire when the timeline crosses them, never from a clock.
3. **Honest motion.** The struck surface is at rest at contact, the strike lands exactly on the
   beat, nothing passes through anything, nothing teleports or pops in. Every change of motion has
   a visible cause (a piston, a magnet, a latch, a spring). Long gaps park at a physical feature.
4. **A note's look depends only on the note** (pitch, velocity), never on neighbours or layout.

## The fast lane: a new machine

1. Read [`src/instruments/README.md`](src/instruments/README.md) in full. It is the plugin contract.
2. Run `npm install`, then `npm run new:machine <key>` (`<key>`: lowercase, a new folder name).
   It scaffolds a working minimal machine: `src/instruments/<key>/{solve.js,voice.js,index.js}`
   and `test/inst-<key>.test.js`. Options: `-- --label "Wind Chimes" --color "#7ad0a0"`.
3. **Edit only those four files.** `solve.js` stays pure (no THREE scene, DOM or audio).
   `voice.js` stays pure DSP (deterministic; cache with `voiceCache()`, never a plain `Map`).
   `index.js` builds and updates the 3D machine. If you think a shared file must change, stop and
   tell your human; that is an issue for the maintainer, not part of this PR.
4. Write honesty tests in `test/inst-<key>.test.js`: every strike lands on its beat, the striker is
   at rest at contact, no penetration, the demo part is valid, 500 random events plus garbage input
   never throw. `test/inst-contract.test.js` checks the generic contract for you.
5. Verify: `npx vitest run test/inst-<key>.test.js test/inst-contract.test.js`, then `npm test`
   (the whole suite, a few minutes) and `npm run build`. Both must pass. (`scripts/merge-audit.mjs`
   is the maintainer's job, not yours.) Confirm your diff with `git diff --stat main...HEAD`
   (three dots): it must list only your four files.
6. Run `npm run dev` and open `?solo=<key>`. Your human must watch it and listen to it. Tests
   cannot tell whether the motion reads as honest or the sound is good.
7. Give your human, for the PR: a clip or screenshot of `?solo=<key>`, and 2 or 3 sentences on the
   MECHANISM (what physically causes each note, where the energy comes from). Leave the PR
   template's "I ran it, watched it and listened to it" box for your human to tick.

One machine per PR. Stage placement and MIDI routing are curated by the maintainer after merge;
the machine gets a default seat, so do not touch `stations.js` or `src/midi/`.

## DO NOT

- **Do not edit the core**: `src/engine.js`, `src/audio.js`, `src/juggle*.js`, `src/transport.js`,
  `src/main.js`, `src/instruments/stations.js` or any other shared file at the top of
  `src/instruments/`, `src/midi/**`, `src/rooms/index.js`, `src/rooms/footing*.js`,
  `test/fixtures/**`, other machines' folders, other tests.
- Do not add, remove or bump dependencies. Do not touch `package.json` or `package-lock.json`.
- Do not regenerate fixtures (`scripts/staging-audit.mjs --fixture`, `scripts/juggle-bake.mjs`,
  golden files).
- Do not add build tooling, linters, formatters, CI, TypeScript or config files.
- Do not commit copyrighted music: no transcriptions of copyrighted songs, game or film music, no
  `.mid` files you didn't write. Public domain or the human's original work only.
- Do not refactor, reformat, rename or "clean up" anything outside your folder. No typo-only,
  comment-only or README-only PRs.
- **Never run `npm run deploy` or `./deploy.sh`.** They publish to production.
- **Never open an issue or a PR unless your human explicitly asked for that specific one.** Never
  more than one PR per task. Never comment on, review or label other people's issues and PRs.
- Do not hide that an agent wrote the code. Say so in the PR body (the template has a box), and
  name the tool.

## Other lanes (only if your human asked)

- **A song**: data in `src/songs/`, plus `SONGS` + a shelf in `src/songs/index.js` and
  `EXPECTED_KEYS` in `test/songs.test.js`. Public domain or original only. Obey the LOCK RULE
  (`CLAUDE.md` §6). Do not regenerate the staging fixture; the staging test failing with "missing
  from the fixture" is expected and the maintainer fixes it on merge.
- **A room**: read [`src/rooms/README.md`](src/rooms/README.md), run `npm run new:room <key>`, and edit
  only `src/rooms/<key>.js`, your own `src/rooms/<key>-*.js` helpers and `test/room-<key>.test.js`. The
  room is registered automatically (do not edit `src/rooms/index.js`), and the staging fixture pins the
  shipped rooms only (do not regenerate it; nothing fails). Never import `src/rooms/index.js` from the
  room. Verify with `npx vitest run test/room-<key>.test.js test/room-contract.test.js`, then `npm test`
  and `npm run build`; your human looks at `?room=<key>&song=finale` and a sparse song.
- **A bug fix**: only with a reproducing URL or file, smallest possible diff, no core files unless
  the maintainer agreed on the issue.

## Commands

    npm install
    npm run new:machine <key>               # scaffold a machine
    npm run new:room <key>                  # scaffold a room (then ?room=<key>)
    npm run dev                             # dev server; add ?solo=<key> to the printed URL
                                            #   ?solo=<key>&debug  -> scrub bar + window.__dev
                                            #   __dev.t = 3.2 scrubs, __dev.rate = .25 slows
                                            #   __dev.strikes() lists strikes + any unbaked voice id
    npx vitest run test/inst-<key>.test.js  # your tests only (fast)
    npm test                                # the whole suite; must pass
    npm run build                           # must pass (the ">800 kB chunk" warning is expected)
    node scripts/shot.mjs                   # headless stills of ?solo=<key> for the PR (flags in
                                            #   its header; needs Chrome). __dev.cam('<key>') frames it

Wall-clock budget tests can flake on a loaded machine. Re-run the failing file alone before
believing it.

## Background

[`CLAUDE.md`](CLAUDE.md) is the maintainer's architecture notes. It is long: read §2 (the core
idea) and §4b (the plugin seam), not all of it. Study a shipped machine close to yours
(`src/instruments/bells/`, `pogo/`, `organ/`) and `src/marbledrums.js`, the reference design.
