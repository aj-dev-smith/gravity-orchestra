import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describeRoomContract } from './helpers/room-contract.js';   // (first: it installs the fake DOM)
import { checkKey, newRoom } from '../scripts/new-room.mjs';

/* ============================================================
   `npm run new:room <key>` (scripts/new-room.mjs) — the template can't rot: every run of the suite
   generates a room into a scratch tree (.scaffold-tmp/, git-ignored and excluded from vitest's own
   file search), then runs the GENERATED room through the full room contract
   (test/helpers/room-contract.js) AND its own generated test file, then deletes it. The scratch tree
   re-exports the real shared modules (src/rooms/*.js, test/helpers/*.js), so the generated files
   import exactly what they would in src/rooms/ and test/.
   ============================================================ */
const REPO = fileURLToPath(new URL('../', import.meta.url));
const ROOT = path.join(REPO, '.scaffold-tmp', `${process.pid}-room-${Date.now().toString(36)}`);
const KEY = 'zzscaffoldroom';

function shim(rel){
  const real = path.join(REPO, rel), out = path.join(ROOT, rel);
  let spec = path.relative(path.dirname(out), real).split(path.sep).join('/');
  if (!spec.startsWith('.')) spec = './' + spec;
  const hasDefault = /^export default\b/m.test(fs.readFileSync(real, 'utf8'));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `export * from '${spec}';\n${hasDefault ? `export { default } from '${spec}';\n` : ''}`);
}
fs.mkdirSync(ROOT, { recursive: true });
for (const f of fs.readdirSync(path.join(REPO, 'src/rooms'))) if (f.endsWith('.js') && f !== 'index.js') shim(`src/rooms/${f}`);
for (const f of fs.readdirSync(path.join(REPO, 'test/helpers'))) if (f.endsWith('.js')) shim(`test/helpers/${f}`);
const files = newRoom(KEY, { root: ROOT });
afterAll(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
  try { fs.rmdirSync(path.dirname(ROOT)); } catch {}   // (only if empty: a parallel run may still be using it)
});

describe('new:room — the scaffold', () => {
  it('validates the key: lowercase, 2–24 chars, no hyphen, not reserved, not taken', () => {
    for (const bad of ['', 'a', 'Bad', 'x-y', '9abc', 'has space', 'a'.repeat(25), 'lantern_court']) expect(checkKey(bad, REPO), JSON.stringify(bad)).toMatch(/key/);
    for (const r of ['off', 'index', 'common', 'footing', 'footing3d', 'pulse']) expect(checkKey(r, REPO), r).toMatch(/reserved|exists/);
    for (const taken of ['grid', 'cathedral', 'void', 'arena', 'starship']) expect(checkKey(taken, REPO), taken).toMatch(/already exists/);
    expect(checkKey('lanterncourt', REPO)).toBeNull();
    expect(() => newRoom(KEY, { root: ROOT })).toThrow(/already exists/);   // (never overwrites)
  });
  it('writes ONE room file + ONE test, every placeholder filled, named as the registry\'s glob expects', () => {
    expect(files).toEqual([`src/rooms/${KEY}.js`, `test/room-${KEY}.test.js`]);
    for (const f of files) expect(fs.readFileSync(path.join(ROOT, f), 'utf8'), f).not.toMatch(/__(KEY|LABEL|COLOR)__/);
    const src = fs.readFileSync(path.join(ROOT, files[0]), 'utf8');
    expect(src).toContain(`key: '${KEY}'`);
    expect(src, 'a guest must never import the registry (a cycle)').not.toMatch(/from '\.\/index\.js'/);
    expect(path.basename(files[0])).toMatch(/^[a-z][a-z0-9]*\.js$/);          // (no hyphen: src/rooms/index.js globs ./*.js minus ./*-*.js)
  });
  it('a dry run writes nothing; a label and a colour can be given', () => {
    const dry = path.join(ROOT, 'dry');
    fs.mkdirSync(dry);
    expect(newRoom('drytest', { root: dry, dry: true }).length).toBe(2);
    expect(fs.readdirSync(dry)).toEqual([]);
    expect(() => newRoom('colortest', { root: dry, color: 'red' })).toThrow(/color/);
    newRoom('labeltest', { root: dry, label: "Sun's Court", color: '#FFB45A' });
    const src = fs.readFileSync(path.join(dry, 'src/rooms/labeltest.js'), 'utf8');
    expect(src).toContain("label: 'Suns Court'");
    expect(src).toContain("'#ffb45a'");
  });
});

// the GENERATED room: the whole room contract, and its own generated suite
const R = (await import(pathToFileURL(path.join(ROOT, `src/rooms/${KEY}.js`)).href)).default;
describeRoomContract(R, { root: pathToFileURL(ROOT + path.sep) });
await import(pathToFileURL(path.join(ROOT, `test/room-${KEY}.test.js`)).href);
