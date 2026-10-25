import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { STAGE, rng, canvasTex, radialTex, glowPoints, beamMat, trs } from './common.js';
/* ============================================================
   THE VOID — no room at all: an infinite starfield + nebula with a
   ringed planet low on the horizon, a neon horizon grid far below
   drifting toward you, and every instrument standing on its OWN lit
   plinth floating at the stage floor (the floor contract: legs still
   land at STAGE.FLOOR — the plinth is the floor). From each plinth a
   pillar of light falls away into the haze, so nothing just hovers.
   The plinths come from `place(anchors)` — the Room's anchor points.
   ============================================================ */

const FOG = 0x0a0822;
const GRID_Y = -220;               // the horizon grid, far below the plinths
const MAX_PLINTHS = 16;
const DECKS = [[-40, .9, 0x6a58c8, .9], [-68, 1, 0x3a2c88, 1.3]];
const DECK_W = 360;               // deck size: its faded rim stays inside camera.far (200) from the stage   // two cloud decks: [y, opacity, tint, tex repeat] — plinth / cloud / cloud / grid depth layers
const PILLAR = 70;                // light-pillar length below each plinth

function skyTex(){
  return canvasTex(2048, 1024, (x, w, h) => {
    const R = rng(77);
    const g = x.createLinearGradient(0, 0, 0, h);             // zenith → horizon → nadir
    g.addColorStop(0, '#02020a'); g.addColorStop(.38, '#07061a'); g.addColorStop(.5, '#1a0f3a');
    g.addColorStop(.56, '#0c0a26'); g.addColorStop(1, '#030310');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.globalCompositeOperation = 'lighter';
    const blob = (cx, cy, rx, ry, col, a) => {                // soft elliptical nebula puff (wraps in x)
      for (const ox of [-w, 0, w]){
        x.save(); x.translate(cx + ox, cy); x.scale(rx / ry, 1);
        const gr = x.createRadialGradient(0, 0, 0, 0, 0, ry);
        gr.addColorStop(0, `rgba(${col},${a})`); gr.addColorStop(1, `rgba(${col},0)`);
        x.fillStyle = gr; x.beginPath(); x.arc(0, 0, ry, 0, Math.PI * 2); x.fill(); x.restore();
      }
    };
    // a nebula river across the sky: magenta / violet / teal puffs along a sine band
    const cols = ['190,60,200', '90,60,220', '40,150,210', '230,90,150', '70,40,160'];
    for (let i = 0; i < 260; i++){
      const u = R(), cx = u * w, cy = h * (.3 + .1 * Math.sin(u * Math.PI * 2 * 1.5) + (R() - .5) * .14);
      blob(cx, cy, 60 + R() * 160, 30 + R() * 70, cols[(R() * cols.length) | 0], .04 + R() * .06);
    }
    for (let i = 0; i < 40; i++) blob(R() * w, h * (.46 + R() * .08), 200 + R() * 300, 20 + R() * 30, '120,70,220', .05);   // horizon glow
    // stars: many faint, a few bright with a soft bloom
    for (let i = 0; i < 6000; i++){
      const sx = R() * w, sy = Math.pow(R(), 1.3) * h * .62, b = R();
      const c = b > .97 ? '255,230,200' : b > .9 ? '190,210,255' : '235,235,255';
      x.fillStyle = `rgba(${c},${.25 + .75 * R() * R()})`;
      const s = b > .985 ? 2.2 : b > .9 ? 1.4 : .9; x.fillRect(sx, sy, s, s);
      if (b > .992) blob(sx, sy, 7, 7, c, .35);
    }
    x.globalCompositeOperation = 'source-over';
    // a ringed planet sitting low on the horizon
    const px = w * .62, py = h * .47, pr = 46;
    const ring = (front) => { x.save(); x.translate(px, py); x.rotate(-.18); x.scale(1, .22);
      x.strokeStyle = 'rgba(220,190,255,.55)'; x.lineWidth = 7;
      x.beginPath(); x.arc(0, 0, pr * 2.1, front ? 0 : Math.PI, front ? Math.PI : Math.PI * 2); x.stroke();
      x.strokeStyle = 'rgba(160,140,230,.35)'; x.lineWidth = 4;
      x.beginPath(); x.arc(0, 0, pr * 2.5, front ? 0 : Math.PI, front ? Math.PI : Math.PI * 2); x.stroke(); x.restore(); };
    ring(false);
    const pg = x.createRadialGradient(px - pr * .4, py - pr * .45, pr * .1, px, py, pr);
    pg.addColorStop(0, '#d7b6ff'); pg.addColorStop(.5, '#6a4fb8'); pg.addColorStop(1, '#140c30');
    x.fillStyle = pg; x.beginPath(); x.arc(px, py, pr, 0, Math.PI * 2); x.fill();
    ring(true);
  });
}

