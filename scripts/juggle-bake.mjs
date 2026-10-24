#!/usr/bin/env node
/* Bake the JUGGLER's plans for the whole catalog → src/juggle-baked.json, so a song load never
   runs the search (src/juggle.js; the slowest songs take seconds). Keyed by jugglerKey — a hash of
   the belt voices, the tempo and JUGGLE_VERSION — so a song edit (or a solver change: bump the
   version) simply misses the bake and is solved live (the worker). test/juggle.test.js fails when
   a baked plan is stale or missing: re-run this. Each plan carries its plates' HOLDS too (the
   pass after the search that decides how long each plate stays out before it folds).
     node scripts/juggle-bake.mjs */
import fs from 'node:fs';
import { SONGS } from '../src/songs/index.js';
import { layoutJuggler, solveJuggler, assembleJuggler, packSolve, JUGGLE_VERSION } from '../src/juggle.js';

const out = { v: JUGGLE_VERSION, plans: {} };
let total = 0;
for (const [key, song] of Object.entries(SONGS)){
  const t0 = performance.now();
  const L = layoutJuggler(song), solved = solveJuggler(L), J = assembleJuggler(L, solved), ms = performance.now() - t0;
  total += ms;
  out.plans[L.key] = { song: key, voices: packSolve(solved, J) };
  console.log(key.padEnd(22), String(Math.round(ms)).padStart(6), 'ms', solved.map(v => `${v.carr.length}b${v.bad ? ' bad' + v.bad : ''}`).join(' '));
}
const json = JSON.stringify(out);
fs.writeFileSync(new URL('../src/juggle-baked.json', import.meta.url), json + '\n');
console.log(`${Object.keys(out.plans).length} plans, ${(json.length / 1024).toFixed(0)} KB, ${(total / 1000).toFixed(1)} s of solving`);
