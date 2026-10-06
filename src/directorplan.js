/* THE EDIT, SOLVED UP FRONT — the room director's shot list for one loop.

   The song is data, so the director doesn't have to vote frame by frame on "what's
   busiest in the next two seconds" (that rewarded whichever machine never stops — the
   marimba's ostinato, the belt — and starved the sparse ones: Canon's drums got zero
   seconds). Instead it reads the whole loop once at song load and asks, per beat, what is
   SPECIAL about each machine right now:

     intensity  — playing above ITS OWN norm (a quiet machine's big moment counts as much as
                  a busy machine's, and a machine that's always on stops earning credit for it)
     entrance   — the first hits after a long rest (the drums arriving, the marimba coming in)
     crescendo  — hits louder than its usual (the timpani roll into the climax)
     exposure   — its share of the room's above-norm activity (a solo: the rest thin out)
     rarity     — a machine present for little of the loop has few moments; each counts for more

   …then cuts the loop into shots by dynamic programming over the beat grid: every shot holds
   ≥ MIN_HOLD seconds, cuts land on beats (bar lines preferred), a long hold gets bored. Then
   shares are CAPPED (no machine hogs the film — the belt least of all) and COVERAGE is
   guaranteed (every machine that plays gets its best moment on screen at least once a loop).
   Scripted story beats (song.director.at) are fixed points the solve builds around.

   Pure: no THREE, no DOM. The camera just plays the plan back — a pure function of songTime,
   so scrubbing is exact and the cut always lands on the same beat. */

export const PLAN = {
  MIN_HOLD: 3.0,        // s — a shot shorter than this reads as a flicker
  MAX_HOLD: 12,         // s — no shot is longer
  BORED: 8,             // s — past this a held shot pays BORE per extra second
  BORE: .35,
  CUT: 1.2,             // the cost of a cut (fewer, better cuts)
  BAR: .5,              // a cut on a bar line is worth this much
  SHORT: 2,             // per missing beat under MIN_HOLD (only fixed beats or the grid's end allow it)
  PING: 3, PING_T: 6,   // an A-B-A return when B held under PING_T s costs PING (no ping-pong)
  LOOK: 4,              // beats the salience window looks ahead (the camera arrives before the moment)
  REST: 8,              // beats of silence before the next hit counts as an ENTRANCE
  ENTER: 2.5,           // an entrance's pull (×1–2 by the length of the rest)
  CAP: { belt: .18, stage: .16, station: .24 },  // max share of the loop's shot time (scripted time is exempt;
                        // a room too small to fit every cap just stays balanced — all over-cap pulls damp together)
  STAGE_BASE: .5,       // the wide's floor pull (a breather when nothing's special)
};

/* voices: [{key, hits:[{t, w}], weight?, belt?}] — hit times in loop-local seconds; weight =
   the song's authored pull (song.director.<key>), applied as √weight.
   grid: {t0, beat, end, bar?} — the downbeat, the beat (s), where the music's grid ends.
   fixed: [{t, len, key}] — scripted shots (s). wides: [t] — big ensemble downbeats (s).
   Returns {cuts:[{t, key}], shares:{key: fraction}, sal} — cuts sorted, the first at t0. */
