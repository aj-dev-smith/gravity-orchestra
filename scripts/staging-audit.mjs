#!/usr/bin/env node
/* STAGING + DIRECTOR AUDIT — every song × every room, headless (its own browser).
     node scripts/staging-audit.mjs --base http://localhost:5191 [--rooms grid,cathedral,…]
       [--songs k1,k2] [--midi /midi/room-tour.mid,/midi/canon-in-d.mid] [--rate 4]
       [--shots <dir>] [--json out.json] [--detail 1] [--live 1] [--norun 1]
       [--fixture test/fixtures/staging-rooms.json]   (the measured rooms test/staging-audit.test.js replays) [--size 1200x800]
   Per song: footprint overlaps (station ↔ station ↔ drums ↔ belt bays, + the room's own
   standing geometry: graves, piers, gate piers), every director shot's occlusion (5×3 rays
   from the eye through the frame's middle; a hit on anything but the subject — another
   machine OR the room — counts as blocked), how much of the subject the shot frames, then the
   director run over a full loop at --rate: its cut list, frames whose belt shot loses the
   lead marble, frames whose camera eye sits inside a machine, glides through geometry.
   --shots writes stage + every station shot per song (first room only). Needs ?debug. */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const A = {};
for (let i = 2; i < process.argv.length; i += 2) A[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
const BASE = A.base || 'http://localhost:5191';
const ROOMS = (A.rooms || 'grid,cathedral,studio,void,graveyard').split(',');
const MIDI = (A.midi ?? '/midi/room-tour.mid,/midi/canon-in-d.mid').split(',').filter(Boolean);
const RATE = +(A.rate || 4);
const [W, H] = (A.size || '1200x800').split('x').map(Number);
const exe = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium`].find(p => fs.existsSync(p));
const browser = await puppeteer.launch({ executablePath: exe, headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  defaultViewport: { width: W, height: H } });
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---- in-page probes (run inside the page; THREE comes from __dev.three) ---- */
function probeStatic(){
  const D = window.__dev, T = D.three, world = D.world, cam = D.camera;
  const ROOMB = D.stage || { HW: 38, FLOOR: -22, CEIL: 36, BACK: -34, FRONT: 42 };   // the floor contract (rooms/common.js STAGE)
  const owner = o => { while (o.parent && o.parent !== world) o = o.parent; return o; };
  const roomGroups = D.scene.children.filter(c => c !== world && c.isGroup && c.visible && !c.getObjectsByProperty('isLight', true).length);   // (rooms own no lights; marble rigs carry a lamp)
  // the room's STANDING geometry (opaque meshes that rise off the floor and aren't sky/walls far away)
  const solid = [];
  const _b = new T.Box3(), _m = new T.Matrix4();
  for (const g of roomGroups) g.traverse(o => {
    if (!(o.isMesh || o.isInstancedMesh) || !o.visible) return;
    const m = [].concat(o.material)[0];
    if (!m || m.transparent || m.blending === T.AdditiveBlending || m.side === T.BackSide || m.isShaderMaterial) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    const n = o.isInstancedMesh ? o.count : 1;
    for (let i = 0; i < n; i++){
      _b.copy(o.geometry.boundingBox);
      if (o.isInstancedMesh){ o.getMatrixAt(i, _m); _b.applyMatrix4(_m); }
      _b.applyMatrix4(o.matrixWorld);
      const sx = _b.max.x - _b.min.x, sz = _b.max.z - _b.min.z;
      if (sx > 40 || sz > 40) continue;                                  // floors, walls, decks: not standing obstacles
      if (_b.max.y < ROOMB.FLOOR + 1) continue;                         // flush with the floor
      solid.push({ name: o.name || o.geometry.type, b: [_b.min.x, _b.max.x, _b.min.y, _b.max.y, _b.min.z, _b.max.z] });
    }
  });
  const boxes = D.boxes();
  const keys = Object.keys(boxes).filter(k => boxes[k]);
  const ov = (a, b) => Math.min(a[1][0], b[1][0]) - Math.max(a[0][0], b[0][0]) > .05 && Math.min(a[1][2], b[1][2]) - Math.max(a[0][2], b[0][2]) > .05;
  const overlaps = [];
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++){
    const a = keys[i], b = keys[j];
    if (a.startsWith('belt:') && b.startsWith('belt:')) continue;
    if (a === 'ricochet' || b === 'ricochet') continue;             // the chandelier hangs OVER the belt by design (checked by y below)
    if (ov(boxes[a], boxes[b])){
      // a y-overlap too? (boxes are [min,max] of [x,y,z])
      const yo = Math.min(boxes[a][1][1], boxes[b][1][1]) - Math.max(boxes[a][0][1], boxes[b][0][1]);
      if (yo > .05){
        const dx = Math.min(boxes[a][1][0], boxes[b][1][0]) - Math.max(boxes[a][0][0], boxes[b][0][0]);
        const dz = Math.min(boxes[a][1][2], boxes[b][1][2]) - Math.max(boxes[a][0][2], boxes[b][0][2]);
        overlaps.push(`${a}×${b} ${dx.toFixed(1)}×${dz.toFixed(1)}`);
      }
    }
  }
  if (boxes.ricochet) for (const k of keys) if (k !== 'ricochet'){
    const a = boxes.ricochet, b = boxes[k];
    if (ov(a, b) && Math.min(a[1][1], b[1][1]) - Math.max(a[0][1], b[0][1]) > .05 && k !== 'belt:lead' && !k.startsWith('belt:')) overlaps.push(`ricochet×${k} (3D)`);
  }
  for (const k of keys){ const a = boxes[k];
    for (const s of solid) if (Math.min(a[1][0], s.b[1]) - Math.max(a[0][0], s.b[0]) > .05 && Math.min(a[1][2], s.b[5]) - Math.max(a[0][2], s.b[4]) > .05
      && Math.min(a[1][1], s.b[3]) - Math.max(a[0][1], s.b[2]) > .05) overlaps.push(`${k}×room:${s.name}`); }
  // per-shot occlusion: 5×3 rays, eye → frame middle; hit order over world + the room's solids
  const shotSelf = k => k === 'strings' ? 'bass' : k;
  const name = g => { const b = D.boxes; return g; };
  const groups = {};                                                // name → world child
  const inst = D.instruments();
  world.children.forEach(c => { c.updateMatrixWorld(true); });
  const nameOf = o => {                                             // match occlusion()'s naming via box containment of the owner
    const own = owner(o); return own.uuid; };
  // map instrument key → owner group: the group whose world box matches boxes()[key]
  const ownerKey = new Map();
  const vis = (root) => { const out = new T.Box3(); root.traverse(o => { if ((o.isMesh || o.isInstancedMesh) && o.visible){ if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); out.union(_b.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld)); } }); return out; };
  for (const c of world.children){
    const b = vis(c); if (b.isEmpty()) continue;
    let best = null, bd = Infinity;
    for (const k of keys){ const q = boxes[k]; const d = Math.abs(q[0][0] - b.min.x) + Math.abs(q[1][0] - b.max.x) + Math.abs(q[0][2] - b.min.z) + Math.abs(q[1][2] - b.max.z);
      if (d < bd){ bd = d; best = k; } }
    ownerKey.set(c, bd < 3 ? best : c.type);
  }
  const drawn = o => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
  const rc = new T.Raycaster(); rc.camera = cam;
  const Y = new T.Vector3(0, 1, 0);
  const roomMeshes = [];
  for (const g of roomGroups) g.traverse(o => { if ((o.isMesh || o.isInstancedMesh) && o.visible){ const m = [].concat(o.material)[0];
    if (m && !m.transparent && m.blending !== T.AdditiveBlending && m.side !== T.BackSide && !m.isShaderMaterial) roomMeshes.push(o); } });
  const shots = D.shots.concat(D.wide?.eye ? [{ key: 'stage', eye: D.wide.eye.toArray(), aim: D.wide.aim.toArray() }] : []);
  const occ = {};
  const aspect = 1.5, fov = 55;
  for (const sh of shots){
    const eye = new T.Vector3(...sh.eye), aim = new T.Vector3(...sh.aim);
    const fwd = aim.clone().sub(eye).normalize(), R = new T.Vector3().crossVectors(fwd, Y).normalize(), U = new T.Vector3().crossVectors(R, fwd);
    const dist = eye.distanceTo(aim), self = shotSelf(sh.key);
    let blocked = 0, selfHits = 0, by = {};
    for (const sx of [-.3, -.15, 0, .15, .3]) for (const sy of [-.15, 0, .15]){
      rc.set(eye, fwd.clone().addScaledVector(R, sx).addScaledVector(U, sy).normalize()); rc.far = dist * .9;
      const h = rc.intersectObjects([world, ...roomMeshes], true).find(i => (i.object.isMesh || i.object.isInstancedMesh) && drawn(i.object)
        && !(i.object.material?.blending === T.AdditiveBlending) && !i.object.material?.transparent);
      if (!h) continue;
      let n = 'room';
      for (let p = h.object; p; p = p.parent) if (p.parent === world){ n = ownerKey.get(p) || p.type; break; }
      if (n === self || (self === 'stage')) selfHits++;
      else { blocked++; by[n] = (by[n] || 0) + 1; }
    }
    // framing: the subject's box corners in a 55° / 3:2 frame from this eye (stage: skip)
    let inFrame = null;
    if (sh.key !== 'stage' && boxes[self]){
      const q = boxes[self], c = new T.PerspectiveCamera(sh.fov || fov, aspect, .1, 400);
      c.position.copy(eye); c.lookAt(aim); c.updateMatrixWorld(); c.updateProjectionMatrix();
      let n = 0, tot = 0;
      for (const x of [q[0][0], q[1][0]]) for (const y of [Math.max(q[0][1], aim.y - 4), q[1][1]]) for (const z of [q[0][2], q[1][2]]){   // (from just under the aim: legs to the floor may crop)
        const p = new T.Vector3(x, y, z).project(c); tot++;
        if (Math.abs(p.x) <= 1.02 && Math.abs(p.y) <= 1.02 && p.z < 1) n++;
      }
      const mid = new T.Vector3((q[0][0] + q[1][0]) / 2, (q[0][1] + q[1][1]) / 2, (q[0][2] + q[1][2]) / 2).project(c);
      inFrame = { corners: n / tot, mid: [+mid.x.toFixed(2), +mid.y.toFixed(2)] };
    }
    const S = D.three ? null : null;
    occ[sh.key] = { blocked: +(blocked / 15).toFixed(2), self: selfHits, by, inFrame,
      eyeIn: Math.abs(eye.x) <= ROOMB.HW && eye.y >= ROOMB.FLOOR && eye.y <= ROOMB.CEIL && eye.z >= ROOMB.BACK && eye.z <= ROOMB.FRONT,
      eye: eye.toArray().map(v => +v.toFixed(1)) };
  }
  return { boxes, overlaps, occ, solids: solid.length, layout: D.layout ? { solved: D.layout.solved } : null };
}

/* the director over one loop, at RATE: every frame, the shot, the eye, the lead marble's place
   in frame (on a belt shot), whether the eye is inside a machine, a glide segment through one */
function probeRun(rate, secs){
  return new Promise(res => {
    const D = window.__dev, T = D.three, cam = D.camera, world = D.world;
    D.cam('auto'); D.rate = rate; D.t = -2.4;
    const boxes = D.boxes();
    const solids = Object.entries(boxes).filter(([k, b]) => b && !k.startsWith('belt:') && k !== 'ricochet');
    const rc = new T.Raycaster(); rc.camera = cam;
    const drawn = o => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
    // which world children are the BELT (a marble behind its own housing is the belt's business)
    const _b = new T.Box3(), beltKids = new Set();
    for (const c of world.children){
      const b = new T.Box3(); c.updateMatrixWorld(true);
      c.traverse(o => { if ((o.isMesh || o.isInstancedMesh) && o.visible){ if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); b.union(_b.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld)); } });
      if (b.isEmpty()) continue;
      let best = null, bd = Infinity;
      for (const [k, q] of Object.entries(boxes)) if (q){ const d = Math.abs(q[0][0] - b.min.x) + Math.abs(q[1][0] - b.max.x) + Math.abs(q[0][2] - b.min.z) + Math.abs(q[1][2] - b.max.z); if (d < bd){ bd = d; best = k; } }
      if (best && best.startsWith('belt:') && bd < 3) beltKids.add(c);
    }
    const cuts = [], lost = [], inside = [], through = [], hidden = [];
    let last = null, prev = null, frames = 0, beltFrames = 0, t0 = performance.now(), wrapped = false, lastT = D.t;
    const step = () => {
      const t = D.t; frames++;
      const shot = D.shot, p = cam.position.clone();
      if (shot !== last){ cuts.push([+t.toFixed(2), shot]); last = shot; prev = null; }
      // eye inside a machine's box?
      for (const [k, b] of solids) if (p.x > b[0][0] && p.x < b[1][0] && p.y > b[0][1] && p.y < b[1][1] && p.z > b[0][2] && p.z < b[1][2]){ inside.push([+t.toFixed(2), shot, k]); break; }
      // glide segment through geometry (no cut this frame, moved ≥ .05)
      if (prev && prev.distanceTo(p) > .05 && prev.distanceTo(p) < 6){
        const d = p.clone().sub(prev), L = d.length(); rc.set(prev, d.divideScalar(L)); rc.far = L;
        if (rc.intersectObject(world, true).some(h => (h.object.isMesh || h.object.isInstancedMesh) && drawn(h.object) && !h.object.material?.transparent)) through.push([+t.toFixed(2), shot]);
      }
      prev = p;
      // a belt shot must keep the lead marble in frame (and not hidden behind a machine)
      const belt = !['stage'].includes(shot) && !D.shots.some(s => s.key === shot);
      // the marble(s) a belt shot is ABOUT: its role's (lead/alto/bass), or every live one ('all')
      if (belt && t > 0) beltFrames++;
      const subj = belt ? D.marbles.filter(m => shot === 'all' || m.role === shot) : [];
      if (t > 0) for (const m of subj){
        const q = m.p.clone().project(cam);
        const out = Math.abs(q.x) > 1 || Math.abs(q.y) > 1 || q.z > 1;
        if (out){ lost.push([+t.toFixed(2), shot, m.role, +q.x.toFixed(2), +q.y.toFixed(2)]); continue; }
        const d = m.p.clone().sub(p), L = d.length(); rc.set(p, d.divideScalar(L)); rc.far = L - .6;
        const h = rc.intersectObject(world, true).find(i => (i.object.isMesh || i.object.isInstancedMesh) && drawn(i.object) && !i.object.material?.transparent && i.object.material?.blending !== T.AdditiveBlending);
        if (h){ let o = h.object; while (o.parent && o.parent !== world) o = o.parent; if (!beltKids.has(o)) hidden.push([+t.toFixed(2), shot, m.role]); }
      }
      if (t < lastT - 1) wrapped = true; lastT = t;
      if ((performance.now() - t0) / 1000 < secs) requestAnimationFrame(step);
      else res({ cuts, frames, beltFrames, lost: lost.length, lostEx: lost.reduce((a, l) => { const g = a[a.length - 1]; if (g && g[1] === l[1] && g[2] === l[2] && l[0] - g[3] < .3){ g[3] = l[0]; g[4]++; } else a.push([l[0], l[1], l[2], l[0], 1, l[3], l[4]]); return a; }, []).slice(0, 12), inside: inside.length, insideEx: inside.slice(0, 6), through: through.length, throughEx: through.slice(0, 6), hidden: hidden.length, hiddenEx: hidden.slice(0, 6) });
    };
    requestAnimationFrame(step);
  });
}

/* LIVE: the camera's ACTUAL pose on a shot (after the glide settles, at this viewport — a
   portrait phone pulls every station shot back along its line), 7×5 rays over ±75 % of the
   frame: a ray is BLOCKED if a non-subject machine is hit nearer than the aim's depth */
function probeLive(key, selfKey){
  const D = window.__dev, T = D.three, cam = D.camera, world = D.world;
  const boxes = D.boxes();
  const sb = boxes[selfKey];
  const _b = new T.Box3();
  const ownerOf = new Map();
  for (const c of world.children){
    const b = new T.Box3(); c.traverse(o => { if ((o.isMesh || o.isInstancedMesh) && o.visible){ if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); b.union(_b.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld)); } });
    if (b.isEmpty()) continue;
    let best = null, bd = Infinity;
    for (const [k, q] of Object.entries(boxes)) if (q){ const d = Math.abs(q[0][0] - b.min.x) + Math.abs(q[1][0] - b.max.x) + Math.abs(q[0][2] - b.min.z) + Math.abs(q[1][2] - b.max.z); if (d < bd){ bd = d; best = k; } }
    ownerOf.set(c, bd < 3 ? best : '?');
  }
  const drawn = o => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
  const rc = new T.Raycaster(); rc.camera = cam;
  const fwd = new T.Vector3(); cam.getWorldDirection(fwd);
  const lead = D.marbles.find(m => m.role === 'lead');
  const aimDepth = selfKey === 'belt' ? (lead ? lead.p.clone().sub(cam.position).dot(fwd) : 20) : sb ? new T.Vector3((sb[0][0] + sb[1][0]) / 2, (sb[0][1] + sb[1][1]) / 2, (sb[0][2] + sb[1][2]) / 2).sub(cam.position).dot(fwd) : 20;
  let blocked = 0, n = 0; const by = {};
  if (selfKey === 'belt'){
    // the BELT is seen if its strike band is: points across the bays' front at band heights,
    // those inside the frame, each blocked if a non-belt machine stands in front of it
    const bb = Object.entries(boxes).filter(([k, q]) => q && k.startsWith('belt:')).map(([, q]) => q);
    const x0 = Math.min(...bb.map(q => q[0][0])), x1 = Math.max(...bb.map(q => q[1][0])), zc = (Math.min(...bb.map(q => q[0][2])) + Math.max(...bb.map(q => q[1][2]))) / 2;
    for (let i = 0; i <= 10; i++) for (const y of [3.7, 6.7, 9.7]){
      const q = new T.Vector3(x0 + 1 + (x1 - x0 - 2) * i / 10, y, zc), s = q.clone().project(cam);
      if (Math.abs(s.x) > 1 || Math.abs(s.y) > 1 || s.z > 1) continue;
      n++;
      const d = q.clone().sub(cam.position), L = d.length(); rc.set(cam.position, d.divideScalar(L)); rc.far = L - .3;
      const h = rc.intersectObject(world, true).find(x => (x.object.isMesh || x.object.isInstancedMesh) && drawn(x.object) && !x.object.material?.transparent && x.object.material?.blending !== T.AdditiveBlending);
      if (!h) continue;
      let o = h.object; while (o.parent && o.parent !== world) o = o.parent;
      const k = ownerOf.get(o) || '?';
      if (!k.startsWith('belt:')){ blocked++; by[k] = (by[k] || 0) + 1; }
    }
    return { blocked: n ? +(blocked / n).toFixed(2) : 1, seen: n, by, eye: cam.position.toArray().map(v => +v.toFixed(1)) };
  }
  for (let i = 0; i < 7; i++) for (let j = 0; j < 5; j++){
    const nx = -.75 + 1.5 * i / 6, ny = -.75 + 1.5 * j / 4;
    rc.setFromCamera(new T.Vector2(nx, ny), cam); n++;
    const h = rc.intersectObject(world, true).find(x => (x.object.isMesh || x.object.isInstancedMesh) && drawn(x.object) && !x.object.material?.transparent && x.object.material?.blending !== T.AdditiveBlending);
    if (!h) continue;
    let o = h.object; while (o.parent && o.parent !== world) o = o.parent;
    const k = ownerOf.get(o) || '?';
    if (k === selfKey || (selfKey === 'belt' && k.startsWith('belt:'))) continue;
    if (h.distance * rc.ray.direction.dot(fwd) < aimDepth * .85){ blocked++; by[k] = (by[k] || 0) + 1; }
  }
  // the eye inside / within 1 u of another machine's box
  const p = cam.position; let near = null;
  for (const [k, q] of Object.entries(boxes)) if (q && k !== selfKey && !(selfKey === 'belt' && k.startsWith('belt:'))){
    const dx = Math.max(q[0][0] - p.x, 0, p.x - q[1][0]), dy = Math.max(q[0][1] - p.y, 0, p.y - q[1][1]), dz = Math.max(q[0][2] - p.z, 0, p.z - q[1][2]);
    if (Math.hypot(dx, dy, dz) < 1) near = k;
  }
  return { blocked: +(blocked / n).toFixed(2), by, near, eye: p.toArray().map(v => +v.toFixed(1)) };
}

const results = [], fixture = [], roomTable = {};
const shotDir = A.shots;
if (shotDir) fs.mkdirSync(shotDir, { recursive: true });
for (const [ri, room] of ROOMS.entries()){
  const targets = [];
  const page = await browser.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(`${BASE}/?debug&room=${room}`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.__dev && window.__dev.world, { timeout: 20000 });
  await page.evaluate(() => { document.getElementById('overlay')?.classList.add('gone'); });
  const songs = A.songs ? A.songs.split(',') : await page.evaluate(() => [...document.querySelector('select').options].map(o => o.value));
  for (const s of songs) targets.push({ song: s });
  for (const m of MIDI) targets.push({ midi: m });
  for (const tg of targets){
    let pg = page;
    if (tg.midi){
      pg = await browser.newPage();
      pg.on('pageerror', e => errs.push(e.message));
      await pg.goto(`${BASE}/?debug&room=${room}&midi=${tg.midi}`, { waitUntil: 'networkidle0' });
      await pg.waitForFunction(() => window.__dev && window.__dev.world && window.__dev.shots, { timeout: 20000 });
      await sleep(800);
      await pg.evaluate(() => { document.getElementById('overlay')?.classList.add('gone'); });
    } else {
      await pg.evaluate(k => window.__dev.song(k), tg.song);
      await sleep(500);
    }
    const name = tg.song || tg.midi.replace(/^.*\//, '');
    await pg.evaluate(() => { window.__dev.rate = 0; window.__dev.t = -2.4; });
    await sleep(150);
    const st = await pg.evaluate(probeStatic);
    // the loop length: the director's seam (beats) is close enough → run ~1 loop of songTime
    const loopS = await pg.evaluate(() => window.__dev.P);
    const run = (A.norun ? null : await pg.evaluate(probeRun, RATE, Math.min(60, (loopS + 2.4) / RATE + .5)));
    if (A.live){
      st.live = {};
      for (const k of Object.keys(st.occ)){
        await pg.evaluate(k => { window.__dev.rate = 0; window.__dev.cam(k); }, k);
        await sleep(+(A.settle || 1600));
        st.live[k] = await pg.evaluate(probeLive, k, k === 'strings' ? 'bass' : k);
      }
      if (Object.keys(st.occ).length > 1) for (const k of ['all', 'lead']) for (const t of [3, 9, 15, 21]){
        await pg.evaluate((k, t) => { window.__dev.cam(k); window.__dev.rate = 1; window.__dev.t = t; }, k, t);
        await sleep(1300);
        await pg.evaluate(() => { window.__dev.rate = 0; });
        st.live[`${k}@${t}`] = await pg.evaluate(probeLive, k, 'belt');
      }
      console.log(`   live ${W}x${H}: ` + Object.entries(st.live).map(([k, o]) => `${k}:${o.blocked}${o.near ? '!near ' + o.near : ''}`).join(' '));
    }
    if (shotDir && ri === 0){
      const keys = ['stage', ...Object.keys(st.occ).filter(k => k !== 'stage')];
      for (const k of keys){
        await pg.evaluate(k => { window.__dev.rate = .25; window.__dev.t = 3; window.__dev.cam(k); }, k);
        await sleep(1400);
        await pg.screenshot({ path: `${shotDir}/${name}--${k}.png` });
      }
    }
    results.push({ room, song: name, ...st, run });
    // the room's standing geometry as the shot solve sees it (song-independent — except the Void's
    // islands, grown under each song's machines by place(): not tabled)
    if (A.fixture && !(room in roomTable) && room !== 'void') roomTable[room] = await pg.evaluate(() => window.__dev.roomSolids().map(b => b.map(v => +v.toFixed(2))));
    if (A.fixture && ri === 0) fixture.push(await pg.evaluate(name => {
      const D = window.__dev, L = D.layout, r = v => +v.toFixed(2), r3 = a => a.map(r);
      if (!L) return { song: name, wall: null, items: [], fixed: [], shots: [] };
      const w = L.wall, at = k => L.solved[k];
      return { song: name, cx: r(L.cx), bandY: r(L.bandY), wall: r3([w.min.x, w.max.x, w.min.y, w.max.y, w.min.z, w.max.z]),
        items: L.items.map(it => ({ key: it.key, x: r(it.x), z: r(it.z), box: r3(it.box), top: r(it.top), y0: r(it.y0), deck: r(it.deck ?? 0) })),
        hung: (L.hung || []).map(r3),
        fixed: D.hung().map(h => ({ key: h.key, box: r3(h.box) })),
        // the belt's follow offsets as SOLVED against the real meshes (+ their worst blocked probe rays)
        follow: D.solve?.follow ? { land: r3(D.solve.follow.land), portrait: r3(D.solve.follow.portrait), rays: D.solve.follow.rays } : null,
        // aim / preferred eye RELATIVE to the owner's solved spot (a hung station: world)
        shots: D.shots.map(s => { const p = at(s.owner) || { x: 0, z: 0 };
          return { key: s.key, owner: s.owner, aim: r3([s.aim[0] - p.x, s.aim[1], s.aim[2] - p.z]), pref: r3([s.pref[0] - p.x, s.pref[1], s.pref[2] - p.z]) }; }) };
    }, name));
    const worst = Object.entries(st.occ).filter(([, o]) => o.blocked > .2 || (o.inFrame && o.inFrame.corners < .5) || !o.eyeIn);
    console.log(`${room.padEnd(9)} ${name.padEnd(22)} ov:${st.overlaps.length} ${st.overlaps.join(' ')} | bad shots: ${worst.map(([k, o]) => `${k}(${o.blocked}${o.inFrame ? '/' + o.inFrame.corners.toFixed(2) : ''}${o.eyeIn ? '' : '/OUT'})`).join(' ') || '-'}`
      + (run ? ` | cuts ${run.cuts.length} lost ${run.lost} hidden ${run.hidden} inside ${run.inside} through ${run.through}` : ''));
    if (A.detail && run) console.log(JSON.stringify({ cuts: run.cuts, beltFrames: run.beltFrames, frames: run.frames, lostEx: run.lostEx, hiddenEx: run.hiddenEx, insideEx: run.insideEx, throughEx: run.throughEx, occ: st.occ }));
    if (pg !== page) await pg.close();
  }
  if (errs.length) console.log('  page errors:', [...new Set(errs)].slice(0, 5).join(' | '));
  await page.close();
}
if (A.json) fs.writeFileSync(A.json, JSON.stringify(results, null, 1));
if (A.fixture) fs.writeFileSync(A.fixture, '{"rooms":' + JSON.stringify(roomTable) + ',\n"songs":[\n' + fixture.map(f => JSON.stringify(f)).join(',\n') + '\n]}\n');
await browser.close();
