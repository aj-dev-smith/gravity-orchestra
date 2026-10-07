// AUDIO SWEEP — one full loop per song, rendered OFFLINE and measured.
//   node scripts/audio-sweep.mjs [--port 5501] [--songs k1,k2] [--midi /midi/a.mid,...] [--solo]
//        [--jobs 3] [--room <key>] [--preroll 10] [--out sweep.json]
// The app's AudioContext is replaced (before page load) by an OfflineAudioContext that renders in
// LOCKSTEP with a virtual clock (performance.now / rAF stepped 1/60 s per frame — capture.mjs's
// trick, audio only). Time is the only state, so the render is exactly what a listener hears at
// rate 1, deterministic, sample-exact, and faster than real time. Per target it reports:
//   · load: the bank build (voice renders, ms) + the lazy WAV pass, Float32 + WAV bytes, ids
//   · one STEADY-STATE loop (songTime P → 2P): per-channel SAMPLE peak, RMS, BS.1770 integrated LUFS (K-weighted,
//     gated), short-term (3 s) max, clipper-active samples (> knee·ceiling), longest near-silence
//   · the limiter / glue gain reduction (__dev.audioProbe) sampled through the loop
//   · strikes per machine (__dev.strikes), unbaked ids, console errors
//   · --solo: every machine alone (__dev.mute the rest) → its integrated LUFS vs the full mix
// Needs `npx vite --port <port>` running. Headless Chrome via puppeteer-core.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const A = {}; process.argv.slice(2).forEach((a, i, all) => { if (a.startsWith('--')) A[a.slice(2)] = all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true; });
const PORT = A.port || 5501, BASE = `http://localhost:${PORT}`, JOBS = +(A.jobs || 3);
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SR = 48000, PRE = +(A.preroll || 10);   // s of loop 1 played before the measured loop (its tails ring into it)

async function songKeys(){
  const { SONGS } = await import(new URL('../src/songs/index.js', import.meta.url));
  return Object.keys(SONGS);
}
const targets = [];
(A.songs ? String(A.songs).split(',') : await songKeys()).filter(Boolean).forEach(k => targets.push({ song: k }));
(A.midi ? String(A.midi).split(',') : []).filter(Boolean).forEach(m => targets.push({ midi: m }));

function inject(SR){
  // REAL time until the play tap (so the song build / bank bake are measured honestly), then the
  // virtual clock (__virt, set just before the click) — the song clock only starts at the tap
  let vt = 0; const realNow = performance.now.bind(performance);
  performance.now = () => window.__virt ? vt : realNow();
  let q = [];
  window.requestAnimationFrame = cb => { q.push(cb); return q.length; };
  window.cancelAnimationFrame = () => {};
  window.__step = () => { if (!window.__virt) vt = realNow(); vt += 1000 / 60; const run = q; q = []; run.forEach(cb => cb(vt)); window.__actx?.__pace(); };
  class FakeCtx extends OfflineAudioContext {
    constructor(){
      const secs = window.__AUDIO_SECS || 120, CH = .5, P = OfflineAudioContext.prototype;
      super(2, SR * secs, SR); this.__t0 = vt; window.__actx = this; this.__at = 0; this.__busy = false;
      for (let t = CH; t < secs - CH; t += CH) P.suspend.call(this, t).then(() => { this.__at = t; this.__busy = false; this.__pace(); });
      this.__pace = () => {
        if (this.__busy) return;
        if (window.__finish || this.currentTime > this.__at + CH + .05){ this.__busy = true; P.resume.call(this); }
      };
      P.startRendering.call(this).then(b => { window.__buf = b; });
      this.__busy = true;
    }
    get state(){ return 'running'; }
    get currentTime(){ return (vt - this.__t0) / 1000; }
    resume(){ return Promise.resolve(); }
    close(){ return Promise.resolve(); }
    createMediaStreamDestination(){ const g = this.createGain(); g.stream = new MediaStream(); return g; }
  }
  window.AudioContext = window.webkitAudioContext = FakeCtx;
  window.__pump = setInterval(() => window.__step(), 16);
}

