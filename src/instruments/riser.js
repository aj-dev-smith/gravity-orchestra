/* THE RISER — a shared open truss tower a station stands on when its deck sits far above the
   room floor (every floor station plants on STAGE.FLOOR ≈ 22 below its origin; a GALLERY station
   ≈ 36 — stations.js). Replaces the solid stage-riser box, which read as a featureless black
   monolith: four square chord posts, ring beams every few units, X-bracing on every face (wide
   faces split into bays), chrome foot plates, a thin lit edge line under the deck and at each
   front ring, and a service ladder up one end.

   Pure geometry: it only CALLS `put(mat, geo)` with already-placed BoxGeometries, so a plugin
   drops them into its own per-material merge bucket (no new materials, no lights, no meshes of
   its own). Everything stays INSIDE [x0,x1]×[z0,z1] — the footprint the staging solve measured
   for the old slab is unchanged. y1 = the riser's top (just under the plinth), y0 = the floor. */
export function riser(THREE, put, { x0, x1, z0, z1, y0, y1, dark, trim, chrome, post = .34, bar = .14, tier = 4.2, bay = 3.6, ladder = true }){
  const H = y1 - y0;
  if (!(H > .05)) return;
  const B = (mat, ax0, ax1, ay0, ay1, az0, az1) => {
    const g = new THREE.BoxGeometry(ax1 - ax0, ay1 - ay0, az1 - az0);
    g.translate((ax0 + ax1) / 2, (ay0 + ay1) / 2, (az0 + az1) / 2); put(mat, g);
  };
  // a short riser (a low floor station) is just a lit skirt — nothing to truss
  if (H < 1.2){ B(dark, x0, x1, y0, y1, z0, z1); return; }
  const p = post, h = p / 2;
  // the chords: the 4 corner posts + intermediate posts splitting the long faces into bays
  const nx = Math.max(1, Math.round((x1 - x0 - p) / bay)), nz = Math.max(1, Math.round((z1 - z0 - p) / bay));
  const xs = Array.from({ length: nx + 1 }, (_, i) => x0 + h + (x1 - x0 - p) * i / nx);
  const zs = Array.from({ length: nz + 1 }, (_, i) => z0 + h + (z1 - z0 - p) * i / nz);
  const perim = [];
  xs.forEach(x => { perim.push([x, zs[0]]); perim.push([x, zs[nz]]); });
  zs.slice(1, -1).forEach(z => { perim.push([xs[0], z]); perim.push([xs[nx], z]); });
  for (const [x, z] of perim){
    B(dark, x - h, x + h, y0, y1, z - h, z + h);
    B(chrome, x - h - .06, x + h + .06, y0, y0 + .08, z - h - .06, z + h + .06);   // foot plate
  }
  // the rings: horizontal beams round the perimeter, evenly spaced up the tower (and one at the top)
  const nt = Math.max(1, Math.round(H / tier)), ty = i => y0 + .5 + (H - .5 - bar) * i / nt;
  const b2 = bar / 2;
  for (let i = 0; i <= nt; i++){
    const y = ty(i);
    for (const z of [zs[0], zs[nz]]) B(dark, x0 + p, x1 - p, y, y + bar, z - b2, z + b2);
    for (const x of [xs[0], xs[nx]]) B(dark, x - b2, x + b2, y, y + bar, z0 + p, z1 - p);
    // a thin lit line along the FRONT ring (+z, the audience side) — the deck's edge-glow grammar
    if (i > 0) B(trim, x0 + p, x1 - p, y + bar * .35, y + bar * .65, z1 - .02, z1);
  }
  B(trim, x0, x1, y1 - .1, y1 - .05, z1 - .03, z1);                                // under the deck lip
  // X-bracing in every bay of every face (thin diagonals, inset off the chords)
  const diag = (ax, az, bx, bz, ya, yb, k) => {   // a strut from (ax, ya, az) to (bx, yb, bz)
    const dx = bx - ax, dz = bz - az, dy = yb - ya, L = Math.hypot(dx, dy, dz);
    const s = new THREE.BoxGeometry(k, L, k);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx, dy, dz).normalize());
    s.applyQuaternion(q); s.translate((ax + bx) / 2, (ya + yb) / 2, (az + bz) / 2); put(dark, s);
  };
  const k = bar * .8, ins = p * .9;
  for (let i = 0; i < nt; i++){
    const ya = ty(i) + bar, yb = ty(i + 1);
    for (let j = 0; j < nx; j++) for (const z of [zs[0], zs[nz]]){
      diag(xs[j] + ins, z, xs[j + 1] - ins, z, ya, yb, k);
      diag(xs[j + 1] - ins, z, xs[j] + ins, z, ya, yb, k);
    }
    for (let j = 0; j < nz; j++) for (const x of [xs[0], xs[nx]]){
      diag(x, zs[j] + ins, x, zs[j + 1] - ins, ya, yb, k);
      diag(x, zs[j + 1] - ins, x, zs[j] + ins, ya, yb, k);
    }
  }
  // a service ladder up the −x end, set just inside the chords (chrome rails + rungs)
  if (ladder && z1 - z0 > 2.4){
    const lx = x0 + p + .12, zc = (z0 + z1) / 2, rw = .42;
    for (const s of [-1, 1]) B(chrome, lx - .04, lx + .04, y0, y1 - .1, zc + s * rw - .04, zc + s * rw + .04);
    for (let y = y0 + .45; y < y1 - .3; y += .55) B(chrome, lx - .03, lx + .03, y, y + .05, zc - rw, zc + rw);
  }
}
