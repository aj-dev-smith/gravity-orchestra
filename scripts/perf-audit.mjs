#!/usr/bin/env node
/* PERF AUDIT — per-song frame cost, desktop and phone-like, in headless Chrome (GPU on).
     node scripts/perf-audit.mjs --url http://localhost:5180 [--profile desktop|phone] [--songs a,b,c]
       [--secs 6] [--warm 2] [--cam stage|auto] [--gov 0|1] [--out results.json]
   One browser per run, songs switched IN-PAGE (the real song-menu path), so a song's
   "switch" numbers include its build + first-frame shader compiles. Per song:
     build    ms spent inside the song-change handler (buildWorld: solve + geometry + merge)
     stall    the longest animation-frame callback in the first ~40 frames after the switch
              (compiles land here: three.js compiles a program the first time it draws it)
     progs    shader programs compiled by the switch (renderer.info.programs delta)
     dt50/95  frame interval median / p95 (ms) over --secs of play at rate 1, after --warm
     cpu50/95 main-thread time inside the rAF callback (animate + composer.render submission)
     calls / tris / geos / tex / objs   per-frame renderer.info (all composer passes) + scene counts
     heap     usedJSHeapSize after the run (MB); alloc = heap growth per second while playing (MB/s,
              a rough per-frame-garbage signal: GC resets it, so it under-reads — use --sample for truth)
   --tap 1 clicks the start veil first (the AudioContext is built in that gesture → the live path, as
   for a real visitor after the first tap); without it the page plays behind no veil with no context.
   --profile phone = 390×844 @ DPR 3, touch, CPU throttled 4× (CDP Emulation.setCPUThrottlingRate).
   --sample 1 adds a CDP sampling heap profile over the play window: top allocating functions.
   Needs ?debug (the script adds it). */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const A = {};
for (let i = 2; i < process.argv.length; i += 2) A[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
const base = (A.url || 'http://localhost:5180').replace(/\/$/, '');
const phone = A.profile === 'phone';
const secs = +(A.secs || 6), warm = +(A.warm || 2);
const CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ...['chromium-1234/chrome-mac/Chromium.app/Contents/MacOS/Chromium',
      'chromium-1234/chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium']
    .map(p => `${process.env.HOME}/Library/Caches/ms-playwright/${p}`),
];
const exe = CANDIDATES.find(p => fs.existsSync(p));
const browser = await puppeteer.launch({ executablePath: exe, headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-precise-memory-info',
         '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
  defaultViewport: phone ? { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true } : { width: 1440, height: 900, deviceScaleFactor: 1 } });