/* in-page analysis of the rendered buffer over [a0, a1) seconds */
function analyse(a0, a1){
  const buf = window.__buf, sr = buf.sampleRate, s0 = Math.max(0, Math.round(a0 * sr)), s1 = Math.min(buf.length, Math.round(a1 * sr));
  const chs = [buf.getChannelData(0), buf.getChannelData(1)], N = s1 - s0;
  const db = x => x > 0 ? 20 * Math.log10(x) : -Infinity;
  let peak = [0, 0], ss = 0, hot = 0;
  // K-weighting (BS.1770, 48 kHz coefficients)
  const kw = x => { const out = new Float32Array(x.length);
    const st = [[1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, .73248077421585],
                [1, -2, 1, -1.99004745483398, .99007225036621]];
    out.set(x);
    for (const [b0, b1, b2, a1, a2] of st){ let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
      for (let i = 0; i < out.length; i++){ const xi = out[i], y = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = xi; y2 = y1; y1 = y; out[i] = y; } }
    return out; };
  const K = chs.map(c => kw(c.subarray(s0, s1)));
  for (let c = 0; c < 2; c++){ const d = chs[c];
    for (let i = s0; i < s1; i++){ const a = Math.abs(d[i]); if (a > peak[c]) peak[c] = a; ss += d[i] * d[i]; if (a > .891 * .8) hot++; } }
  const blk = Math.round(.4 * sr), hop = Math.round(.1 * sr), L = [];
  for (let i = 0; i + blk <= N; i += hop){ let z = 0; for (const k of K) for (let j = i; j < i + blk; j++) z += k[j] * k[j]; L.push(z / blk); }
  const lufs = ms => -0.691 + 10 * Math.log10(ms);
  const g1 = L.filter(z => lufs(z) > -70), m1 = g1.reduce((a, b) => a + b, 0) / Math.max(1, g1.length);
  const g2 = g1.filter(z => lufs(z) > lufs(m1) - 10), I = g2.length ? lufs(g2.reduce((a, b) => a + b, 0) / g2.length) : -Infinity;
  // short-term (3 s) max
  let stMax = -Infinity; const w = 30;
  for (let i = 0; i + w <= L.length; i += 5){ let z = 0; for (let j = i; j < i + w; j += 4) z += L[j]; stMax = Math.max(stMax, lufs(z / Math.ceil(w / 4))); }
  // near-silence: 100 ms windows under −50 dBFS RMS (both channels)
  const win = Math.round(.1 * sr); let run = 0, longest = 0, longestAt = 0, quiet = 0;
  for (let i = s0; i + win <= s1; i += win){ let z = 0; for (const d of chs) for (let j = i; j < i + win; j++) z += d[j] * d[j];
    const r = db(Math.sqrt(z / (2 * win)));
    if (r < -50){ run++; quiet++; if (run > longest){ longest = run; longestAt = (i - s0) / sr - (run - 1) * .1; } } else run = 0; }
  const r1 = x => Math.round(x * 10) / 10;
  const mom = L.filter((_, i) => i % 4 === 0).map(z => r1(Math.max(-99, lufs(z))));   // momentary loudness, 400 ms blocks
  return { mom, secs: r1(N / sr), peakL: r1(db(peak[0])), peakR: r1(db(peak[1])), rms: r1(db(Math.sqrt(ss / (2 * N)))), lufs: r1(I), stMax: r1(stMax),
           hotPct: +(100 * hot / (2 * N)).toFixed(3), silentLongest: r1(longest * .1), silentAt: r1(longestAt), silentPct: r1(100 * quiet * win / N) };
}

