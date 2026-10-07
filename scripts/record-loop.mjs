#!/usr/bin/env node
/* Headless "one perfect loop" capture through the app's own REC button (seam to seam,
   director camera, live audio). Each call runs its own browser.
     node scripts/record-loop.mjs --url 'http://localhost:5180/?' --song danse-macabre \
       [--room graveyard] [--size 1920x1080] --outdir /path/to/dir
   Prints the saved file path + the measured render fps. */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const A = {};
for (let i = 2; i < process.argv.length; i += 2) A[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
const exe = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const [W, H] = (A.size || '1920x1080').split('x').map(Number);
const outdir = A.outdir; fs.mkdirSync(outdir, { recursive: true });
const browser = await puppeteer.launch({ executablePath: exe, headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  defaultViewport: { width: W, height: H } });
const page = await browser.newPage();
const cdp = await page.createCDPSession();
await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: outdir });
const errs = []; page.on('pageerror', e => errs.push(e.message));
const url = A.url + (A.song ? '' : '') + (A.room ? `&room=${A.room}` : '') + '&debug';
await page.goto(url, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.__dev, { timeout: 20000 });
if (A.song) await page.evaluate(k => window.__dev.song(k), A.song);
await page.click('#overlay').catch(() => {});
await new Promise(r => setTimeout(r, 1500));
const fps = await page.evaluate(() => new Promise(res => { let n = 0; const t0 = performance.now();
  const f = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else res(n / 3); }; requestAnimationFrame(f); }));
await page.click('#rec');                                       // arm: starts at the next loop seam
const before = new Set(fs.readdirSync(outdir));
// wait for the record card's DOWNLOAD button (appears after one full loop)
for (let i = 0; ; i++){                                 // short polls: one long waitForFunction outlives CDP's protocol timeout
  if (await page.evaluate(() => [...document.querySelectorAll('button')].some(b => b.textContent === 'DOWNLOAD'))) break;
  if (i > 900) throw new Error('no recording after 15 min');
  await new Promise(r => setTimeout(r, 1000));
}
await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent === 'DOWNLOAD').click());
let file = null;
for (let i = 0; i < 120 && !file; i++){
  await new Promise(r => setTimeout(r, 1000));
  file = fs.readdirSync(outdir).find(f => !before.has(f) && !f.endsWith('.crdownload'));
}
console.log(JSON.stringify({ file: file && `${outdir}/${file}`, fps: +fps.toFixed(1), errs }));
await browser.close();
