#!/usr/bin/env node
/* SAME SOLVE — a render-time perf change must not move a single shot: the director's edit, every shot's
   eye/aim, the wide and every machine's box are compared with and without a URL flag, per song.
     node scripts/same-solve.mjs <url> <flag> [songs|all] [phone]      e.g. flag = nobvh (src/raybvh.js off) */
import puppeteer from 'puppeteer-core';
const [url, flag, songsArg, prof] = process.argv.slice(2);
const phone = prof === 'phone';
const run = async (q) => {
  const br = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'], defaultViewport: phone ? { width: 390, height: 844, deviceScaleFactor: 1, isMobile: true } : { width: 1440, height: 900 } });
  const p = await br.newPage();
  await p.goto(url + '/?debug&gov=0' + q, { waitUntil: 'networkidle0' });
  await p.waitForFunction(() => window.__dev?.renderer);
  const songs = songsArg && songsArg !== 'all' ? songsArg.split(',') : await p.evaluate(() => [...document.getElementById('song').options].map(o => o.value).filter(v => v && !/^(imported|shared|solo-)/.test(v)));
  const out = {};
  for (const k of songs){
    out[k] = await p.evaluate(k => { const t0 = performance.now(); __dev.song(k); const ms = performance.now() - t0;
      const r = x => JSON.parse(JSON.stringify(x, (key, v) => typeof v === 'number' ? +v.toFixed(5) : v));
      return { ms, d: r({ shots: __dev.shots, director: __dev.director(), wide: __dev.wide && { eye: __dev.wide.eye, aim: __dev.wide.aim }, boxes: __dev.boxes(), solve: __dev.solve && __dev.solve.kept }) }; }, k);
  }
  await br.close();
  return out;
};
const A = await run(''), B = await run('&' + flag);
let diff = 0;
for (const k of Object.keys(A)){
  const same = JSON.stringify(A[k].d) === JSON.stringify(B[k].d);
  if (!same) diff++;
  console.log(k.padEnd(22), same ? 'SAME' : 'DIFF', `build ${Math.round(A[k].ms)} ms vs ${flag} ${Math.round(B[k].ms)} ms`);
  if (!same){ const a = JSON.stringify(A[k].d), b = JSON.stringify(B[k].d); let i = 0; while (a[i] === b[i]) i++; console.log('   at', a.slice(Math.max(0, i - 120), i + 80), '\n   vs', b.slice(Math.max(0, i - 120), i + 80)); }
}
console.log(diff ? `${diff} songs differ` : 'all identical');