async function pass(browser, tg, mute, full){
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => { errs.push('[pageerror] ' + e.message.slice(0, 200)); if (A.verbose) console.error('PAGEERROR', e.message, e.stack?.slice(0, 600)); });
  page.on('console', m => { if (m.type() === 'error' || (m.type() === 'warning' && /cascade/.test(m.text()))) errs.push(m.text().slice(0, 200)); });
  await page.evaluateOnNewDocument(inject, SR);
  const q = tg.midi ? `midi=${encodeURIComponent(tg.midi)}` : `song=${tg.song}`;
  await page.goto(`${BASE}/?debug&${q}${A.room ? '&room=' + A.room : ''}`, { waitUntil: 'networkidle0', timeout: 120000 });
  await page.waitForFunction(() => window.__dev && window.__dev.P > 0 && window.__dev.instruments, { timeout: 120000 });
  if (tg.midi) await page.waitForFunction(() => window.__dev.planIn, { timeout: 120000 });
  // the lazy WAV pass finishes in idle slices — wait for it (that's the real bytes figure)
  await page.waitForFunction(() => window.__dev.bank()?.lazyDoneMs != null, { timeout: 120000, polling: 200 }).catch(() => {});
  if (A.verbose) console.error('  loaded', tg.song || tg.midi);
  const info = await page.evaluate(() => ({ P: window.__dev.P, inst: window.__dev.instruments(), bank: window.__dev.bank(),
    drums: !!window.__dev.boxes().drums }));
  await page.evaluate(([P, PRE]) => { window.__AUDIO_SECS = Math.ceil(P + PRE + 14); }, [info.P, PRE]);
  await page.evaluate(m => window.__dev.mute(m), mute);
  await page.evaluate(() => { window.__virt = true; });
  await page.click('#overlay');
  await page.evaluate(([P, PRE]) => { clearInterval(window.__pump); window.__dev.t = P - PRE; window.__dev.strikes(true); }, [info.P, PRE]);
  // jump to PRE s before the loop seam (time is the only state: the world there is exact; the jump's
  // strikes are skipped), play PRE s of loop 1 so its tails + the reverb are live, then MEASURE loop 2
  // (songTime P → 2P: steady state), sampling the gain reduction; note audio time at songTime P and 2P
  const r = await (async () => {
    let a0 = null, a1 = null, lim = 0, glue = 0, limSum = 0, n = 0, guard = 0;
    for (;;){
      const b = await page.evaluate(async P => {
        const out = { cross0: null, crossP: null, lim: 0, glue: 0, limSum: 0, n: 0, t: 0 };
        for (let i = 0; i < 90; i++){
          // the render resumes only between tasks (its suspend promises): yield, and never let it
          // fall more than a second behind the virtual clock
          if (i % 10 === 0) do await new Promise(r => setTimeout(r, 0)); while (window.__actx.currentTime > window.__actx.__at + 1.2 && !window.__buf);
          const t0 = window.__dev.t; window.__step(); const t1 = window.__dev.t;
          if (t0 < P && t1 >= P){ out.cross0 = window.__actx.currentTime - (t1 - P); window.__dev.strikes(true); }
          if (t0 < 2 * P && t1 >= 2 * P) out.crossP = window.__actx.currentTime - (t1 - 2 * P);
          if (i % 6 === 0 && t1 > P && t1 < 2 * P){ const p = window.__dev.audioProbe(); if (p){ out.lim = Math.min(out.lim, p.limDb); out.glue = Math.min(out.glue, p.glueDb); out.limSum += p.limDb; out.n++; } }
          out.t = t1; out.a = window.__actx.currentTime; out.r = window.__actx.__at; if (t1 > 2 * P + 3) break;
        }
        return out;
      }, info.P);
      if (b.cross0 != null) a0 = b.cross0; if (b.crossP != null) a1 = b.crossP;
      lim = Math.min(lim, b.lim); glue = Math.min(glue, b.glue); limSum += b.limSum; n += b.n;
      if (A.verbose) console.error(`  ${tg.song || tg.midi} t=${b.t.toFixed(1)} / ${(2 * info.P).toFixed(1)} a=${b.a?.toFixed(1)} render=${b.r?.toFixed(1)}`);
      if (b.t > 2 * info.P + 3 || ++guard > 2000) break;
    }
    return { a0, a1, lim, glue, limMean: n ? limSum / n : 0 };
  })();
  const strikes = await page.evaluate(() => window.__dev.strikes());
  const path = await page.evaluate(() => window.__dev.audioPath());
  await page.evaluate(() => { window.__finish = true; window.__actx.__pace(); });
  for (let i = 0; !(await page.evaluate(() => !!window.__buf)); i++){
    if (A.verbose && i % 20 === 0) console.error(`  ${tg.song || tg.midi} rendering audio at ${(await page.evaluate(() => window.__actx.__at)).toFixed(1)} s`);
    if (i > 3600) throw new Error('offline render timed out');
    await new Promise(res => setTimeout(res, 500));
  }
  const m = await page.evaluate(analyse, r.a0, r.a1);
  await page.close();
  return { ...info, ...m, limDb: +r.lim.toFixed(1), limMeanDb: +r.limMean.toFixed(1), glueDb: +r.glue.toFixed(1), strikes, path, errs: [...new Set(errs)] };
}

