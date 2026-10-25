/* ============================================================
   PULSE — a machine's strikes as a light envelope. PURE (no THREE, no DOM).

   The rooms answer the machines: an anchor carries its strike CUE (sorted loop times + weights, the
   loop period P, and `start` — ARM_AT, before which a strike never happened: the count-in is silent).
   makePulse turns it into two pure functions of songTime — so a reaction is scrub-exact, needs no
   state, and runs as often as the frame does without allocating:

     at(t)    0..1  the afterglow: each strike's weight decaying exp(−dt / decay) — the strongest one
                    still glowing (max, not a sum: a dense run holds a steady light, it doesn't strobe)
     next(t)  0..1  anticipation: the next strike's weight, rising (1 − dt / lead)² over its last
                    `lead` seconds

   The loop wraps honestly: a strike near the end of a loop still glows across the seam into the next
   one (never into the count-in before the first loop: before `start` nothing happened).
   ============================================================ */

const DEPTH = 8;                                         // strikes looked back over (a dense run: the newest dominate)

export function makePulse(cue, { P, start = -Infinity, decay = .45, lead = .3 } = {}){
  const n = Array.isArray(cue) ? cue.length : 0;
  if (!n || !(P > 0)) return { at: () => 0, next: () => 0 };
  // loop times, wrapped into [0, P) and sorted (a cue may arrive unsorted or unwrapped)
  const ev = cue.map(c => ({ t: (((+c.t || 0) % P) + P) % P, w: Math.max(0, Math.min(1, c.w ?? 1)) })).sort((a, b) => a.t - b.t);
  const T = new Float64Array(n), W = new Float64Array(n);
  ev.forEach((e, i) => { T[i] = e.t; W[i] = e.w; });
  const cut = decay * 9;                                 // (e^−9 ≈ 1e-4: past this a strike is dark)
  /* the last index with T ≤ x (−1: none) */
  const upto = x => { let lo = 0, hi = n; while (lo < hi){ const m = (lo + hi) >> 1; if (T[m] <= x) lo = m + 1; else hi = m; } return lo - 1; };
  return {
    at(t){
      const tau = ((t % P) + P) % P, base = t - tau;
      let i = upto(tau), off = 0, out = 0;
      for (let k = 0; k < DEPTH && k < n; k++, i--){
        if (i < 0){ i += n; off -= P; }
        const s = base + off + T[i];
        if (s < start) break;                            // (before start: never happened — nor anything earlier)
        const dt = t - s;
        if (dt > cut) break;
        const v = W[i] * Math.exp(-dt / decay);
        if (v > out) out = v;
      }
      return out;
    },
    next(t){
      // the first strike after t that happens (at or after start)
      const q = start > t ? start - 1e-9 : t;
      const tau = ((q % P) + P) % P, base = q - tau;
      let i = upto(tau) + 1, off = 0;
      if (i >= n){ i = 0; off = P; }
      const dt = base + off + T[i] - t;
      return dt < lead ? W[i] * (1 - dt / lead) ** 2 : 0;
    },
  };
}
