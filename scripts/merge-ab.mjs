#!/usr/bin/env node
/* MERGE A/B — the extended static merge (carriage merge + multi-group parts, src/mergestatic.js) must
   not change a pixel. Same page, same song, same songTime, a FIXED camera: built with it (__dev.rigid
   = true) and without, screenshots of both + draw calls; diff them with scripts/imgdiff.mjs.
     node scripts/merge-ab.mjs http://localhost:5180 finale,backbeat /tmp/out [3,11] [cam=fixed|free (free = the wide's eye, held still)] */
import puppeteer from 'puppeteer-core';
const [url, songs, out, ts = '3,11', cam = 'fixed'] = process.argv.slice(2);
const br = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'], defaultViewport: { width: 1200, height: 800 } });
const p = await br.newPage();
await p.goto(url + '/?debug&gov=0', { waitUntil: 'networkidle0' });
await p.waitForFunction(() => window.__dev?.renderer);
await p.evaluate(() => document.getElementById('overlay')?.classList.add('gone'));
for (const k of songs.split(',')) for (const t of ts.split(',')) for (const rig of [1, 0]){
  await p.evaluate((k, rig, t, cam) => { __dev.rigid = !!rig; __dev.song(k); __dev.cam(cam); __dev.rate = 0; __dev.t = +t; }, k, rig, t, cam);
  await new Promise(r => setTimeout(r, 2500));
  if (cam === 'free'){   // one FIXED pose for both builds (the director / stage shots sway with real time)
    await p.evaluate(() => { const w = __dev.wide; __dev.look(...w.eye.toArray?.() ?? w.eye, ...w.aim.toArray?.() ?? w.aim); });
    await new Promise(r => setTimeout(r, 800));
  }
  const m = await p.evaluate(() => __dev.merge), ri = await p.evaluate(() => __dev.renderInfo(5));
  await p.screenshot({ path: `${out}-${k}-${t}-${rig ? 'ext' : 'plain'}.png` });
  console.log(k, t, rig ? 'ext  ' : 'plain', 'calls', ri.calls, JSON.stringify(m));
}
await br.close();
