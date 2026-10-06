import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/* ============================================================
   PATERNOSTER — an alternative BODY for the melody conveyor
   (`?machine=paternoster`). Same mechanism, same math, different
   machine: the solid belt wall is gone. Two open roller CHAINS run
   between a top and a bottom housing; each tone-plate rides a steel
   CARRIER rod slung between the chains, so the room stays visible
   through the machine.

   HONESTY (same contract as conveyor.js): the machine only draws what
   the math implies. Every pad rises at DESCENT, so the chains are a
   pure function of songTime scrolling at DESCENT — slip-free with the
   carriers by construction, no state. The shafts turn at DESCENT / r of
   the (housed) chain sprocket; the outboard drive gears share the
   shaft, so they turn at that same angular speed.

   The visible run is band ± LIP. Pads deploy out of the bottom housing,
   rise through the band, and stow back into the top one (deployPose,
   just with a shorter window: PT.INNER / PT.CULL); they are culled only
   once fully behind a housing face, so nothing blinks in open air.
   Render-time only — the engine is never touched.
   ============================================================ */

/* Window + depths shared with main.js (only read under the flag). */
export const PT = {
  LIP:    7.0,     // housing faces: band ± LIP — the open run between them
  CULL:   7.65,    // pads vanish here (well behind the housing face: lip + the plate's half-height)
  INNER:  3.0,     // fully deployed within band ± INNER (strike zone + flipper stroke never animate)
  STOW_Z: -1.75,   // stowed plate depth: flat, just in front of the carrier rod
  GAP:    5,       // bay gap between machines (outboard gears + columns need room)
};

const CZ     = -2.2;   // front (rising) chain strand depth
const RC     = .5;     // housed chain-sprocket radius → back strand at CZ − 2·RC
const SPROCK = 8.6;    // chain sprocket centres at band ± SPROCK (inside the housings)
const HOUSE_H = 2.4;   // housing height (LIP → LIP + HOUSE_H)
const FRONT  = -.6;    // housing front face — behind every marble (marbles fly at z ≥ −.24 − r)
const BACK   = -3.9;
const CHAIN_OUT = 1.15; // chains sit this far outboard of the pad field's x extent
const END    = .4;     // housing overhang past the chains
const GEAR_R = .95;    // outboard drive gear (same shaft as the chain sprocket)
const COL_W  = .26;
const ROD_Z  = CZ + .14;
const HUB_BACK = .3;

const AMBER = new THREE.Color(0xffa040);
/* merge anything (indexed or not) — normalise to non-indexed position/normal/uv first */
function merge(list){
  const flat = list.map(g => {
    const f = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(f.attributes)) if (!['position', 'normal', 'uv'].includes(k)) f.deleteAttribute(k);
    return f;
  });
  const out = mergeGeometries(flat);
  list.forEach(g => g.dispose()); flat.forEach(g => g.dispose());
  return out;
}
const ZAXIS = new THREE.Vector3(0, 0, 1), YAXIS = new THREE.Vector3(0, 1, 0), XAXIS = new THREE.Vector3(1, 0, 0);
const _n = new THREE.Vector3(), _hub = new THREE.Vector3(), _a = new THREE.Vector3(), _d = new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);

/* ---- TONE-PLATE: a glockenspiel bar replaces the disc. Length along local x,
   inside the pad's catch circle (half-length .55 < PAD_R), so the layout's
   no-overlap guarantee still holds. Brass pins at the two vibration NODES
   (22.4% in from each end — where a real bar is supported); the carriage
   cradles the bar exactly there. Built in the pad's local frame (up = +y);
   main scales it by the note's radius, so size stays a pure fn of the note. ---- */
export const BAR = { L: 1.1, T: .12, W: .44 };
export const NODE_X = BAR.L / 2 - .224 * BAR.L;
export function makeToneBarParts({ envMap }){
  const barGeo = new RoundedBoxGeometry(BAR.L, BAR.T, BAR.W, 2, .045);
  // rim = a glowing frame hugging the bar's top edge (the old torus's job: hue + prog² anticipation)
  const rr = (w, h, r) => {
    const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
    s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
    s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    return s;
  };
  const outer = rr(BAR.L + .1, BAR.W + .1, .09);
  outer.holes.push(rr(BAR.L - .06, BAR.W - .06, .04));
  const rimGeo = new THREE.ShapeGeometry(outer, 6);
  rimGeo.rotateX(-Math.PI / 2);                          // lie in the bar's top plane, facing +y
  const pins = [-1, 1].map(s => new THREE.CylinderGeometry(.045, .045, .03, 12).translate(s * NODE_X, BAR.T / 2 + .012, 0));
  const pinGeo = merge(pins);
  const brass = new THREE.MeshStandardMaterial({ color: 0xd2a04a, metalness: 1, roughness: .28, envMap, envMapIntensity: 1.3 });
  return { barGeo, rimGeo, pinGeo, brass };
}

