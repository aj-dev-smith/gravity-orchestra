/* ============================================================
   A FAKE DOM, just enough for a room to BUILD under Vitest's node environment (no jsdom, no
   native canvas — no new dependency): rooms paint their textures on a 2D canvas at build time
   (rooms/common.js canvasTex, the footing kits' grain), the studio sizes its mirror from
   innerWidth, and the room host (rooms/index.js) appends a label + a ROOM button to the body.

   installFakeDom() is a no-op where a real `document` exists. The 2D context records nothing and
   draws nothing: every method is a no-op, gradients / patterns take colour stops, getImageData
   hands back zeroed pixels of the asked size, measureText a monospace estimate. So a texture
   built here is a blank canvas — the contract checks STRUCTURE (what is built, drawn, freed,
   animated), never pixels; look at pixels with `npm run dev` / scripts/shot.mjs.
   ============================================================ */

function ctx2d(canvas){
  const grad = () => ({ addColorStop(){} });
  const img = (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(1, w * h * 4)) });
  const base = {
    canvas, globalAlpha: 1, globalCompositeOperation: 'source-over', fillStyle: '#000', strokeStyle: '#000',
    lineWidth: 1, font: '10px monospace', textAlign: 'start', textBaseline: 'alphabetic', filter: 'none',
    shadowBlur: 0, shadowColor: 'transparent', lineCap: 'butt', lineJoin: 'miter', imageSmoothingEnabled: true,
    createLinearGradient: grad, createRadialGradient: grad, createConicGradient: grad, createPattern: () => ({ setTransform(){} }),
    getImageData: (x, y, w, h) => img(w, h), createImageData: (w, h) => typeof w === 'object' ? img(w.width, w.height) : img(w, h),
    measureText: s => ({ width: String(s).length * (parseFloat(/(\d+(\.\d+)?)px/.exec(base.font)?.[1]) || 10) * .6,
      actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }), isPointInPath: () => false, getLineDash: () => [],
  };
  // every other method (fillRect, arc, save, drawImage, putImageData, setTransform, …) is a no-op
  return new Proxy(base, { get: (o, k) => k in o ? o[k] : (typeof k === 'string' ? () => {} : undefined), set: (o, k, v) => { o[k] = v; return true; } });
}

class FakeElement {
  constructor(tag){
    this.tagName = String(tag).toUpperCase(); this.style = {}; this.children = []; this.dataset = {};
    this.textContent = ''; this.title = ''; this.parentNode = null; this.width = 300; this.height = 150;
  }
  getContext(kind){ return kind === '2d' ? (this._2d ||= ctx2d(this)) : null; }
  setAttribute(k, v){ this[`attr:${k}`] = String(v); }
  getAttribute(k){ return this[`attr:${k}`] ?? null; }
  removeAttribute(k){ delete this[`attr:${k}`]; }
  appendChild(c){ this.children.push(c); c.parentNode = this; return c; }
  append(...cs){ cs.forEach(c => this.appendChild(c)); }
  remove(){ const p = this.parentNode; if (p) p.children = p.children.filter(c => c !== this); this.parentNode = null; }
  addEventListener(){} removeEventListener(){}
  getBoundingClientRect(){ return { x: 0, y: 0, left: 0, top: 0, width: this.width, height: this.height, right: this.width, bottom: this.height }; }
  toDataURL(){ return 'data:,'; }
}

/** Install the fake DOM globals (only those missing). → true if anything was installed. */
export function installFakeDom(){
  if (typeof globalThis.document !== 'undefined') return false;
  const body = new FakeElement('body');
  globalThis.document = {
    body, createElement: tag => new FakeElement(tag), createElementNS: (ns, tag) => new FakeElement(tag),
    addEventListener(){}, removeEventListener(){}, getElementById: () => null, querySelector: () => null,
  };
  for (const [k, v] of Object.entries({ innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1 })) if (!(k in globalThis)) globalThis[k] = v;
  return true;
}
