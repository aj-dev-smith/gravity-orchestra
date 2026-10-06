#!/usr/bin/env node
/* Writes the composed multi-program MIDI fixtures (test/helpers/midi-fixtures.js) to
   public/midi/<name>.mid, so the app can boot them:  /?midi=/midi/canon-in-d.mid
   test/midi-orchestra.test.js checks the committed files match the composer. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIXTURES } from '../test/helpers/midi-fixtures.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'midi');
fs.mkdirSync(dir, { recursive: true });
for (const [name, make] of Object.entries(FIXTURES)){
  const bytes = make();
  fs.writeFileSync(path.join(dir, `${name}.mid`), bytes);
  console.log(`public/midi/${name}.mid  ${bytes.length} bytes`);
}
