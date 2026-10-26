import * as THREE from 'three';
import { STAGE } from './common.js';
/* ============================================================
   GREYBOX SHADING — the ONE world grid every Greybox surface draws (src/rooms/grid.js: its floor,
   walls and ceiling; src/rooms/grid-footing.js: what the machines stand on). A line is a pure fn of
   the world point, so a plinth's top carries the floor's own cells, a slab's side carries the floor's
   lines up its face, and the walls carry them on up — the grid folds up out of the floor, and every
   surface agrees with every other by construction.

     minor lines every GRID.MINOR (2 u) on even x / z (and, on walls, every 2 u up from the floor);
     majors every GRID.MAJOR (8 u) on x, z ≡ GRID.OFF (mod 8) — where the June canvas grid had them.

   Lines are anti-aliased by their pixel footprint and fade by COVERAGE once thinner than a pixel
   (they thin into the distance instead of fattening into moiré — the Void's horizon grid trick).
   `gridPatch(material, opts)` adds it to a MeshStandardMaterial (lit + fogged like everything else):
   the lines' albedo and their self-light. It stays a standard material — the shot solve counts it
   solid (shotrig roomSolids skips ShaderMaterial / transparent / additive).
   ============================================================ */

export const GRID = { MINOR: 2, MAJOR: 8, OFF: 2 };
/* the room's line colour (the June grid's major line, #82b4ff) and its dark field (#0a0b15) */
export const LINE = 0x82b4ff, FIELD = 0x0a0b15;

/* GLSL: the grid's line masks at a world point w on a face of normal n. Returns (minor, major).
   A family of lines is drawn only on faces it crosses (x = const lines need x to vary along the
   face: a wall facing ±x never shows them — it would light up whole). hor: horizontal lines (walls). */
export const GRID_GLSL = /* glsl */`
  float gLine(float v, float hw){
    float d = abs(fract(v - .5) - .5), fw = max(fwidth(v), 1e-4);
    return (1. - smoothstep(hw - fw * .5, hw + fw * .5, d)) * min(1., hw * 2. / fw);
  }
  vec2 gGrid(vec3 w, vec3 n, float floorY, float hor, float hm, float hM){
    vec3 a = abs(n);
    float ex = clamp((1. - a.x) * 3., 0., 1.), ez = clamp((1. - a.z) * 3., 0., 1.), ey = clamp((1. - a.y) * 3., 0., 1.) * hor;
    float y = w.y - floorY;
    float mi = max(max(gLine(w.x * ${(1 / GRID.MINOR).toFixed(4)}, hm) * ex, gLine(w.z * ${(1 / GRID.MINOR).toFixed(4)}, hm) * ez), gLine(y * ${(1 / GRID.MINOR).toFixed(4)}, hm) * ey);
    float ma = max(max(gLine((w.x - ${GRID.OFF.toFixed(1)}) * ${(1 / GRID.MAJOR).toFixed(4)}, hM) * ex, gLine((w.z - ${GRID.OFF.toFixed(1)}) * ${(1 / GRID.MAJOR).toFixed(4)}, hM) * ez),
                   gLine(y * ${(1 / GRID.MAJOR).toFixed(4)}, hM) * ey);
    return vec2(mi, ma);
  }`;

/* Add the world grid to a MeshStandardMaterial (in place). opts:
     floor   the y the horizontal lines count from (STAGE.FLOOR)
     hor     1: horizontal lines too (walls) · 0: none (floor, plinths)
     minorW / majorW  line FULL widths in u
     minorAlb / majorAlb  the lines' albedo (mixed over the material's colour by the mask): a hex, or [r, g, b] linear
     minorEmi / majorEmi  the lines' self-light: [colour, intensity] (colour a hex, or [r, g, b] linear)
     fade    [y0, y1, k]: above y0 the walls' lines dim toward k at y1 (the room's height recedes)
     extra   { uniforms, head, body } — more GLSL: head at file scope, body after the grid
             (sees gW, gN, gM = vec2(minor, major) masks; adds to totalEmissiveRadiance)
   Returns the uniforms (shared with the compiled program: write .value to animate). */
export function gridPatch(mat, {
  floor = STAGE.FLOOR, hor = 0, minorW = .036, majorW = .096,
  minorAlb = 0x30416e, majorAlb = 0x76a3e7, minorEmi = [0x5578cd, .07], majorEmi = [LINE, .3],
  fade = null, key = 'grid', extra = null,
} = {}){
  // a colour: a hex (sRGB, as any three Color) or [r, g, b] LINEAR (the June canvas grid's texels were used raw)
  const col = (v, k = 1) => (Array.isArray(v) ? new THREE.Color().setRGB(v[0], v[1], v[2]) : new THREE.Color(v)).multiplyScalar(k);
  const U = {
    gFloor: { value: floor }, gHor: { value: hor }, gHm: { value: minorW / 2 / GRID.MINOR }, gHM: { value: majorW / 2 / GRID.MAJOR },
    gAlbMi: { value: col(minorAlb) }, gAlbMa: { value: col(majorAlb) },
    gEmiMi: { value: col(minorEmi[0], minorEmi[1]) }, gEmiMa: { value: col(majorEmi[0], majorEmi[1]) },
    gFade: { value: new THREE.Vector3(...(fade || [1e6, 1e6 + 1, 1])) },
    ...(extra?.uniforms || {}),
  };
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 gW;\nvarying vec3 gN;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        gW = (modelMatrix * vec4(transformed, 1.)).xyz;
        gN = normalize(mat3(modelMatrix) * objectNormal);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 gW; varying vec3 gN;
        uniform float gFloor, gHor, gHm, gHM; uniform vec3 gAlbMi, gAlbMa, gEmiMi, gEmiMa, gFade;
        ${GRID_GLSL}
        ${extra?.head || ''}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec3 gNn = normalize(gN);
        vec2 gM = gGrid(gW, gNn, gFloor, gHor, gHm, gHM);
        float gK = mix(1., gFade.z, smoothstep(gFade.x, gFade.y, gW.y));
        diffuseColor.rgb = mix(diffuseColor.rgb, gAlbMi, gM.x * .8 * gK);
        diffuseColor.rgb = mix(diffuseColor.rgb, gAlbMa, gM.y * gK);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += (gEmiMi * gM.x + gEmiMa * gM.y) * gK;
        ${extra?.body || ''}`);
  };
  mat.customProgramCacheKey = () => 'greybox:' + key;
  mat.userData.gridU = U;                                         // (dev probes read the live uniforms here)
  return U;
}
