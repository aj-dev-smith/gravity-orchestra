#!/usr/bin/env node
/* XR PERF PROBE — draw calls per frame (both eyes) WHILE PRESENTING under IWER (Quest 2), for a
   list of songs × pads, plus a breakdown by who draws them (each top-level scene group, the
   world's stations / belts, the room). Needs a DEV server (?xremu is dev-only).
     node scripts/xr-perf.mjs --base http://localhost:5173 --songs fur-elise,forge [--anchors stage,lead]
       [--t 8] [--breakdown 1] [--detail full]      (--detail full = ?xrdetail=full, the un-reduced A/B)
   The breakdown hides one group at a time and measures the drop — exact, not an estimate. */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const A = {};
for (let i = 2; i < process.argv.length; i += 2) A[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
const exe = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
const base = A.base || 'http://localhost:5173';
const songs = (A.songs || 'fur-elise,daybreak-engine').split(',');
const anchorKeys = (A.anchors || 'stage').split(',');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rows = [];
for (const song of songs){
  const browser = await puppeteer.launch({ executablePath: exe, headless: 'new',
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
    defaultViewport: { width: 1600, height: 800 } });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  const extra = A.detail ? `&xrdetail=${A.detail}` : '';
  await page.goto(`${base}/?song=${song}&debug&xremu${extra}${A.room ? '&room=' + A.room : ''}`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.__dev?.xr && [...document.querySelectorAll('#xrbtns button')].some(b => b.textContent === 'ENTER VR'), { timeout: 20000 });
  await page.evaluate(() => [...document.querySelectorAll('#xrbtns button')].find(b => b.textContent === 'ENTER VR').click());
  await page.waitForFunction(() => window.__dev.xr.info().presenting, { timeout: 10000 });
  await sleep(800);
  await page.evaluate(t => { window.__dev.t = +t; }, A.t || 8);
  for (const k of anchorKeys){
    const ok = await page.evaluate(k => { const x = window.__dev.xr, a = x.info().anchors.find(a => a.key === k || String(a.id) === k); if (a){ x.go(a.id); return true; } return false; }, k);
    if (!ok) continue;
    await sleep(900);
    const info = await page.evaluate(() => window.__dev.renderInfo(20));
    const row = { song, room: await page.evaluate(() => window.__dev.room?.() ?? null), pad: k, ...info };
    if (A.breakdown){
      row.by = await page.evaluate(async () => {
        const d = window.__dev, out = {};
        const groups = [];
        for (const c of d.scene.children){
          if (!c.visible) continue;
          if (c.name === 'world' || c.children.some(k => /^belt:|^station:/.test(k.name))){
            for (const k of c.children) if (k.visible) groups.push([k.name || k.type, k]);
          } else groups.push([c.name || c.type, c]);
        }
        const all = (await d.renderInfo(6)).calls;
        for (const [name, g] of groups){
          g.visible = false;
          const n = (await d.renderInfo(6)).calls;
          g.visible = true;
          const k = name in out ? name + '#' + Object.keys(out).length : name;
          if (all - n > 4) out[k] = all - n;
        }
        return out;
      });
    }
    rows.push(row);
    console.log(JSON.stringify(row));
  }
  if (errs.length) console.log('pageerrors:', errs.join(' | '));
  await browser.close();
}
