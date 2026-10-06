import * as THREE from 'three';

/* ============================================================
   PERF TUNE — render-time tweaks over a built scene that change
   nothing you can see. Each one is a fact about how three.js draws,
   proven safe for the material/geometry it touches.
   ============================================================ */

const _box = new THREE.Box3();
const flatGeo = g => {
  if (!g) return false;
  if (g.type === 'PlaneGeometry' || g.type === 'RingGeometry' || g.type === 'CircleGeometry' || g.type === 'ShapeGeometry') return true;
  if (!g.attributes?.position) return false;
  if (!g.boundingBox) g.computeBoundingBox();
  _box.copy(g.boundingBox);
  const s = _box.max.sub(_box.min);
  return Math.min(s.x, s.y, s.z) < 1e-5;
};

/* DOUBLE-SIDED TRANSPARENT → SINGLE PASS where that is invisible.
   three.js draws a transparent DoubleSide material TWICE (back faces, then front) and flips
   material.side between them — which bumps the material version, so every such object also
   re-validates its shader program twice a frame (two draw calls + two program lookups).
   That split only exists to sort a closed glass shape's back wall behind its front wall:
   · ADDITIVE blending is order-independent — back-then-front sums to the same light;
   · a FLAT surface (plane / ring / circle / any zero-thickness geometry) has one face
     toward the camera at a time, so the "other" pass draws nothing.
   Both get forceSinglePass. Everything else (real transparent solids) is left alone.
   (Additive only counts with depthWrite OFF: an additive shell that writes depth would let its
   front pass hide its own back faces — order matters again.)
   Re-run every couple of seconds to catch late-built parts, so it remembers what it already
   judged: a (mesh, material) pair is checked once, ever (WeakMap — dies with the mesh). A material turned
   single-pass here goes back to two passes if a later user of it turns out unsafe. */
const seen = new WeakMap();                              // mesh → the material it was judged with
const unsafe = new WeakSet();                            // a material some user disqualified (stays 2-pass)
const ours = new WeakSet();                              // materials this pass made single-pass
export function singlePassFlats(root){
  const ok = new Map();                                  // material → every NEW user qualifies (a shared material must be safe for all)
  root.traverse(o => {
    if (!o.isMesh || seen.get(o) === o.material) return;
    seen.set(o, o.material);
    for (const m of [].concat(o.material || [])){
      if (!m.transparent || m.side !== THREE.DoubleSide || (m.forceSinglePass && !ours.has(m)) || unsafe.has(m)) continue;
      const safe = (m.blending === THREE.AdditiveBlending && !m.depthWrite) || flatGeo(o.geometry);
      if (!safe){ unsafe.add(m); if (ours.has(m)){ m.forceSinglePass = false; ours.delete(m); } }
      ok.set(m, (ok.get(m) ?? true) && safe);
    }
  });
  let n = 0;
  for (const [m, safe] of ok) if (safe && !m.forceSinglePass){ m.forceSinglePass = true; ours.add(m); n++; }
  return n;
}