export function makePaternosterShop({ envMap, beltSpeed, bandY, floorY }){
  return { buildMachine };

  function buildMachine(track){
    const M = {
      gun:   new THREE.MeshStandardMaterial({ color: 0x2c323d, metalness: .85, roughness: .4, envMap,
               emissive: new THREE.Color(0x10141d), emissiveIntensity: 1 }),
      gunDk: new THREE.MeshStandardMaterial({ color: 0x1a1e26, metalness: .8, roughness: .5, envMap }),
      steel: new THREE.MeshStandardMaterial({ color: 0xb4bcca, metalness: 1, roughness: .26, envMap, envMapIntensity: 1.3,
               emissive: new THREE.Color(0x141a26), emissiveIntensity: 1 }),
      chain: new THREE.MeshStandardMaterial({ color: 0x9aa3b4, metalness: 1, roughness: .32, envMap, envMapIntensity: 1.4,
               emissive: new THREE.Color(0x161b26), emissiveIntensity: 1 }),
      brass: new THREE.MeshStandardMaterial({ color: 0xcf9b45, metalness: 1, roughness: .3, envMap, envMapIntensity: 1.3,
               emissive: new THREE.Color(0x2a1a06), emissiveIntensity: 1 }),
      rod:   new THREE.MeshStandardMaterial({ color: 0x6d7586, metalness: 1, roughness: .35, envMap }),
      glow:  new THREE.MeshBasicMaterial({ color: AMBER.clone().multiplyScalar(2.4) }),
      slot:  new THREE.MeshBasicMaterial({ color: 0x0a0604, side: THREE.DoubleSide }),
    };
    M.gear = M.steel;
    const geos = [];
    const keep = g => (geos.push(g), g);
    const xs = track.padObjs.map(po => po.base.x);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const xL = minX - CHAIN_OUT, xR = maxX + CHAIN_OUT, cx = (xL + xR) / 2;
    const B = bandY;
    const group = new THREE.Group();
    const mesh = (g, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); group.add(o); return o; };

    /* ---------- housings (top + bottom), mirror images about the band ---------- */
    const hw = (xR - xL) + 2 * END, hd = FRONT - BACK, hzc = (FRONT + BACK) / 2;
    const bodyGeo = keep(new RoundedBoxGeometry(hw, HOUSE_H, hd, 3, .14));
    const trimGeo = keep(new RoundedBoxGeometry(hw + .06, .11, .14, 2, .04));
    const capGeo  = keep(new RoundedBoxGeometry(hw - .5, .09, .5, 2, .03));
    const slotW = (maxX - minX) + 2.2;
    const SLOT_Z0 = -2.15, SLOT_Z1 = -.85;                // the opening the plates pass through (stowed → lip depth)
    const slotGeo = keep(new THREE.PlaneGeometry(slotW, SLOT_Z1 - SLOT_Z0));
    const glowLineGeo = keep(new THREE.BoxGeometry(slotW, .035, .035));
    const ribGeo = keep(new THREE.BoxGeometry(.07, HOUSE_H - .3, .05));
    for (const s of [1, -1]){
      const yc = B + s * (PT.LIP + HOUSE_H / 2);
      const lipY = B + s * PT.LIP;                       // the face pads pass through
      mesh(bodyGeo, M.gun, cx, yc, hzc);
      mesh(trimGeo, M.brass, cx, lipY + s * .06, FRONT + .02);              // brass lip on the mouth edge
      mesh(trimGeo, M.brass, cx, B + s * (PT.LIP + HOUSE_H) - s * .06, FRONT + .02);
      mesh(capGeo, M.gunDk, cx, B + s * (PT.LIP + HOUSE_H) + s * .02, hzc); // a raised cap plate on the outer face
      // vertical ribs on the fascia — read as a cast/bolted casing, not a box
      const nRib = Math.max(2, Math.round(hw / 1.6));
      for (let k = 1; k < nRib; k++) mesh(ribGeo, M.gunDk, xL - END + k * hw / nRib, yc, FRONT + .03);
      // the MOUTH: an amber-lit slot in the face the pads pass through (+ a hot edge line)
      const slot = mesh(slotGeo, M.slot, (minX + maxX) / 2, lipY - s * .004, (SLOT_Z0 + SLOT_Z1) / 2);
      slot.rotation.x = Math.PI / 2;
      for (const z of [SLOT_Z0, SLOT_Z1]) mesh(glowLineGeo, M.glow, (minX + maxX) / 2, lipY - s * .02, z);
    }

    /* ---------- outboard drive gears + columns + shaft stubs ---------- */
    const gearGeo = keep(gearGeometry(GEAR_R, 22, .14));
    const hubGeo  = keep(new THREE.CylinderGeometry(.2, .2, .05, 28).rotateZ(Math.PI / 2));
    const ringGeo = keep(new THREE.TorusGeometry(.3, .045, 10, 32).rotateY(Math.PI / 2));
    const shaftGeo = keep(new THREE.CylinderGeometry(.09, .09, 1, 16).rotateZ(Math.PI / 2));
    const colH = (B + PT.LIP + HOUSE_H + .25) - floorY;
    const colGeo = keep(new THREE.BoxGeometry(COL_W, colH, COL_W));
    const footGeo = keep(new RoundedBoxGeometry(COL_W * 3, .35, COL_W * 4, 2, .06));
    const bearGeo = keep(new RoundedBoxGeometry(.32, .6, .6, 2, .06));
    const lampGeo = keep(new THREE.CylinderGeometry(.09, .09, .03, 20).rotateX(Math.PI / 2));
    const braceGeo = keep(new THREE.BoxGeometry(hw + 2 * (END + .5), .16, .16));
    const gzc = CZ - RC;                                 // shaft axis depth (sprocket centre)
    const gears = [];
    for (const side of [-1, 1]){
      const xEnd = side < 0 ? xL - END : xR + END;      // housing end wall
      const xg = xEnd + side * .14;                     // gear plane
      const xc = xEnd + side * .5;                      // column centre
      mesh(colGeo, M.gun, xc, floorY + colH / 2, gzc);
      mesh(footGeo, M.gunDk, xc, floorY + .17, gzc);
      for (const s of [1, -1]){
        const ys = B + s * SPROCK;
        const g = mesh(gearGeo, M.gear, xg, ys, gzc);
        const hub = mesh(hubGeo, M.glow, xg + side * .1, ys, gzc);
        const ring = mesh(ringGeo, M.brass, xg + side * .08, ys, gzc);
        const sh = mesh(shaftGeo, M.steel, (xEnd + xc) / 2, ys, gzc); sh.scale.x = Math.abs(xc - xEnd);
        mesh(bearGeo, M.brass, xc, ys, gzc);
        mesh(lampGeo, M.glow, xc, ys, gzc + .31);                       // bearing tell-tale, faces the room
        gears.push(g, hub);
        void ring;
      }
    }
    mesh(braceGeo, M.gun, cx, B - PT.LIP - HOUSE_H - 1.2, gzc);     // tie the columns under the bottom housing

    /* ---------- the two roller chains: an instanced loop around each sprocket pair ---------- */
    const H = 2 * SPROCK, Lc = 2 * H + 2 * Math.PI * RC;
    const NL = Math.round(Lc / .22), pitch = Lc / NL;
    const linkGeo = keep(linkGeometry(pitch));
    const chains = new THREE.InstancedMesh(linkGeo, M.chain, 2 * NL);
    chains.frustumCulled = false;
    group.add(chains);
    const yB = B - SPROCK, yT = B + SPROCK;
    const chainAt = (s) => {                            // arclength → (y, z, φ) on the loop; front strand rises
      s = ((s % Lc) + Lc) % Lc;
      if (s < H) return [yB + s, CZ, 0];
      s -= H;
      if (s < Math.PI * RC){ const t = s / RC; return [yT + RC * Math.sin(t), CZ - RC + RC * Math.cos(t), -t]; }
      s -= Math.PI * RC;
      if (s < H) return [yT - s, CZ - 2 * RC, Math.PI];
      const t = (s - H) / RC;
      return [yB - RC * Math.sin(t), CZ - RC - RC * Math.cos(t), Math.PI - t];
    };

    /* ---------- the marble's HOPPER: a brass drop-tube over pad 0, mouth just under the
       top housing face. The newborn waits inside it and free-falls out (BIRTH_DROP is
       untouched — the tube simply hides the first ~3 u of the honest drop). ---------- */
    {
      const p0 = track.pads[0].pos;
      const rt = track.role === 'bass' ? .5 : .42;
      const yM = B + PT.LIP + .35, yTop = B + 11.2;
      const tubeGeo = keep(new THREE.CylinderGeometry(rt, rt, yTop - yM, 28, 1, true));
      const tube = mesh(tubeGeo, new THREE.MeshStandardMaterial({ color: 0xc79440, metalness: 1, roughness: .3, envMap,
        envMapIntensity: 1.3, side: THREE.DoubleSide, emissive: new THREE.Color(0x24160a) }), p0.x, (yM + yTop) / 2, p0.z);
      void tube;
      const funnelGeo = keep(new THREE.CylinderGeometry(rt * 2.3, rt, 1.0, 28, 1, true));
      mesh(funnelGeo, new THREE.MeshStandardMaterial({ color: 0x3a414d, metalness: .9, roughness: .35, envMap,
        side: THREE.DoubleSide }), p0.x, yTop + .5, p0.z);
      const mouthGeo = keep(new THREE.TorusGeometry(rt + .02, .03, 10, 32).rotateX(Math.PI / 2));
      mesh(mouthGeo, M.glow, p0.x, yM, p0.z);
      const collarGeo = keep(new THREE.TorusGeometry(rt + .03, .06, 10, 32).rotateX(Math.PI / 2));
      mesh(collarGeo, M.brass, p0.x, yTop, p0.z);
      const armLen = p0.z - rt - FRONT;
      if (armLen > .02){
        const armGeo = keep(new THREE.BoxGeometry(.16, .16, armLen));
        for (const y of [B + PT.LIP + 1.2, B + PT.LIP + 2.4]) mesh(armGeo, M.gun, p0.x, y, FRONT + armLen / 2);
      }
    }

    /* ---------- per-pad CARRIERS: a steel rod slung chain-to-chain at the pad's belt
       height (rides the chain, no nudge), a shoe at the pad's x, a telescoping spine
       to the hub under the plate, and a brass V-cradle to the plate's two NODES that
       rides the plate's full motion (bob + flipper stroke + unfold). ---------- */
    const rodGeo = keep(new THREE.CylinderGeometry(.026, .026, xR - xL, 8).rotateZ(Math.PI / 2));
    const dogGeo = keep(merge([-1, 1].map(s =>
      new THREE.CylinderGeometry(.07, .07, .14, 12).rotateZ(Math.PI / 2).translate(s * (xR - xL) / 2, 0, 0))));
    const shoeGeo = keep(new RoundedBoxGeometry(.2, .2, .16, 2, .04));
    const spineGeo = keep(new THREE.BoxGeometry(.07, .07, 1));
    const parts = track.padObjs.map(po => {
      const s = po.g.scale.x;
      const car = new THREE.Mesh(keep(cradleGeometry(s)), M.brass);
      const rod = new THREE.Mesh(rodGeo, M.rod), dog = new THREE.Mesh(dogGeo, M.brass);
      const shoe = new THREE.Mesh(shoeGeo, M.gun), spine = new THREE.Mesh(spineGeo, M.gun);
      group.add(car, rod, dog, shoe, spine);
      return { po, car, rod, dog, shoe, spine };
    });

    return {
      group,
      update(dt, songTime = 0){                         // call AFTER the belt loop placed po.g + po.beltY
        const st = songTime * beltSpeed;                // chain travel: a pure fn of time (slip-free w/ pads)
        // chains
        for (let c = 0; c < 2; c++){
          const x = c ? xR : xL;
          for (let i = 0; i < NL; i++){
            const [y, z, phi] = chainAt(i * pitch + st);
            _p.set(x, y, z); _q.setFromAxisAngle(XAXIS, phi);
            chains.setMatrixAt(c * NL + i, _m.compose(_p, _q, _s));
          }
        }
        chains.instanceMatrix.needsUpdate = true;
        // shafts: ω = v / r of the housed sprocket; the drive gears share it (front strand rises ⇒ −x spin)
        const ang = -st / RC;
        for (const g of gears) g.rotation.x = ang;
        // carriers
        for (const p of parts){
          const { po } = p, vis = po.g.visible;
          p.car.visible = p.rod.visible = p.dog.visible = p.shoe.visible = p.spine.visible = vis;
          if (!vis) continue;
          p.rod.position.set(cx, po.beltY, ROD_Z);
          p.dog.position.copy(p.rod.position);
          p.shoe.position.set(po.base.x, po.beltY, ROD_Z + .06);
          p.car.position.copy(po.g.position);
          p.car.quaternion.copy(po.g.quaternion);
          _n.copy(YAXIS).applyQuaternion(po.g.quaternion);
          _hub.copy(po.g.position).addScaledVector(_n, -HUB_BACK);
          _a.copy(p.shoe.position);
          _d.subVectors(_hub, _a);
          const len = _d.length() || 1e-3;
          p.spine.position.copy(_a).addScaledVector(_d, .5);
          p.spine.quaternion.setFromUnitVectors(ZAXIS, _d.divideScalar(len));
          p.spine.scale.set(1, 1, len);
        }
      },
      dispose(){
        geos.forEach(g => g.dispose());
        group.traverse(o => { if (o.material) o.material.dispose(); });
        chains.dispose();
      },
    };
  }
}

