import * as THREE from 'three';
import { makePulse } from './pulse.js';
/* ============================================================
   THE GREYBOX FLOOR ANSWERS — the quietest room's one reaction (src/rooms/grid.js). When a machine
   strikes, a faint RING leaves the edge of what it stands on and travels outward across the floor's
   grid LINES (a rounded rect: the pad's own outline, grown), fading as it goes; meanwhile the floor
   cells hugging that machine glow with its afterglow (rooms/pulse.js). Its colour is the machine's.

   All of it is a pure function of songTime: per machine the AGES of its last two strikes (seconds
   since — strikeAges, PURE, scrub-exact, nothing before `start`: the count-in is dark) → each ring's
   radius (SPEED · age) and light (its weight, fading exp(−age / FADE)), and its pulse envelope, written
   each frame into three uniform arrays (RIPPLE.N slots — a constant pool) that the floor's shader
   reads: per fragment only a distance and two gaussians per lit machine. No allocation in update, no
   lights, nothing rebuilt per frame.
   ============================================================ */

export const RIPPLE = {
  N: 20,            // machine slots (the floor's uniform pool: a whole orchestra + the belt + the kit)
  SPEED: 5.2,       // u/s a ring travels (≈ 3.5 m/s — a slow wave, not a shock)
  WIDTH: .42,       // its soft half-width (u): a wave front, not a smudge
  FADE: .62,        // its light falls exp(−age / FADE)
  REACH: 2.6,       // the cells round a machine glow with it, brightest at its edge, gone by REACH (u)
  AGE_NONE: 1e4,    // "no strike yet" (a ring that far out is long gone)
  DENSE: 1.6,       // strikes/s above which a machine answers only its ACCENTS (and its rings soften, √)
  ACCENT_GAP: .8,
  LEAD: .35,        // a calm machine's cells warm before its strike by this much of the anticipation   // a busy machine's accents are at least this far apart (s): the floor goes dark between them
};

/** PURE. A busy machine's ACCENTS: when its cue runs faster than RIPPLE.DENSE, keep the heaviest strikes
    (ties: the earliest in the loop) that stand ≥ RIPPLE.ACCENT_GAP apart round the loop — so the floor
    answers the kick on the one and the crash, and is dark in between, instead of holding a steady haze.
    A machine at or under DENSE keeps every strike. Deterministic; returns the cue (or a new sorted one). */
export function accentsOf(cue, P, { dense = RIPPLE.DENSE, gap = RIPPLE.ACCENT_GAP } = {}){
  if (!Array.isArray(cue) || !cue.length || !(P > 0) || cue.length / P <= dense) return cue;
  const g = Math.min(gap, P / 2);
  const ev = cue.map(c => ({ t: (((+c.t || 0) % P) + P) % P, w: Math.max(0, Math.min(1, c.w ?? 1)) }))
    .sort((a, b) => b.w - a.w || a.t - b.t);
  const kept = [];
  for (const e of ev){
    if (kept.every(k => { const d = Math.abs(k.t - e.t); return Math.min(d, P - d) >= g - 1e-9; })) kept.push(e);
  }
  return kept.sort((a, b) => a.t - b.t);
}

/** PURE. The ages (seconds since) and weights of a cue's last `depth` strikes at songTime t —
    written into out[o + 2k] (age) / out[o + 2k + 1] (weight), newest first; a strike before `start`
    never happened (AGE_NONE, 0). The cue is a loop (P): the strike before the loop's first is the
    previous loop's last. Allocation-free per call. */
export function strikeAges(cue, { P, start = -Infinity, depth = 2 } = {}){
  const n = Array.isArray(cue) ? cue.length : 0;
  const none = (out, o) => { for (let k = 0; k < depth; k++){ out[o + 2 * k] = RIPPLE.AGE_NONE; out[o + 2 * k + 1] = 0; } return out; };
  if (!n || !(P > 0)) return (t, out, o = 0) => none(out, o);
  const ev = cue.map(c => ({ t: (((+c.t || 0) % P) + P) % P, w: Math.max(0, Math.min(1, c.w ?? 1)) })).sort((a, b) => a.t - b.t);
  const T = new Float64Array(n), W = new Float64Array(n);
  ev.forEach((e, i) => { T[i] = e.t; W[i] = e.w; });
  const upto = x => { let lo = 0, hi = n; while (lo < hi){ const m = (lo + hi) >> 1; if (T[m] <= x) lo = m + 1; else hi = m; } return lo - 1; };
  return (t, out, o = 0) => {
    if (!Number.isFinite(t)) return none(out, o);
    const tau = ((t % P) + P) % P, base = t - tau;
    let i = upto(tau), off = 0, k = 0;
    for (; k < depth; k++, i--){
      if (i < 0){ i += n; off -= P; }
      const s = base + off + T[i];
      if (s < start) break;                                   // (before start: never happened — nor anything earlier)
      out[o + 2 * k] = t - s; out[o + 2 * k + 1] = W[i];
    }
    for (; k < depth; k++){ out[o + 2 * k] = RIPPLE.AGE_NONE; out[o + 2 * k + 1] = 0; }
    return out;
  };
}

