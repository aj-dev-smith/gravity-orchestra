import * as THREE from 'three';
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
const GRID_Y = -95;               // the horizon grid, far below the plinths
const MAX_PLINTHS = 16;
const DECK_Y = -58;               // the cloud deck the light pillars sink into
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
    for (let i = 0; i < 160; i++){
      const cx = R() * w, cy = R() * w, r = 20 + R() * 80, a = .05 + R() * .1;
      for (const ox of [-w, 0, w]) for (const oy of [-w, 0, w]){
        const g = x.createRadialGradient(cx + ox, cy + oy, 0, cx + ox, cy + oy, r);
        g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = g; x.fillRect(cx + ox - r, cy + oy - r, 2 * r, 2 * r);
      }
    }
  }, { srgb: false });
}

/* the neon horizon grid: anti-aliased lines, scrolling, fading with distance. Fog-free. */
function gridMat(){
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uGain: { value: 1 } },
    vertexShader: /* glsl */`
      varying vec3 vW;
      void main(){ vW = (modelMatrix * vec4(position, 1.)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.); }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uGain; uniform vec3 uCam; varying vec3 vW;
      float line(float v, float wdt){ float d = abs(fract(v - .5) - .5); float fw = fwidth(v); return 1. - smoothstep(wdt * fw, (wdt + 1.5) * fw, d); }
      void main(){
        vec2 p = vW.xz / 10.; p.y -= uTime * .25;               // drift toward the audience
        float L = max(line(p.x, .25), line(p.y, .25));
        float L2 = max(line(p.x * 5., .3), line(p.y * 5., .3)) * .18;
        float dist = length(vW.xz - uCam.xz);
        float fade = (1. - smoothstep(120., 195., dist)) * (.15 + .85 * smoothstep(50., 150., dist));   // dim right below (it's FAR), glow toward the horizon
        vec3 near = vec3(.25, .85, 1.), far = vec3(1., .25, .8);
        vec3 c = mix(near, far, smoothstep(20., 160., dist));
        float a = (L + L2) * fade * uGain;
        float glow = exp(-dist * .012) * .08;                   // a faint wash under the stage
        gl_FragColor = vec4(c * a * .42 + vec3(.25, .2, .7) * glow, 1.);
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
    const grid = new THREE.Mesh(new THREE.PlaneGeometry(420, 420), gridMat());
    grid.rotation.x = -Math.PI / 2; grid.position.y = GRID_Y; grid.frustumCulled = false;
    group.add(grid);

    // ---- a thin cloud deck between the plinths and the grid: sells the drop (depth cue) ----
    const deckTex = cloudTex(); deckTex.wrapS = deckTex.wrapT = THREE.RepeatWrapping; deckTex.repeat.set(3, 3);
    const deck = new THREE.Mesh(new THREE.PlaneGeometry(420, 420).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: deckTex, color: 0x7a5ad8, transparent: true, opacity: .9, depthWrite: false,
        blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide }));
    deck.position.y = DECK_Y; deck.frustumCulled = false; group.add(deck);

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

    // ---- plinths + light pillars (instanced, capacity MAX_PLINTHS; filled by place()) ----
    const slabMat = new THREE.MeshStandardMaterial({ color: 0x14152a, metalness: .85, roughness: .22, envMap, envMapIntensity: 1.1 });
    const rimMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const slab = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), slabMat, MAX_PLINTHS);
    const rim = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), rimMat, MAX_PLINTHS);
    const keel = new THREE.InstancedMesh(new THREE.CylinderGeometry(.5, .08, 1, 6).translate(0, -.5, 0), slabMat, MAX_PLINTHS);   // a tapered underside
    const pillar = new THREE.InstancedMesh(new THREE.CylinderGeometry(.5, .5, 1, 28, 1, true).translate(0, -.5, 0),
      beamMat({ gain: .42, falloff: 2.2, edge: 1.4 }), MAX_PLINTHS);
    const halo = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: radialTex(), transparent: true, opacity: .55, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }), MAX_PLINTHS);
    for (const im of [slab, rim, keel, pillar, halo]){ im.count = 0; im.frustumCulled = false; group.add(im); }
    const PAL = [0x5fd8ff, 0xb57bff, 0xff7ac8, 0x7affc8, 0xffb36a];

    function place(anchors){
      const list = anchors.slice(0, MAX_PLINTHS);
      list.forEach((a, i) => {
        const w = a.w + 2, d = a.d + 2, yaw = a.yaw || 0;
        const c = new THREE.Color(PAL[i % PAL.length]);
        slab.setMatrixAt(i, trs(a.x, F - .9, a.z, 0, yaw, 0, w, 1.8, d));
        rim.setMatrixAt(i, trs(a.x, F - .25, a.z, 0, yaw, 0, w + .25, .22, d + .25));
        rim.setColorAt(i, c.clone().multiplyScalar(2.6));
        keel.setMatrixAt(i, trs(a.x, F - 1.8, a.z, 0, yaw, 0, w * .9, 9, d * .9));
        pillar.setMatrixAt(i, trs(a.x, F - 1.8, a.z, 0, yaw, 0, w * .62, PILLAR, d * .62));
        pillar.setColorAt(i, c);
        halo.setMatrixAt(i, trs(a.x, F + .06, a.z, 0, yaw, 0, w * 1.5, 1, d * 1.5));
        halo.setColorAt(i, c.clone().multiplyScalar(.5));
      });
      for (const im of [slab, rim, keel, pillar, halo]){
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
        grid.position.x = Math.round(camera.position.x / 10) * 10;
        grid.position.z = Math.round(camera.position.z / 10) * 10;
        deck.position.x = camera.position.x; deck.position.z = camera.position.z;
        deckTex.offset.set(camera.position.x / 140 + songTime * .002, -camera.position.z / 140 - songTime * .003);   // world-locked + slow drift
        gu.uGain.value = 1 + .6 * energy;
        motes.material.uniforms.uTime.value = songTime;
        pillar.material.uniforms.uGain.value = pillarBase * (1 + .08 * Math.sin(songTime * 1.3) + .5 * energy);
      },
      dispose(){},
    };
  },
};
