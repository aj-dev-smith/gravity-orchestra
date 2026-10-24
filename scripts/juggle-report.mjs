#!/usr/bin/env node
/* The JUGGLER belt (src/juggle.js), per song — no browser, the plan is static song data.
     node scripts/juggle-report.mjs [--songs a,b] [--midi] [--json out.json]
   Per belt voice: notes, balls (= carriages), the beam that solved it, how the notes are
   struck (free flights / carriage drops) and left (flights / catches), the flight-time spread
   (how much of it is under F_TARGET — the multiball target), the steepest plate, the hardest
   flipper stroke, the fastest sideways throw, how long the plates hold out after a strike
   (median, and how many fold at once), and the honesty audit (what the plan still breaks:
   limits, contacts, carriage lateness/overlap). --midi adds the public/midi fixtures. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SONGS } from '../src/songs/index.js';
import { parseMidi } from '../src/midi/parse.js';
import { convertToSong } from '../src/midi/convert.js';
import { planJuggler, auditJuggler, JUGGLE } from '../src/juggle.js';

const A = {}; for (let i = 2; i < process.argv.length; i++){ const k = process.argv[i].replace(/^--/, ''); const v = process.argv[i + 1]; if (v && !v.startsWith('--')){ A[k] = v; i++; } else A[k] = true; }
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const songs = (A.songs ? A.songs.split(',') : Object.keys(SONGS)).map(k => [k, SONGS[k]]);
if (A.midi) for (const f of fs.readdirSync(path.join(root, 'public/midi')).filter(f => f.endsWith('.mid')))
  songs.push([f, convertToSong(parseMidi(new Uint8Array(fs.readFileSync(path.join(root, 'public/midi', f))))).song]);

const DEG = 180 / Math.PI, KINDS = ['struck', 'flights', 'limits', 'ballBall', 'crane', 'ballPlate', 'ballArm', 'late', 'carriages'];
const pct = (a, n) => n ? Math.round(100 * a / n) + '%' : '-';
const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
const out = [];
let total = 0, dirty = 0;
for (const [key, song] of songs){
  const t0 = performance.now();
  const J = planJuggler(song);
  const ms = performance.now() - t0;
  total += ms;
  const audit = auditJuggler(J);
  const rows = J.voices.map((V, i) => {
    const fl = V.segs.filter(s => s.kind === 'flight'), F = fl.map(s => s.t1 - s.t0);
    const issues = Object.fromEntries(KINDS.map(k => [k, audit[i][k].length]).filter(([, n]) => n));
    return { role: V.role, notes: V.notes.length, balls: V.balls, beam: V.beam,
      drops: V.plates.filter(p => p.src < 0).length, catches: V.plates.filter(p => p.exit).length,
      flightMed: med(F), short: pct(F.filter(f => f < JUGGLE.F_TARGET).length, F.length),
      tilt: Math.max(...V.plates.map(p => p.tilt)) * DEG, w: Math.max(...V.plates.map(p => Math.abs(p.w))),
      vh: Math.max(0, ...fl.map(s => Math.abs(s.vx))), hold: med(V.plates.map(p => p.hold)),
      snap: pct(V.plates.filter(p => !p.hold).length, V.plates.length), issues };
  });
  if (rows.some(r => Object.keys(r.issues).length)) dirty++;
  out.push({ key, ms: Math.round(ms), voices: rows, warnings: J.warnings });
  console.log(`${key.padEnd(20)} ${ms.toFixed(0).padStart(5)} ms  ` + rows.map(r =>
    `${r.role} ${r.notes}n ${r.balls}b B${r.beam} drop ${r.drops} catch ${r.catches} F~${r.flightMed.toFixed(2)}s <${JUGGLE.F_TARGET}:${r.short} ` +
    `tilt ${r.tilt.toFixed(0)}° w ${r.w.toFixed(1)} vh ${r.vh.toFixed(1)} hold~${r.hold.toFixed(2)}s snap ${r.snap}` +
    (Object.keys(r.issues).length ? '  ⚠ ' + Object.entries(r.issues).map(([k, n]) => k + ' ' + n).join(' ') : '')).join('  ·  '));
}
console.log(`\n${songs.length} songs, ${(total / 1000).toFixed(1)} s solving, ${dirty ? dirty + ' with audit findings' : 'all clean'}`);
if (A.json) fs.writeFileSync(A.json, JSON.stringify(out, null, 1));
