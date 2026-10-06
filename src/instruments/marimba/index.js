import * as THREE from 'three';
import { eventTimes, makeEdge, ring } from '../clock.js';
import {
  makeLanes, ballAt, kickAt, flexAt, impactSpeed, keyboard, ballR, laneHue, H, DT_MAX, KICK_MAX, NODE,
  MODE_GLSL, PAD_T, PLUNGE, SOL_H, ROD, effectiveStart,
} from './solve.js';
import { marimbaVoice, layerId } from './voice.js';

/* ============================================================
   MARIMBA — the warm mid-register melodic voice.

   A real concert-marimba silhouette: rosewood bars low → high along
   +x (naturals in front, accidentals behind and a touch higher), each
   bar's length on the free-free law (L ∝ f^−½) and its underside arch
   cut, brass resonator tubes hung beneath (quarter wave ∝ 1/f), on a
   tapered frame whose rails follow the bars' NODE LINES — the real
   instrument's cord points, 22.4 % in from each end.

   Played by MARBLES (see solve.js): one small bright marble per played
   bar, dribbling only on that bar's centre. Each bar rests on two node
   SOLENOIDS whose plungers kick through contact to supply what the
   lossy bounce loses; long rests dock on the ELECTROMAGNET gantry
   overhead. A melody becomes a wave of marbles rippling across the
   keyboard; a chord drops a handful at once; a roll buzzes one bar.
   Every bar visibly bends in its first mode on a strike; its resonator
   lights with the note and fades as the note does.

   Constant material / mesh counts after build (instanced parts, one
   Points cloud for every halo + ghost trail). Pure fn of songTime.
   ============================================================ */

const EDGE_W   = .25;
const TRAIL_N  = 10;
const TRAIL_DT = .016;
const GLOW_COIL = new THREE.Color(0xff7a2a);   // the room's amber, for every coil
// the keyboard sits a touch left of the station centre so its treble end clears the
// melody belt wall next door (the footprint is |x| ≤ 6.5; the bass end has the room)
const KB_W = 11.2, KB_X0 = -.35;
const FX0 = -6.32, FX1 = 5.62;                 // frame ends (x)

const voice = id => marimbaVoice(id);

