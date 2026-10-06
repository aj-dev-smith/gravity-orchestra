#!/usr/bin/env node
/* Regenerates test/fixtures/midi-golden-a69c84a.json: the CLASSIC importer's output
   (commit a69c84a, before the orchestra) for test/helpers/midi-fixtures.js GOLDEN_INPUTS.
   The orchestra must reproduce it exactly — see test/midi-orchestra.test.js.
     node scripts/make-midi-golden.mjs        (needs git; writes the old code to a temp dir) */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { GOLDEN_INPUTS } from '../test/helpers/midi-fixtures.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const REV = 'a69c84a';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-golden-'));
fs.mkdirSync(path.join(tmp, 'midi'));
for (const f of ['midi/parse.js', 'midi/convert.js', 'drumkit.js'])
  fs.writeFileSync(path.join(tmp, f), execSync(`git -C "${root}" show ${REV}:src/${f}`));
const { parseMidi } = await import(pathToFileURL(path.join(tmp, 'midi/parse.js')));
const { convertToSong } = await import(pathToFileURL(path.join(tmp, 'midi/convert.js')));
const out = {};
for (const [name, make] of Object.entries(GOLDEN_INPUTS)) out[name] = convertToSong(parseMidi(make()), { label: name });
const dest = path.join(root, 'test', 'fixtures', `midi-golden-${REV}.json`);
fs.writeFileSync(dest, JSON.stringify(out, null, 1) + '\n');
console.log(`${path.relative(root, dest)}: ${Object.keys(out).join(', ')}`);
