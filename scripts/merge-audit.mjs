#!/usr/bin/env node
/* MERGE AUDIT — the static merge (src/mergestatic.js) bakes a part only if a sampled sweep proves it
   never moves (or never moves relative to its carriage). This re-proves every bake over a DENSE sweep
   (N uniform samples + every event ±.5 s at 25 ms) and lists any part baked that actually moves.
     node scripts/merge-audit.mjs http://localhost:5173 [songs|all] [N=300]          (exit 1 on any lie) */
import puppeteer from 'puppeteer-core';
const [url, songsArg = 'all', N = '300'] = process.argv.slice(2);
const br = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'], defaultViewport: { width: 1000, height: 700 } });
const p = await br.newPage(); const errs = [];
p.on('pageerror', e => errs.push(e.message));
await p.goto(url + `/?debug&gov=0&mergeaudit=${N}`, { waitUntil: 'networkidle0', timeout: 120000 });
await p.waitForFunction(() => window.__dev?.renderer, { timeout: 120000 });
const songs = songsArg !== 'all' ? songsArg.split(',') : await p.evaluate(() => [...document.getElementById('song').options].map(o => o.value).filter(v => v && !/^(imported|shared|solo-)/.test(v)));
let bad = 0;
for (const k of songs){
  const r = await p.evaluate(k => { __dev.song(k); return { merge: __dev.merge, audit: __dev.mergeAudit }; }, k);
  const n = (r.audit || []).reduce((s, a) => s + a.parts.length, 0); bad += n;
  console.log(k.padEnd(22), `baked ${r.merge?.removed ?? 0}`.padEnd(11), n ? `${n} MOVE: ${JSON.stringify(r.audit)}` : 'ok');
}
if (errs.length) console.log('page errors', errs);
await br.close();
process.exit(bad || errs.length ? 1 : 0);
