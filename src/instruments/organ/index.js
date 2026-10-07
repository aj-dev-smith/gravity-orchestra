/* ============================================================
   LIGHT ORGAN — the sustained voice: organ, choir, pad chords.
   (mechanism + closed-form timing: solve.js · DSP: voice.js)

   An organ LOFT flown behind and above the belt (a hung station, centred:
   the cathedral gallery). A façade of chrome flue pipes — lowest in the
   centre, rising pitches stepping outward alternately right / left, the
   organ builder's C / C# split — stands on a dark windchest. In front of
   each pipe's foot: its own little leather BELLOWS with a chrome lid, and
   ONE marble — the bellows' weight — that lives on that lid or on that
   pipe's electromagnet, straight above it, and nowhere else.

   A note: the marble lands on the lid (or is already riding it), and its
   weight drives the lid DOWN at s/dur — the pipe speaks for exactly as
   long as the bellows exhales, so a held chord is a slow, visible breath.
   The wind leaves the mouth as LIGHT: a packet of ice-blue → white that
   runs up the pipe's face and out of its open top into the loft's air,
   its length = SPEED × duration. At note-off the bellows' spring refills
   it (the energy source: a ring flashes at its base) and kicks the marble
   back up to its magnet — or, between close notes, hops it straight back
   onto the lid, or simply carries it back up (legato). See solve.js.

   IMPORTED PARTS (routing contract — solve.js PART_LIMITS, applied by
   fitPart in build; never throws):
     · polyphony      free (one lane per pitch); ≤ 12 notes per onset kept
                      (lowest + highest + loudest inner voices)
     · pitch range    C2–C6 (MIDI 36–84) — anything outside folds by octaves
     · pitches        ≤ 36 pipes; beyond that every pitch class is kept first,
                      the rest fold by octave onto a kept pipe (or drop)
     · per pipe       onsets ≥ IOI_MIN (.12 s) apart (closer ones thinned, seam
                      too); each stroke clipped to leave ≥ GAP_MIN (.06 s)
     · durations      .06–8 s (no duration → 1 beat). Past CONT_AT (4.2 s) the
                      voice is re-sourced by a crossfaded continuation (/c id)
     · events         ≤ 768 per loop (the loudest survive)
     · timbre         per event: 'C4' organ · 'C4|choir' · 'C4|pad'
                      (aliases: vox/voice/aah → choir, strings/synth → pad)
   Render cost is O(pipes) per frame (one lane clock lookup each); ~12 draw
   calls for any part (pipes/chrome/structure merged; every moving part
   instanced; all the light in ONE shader mesh driven by a lanes×3 data
   texture). Materials and lights are constant after build.
   ============================================================ */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeEdge } from '../clock.js';
import { fitPart, organLane, laneAt, packetsAt, layoutPipes, strikeIds, RB, H_MAG, BELLOWS_R, PACKETS,
         CONT_AT, XFADE, SHORT_MAX } from './solve.js';
import { organVoice } from './voice.js';

const ICE = 0x8fd8ff, ICE_DEEP = 0x2f7fd0, AMBER = 0xffa04a;
const TINT = { organ: [.3, .62, 1], choir: [.62, .5, 1], pad: [.26, .9, .8] };   // ice · lavender · aqua (all → white when bright)
const TIMBRE_IX = { organ: 0, choir: 1, pad: 2 };
const WC_H   = .5;        // windchest height (pipes + bellows stand on it)
const CUP_H  = .42;       // bellows rest height → the lid's rest top is at WC_H + CUP_H
const Z_B    = .64;       // bellows / marble / magnet line (in front of every pipe foot)
const BEAM_TOP = 17;      // the loft's air: light fades out by here (local y)
const DECK_T = .4;
const POLE   = .12;       // magnet pole length (its face = the parked marble's top)

const idsByPart = new WeakMap();                     // build() → the exact voice ids (it knows the tempo)

/* the light: pipe-face strips + sky columns, ONE mesh. Per-vertex: lane, h (height above the
   mouth), kind (0 strip / 1 column), across (−1..1, strips), top (pipe top above the mouth). */
