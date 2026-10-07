#!/usr/bin/env node
/* Compare two same-size PNGs (no image libs in the repo — decodes in headless Chrome):
     node scripts/imgdiff.mjs a.png b.png
   prints {meanAbs (0..255 per channel), changed (fraction of pixels with any channel off by > 24)}.
   Used to prove a change leaves the 2D render alone (two runs of the same frame differ by a few
   sparks / sub-pixel AA; a real regression moves whole regions). */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const [a, b, outDiff] = process.argv.slice(2);   // optional 3rd arg: write a diff heat-map PNG
const exe = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
const browser = await puppeteer.launch({ executablePath: exe, headless: 'new' });
const page = await browser.newPage();
const url = f => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');
const out = await page.evaluate(async (ua, ub) => {
  const load = u => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = u; });
  const [ia, ib] = await Promise.all([load(ua), load(ub)]);
  const px = i => { const c = document.createElement('canvas'); c.width = i.width; c.height = i.height;
    const x = c.getContext('2d'); x.drawImage(i, 0, 0); return x.getImageData(0, 0, i.width, i.height).data; };
  if (ia.width !== ib.width || ia.height !== ib.height) return { error: 'size mismatch' };
  const A = px(ia), B = px(ib); let sum = 0, changed = 0;
  const c = document.createElement('canvas'); c.width = ia.width; c.height = ia.height;
  const x = c.getContext('2d'), D = x.createImageData(ia.width, ia.height);
  for (let k = 0; k < A.length; k += 4){
    let m = 0;
    for (let ch = 0; ch < 3; ch++){ const d = Math.abs(A[k + ch] - B[k + ch]); sum += d; if (d > m) m = d; }
    if (m > 24) changed++;
    D.data[k] = Math.min(255, m * 4); D.data[k + 1] = A[k + 1] >> 2; D.data[k + 2] = A[k + 2] >> 2; D.data[k + 3] = 255;
  }
  x.putImageData(D, 0, 0);
  return { meanAbs: +(sum / (A.length / 4 * 3)).toFixed(3), changed: +(changed / (A.length / 4)).toFixed(5), png: c.toDataURL('image/png') };
}, url(a), url(b));
if (outDiff && out.png) fs.writeFileSync(outDiff, Buffer.from(out.png.split(',')[1], 'base64'));
delete out.png;
console.log(JSON.stringify(out));
await browser.close();
