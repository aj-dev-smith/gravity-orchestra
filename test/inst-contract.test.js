import { describe, it, expect } from 'vitest';
import { INSTRUMENTS } from '../src/instruments/index.js';
import { describeContract, KNOWN_OFFBEAT } from './helpers/inst-contract.js';

/* ============================================================
   THE PLUGIN CONTRACT over EVERY instrument the registry finds (the same Vite glob as
   src/instruments/index.js) — so a contributed machine is covered the moment its folder exists,
   with no list to edit. The checks themselves (and the commented KNOWN exceptions of the shipped
   machines) live in test/helpers/inst-contract.js; test/scaffold.test.js runs the same checks on a
   freshly generated `npm run new:machine` plugin, so the template can't rot.
   ============================================================ */

// the SAME glob the registry uses — here to read each descriptor's FOLDER
const FOLDERS = Object.entries(import.meta.glob('../src/instruments/*/index.js', { eager: true }))
  .map(([p, m]) => ({ folder: p.split('/').at(-2), I: m.default }));

describe('the registry', () => {
  it('every src/instruments/<folder>/index.js registers a descriptor whose key is its folder name', () => {
    for (const { folder, I } of FOLDERS){
      expect(I, `${folder}/index.js has no default export`).toBeTruthy();
      expect(I.key, `${folder}/index.js`).toBe(folder);
    }
    expect(INSTRUMENTS.map(I => I.key)).toEqual(FOLDERS.map(f => f.folder).sort((a, b) => a.localeCompare(b)));
  });
  it('every known exception names a registered machine (no stale entries)', () => {
    for (const k of Object.keys(KNOWN_OFFBEAT)) expect(INSTRUMENTS.some(I => I.key === k), k).toBe(true);
  });
});

for (const I of INSTRUMENTS) describeContract(I);
