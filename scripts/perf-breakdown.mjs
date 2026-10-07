#!/usr/bin/env node
/* PERF BREAKDOWN — what each machine costs the frame: drawn objects per owner (station / belt / kit /
   room), how many are transparent / additive / sprites / instanced / still 2-pass, distinct materials.
     node scripts/perf-breakdown.mjs http://localhost:5180 finale,forge [phone]
   (stage shot at songTime 12; also prints renderInfo for the frame) */
import puppeteer from 'puppeteer-core';
const [url, songs] = [process.argv[2], process.argv[3].split(',')];
const phone = process.argv[4] === 'phone';
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'], defaultViewport: phone ? { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true } : { width: 1440, height: 900 } });
const p = await b.newPage();
await p.goto(url + '/?debug&gov=0', { waitUntil: 'networkidle0' });
await p.waitForFunction(() => window.__dev?.renderer);
for (const k of songs){
  await p.evaluate(k => { __dev.song(k); __dev.t = 12; __dev.cam('stage'); }, k);
  await new Promise(r => setTimeout(r, 2500));
  const out = await p.evaluate(() => {
    const D = __dev, world = D.world, scene = D.scene, cam = D.camera, T = D.three;
    const fr = new T.Frustum().setFromProjectionMatrix(new T.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    const own = o => { let p = o; while (p.parent && p.parent !== world && p.parent !== scene) p = p.parent; return (p.parent === world ? '' : 'scene:') + (p.name || p.type); };
    const by = {};
    scene.traverseVisible(o => {
      if (!(o.isMesh || o.isSprite || o.isPoints || o.isLine)) return;
      const mats = [].concat(o.material); if (mats.every(m => !m.visible)) return;
      if (o.frustumCulled && !o.isSprite && o.geometry && !fr.intersectsObject(o)) return;
      const k = own(o); const e = by[k] ||= { n: 0, add: 0, tr: 0, inst: 0, sprite: 0, dbl: 0, shadow: 0, mats: new Set(), names: {} };
      e.n++; if (mats.some(m => m.blending === T.AdditiveBlending)) e.add++; if (mats.some(m => m.transparent)) e.tr++;
      if (o.isInstancedMesh) e.inst++; if (o.isSprite) e.sprite++; if (mats.some(m => m.side === T.DoubleSide && m.transparent && !m.forceSinglePass)) e.dbl++;
      if (o.castShadow) e.shadow++; mats.forEach(m => e.mats.add(m.uuid));
      const g = (o.geometry?.type || o.type); e.names[g] = (e.names[g] || 0) + 1;
    });
    const r = Object.entries(by).map(([k, e]) => [k, e.n, e.tr, e.add, e.sprite, e.inst, e.dbl, e.mats.size, e.shadow, Object.entries(e.names).sort((a, b) => b[1] - a[1]).slice(0, 5).map(x => x.join(':')).join(' ')]).sort((a, b) => b[1] - a[1]);
    return { room: D.room(), shadowMap: D.renderer.shadowMap.enabled, rows: r };
  });
  const info = await p.evaluate(() => __dev.renderInfo(10));
  console.log('==', k, 'room', out.room, 'shadows', out.shadowMap, JSON.stringify(info), '  [owner, drawn, transparent, additive, sprites, instanced, 2pass, mats, castShadow, geo types]');
  out.rows.forEach(r => console.log('  ', JSON.stringify(r)));
}
await b.close();