/* A toothed drive gear with five spoke windows, axis along x (baked). */
function gearGeometry(R, teeth, thick){
  const s = new THREE.Shape(), rIn = R * .86, n = teeth * 4;
  for (let i = 0; i <= n; i++){
    const a = i / n * Math.PI * 2, ph = i % 4;
    const r = (ph === 1 || ph === 2) ? R : rIn;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    i ? s.lineTo(x, y) : s.moveTo(x, y);
  }
  const rimIn = R * .7, hubR = R * .28;
  for (let k = 0; k < 5; k++){                        // spoke windows (annular sectors)
    const a0 = k / 5 * Math.PI * 2 + .2, a1 = (k + 1) / 5 * Math.PI * 2 - .2;
    const h = new THREE.Path();
    h.absarc(0, 0, rimIn, a0, a1, false);
    h.absarc(0, 0, hubR, a1 - .05, a0 + .05, true);
    h.closePath();
    s.holes.push(h);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: true, bevelThickness: .02, bevelSize: .02, bevelSegments: 1, curveSegments: 10 });
  g.translate(0, 0, -thick / 2);
  g.rotateY(Math.PI / 2);                              // axis → x
  return g;
}

/* One roller-chain link (pitch long, along local +y): two side plates + a roller. */
function linkGeometry(pitch){
  const parts = [];
  for (const sx of [-1, 1]) parts.push(new RoundedBoxGeometry(.03, pitch * 1.18, .13, 1, .012).translate(sx * .075, pitch / 2, 0));
  parts.push(new THREE.CylinderGeometry(.048, .048, .13, 10).rotateZ(Math.PI / 2));
  parts.push(new THREE.CylinderGeometry(.022, .022, .2, 8).rotateZ(Math.PI / 2));  // pin ends
  const g = merge(parts);
  return g;
}

/* The brass V-cradle under a tone-plate, in the plate's local frame scaled to world:
   a hub under the bar and two posts up to the vibration nodes. */
function cradleGeometry(s){
  const hub = new THREE.Vector3(0, -HUB_BACK, 0), geos = [];
  for (const sx of [-1, 1]){
    const node = new THREE.Vector3(sx * NODE_X * s, -BAR.T / 2 * s, 0);
    geos.push(strut(hub, node, .05));
  }
  geos.push(new THREE.SphereGeometry(.07, 12, 8).translate(0, -HUB_BACK, 0));
  const g = merge(geos);
  return g;
}
function strut(a, b, w){
  const dir = b.clone().sub(a), len = dir.length() || 1e-3;
  const geo = new THREE.BoxGeometry(w, w, len);
  const q = new THREE.Quaternion().setFromUnitVectors(ZAXIS, dir.clone().normalize());
  return geo.applyMatrix4(new THREE.Matrix4().compose(a.clone().addScaledVector(dir, .5), q, new THREE.Vector3(1, 1, 1)));
}
