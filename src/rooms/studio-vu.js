/* ============================================================
   MIDNIGHT STUDIO — a machine's VU METER + TALLY lamp, from its strike cue. PURE (no THREE, no DOM).

   The studio answers each machine on its own support's panel (studio-footing.js): the meter fills
   with what it plays, a peak-hold marker falls back slowly, a red tally lamp glows while it plays.
   Like rooms/pulse.js (whose cue + loop + `start` rules this follows — makePulse drives the tally's
   anticipation), every value is a pure function of songTime: scrub-exact, silent in the count-in
   (before `start` nothing happened), wrapping the loop honestly, allocation-free per call.

     level(t)  0..1  1 − exp(−Σ w·exp(−dt / TAU)) over the recent strikes: one strike lights about
                     two thirds of the meter, a dense run pins it in the red (a SUM, unlike pulse.js's
                     max — a meter is about loudness, and a busy part is loud)
     peak(t)   0..1  the highest level a recent strike reached, held HOLD s, then falling FALL / s
     tally(t)  0..1  1 from a strike until TALLY_HOLD s after the last one (faded over TALLY_FADE),
                     rising over the last TALLY_LEAD s before a strike after a rest
   ============================================================ */
import { makePulse } from './pulse.js';

export const VU = { TAU: .3, GAIN: 1, DEPTH: 8, HOLD: .45, FALL: .55, TALLY_HOLD: 2.2, TALLY_FADE: .6, TALLY_LEAD: .35 };

export function makeMeter(cue, { P, start = -Infinity } = {}){
  const n = Array.isArray(cue) ? cue.length : 0;
  if (!n || !(P > 0)) return { level: () => 0, peak: () => 0, tally: () => 0 };
  const ev = cue.map(c => ({ t: (((+c.t || 0) % P) + P) % P, w: Math.max(0, Math.min(1, c.w ?? 1)) })).sort((a, b) => a.t - b.t);
  const T = new Float64Array(n), W = new Float64Array(n);
  ev.forEach((e, i) => { T[i] = e.t; W[i] = e.w; });
  const lead = makePulse(ev.map(e => ({ t: e.t, w: 1 })), { P, start, lead: VU.TALLY_LEAD });
  const cut = VU.TAU * 9, look = Math.max(cut, VU.HOLD + 1 / VU.FALL, VU.TALLY_HOLD + VU.TALLY_FADE);
  const upto = x => { let lo = 0, hi = n; while (lo < hi){ const m = (lo + hi) >> 1; if (T[m] <= x) lo = m + 1; else hi = m; } return lo - 1; };
  /* the k-th strike at or before t (k = 0 the latest): its songTime, or NaN (none that happened) */
  function back(t, k){
    const tau = ((t % P) + P) % P, base = t - tau;
    let i = upto(tau) - k, off = 0;
    while (i < 0){ i += n; off -= P; }
    const s = base + off + T[i];
    return s < start ? NaN : s;
  }
  const wAt = (t, k) => { const tau = ((t % P) + P) % P; let i = upto(tau) - k; while (i < 0) i += n; return W[i]; };
  function level(t){
    let sum = 0;
    for (let k = 0; k < VU.DEPTH && k < n * 4; k++){
      const s = back(t, k);
      if (!(s === s)) break;                                 // (NaN: before start — nothing earlier happened)
      const dt = t - s; if (dt > cut) break;
      sum += wAt(t, k) * Math.exp(-dt / VU.TAU);
    }
    return 1 - Math.exp(-VU.GAIN * sum);
  }
  return {
    level,
    peak(t){
      let out = 0;
      for (let k = 0; k < VU.DEPTH && k < n * 4; k++){
        const s = back(t, k);
        if (!(s === s)) break;
        const dt = t - s; if (dt > look) break;
        const v = level(s + 1e-9) - VU.FALL * Math.max(0, dt - VU.HOLD);   // (just after it: the strike counted)
        if (v > out) out = v;
      }
      return out;
    },
    tally(t){
      const s = back(t, 0), dt = s === s ? t - s : Infinity;
      const held = dt <= VU.TALLY_HOLD ? 1 : dt <= VU.TALLY_HOLD + VU.TALLY_FADE ? 1 - (dt - VU.TALLY_HOLD) / VU.TALLY_FADE : 0;
      return Math.max(held, Math.sqrt(lead.next(t)));
    },
  };
}
