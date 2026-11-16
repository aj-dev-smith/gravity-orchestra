import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkKey, newMachine, colorOf, labelOf } from '../scripts/new-machine.mjs';
import { describeContract } from './helpers/inst-contract.js';

/* ============================================================
   `npm run new:machine <key>` (scripts/new-machine.mjs) — the template can't rot: every run of
   the suite generates a machine into a scratch tree (.scaffold-tmp/, git-ignored and excluded
   from vitest's own file search), then runs the GENERATED machine through the full plugin
   contract (test/helpers/inst-contract.js) AND its own generated test file, then deletes it.
   The scratch tree re-exports the real shared modules (src/engine.js, src/instruments/*.js), so
   the generated files import exactly what they would in src/instruments/<key>/.
   ============================================================ */
const REPO = fileURLToPath(new URL('../', import.meta.url));
const ROOT = path.join(REPO, '.scaffold-tmp', `${process.pid}-${Date.now().toString(36)}`);
const KEY = 'zzscaffold';

/* the shared modules a plugin may import, as re-exports of the real ones (one module instance:
   the voice cache the contract sweeps is the one the generated voice.js fills) */
function shim(rel){
  const real = path.join(REPO, rel), out = path.join(ROOT, rel);
  let spec = path.relative(path.dirname(out), real).split(path.sep).join('/');
  if (!spec.startsWith('.')) spec = './' + spec;
  const hasDefault = /^export default\b/m.test(fs.readFileSync(real, 'utf8'));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `export * from '${spec}';\n${hasDefault ? `export { default } from '${spec}';\n` : ''}`);
}
fs.mkdirSync(ROOT, { recursive: true });
for (const f of fs.readdirSync(path.join(REPO, 'src'))) if (f.endsWith('.js') && f !== 'main.js') shim(`src/${f}`);
for (const f of fs.readdirSync(path.join(REPO, 'src/instruments'))) if (f.endsWith('.js') && f !== 'index.js') shim(`src/instruments/${f}`);
const files = newMachine(KEY, { root: ROOT });
afterAll(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
  try { fs.rmdirSync(path.dirname(ROOT)); } catch {}   // (only if empty: a parallel run may still be using it)
});

describe('new:machine — the scaffold', () => {
  it('validates the key: lowercase, 2–24 chars, not reserved, not taken', () => {
    for (const bad of ['', 'a', 'Bad', 'x-y', '9abc', 'has space', 'a'.repeat(25)]) expect(checkKey(bad, REPO), JSON.stringify(bad)).toMatch(/key/);
    for (const r of ['lead', 'alto', 'bass', 'drums', 'stage', 'belt', 'ride', 'clock', 'stations']) expect(checkKey(r, REPO), r).toMatch(/reserved|exists/);
    for (const taken of ['bells', 'marimba', 'riff']) expect(checkKey(taken, REPO), taken).toMatch(/already exists/);
    expect(checkKey('glockenspiel2', REPO)).toBeNull();
    expect(() => newMachine(KEY, { root: ROOT })).toThrow(/already exists/);   // (never overwrites)
  });
  it('writes ONE folder + ONE test, every placeholder filled', () => {
    expect(files).toEqual([`src/instruments/${KEY}/solve.js`, `src/instruments/${KEY}/voice.js`, `src/instruments/${KEY}/index.js`, `test/inst-${KEY}.test.js`]);
    for (const f of files){
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
      expect(src, f).not.toMatch(/__(KEY|LABEL|COLOR)__/);
    }
    expect(fs.readFileSync(path.join(ROOT, files[2]), 'utf8')).toContain(`key: '${KEY}'`);
  });
  it('a dry run writes nothing; a label and a colour can be given', () => {
    const dry = path.join(ROOT, 'dry');
    fs.mkdirSync(dry);
    expect(newMachine('drytest', { root: dry, dry: true }).length).toBe(4);
    expect(fs.readdirSync(dry)).toEqual([]);
    expect(colorOf('chimes')).toMatch(/^#[0-9a-f]{6}$/);
    expect(colorOf('chimes')).toBe(colorOf('chimes'));
    expect(labelOf('chimes2')).toBe('Chimes 2');
    expect(() => newMachine('colortest', { root: dry, color: 'red' })).toThrow(/color/);
  });
});

// the GENERATED machine: the whole plugin contract, and its own generated honesty suite
const I = (await import(pathToFileURL(path.join(ROOT, `src/instruments/${KEY}/index.js`)).href)).default;
describeContract(I, { root: pathToFileURL(ROOT + path.sep) });
await import(pathToFileURL(path.join(ROOT, `test/inst-${KEY}.test.js`)).href);