/** PURE. One ripple slot per machine that strikes (≤ RIPPLE.N, standing machines first, then anchor
    order): the rect its rings leave from — what it stands on (its pad: a loft member's own spot), else
    its footprint (a HUNG machine: the floor under it — unless that floor is mostly another machine's
    stand: the floor under the belt answers the belt) — its colour, cue (a busy machine's: its accents —
    accentsOf), and a gain that softens a dense machine. */
export function rippleSlots(anchors = [], plan = null){
  const pads = new Map((plan?.pads || []).map(p => [p.key, p]));
  const ok = a => a && a.w > 0 && a.d > 0 && Number.isFinite(a.x) && Number.isFinite(a.z) && Array.isArray(a.cue) && a.cue.length && a.P > 0;
  const rectOf = a => { const p = pads.get(a.key); return p ? { x: p.x, z: p.z, hw: p.hw, hd: p.hd, yaw: p.yaw || 0 } : { x: a.x, z: a.z, hw: a.w / 2, hd: a.d / 2, yaw: a.yaw || 0 }; };
  const live = (anchors || []).filter(ok), standing = live.filter(a => a.kind !== 'hung').map(rectOf);
  const out = [];
  for (const a of [...live.filter(a => a.kind !== 'hung'), ...live.filter(a => a.kind === 'hung')]){
    if (out.length >= RIPPLE.N) break;
    const r = rectOf(a);
    if (a.kind === 'hung' && standing.some(s => coverOf(r, s) > .3)) continue;
    const rate = a.cue.length / a.P;
    const dense = rate > RIPPLE.DENSE;
    out.push({ key: a.key, ...r, color: a.color ?? '#8fa6c8', cue: accentsOf(a.cue, a.P), P: a.P, start: a.start ?? -Infinity,
      lead: dense ? 0 : RIPPLE.LEAD,                        // (a busy machine's cells don't anticipate: dark till the accent lands)
      gain: Math.min(1, Math.sqrt(RIPPLE.DENSE / Math.max(rate, 1e-6))) });
  }
  return out;
}
/* the share of rect r's area that rect s covers (their world AABBs — a yawed rect's bounds: enough to
   tell "over another machine's stand" from "beside it") */
function coverOf(r, s){
  const ext = q => { const c = Math.abs(Math.cos(q.yaw)), n = Math.abs(Math.sin(q.yaw)); return [q.hw * c + q.hd * n, q.hw * n + q.hd * c]; };
  const [rx, rz] = ext(r), [sx, sz] = ext(s);
  const ox = Math.min(r.x + rx, s.x + sx) - Math.max(r.x - rx, s.x - sx), oz = Math.min(r.z + rz, s.z + sz) - Math.max(r.z - rz, s.z - sz);
  return ox > 0 && oz > 0 ? ox * oz / (4 * rx * rz) : 0;
}

/* a colour packed into one float: three linear bytes (an exact integer < 2^24 — float32 holds it whole) */
const _c = new THREE.Color();
export function packColor(hex){
  _c.set(hex);
  const q = v => Math.max(0, Math.min(255, Math.round(v * 255)));
  return q(_c.r) * 65536 + q(_c.g) * 256 + q(_c.b);
}

/* the floor shader's ripple pass (rooms/grid-shade.js gridPatch `extra`): sees gW (world point) and
   gM (the grid's minor / major line masks); adds to totalEmissiveRadiance */