export default {
  key: 'marimba',
  label: 'Marimba',
  wet: false,
  lookHeight: 3.8,
  voice,
  // two baked velocity layers per played note (soft + hard/bright), only the ones used
  voiceIds(part){
    const ids = new Set();
    for (const e of part){ ids.add(layerId(e[1], e[2] ?? 1)); }
    return [...ids];
  },

  make({ envMap, glowTex }){
    let st = null;                    // the built state for the current song

    function build(part, { rollT, beat, P, start }){
      const group = new THREE.Group();
      const events = eventTimes(part, { rollT, beat });
      const lanes = makeLanes(events, P, start);
      start = effectiveStart(events, P, start);          // = every lane's start (no wrapped-tail strikes in the count-in)
      const kb = keyboard(events.map(e => e.note), { width: KB_W, x0: KB_X0 });
      const laneOf = Object.fromEntries(lanes.map(l => [l.note, l]));
      const bars = kb.bars.map(b => ({ ...b, lane: laneOf[b.note] || null,
        col: new THREE.Color().setHSL(laneHue(b.rank), .85, .6) }));
      // notes outside the C→C keyboard can't happen (keyboard covers every note), but be safe
      const played = bars.filter(b => b.lane);

      // ---- materials (a fixed set) ----
      const dark   = new THREE.MeshStandardMaterial({ color: 0x232733, metalness: .7, roughness: .45, envMap });
      const chrome = new THREE.MeshStandardMaterial({ color: 0xd8dde8, metalness: 1, roughness: .16, envMap, envMapIntensity: 1.3 });
      const brassM = new THREE.MeshStandardMaterial({ color: 0xffcc55, metalness: 1, roughness: .14, envMap,
        envMapIntensity: 2.4, side: THREE.DoubleSide });
      brassM.onBeforeCompile = resonatorPatch;
      const capM = new THREE.MeshStandardMaterial({ color: 0xf5c560, metalness: 1, roughness: .2, envMap, envMapIntensity: 2.2 });
      // lacquered honduras rosewood: deep red-brown under a glossy clearcoat that catches the room
      const wood   = new THREE.MeshPhysicalMaterial({ color: 0x9a3410, metalness: 0, roughness: .45, envMap, envMapIntensity: 1.0,
        clearcoat: .6, clearcoatRoughness: .12, emissive: 0x481604, emissiveIntensity: 1 });
      wood.onBeforeCompile = barPatch;
      const coilM  = new THREE.MeshStandardMaterial({ color: 0x3a1c0e, metalness: .6, roughness: .35, envMap });
      coilM.onBeforeCompile = glowPatch;
      const mouthM = new THREE.MeshStandardMaterial({ color: 0x0b0a10, metalness: 0, roughness: 1 });
      mouthM.onBeforeCompile = glowPatch;
      const ballM  = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: .35, roughness: .18, envMap });
      ballM.onBeforeCompile = glowPatch;
      const rubber = new THREE.MeshStandardMaterial({ color: 0x14141a, roughness: .8 });

      // ---- the plinth (deck top at y = 0) ----
      const SX0 = FX0 - .18, SX1 = FX1 + .18, SW = SX1 - SX0, SC = (SX0 + SX1) / 2;
      const slab = new THREE.Mesh(new THREE.BoxGeometry(SW, .3, 7), dark);
      slab.position.set(SC, -.15, 0); group.add(slab);
      // a neon trim round the plinth in the signature rose → cyan
      const trimGeo = new THREE.BoxGeometry(SW + .04, .05, .05);
      const trimM = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true });
      paintGradient(trimGeo, -SW / 2 - .02, SW / 2 + .02);
      for (const z of [-3.5, 3.5]){ const t = new THREE.Mesh(trimGeo, trimM); t.position.set(SC, -.02, z); group.add(t); }

      // ---- BARS (one instanced mesh: arch cut + first-mode flex + grain in the shader) ----
      const barGeo = new THREE.BoxGeometry(1, 1, 1, 1, 2, 32);
      const barMesh = new THREE.InstancedMesh(barGeo, wood, bars.length);
      const aFlex = inst(barGeo, 'aFlex', bars.length, 1);
      const aBG   = inst(barGeo, 'aGlow', bars.length, 1);
      const aBC   = inst(barGeo, 'aCol', bars.length, 3);
      bars.forEach((b, i) => { b.col.toArray(aBC.array, i * 3); aBG.array[i] = .03; });
      group.add(barMesh);

      // ---- RESONATORS (brass tubes + glowing mouths) ----
      const tubeGeo = new THREE.CylinderGeometry(1, 1, 1, 28, 1, true);
      const tubes = new THREE.InstancedMesh(tubeGeo, brassM, bars.length);
      const aRG = inst(tubeGeo, 'aGlow', bars.length, 1), aRC = inst(tubeGeo, 'aCol', bars.length, 3);
      const mouthGeo = new THREE.CircleGeometry(1, 28); mouthGeo.rotateX(-Math.PI / 2);
      const mouths = new THREE.InstancedMesh(mouthGeo, mouthM, bars.length);
      const aMG = inst(mouthGeo, 'aGlow', bars.length, 1), aMC = inst(mouthGeo, 'aCol', bars.length, 3);
      const capGeo = new THREE.CylinderGeometry(1, .92, 1, 28);
      const caps = new THREE.InstancedMesh(capGeo, capM, bars.length);
      const aRP = inst(tubeGeo, 'aPulse', bars.length, 2);   // the note's pressure wave running down the tube
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
      const put = (mesh, i, x, y, z, sx, sy, sz) => { mesh.setMatrixAt(i, m4.compose(v.set(x, y, z), q.identity(), sc.set(sx, sy, sz))); };
      bars.forEach((b, i) => {
        // radius clamped so the tube clears the node solenoids (barrel r .085) at ±dz
        b.tubeR = Math.max(.045, Math.min(kb.slot * .36, b.w * .48, (.5 - NODE) * b.len - .085 - .035));
        b.tubeTop = b.top - b.thick - .32;
        const len = Math.min(b.res, b.tubeTop - .35);
        put(tubes, i, b.x, b.tubeTop - len / 2, b.z, b.tubeR, len, b.tubeR);
        put(mouths, i, b.x, b.tubeTop - .06, b.z, b.tubeR * .94, 1, b.tubeR * .94);
        put(caps, i, b.x, b.tubeTop - len - .03, b.z, b.tubeR * 1.02, .06, b.tubeR * 1.02);
        b.col.toArray(aRC.array, i * 3); b.col.toArray(aMC.array, i * 3);
        aRG.array[i] = .05; aMG.array[i] = .14;
        b.ringT = 1.15 - .62 * b.rank;                   // = the voice's fundamental ring time
      });
      group.add(tubes, mouths, caps);

      // ---- NODE SOLENOIDS: two per bar, at 22.4 % from each end, on the frame rails ----
      const nodes = [];
      bars.forEach((b, i) => {
        const dz = (.5 - NODE) * b.len;
        for (const s of [-1, 1]) nodes.push({ b, i, x: b.x, z: b.z + s * dz, side: s });
      });
      const barrelGeo = new THREE.CylinderGeometry(.075, .085, SOL_H, 14);   // see solve.js: the stack is tested
      const barrels = new THREE.InstancedMesh(barrelGeo, dark, nodes.length);
      const coilGeo = new THREE.CylinderGeometry(.088, .088, SOL_H * .55, 14, 1, true);
      const coils = new THREE.InstancedMesh(coilGeo, coilM, nodes.length);
      const aCG = inst(coilGeo, 'aGlow', nodes.length, 1), aCC = inst(coilGeo, 'aCol', nodes.length, 3);
      const plGeo = new THREE.CylinderGeometry(.035, .035, ROD, 10);
      const plungers = new THREE.InstancedMesh(plGeo, chrome, nodes.length);
      const padGeo = new THREE.CylinderGeometry(.07, .06, PAD_T, 12);
      const pads = new THREE.InstancedMesh(padGeo, rubber, nodes.length);
      nodes.forEach((n, k) => {
        const bot = n.b.top - n.b.thick;                // bar underside at rest
        n.barrelTop = bot - PAD_T - PLUNGE;
        n.railY = n.barrelTop - SOL_H - .05;
        put(barrels, k, n.x, n.barrelTop - SOL_H / 2, n.z, 1, 1, 1);
        put(coils, k, n.x, n.barrelTop - SOL_H * .45, n.z, 1, 1, 1);
        GLOW_COIL.toArray(aCC.array, k * 3);
        n.bot = bot;
      });
      group.add(barrels, coils, plungers, pads);

      // ---- the FRAME: tapered rails along the node lines, end frames, legs, stretchers ----
      const frame = new THREE.Group(); group.add(frame);
      const rails = [];
      for (const natural of [true, false]) for (const side of [-1, 1]){
        const row = nodes.filter(n => n.b.natural === natural && n.side === side).sort((a, b) => a.x - b.x);
        if (!row.length) continue;
        const y = row[0].railY;
        const pts = row.map(n => new THREE.Vector3(n.x, y, n.z));
        pts.unshift(new THREE.Vector3(FX0, y, row[0].z));
        pts.push(new THREE.Vector3(FX1, y, row[row.length - 1].z));
        const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
        const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 120, .06, 8), dark);
        frame.add(tube);
        rails.push({ natural, side, y, z0: row[0].z, z1: row[row.length - 1].z });
      }
      const rod = (a, b, r, mat = dark) => {
        const d = new THREE.Vector3().subVectors(b, a), m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 10), mat);
        m.position.copy(a).addScaledVector(d, .5);
        m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
        frame.add(m); return m;
      };
      for (const end of [-1, 1]){
        const x = end < 0 ? FX0 : FX1;
        const ends = rails.map(r => new THREE.Vector3(x, r.y, end < 0 ? r.z0 : r.z1)).sort((a, b) => a.z - b.z);
        for (const p of ends){
          rod(new THREE.Vector3(p.x, 0, p.z), p, .07);                                  // leg
          const foot = new THREE.Mesh(new THREE.CylinderGeometry(.14, .17, .08, 14), rubber);
          foot.position.set(p.x, .04, p.z); frame.add(foot);
        }
        for (let k = 1; k < ends.length; k++){
          rod(ends[k - 1], ends[k], .05);                                               // end crossbar at rail height
          rod(new THREE.Vector3(x, .55, ends[k - 1].z), new THREE.Vector3(x, .55, ends[k].z), .045);   // low stretcher
        }
      }
      // long low stretchers along x (front + back) — the frame's spine
      const fr = rails.find(r => r.natural && r.side === 1), br = rails.find(r => !r.natural && r.side === -1) || rails[0];
      if (fr) rod(new THREE.Vector3(FX0, .55, fr.z0), new THREE.Vector3(FX1, .55, fr.z1), .045);
      if (br) rod(new THREE.Vector3(FX0, .55, br.z0), new THREE.Vector3(FX1, .55, br.z1), .045);

      // ---- the MAGNET GANTRY: one beam over each row, portal towers at the ends ----
      const magFaceY = b => b.top + H + 2 * ballR(b.rank);
      const rows = [true, false].map(natural => {
        const rb = bars.filter(b => b.natural === natural);
        const z = rb[0].z;
        const beamY = Math.max(...rb.map(magFaceY)) + .75;
        return { natural, z, beamY };
      });
      const beamTop = Math.max(...rows.map(r => r.beamY));
      for (const r of rows){
        rod(new THREE.Vector3(FX0, r.beamY, r.z), new THREE.Vector3(FX1, r.beamY, r.z), .085, chrome);
        rod(new THREE.Vector3(FX0, r.beamY - .26, r.z), new THREE.Vector3(FX1, r.beamY - .26, r.z), .04);
        for (const x of [FX0, FX1]) rod(new THREE.Vector3(x, 0, r.z), new THREE.Vector3(x, r.beamY + .05, r.z), .1);
      }
      // a neon strip under each gantry beam (the signature gradient — reads from across the room)
      const stripGeo = new THREE.BoxGeometry(FX1 - FX0, .035, .035);
      paintGradient(stripGeo, -(FX1 - FX0) / 2, (FX1 - FX0) / 2);
      for (const r of rows){ const t = new THREE.Mesh(stripGeo, trimM); t.position.set((FX0 + FX1) / 2, r.beamY - .1, r.z + .1); frame.add(t); }
      for (const x of [FX0, FX1])
        rod(new THREE.Vector3(x, beamTop, rows[0].z), new THREE.Vector3(x, beamTop, rows[1].z), .07, chrome);

      const magGeo = new THREE.CylinderGeometry(1, 1, 1, 20);
      const mags = new THREE.InstancedMesh(magGeo, chrome, Math.max(1, played.length));
      const mcoilGeo = new THREE.TorusGeometry(1, .22, 8, 24); mcoilGeo.rotateX(Math.PI / 2);
      const mcoils = new THREE.InstancedMesh(mcoilGeo, coilM, Math.max(1, played.length));
      const aMcG = inst(mcoilGeo, 'aGlow', Math.max(1, played.length), 1), aMcC = inst(mcoilGeo, 'aCol', Math.max(1, played.length), 3);
      const dropGeo = new THREE.CylinderGeometry(.03, .03, 1, 8);
      const drops = new THREE.InstancedMesh(dropGeo, chrome, Math.max(1, played.length));
      mags.count = mcoils.count = drops.count = played.length;
      played.forEach((b, k) => {
        const r = ballR(b.rank), mr = Math.max(.13, r * 1.25), face = magFaceY(b);
        const row = rows.find(rr => rr.natural === b.natural);
        b.magK = k; b.magR = mr; b.magFace = face;
        put(mags, k, b.x, face + .2, b.z, mr, .4, mr);
        put(mcoils, k, b.x, face + .04, b.z, mr * .95, mr * .95, mr * .95);
        const y0 = face + .4, y1 = row.beamY - .26;
        put(drops, k, b.x, (y0 + y1) / 2, b.z, 1, y1 - y0, 1);
        GLOW_COIL.toArray(aMcC.array, k * 3);
      });
      group.add(mags, mcoils, drops);

      // ---- the MARBLES ----
      const ballGeo = new THREE.SphereGeometry(1, 24, 16);
      const balls = new THREE.InstancedMesh(ballGeo, ballM, Math.max(1, played.length));
      balls.count = played.length;
      const aBallG = inst(ballGeo, 'aGlow', Math.max(1, played.length), 1), aBallC = inst(ballGeo, 'aCol', Math.max(1, played.length), 3);
      played.forEach((b, k) => b.col.toArray(aBallC.array, k * 3));
      group.add(balls);

      // ---- one Points cloud: per lane a ball halo + TRAIL_N ghosts + a contact flare + a magnet halo ----
      const per = TRAIL_N + 3, NP = Math.max(1, played.length * per);
      const halo = makeHaloCloud(NP, glowTex);
      played.forEach((b, k) => { for (let j = 0; j < per; j++) b.col.toArray(halo.col.array, (k * per + j) * 3); });
      for (const b of played) GLOW_COIL.toArray(halo.col.array, (b.magK * per + per - 1) * 3);
      halo.col.needsUpdate = true;
      group.add(halo.points);

      for (const b of played){ b.edge = makeEdge(EDGE_W); b.r = ballR(b.rank); }
      for (const m of [barMesh, tubes, mouths, caps, barrels, coils, plungers, pads, mags, mcoils, drops, balls])
        m.frustumCulled = false;
      st = { bars, played, nodes, start, barMesh, aFlex, aBG, aRG, aMG, aRP, plungers, pads, aCG,
             balls, aBallG, aMcG, halo, per, put, tubes };
      paint(start, false);                               // the ARMED pose from the first frame
      return group;
    }

    /* Render the machine at time t. live = playing (fire strikes / show motion). */
    function paint(t, live, onStrike, skip){
      const { bars, played, nodes, start, barMesh, aFlex, aBG, aRG, aMG, aRP, plungers, pads, aCG,
              balls, aBallG, aMcG, halo, per, put, tubes } = st;
      const half = DT_MAX / 2;
      for (const b of bars){ b.off = 0; b.flex = 0; b.since = Infinity; b.vel = 0; }
      for (const b of played){
        const L = b.lane.L;
        const d = ballAt(L, t, start);
        b.d = d;
        b.off = live ? kickAt(L, t, start) : 0;
        b.flex = live ? flexAt(L, t, start, d) : 0;
        b.since = d.i < 0 ? Infinity : d.since;
        b.vel = d.i < 0 ? 0 : b.lane.vel[d.i];
        b.vHit = impactSpeed(L, d, t, start);

        if (live && d.i >= 0 && b.edge.check(t - d.since, d.since, skip) && onStrike){
          onStrike({ note: layerId(b.note, b.vel), vel: b.vel, pos: new THREE.Vector3(b.x, b.top + .05, b.z), color: b.col.getHex(),
                     dur: 0, sparks: Math.round(3 + 5 * b.vel), light: .5 + .5 * b.vel, shake: 0 });
        }
      }
      // bars: pose (plunger lift), flex, glow
      bars.forEach((b, i) => {
        put(barMesh, i, b.x, b.top - b.thick / 2 + b.off, b.z, b.w, b.thick, b.len);
        aFlex.array[i] = b.flex / b.thick;
        // the bar stays WOOD: a brief warm kiss at the centre; the colour goes to the resonator
        const fl = b.vel * ring(b.since, 9);
        aBG.array[i] = .03 + .6 * fl;
        const rg = b.vel * ring(b.since, 1 / b.ringT);
        aRG.array[i] = .05 + 1.1 * rg;
        aMG.array[i] = .14 + 3.4 * rg;
        // the pressure pulse: a band of light leaves the mouth at the strike and runs down the tube
        const s = b.since;
        aRP.array[i * 2] = 1 - s / .24;
        aRP.array[i * 2 + 1] = s < .45 ? 2.6 * b.vel * Math.exp(-s * 3) : 0;
      });
      barMesh.instanceMatrix.needsUpdate = true;
      aFlex.needsUpdate = aBG.needsUpdate = aRG.needsUpdate = aMG.needsUpdate = aRP.needsUpdate = true;
      // node plungers ride with the bar; coils energise on the stroke
      nodes.forEach((n, k) => {
        const b = n.b, top = n.bot + b.off;              // the plunger tip carries the bar's underside
        put(plungers, k, n.x, top - PAD_T - ROD / 2, n.z, 1, 1, 1);
        put(pads, k, n.x, top - PAD_T / 2, n.z, 1, 1, 1);
        const stroke = b.lane ? Math.min(1, Math.abs(b.off) / (KICK_MAX * .5)) : 0;
        aCG.array[k] = .06 + 2.6 * stroke + 1.4 * b.vel * ring(b.since, 14);
      });
      plungers.instanceMatrix.needsUpdate = pads.instanceMatrix.needsUpdate = true;
      aCG.needsUpdate = true;

      // marbles, magnets, halos, trails
      const H2 = halo.pos.array, HA = halo.alpha.array, HS = halo.size.array;
      played.forEach((b, k) => {
        const d = b.d, y = b.top + b.r + d.y;
        put(balls, k, b.x, y, b.z, b.r, b.r, b.r);
        // PARKED marbles dim right down so the ones in flight own the picture: `park` = 1 on
        // the magnet, easing in over the last of the rise and out over the drop
        const park = d.mode === 'hold' ? 1 : d.mode === 'drop' ? Math.max(0, d.until / half) ** 2
          : (d.since + d.until > DT_MAX + 1e-9 ? Math.min(1, d.since / half) ** 2 : 0);
        aBallG.array[k] = .9 - .72 * park + 2.4 * b.vel * ring(b.since, 9);
        // the magnet: energises as the marble arrives, clacks bright on docking, holds, cuts on release
        let on = 0;
        if (d.mode === 'hold'){
          const docked = d.i < 0 ? 9 : d.since - half;
          on = .55 + 2.6 * Math.exp(-docked * 9);
        } else if (d.mode === 'arc' && d.vy > 0 && d.until > half){
          on = .55 * Math.max(0, 1 - (half - d.since) / .12);
        }
        aMcG.array[k] = .08 + 1.6 * on;
        const base = k * per;
        // ball halo
        H2[base * 3] = b.x; H2[base * 3 + 1] = y; H2[base * 3 + 2] = b.z;
        HA[base] = .38 - .32 * park + .6 * b.vel * ring(b.since, 8); HS[base] = b.r * (5 + 3 * ring(b.since, 8));
        // ghost trail re-sampled from the solved arc (dim while slow / held)
        const speed = Math.min(1, Math.abs(d.vy) / 5);
        for (let j = 0; j < TRAIL_N; j++){
          const p = base + 1 + j, tj = t - (j + 1) * TRAIL_DT;
          if (!live || tj < start || speed < .05){ HA[p] = 0; continue; }
          H2[p * 3] = b.x; H2[p * 3 + 1] = b.top + b.r + ballAt(b.lane.L, tj, start).y; H2[p * 3 + 2] = b.z;
          const f = 1 - (j + 1) / (TRAIL_N + 1);
          HA[p] = .55 * f * speed; HS[p] = b.r * 5 * (.45 + .55 * f);
        }
        // contact flare: a flat burst of the lane colour on the bar's centre at the strike
        const cf = base + per - 2, fa = live ? b.vel * ring(b.since, 14) : 0;
        H2[cf * 3] = b.x; H2[cf * 3 + 1] = b.top + .04; H2[cf * 3 + 2] = b.z;
        HA[cf] = fa > .01 ? Math.min(1, 1.1 * fa) : 0; HS[cf] = b.w * (2.2 + 3.5 * (1 - ring(b.since, 14)));
        // magnet halo
        const m = base + per - 1;
        H2[m * 3] = b.x; H2[m * 3 + 1] = b.magFace + .04; H2[m * 3 + 2] = b.z;
        HA[m] = Math.min(1, .16 * on); HS[m] = b.magR * 3.2 * (1 + .4 * Math.max(0, on - 1));
      });
      balls.instanceMatrix.needsUpdate = true;
      aBallG.needsUpdate = aMcG.needsUpdate = true;
      halo.pos.needsUpdate = halo.alpha.needsUpdate = halo.size.needsUpdate = true;
    }

    function update(songTime, P, dt, { started, skipStrikes, onStrike }){
      if (!st) return;
      paint(started ? songTime : st.start, !!started, onStrike, skipStrikes);
    }

    return { build, update };
  },

  /* 32 beats in A minor: rolling arpeggios (a wave across the keyboard), a chromatic
     16th run into a big E chord, a sparse answer after an A-minor chord (marbles dock
     on the magnets), a crescendo tremolo ROLL on E5 (one marble buzzing its bar), a
     cascading 16th descent and a final chord that rings into the loop. */
  demo: {
    bpm: 100, beats: 32, scale: ['A', 'B', 'C', 'D', 'E', 'F', 'G#'],
    part: [[0,"A3",0.55],[0.5,"E4",0.65],[1,"A4",0.78],[1.5,"C5",0.9],[2,"E5",1],[2.5,"C5",0.85],[3,"A4",0.7],[3.5,"E4",0.6],
      [4,"F3",0.51],[4.5,"C4",0.6],[5,"F4",0.72],[5.5,"A4",0.83],[6,"C5",0.92],[6.5,"A4",0.78],[7,"F4",0.64],[7.5,"C4",0.55],
      [8,"G3",0.55],[8.5,"D4",0.65],[9,"G4",0.78],[9.5,"B4",0.9],[10,"D5",1],[10.5,"B4",0.85],[11,"G4",0.7],[11.5,"D4",0.6],
      [12,"E3",1],[12,"B3",1],[12,"E4",1],[12,"G#4",1],
      [13,"E4",0.45],[13.25,"F4",0.52],[13.5,"G#4",0.59],[13.75,"A4",0.66],[14,"B4",0.73],[14.25,"C5",0.8],[14.5,"D5",0.87],[14.75,"E5",0.94],
      [16,"A3",1],[16,"E4",1],[16,"C5",1],[16,"A5",1],
      [17.5,"E5",0.5],[18,"C5",0.6],[19,"A4",0.7],
      [20,"D4",0.6],[20.5,"F4",0.7],[21,"A4",0.8],[21.5,"D5",0.85],[22,"F5",1],[22.5,"E5",0.75],[23,"D5",0.7],
      [24,"B3",0.8],[24,"G#4",0.7],
      [24,"E5",0.3],[24.25,"E5",0.36],[24.5,"E5",0.43],[24.75,"E5",0.49],[25,"E5",0.55],[25.25,"E5",0.62],
      [25.5,"E5",0.68],[25.75,"E5",0.75],[26,"E5",0.81],[26.25,"E5",0.87],[26.5,"E5",0.94],[26.75,"E5",1],
      [28,"A5",1],[28.25,"G#5",0.94],[28.5,"E5",0.88],[28.75,"C5",0.82],[29,"B4",0.76],[29.25,"A4",0.7],[29.5,"E4",0.64],[29.75,"C4",0.58],
      [30,"A3",0.95],[30,"E4",0.95],[30,"A4",0.95],[30,"C5",0.95]],
  },
};

