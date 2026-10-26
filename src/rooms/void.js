import * as THREE from 'three';
import { STAGE, rng, canvasTex, radialTex, glowPoints, trs } from './common.js';
import { FOOT } from './footing.js';
import { makePulse } from './pulse.js';
import { voidIslands, skyRocks } from './void-isles.js';
import { voidFootingStyle, makeVoidMats, makeRuneMat, GLOW_I } from './void-footing.js';
import { islandGeometry, runeGeometry, litOf, crystalGeometry, skyBoxes, makeCrystalMat, makeKeelBeamMat, fillCrystals, axesOf, resample, keelDepth, GROUND } from './void-ground.js';
/* ============================================================
   THE VOID — no room at all: an infinite starfield + nebula with a ringed planet low on the
   horizon, a neon horizon grid far below drifting toward you — and the machines' GROUND torn
   out of somewhere and set adrift: every machine stands on an ISLAND of dressed stone at the
   stage floor (the floor contract: STAGE.FLOOR is the island's top), its fascia carved with
   runes, rough rock tapering under it to a keel, a pillar of light falling from the keel into
   the haze — so nothing just hovers.

   Built for its machines (rooms/footing.js plans what each one stands on; this room dresses it):
     · the islands come from `place(anchors, plan)` — voidIslands (void-isles.js, pure + tested):
       a machine's footprint, a loft's shared deck, every stair and ladder, and the organ's columns
       (a hung machine whose own supports reach the floor) all stand on an island; a chandelier
       that never reaches the floor hangs from a SKY ROCK (skyRocks): an island turned over, its
       soffit where the rods end
     · what stands on an island is cut from it (void-footing.js — the room's footing STYLE): a dais
       of its stone; a terrace of its rock; a rock pillar; a stack of levitating stones; a floating
       ridge for a loft; rock columns under an open stand's feet; stepping stones, carved steps or
       a ladder of light to climb them
     · the room ANSWERS its machines: the runes round an island's rim are lit by the nearest machine
       on it, and the crystals hovering off its stretch of rim breathe and lift on its strikes
       (rooms/pulse.js over each anchor's cue: pure fns of songTime, dark in the count-in). The
       background (grid, clouds, pillars, motes) stays quiet.
   Rooms own no lights. Per frame: uniforms only.
   ============================================================ */

const FOG = 0x0a0822;
const GRID_Y = -220;               // the horizon grid, far below the islands
const MAX_PLINTHS = 16;
const DECKS = [[-40, .9, 0x6a58c8, .9], [-68, 1, 0x3a2c88, 1.3]];
const DECK_W = 360;               // deck size: its faded rim stays inside camera.far (200) from the stage   // two cloud decks: [y, opacity, tint, tex repeat] — island / cloud / cloud / grid depth layers
const PILLAR = 70;                // a light pillar's length under its island's keel
const PILLAR_W = [3.2, 2.4];      // its widest (along / across the keel), in its unit-radius scale

export { voidIslands };

/* a machine's afterglow: .45 s, shorter for a busy one (half its mean gap, ≥ .2 s) — the kit's runes breathe
   with its groove instead of sitting lit */
