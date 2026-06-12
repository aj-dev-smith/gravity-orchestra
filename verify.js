#!/usr/bin/env node
/* verify.js — guardrails for marble-cascade.html
   1. Extracts the inline <script> and runs node's syntax check on it.
   2. THE LOCK RULE: for every track, sum(beats) + delay must equal the
      melody's sum exactly, or the song desyncs at the loop seam.
   3. Validates note spelling ([A-G]#?\d — sharps only).
   Run after ANY song edit: node verify.js
*/
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const HTML = path.join(__dirname, 'marble-cascade.html');
const html = fs.readFileSync(HTML, 'utf8');
const script = html.split('<script>')[1].split('</script>')[0];

// 1 — syntax check the extracted script
const tmp = path.join(require('os').tmpdir(), 'cascade-script.js');
fs.writeFileSync(tmp, script);
try {
  execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
} catch (e) {
  console.error('SYNTAX ERROR in extracted script:\n' + e.stderr);
  process.exit(1);
}
console.log('syntax        OK');

// 2 — extract the SONGS literal by brace matching and evaluate it
const start = script.indexOf('const SONGS = {');
if (start < 0) { console.error('could not find SONGS'); process.exit(1); }
let i = script.indexOf('{', start), depth = 0, end = -1;
for (let j = i; j < script.length; j++) {
  if (script[j] === '{') depth++;
  else if (script[j] === '}') { depth--; if (depth === 0) { end = j; break; } }
}
const SONGS = eval('(' + script.slice(i, end + 1) + ')');

const sum = a => a.reduce((s, [, b]) => s + b, 0);
const NOTE = /^[A-G]#?\d$/;
let failures = 0;
const fail = msg => { failures++; console.error('  *** ' + msg); };

for (const [key, s] of Object.entries(SONGS)) {
  const total = sum(s.melody);
  const report = ['melody ' + total];
  const parts = { melody: { notes: s.melody, delay: 0 } };
  for (const name of ['alto', 'bass']) {
    if (!s[name]) continue;
    parts[name] = Array.isArray(s[name]) ? { notes: s[name], delay: 0 } : s[name];
  }
  for (const [name, part] of Object.entries(parts)) {
    for (const [note] of part.notes) {
      if (!NOTE.test(note)) fail(`${key}.${name}: bad note "${note}" (sharps only, e.g. F#4)`);
    }
    if (name === 'melody') continue;
    const t = sum(part.notes) + (part.delay || 0);
    report.push(`${name} ${sum(part.notes)} + delay ${part.delay || 0} = ${t}`);
    if (Math.abs(t - total) > 1e-9) fail(`${key}.${name}: ${t} ≠ melody ${total} — DESYNC at loop seam`);
  }
  console.log(key.padEnd(14), report.join(' | '));
}

if (failures) {
  console.error(`\n${failures} FAILURE${failures > 1 ? 'S' : ''}`);
  process.exit(1);
}
console.log(`\nall ${Object.keys(SONGS).length} songs locked`);
