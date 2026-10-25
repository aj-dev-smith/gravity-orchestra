import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { FOOT, bandOf, groundOf, clampLift } from '../src/rooms/footing.js';
import { STAGE } from '../src/rooms/common.js';
import { INSTRUMENTS } from '../src/instruments/index.js';
import { STATIONS } from '../src/instruments/stations.js';
import { glowy } from '../src/shotrig.js';

/* FOOTING — machines SET IN THE ROOM (src/rooms/footing.js): main builds every floor station
   supportless (floorY 0), measures its lowest SOLID part over the loop and stands it on the
   floor's plinth at its ground (deck = FLOOR + PLINTH − low), or as high as the user lifts it. */

describe('footing: the height law', () => {
  it('the floor came up (the June conveyor\'s −22 stood every machine on ~15 m of legs)', () => {
    expect(STAGE.FLOOR).toBe(-5.5);
  });
  it('ground: the deck at which the lowest part rests on the plinth', () => {
    expect(groundOf(0, STAGE.FLOOR)).toBeCloseTo(STAGE.FLOOR + FOOT.PLINTH, 12);
    expect(groundOf(-.35, STAGE.FLOOR) - .35).toBeCloseTo(STAGE.FLOOR + FOOT.PLINTH, 12);
    expect(groundOf(-4.17, -5.5)).toBeCloseTo(-.93, 12);          // the turntable: its resonator rank clears the floor by the plinth
  });
  it('bands by support height', () => {
    const { flush, low, mid } = FOOT.BANDS;
    expect([0, flush, flush + 1e-9, low, low + 1e-9, mid, mid + 1e-9, 30].map(bandOf))
      .toEqual(['flush', 'flush', 'low', 'low', 'mid', 'mid', 'high', 'high']);
  });
  it('a lift is clamped: finite, 0 … LIFT_MAX (anything else stands on the floor)', () => {
    expect([3, -2, 1e9, NaN, Infinity, undefined, null, '4'].map(clampLift)).toEqual([3, 0, FOOT.LIFT_MAX, 0, 0, 0, 0, 0]);
  });
});

/* a built machine's solid low over the loop, in its own frame — main.js solidLocal's rules:
   no glows, no unlit wire / LED batches; each part (instance) as its turned box ∩ its sphere's */
function solidLow(group, update, P){
  const box = new THREE.Box3(), pb = new THREE.Box3(), sp = new THREE.Sphere(), im = new THREE.Matrix4();
  let low = Infinity;
  const part = (g, m) => {
    pb.copy(g.boundingBox).applyMatrix4(m); sp.copy(g.boundingSphere).applyMatrix4(m);
    low = Math.min(low, Math.max(pb.min.y, sp.center.y - sp.radius));
  };
  const take = () => {
    group.updateMatrixWorld(true);
    group.traverse(o => {
      if (!(o.isMesh || o.isInstancedMesh) || !o.geometry?.attributes.position) return;
      for (let p = o; p && p !== group; p = p.parent) if (!p.visible) return;
      const m = [].concat(o.material)[0];
      if (!m || glowy(m) || m.isMeshBasicMaterial) return;
      const g = o.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      if (!g.boundingSphere) g.computeBoundingSphere();
      if (g.boundingBox.isEmpty()) return;
      if (!o.isInstancedMesh) part(g, o.matrixWorld);
      else for (let i = 0; i < o.count; i++){ o.getMatrixAt(i, im); part(g, im.premultiply(o.matrixWorld)); }
    });
  };
  update(-2.4, false); take();
  for (let k = 0; k < 12; k++){ update((k + .5) / 12 * P, true); take(); }
  return low;
}

describe('footing: every FLOOR machine rests on its own base when built supportless (floorY 0)', () => {
  const ROLL_T = 2.6;
  for (const I of INSTRUMENTS){
    if (STATIONS[I.key]?.hang) continue;                     // (hung: the organ loft, the chandelier, the court)
    it(`${I.key}: lowest solid part within .6 u under its deck${I.stand !== undefined ? ` — or it declares stand (${I.stand})` : ''}`, () => {
      const beat = 60 / I.demo.bpm, P = ROLL_T + I.demo.beats * beat + 1.2;
      const M = I.make({ envMap: null, glowTex: null, THREE });
      const group = M.build(I.demo.part, { rollT: ROLL_T, beat, P, start: -.6, station: STATIONS[I.key], floorY: 0, ceilY: STAGE.CEIL, loopBeats: I.demo.beats });
      const low = solidLow(group, (t, started) => M.update(t, P, 0, { started, skipStrikes: true, onStrike(){} }), P);
      expect(Number.isFinite(low), `${I.key} has solid parts`).toBe(true);
      if (I.stand === undefined){
        // a part that hangs lower than this would leave the base floating over the plinth: declare `stand`
        expect(low, `${I.key} low ${low.toFixed(2)}`).toBeGreaterThanOrEqual(-.6);
        expect(low, `${I.key} low ${low.toFixed(2)}`).toBeLessThanOrEqual(.05);
      } else {
        expect(I.stand, `${I.key}: it rests near its base`).toBeGreaterThanOrEqual(-.6);
        expect(I.stand, `${I.key}: stand ≤ 0`).toBeLessThanOrEqual(0);
        expect(low, `${I.key}: what hangs reaches below what it stands on`).toBeLessThan(I.stand);
      }
    }, 30000);
  }
});