export const decayOf = a => { const n = a.cue?.length || 0; return n && a.P > 0 ? Math.min(.45, Math.max(.2, .5 * a.P / n)) : .45; };


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
/* (one pass for the see-through DoubleSide flats — grid, cloud decks, keel beams — comes from the host:
   rooms/index.js runs perftune singlePassFlats on a room before its prewarm compiles it) */

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

    // ---- two cloud decks between the islands and the grid: NORMAL-blended, so they occlude
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

    // ---- the GROUND: the room's materials, worn by the islands AND by what stands on them ----
    const M = makeVoidMats({ envMap, floor: F, ceil: STAGE.CEIL });
    const footing = voidFootingStyle(M);                                 // (rooms/footing3d.js builds it from the plan)
    const U = new Float32Array(FOOT.MAX_PULSE);                          // the room's own answer: one slot per lit machine
    const runeMat = makeRuneMat({ base: .18, gain: 1.75 }); runeMat.uniforms.uPulse.value = U;   // (dim at rest, so a strike's step reads from the wide)
    const crystalMat = makeCrystalMat(U); crystalMat.uniforms.uLift.value = .38;
    const mesh = (mat, name, order = 0) => { const m = new THREE.Mesh(new THREE.BufferGeometry(), mat); m.name = name; m.frustumCulled = false; m.renderOrder = order; m.matrixAutoUpdate = false; group.add(m); return m; };
    const isl = { stone: mesh(M.stone, 'void:island-stone'), rock: mesh(M.rock, 'void:island-rock'), runes: mesh(runeMat, 'void:runes', 2), crystals: mesh(crystalMat, 'void:crystals') };
    const pillar = new THREE.InstancedMesh(new THREE.CylinderGeometry(.34, .5, 1, 28, 1, true).translate(0, -.5, 0),
      makeKeelBeamMat({ gain: .42, falloff: 2.2, edge: 1.4, fadeIn: .08 }), MAX_PLINTHS);
    const halo = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: radialTex(), transparent: true, opacity: .3, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }), MAX_PLINTHS);
    const _c = new THREE.Color(), SHARED = new THREE.Color(0x5fd8ff);
    /* everything this room will ever draw is in the group from the start, as it will be drawn — so the
       host's idle prewarm compiles the very programs the first frame here uses (a swap never stalls on a
       compile): the instance colours exist before place() fills them (they change the program), and
       the footing's own materials stand in on two empty meshes */
    for (const im of [pillar, halo]){ im.setColorAt(0, _c.set(0xffffff)); im.count = 0; im.frustumCulled = false; group.add(im); }
    /* (once drawn — the program is compiled and cached on its material — a stand-in steps out: three binds
       a program and uploads its uniforms even for an empty draw, every frame, twice in XR) */
    for (const m of [mesh(M.glow, 'void:warm-glow'), mesh(M.haze, 'void:warm-haze'), mesh(M.rune, 'void:warm-rune', 2)]) m.onAfterRender = () => { m.visible = false; };
    let pulses = [];

    /* place(anchors, plan): the islands (voidIslands), their bodies, runes and crystals — a pure fn of
       the anchors + the footing plan, rebuilt only when they change */
    function place(anchors, plan = null){
      const isles = voidIslands(anchors, plan), sky = skyRocks(anchors, { ceil: STAGE.CEIL, floor: F }), all = isles.concat(sky), lit = litOf(anchors, all);
      const { stone, rock, glints } = islandGeometry(all, { floor: F });
      const swap = (m, g) => { m.geometry.dispose(); m.geometry = g; };
      swap(isl.stone, stone); swap(isl.rock, rock);
      /* the shot solve's solids (shotrig roomSolids): the islands lie at the floor (nothing to stand in
         the way), a sky rock is its own box — never the merged mesh's floor-to-ceiling bounds */
      isl.stone.userData.boxes = isl.rock.userData.boxes = skyBoxes(sky, F);
      swap(isl.runes, runeGeometry(all, anchors, lit, { floor: F }).geometry);
      const cg = crystalGeometry(); fillCrystals(cg, isles, anchors, plan, lit, glints); swap(isl.crystals, cg);
      pulses = lit.map(a => makePulse(a.cue, { ...a, decay: decayOf(a) })); U.fill(0);
      // a pillar of light under every island's keel (its colour: its one machine's, or the shared cyan)
      let n = 0;
      isles.forEach(I => {
        if (n >= MAX_PLINTHS || I.hull.length < 3) return;
        const P = resample(I.hull, GROUND.SEG), { a, ea, eb } = axesOf(P, I.cx, I.cz), D = keelDepth(eb);
        const one = I.slots.length === 1 ? lit[I.slots[0]] : null;
        _c.copy(one ? _c.set(one.color ?? '#5fd8ff') : SHARED);
        /* a beam, not a slab: its width capped (a long keel's pillar is no wider than a small one's ×~2),
           dimmer the more it was cut — the luminous area under the archipelago stays about even */
        const sx = Math.max(.8, ea * .7), sz = Math.max(.8, eb * 1.05), cx = Math.min(sx, PILLAR_W[0]), cz = Math.min(sz, PILLAR_W[1]);
        _c.multiplyScalar(Math.max(.55, Math.sqrt(cx * cz / (sx * sz))));
        const top = F - .003 * ((I.group ?? 0) % 4) - GROUND.FASC - GROUND.LEDGE_DY - .6 * D;   // (inside the rock, faded in: no rim shows)
        pillar.setMatrixAt(n, trs(I.cx, top, I.cz, 0, -Math.atan2(a[1], a[0]), 0, cx, PILLAR, cz));
        pillar.setColorAt(n, _c); n++;
      });
      pillar.count = n;
      // a soft pool of each machine's colour on the stone round it
      const ms = lit.filter(a => a.kind !== 'hung').slice(0, MAX_PLINTHS);
      ms.forEach((a, i) => {
        _c.set(a.color ?? '#5fd8ff').multiplyScalar(.4);
        halo.setMatrixAt(i, trs(a.x, F + .06 + .002 * i, a.z, 0, a.yaw || 0, 0, a.w * 1.2, 1, a.d * 1.2));
        halo.setColorAt(i, _c);
      });
      halo.count = ms.length;
      for (const im of [pillar, halo]){ im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
    }

    const pillarBase = pillar.material.uniforms.uGain.value;
    const gu = grid.material.uniforms, cu = crystalMat.uniforms;
    return {
      group, ...STAGE, HW: 200, BACK: -200, FRONT: 200, CEIL: 200,
      fog: new THREE.FogExp2(FOG, .016), background: sky,
      mood: { ambient: [0x1a1840, 1.5], hemi: [0x7a6ad8, 0x0a1838, .55] },
      place, footing,
      update(dt, songTime, camera, energy = 0){
        gu.uTime.value = songTime; gu.uCam.value.copy(camera.position);
        grid.position.x = Math.round(camera.position.x / CELL) * CELL;
        grid.position.z = Math.round(camera.position.z / CELL) * CELL;
        for (const dk of decks){                                 // follow the camera, texture world-locked + slow drift
          dk.m.position.x = camera.position.x; dk.m.position.z = camera.position.z;
          dk.t.offset.set(camera.position.x / dk.k + songTime * dk.sx, -camera.position.z / dk.k - songTime * dk.sz);
        }
        gu.uGain.value = 1 + .4 * energy;
        motes.material.uniforms.uTime.value = songTime;
        pillar.material.uniforms.uGain.value = pillarBase * (1 + .06 * Math.sin(songTime * 1.3) + .25 * energy);
        // the room answers its machines: each one's runes + crystals (pure fns of songTime)
        for (let i = 0; i < pulses.length; i++){ const v = pulses[i].at(songTime) + .35 * pulses[i].next(songTime); U[i] = v > 1 ? 1 : v; }
        cu.uTime.value = songTime;
        M.glow.emissiveIntensity = GLOW_I * (1 + .1 * Math.sin(songTime * .7));   // the stone's crystal veins breathe, slowly
      },
      dispose(){
        sky.dispose(); cloud.dispose(); edge.dispose(); decks.forEach(dk => dk.t.dispose());
        for (const m of Object.values(isl)) m.geometry.dispose();
        M.dispose(); runeMat.dispose(); crystalMat.dispose();
      },
    };
  },
};
