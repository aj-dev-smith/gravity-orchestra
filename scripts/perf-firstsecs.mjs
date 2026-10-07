#!/usr/bin/env node
/* PERF FIRST SECONDS — a fresh page load (phone-like by default: 390×844 @3, CPU 4×): frame CPU after
   the first 4 s, long tasks, and the app functions they ran (inclusive ms) — song build, iOS bank,
   room prewarm…   node scripts/perf-firstsecs.mjs http://localhost:5180 [secs=25] [phone|desktop] [&extra=params] */
import puppeteer from 'puppeteer-core';
const [url, secs = 25, prof = 'phone', q = ''] = process.argv.slice(2);
const phone = prof === 'phone';
const br = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'], defaultViewport: phone ? { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true } : { width: 1440, height: 900 } });
const p = await br.newPage();
const cdp = await p.createCDPSession();
if (phone) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
await p.evaluateOnNewDocument(() => {
  window.__lt = []; new PerformanceObserver(l => l.getEntries().forEach(e => window.__lt.push([Math.round(e.startTime), Math.round(e.duration)]))).observe({ type: 'longtask', buffered: true });
  const raf = window.requestAnimationFrame.bind(window); window.__fr = [];
  window.requestAnimationFrame = cb => raf(ts => { const t0 = performance.now(); cb(ts); window.__fr.push([Math.round(t0), +(performance.now() - t0).toFixed(1)]); });
});
await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 }); await cdp.send('Profiler.start');
await p.goto(url + '/?gov=0' + q, { waitUntil: 'load' });
await new Promise(r => setTimeout(r, secs * 1000));
const { profile } = await cdp.send('Profiler.stop');
const r = await p.evaluate(() => ({ lt: window.__lt, fr: window.__fr }));
const byId = new Map(profile.nodes.map(x => [x.id, x])), parent = new Map(); profile.nodes.forEach(x => (x.children || []).forEach(c => parent.set(c, x.id)));
const incl = new Map(), cnt = new Map(); profile.samples.forEach((id, i) => cnt.set(id, (cnt.get(id) || 0) + (profile.timeDeltas[i] || 0)));
for (const [id, us] of cnt){ const seen = new Set(); for (let q = id; q !== undefined; q = parent.get(q)){ const f = byId.get(q).callFrame; if (!/\/src\//.test(f.url)) continue;
  const key = `${f.functionName || '(anon)'} ${f.url.split('/src/').pop().split('?')[0]}:${f.lineNumber + 1}`; if (seen.has(key)) continue; seen.add(key); incl.set(key, (incl.get(key) || 0) + us / 1000); } }
const fr = r.fr, after = fr.filter(f => f[0] > 4000);
const pct = (a, q) => { const s = a.map(x => x[1]).sort((x, y) => x - y); return s[Math.floor(q * (s.length - 1))]; };
console.log('frames', fr.length, 'cpu p50', pct(after, .5), 'p95', pct(after, .95), 'max', Math.max(...after.map(x => x[1])));
console.log('long tasks (>50ms) after 4 s:', r.lt.filter(x => x[0] > 4000).length, 'total ms', r.lt.filter(x => x[0] > 4000).reduce((a, x) => a + x[1], 0), JSON.stringify(r.lt.filter(x => x[0] > 4000).slice(0, 30)));
[...incl.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).forEach(([k, ms]) => console.log(String(Math.round(ms)).padStart(7), k));
await br.close();
