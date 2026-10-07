#!/usr/bin/env node
/* FLAT-BATCH HONESTY: for every song, at several songTimes and shots, the frame drawn through the
   2D batch (src/xrbatch.js mirror) vs the SAME frame re-drawn from the original parts — read back
   from the canvas within one task (__dev.batchAB), so nothing but the batch differs.
     node scripts/batch-ab.mjs --url http://localhost:5180 [--songs a,b] [--times 3,9.5,17] [--cams stage,auto] [--size 1200x800]
   Prints per frame: max channel difference (0..255), pixels off by > 8, mean abs. (The 2D batch is
   opt-in, ?batch=1 — this script turns it on.) Measured 2026-10-07: 4–113 isolated edge pixels of ~1M
   (max channel diff up to ~200 on a silhouette pixel: batched vertices round differently), no region moves. */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const A = {};
for (let i = 2; i < process.argv.length; i += 2) A[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
const [W, H] = (A.size || '1200x800').split('x').map(Number);
const exe = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
const br = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'], defaultViewport: { width: W, height: H } });
const p = await br.newPage();
await p.goto((A.url || 'http://localhost:5180') + '/?debug&gov=0&batch=1', { waitUntil: 'networkidle0' });
await p.waitForFunction(() => window.__dev?.renderer);
await p.evaluate(() => document.getElementById('overlay')?.classList.add('gone'));
const all = await p.evaluate(() => [...document.getElementById('song').options].map(o => o.value).filter(v => v && !/^(imported|shared|solo-)/.test(v)));
const songs = A.songs ? A.songs.split(',') : all, times = (A.times || '3,9.5,17').split(',').map(Number), cams = (A.cams || 'stage,auto').split(',');
let worst = 0;
for (const k of songs){
  await p.evaluate(k => __dev.song(k), k);
  for (const cam of cams) for (const t of times){
    await p.evaluate((cam, t) => { __dev.cam(cam); __dev.rate = 0; __dev.t = t; }, cam, t);
    await new Promise(r => setTimeout(r, 400));
    const r = await p.evaluate(() => __dev.batchAB());
    worst = Math.max(worst, r.max);
    if (A.shots && r.changed){ const f = `${A.shots}-${k}-${cam}-${t}.png`; await p.screenshot({ path: f });
      // the changed pixels' clusters (32-px cells), so you can look where the batch and the originals disagree
      const cells = {}; for (const [x, y] of r.pts){ const c = `${x >> 5 << 5},${y >> 5 << 5}`; cells[c] = (cells[c] || 0) + 1; }
      console.log('   ', f, JSON.stringify(Object.entries(cells).sort((a, b) => b[1] - a[1]).slice(0, 8))); }
    console.log(k.padEnd(20), cam.padEnd(6), String(t).padEnd(5), `max ${r.max} changed ${r.changed} mean ${r.meanAbs}`, JSON.stringify(r.batch));
  }
}
console.log('worst max diff', worst);
await br.close();
