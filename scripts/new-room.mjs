#!/usr/bin/env node
/* ============================================================
   npm run new:room <key> [-- --label "Lantern Court"] [--color '#ffb45a'] [--root <dir>] [--dry]

   Stamps out a new ROOM from scripts/room-template/:
       src/rooms/<key>.js           the room (auto-registered by src/rooms/index.js's glob, after the
                                    shipped rooms: ?room=<key>, and the R cycle)
       test/room-<key>.test.js      its own tests
   A real, working room: a flagstone court under a dusk sky, a colonnade outside the stage walls,
   fireflies, and a lantern beside every machine that flares on its strikes — `npm run dev` →
   /?room=<key>, and its tests pass as generated. Helpers of your own go in src/rooms/<key>-*.js
   (a hyphen marks a helper: the registry never imports one directly).
   No shared file is edited and no fixture regenerated — test/room-contract.test.js covers it.
   Plain Node, no dependencies. --root generates into another tree (the scaffold's own test).
   ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { colorOf, labelOf } from './new-machine.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.join(HERE, 'room-template');

/* keys a room may not take: 'off' (no room), the registry and the shared modules of src/rooms/ */
export const RESERVED = new Set(['off', 'none', 'index', 'common', 'footing', 'footing3d', 'pulse', 'room', 'rooms']);

/** Is `key` a valid, free room key under `root`? → an error message, or null. */
export function checkKey(key, root){
  if (typeof key !== 'string' || !key) return 'give the room a key, e.g.  npm run new:room lanterns';
  if (!/^[a-z][a-z0-9]{1,23}$/.test(key)) return `"${key}": a key is 2–24 lowercase letters / digits, starting with a letter (it is the file name, ?room=<key> — no hyphen: a hyphen marks a helper file)`;
  if (RESERVED.has(key) || key.startsWith('footing')) return `"${key}" is reserved (no room, or a shared module of src/rooms/) — pick another`;
  if (fs.existsSync(path.join(root, 'src/rooms', `${key}.js`))) return `src/rooms/${key}.js already exists — that room is taken`;
  const dir = path.join(root, 'src/rooms');
  if (fs.existsSync(dir) && fs.readdirSync(dir).some(f => f.startsWith(`${key}-`))) return `src/rooms/${key}-*.js files already exist (another room's helpers) — pick another key`;
  if (fs.existsSync(path.join(root, 'test', `room-${key}.test.js`))) return `test/room-${key}.test.js already exists`;
  return null;
}

/** Generate the room. → the list of files written (relative to root). Throws on a bad key. */
export function newRoom(key, { root = path.resolve(HERE, '..'), label = labelOf(key), color = colorOf(key), dry = false } = {}){
  const err = checkKey(key, root);
  if (err) throw new Error(err);
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new Error(`--color "${color}": use #rrggbb`);
  const safeLabel = String(label).replace(/[\\'`*\n\r]/g, '').trim().slice(0, 28) || labelOf(key);
  const fill = s => s.replaceAll('__KEY__', key).replaceAll('__LABEL__', safeLabel).replaceAll('__COLOR__', color.toLowerCase());
  const files = [
    ['room.js.tmpl', `src/rooms/${key}.js`],
    ['test.js.tmpl', `test/room-${key}.test.js`],
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
    console.log('usage: npm run new:room <key> [-- --label "Lantern Court"] [--color "#ffb45a"] [--dry]');
    process.exit(opt.help ? 0 : 1);
  }
  try {
    const out = newRoom(key, { ...opt, ...(opt.root ? { root: path.resolve(opt.root) } : {}) });
    console.log(`${opt.dry ? '(dry run) would create' : 'created'}:\n${out.map(f => '  ' + f).join('\n')}\n`);
    console.log(`next:
  npm run dev                       then open  http://localhost:5173/?room=${key}&song=daybreak-engine  (R cycles rooms)
  npx vitest run test/room-${key}.test.js test/room-contract.test.js
  edit src/rooms/${key}.js (helpers of your own: src/rooms/${key}-*.js) — see src/rooms/README.md
  your PR = src/rooms/${key}*.js + test/room-${key}.test.js  (no shared file, no fixture to regenerate)`);
  } catch (e){ console.error(`new:room: ${e.message}`); process.exit(1); }
}
