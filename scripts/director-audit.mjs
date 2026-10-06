#!/usr/bin/env node
/* The room director's solved edit, per song — no playback needed (the plan is static song data).
     node scripts/director-audit.mjs [--url http://localhost:5180/?debug] [--songs a,b] [--cuts]
   Prints each song's shot-time shares (fraction of the loop's music grid) and flags any machine
   that plays but never gets the camera. Each call launches its own browser. */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const A = {}; for (let i = 2; i < process.argv.length; i++){ const k = process.argv[i].replace(/^--/, ''); const v = process.argv[i + 1]; if (v && !v.startsWith('--')){ A[k] = v; i++; } else A[k] = true; }
const exe = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
const browser = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'], defaultViewport: { width: 1280, height: 720 } });
const page = await browser.newPage();
await page.goto(A.url || 'http://localhost:5180/?debug', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.__dev, { timeout: 15000 });
const songs = A.songs ? A.songs.split(',') : await page.evaluate(() => [...document.querySelectorAll('select option')].map(o => o.value).filter(Boolean));
let bad = 0;
for (const k of songs){
  const r = await page.evaluate(async k => { window.__dev.song(k); await new Promise(r => setTimeout(r, 250));
    return { d: window.__dev.director(), inst: window.__dev.shots.map(s => s.key) }; }, k);
  const sh = r.d.shares || {};
  const fmt = Object.entries(sh).sort((a, b) => b[1] - a[1]).map(([x, v]) => `${x} ${(v * 100).toFixed(0)}%`).join('  ');
  const unseen = r.d.cuts.length ? r.inst.filter(x => !(sh[x] > 0)) : [];
  if (unseen.length) bad++;
  console.log(`${k.padEnd(22)} ${r.inst.length ? fmt : '(no stations — the belt-only track director)'}${unseen.length ? '   ⚠ never on camera: ' + unseen.join(', ') : ''}`);
  if (A.cuts) console.log('   ', r.d.cuts.map(([b, x]) => `${b}:${x}`).join(' '));
}
await browser.close();
process.exit(bad ? 1 : 0);
