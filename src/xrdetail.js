import * as THREE from 'three';
/* ============================================================
   XR DETAIL PROFILE — what a Quest 2 can afford, applied around the headset render ONLY.

   three r184's WebGLRenderer has no multiview: every object is drawn once PER EYE, so a full
   room from the wide (~700 objects in view) is ~1400 draw calls a frame. Quest 2 wants ≲ 300–500
   per eye at 72 Hz. This module trims what a headset can't resolve anyway, and compensates
   the glow that the missing bloom chain used to give:

   - FINE DETAIL: a machine part whose bounding sphere subtends less than `ang` (radius/distance,
     radians — ≈ 7 px on a Quest 2's ~1150 px/rad) is not drawn this frame. Additive glows get a
     slightly bigger cut (`glowAng`: they're soft). Hysteresis (`hyst`) so nothing flickers at the
     edge; re-selected every `every` frames and whenever the head moves (a teleport).
     NEVER culled: balls (sphere geometry — the marbles, mallet heads and strikers ARE the
     music), instanced / points / lines (one call for many things already), anything tagged
     `userData.xrKeep` (or under a tagged parent).
   - DIM GLOWS: an additive glow fainter than `dimGlow` isn't drawn (without bloom it's invisible).
   - GLOW COMPENSATION: emissive intensities × `emissive` and additive opacities × `glow` (or an
     instrument's own `xrGlow`, see src/instruments/README.md) for the headset render.

   Every change is TEMPORARY: applied right before renderer.render and undone right after, so the
   owners' own visibility / intensity logic never sees it (time is the only state; nothing sticks).
   The 2D page never calls any of this.
   ============================================================ */

export const XR_DETAIL = {
  ang: .0065,       // solid part: hide below this angular radius (rad)
  glowAng: .01,     // additive glow / sprite: hide below this
  hyst: 1.35,       // a hidden part returns only above ang × hyst
  every: 6,         // re-select every N frames (≤ 83 ms stale at 72 Hz)
  moved: .6,        // … or as soon as the head moved this far (world u) — a teleport
  dimGlow: .025,    // additive glows fainter than this are skipped in XR
  emissive: 1.55,   // no-bloom compensation: emissiveIntensity ×
  glow: 1.45,       // … additive opacity × (capped at 1)
};

const BALLS = new Set(['SphereGeometry', 'IcosahedronGeometry', 'OctahedronGeometry', 'DodecahedronGeometry']);

/* what kind of thing the detail pass may hide: 'solid' | 'glow' | null (never) */
export function cullKind(o){
  if (!(o.isMesh || o.isSprite) || o.isInstancedMesh || o.isSkinnedMesh || o.isReflector) return null;
  if (o.userData.xrKeep) return null;
  if (o.isMesh && BALLS.has(o.geometry?.type)) return null;
  const m = Array.isArray(o.material) ? o.material[0] : o.material;
  if (!m) return null;
  if (o.isSprite || (m.transparent && m.blending === THREE.AdditiveBlending)) return 'glow';
  return 'solid';
}

/* the culling decision (pure): radius/dist under the threshold; a part already hidden must
   grow past threshold × hyst to come back */
export function isFine(radius, dist, threshold, wasHidden = false, hyst = XR_DETAIL.hyst){
  const a = radius / Math.max(dist, 1e-6);
  return a < (wasHidden ? threshold * hyst : threshold);
}

/* scale the glow of a material set for one render, restorable (pure over plain objects) */
export function boostMaterial(m, kEmi, kGlow){
  if (m.emissive && m.emissiveIntensity > 0 && (m.emissive.r + m.emissive.g + m.emissive.b) > 0) m.emissiveIntensity *= kEmi;
  if (m.transparent && m.blending === THREE.AdditiveBlending && !m.isShaderMaterial) m.opacity = Math.min(1, m.opacity * kGlow);
}