export function rippleExtra(){
  const N = RIPPLE.N;
  const uniforms = {
    rA: { value: new Float32Array(4 * N) },        // x, z, hw, hd            (place)
    rB: { value: new Float32Array(4 * N) },        // cos, sin, glow, colour  (glow: per frame)
    rS: { value: new Float32Array(4 * N) },        // radius0, light0, radius1, light1  (per frame)
    rN: { value: 0 },
    rK: { value: new THREE.Vector4(RIPPLE.SPEED, RIPPLE.WIDTH, RIPPLE.FADE, RIPPLE.REACH) },
    rG: { value: new THREE.Vector4(1.3, .04, .7, .035) },   // ring on lines, ring fill, cells on lines, cell fill
  };
  const head = /* glsl */`
    uniform vec4 rA[${N}]; uniform vec4 rB[${N}]; uniform vec4 rS[${N}]; uniform int rN; uniform vec4 rK; uniform vec4 rG;
    float rRect(vec2 q, vec2 b){ vec2 e = abs(q) - b; return length(max(e, 0.)) + min(max(e.x, e.y), 0.); }
    vec3 rCol(float c){ float r = floor(c / 65536.), g = floor((c - r * 65536.) / 256.); return vec3(r, g, c - r * 65536. - g * 256.) / 255.; }`;
  const body = /* glsl */`
    {
      vec2 p = gW.xz, cc = (floor(p * .5) + .5) * 2.;           // this fragment's 2 u cell (its centre)
      float lineM = max(gM.x, gM.y);
      vec3 add = vec3(0.);
      for (int i = 0; i < ${N}; i++){
        if (i >= rN) break;
        vec4 A = rA[i], B = rB[i], S = rS[i];
        if (S.y < .004 && S.w < .004 && B.z < .004) continue;   // (this machine is dark: skip it)
        vec2 d = p - A.xy, dc = cc - A.xy;
        // cull: past the farthest lit ring (or the cells' reach) from this machine's rect, nothing to add
        float R = max(max(S.y >= .004 ? S.x : 0., S.w >= .004 ? S.z : 0.) + 3. * rK.y, B.z >= .004 ? rK.w + 1.5 : 0.) + length(A.zw);
        if (dot(d, d) > R * R) continue;
        vec2 q = vec2(B.x * d.x - B.y * d.y, B.y * d.x + B.x * d.y), qc = vec2(B.x * dc.x - B.y * dc.y, B.y * dc.x + B.x * dc.y);
        float dist = rRect(q, A.zw), dcell = rRect(qc, A.zw);
        float x0 = (dist - S.x) / rK.y, x1 = (dist - S.z) / rK.y;
        float ring = (S.y * exp(-x0 * x0) + S.w * exp(-x1 * x1)) * smoothstep(-.1, .4, dist);
        float cell = B.z * (1. - smoothstep(0., rK.w, dcell));   // (per CELL: its centre's distance — the grid's own steps)
        add += rCol(B.w) * (ring * (lineM * rG.x + rG.y) + cell * (lineM * rG.z + rG.w));
      }
      totalEmissiveRadiance += add;
    }`;
  return { uniforms, head, body };
}

/* The live side: slots for the current anchors (place) → uniforms (update). */
export function makeRipples(U){
  let slots = [], ages = [], pulses = [];
  const A = U.rA.value, B = U.rB.value, S = U.rS.value, T = new Float64Array(4);
  return {
    get slots(){ return slots; },
    place(anchors, plan){
      slots = rippleSlots(anchors, plan);
      ages = slots.map(s => strikeAges(s.cue, { P: s.P, start: s.start, depth: 2 }));
      pulses = slots.map(s => makePulse(s.cue, { P: s.P, start: s.start }));
      A.fill(0); B.fill(0); S.fill(0);
      slots.forEach((s, i) => {
        A[4 * i] = s.x; A[4 * i + 1] = s.z; A[4 * i + 2] = s.hw; A[4 * i + 3] = s.hd;
        B[4 * i] = Math.cos(s.yaw); B[4 * i + 1] = Math.sin(s.yaw); B[4 * i + 3] = packColor(s.color);
        S[4 * i] = S[4 * i + 2] = RIPPLE.AGE_NONE * RIPPLE.SPEED;
      });
      U.rN.value = slots.length;
    },
    /* per frame: a pure fn of songTime (scrub-exact), allocation-free */
    update(songTime){
      for (let i = 0; i < slots.length; i++){
        ages[i](songTime, T, 0);
        const g = slots[i].gain, o = 4 * i;
        S[o] = RIPPLE.SPEED * T[0]; S[o + 1] = T[1] * g * Math.exp(-T[0] / RIPPLE.FADE);
        S[o + 2] = RIPPLE.SPEED * T[2]; S[o + 3] = T[3] * g * Math.exp(-T[2] / RIPPLE.FADE);
        const v = pulses[i].at(songTime) + slots[i].lead * pulses[i].next(songTime);
        B[4 * i + 2] = (v > 1 ? 1 : v) * g;                     // (a busy machine answers its accents: dark between them)
      }
    },
  };
}
