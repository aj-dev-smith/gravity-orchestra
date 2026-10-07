#!/usr/bin/env node
/* Headless WebXR check + stereo screenshots, under Meta's IWER emulator (Quest 2 profile).
   Needs a DEV server (the emulator is only ever loaded by `?xremu` in dev — never in a build):
     node scripts/xr-shot.mjs --url 'http://localhost:5173/?song=fur-elise&debug&xremu' \
       --out /tmp/xr.png [--anchor <id|key>] [--t 3.2] [--rate 1] [--wait 1500] [--size 1600x800]
       [--head x,y,z] [--teleport 1|<key>] [--tour 1] [--trace 1] [--controls 1] [--mode ar] [--frames t1,t2,...] [--info 20]
   Enters immersive-vr, optionally teleports to an anchor (id or key), poses the head, scrubs,
   saves the stereo canvas. --teleport 1 also drives the RIGHT controller: stick up (aim the
   throw) at the first other pad, release → asserts the rig moved. Prints console errors, the
   XR state and renderInfo WHILE PRESENTING (draw calls per frame, both eyes) — the perf gate.
   Each call launches its own browser (parallel-agent safe). */
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
const [W, H] = (A.size || '1600x800').split('x').map(Number);
const browser = await puppeteer.launch({ executablePath: exe, headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  defaultViewport: { width: W, height: H } });
const page = await browser.newPage();
const errs = [];
page.on('console', m => { if (['error', 'warn', 'warning'].includes(m.type())) errs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', e => errs.push(`[pageerror] ${e.message}`));
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fail = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fail++; };

await page.goto(A.url, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.__dev?.xr && window.__xrdev, { timeout: 20000 });
const LABEL = A.mode === 'ar' ? 'ENTER AR' : 'ENTER VR';   // (AR is offered only with ?ar, or in the Quest browser)
await page.waitForFunction(l => [...document.querySelectorAll('#xrbtns button')].some(b => b.textContent === l), { timeout: 10000 }, LABEL);
check(true, `${LABEL} button offered (emulated Quest 2)`);
if (A.trace) await page.evaluate(() => { const w = console.warn; console.warn = (...a) => w(...a, new Error().stack); });
// the real path: a CLICK on the button (the gesture that also builds audio)
await page.evaluate(l => [...document.querySelectorAll('#xrbtns button')].find(b => b.textContent === l).click(), LABEL);
await page.waitForFunction(() => window.__dev.xr.info().presenting, { timeout: 10000 });
const t0 = await page.evaluate(() => window.__dev.t);
await sleep(600);
const s0 = await page.evaluate(() => ({ ...window.__dev.xr.info(), t: window.__dev.t, audio: document.getElementById('astate')?.textContent }));
check(s0.presenting, `presenting · frameRate ${s0.frameRate} · fb ×${s0.fbScale}`);
check(s0.t > t0, `songTime advances in the XR frame loop (${t0.toFixed(2)} → ${s0.t.toFixed(2)})`);
check(s0.anchors.length > 0, `${s0.anchors.length} anchors: ${s0.anchors.map(a => a.key).join(', ')}`);
console.log(`     audio: ${s0.audio}`);

if (A.anchor !== undefined){
  await page.evaluate(k => { const x = window.__dev.xr, a = x.info().anchors.find(a => String(a.id) === k || a.key === k); if (a) x.go(a.id); }, A.anchor);
  await sleep(500);
}
if (A.head){                                             // pose the emulated headset (metres, local-floor)
  const [x, y, z] = A.head.split(',').map(Number);
  await page.evaluate((x, y, z) => window.__xrdev.remote.dispatch('animate_to', { device: 'headset', position: { x, y, z }, duration: .2 }), x, y, z);
  await sleep(500);
}
if (A.teleport){                                         // drive the right controller: aim at a pad, throw, land
  const before = await page.evaluate(() => window.__dev.xr.info());
  const target = before.anchors.find(a => a.id !== before.cur && (A.teleport === '1' || a.key === A.teleport || String(a.id) === A.teleport))
              || before.anchors.find(a => a.id !== before.cur);
  // point the right controller at the target pad: from the head, toward the pad (world → rig local is
  // the inverse of the dolly yaw+scale; the emulator wants local-floor metres) — computed in page
  await page.evaluate(id => {
    const d = window.__dev, T = d.three, x = d.xr.info(), a = x.anchors.find(a => a.id === id);
    const dolly = d.scene.getObjectByName('xr').children[0];
    dolly.updateMatrixWorld(true);
    const inv = dolly.matrixWorld.clone().invert();
    const hand = new T.Vector3(.2, 1.3, -.2);            // the right hand, in the rig (metres)
    const tgt = new T.Vector3(...a.pos).applyMatrix4(inv);
    const q = new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 0, -1), tgt.clone().sub(hand).normalize());
    const c = window.__xrdev.controllers.right;
    c.position.set(hand.x, hand.y, hand.z); c.quaternion.set(q.x, q.y, q.z, q.w);
    c.updateAxes('thumbstick', 0, -1);
  }, target.id);
  await sleep(500);
  const aiming = await page.evaluate(() => window.__dev.xr.info());
  console.log('     aim:', JSON.stringify({ hands: aiming.hands, arc: aiming.arc, head: aiming.head }));
  check(aiming.hover === target.id, `aiming: the throw picks pad ${target.id} (${target.key}) — hover ${aiming.hover}`);
  if (A.out) await page.screenshot({ path: A.out.replace(/\.png$/, '-aim.png') });
  await page.evaluate(() => window.__xrdev.controllers.right.updateAxes('thumbstick', 0, 0));
  await sleep(700);
  const after = await page.evaluate(() => window.__dev.xr.info());
  check(after.cur === target.id, `released: landed on pad ${after.cur} · rig ${before.dolly} → ${after.dolly}`);
}
if (A.controls){                                         // B pause/play, left-stick scrub, A tour, Y next song
  const press = async (hand, id) => { await page.evaluate((h, b) => window.__xrdev.controllers[h].updateButtonValue(b, 1), hand, id);
    await sleep(150); await page.evaluate((h, b) => window.__xrdev.controllers[h].updateButtonValue(b, 0), hand, id); await sleep(150); };
  await press('right', 'b-button');
  const p0 = await page.evaluate(() => window.__dev.t); await sleep(400);
  const p1 = await page.evaluate(() => window.__dev.t);
  check(Math.abs(p1 - p0) < 1e-9, `B pauses (t holds at ${p1.toFixed(2)})`);
  await page.evaluate(() => window.__xrdev.controllers.left.updateAxes('thumbstick', 1, 0)); await sleep(500);
  await page.evaluate(() => window.__xrdev.controllers.left.updateAxes('thumbstick', 0, 0)); await sleep(100);
  const p2 = await page.evaluate(() => window.__dev.t);
  check(p2 - p1 > .8, `left stick scrubs while paused (${p1.toFixed(2)} → ${p2.toFixed(2)})`);
  await press('right', 'b-button');
  const p3 = await page.evaluate(() => window.__dev.t); await sleep(300);
  check(await page.evaluate(() => window.__dev.t) > p3, 'B plays again');
  await press('right', 'a-button');
  check(await page.evaluate(() => window.__dev.xr.tour), 'A turns the tour on');
  await press('right', 'a-button');
  const yaw0 = await page.evaluate(() => window.__dev.scene.getObjectByName('xr').children[0].rotation.y);
  await page.evaluate(() => window.__xrdev.controllers.right.updateAxes('thumbstick', 1, 0)); await sleep(200);
  await page.evaluate(() => window.__xrdev.controllers.right.updateAxes('thumbstick', 0, 0)); await sleep(150);
  const yaw1 = await page.evaluate(() => window.__dev.scene.getObjectByName('xr').children[0].rotation.y);
  check(Math.abs(Math.abs(yaw1 - yaw0) - Math.PI / 6) < 1e-6, `right stick snap-turns 30° (${(yaw0 * 57.3).toFixed(0)}° → ${(yaw1 * 57.3).toFixed(0)}°)`);
  const song0 = await page.evaluate(() => document.getElementById('song').value);
  await press('left', 'y-button'); await sleep(800);
  const s1 = await page.evaluate(() => ({ song: document.getElementById('song').value, ...window.__dev.xr.info() }));
  check(s1.song !== song0 && s1.presenting && s1.anchors.length > 0, `Y → next song in the headset (${song0} → ${s1.song}, ${s1.anchors.length} pads)`);
}
if (A.tour){
  await page.evaluate(() => { window.__dev.xr.tour = true; });
  await sleep(+(A.tour) * 1000 || 4000);
  const s = await page.evaluate(() => window.__dev.xr.info());
  check(s.tour, `tour on · at pad ${s.cur} (${s.anchors[s.cur]?.key})`);
}
const frame = async (out, t) => {
  await page.evaluate((rate, t) => { if (rate !== undefined) window.__dev.rate = +rate; if (t !== undefined) window.__dev.t = +t; }, A.rate, t);
  await sleep(+(A.wait || 1200));
  if (out) await page.screenshot({ path: out });
};
const out = A.out;
if (A.frames){ const ts = A.frames.split(','); for (let i = 0; i < ts.length; i++) await frame(out && out.replace(/\.png$/, `-${i}.png`), ts[i]); }
else await frame(out, A.t);
const info = await page.evaluate(n => window.__dev.renderInfo(n), +(A.info || 20));
const end = await page.evaluate(() => ({ ...window.__dev.xr.info(), t: window.__dev.t }));
check(end.presenting, 'still presenting after the shots');
console.log('renderInfo (XR, per frame, both eyes):', JSON.stringify(info));
console.log(JSON.stringify({ cur: end.cur, key: end.anchors[end.cur]?.key, head: end.head, dolly: end.dolly, t: +end.t.toFixed(2) }));
await page.evaluate(() => window.__dev.xr.exit());
await sleep(400);
const back = await page.evaluate(() => ({ presenting: window.__dev.xr.info().presenting, fov: window.__dev.camera.fov, w: window.__dev.renderer.domElement.width }));
check(!back.presenting && back.w > 0, `exit → back to 2D (fov ${back.fov.toFixed(1)}, canvas ${back.w}px)`);
const bad = errs.filter(e => !/GPU stall|WebGL-|Automatic fallback/i.test(e));
console.log(bad.length ? bad.join('\n') : '(no console errors/warnings)');
await browser.close();
process.exit(fail || bad.some(e => /error/i.test(e)) ? 1 : 0);