export function makeXRDetail({ cfg = XR_DETAIL } = {}){
  let hidden = new Set(), frame = 0;
  const lastHead = new THREE.Vector3(1e9, 0, 0);
  const undoVis = [], undoMat = [], saved = [];
  const _s = new THREE.Sphere();
  let glowMats = [];                                    // [[material, kEmi, kGlow]] (re-collected by the owner)
  let stats = { hidden: 0, dimmed: 0, boosted: 0 };

  function select(roots, head){
    const next = new Set();
    const visit = o => {
      if (!o.visible || o.userData.xrKeep) return;
      const kind = cullKind(o);
      if (kind){
        const g = o.geometry;
        if (g && !g.boundingSphere) g.computeBoundingSphere();
        if (g?.boundingSphere && g.boundingSphere.radius > 0){
          _s.copy(g.boundingSphere).applyMatrix4(o.matrixWorld);
          if (isFine(_s.radius, _s.center.distanceTo(head), kind === 'glow' ? cfg.glowAng : cfg.ang, hidden.has(o), cfg.hyst)) next.add(o);
        }
      }
      for (let i = 0; i < o.children.length; i++) visit(o.children[i]);
    };
    for (const r of roots) if (r) visit(r);
    hidden = next;
    lastHead.copy(head);
  }

  return {
    /* the owner's list of glow materials and their factors (call on build / every ~second) */
    setGlow(list){ glowMats = list; },
    /* right before renderer.render: roots = what may be culled (the machines), head = world head
       position, fadeMats = the page's additive glows (dimmest skipped) */
    before(roots, head, fadeMats = []){
      if (frame++ % cfg.every === 0 || head.distanceTo(lastHead) > cfg.moved) select(roots, head);
      undoVis.length = 0; undoMat.length = 0;
      for (const o of hidden) if (o.visible){ o.visible = false; undoVis.push(o); }
      for (let i = 0; i < fadeMats.length; i++){ const m = fadeMats[i];
        if (m.visible && m.opacity < cfg.dimGlow){ m.visible = false; undoMat.push(m); } }
      stats = { hidden: undoVis.length, dimmed: undoMat.length, boosted: 0 };
    },
    /* … then (after anything that compares looks — the batch) the glow compensation */
    boost(){
      saved.length = 0;
      for (let i = 0; i < glowMats.length; i++){ const [m, ke, kg] = glowMats[i];
        saved.push(m.emissiveIntensity, m.opacity); boostMaterial(m, ke, kg); }
      stats.boosted = glowMats.length;
    },
    /* right after: undo every change (owners never see them) */
    after(){
      for (let i = 0; i < undoVis.length; i++) undoVis[i].visible = true;
      for (let i = 0; i < undoMat.length; i++) undoMat[i].visible = true;
      for (let i = 0; 2 * i < saved.length; i++){ const m = glowMats[i][0];
        if (saved[2 * i] !== undefined) m.emissiveIntensity = saved[2 * i];
        m.opacity = saved[2 * i + 1]; }
      saved.length = 0;
      undoVis.length = 0; undoMat.length = 0;
    },
    invalidate(){ frame = 0; },
    get stats(){ return stats; },
  };
}

/* collect the glow materials under `root` once, each with its factors (k = an instrument's own
   xrGlow multiplier, else the profile's). A material shared by two roots keeps the first. */
export function collectGlow(entries, cfg = XR_DETAIL){
  const seen = new Set(), out = [];
  for (const { root, k } of entries){
    if (!root) continue;
    root.traverse(o => {
      if (o.userData.xrKeep) return;
      for (const m of [].concat(o.material || [])){
        if (!m || seen.has(m) || m.userData?.xrNoBoost) continue;
        const emi = m.emissive && (m.emissive.r + m.emissive.g + m.emissive.b) > 0;
        const add = m.transparent && m.blending === THREE.AdditiveBlending && !m.isShaderMaterial;
        if (!emi && !add) continue;
        seen.add(m);
        out.push([m, k ?? cfg.emissive, Math.max(1, (k ?? cfg.emissive) * cfg.glow / cfg.emissive)]);
      }
    });
  }
  return out;
}