export function planEdit({ voices, grid, fixed = [], wides = [], opts = {} }){
  const o = { ...PLAN, ...opts, CAP: { ...PLAN.CAP, ...(opts.CAP || {}) } };
  const { t0, beat, end } = grid, bar = grid.bar || 4;
  const N = Math.max(1, Math.floor((end - t0) / beat + 1e-6));
  const slot = t => Math.floor((t - t0) / beat + 1e-6);
  const V = voices.filter(v => v.hits.length);

  // ---- salience per voice per beat ----------------------------------------------------
  const raw = V.map(v => {
    const a = new Float64Array(N), n = new Float64Array(N);
    for (const h of v.hits){ const s = Math.min(N - 1, Math.max(0, slot(h.t))); a[s] += h.w; n[s]++; }
    const f = new Float64Array(N);
    for (let s = 0; s < N; s++) for (let j = 0; j < o.LOOK && s + j < N; j++) f[s] += a[s + j] * (1 - j / (o.LOOK + 1));
    let fs = 0, fn = 0, ws = 0, wn = 0;
    for (let s = 0; s < N; s++){ if (a[s] > 0){ ws += a[s]; wn += n[s]; } if (f[s] > 0){ fs += f[s]; fn++; } }
    // presence: the share of the loop it's playing in (a bowl struck every bar is present all
    // loop — sparse hits, but not RARE; the drums that only join the climax are)
    return { v, a, n, f, frac: fn / N, base: fs / Math.max(1, fn), meanW: ws / Math.max(1, wn) };
  });
  const r = raw.map(x => Float64Array.from(x.f, f => Math.min(f / x.base, 3)));
  const sal = {};
  raw.forEach((x, i) => {
    const out = new Float64Array(N), { a, n } = x;
    const rare = Math.min(2, Math.max(1, Math.sqrt(.3 / Math.max(x.frac, .02))));
    // entrances (the rest wraps the loop: a part that opens the loop after a silent tail enters too)
    const hitsAt = []; for (let s = 0; s < N; s++) if (a[s] > 0) hitsAt.push(s);
    const ent = new Float64Array(N);
    hitsAt.forEach((s, k) => {
      const prev = k ? hitsAt[k - 1] : hitsAt[hitsAt.length - 1] - N;
      const rest = s - prev;
      if (rest >= o.REST){ const st = o.ENTER * (1 + Math.min(1, rest / (4 * o.REST)));   // a longer rest, a bigger entrance
        for (let d = -1; d <= 4; d++) if (s + d >= 0 && s + d < N) ent[s + d] = Math.max(ent[s + d], st * (d < 0 ? .8 : 1 - d * .15)); }
    });
    for (let s = 0; s < N; s++){
      let lw = 0, ln = 0; for (let j = 0; j < o.LOOK && s + j < N; j++){ lw += a[s + j]; ln += n[s + j]; }
      const cres = ln ? Math.max(0, (lw / ln) / x.meanW - 1) * 1.5 : 0;
      let tot = 0, others = 0;
      r.forEach((rr, j) => { if (raw[j].f[s] > 0){ tot += rr[s]; if (j !== i) others++; } });
      const share = x.f[s] > 0 ? r[i][s] / tot : 0;
      const solo = share * (others <= 1 ? 1.5 : 1);
      const w = Math.sqrt(x.v.weight ?? 1);             // a song's pull is a hint, not an override
      out[s] = x.f[s] > 0 ? w * rare * (r[i][s] + ent[s] + cres + 2 * solo) : w * ent[s];
    }
    const k = x.v.belt ? 'belt' : x.v.key;
    sal[k] = sal[k] ? sal[k].map((v, s) => Math.max(v, out[s])) : out;
  });
  // the WIDE: the room's breadth (many machines at once), and the big ensemble downbeats
  const st = new Float64Array(N);
  for (let s = 0; s < N; s++){
    const b = raw.filter(x => x.f[s] > 0).length / Math.max(1, raw.length);
    st[s] = o.STAGE_BASE + 2.5 * b * b;
  }
  const hold = Math.round(o.MIN_HOLD / beat);        // (a big downbeat earns a whole shot's worth of wide, not a blink)
  for (const t of wides){ const s = slot(t); for (let d = -1; d <= hold; d++) if (s + d >= 0 && s + d < N) st[s + d] = Math.max(st[s + d], o.STAGE_BASE + (d < 0 ? 3 : 4 - 2 * d / hold)); }
  sal.stage = st;

  const keys = Object.keys(sal), K = keys.length;
  const capOf = k => k === 'belt' ? o.CAP.belt : k === 'stage' ? o.CAP.stage : o.CAP.station;
  const fixedKey = new Array(N).fill(null);
  for (const c of fixed){
    if (!keys.includes(c.key)){ keys.push(c.key); sal[c.key] = new Float64Array(N); }
    const a = Math.max(0, slot(c.t)), b = Math.min(N, Math.max(a + 1, Math.round((c.t + c.len - t0) / beat)));
    for (let s = a; s < b; s++) fixedKey[s] = c.key;
  }

  const Lmin = Math.max(1, Math.round(o.MIN_HOLD / beat)), Lmax = Math.max(Lmin, Math.ceil(o.MAX_HOLD / beat));
  const bored = Math.ceil(o.BORED / beat);
  const mult = Object.fromEntries(keys.map(k => [k, 1]));
  const forced = [];                                   // coverage: [a, b, key] forced windows

  const solve = () => {
    const KK = keys.length;
    const fk = fixedKey.slice();
    for (const [a, b, k] of forced) for (let s = a; s < b; s++) if (!fk[s]) fk[s] = k;
    // prefix sums of scaled salience + of "a slot fixed to some OTHER key"
    const pre = keys.map(k => { const p = new Float64Array(N + 1); for (let s = 0; s < N; s++) p[s + 1] = p[s] + sal[k][s] * mult[k]; return p; });
    const bad = keys.map(k => { const p = new Int32Array(N + 1); for (let s = 0; s < N; s++) p[s + 1] = p[s] + (fk[s] && fk[s] !== k ? 1 : 0); return p; });
    const nfix = new Int32Array(N + 1); for (let s = 0; s < N; s++) nfix[s + 1] = nfix[s] + (fk[s] ? 1 : 0);
    // state (k, p) at beat b: the shot ending at b is k, the one before it p (KK = none —
    // the loop's first shot). Second order so an A-B-A PING-PONG (a short B between two
    // A's) can be priced; per (a, p) only the best two q's are needed for that.
    const W = KK + 1, NONE = KK, PING = Math.round(o.PING_T / beat);
    const best = Array.from({ length: N + 1 }, () => new Float64Array(KK * W).fill(-Infinity));
    const from = Array.from({ length: N + 1 }, () => new Int32Array(KK * W).fill(-1));
    const prevQ = Array.from({ length: N + 1 }, () => new Int32Array(KK * W).fill(-1));
    const q1 = new Int32Array(KK), q2 = new Int32Array(KK);
    // a scripted (fixed) run may outlast MAX_HOLD: a shot ending inside one may start back at its start
    const runStart = new Int32Array(N);
    for (let s = 0; s < N; s++) runStart[s] = fk[s] && s && fk[s - 1] === fk[s] ? runStart[s - 1] : s;
    for (let b = 1; b <= N; b++){
      const aMin = Math.max(0, Math.min(b - Lmax, fk[b - 1] ? runStart[b - 1] - Lmin : Infinity));
      for (let a = aMin; a < b; a++){
        const L = b - a;
        const allFixed = nfix[b] - nfix[a] === L;
        let cost = o.CUT - (a % bar === 0 ? o.BAR : 0) + Math.max(0, L - (nfix[b] - nfix[a]) - bored) * beat * o.BORE;
        if (L < Lmin && !allFixed && b !== N) cost += (Lmin - L) * o.SHORT;
        if (a === 0){                                   // the loop's first shot
          for (let k = 0; k < KK; k++){
            if (bad[k][b] - bad[k][a]) continue;
            const v = pre[k][b] - pre[k][a] - cost, idx = k * W + NONE;
            if (v > best[b][idx]){ best[b][idx] = v; from[b][idx] = 0; prevQ[b][idx] = -1; }
          }
          continue;
        }
        const B = best[a];
        let any = false;
        for (let p = 0; p < KK; p++){                   // the best two predecessors-of-p at a
          let x = -1, y = -1;
          for (let q = 0; q <= KK; q++){ const v = B[p * W + q]; if (v === -Infinity) continue;
            if (x < 0 || v > B[p * W + x]){ y = x; x = q; } else if (y < 0 || v > B[p * W + y]) y = q; }
          q1[p] = x; q2[p] = y; if (x >= 0) any = true;
        }
        if (!any) continue;
        for (let k = 0; k < KK; k++){
          if (bad[k][b] - bad[k][a]) continue;
          const gain = pre[k][b] - pre[k][a] - cost;
          for (let p = 0; p < KK; p++){
            if (p === k || q1[p] < 0) continue;
            let q = q1[p], v = B[p * W + q];
            if (q === k && a - from[a][p * W + q] < PING){         // A-B-A with a short B: priced
              v -= o.PING;
              if (q2[p] >= 0 && B[p * W + q2[p]] > v){ q = q2[p]; v = B[p * W + q]; }
            }
            v += gain;
            const idx = k * W + p;
            if (v > best[b][idx]){ best[b][idx] = v; from[b][idx] = a; prevQ[b][idx] = q; }
          }
        }
      }
    }
    let bi = 0; for (let j = 1; j < KK * W; j++) if (best[N][j] > best[N][bi]) bi = j;
    const segs = [];
    for (let b = N, k = Math.floor(bi / W), p = bi % W; b > 0; ){
      const idx = k * W + p, a = from[b][idx], q = prevQ[b][idx];
      segs.unshift([a, b, keys[k]]); b = a; k = p; p = q < 0 ? NONE : q;
    }
    return segs;
  };
  const sharesOf = segs => { const sh = {}; for (const [a, b, k] of segs) sh[k] = (sh[k] || 0) + (b - a) / N; return sh; };
  const isFixedKey = k => fixedKey.includes(k);

  const missingOf = sh => keys.filter(k => k !== 'stage' && !sh[k] && sal[k].some(v => v > 0) && !forced.some(f => f[2] === k));
  // COVERAGE: a machine that plays but never got the camera takes its best free window
  // (the machine with the FEWEST free windows chooses first — two machines can want the same gap)
  const windows = k => {
    const L = Math.min(Lmin, N), out = [];
    for (let a = 0; a + L <= N; a++){
      let ok = true, v = 0;
      for (let s = a; s < a + L; s++){ if (fixedKey[s] || forced.some(f => s < f[1] && s >= f[0])){ ok = false; break; } v += sal[k][s]; }
      if (ok && v > 0) out.push([a, a + L, v]);
    }
    return out;
  };
  const coverAll = ks => ks.map(k => [k, windows(k).length]).sort((x, y) => x[1] - y[1]).forEach(([k]) => {
    const w = windows(k); if (!w.length) return;
    const [a, b] = w.reduce((m, x) => x[2] > m[2] ? x : m);
    forced.push([a, b, k]);
  });
  let segs = solve();
  for (let it = 0; it < 24; it++){
    const sh = sharesOf(segs);
    const missing = missingOf(sh);
    // CAPS: a hog's pull is damped until it fits its share (fixed script time doesn't count against it)
    const over = keys.filter(k => (sh[k] || 0) > capOf(k) + 1e-9 && !isFixedKey(k));
    if (!missing.length && !over.length) break;
    over.forEach(k => { mult[k] *= .8; });
    coverAll(missing);
    segs = solve();
  }
  // (the cap damping can leave a machine unseen on its last round: coverage gets the last word)
  for (let missing = missingOf(sharesOf(segs)); missing.length; missing = missingOf(sharesOf(segs))){
    const n = forced.length; coverAll(missing);
    if (forced.length === n) break;                    // no free window left for them
    segs = solve();
  }
  const cuts = segs.map(([a, , k]) => ({ t: t0 + a * beat, key: k }));
  return { cuts, shares: sharesOf(segs), sal, N, forced };
}

/* The planned shot at loop-local time `now`: the last cut at or before it ('stage' before
   the first — the loop's roll-in — and from `end` on — the seam's breath). */
export function shotAt(plan, now, end){
  if (!plan || !plan.cuts.length || now >= end || now < plan.cuts[0].t) return 'stage';
  let lo = 0, hi = plan.cuts.length - 1;
  while (lo < hi){ const m = (lo + hi + 1) >> 1; if (plan.cuts[m].t <= now + 1e-6) lo = m; else hi = m - 1; }
  return plan.cuts[lo].key;
}
