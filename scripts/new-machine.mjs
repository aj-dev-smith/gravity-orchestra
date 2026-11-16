#!/usr/bin/env node
/* ============================================================
   npm run new:machine <key> [-- --label "My Machine"] [--color '#7ad0a0'] [--root <dir>] [--dry]

   Stamps out a new INSTRUMENT PLUGIN from scripts/machine-template/:
       src/instruments/<key>/solve.js   pure timing/physics (the starter: one marble per pitch
       src/instruments/<key>/voice.js   dribbling on its own tone bar — engine.js dribble*)
       src/instruments/<key>/index.js   the descriptor + render (auto-registered by the Vite glob)
       test/inst-<key>.test.js          its own honesty suite
   A real, working machine: `npm run dev` → /?solo=<key>, and its tests pass as generated.
   No shared file is edited — test/inst-contract.test.js covers it automatically.
   Plain Node, no dependencies. --root generates into another tree (the scaffold's own test).
   ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.join(HERE, 'machine-template');

/* keys a plugin may not take: the director / camera / belt names it would collide with (a key
   'bass' needs a descriptor cameraKey — the shipped string bass has one), and the registry's own files */
export const RESERVED = new Set(['lead', 'alto', 'bass', 'belt', 'melody', 'drums', 'kit', 'stage', 'wide', 'ride', 'all',
  'auto', 'fixed', 'free', 'follow', 'solo', 'off', 'room', 'clock', 'idle', 'riser', 'stations', 'sustain', 'voicecache', 'index']);

/** Is `key` a valid, free plugin key under `root`? → an error message, or null. */
export function checkKey(key, root){
  if (typeof key !== 'string' || !key) return 'give the machine a key, e.g.  npm run new:machine chimes';
  if (!/^[a-z][a-z0-9]{1,23}$/.test(key)) return `"${key}": a key is 2–24 lowercase letters / digits, starting with a letter (it is the folder name AND the song.parts key)`;
  if (RESERVED.has(key)) return `"${key}" is reserved (a belt role, a camera mode or a registry file) — pick another`;
  if (fs.existsSync(path.join(root, 'src/instruments', key))) return `src/instruments/${key}/ already exists — that machine is taken`;
  if (fs.existsSync(path.join(root, 'test', `inst-${key}.test.js`))) return `test/inst-${key}.test.js already exists`;
  return null;
}

/* a signature colour from the key (deterministic: one key, one colour) — change it in index.js */
export function colorOf(key){
  let h = 2166136261;
  for (const c of key) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  const hue = (h % 360) / 360, s = .75, l = .62;
  const f = n => { const k = (n + hue * 12) % 12, a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0'); };
  return `#${f(0)}${f(8)}${f(4)}`;
}
export const labelOf = key => key.replace(/^./, c => c.toUpperCase()).replace(/(\d+)/g, ' $1');

/** Generate the machine. → the list of files written (relative to root). Throws on a bad key. */
export function newMachine(key, { root = path.resolve(HERE, '..'), label = labelOf(key), color = colorOf(key), dry = false } = {}){
  const err = checkKey(key, root);
  if (err) throw new Error(err);
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new Error(`--color "${color}": use #rrggbb`);
  const safeLabel = String(label).replace(/[\\'`*\n\r]/g, '').trim() || labelOf(key);
  const fill = s => s.replaceAll('__KEY__', key).replaceAll('__LABEL__', safeLabel).replaceAll('__COLOR__', color.toLowerCase());
  const files = [
    ['solve.js.tmpl', `src/instruments/${key}/solve.js`],
    ['voice.js.tmpl', `src/instruments/${key}/voice.js`],
    ['index.js.tmpl', `src/instruments/${key}/index.js`],
    ['test.js.tmpl', `test/inst-${key}.test.js`],
  ];
  for (const [tmpl, out] of files){
    const body = fill(fs.readFileSync(path.join(TEMPLATE, tmpl), 'utf8'));
    if (dry) continue;
    fs.mkdirSync(path.dirname(path.join(root, out)), { recursive: true });
    fs.writeFileSync(path.join(root, out), body, { flag: 'wx' });   // (never overwrite)
  }
  return files.map(f => f[1]);
}

/* ---- CLI ---- */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)){
  const args = process.argv.slice(2), opt = {};
  let key = null;
  for (let i = 0; i < args.length; i++){
    const a = args[i];
    if (a === '--help' || a === '-h') key = null, opt.help = true;
    else if (a === '--dry') opt.dry = true;
    else if (a === '--label' || a === '--color' || a === '--root') opt[a.slice(2)] = args[++i];
    else if (!a.startsWith('-') && key === null) key = a;
    else { console.error(`unknown argument: ${a}`); process.exit(1); }
  }
  if (opt.help || !key){
    console.log('usage: npm run new:machine <key> [-- --label "My Machine"] [--color "#7ad0a0"] [--dry]');
    process.exit(opt.help ? 0 : 1);
  }
  try {
    const out = newMachine(key, { ...opt, ...(opt.root ? { root: path.resolve(opt.root) } : {}) });
    console.log(`${opt.dry ? '(dry run) would create' : 'created'}:\n${out.map(f => '  ' + f).join('\n')}\n`);
    console.log(`next:
  npm run dev                       then open  http://localhost:5173/?solo=${key}&debug
  npx vitest run test/inst-${key}.test.js test/inst-contract.test.js
  edit src/instruments/${key}/ — solve.js (the mechanism), voice.js (the sound), index.js (the look)
  your PR = that folder + test/inst-${key}.test.js  (no shared file — see src/instruments/README.md)`);
  } catch (e){ console.error(`new:machine: ${e.message}`); process.exit(1); }
}
