/* ============================================================
   SUSTAIN BUCKETS — a held note's release, baked for the iOS sample path.

   The live (Web Audio) path releases a sustained voice at the note's `dur`
   (main → audio.playVoice({dur})). The iOS <audio> sample path can't: an
   element ignores el.volume and plays its WAV to the end (CLAUDE.md §5), so a
   staccato organ chord used to ring its full 5.2 s render. The fix is DATA, not
   audio plumbing: a sustained plugin fires a DURATION-BUCKETED id

       '<base>~<hold>'      e.g.  'C4~0.5'  'C4|choir~2'  'E4:p~1'

   whose render is the base voice cut at `hold` seconds with a short baked
   release (cutHold, below) — the felt drops / the bow lifts / the wind stops
   INSIDE the sample. The bucket is the ladder rung nearest the note's hold (in
   log time: a doubling ladder is never more than ×/÷√2 off); a note nearer the
   base render's own hold fires the bare base id, as before.

   The live path is unchanged: audio.playVoice plays a '~' id's BASE buffer when
   it has one and releases it at `dur` exactly (main bakes the base as a
   live-only voice — Float32 only, no <audio> element — when the machine never
   fires it bare).

   Everything here is pure: the machine (build) and voiceIds (song load) run
   the SAME fit + lane solve, collect [base, hold] pairs, plan ONE ladder for
   the part (planLadder — coarsened until the bucket-id count fits the cap, so
   a dense import can't balloon the bake) and map every strike through it.
   ============================================================ */

export const SEP = '~';
export const LADDER = Object.freeze([.5, 1, 2]);     // seconds held before the baked release
export const BUCKET_CAP = 40;                        // most bucket ids one part may add to the bake
// the ladders tried in order (finest first) until a part's bucket ids fit the cap
export const LADDERS = Object.freeze([LADDER, Object.freeze([.5, 2]), Object.freeze([.6]), Object.freeze([])]);

/** the rung for a note held `dur` s on a voice whose base render holds `native` s:
    a ladder value (s), or 0 → the base id itself (nearer the native hold, or no rung below it) */
export function bucketOf(dur, native, ladder = LADDER){
  if (!(dur > 0) || !(native > 0)) return 0;
  const L = Math.log(dur);
  let best = 0, bestD = Math.abs(L - Math.log(native));
  for (const b of ladder){
    if (b >= native) continue;
    const d = Math.abs(L - Math.log(b));
    if (d < bestD - 1e-12){ best = b; bestD = d; }
  }
  return best;
}
/** the id a strike fires: base, or base + '~' + rung */
export function bucketId(base, dur, native, ladder = LADDER){
  const b = bucketOf(dur, native, ladder);
  return b ? `${base}${SEP}${b}` : base;
}
/** 'C4|choir~0.5' → { base: 'C4|choir', hold: .5 };  'C4' → { base: 'C4', hold: 0 } */
export function splitBucket(id){
  const s = String(id), k = s.lastIndexOf(SEP);
  if (k < 0) return { base: s, hold: 0 };
  const hold = +s.slice(k + 1);
  return Number.isFinite(hold) && hold > 0 ? { base: s.slice(0, k), hold } : { base: s, hold: 0 };
}
/** pairs [[base, dur]…] + native(base) → the finest ladder whose bucket ids fit `cap`. `floor` = the
    ladder a part keeps when even one rung overflows the cap (default none: every strike fires its bare
    base, the pre-bucket behaviour). The organ floors at one rung — its old '/s' SHORT tier baked a
    short render for EVERY base, so a dense organ part must never lose its staccato on iOS. */
export function planLadder(pairs, native, cap = BUCKET_CAP, floor = LADDERS[LADDERS.length - 1]){
  for (const L of LADDERS){
    if (!L.length) break;
    const ids = new Set();
    for (const [base, dur] of pairs){ const id = bucketId(base, dur, native(base), L); if (id !== base) ids.add(id); }
    if (ids.size <= cap) return L;
  }
  return floor;
}
/** every id the pairs fire under `ladder` (bucket ids and bare bases), unique */
export function bucketIds(pairs, native, ladder){
  return [...new Set(pairs.map(([base, dur]) => bucketId(base, dur, native(base), ladder)))];
}
/** without a tempo (an old caller / the contract suite): each base + every rung below its native
    hold — a superset of anything a tempo could fire */
export function allBucketIds(bases, native, ladder = LADDER){
  const out = new Set();
  for (const b of bases){ out.add(b); for (const r of ladder) if (r < native(b)) out.add(`${b}${SEP}${r}`); }
  return [...out];
}

/** the base render cut at `hold` s with a `rel`-second baked release (exp(−3u)·(1 − u²) → exactly 0
    at the end; a 1-sample-continuous fade). Level-matched by construction: the same samples, cut. */
export function cutHold(samples, sr, hold, rel){
  const h = Math.max(1, Math.round(sr * hold)), r = Math.max(2, Math.round(sr * rel));
  if (h + r >= samples.length) return samples;           // the base already ends sooner
  const n = h + r, out = samples.slice(0, n);
  for (let i = h; i < n; i++){ const u = (i - h) / (n - 1 - h); out[i] *= Math.exp(-3 * u) * (1 - u * u); }
  out[n - 1] = 0;
  return out;
}
/** the baked release a rung gets: short notes stop quickly, longer ones exhale (≈ the live path's
    setTargetAtTime(τ .12) tail, ~.4 s to −30 dB), never longer than the voice's own release */
export const relFor = (hold, maxRel) => Math.min(maxRel, .28 + .1 * hold);