const page = await browser.newPage();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const cdp = await page.createCDPSession();
const errs = [];
page.on('pageerror', e => errs.push(`[pageerror] ${e.message}`));
page.on('console', m => { if (m.type() === 'error') errs.push(`[error] ${m.text()}`); });
// time every rAF callback (the whole animate(): update + composer.render submission)
await page.evaluateOnNewDocument(() => {
  const raf = window.requestAnimationFrame.bind(window);
  window.__pf = { cpu: [], at: [] };
  window.requestAnimationFrame = cb => raf(ts => { const t0 = performance.now(); cb(ts); const t1 = performance.now(); window.__pf.cpu.push(t1 - t0); window.__pf.at.push(t0); });
});
const q = new URLSearchParams({ debug: '' });
if (A.gov !== '1') q.set('gov', '0');
if (A.q) for (const kv of A.q.split('&')){ const [k, v = ''] = kv.split('='); q.set(k, v); }   // --q 'batch=0&nobvh' (extra URL params, A/B)
await page.goto(`${base}/?${q.toString().replace(/=(?=&|$)/g, '')}`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.__dev && window.__dev.renderer, { timeout: 30000 });
if (A.tap === '1'){ await page.click('#overlay'); await sleep(800); }   // --tap 1: the real start tap (audio context built in the gesture → live path)
else await page.evaluate(() => document.getElementById('overlay')?.classList.add('gone'));
if (phone || A.throttle) await cdp.send('Emulation.setCPUThrottlingRate', { rate: +(A.throttle || 4) });   // (--throttle n: another rate)
const all = await page.evaluate(() => [...document.getElementById('song').options].map(o => o.value).filter(v => v && !/^(imported|shared|solo-)/.test(v)));
const songs = A.songs ? A.songs.split(',') : all;
const pct = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const r1 = x => Math.round(x * 10) / 10;
const res = {};
/* a CPU profile → the top self-time functions (ms) */
function hot(profile, n = 14){
  const byId = new Map(profile.nodes.map(x => [x.id, x])), self = new Map(), dt = profile.timeDeltas;
  const cnt = new Map(); profile.samples.forEach((id, i) => cnt.set(id, (cnt.get(id) || 0) + (dt[i] || 0)));
  for (const [id, us] of cnt){ const f = byId.get(id).callFrame; const key = `${f.functionName || '(anon)'} ${f.url.split('/').pop().split('?')[0]}:${f.lineNumber + 1}`;
    self.set(key, (self.get(key) || 0) + us / 1000); }
  const selfTop = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([f, ms]) => [f, Math.round(ms)]);
  if (!A.incl) return selfTop;
  // inclusive time for app functions (src/ files): which of OUR calls the hot leaves sit under
  const parent = new Map(); profile.nodes.forEach(x => (x.children || []).forEach(c => parent.set(c, x.id)));
  const incl = new Map();
  for (const [id, us] of cnt){ const seen = new Set();
    for (let p = id; p !== undefined; p = parent.get(p)){ const f = byId.get(p).callFrame; if (!/\/src\//.test(f.url)) continue;
      const key = `${f.functionName || '(anon)'} ${f.url.split('/src/').pop().split('?')[0]}:${f.lineNumber + 1}`;
      if (seen.has(key)) continue; seen.add(key); incl.set(key, (incl.get(key) || 0) + us / 1000); } }
  return { self: selfTop, incl: [...incl.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([f, ms]) => [f, Math.round(ms)]) };
}
for (const k of songs){
  if (!all.includes(k)){ res[k] = { missing: true }; continue; }
  if (A.prof === '1'){ await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start'); }
  const sw = await page.evaluate(k => {
    const p0 = window.__dev.renderer.info.programs.length;
    window.__pf.cpu.length = 0; window.__pf.at.length = 0;
    const t0 = performance.now(); window.__dev.song(k); const build = performance.now() - t0;
    window.__dev.rate = 1; window.__dev.t = 4;
    return { build, p0 };
  }, k);
  const buildProf = A.prof === '1' ? hot((await cdp.send('Profiler.stop')).profile) : null;
  if (A.cam) await page.evaluate(m => window.__dev.cam(m), A.cam);
  await sleep(1200);
  const first = await page.evaluate(p0 => ({ stall: Math.max(0, ...window.__pf.cpu.slice(0, 40)), progs: window.__dev.renderer.info.programs.length - p0 }), sw.p0);
  await sleep(warm * 1000);
  if (A.sample === '1') await cdp.send('HeapProfiler.startSampling', { samplingInterval: 4096 });
  if (A.prof === '1'){ await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start'); }
  const h0 = await page.evaluate(() => { window.__pf.cpu.length = 0; window.__pf.at.length = 0; return performance.memory.usedJSHeapSize; });
  const info = page.evaluate(() => window.__dev.renderInfo(30));
  await sleep(secs * 1000);
  const ri = await info;
  const m = await page.evaluate(() => ({ cpu: [...window.__pf.cpu], at: [...window.__pf.at], heap: performance.memory.usedJSHeapSize, gov: window.__dev.gov.state, merge: window.__dev.merge, frozen: window.__dev.frozen?.().frozen, path: window.__dev.audioPath?.() }));
  let top = null;
  if (A.sample === '1'){
    const { profile } = await cdp.send('HeapProfiler.stopSampling');
    const self = new Map();
    const walk = n => { const f = n.callFrame, key = `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber + 1}`;
      self.set(key, (self.get(key) || 0) + n.selfSize); n.children.forEach(walk); };
    walk(profile.head);
    top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([f, b]) => [f, r1(b / 1024 / secs)]);   // KB/s sampled
  }
  if (A.prof === '1') top = { ...(top ? { alloc: top } : {}), play: hot((await cdp.send('Profiler.stop')).profile) };
  const dts = m.at.slice(1).map((t, i) => t - m.at[i]);
  res[k] = { build: Math.round(sw.build), stall: Math.round(first.stall), progs: first.progs,
    dt50: r1(pct(dts, .5)), dt95: r1(pct(dts, .95)), fps: r1(1000 / (dts.reduce((a, b) => a + b, 0) / Math.max(1, dts.length))),
    cpu50: r1(pct(m.cpu, .5)), cpu95: r1(pct(m.cpu, .95)),
    calls: ri.calls, tris: ri.tris, programs: ri.programs, geos: ri.geometries, tex: ri.textures, objs: ri.visibleObjs, lights: ri.lights,
    heap: r1(m.heap / 1048576), alloc: r1(Math.max(0, m.heap - h0) / 1048576 / secs), gov: m.gov && { level: m.gov.level, pr: m.gov.pr, kept: m.gov.kept, reverted: m.gov.reverted, med: m.gov.medianMs },
    frozen: m.frozen, path: m.path, ...(top ? { top } : {}), ...(buildProf ? { buildProf } : {}) };
  console.error(k.padEnd(22), JSON.stringify(res[k]));
}
if (errs.length) console.error(errs.slice(0, 20).join('\n'));
const out = { url: base, profile: phone ? 'phone' : 'desktop', cam: A.cam || 'auto', gov: A.gov === '1', secs, at: new Date().toISOString(), res };
if (A.out) fs.writeFileSync(A.out, JSON.stringify(out, null, 1));
else console.log(JSON.stringify(out));
await browser.close();