function cloudTex(){                                        // tileable soft fbm-ish puffs, alpha only
  return canvasTex(512, 512, (x, w) => {
    const R = rng(5);
    for (let i = 0; i < 110; i++){                          // soft banks with clear gaps between them
      const cx = R() * w, cy = R() * w, r = 24 + R() * 80, a = .08 + R() * .2;
      for (const ox of [-w, 0, w]) for (const oy of [-w, 0, w]){
        const g = x.createRadialGradient(cx + ox, cy + oy, 0, cx + ox, cy + oy, r);
        g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = g; x.fillRect(cx + ox - r, cy + oy - r, 2 * r, 2 * r);
      }
    }
  }, { srgb: false });
}

/* the neon horizon grid: WORLD-SPACE line widths (so lines thin with distance like real
   perspective — screen-constant lines read as a floor right under you), big 20u cells, faded
   + hazed by true 3D distance from the camera so it glows toward the horizon and sinks into
   atmosphere below. Additive, fog-free (does its own atmospheric perspective). */
const CELL = 60;
function gridMat(){
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uGain: { value: 1 } },
    vertexShader: /* glsl */`
      varying vec3 vW;
      void main(){ vW = (modelMatrix * vec4(position, 1.)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.);
        gl_Position.z = gl_Position.w * .99999; }`,   // pinned to the far plane (the skybox trick): it lies BEYOND camera.far (200), yet never clips
    fragmentShader: /* glsl */`
      uniform float uTime, uGain; uniform vec3 uCam; varying vec3 vW;
      // a line of world half-width hw (in cell units); when a pixel is wider than the line,
      // fade by coverage instead of fattening it → lines genuinely thin into the distance
      float line(float v, float hw){ float d = abs(fract(v - .5) - .5); float fw = max(fwidth(v), 1e-4);
        return (1. - smoothstep(hw - fw * .5, hw + fw * .5, d)) * min(1., hw * 2. / fw); }
      void main(){
        vec2 p = vW.xz / ${CELL.toFixed(1)}; p.y -= uTime * .06;    // drift toward the audience
        float L = max(line(p.x, .012), line(p.y, .012));
        float d3 = length(vW - uCam);                                // true 3D distance (camera is ~100u above)
        float dep = (uCam.y - vW.y) / d3;                            // sin(depression angle) of this texel
        float fade = smoothstep(.012, .05, dep) * (1. - smoothstep(.1, .3, dep));   // a band toward the horizon only: straight down is just void
        float far = 1. - smoothstep(.04, .2, dep);   // faint straight down, glowing at the horizon
        vec3 c = mix(vec3(.25, .7, 1.), vec3(1., .3, .85), far);
        float glow = exp(-length(vW.xz - uCam.xz) * .006) * .05;      // a faint wash far under the stage
        gl_FragColor = vec4(c * L * fade * uGain * .5 + vec3(.25, .2, .7) * glow, 1.);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}

export default {
  key: 'void', label: 'The Void',
  build(scene, { envMap }){
    const group = new THREE.Group();
    const R = rng(21);
    const F = STAGE.FLOOR;
    const sky = skyTex(); sky.mapping = THREE.EquirectangularReflectionMapping;

    // ---- horizon grid (follows the camera in x/z, snapped to the cell so it never swims) ----
    const grid = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), gridMat());
    grid.rotation.x = -Math.PI / 2; grid.position.y = GRID_Y; grid.frustumCulled = false; grid.renderOrder = -3;   // under both cloud decks (they occlude it)
    group.add(grid);

    // ---- two cloud decks between the plinths and the grid: NORMAL-blended, so they occlude
    // the grid (additive clouds only brighten — they can't put anything "in front"). Sells the drop.
    const cloud = cloudTex();
    // radial falloff (green channel → alphaMap, its own untransformed uv): the decks thin out
    // toward their rim, so there's never a hard plane edge on the horizon
    const edge = canvasTex(128, 128, (x, w) => { x.fillStyle = '#000'; x.fillRect(0, 0, w, w);
      const g = x.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
      g.addColorStop(0, '#fff'); g.addColorStop(.35, '#ccc'); g.addColorStop(.85, '#222'); g.addColorStop(1, '#000');
      x.fillStyle = g; x.fillRect(0, 0, w, w); }, { srgb: false });
    const decks = DECKS.map(([y, op, tint, rep], i) => {
      const t = cloud.clone(); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep); t.needsUpdate = true;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(DECK_W, DECK_W).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ map: t, alphaMap: edge, color: tint, transparent: true, opacity: op, depthWrite: false, fog: false, side: THREE.DoubleSide }));
      m.position.y = y; m.frustumCulled = false; m.renderOrder = -1 - i; group.add(m);
      return { m, t, k: DECK_W / rep, sx: .002 * (i ? -1 : 1), sz: .003 };
    });

    // ---- motes: slow sparkles drifting around the stage ----
    const mP = [], mC = [], mS = [], mPh = [];
    for (let i = 0; i < 420; i++){
      const a = R() * Math.PI * 2, r = 12 + R() * 70;
      mP.push(Math.cos(a) * r, -30 + R() * 70, Math.sin(a) * r * .8 - 6);
      const warm = R() < .3; mC.push(warm ? .9 : .45, warm ? .55 : .6, warm ? .4 : 1);
      mS.push(.12 + R() * .25); mPh.push(R());
    }
    const motes = glowPoints(mP, { colors: mC, sizes: mS, phases: mPh, map: radialTex(32, [[0, 1], [.3, .4], [1, 0]]), flicker: .8, rate: 1.7, drift: 1.2 });
    group.add(motes);

    // ---- floating islands: hull-shaped decks (rebuilt per song by place()) + instanced light pillars ----
    const slabMat = new THREE.MeshStandardMaterial({ color: 0x14152a, metalness: .85, roughness: .22, envMap, envMapIntensity: 1.1 });
    const keelMat = new THREE.MeshStandardMaterial({ color: 0x0d0e1c, metalness: .7, roughness: .4, envMap, envMapIntensity: .8 });
    const rimMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    const isl = { slab: new THREE.Mesh(new THREE.BufferGeometry(), slabMat), keel: new THREE.Mesh(new THREE.BufferGeometry(), keelMat),
                  rim: new THREE.Mesh(new THREE.BufferGeometry(), rimMat) };
    for (const m of Object.values(isl)){ m.frustumCulled = false; group.add(m); }
    const pillar = new THREE.InstancedMesh(new THREE.CylinderGeometry(.5, .5, 1, 28, 1, true).translate(0, -.5, 0),
      beamMat({ gain: .42, falloff: 2.2, edge: 1.4 }), MAX_PLINTHS);
    const halo = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: radialTex(), transparent: true, opacity: .3, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }), MAX_PLINTHS);
    for (const im of [pillar, halo]){ im.count = 0; im.frustumCulled = false; group.add(im); }
    const PAL = [0x5fd8ff, 0xb57bff, 0xff7ac8, 0x7affc8, 0xffb36a];

    /* Islands. Anchors whose RAW footprints touch (oriented-rect SAT, small clearance) join one
       cluster; each cluster becomes ONE island shaped to the convex hull of its members' padded
       corners — a clean outline with one rim, never a zig-zag stack of overlapping slabs. A
       freestanding station keeps its own (yawed-rect) island. Pillars + halos stay per anchor. */
    const PAD = 1.2, GAP = .6;                              // island margin round the legs, cluster clearance
    const _c = new THREE.Color();
    const corners = (a, pad) => {
      const yaw = a.yaw || 0, c = Math.cos(yaw), s = Math.sin(yaw), hw = a.w / 2 + pad, hd = a.d / 2 + pad;
      return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => [a.x + c * hw * u + s * hd * v, a.z - s * hw * u + c * hd * v]);
    };
    function touch(A, B){                                   // separating-axis test on two oriented rects
      const pa = corners(A, GAP / 2), pb = corners(B, GAP / 2);
      for (const P of [pa, pb]) for (let i = 0; i < 2; i++){
        const ax = P[i + 1][0] - P[i][0], az = P[i + 1][1] - P[i][1];
        const pr = Q => { let lo = Infinity, hi = -Infinity; for (const q of Q){ const d = q[0] * ax + q[1] * az; lo = Math.min(lo, d); hi = Math.max(hi, d); } return [lo, hi]; };
        const [a0, a1] = pr(pa), [b0, b1] = pr(pb);
        if (a1 < b0 || b1 < a0) return false;
      }
      return true;
    }
    function hull(pts){                                     // monotone chain, CCW in (x, z)
      pts = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
      const lo = [], up = [];
      for (const p of pts){ while (lo.length > 1 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
      for (const p of pts.reverse()){ while (up.length > 1 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
      return lo.slice(0, -1).concat(up.slice(0, -1));
    }
    // extrude a hull (scaled k about its centroid) downward from y=top by `depth`; optional flat colour
    function slabGeo(H, k, top, depth, col){
      const cx = H.reduce((a, p) => a + p[0], 0) / H.length, cz = H.reduce((a, p) => a + p[1], 0) / H.length;
      const sh = new THREE.Shape(H.map(([x, z]) => new THREE.Vector2(cx + (x - cx) * k, cz + (z - cz) * k)));
      const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false, curveSegments: 1 }).rotateX(Math.PI / 2);   // shape y → world z, extrudes down
      g.translate(0, top, 0);
      if (col){ const n = g.attributes.position.count, c = new Float32Array(n * 3);
        for (let i = 0; i < n; i++){ c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; }
        g.setAttribute('color', new THREE.BufferAttribute(c, 3)); }
      return g;
    }
    function place(anchors){
      const list = anchors.filter(a => a.kind !== 'hung').slice(0, MAX_PLINTHS);   // (a hung machine floats: no island)
      const par = list.map((_, i) => i), find = i => par[i] === i ? i : (par[i] = find(par[i]));
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) if (touch(list[i], list[j])) par[find(i)] = find(j);
      const groups = {};
      list.forEach((a, i) => (groups[find(i)] ||= []).push(a));
      const slabs = [], keels = [], rims = [];
      Object.values(groups).forEach((g, gi) => {
        const top = F + .003 * gi;                                   // staggered tops: coplanar islands can never z-fight
        const H = hull(g.flatMap(a => corners(a, PAD))), HR = hull(g.flatMap(a => corners(a, PAD + .14)));
        _c.setHex(g.length > 1 ? 0x5fd8ff : PAL[(gi + 1) % PAL.length]).multiplyScalar(1.8);
        rims.push(slabGeo(HR, 1, top - .14, .22, _c));
        slabs.push(slabGeo(H, 1, top, 1.8));
        keels.push(slabGeo(H, .82, top - 1.8, 2.6), slabGeo(H, .55, top - 4.4, 3.4), slabGeo(H, .25, top - 7.8, 3));   // stepped keel
      });
      for (const [m, gs] of [[isl.slab, slabs], [isl.keel, keels], [isl.rim, rims]]){
        m.geometry.dispose();
        m.geometry = gs.length ? mergeGeometries(gs) : new THREE.BufferGeometry();
        gs.forEach(g => g.dispose());
      }
      list.forEach((a, i) => {
        const yaw = a.yaw || 0, r = Math.min(a.w, a.d);
        _c.setHex(PAL[i % PAL.length]);
        pillar.setMatrixAt(i, trs(a.x, F - 2, a.z, 0, yaw, 0, r * .55, PILLAR, r * .55));
        pillar.setColorAt(i, _c);
        halo.setMatrixAt(i, trs(a.x, F + .06 + .002 * i, a.z, 0, yaw, 0, a.w * 1.2, 1, a.d * 1.2));
        halo.setColorAt(i, _c.multiplyScalar(.45));
      });
      for (const im of [pillar, halo]){
        im.count = list.length; im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
      }
    }

    const pillarBase = pillar.material.uniforms.uGain.value;
    const gu = grid.material.uniforms;
    return {
      group, ...STAGE, HW: 200, BACK: -200, FRONT: 200, CEIL: 200,
      fog: new THREE.FogExp2(FOG, .016), background: sky,
      mood: { ambient: [0x1a1840, 1.5], hemi: [0x7a6ad8, 0x0a1838, .55] },
      place,
      update(dt, songTime, camera, energy = 0){
        gu.uTime.value = songTime; gu.uCam.value.copy(camera.position);
        grid.position.x = Math.round(camera.position.x / CELL) * CELL;
        grid.position.z = Math.round(camera.position.z / CELL) * CELL;
        for (const dk of decks){                                 // follow the camera, texture world-locked + slow drift
          dk.m.position.x = camera.position.x; dk.m.position.z = camera.position.z;
          dk.t.offset.set(camera.position.x / dk.k + songTime * dk.sx, -camera.position.z / dk.k - songTime * dk.sz);
        }
        gu.uGain.value = 1 + .6 * energy;
        motes.material.uniforms.uTime.value = songTime;
        pillar.material.uniforms.uGain.value = pillarBase * (1 + .08 * Math.sin(songTime * 1.3) + .5 * energy);
        rimMat.color.setScalar(1 + .7 * energy);                // island rims pulse with the kick / lead strikes
      },
      dispose(){ sky.dispose(); cloud.dispose(); edge.dispose(); decks.forEach(dk => dk.t.dispose()); },
    };
  },
};
