#!/usr/bin/env node
/* Headless screenshot tool for instrument work — each call launches its OWN browser,
   so parallel agents never fight over a shared tab.
     node scripts/shot.mjs --url 'http://localhost:5180/?solo=marimba&debug' \
       --out /path/a.png [--station marimba,15,5] [--look px,py,pz,tx,ty,tz] \
       [--song key] [--cam auto|stage|free|<station>] [--t 3.2] [--rate .25] [--wait 1500] [--frames t1,t2,...] [--size 1200x800]
   --frames takes several shots (out-0.png, out-1.png…) at songTimes t1, t2… (each a
   scrub: __dev.t = t, then --wait ms of real playback at --rate before the shot).
   Prints console errors + a JSON line of __dev state. Needs ?debug in the URL. */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const A = {};
for (let i = 2; i < process.argv.length; i += 2) A[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
const CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ...['chromium-1234/chrome-mac/Chromium.app/Contents/MacOS/Chromium',
      'chromium-1234/chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium']
    .map(p => `${process.env.HOME}/Library/Caches/ms-playwright/${p}`),
];
const exe = CANDIDATES.find(p => fs.existsSync(p));
const [W, H] = (A.size || '1200x800').split('x').map(Number);
const browser = await puppeteer.launch({ executablePath: exe, headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  defaultViewport: { width: W, height: H } });
const page = await browser.newPage();
const errs = [];
page.on('console', m => { if (['error', 'warn', 'warning'].includes(m.type())) errs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', e => errs.push(`[pageerror] ${e.message}`));
await page.goto(A.url, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.__dev, { timeout: 15000 });
if (A.song){ await page.evaluate(k => window.__dev.song(k), A.song); await new Promise(r => setTimeout(r, 300)); }
if (A.cam) await page.evaluate(m => window.__dev.cam(m), A.cam);
await page.evaluate(() => {                          // hide the veil + dev HUD clutter for clean frames
  document.getElementById('overlay')?.classList.add('gone');
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const frame = async (out, t) => {
  await page.evaluate((st, look, rate, t) => {
    if (rate) window.__dev.rate = +rate;
    if (t !== undefined) window.__dev.t = +t;
    if (st){ const [k, d, u] = st.split(','); window.__dev.station(k, d ? +d : undefined, u ? +u : undefined); }
    if (look) window.__dev.look(...look.split(',').map(Number));
  }, A.station, A.look, A.rate, t);
  await sleep(+(A.wait || 1200));
  await page.screenshot({ path: out });
};
const out = A.out || 'shot.png';
if (A.frames){
  const ts = A.frames.split(',');
  for (let i = 0; i < ts.length; i++) await frame(out.replace(/\.png$/, `-${i}.png`), ts[i]);
} else await frame(out, A.t);
const state = await page.evaluate(() => ({ t: window.__dev.t, shot: window.__dev.shot, instruments: window.__dev.instruments?.() }));
console.log(errs.length ? errs.join('\n') : '(no console errors/warnings)');
console.log(JSON.stringify(state));
await browser.close();
