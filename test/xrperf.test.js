import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { XR_DETAIL, cullKind, isFine, makeXRDetail, collectGlow } from '../src/xrdetail.js';
import { layoutKey, lookKey, sameLook, batchGroups, makeXRBatch } from '../src/xrbatch.js';
import { menuLayout, hitButton, MENU_W, MENU_H, PER_PAGE } from '../src/xrmenu.js';

/* the VR detail profile: everything it does is TEMPORARY (undone after the headset render) and
   never touches the actors (balls), and the batch mirrors exactly what the owners posed */

const std = (o = {}) => new THREE.MeshStandardMaterial({ color: 0x808080, roughness: .4, metalness: .6, ...o });
const box = new THREE.BoxGeometry(1, 1, 1), cyl = new THREE.CylinderGeometry(.5, .5, 1, 12);

describe('xrdetail — fine-detail cull', () => {
  it('only plain parts are cullable: never balls, instanced, or tagged keepers', () => {
    expect(cullKind(new THREE.Mesh(box, std()))).toBe('solid');
    expect(cullKind(new THREE.Mesh(new THREE.SphereGeometry(.2), std()))).toBe(null);         // a marble / mallet head / striker
    expect(cullKind(new THREE.InstancedMesh(box, std(), 4))).toBe(null);
    const keep = new THREE.Mesh(box, std()); keep.userData.xrKeep = true;
    expect(cullKind(keep)).toBe(null);
    expect(cullKind(new THREE.Sprite(new THREE.SpriteMaterial()))).toBe('glow');
    expect(cullKind(new THREE.Mesh(box, new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending })))).toBe('glow');
  });
  it('angular threshold with hysteresis (no flicker at the edge)', () => {
    const t = XR_DETAIL.ang;
    expect(isFine(t * .9 * 50, 50, t)).toBe(true);
    expect(isFine(t * 1.1 * 50, 50, t)).toBe(false);
    expect(isFine(t * 1.1 * 50, 50, t, true)).toBe(true);           // already hidden: must grow past ang × hyst
    expect(isFine(t * XR_DETAIL.hyst * 1.01 * 50, 50, t, true)).toBe(false);
  });
  it('hides far fine parts for ONE render and restores every visibility, emissive and opacity', () => {
    const root = new THREE.Group();
    const bolt = new THREE.Mesh(new THREE.BoxGeometry(.05, .05, .05), std());   // tiny + far → culled
    bolt.position.set(0, 0, -60);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(6, 6, 6), std({ emissive: 0x402010, emissiveIntensity: .5 }));
    frame.position.set(0, 0, -60);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(.05), std()); ball.position.set(1, 0, -60);
    const glowMat = new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, opacity: .4 });
    const dim = new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, opacity: .01 });
    root.add(bolt, frame, ball, new THREE.Mesh(new THREE.BoxGeometry(4, 4, 4), glowMat));
    root.updateMatrixWorld(true);
    const D = makeXRDetail();
    D.setGlow(collectGlow([{ root }]));
    D.before([root], new THREE.Vector3(), [glowMat, dim]);
    D.boost();
    expect(bolt.visible).toBe(false);
    expect(frame.visible).toBe(true);
    expect(ball.visible).toBe(true);                                   // balls are the music: never culled
    expect(dim.visible).toBe(false);                                   // a dim additive glow: skipped in XR
    expect(frame.material.emissiveIntensity).toBeCloseTo(.5 * XR_DETAIL.emissive, 9);
    expect(glowMat.opacity).toBeCloseTo(Math.min(1, .4 * XR_DETAIL.glow), 9);
    D.after();
    expect(bolt.visible).toBe(true);
    expect(dim.visible).toBe(true);
    expect(frame.material.emissiveIntensity).toBe(.5);
    expect(glowMat.opacity).toBe(.4);
  });
  it('an instrument xrGlow of 1 means no boost', () => {
    const root = new THREE.Group();
    const m = std({ emissive: 0xffffff, emissiveIntensity: .7 });
    root.add(new THREE.Mesh(box, m));
    const [[mat, ke, kg]] = collectGlow([{ root, k: 1 }]);
    expect(mat).toBe(m); expect(ke).toBe(1); expect(kg).toBe(1);
  });
});