const LIGHT_VS = `
  attribute float aLane, aH, aKind, aU, aTop;
  varying float vLane, vH, vKind, vU, vTop, vFace;
  void main(){
    vLane = aLane; vH = aH; vKind = aKind; vU = aU; vTop = aTop;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec3 n = normalize(normalMatrix * normal);
    vFace = abs(dot(n, normalize(-mv.xyz)));
    gl_Position = projectionMatrix * mv;
  }`;
const LIGHT_FS = `
  uniform sampler2D uPk; uniform float uNL; uniform vec3 uTint[3];
  varying float vLane, vH, vKind, vU, vTop, vFace;
  void main(){
    vec3 c = vec3(0.0);
    for (int k = 0; k < ${PACKETS}; k++){
      vec4 p = texture2D(uPk, vec2((vLane + .5) / uNL, (float(k) + .5) / ${PACKETS}.0));
      if (p.z <= 0.0) continue;
      // inside the packet [tail, front], soft-edged; the head brightest (the wind's front)
      float w = smoothstep(p.y - .35, p.y + .35, vH) * (1.0 - smoothstep(p.x - .6, p.x, vH));
      float head = exp(-max(0.0, p.x - vH) * .9);
      float I = w * p.z * (.75 + .9 * head);
      vec3 t = uTint[int(p.w + .5)];
      c += I * mix(t, vec3(1.0), clamp(head * I * .5, 0.0, .55));
    }
    float a;
    if (vKind < .5) a = (1.0 - vU * vU) * .8;                                      // on the pipe's face
    else {
      float up = max(0.0, vH - vTop);
      a = vFace * vFace * exp(-up / 6.5) * (.42 + 1.1 * exp(-up * 1.5));           // the column: soft, fading into the air
    }
    gl_FragColor = vec4(c * a, 1.0);
  }`;

/* a leather bellows: unit height, pleated lathe */
function bellowsGeo(){
  const pts = [new THREE.Vector2(0, 0), new THREE.Vector2(BELLOWS_R, 0)];
  const P = 6;
  for (let i = 1; i <= 2 * P; i++) pts.push(new THREE.Vector2(i % 2 ? BELLOWS_R * .78 : BELLOWS_R, i / (2 * P)));
  pts.push(new THREE.Vector2(0, 1));
  return new THREE.LatheGeometry(pts, 20);
}
function pipeGeo(G){
  const { r, foot, top } = G;
  const pts = [new THREE.Vector2(.001, 0), new THREE.Vector2(r * .28, 0), new THREE.Vector2(r * .3, .04),
    new THREE.Vector2(r, foot - .02), new THREE.Vector2(r, top - .05), new THREE.Vector2(r * 1.06, top - .04),
    new THREE.Vector2(r * 1.06, top), new THREE.Vector2(r * .9, top), new THREE.Vector2(r * .9, top - .3)];
  return new THREE.LatheGeometry(pts, 22);
}
const placed = (geo, x, y, z, rx = 0, ry = 0, rz = 0) => {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1));
  return geo.clone().applyMatrix4(m);
};
const merge = (geos, mat) => { const g = mergeGeometries(geos.map(x => x.index ? x.toNonIndexed() : x)); geos.forEach(x => x.dispose()); return new THREE.Mesh(g, mat); };

