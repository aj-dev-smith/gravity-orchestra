import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { craneAt, CRANE } from './crane.js';
const UPY = .26;       // engine UP.y — the marble's contact level above the band

/* ============================================================
   PATERNOSTER — an alternative BODY for the melody conveyor
   (`?machine=paternoster`). Same mechanism, same math, different
   machine: the solid belt wall is gone. Two open roller CHAINS run
   between a top and a bottom housing; each tone-plate rides a steel
   CARRIER rod slung between the chains, so the room stays visible
   through the machine.

   HONESTY (the contract the original belt wall set): the machine only draws what
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
const RC     = .5;     // chain-sprocket pitch radius → back strand at CZ − 2·RC
const TEETH  = 14;     // sprocket teeth; the chain pitch is 2π·RC / TEETH so links seat in the valleys
const SPROCK = 8.85;   // chain sprocket centres at ≈ band ± SPROCK (snapped to whole links)
const SKIRT  = 8.2;    // solid skirt LIP → SKIRT hides the stowing plates; above it the open window
const CROWN  = 9.55;   // window top / crown underside
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
      chain: new THREE.MeshStandardMaterial({ color: 0xc4ccda, metalness: 1, roughness: .28, envMap, envMapIntensity: 1.6,
               emissive: new THREE.Color(0x232a38), emissiveIntensity: 1 }),
      brass: new THREE.MeshStandardMaterial({ color: 0xcf9b45, metalness: 1, roughness: .3, envMap, envMapIntensity: 1.3,
               emissive: new THREE.Color(0x2a1a06), emissiveIntensity: 1 }),
      warm:  new THREE.MeshStandardMaterial({ color: 0x120c08, metalness: .3, roughness: .8,
               emissive: new THREE.Color(0xff8a3a), emissiveIntensity: .55, emissiveMap: warmTex() }),
      cable: new THREE.MeshStandardMaterial({ color: 0x1c1f26, metalness: .6, roughness: .5 }),
      rod:   new THREE.MeshStandardMaterial({ color: 0x6d7586, metalness: 1, roughness: .35, envMap }),
      glow:  new THREE.MeshBasicMaterial({ color: AMBER.clone().multiplyScalar(2.4) }),
      slot:  new THREE.MeshBasicMaterial({ color: 0x0a0604, side: THREE.DoubleSide }),
    };
    const geos = [];
    const keep = g => (geos.push(g), g);
    const xs = track.padObjs.map(po => po.base.x);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const xL = minX - CHAIN_OUT, xR = maxX + CHAIN_OUT, cx = (xL + xR) / 2;
    const B = bandY;
    const group = new THREE.Group();
    const mesh = (g, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); group.add(o); return o; };

    /* ---------- the chain loop geometry: pitch locked to the sprocket's teeth, run locked
       to a whole number of links, so the rollers SEAT in the tooth valleys every pass ---------- */
    const pitch = 2 * Math.PI * RC / TEETH;
    const H = Math.round(2 * SPROCK / (pitch / 2)) * (pitch / 2);   // strand length (2H = whole links)
    const Lc = 2 * H + 2 * Math.PI * RC, NL = Math.round(Lc / pitch);
    const yB = B - H / 2, yT = B + H / 2;                // sprocket centres (inside the housing windows)
    const gzc = CZ - RC;                                 // shaft axis depth (sprocket centre)

    /* ---------- housings (top + bottom), mirror images about the band ----------
       Each is SCULPTED in three tiers instead of one slab:
         SKIRT  (LIP → SKIRT) — solid; the plates slide in behind it through the amber mouth
                                 and vanish there unseen (cull < SKIRT − plate half-height)
         WINDOW (SKIRT → CROWN) — OPEN FRONT: the sprockets, the chain wrap and (top) the
                                 magnet crane on its rail, against a warm-lit back wall
         CROWN — a bevelled cap with a brass nosing. */
    const hw = (xR - xL) + 2 * END, hd = FRONT - BACK, hzc = (FRONT + BACK) / 2;
    const SK = SKIRT - PT.LIP, WIN = CROWN - SKIRT;
    const skirtGeo = keep(new RoundedBoxGeometry(hw, SK, hd, 3, .16));
    const crownGeo = keep(new RoundedBoxGeometry(hw + .3, .34, hd + .15, 3, .14));
    const backGeo  = keep(new THREE.PlaneGeometry(hw - .1, WIN));
    const cheekGeo = keep(new RoundedBoxGeometry(.16, WIN + .1, hd, 2, .05));
    const nosingGeo = keep(new THREE.CylinderGeometry(.07, .07, hw + .3, 14).rotateZ(Math.PI / 2));
    const trimGeo = keep(new RoundedBoxGeometry(hw + .06, .1, .12, 2, .04));
    const slotW = (maxX - minX) + 2.2;
    const SLOT_Z0 = -2.15, SLOT_Z1 = -.85;                // the opening the plates pass through (stowed → lip depth)
    const slotGeo = keep(new THREE.PlaneGeometry(slotW, SLOT_Z1 - SLOT_Z0));
    const glowLineGeo = keep(new THREE.BoxGeometry(slotW, .035, .035));
    const ribGeo = keep(new THREE.BoxGeometry(.06, SK - .3, .05));
    const sillGeo = keep(new THREE.BoxGeometry(hw - .3, .05, .05));
    const guideGeo = keep(new THREE.BoxGeometry(.26, 1, .06));
    for (const s of [1, -1]){
      const lipY = B + s * PT.LIP;                       // the face pads pass through
      mesh(skirtGeo, M.gun, cx, B + s * (PT.LIP + SK / 2), hzc);
      mesh(crownGeo, M.gun, cx, B + s * (CROWN + .17), hzc - .075);       // front flush with the skirt: lobs fly clear
      mesh(nosingGeo, M.brass, cx, B + s * (CROWN + .05), FRONT - .05);    // brass nosing on the crown
      const back = mesh(backGeo, M.warm, cx, B + s * (SKIRT + WIN / 2), BACK + .02);
      if (s < 0) back.rotation.z = Math.PI;              // hot edge at the sill in both housings
      for (const side of [-1, 1]) mesh(cheekGeo, M.gun, cx + side * (hw / 2 - .08), B + s * (SKIRT + WIN / 2), hzc);
      mesh(sillGeo, M.glow, cx, B + s * (SKIRT + .03), BACK + .08);         // warm footlight along the back wall
      mesh(trimGeo, M.brass, cx, lipY + s * .055, FRONT + .02);            // brass lip on the mouth edge
      mesh(trimGeo, M.brass, cx, B + s * (SKIRT - .055), FRONT + .02);     // and on the window sill
      const nRib = Math.max(2, Math.round(hw / 1.6));
      for (let k = 1; k < nRib; k++) mesh(ribGeo, M.gunDk, xL - END + k * hw / nRib, B + s * (PT.LIP + SK / 2), FRONT + .03);
      // the MOUTH: a dark slot with amber-lit edges in the face the plates pass through
      const slot = mesh(slotGeo, M.slot, (minX + maxX) / 2, lipY - s * .004, (SLOT_Z0 + SLOT_Z1) / 2);
      slot.rotation.x = Math.PI / 2;
      for (const z of [SLOT_Z0, SLOT_Z1]) mesh(glowLineGeo, M.glow, (minX + maxX) / 2, lipY - s * .02, z);
    }
    // chain GUIDES: a dark channel behind each rising strand, lip to lip, so the chain reads as a line
    for (const x of [xL, xR]){
      const gd = mesh(guideGeo, M.gunDk, x, B, CZ - .11); gd.scale.y = 2 * PT.LIP;
    }

    /* ---------- the chain SPROCKETS (visible through the windows) + outboard drive gears,
       columns and shaft stubs. Everything on a shaft turns at v / RC. ---------- */
    const sprGeo  = keep(sprocketGeometry(RC, TEETH, .085));
    const gearGeo = keep(gearGeometry(GEAR_R, 22, .14));
    const hubGeo  = keep(new THREE.CylinderGeometry(.2, .2, .05, 28).rotateZ(Math.PI / 2));
    const ringGeo = keep(new THREE.TorusGeometry(.3, .045, 10, 32).rotateY(Math.PI / 2));
    const shaftGeo = keep(new THREE.CylinderGeometry(.06, .06, 1, 14).rotateZ(Math.PI / 2));
    const colH = (B + CROWN + .4) - floorY;
    const colGeo = keep(new THREE.BoxGeometry(COL_W, colH, COL_W));
    const footGeo = keep(new RoundedBoxGeometry(COL_W * 3, .35, COL_W * 4, 2, .06));
    const bearGeo = keep(new RoundedBoxGeometry(.32, .6, .6, 2, .06));
    const lampGeo = keep(new THREE.CylinderGeometry(.09, .09, .03, 20).rotateX(Math.PI / 2));
    const braceGeo = keep(new THREE.BoxGeometry(hw + 2 * (END + .5), .16, .16));
    const spin = [];                                     // [mesh, phase offset] — rotation.x = −st/RC + offset
    // tooth phase (see sprocketGeometry): a roller at arclength s seats in a valley when the
    // sprocket angle β satisfies α + β = π − θ (top) / −θ (bottom); solved once here
    const phTop = Math.PI + H / RC, phBot = Math.PI + 2 * H / RC;
    for (const x of [xL, xR]){
      spin.push([mesh(sprGeo, M.steel, x, yT, gzc), phTop], [mesh(sprGeo, M.steel, x, yB, gzc), phBot]);
    }
    for (const ys of [yT, yB]){ const sh = mesh(shaftGeo, M.steel, cx, ys, gzc); sh.scale.x = hw; }   // the line shaft
    for (const side of [-1, 1]){
      const xEnd = side < 0 ? xL - END : xR + END;      // housing end wall
      const xg = xEnd + side * .14;                     // gear plane
      const xc = xEnd + side * .5;                      // column centre
      mesh(colGeo, M.gun, xc, floorY + colH / 2, gzc);
      mesh(footGeo, M.gunDk, xc, floorY + .17, gzc);
      for (const ys of [yT, yB]){
        spin.push([mesh(gearGeo, M.steel, xg, ys, gzc), 0], [mesh(hubGeo, M.glow, xg + side * .1, ys, gzc), 0]);
        mesh(ringGeo, M.brass, xg + side * .08, ys, gzc);
        const sh = mesh(shaftGeo, M.steel, (xEnd + xc) / 2, ys, gzc); sh.scale.x = Math.abs(xc - xEnd);
        mesh(bearGeo, M.brass, xc, ys, gzc);
        mesh(lampGeo, M.glow, xc, ys, gzc + .31);                       // bearing tell-tale, faces the room
      }
    }
    mesh(braceGeo, M.gun, cx, B - CROWN - 1.2, gzc);     // tie the columns under the bottom housing

    /* ---------- the two roller chains: an instanced loop around each sprocket pair ---------- */
    const linkGeo = keep(linkGeometry(pitch));
    const chains = new THREE.InstancedMesh(linkGeo, M.chain, 2 * NL);
    chains.frustumCulled = false;
    group.add(chains);
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

    /* ---------- the MAGNET CRANE (top housing): a rail across the window, a carriage that
       runs along it, a telescoping jib out through the open front, a winch cable and the
       electromagnet. It flies every CRANE HOP of the voice (long notes + the loop seam):
       loaded, it rides the LANE just above the lip in front of the housing. Every pose is craneAt(plan, songTime) — the same pure fn main uses
       for the marble, so the ball and its magnet can never disagree. ---------- */
    let crane = null;
    if (track.crane){
      const pl = track.crane, c0 = B + UPY;              // heights in the plan are from the contact level
      const RAIL_Y = B + CROWN - .32, JIB_Y = RAIL_Y - .34, RAIL_Z = CRANE.PARK_Z + .05;
      const railGeo = keep(new THREE.BoxGeometry(hw - .4, .1, .22));
      const webGeo  = keep(new THREE.BoxGeometry(hw - .4, .14, .05));
      mesh(railGeo, M.rod, cx, RAIL_Y + .1, RAIL_Z); mesh(railGeo, M.rod, cx, RAIL_Y - .1, RAIL_Z);
      mesh(webGeo, M.gunDk, cx, RAIL_Y, RAIL_Z);
      const car  = mesh(keep(new RoundedBoxGeometry(.6, .34, .42, 2, .06)), M.gun, 0, RAIL_Y - .26, RAIL_Z);
      const drum = mesh(keep(new THREE.CylinderGeometry(.11, .11, .44, 16).rotateZ(Math.PI / 2)), M.brass, 0, JIB_Y - .02, RAIL_Z);
      const tell = mesh(keep(new THREE.CylinderGeometry(.06, .06, .03, 16).rotateX(Math.PI / 2)), M.glow, 0, RAIL_Y - .26, RAIL_Z + .22);
      const jib  = mesh(keep(new THREE.BoxGeometry(.12, .1, 1)), M.steel, 0, JIB_Y, RAIL_Z);
      const tip  = mesh(keep(new THREE.CylinderGeometry(.08, .08, .14, 14).rotateZ(Math.PI / 2)), M.brass, 0, JIB_Y, 0);
      const cable = mesh(keep(new THREE.CylinderGeometry(.014, .014, 1, 6)), M.cable, 0, 0, 0);
      const mr = Math.max(.24, pl.r * 1.15);
      const magGeo = keep(merge([
        new THREE.CylinderGeometry(mr, mr * 1.04, .3, 24).translate(0, .15 + .05, 0),
        new THREE.CylinderGeometry(mr * .55, mr * .7, .12, 18).translate(0, .41, 0),
        new THREE.CylinderGeometry(.05, .05, .12, 8).translate(0, .52, 0),
      ]));
      const mag  = mesh(magGeo, M.steel, 0, 0, 0);
      const coilMat = new THREE.MeshStandardMaterial({ color: 0x331a10, emissive: new THREE.Color(0xff5a1e), emissiveIntensity: .15 });
      const coil = mesh(keep(new THREE.TorusGeometry(mr * .9, .055, 10, 32).rotateX(Math.PI / 2)), coilMat, 0, 0, 0);
      const face = mesh(keep(new THREE.CylinderGeometry(mr * .96, mr * .96, .05, 24)), M.gunDk, 0, 0, 0);
      const ICE = new THREE.Color(0x8fd8ff), HOT = new THREE.Color(0xff5a1e), _c = new THREE.Color();
      crane = (t) => {
        const m = craneAt(pl, t);
        const fy = c0 + m.y;                             // magnet FACE (the marble's top) in local y
        const recoil = !m.loaded && m.sinceRelease >= 0 && m.sinceRelease < .5 ? .05 * Math.exp(-m.sinceRelease * 10) * Math.sin(m.sinceRelease * 40) : 0;
        face.position.set(m.x, fy + .025 + recoil, m.z);
        mag.position.set(m.x, fy + recoil, m.z);
        coil.position.set(m.x, fy + .07 + recoil, m.z);
        car.position.x = drum.position.x = tell.position.x = m.x;
        const jz0 = RAIL_Z + .1, jz1 = Math.max(jz0 + .05, m.z);
        jib.position.set(m.x, JIB_Y, (jz0 + jz1) / 2); jib.scale.z = jz1 - jz0 + .1;
        tip.position.set(m.x, JIB_Y, m.z);
        const top = fy + .58 + recoil, len = Math.max(.02, JIB_Y - top);
        cable.position.set(m.x, top + len / 2, m.z); cable.scale.y = len;
        drum.rotation.x = -len / .11;                    // the winch drum pays out the cable it shows
        // coil: energises as the marble arrives, CLACKS bright on docking, holds, ICE discharge on release
        // (one magnet serves every CRANE HOP of the voice: each dock clacks, each release discharges)
        let on = m.coil;
        if (m.loaded) on = m.phase === 'armed' ? 1 : 1 + 2.4 * Math.exp(-Math.max(0, m.sinceDock) * 8);
        const dis = !m.loaded && m.sinceRelease >= 0 ? Math.exp(-m.sinceRelease * 18) : 0;
        _c.copy(HOT).lerp(ICE, Math.min(1, dis * 1.4));
        coilMat.emissive.copy(_c);
        coilMat.emissiveIntensity = .15 + 3.2 * on + 4 * dis;
        tell.material = on > .5 ? M.glow : M.gunDk;
      };
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
        // shafts: ω = v / RC; sprockets phase-locked to the links, drive gears share the shaft
        const ang = -st / RC;
        for (const [m, ph] of spin) m.rotation.x = ang + ph;
        if (crane) crane(songTime);
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

/* the window's back wall: a warm wash, hot at the sill, falling to dark under the crown,
   with faint vertical panel seams (both mirrored housings flip it via their own UVs) */
function warmTex(){
  const c = document.createElement('canvas'); c.width = 64; c.height = 128;
  const x = c.getContext('2d');
  const gr = x.createLinearGradient(0, 128, 0, 0);
  gr.addColorStop(0, '#ffffff'); gr.addColorStop(.35, '#6a6a6a'); gr.addColorStop(1, '#0c0c0c');
  x.fillStyle = gr; x.fillRect(0, 0, 64, 128);
  x.fillStyle = 'rgba(0,0,0,.45)'; for (let i = 0; i < 64; i += 16) x.fillRect(i, 0, 2, 128);
  const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; t.repeat.set(6, 1);
  return t;
}

/* A chain sprocket at pitch radius rc: the roller SEATS (valleys) sit at shape angles
   k·2π/N, teeth between them; a five-spoke web. Axis along x (baked, like the gear). */
function sprocketGeometry(rc, N, thick){
  const s = new THREE.Shape(), M = 10, rv = rc - .05, rt = rc + .1;
  for (let k = 0; k < N; k++){
    for (let j = 0; j < M; j++){
      const f = j / M, a = (k + f) / N * Math.PI * 2;
      const d = Math.abs(f - .5);                       // 0 at the tooth tip, .5 at a valley
      const r = d > .3 ? rv + (rc - rv) * (1 - Math.cos((.5 - d) / .2 * Math.PI / 2)) * .4
              : d > .14 ? rc + (rt - rc) * (.3 - d) / .16 : rt;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      (k || j) ? s.lineTo(x, y) : s.moveTo(x, y);
    }
  }
  for (let k = 0; k < 5; k++){
    const a0 = k / 5 * Math.PI * 2 + .22, a1 = (k + 1) / 5 * Math.PI * 2 - .22;
    const h = new THREE.Path();
    h.absarc(0, 0, rc * .72, a0, a1, false);
    h.absarc(0, 0, rc * .3, a1 - .05, a0 + .05, true);
    h.closePath();
    s.holes.push(h);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: true, bevelThickness: .012, bevelSize: .012, bevelSegments: 1, curveSegments: 8 });
  g.translate(0, 0, -thick / 2);
  g.rotateY(Math.PI / 2);
  return g;
}

/* One roller-chain link (pitch long, along local +y): two side plates + a roller. */
function linkGeometry(pitch){
  const parts = [];
  for (const sx of [-1, 1]) parts.push(new RoundedBoxGeometry(.035, pitch * 1.22, .15, 1, .014).translate(sx * .08, pitch / 2, 0));
  parts.push(new THREE.CylinderGeometry(.052, .052, .125, 10).rotateZ(Math.PI / 2));
  parts.push(new THREE.CylinderGeometry(.024, .024, .22, 8).rotateZ(Math.PI / 2));  // pin ends
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