async function run(tg){
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', protocolTimeout: 600000,
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
    defaultViewport: { width: 480, height: 270 } });
  const name = tg.song || tg.midi.replace(/^.*\//, '');
  const t0 = Date.now();
  try {
    const full = await pass(browser, tg, [], true);
    const res = { name, ...full };
    if (A.solo){
      const machines = ['belt', ...(full.drums ? ['drums'] : []), ...full.inst];
      res.solo = {};
      for (const k of machines){
        const s = await pass(browser, tg, machines.filter(x => x !== k), false);
        // MASKING: while this machine sounds (its own momentary loudness > −45 LUFS), how far under the
        // full mix does it sit? median + the share of its sounding blocks buried > 15 dB under
        const d = []; s.mom.forEach((v, i) => { if (v > -45 && full.mom[i] != null) d.push(v - full.mom[i]); });
        d.sort((a, b) => a - b);
        const med = d.length ? d[d.length >> 1] : null, buried = d.length ? d.filter(x => x < -15).length / d.length : null;
        res.solo[k] = { lufs: s.lufs, stMax: s.stMax, peak: Math.max(s.peakL, s.peakR), limDb: s.limDb,
          whilePlaying: med == null ? null : +med.toFixed(1), buried: buried == null ? null : +buried.toFixed(2), active: d.length };
      }
    }
    console.error(`${name}: ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    return res;
  } catch (e){ console.error(name, 'FAILED', e.message); return { name, failed: e.message }; }
  finally { await browser.close(); }
}

const results = new Array(targets.length);
let next = 0;
await Promise.all(Array.from({ length: Math.min(JOBS, targets.length) }, async () => {
  while (next < targets.length){ const i = next++; results[i] = await run(targets[i]);
    fs.writeFileSync((A.out || 'audio-sweep.json') + '.partial', JSON.stringify(results.filter(Boolean))); }
}));
const out = A.out || 'audio-sweep.json';
fs.writeFileSync(out, JSON.stringify(results, null, 1));
// summary table
const pad = (s, n) => String(s).padEnd(n);
console.log(pad('song', 22), pad('P', 6), pad('bake', 6), pad('wav', 6), pad('MB', 6), pad('peak', 6), pad('LUFS', 6), pad('stMax', 6), pad('lim', 5), pad('hot%', 6), pad('sil', 5), 'strikes / unbaked / errs');
for (const r of results){
  if (!r || r.failed){ console.log(pad(r?.name, 22), 'FAILED', r?.failed); continue; }
  const st = Object.entries(r.strikes || {}).map(([k, v]) => `${k}:${v.n}${v.unbaked.length ? '!' + v.unbaked.length : ''}`).join(' ');
  const mb = ((r.bank?.floatBytes || 0) + (r.bank?.wavBytes || 0)) / 1e6;
  console.log(pad(r.name, 22), pad(r.P.toFixed(1), 6), pad(r.bank?.ms, 6), pad(r.bank?.lazyDoneMs, 6), pad(mb.toFixed(1), 6), pad(Math.max(r.peakL, r.peakR), 6), pad(r.lufs, 6), pad(r.stMax, 6), pad(r.limDb, 5), pad(r.hotPct, 6), pad(r.silentLongest, 5), st, r.errs.length ? 'ERR ' + r.errs[0] : '');
  if (r.solo) console.log('   solo LUFS (vs mix · while playing · buried%):', Object.entries(r.solo).map(([k, s]) => `${k} ${s.lufs} (${(s.lufs - r.lufs).toFixed(1)} · ${s.whilePlaying} · ${Math.round(100 * (s.buried || 0))}%)`).join('  '));
}