/* ---- helpers ---- */
/* Vertex colours along x: the signature rose (low) → violet → ice-cyan (high), bright for bloom. */
function paintGradient(geo, x0, x1){
  const p = geo.attributes.position, c = new Float32Array(p.count * 3), col = new THREE.Color();
  for (let i = 0; i < p.count; i++){
    col.setHSL(laneHue((p.getX(i) - x0) / (x1 - x0)), .9, .55).multiplyScalar(2.2).toArray(c, i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
}

function inst(geo, name, n, size){
  const a = new THREE.InstancedBufferAttribute(new Float32Array(n * size), size);
  a.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute(name, a);
  return a;
}

/* Shared instanced emissive: emissive += aCol · aGlow (balls, coils, resonator mouths). */
function glowPatch(sh){
  sh.vertexShader = 'attribute float aGlow;\nattribute vec3 aCol;\nvarying float vGlow;\nvarying vec3 vCol;\n' +
    sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow; vCol = aCol;');
  sh.fragmentShader = 'varying float vGlow;\nvarying vec3 vCol;\n' + sh.fragmentShader.replace(
    '#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vCol * vGlow;');
}

/* Resonator tube: the glow pools toward the mouth (top) of the tube. */
function resonatorPatch(sh){
  sh.vertexShader = 'attribute float aGlow;\nattribute vec3 aCol;\nattribute vec2 aPulse;\nvarying float vGlow;\nvarying vec3 vCol;\nvarying float vH;\nvarying vec2 vPulse;\n' +
    sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow; vCol = aCol; vH = position.y + .5; vPulse = aPulse;');
  sh.fragmentShader = 'varying float vGlow;\nvarying vec3 vCol;\nvarying float vH;\nvarying vec2 vPulse;\n' + sh.fragmentShader.replace(
    '#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      float band = (vH - vPulse.x) * 7.;
      totalEmissiveRadiance += vCol * (vGlow * (.15 + .85 * vH * vH) + vPulse.y * exp(-band * band));`);
}

/* Rosewood bar: the underside ARCH (the real tuning cut between the nodes), the
   first free-free bending mode (centre against the ends, nodes still), wood grain,
   and the strike glow. aFlex = centre deflection / thickness (object units). */
function barPatch(sh){
  sh.vertexShader = 'attribute float aFlex;\nattribute float aGlow;\nattribute vec3 aCol;\nvarying float vGlow;\nvarying vec3 vCol;\nvarying vec3 vObj;\n' + MODE_GLSL + '\n' +
    sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      float u = position.z;
      float aw = .23;
      float arch = .42 * max(0., 1. - (u * u) / (aw * aw));
      if (position.y < 0.) transformed.y += arch;
      transformed.y += aFlex * -modeShape(u);
      vGlow = aGlow; vCol = aCol; vObj = position;`);
  sh.fragmentShader = 'varying float vGlow;\nvarying vec3 vCol;\nvarying vec3 vObj;\n' + sh.fragmentShader
    .replace('#include <color_fragment>', `#include <color_fragment>
      // grain runs ALONG the bar (z): figure lines wander across the width (x)
      float gr = sin(vObj.x * 34. + 3.2 * sin(vObj.z * 5.5 + vObj.x * 4.) + vObj.y * 3.);
      float fine = sin(vObj.x * 190. + 9. * sin(vObj.z * 3.7 + vObj.x * 11.));
      float heart = smoothstep(.28, .5, abs(vObj.z));          // darker heartwood toward the bar ends
      diffuseColor.rgb *= (.66 + .28 * smoothstep(-.4, 1., gr) + .07 * fine) * (1. - .28 * heart);`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      float centre = 1. - smoothstep(0., .5, abs(vObj.z));
      totalEmissiveRadiance += vCol * vGlow * (.35 + .65 * centre);`);
}

/* One additive Points cloud for every halo + ghost (constant count → no recompiles).
   Point size in world units, perspective-correct (scale read from the camera each render). */
function makeHaloCloud(n, glowTex){
  const geo = new THREE.BufferGeometry();
  const pos = new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const col = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
  const alpha = new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage);
  const size = new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', pos); geo.setAttribute('aColor', col);
  geo.setAttribute('aAlpha', alpha); geo.setAttribute('aSize', size);
  const uniforms = { map: { value: glowTex }, uScale: { value: 800 } };
  const mat = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `attribute vec3 aColor; attribute float aAlpha; attribute float aSize;
      uniform float uScale; varying vec3 vC; varying float vA;
      void main(){ vC = aColor; vA = aAlpha;
        vec4 mv = modelViewMatrix * vec4(position, 1.);
        gl_PointSize = aAlpha > 0. ? aSize * uScale / max(.1, -mv.z) : 0.;
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform sampler2D map; varying vec3 vC; varying float vA;
      void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC * t.rgb * t.a * vA, 1.); }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  const _v = new THREE.Vector2();
  points.onBeforeRender = (renderer, scene, camera) => {
    renderer.getDrawingBufferSize(_v);
    const fov = camera.isPerspectiveCamera ? camera.fov : 50;
    uniforms.uScale.value = _v.y / (2 * Math.tan(fov * Math.PI / 360));
  };
  return { points, pos, col, alpha, size };
}