export default {
  key: 'organ',
  label: 'Light Organ',
  wet: true,                        // the loft's air: organs live in the echo
  lookHeight: 3.9,
  camera: { dist: 18, up: 1.2, x: 0, overDeck: true },  // from in front of the loft, level with it (not from under it): façade + the light rising
  color: '#8fd8ff',                 // ice-blue → white

  voice(id){ return organVoice(id); },
  /* the exact tiered ids (build() knew the tempo); a part never built falls back to every tier
     a 100-bpm reading would need, plus LONG + SHORT for every base id */
  voiceIds(part){
    const known = idsByPart.get(part);
    if (known) return known;
    const ids = new Set();
    const { events } = fitPart(part, { rollT: 2.6, beat: .6, P: 2.6 + .6 * 64 + 1.2 });
    for (const e of events){ const s = strikeIds(e); ids.add(e.base); ids.add(`${e.base}/s`); if (s.cont) ids.add(s.cont); }
    return [...ids];
  },

  make({ envMap, glowTex }){
    let lanes = [], start = -Infinity, R = null;
    const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
    const PK = [];

    function build(part, { rollT, beat, P, start: s0 = -Infinity, station, floorY = -20 }){
      const group = new THREE.Group();
      lanes = []; start = s0; R = null;
      const { events } = fitPart(part, { rollT, beat, P });
      const ids = new Set();
      for (const e of events){ const s = strikeIds(e); ids.add(s.first); if (s.cont) ids.add(s.cont); }
      idsByPart.set(part, [...ids]);
      if (!events.length) return group;

      const byPitch = new Map();
      for (const e of events) (byPitch.get(e.pitch) || byPitch.set(e.pitch, []).get(e.pitch)).push(e);
      const { pipes, span } = layoutPipes([...byPitch.keys()]);
      const NL = pipes.length;
      const W = span + 2.4, D = 4.6;
      const rMax = Math.max(...pipes.map(p => p.G.r)), maxTop = Math.max(...pipes.map(p => p.G.top));
      const cupY = WC_H + CUP_H, magFace = cupY + H_MAG + 2 * RB, barY = magFace + POLE + .1;

      // ---- materials (constant count after build) ----
      const chrome = new THREE.MeshStandardMaterial({ color: 0xe8edf5, metalness: 1, roughness: .2, envMap, envMapIntensity: 1.7 });
      const dark   = new THREE.MeshStandardMaterial({ color: 0x1e2230, metalness: .55, roughness: .5, envMap });
      const leather = new THREE.MeshStandardMaterial({ color: 0x2b2a33, metalness: .1, roughness: .8 });
      const trim   = new THREE.MeshStandardMaterial({ color: 0x0b1a2a, emissive: new THREE.Color(ICE), emissiveIntensity: .9 });
      const glass  = new THREE.MeshStandardMaterial({ color: 0xd6ecff, metalness: .55, roughness: .08, envMap, envMapIntensity: 1.5,
        emissive: new THREE.Color(ICE_DEEP), emissiveIntensity: .55 });
      const glowM  = new THREE.MeshBasicMaterial({ color: 0xffffff });          // instanced glows: brightness = instanceColor

      // ---- static: the loft, the windchest, the case, the pipes, the magnet rail ----
      const darkG = [], chromeG = [], trimG = [];
      darkG.push(placed(new THREE.BoxGeometry(W, DECK_T, D), 0, -DECK_T / 2, 0));
      trimG.push(placed(new THREE.BoxGeometry(W + .04, .06, .06), 0, -.06, D / 2 + .01));
      trimG.push(placed(new THREE.BoxGeometry(W + .04, .06, .06), 0, -DECK_T + .03, D / 2 + .01));
      const wcZ0 = -rMax - .45, wcZ1 = Z_B + BELLOWS_R + .25;
      darkG.push(placed(new THREE.BoxGeometry(span + .9, WC_H, wcZ1 - wcZ0), 0, WC_H / 2, (wcZ0 + wcZ1) / 2));
      trimG.push(placed(new THREE.BoxGeometry(span + .94, .04, .04), 0, WC_H - .02, wcZ1 + .005));
      // the impost: a low dark screen behind the pipe feet (the pipes stand free above it)
      const caseZ = wcZ0 - .12, impH = WC_H + 1.5;
      darkG.push(placed(new THREE.BoxGeometry(span + 1.2, impH, .2), 0, impH / 2, caseZ));
      trimG.push(placed(new THREE.BoxGeometry(span + 1.24, .04, .05), 0, impH, caseZ + .08));
      // two columns carry the loft down to the room floor (behind the belt: mostly hidden by it)
      if (isFinite(floorY) && floorY < -1){
        const ch = -floorY - DECK_T;
        for (const sx of [-1, 1]){
          darkG.push(placed(new THREE.CylinderGeometry(.42, .5, ch, 16), sx * (W / 2 - .7), -DECK_T - ch / 2, -D / 2 + .7));
          darkG.push(placed(new THREE.BoxGeometry(1.3, .3, 1.3), sx * (W / 2 - .7), -DECK_T - .15, -D / 2 + .7));
        }
      }
      for (const p of pipes){
        chromeG.push(placed(pipeGeo(p.G), p.x, WC_H, 0));
        // the mouth: a dark slot on the pipe's face (the glowing languid is instanced, below)
        darkG.push(placed(new THREE.BoxGeometry(p.G.mouthW + .03, p.G.mouthH + .05, .03), p.x, WC_H + p.G.mouthY + p.G.mouthH / 2, p.G.r - .004));
        // wind duct: bellows → pipe foot
        const dz0 = Z_B - BELLOWS_R * .7, dz1 = p.G.r * .5;
        darkG.push(placed(new THREE.CylinderGeometry(.05, .05, dz0 - dz1, 8), p.x, WC_H + .1, (dz0 + dz1) / 2, Math.PI / 2));
        // magnet: hanger + pole (its face is exactly the parked marble's top)
        chromeG.push(placed(new THREE.CylinderGeometry(.06, .05, POLE, 14), p.x, magFace + POLE / 2, Z_B));
        chromeG.push(placed(new THREE.CylinderGeometry(.02, .02, barY - magFace - POLE + .02, 6), p.x, (magFace + POLE + barY) / 2, Z_B));
      }
      const barL = span + .9;
      chromeG.push(placed(new THREE.CylinderGeometry(.045, .045, barL, 12), 0, barY, Z_B, 0, 0, Math.PI / 2));
      for (const sx of [-1, 1]){
        chromeG.push(placed(new THREE.CylinderGeometry(.05, .06, barY - WC_H, 12), sx * barL / 2, (barY + WC_H) / 2, Z_B));
        chromeG.push(placed(new THREE.SphereGeometry(.08, 12, 8), sx * barL / 2, barY, Z_B));
      }
      group.add(merge(darkG, dark), merge(chromeG, chrome), merge(trimG, trim));

      // ---- instanced moving parts (one draw call each) ----
      const inst = (geo, mat, n) => { const m = new THREE.InstancedMesh(geo, mat, n); m.frustumCulled = false; m.userData.noMerge = true; group.add(m); return m; };
      const glowInst = (geo, n) => { const m = inst(geo, glowM, n); m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(3 * n), 3); return m; };
      const marbles = inst(new THREE.SphereGeometry(RB, 24, 16), glass, NL);
      const lids    = inst(new THREE.CylinderGeometry(BELLOWS_R + .012, BELLOWS_R + .012, .04, 20), chrome, NL);
      const bellows = inst(bellowsGeo(), leather, NL);
      const coils   = glowInst(new THREE.TorusGeometry(.075, .018, 8, 20).rotateX(Math.PI / 2), NL);
      const kicks   = glowInst(new THREE.TorusGeometry(BELLOWS_R + .03, .016, 6, 24).rotateX(Math.PI / 2), NL);
      const mouths  = glowInst(new THREE.PlaneGeometry(1, 1), NL);
      const crowns  = glowInst(new THREE.TorusGeometry(1, .07, 6, 22).rotateX(Math.PI / 2), NL);

      // ---- the light: one shader mesh, all lanes ----
      const pos = [], nor = [], aLane = [], aH = [], aKind = [], aU = [], aTop = [], idx = [];
      let vi = 0;
      pipes.forEach((p, li) => {
        const G = p.G, y0 = WC_H + G.mouthY, top = G.top - G.mouthY;
        // strip on the pipe's face, from the mouth to the top
        const hw = G.r * .42, z = G.r + .006;
        for (const [u, h] of [[-1, 0], [1, 0], [-1, top], [1, top]]){
          pos.push(p.x + u * hw, y0 + h, z); nor.push(0, 0, 1); aLane.push(li); aH.push(h); aKind.push(0); aU.push(u); aTop.push(top);
        }
        idx.push(vi, vi + 1, vi + 2, vi + 1, vi + 3, vi + 2); vi += 4;
        // the column above the open top
        const SEG = 10, rc = G.r * 1.05, yT = WC_H + G.top, h1 = BEAM_TOP - yT;
        for (let s = 0; s <= SEG; s++){
          const a = s / SEG * Math.PI * 2, cx = Math.cos(a), cz = Math.sin(a);
          for (const [yy, h] of [[yT, top], [BEAM_TOP, top + h1]]){
            pos.push(p.x + rc * cx * (yy === yT ? 1 : 2.2), yy, rc * cz * (yy === yT ? 1 : 2.2)); nor.push(cx, 0, cz);
            aLane.push(li); aH.push(h); aKind.push(1); aU.push(0); aTop.push(top);
          }
        }
        for (let s = 0; s < SEG; s++){ const b = vi + 2 * s; idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3); }
        vi += 2 * (SEG + 1);
      });
      const lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      lg.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      for (const [k, a] of [['aLane', aLane], ['aH', aH], ['aKind', aKind], ['aU', aU], ['aTop', aTop]]) lg.setAttribute(k, new THREE.Float32BufferAttribute(a, 1));
      lg.setIndex(idx);
      const pkData = new Float32Array(NL * PACKETS * 4);
      const pkTex = new THREE.DataTexture(pkData, NL, PACKETS, THREE.RGBAFormat, THREE.FloatType);
      pkTex.minFilter = pkTex.magFilter = THREE.NearestFilter; pkTex.needsUpdate = true;
      const light = new THREE.Mesh(lg, new THREE.ShaderMaterial({
        uniforms: { uPk: { value: pkTex }, uNL: { value: NL }, uTint: { value: Object.values(TINT).map(c => new THREE.Vector3(...c)) } },
        vertexShader: LIGHT_VS, fragmentShader: LIGHT_FS, transparent: true, blending: THREE.AdditiveBlending,
        depthWrite: false, side: THREE.DoubleSide }));
      light.frustumCulled = false; light.renderOrder = 2;
      group.add(light);

      // ---- marble halos: one Points ----
      const hPos = new Float32Array(NL * 3), hCol = new Float32Array(NL * 3);
      const hg = new THREE.BufferGeometry();
      hg.setAttribute('position', new THREE.BufferAttribute(hPos, 3));
      hg.setAttribute('color', new THREE.BufferAttribute(hCol, 3));
      const halos = new THREE.Points(hg, new THREE.PointsMaterial({ map: glowTex, size: RB * 9, vertexColors: true, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true }));
      halos.frustumCulled = false;
      group.add(halos);

      // ---- lanes ----
      pipes.forEach((p, li) => {
        const lane = organLane(byPitch.get(p.note), P);
        const G = p.G;
        lanes.push({ li, note: p.note, x: p.x, G, lane, edge: makeEdge(.25), cEdge: makeEdge(.25),
          mouthPos: new THREE.Vector3(p.x, WC_H + G.mouthY + G.mouthH / 2, G.r + .02) });
        // static instance transforms (mouth plates, crowns)
        _m.compose(_v.set(p.x, WC_H + G.mouthY + G.mouthH * .45, G.r + .018), _q.identity(), _s.set(G.mouthW, G.mouthH, 1));
        mouths.setMatrixAt(li, _m);
        _m.compose(_v.set(p.x, WC_H + G.top - .02, 0), _q.identity(), _s.set(G.r * 1.02, 1, G.r * 1.02));
        crowns.setMatrixAt(li, _m);
        _m.compose(_v.set(p.x, magFace + .03, Z_B), _q.identity(), _s.set(1, 1, 1));
        coils.setMatrixAt(li, _m);
        _m.compose(_v.set(p.x, WC_H + .02, Z_B), _q.identity(), _s.set(1, 1, 1));
        kicks.setMatrixAt(li, _m);
      });
      for (const m of [mouths, crowns, coils, kicks]) m.instanceMatrix.needsUpdate = true;
      R = { marbles, lids, bellows, coils, kicks, mouths, crowns, pkData, pkTex, hPos, hCol, halos, cupY };
      return group;
    }

    function update(songTime, P, dt, { started, skipStrikes, onStrike }){
      if (!R) return;
      const t = started ? songTime : start;
      const { marbles, lids, bellows, coils, kicks, mouths, crowns, pkData, hPos, hCol, cupY } = R;
      for (const ln of lanes){
        const { li, x, G, lane } = ln;
        const st = laneAt(lane, t, start);

        // ---- the strike: the stroke begins (a landing, or a legato re-press), once ----
        if (started && !st.armed && ln.edge.check(st.abs, st.since, skipStrikes)){
          const r = lane.rec[st.i], first = st.abs <= st.first + 1e-9, impact = first || r.arrive !== 'ride';
          const dur = r.dur <= SHORT_MAX ? r.dur : r.ids.cont ? CONT_AT + XFADE : r.dur;
          onStrike && onStrike({ note: r.ids.first, vel: r.vel, pos: ln.mouthPos.clone(), color: ICE, dur,
            shake: 0, sparks: impact ? 3 : 0, light: .55 });
        }
        // …and a note held past the render is re-sourced under itself (no visual event)
        if (started && !st.armed){
          const r = lane.rec[st.i];
          if (r.ids.cont && ln.cEdge.check(st.abs + CONT_AT, st.since - CONT_AT, skipStrikes))
            onStrike && onStrike({ note: r.ids.cont, vel: r.vel, pos: ln.mouthPos.clone(), color: ICE, dur: r.dur - CONT_AT,
              shake: 0, sparks: 0, light: 0 });
        }

        // ---- the marble, the lid, the bellows ----
        const lidY = cupY + st.lid;
        _m.compose(_v.set(x, cupY + st.y + RB, Z_B), _q.identity(), _s.set(1, 1, 1)); marbles.setMatrixAt(li, _m);
        _m.compose(_v.set(x, lidY - .02, Z_B), _q.identity(), _s.set(1, 1, 1)); lids.setMatrixAt(li, _m);
        _m.compose(_v.set(x, WC_H, Z_B), _q.identity(), _s.set(1, Math.max(.02, lidY - .04 - WC_H), 1)); bellows.setMatrixAt(li, _m);

        // ---- the light packets → the data texture ----
        const pk = packetsAt(lane, t, start, PK);
        let mouth = 0, crown = 0;
        for (let k = 0; k < PACKETS; k++){
          const o = 4 * (k * lanes.length + li), q = pk[k];
          if (q && q.tail < BEAM_TOP + 10){
            pkData[o] = q.front; pkData[o + 1] = q.tail; pkData[o + 2] = .35 + .6 * q.vel; pkData[o + 3] = TIMBRE_IX[q.timbre] ?? 0;
            const body = G.top - G.mouthY;
            if (k === 0) mouth = q.tail <= 0 ? Math.min(1, q.front / .35) : Math.exp(-(q.tail / 7) * 9);
            if (q.front >= body && q.tail <= body) crown = Math.max(crown, Math.min(1, (q.front - body) / .5) * (.45 + .55 * q.vel));
          } else { pkData[o] = pkData[o + 1] = pkData[o + 2] = pkData[o + 3] = 0; }
        }
        const tint = TINT[pk[0]?.timbre] || TINT.organ;
        const mb = .06 + 2.6 * mouth;
        mouths.setColorAt(li, _c.setRGB(tint[0] * mb + mouth * .4, tint[1] * mb + mouth * .4, tint[2] * mb + mouth * .4));
        const cb = .03 + 2.2 * crown;
        crowns.setColorAt(li, _c.setRGB(tint[0] * cb, tint[1] * cb, tint[2] * cb));

        // ---- the magnet holds (amber), the refill spring kicks (ice) ----
        const hold = st.held ? 1 : 0;
        const ca = .04 + 2.2 * hold;
        coils.setColorAt(li, _c.setRGB(ca, ca * .55, ca * .2));
        const kk = isFinite(st.sinceKick) ? Math.exp(-st.sinceKick * 9) : 0;
        const ka = .03 + 2.4 * kk;
        kicks.setColorAt(li, _c.setRGB(.56 * ka, .85 * ka, ka));

        // ---- the marble's halo: brightest while its weight is making the pipe speak ----
        hPos[3 * li] = x; hPos[3 * li + 1] = cupY + st.y + RB; hPos[3 * li + 2] = Z_B;
        const land = isFinite(st.sinceLand) ? Math.exp(-st.sinceLand * 7) : 0;
        const hb = st.sounding ? .55 + .5 * land : st.held ? .28 : .2;
        hCol[3 * li] = hb * (st.held ? 1 : .6); hCol[3 * li + 1] = hb * (st.held ? .7 : .88); hCol[3 * li + 2] = hb * (st.held ? .4 : 1);
      }
      for (const m of [marbles, lids, bellows]) m.instanceMatrix.needsUpdate = true;
      for (const m of [coils, kicks, mouths, crowns]) m.instanceColor.needsUpdate = true;
      R.pkTex.needsUpdate = true;
      R.halos.geometry.attributes.position.needsUpdate = true;
      R.halos.geometry.attributes.color.needsUpdate = true;
    }

    return { build, update };
  },

  /* "Lumen" — an original 16-bar-beat chorale in A minor at 80 bpm (12 s + the breath).
     · a held organ PEDAL (A2 for 8 beats = 6 s → the continuation voice; then F2, E2)
     · four-voice organ chords on every half-bar, LEGATO (re-pressed common tones RIDE their
       bellows back up) in the first half, DETACHED in the second (gaps → kicked HOPS)
     · a CHOIR soprano line over bars 3–4; a PAD arpeggio shimmering up at beat 6 and a
       quick PAD run cascading down at the cadence (every marble PARKS between)
     [beat, id, vel, durBeats] */
  demo: {
    bpm: 80, beats: 16,
    part: [
      // pedal
      [0, 'A2', .9, 7.8], [8, 'F2', .85, 3.8], [12, 'E2', .85, 3.9],
      // chords: Am – F – G – Em (legato: 1.9 of 2 beats)
      [0, 'A3', .7, 1.9], [0, 'C4', .65, 1.9], [0, 'E4', .65, 1.9], [0, 'A4', .75, 1.9],
      [2, 'A3', .65, 1.9], [2, 'C4', .6, 1.9], [2, 'F4', .65, 1.9], [2, 'C5', .75, 1.9],
      [4, 'G3', .7, 1.9], [4, 'B3', .6, 1.9], [4, 'D4', .65, 1.9], [4, 'B4', .75, 1.9],
      [6, 'G3', .65, 1.9], [6, 'B3', .6, 1.9], [6, 'E4', .65, 1.9], [6, 'G4', .7, 1.9],
      // pad arpeggio over the Em
      [6, 'E5|pad', .55, 1.5], [6.5, 'G5|pad', .55, 1.2], [7, 'B5|pad', .6, .9], [7.5, 'E5|pad', .5, .45],
      // Am – Dm – E – Am (detached: 1.4 of 2 beats) + the choir soprano
      [8, 'A3', .7, 1.4], [8, 'C4', .65, 1.4], [8, 'E4', .65, 1.4],
      [10, 'A3', .65, 1.4], [10, 'D4', .6, 1.4], [10, 'D3', .55, 1.4],
      [12, 'G#3', .7, 1.4], [12, 'B3', .6, 1.4], [12, 'E4', .65, 1.4],
      [14, 'A3', .75, 1.9], [14, 'C4', .7, 1.9], [14, 'E4', .7, 1.9],
      [8, 'A4|choir', .7, 1.9], [10, 'F4|choir', .7, 1.9], [12, 'G#4|choir', .75, 1.9], [14, 'A4|choir', .8, 1.9],
      // the cadence run (pad), cascading down into the final chord
      [13, 'E5|pad', .55, .4], [13.25, 'D5|pad', .5, .4], [13.5, 'C5|pad', .5, .4], [13.75, 'B4|pad', .5, .35],
    ],
  },
};