describe('xrbatch — one draw per look, mirroring the owners exactly', () => {
  const scene = () => {
    const world = new THREE.Group(), st = new THREE.Group(); world.add(st);
    const shared = std();
    const a = new THREE.Mesh(box, shared), b = new THREE.Mesh(cyl, shared);
    const c = new THREE.Mesh(box, std({ color: 0x3060a0 })), d = new THREE.Mesh(box, std({ color: 0x3060a0 }));   // separately made, same look
    const odd = new THREE.Mesh(box, std({ color: 0xff0000 }));                                                    // a look of its own
    const glass = new THREE.Mesh(box, new THREE.MeshStandardMaterial({ transparent: true, opacity: .4 }));
    a.position.x = 1; b.position.x = 2; c.position.x = 3; d.position.x = 4; odd.position.x = 5;
    st.add(a, b, c, d, odd, glass);
    return { world, st, shared, a, b, c, d, odd, glass };
  };
  it('groups by look + layout; transparent and one-off looks stay as they are', () => {
    const { world, a, b, c, d, odd, glass } = scene();
    const G = [...batchGroups(world).values()];
    expect(G.length).toBe(2);
    expect(G.find(l => l.includes(a))).toEqual(expect.arrayContaining([a, b]));   // (geometry groups don't matter with ONE material)
    expect(G.find(l => l.includes(c))).toEqual(expect.arrayContaining([c, d]));
    expect(G.flat()).not.toContain(odd);
    expect(layoutKey(glass)).toBe(null);
    expect(lookKey(c.material)).toBe(lookKey(d.material));
    expect(lookKey(c.material)).not.toBe(lookKey(odd.material));
  });
  it('copies pose + visibility, hides the originals for the render, restores them after', () => {
    const { world, st, a, b, c, d } = scene();
    const B = makeXRBatch();
    expect(B.build(world)).toBe(4);
    a.position.y = 3; world.updateMatrixWorld(true);                   // the owner moved a part this frame
    b.visible = false;                                                 // …and hid another
    B.before();
    const bm = B.group.children.find(x => x.material === a.material), m = new THREE.Matrix4();
    const ea = 0;                                                      // (a was added first)
    bm.getMatrixAt(ea, m);
    expect(new THREE.Vector3().setFromMatrixPosition(m).toArray()).toEqual([1, 3, 0]);
    expect(bm.getVisibleAt(1)).toBe(false);                            // b hidden by its owner → hidden in the batch
    expect(a.visible).toBe(false);                                     // the batch draws it this render
    B.after();
    expect(a.visible).toBe(true);
    expect(b.visible).toBe(false);                                     // the owner's own state is untouched
    st.visible = false; B.before();
    expect(B.stats.drawn).toBe(0);                                     // an ancestor hidden → nothing drawn
    B.after(); expect(a.visible).toBe(true);
  });
  it('a look-alike mid-flash draws as itself; a swapped material drops out', () => {
    const { world, c, d } = scene();
    const B = makeXRBatch(); B.build(world);
    c.material.emissive.setRGB(1, .5, 0);                              // c flashes
    B.before();
    expect(c.visible).toBe(true);                                      // drawn by itself, exactly as the owner set it
    expect(d.visible).toBe(false);                                     // its idle twin rides the batch
    expect(B.stats.own).toBe(1);
    B.after();
    d.material = std();                                                // a plugin swapped a material after build
    B.before();
    expect(d.visible).toBe(true); expect(B.stale).toBe(1);
    B.after();
  });
  it('sameLook compares the animated fields + the material version', () => {
    const x = std(), y = x.clone();
    expect(sameLook(x, y, x.version)).toBe(true);
    x.opacity = .5; expect(sameLook(x, y, x.version)).toBe(false);
    x.opacity = 1; x.needsUpdate = true; expect(sameLook(x, y, 0)).toBe(false);
  });
});

describe('xrmenu — the in-world panel layout (pure)', () => {
  const songs = Array.from({ length: 17 }, (_, i) => ({ key: 's' + i, label: 'Song ' + i }));
  const rooms = ['grid', 'cathedral', 'studio', 'void', 'graveyard', 'arena', 'starship', 'off'].map(k => ({ key: k, label: k }));
  it('transport, a page of songs, paging and the rooms all fit on the panel without overlap', () => {
    const L = menuLayout({ songs, song: 's3', page: 0, rooms, room: 'arena', playing: true });
    for (const b of L){ expect(b.x).toBeGreaterThanOrEqual(0); expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w).toBeLessThanOrEqual(MENU_W); expect(b.y + b.h).toBeLessThanOrEqual(MENU_H); }
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++){
      const a = L[i], b = L[j];
      expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y).toBe(true);
    }
    expect(L.filter(b => b.kind === 'song').length).toBe(PER_PAGE);
    expect(L.find(b => b.id === 'song:s3').on).toBe(true);
    expect(L.find(b => b.id === 'room:arena').on).toBe(true);
    expect(L.find(b => b.id === 'play').label).toBe('PAUSE');
    expect(L.find(b => b.id === 'next').value).toBe(1);
    const L2 = menuLayout({ songs, page: 1, rooms });
    expect(L2.filter(b => b.kind === 'song').length).toBe(17 - PER_PAGE);
  });
  it('AR hides the rooms (the camera feed is the room); the exit says so', () => {
    const L = menuLayout({ songs, rooms, ar: true });
    expect(L.some(b => b.kind === 'room')).toBe(false);
    expect(L.find(b => b.id === 'exit').label).toBe('EXIT AR');
  });
  it('hitButton maps a panel uv (bottom-left origin) onto the button under it', () => {
    const L = menuLayout({ songs, rooms });
    for (const b of L.filter(b => b.kind !== 'label')){
      const u = (b.x + b.w / 2) / MENU_W, v = 1 - (b.y + b.h / 2) / MENU_H;
      expect(hitButton(L, u, v).id).toBe(b.id);
    }
    expect(hitButton(L, .001, .001)).toBe(null);
  });
});
