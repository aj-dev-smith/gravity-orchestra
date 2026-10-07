/* ============================================================
   PHRASE — find the LOOP inside a full-length song.

   A full MIDI imports as ONE loop of the whole song (convert.js step 7), so a
   4-minute pop file becomes a 4-minute loop: note budgets thin, belts enter
   160 beats late, the crane plans a marathon, the director goes stale. Real
   songs are built from repeats — verse, chorus, verse, chorus — and the engine
   loops anyway. So: find the best LOOPABLE window and import just that.

   Method (pure, O(bars²) — a 6-minute song is ~180 bars; capped at PHRASE.MAX_BARS):
     1. a fingerprint per BAR (bar grid from the file's meter): harmony (a
        12-bin chroma of the melodic notes), rhythm (onset slots, melodic and
        drum separately), and the LEAD's own (slot, pitch) set — the tune.
     2. a bar × bar SELF-SIMILARITY matrix of those fingerprints.
     3. every window of 8–32 bars (in 4-bar steps) is scored on
          repeat   how often the same window recurs elsewhere (a diagonal stripe
                   of the matrix) — the chorus / the hook is the most-repeated
          seam     does it LOOP: the bar after the window resembles the window's
                   first bar (the song itself goes end → start there)
          lead     the lead STRIKES through it (bars with an onset — a hard floor: the belt is the
                   spine; a window it sits out is no song)
          energy   how full it is (choruses are the fullest repeat)
          length   ~30–75 s; aligned to the song's own 4-bar phrase grid
          gap      the lead's longest rest in the loop (seam wrap included) — a soft penalty
          budget   the busiest accompanying voice vs a plugin's solve budget — a soft penalty
     4. the best window wins; within a hair of it, the EARLIEST statement of the same material
        (the first full chorus, not the ad-libbed last one). The next-best distinct windows ride
        along: convert.js re-imports the window alone with the lead PINNED and falls back to
        them if the final belt's lead doesn't strike through ≥ the floor of the loop's bars.

   The window is a CIRCLE: convert.js cuts it at the lead's first note inside
   it and rotates anything earlier (an accompaniment pickup, the drum fill) to
   the loop's tail — so the seam is the song's own bar-to-bar flow, nothing is
   dropped and no note is ever before beat 0.

   Pure: no THREE, no DOM, no audio. Locked by test/phrase.test.js.
   ============================================================ */

export const PHRASE = {
  AUTO_SEC: 75,                 // songs at most this long import whole ('auto')
  LENGTHS: [8, 12, 16, 20, 24, 32],   // candidate window lengths, bars
  MIN_SEC: 22, MAX_SEC: 90,     // hard bounds on a window's duration (MIN relaxes if nothing fits)
  SEC_LO: 30, SEC_HI: 75,       // the sweet spot…
  SEC_MID: 50,                  // …best here,
  PHRASE_BEATS: 128,            // …or at 32 bars of 4/4 when that's shorter (a fast song: see scoreWindows)
  SWEET_BEATS: 96,              // …and the floor never asks for more than 24 bars of 4/4
  LEAD_MIN: .7,                 // the lead must sound in ≥ this share of the window's bars
  LEAD_RELAX: .5,               // …relaxed to this when no window clears LEAD_MIN (a sparse, rest-heavy lead)
  REP_T: .78,                   // mean diagonal similarity that counts as "the same section again"
  CELL: 4,                      // bars: the unit of "this material recurs" (a 4-bar phrase)
  MAX_SHARE: .8,                // a window this close to the whole song isn't worth cutting
  SLOTS: 16,                    // onset slots per 4/4 bar (scaled by the meter)
  GAP_OK: 3, GAP_BAD: 12,       // s: the lead's longest rest in the loop (the seam wrap included) — free up to
                                // GAP_OK, fully penalized at GAP_BAD (the belt's arc grows with dt²: a 4-bar
                                // hold is one enormous, idle flight)
  BUDGET: 256,                  // notes: a plugin's solve budget (orchestra PART_SPEC.maxEvents) — a window
                                // whose busiest accompanying voice overflows it loses its tail on that machine.
                                // (a proxy — the router may stack voices on one machine — so convert.js also
                                // re-ranks the chosen window against its other lengths by the REAL drop count)
  SIBLING: .06,                 // score margin: a shorter window inside the chosen one worth that re-rank
  SHORT_SEC: 12,                // MIN_SEC relaxes to this (an 8-bar phrase) before the lead floor relaxes: a
                                // short loop the lead plays through beats a long one it sits half out
  MAX_BARS: 512,                // bars analysed at most (O(bars²)): ~17 min of 4/4 at 120 — longer is a stray note
  SILENCE_BARS: 32,             // a note after this many empty bars is stray: the song ended before it
  TRIES: 5,                     // ranked windows convert.js may try before falling back to the whole song
  EARLY: .02,                   // a score margin: the EARLIEST statement of the same material within it wins
};

/** the bar grid: the DOMINANT meter (most ticks in force up to the end), as beats per bar,
    and its origin (the bar line the dominant meter is anchored to). [] → 4/4 from 0.
    When the METER MAP really changes the bar lines (a riff in 4/4 + 5/8 + 2/4 — Master of
    Puppets has 119 meter changes), one uniform grid misaligns every bar after the first odd
    one, so no fingerprint matches its repeat: then `starts` = the bar lines walked from the map
    (beats, ascending, the last one closing the bar that holds endTick). A map whose bar lines all
    fall on the dominant grid (a 4/4 count-in bar before a 6/8 song) keeps the uniform grid
    (starts: null) — exactly the old behaviour. Use barAt / barStart to read either kind. */
export function barGrid(timeSigs = [], ppq, endTick){
  if (!timeSigs.length) return { num: 4, den: 4, barBeats: 4, origin: 0, starts: null };
  const spans = new Map();
  timeSigs.forEach((e, i) => {
    const t1 = i + 1 < timeSigs.length ? timeSigs[i + 1].tick : Math.max(endTick + 1, e.tick + 1);
    const k = `${e.num}/${e.den}`;
    const s = spans.get(k) || { num: e.num, den: e.den, w: 0, first: e.tick };
    s.w += Math.max(0, Math.min(t1, endTick + 1) - e.tick);
    spans.set(k, s);
  });
  const best = [...spans.values()].sort((a, b) => b.w - a.w || a.first - b.first)[0];
  const barBeats = best.num * 4 / best.den;
  const origin = ((best.first / ppq) % barBeats + barBeats) % barBeats;
  const g = { num: best.num, den: best.den, barBeats, origin, starts: null };
  if (spans.size < 2) return g;
  const starts = walkMeter(timeSigs, ppq, endTick);
  const onGrid = b => { const k = (b - origin) / barBeats; return Math.abs(k - Math.round(k)) < 1e-6; };
  if (starts.every(b => b < origin - 1e-6 || onGrid(b))) return g;
  g.starts = starts;
  return g;
}
/** the bar lines of a meter map, in beats: from 0 (4/4 until the first time signature), each bar
    num·4/den beats long; a meter change landing mid-bar starts a new bar there (the file says so).
    Ends with the bar line after endTick (so bar i = [starts[i], starts[i+1])). */
export function walkMeter(timeSigs, ppq, endTick){
  const sig = [...timeSigs].sort((a, b) => a.tick - b.tick).map(e => ({ beat: e.tick / ppq, len: e.num * 4 / e.den }));
  const end = endTick / ppq, starts = [];
  let cur = 0, len = 4, k = 0;
  for (let guard = 0; guard < 1e6; guard++){
    while (k < sig.length && sig[k].beat <= cur + 1e-6){ len = sig[k].len; k++; }
    starts.push(cur);
    if (cur > end + 1e-9) break;
    let next = cur + Math.max(1 / 12, len);
    if (k < sig.length && sig[k].beat < next - 1e-6) next = sig[k].beat;
    cur = next;
  }
  return starts;
}
/** the 0-based bar holding `beat` (uniform grid: may be < 0 before the origin; walked grid: past
    its end the last bar's length repeats) */
export function barAt(g, beat){
  const st = g.starts;
  if (!st) return Math.floor((beat - g.origin) / g.barBeats + 1e-9);
  const n = st.length;
  if (beat < st[0] - 1e-9) return -1;
  if (beat >= st[n - 1] - 1e-9){ const L = n > 1 ? st[n - 1] - st[n - 2] : g.barBeats; return n - 1 + Math.floor((beat - st[n - 1]) / L + 1e-9); }
  let lo = 0, hi = n - 1;                                // largest i with st[i] ≤ beat
  while (lo < hi){ const m = (lo + hi + 1) >> 1; if (st[m] <= beat + 1e-9) lo = m; else hi = m - 1; }
  return lo;
}
/** the beat bar i starts on (either grid kind; see barAt) */
export function barStart(g, i){
  const st = g.starts;
  if (!st) return g.origin + i * g.barBeats;
  const n = st.length;
  if (i < n) return st[Math.max(0, i)];
  const L = n > 1 ? st[n - 1] - st[n - 2] : g.barBeats;
  return st[n - 1] + (i - n + 1) * L;
}

/** beat → seconds over a tempo map [{ beat, bpm }] (ascending; before the first change: its tempo);
    no map (or one tempo) → beat·60/bpm */
export function tempoClock(tempos, bpm = 120){
  if (!tempos || !tempos.length) return b => b * 60 / bpm;
  const T = [...tempos].sort((a, b) => a.beat - b.beat), acc = [0];
  for (let i = 1; i < T.length; i++) acc.push(acc[i - 1] + (T[i].beat - T[i - 1].beat) * 60 / T[i - 1].bpm);
  return b => {
    if (b <= T[0].beat) return (b - T[0].beat) * 60 / T[0].bpm;
    let lo = 0, hi = T.length - 1;
    while (lo < hi){ const m = (lo + hi + 1) >> 1; if (T[m].beat <= b) lo = m; else hi = m - 1; }
    return acc[lo] + (b - T[lo].beat) * 60 / T[lo].bpm;
  };
}

const norm = v => { let s = 0; for (const x of v) s += x * x; s = Math.sqrt(s); return s ? v.map(x => x / s) : v; };
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

/** Per-bar fingerprints. events: [{ beat, midi, vel (0..1), dur (beats | null), kind: 'lead'|'mel'|'drum' }]
    in absolute beats ('mel' may carry `voice`, an id: per-voice note counts for the budget term).
    → [{ chroma, rhythm, lead: Set, leadOn, leadFirst, leadLast, leadGap, notes, drums, vn }]
    leadOn = the lead STRIKES in this bar (an onset — a note held over from an earlier bar is one
    idle flight on the belt, not activity). nBars is capped at maxBars. */
export function barFeatures(events, { barBeats = 4, origin = 0, starts = null, nBars, maxBars = PHRASE.MAX_BARS } = {}){
  // (a walked meter map: every bar keeps the dominant meter's slot count, spread over its own length,
  // so a 5/8 bar's rhythm still compares with its repeat)
  const slots = Math.max(4, Math.round(PHRASE.SLOTS * barBeats / 4));
  const g = { barBeats, origin, starts };
  const barOf = b => barAt(g, b);
  if (nBars == null){ nBars = 0; for (const e of events) nBars = Math.max(nBars, barOf(e.beat) + 1); }
  nBars = Math.min(nBars, maxBars);
  const F = Array.from({ length: nBars }, () => ({
    chroma: new Array(12).fill(0), mel: new Array(slots).fill(0), drum: new Array(slots).fill(0),
    lead: new Set(), leadOn: false, leadFirst: Infinity, leadLast: -Infinity, leadGap: 0, ons: [],
    notes: 0, drums: 0, leadN: 0, leadSum: 0, low: 128, high: 0, vn: null }));
  for (const e of events){
    const i = barOf(e.beat);
    if (i < 0 || i >= nBars) continue;
    const b0 = barStart(g, i), len = barStart(g, i + 1) - b0, f = F[i], into = e.beat - b0;
    const slot = Math.min(slots - 1, Math.max(0, Math.round(into / len * slots) % slots));
    if (e.kind === 'drum'){ f.drum[slot] += 1; f.drums++; continue; }
    const w = (e.vel ?? .8) * Math.min(len, Math.max(.25, e.dur ?? 1));
    f.chroma[e.midi % 12] += w;
    f.mel[slot] += 1; f.notes++; f.low = Math.min(f.low, e.midi); f.high = Math.max(f.high, e.midi);
    if (e.kind === 'lead'){
      f.lead.add(slot * 128 + e.midi); f.leadN++; f.leadSum += e.midi; f.leadOn = true; f.ons.push(e.beat);
      f.leadFirst = Math.min(f.leadFirst, e.beat); f.leadLast = Math.max(f.leadLast, e.beat);
    } else if (e.voice != null){ (f.vn ||= new Map()).set(e.voice, (f.vn.get(e.voice) || 0) + 1); }
  }
  for (const f of F){
    f.ons.sort((a, b) => a - b);
    for (let k = 1; k < f.ons.length; k++) f.leadGap = Math.max(f.leadGap, f.ons[k] - f.ons[k - 1]);
    delete f.ons;
    // TEXTURE — what a section sounds like as a whole (register, density, who's playing), not
    // which notes: it changes at a section line and holds inside one (the phrase grid's signal)
    const hats = f.drum.reduce((s, x) => s + (x > 0), 0) / slots;
    f.tex = [f.leadOn ? 1 : 0, f.leadN ? f.leadSum / f.leadN : 0, f.leadN, f.notes, f.drums, hats,
             f.notes ? f.high - f.low : 0, ...f.chroma.map(x => x)];
    f.chroma = norm(f.chroma); f.rhythm = norm([...f.mel, ...f.drum.map(x => x * .7)]);
    for (let c = 0; c < 12; c++) f.tex[7 + c] = f.chroma[c];
    delete f.mel; delete f.drum;
  }
  return F;
}

/** how alike two bars are, 0..1 (harmony, rhythm, and — when either has one — the tune) */
export function barSim(a, b){
  const ea = !a.notes && !a.drums, eb = !b.notes && !b.drums;
  if (ea || eb) return ea && eb ? 1 : 0;
  const ch = (a.notes && b.notes) ? dot(a.chroma, b.chroma) : (!a.notes && !b.notes ? 1 : 0);
  const rh = dot(a.rhythm, b.rhythm);
  if (!a.lead.size && !b.lead.size) return .6 * ch + .4 * rh;
  let inter = 0; for (const k of a.lead) if (b.lead.has(k)) inter++;
  const tune = inter / (a.lead.size + b.lead.size - inter);
  return .35 * ch + .25 * rh + .4 * tune;
}

/** the bar × bar self-similarity matrix (Float32Array n·n, symmetric, 1 on the diagonal) */
export function selfSimilarity(F){
  const n = F.length, S = new Float32Array(n * n);
  for (let i = 0; i < n; i++){ S[i * n + i] = 1; for (let j = i + 1; j < n; j++) S[i * n + j] = S[j * n + i] = barSim(F[i], F[j]); }
  return S;
}

/** Score every candidate window. → [{ fromBar (0-based), bars, sec, score, reps, best, seam, leadFrac,
    energy, terms }] best first. bpm converts bars to seconds. */
export function scoreWindows(F, S, { barBeats = 4, origin = 0, starts = null, tempos = null, bpm = 120, lengths = PHRASE.LENGTHS, leadMin = PHRASE.LEAD_MIN, minSec: minSec0 = PHRASE.MIN_SEC } = {}){
  const n = F.length, at = (i, j) => S[i * n + j];
  // a window's length in beats and SECONDS: a uniform grid at one tempo is L·barBeats·60/bpm (as ever);
  // a walked meter map has bars of their own lengths, and a tempo map plays each bar at its own tempo
  const g = { barBeats, origin, starts };
  const uniformT = !starts && !(tempos && tempos.length > 1);
  const secAt = tempoClock(tempos, bpm);
  const barSec = uniformT ? null : Float64Array.from({ length: n + 1 }, (_, i) => secAt(barStart(g, i)));
  const wbeats = (s, L) => uniformT ? L * barBeats : barStart(g, s + L) - barStart(g, s);
  const wsec = (s, L) => uniformT ? L * barBeats * 60 / bpm : barSec[s + L] - barSec[s];
  // per-voice prefix sums of the accompanying notes (the budget term: the busiest voice in a window)
  const vids = [...new Set(F.flatMap(f => f.vn ? [...f.vn.keys()] : []))];
  const VP = vids.map(v => { const p = new Float64Array(n + 1); for (let i = 0; i < n; i++) p[i + 1] = p[i] + (F[i].vn?.get(v) || 0); return p; });
  // diagonal prefix sums: D[g][i] = Σ_{k<i} S[k][k+g]  (lag g ≥ 1)
  const D = [null];
  for (let g = 1; g < n; g++){
    const d = new Float64Array(n - g + 1);
    for (let i = 0; i < n - g; i++) d[i + 1] = d[i] + at(i, i + g);
    D.push(d);
  }
  const diag = (s, p, L) => {                     // mean similarity of window s against window p
    const g = Math.abs(p - s), a = Math.min(s, p);
    return (D[g][a + L] - D[g][a]) / L;
  };
  // how often each bar's 4-bar PHRASE recurs elsewhere in the song (the hook is the most-recurring)
  const C = PHRASE.CELL, cnt = new Array(n).fill(0);
  for (let i = 0; i + C <= n; i++){
    let last = -Infinity;
    for (let j = 0; j + C <= n; j++){
      if (Math.abs(j - i) < C || j - last < C) continue;
      if (diag(i, j, C) >= PHRASE.REP_T){ cnt[i]++; last = j; }
    }
  }
  for (let i = n - C + 1; i < n; i++) if (i >= 0) cnt[i] = cnt[Math.max(0, n - C)];
  const cmax = Math.max(1, ...cnt);
  const hookT = Math.max(2, Math.ceil(cmax / 2));   // a bar of THE hook: its phrase recurs at least this often
  const dens = F.map(f => f.notes + .5 * f.drums);
  const sorted = [...dens].sort((a, b) => a - b);
  const p90 = sorted[Math.floor(.9 * (sorted.length - 1))] || 1;
  const mean = dens.reduce((s, x) => s + x, 0) / Math.max(1, n);
  let first = F.findIndex(f => f.notes || f.drums); if (first < 0) first = 0;
  // the song's PHRASE GRID: sections start where the TEXTURE changes. Novelty at a bar line = how
  // far the mean texture of the 4 bars after it is from the 4 bars before (each dimension scaled
  // by its spread over the song) — high at verse → chorus, ~0 inside a section even when every
  // bar's notes differ. The 4-bar phase whose bar lines carry the most change is the
  // hypermeter — robust to a pickup bar or a 1-bar intro that would shift a count-from-bar-1 grid.
  const K = 4, novC = new Float64Array(n), dims = F[0]?.tex.length || 0;
  const sd = new Array(dims).fill(0);
  for (let c = 0; c < dims; c++){
    let m = 0; for (const f of F) m += f.tex[c]; m /= n;
    let v = 0; for (const f of F) v += (f.tex[c] - m) ** 2;
    sd[c] = Math.sqrt(v / n) || 1;
  }
  for (let i = 1; i < n; i++){
    const a0 = Math.max(0, i - K), b1 = Math.min(n, i + K);
    let d2 = 0;
    for (let c = 0; c < dims; c++){
      let x = 0, y = 0;
      for (let k = a0; k < i; k++) x += F[k].tex[c];
      for (let k = i; k < b1; k++) y += F[k].tex[c];
      d2 += ((x / (i - a0) - y / (b1 - i)) / sd[c]) ** 2 * (c >= 7 ? .4 : 1);
    }
    novC[i] = Math.sqrt(d2);
  }
  novC[0] = Math.max(...novC);
  // a boundary is a PEAK of novelty (the ±2-bar local max), relative to the song's own clear
  // boundaries — a smooth arrangement's peaks are low but real; the slopes around them are not lines
  const peaks = new Float64Array(n);
  for (let i = 0; i < n; i++){
    let top = true;
    for (let k = Math.max(0, i - 2); k <= Math.min(n - 1, i + 2); k++) if (novC[k] > novC[i] || (novC[k] === novC[i] && k < i)) top = false;
    if (top && novC[i] > 0) peaks[i] = novC[i];
  }
  const ref = [...peaks.slice(first + 1)].filter(x => x > 0).sort((a, b) => b - a);
  const refV = ref[Math.min(ref.length - 1, Math.floor(ref.length / 3))] || 1;
  const nov = i => Math.min(1, peaks[i] / refV);
  const phaseSum = [0, 0, 0, 0];
  for (let i = first; i < n; i++) phaseSum[i % 4] += nov(i);
  const phase = phaseSum.indexOf(Math.max(...phaseSum));
  const out = [];
  const fits = lengths.filter(L => L < n * PHRASE.MAX_SHARE - 1e-9);
  const okSec = (s, L) => wsec(s, L) <= PHRASE.MAX_SEC;
  let anyLong = false;                                                // a slow song: take what fits
  if (uniformT) anyLong = fits.some(L => okSec(0, L) && wsec(0, L) >= minSec0);
  else for (const L of fits) for (let s = first; s + L <= n && !anyLong; s++) if (okSec(s, L) && wsec(s, L) >= minSec0) anyLong = true;
  const minSec = anyLong ? minSec0 : 0;
  for (const L of fits){
    for (let s = first; s + L <= n; s++){
      const sec = wsec(s, L), wb = wbeats(s, L);
      if (sec < minSec || sec > PHRASE.MAX_SEC) continue;
      let on = 0, full = 0, d = 0, hook = 0, peak = 0, hookA = 0, hookB = 0;
      for (let k = s; k < s + L; k++){
        if (F[k].leadOn) on++; if (F[k].notes || F[k].drums) full++; d += dens[k];
        hook += Math.min(cnt[k], 3) / 3; peak = Math.max(peak, cnt[k]);
        if (cnt[k] >= hookT){ if (k < s + L / 2) hookA++; else hookB++; }
      }
      const leadFrac = on / L;
      if (leadFrac < leadMin) continue;
      // the lead's longest REST in the loop, the seam's wrap included (the loop is cut at its first
      // onset, so the wrap is W − (last − first)) — what the belt shows as one long idle arc
      let gap = 0, prev = null, firstOn = null;
      for (let k = s; k < s + L; k++){
        const f = F[k]; if (!f.leadOn) continue;
        if (prev != null) gap = Math.max(gap, f.leadFirst - prev); else firstOn = f.leadFirst;
        gap = Math.max(gap, f.leadGap); prev = f.leadLast;
      }
      gap = Math.max(gap, wb - (prev - firstOn));
      const gapSec = uniformT ? gap * 60 / bpm : gap * sec / wb;
      const gapPen = Math.min(1, Math.max(0, (gapSec - PHRASE.GAP_OK) / (PHRASE.GAP_BAD - PHRASE.GAP_OK)));
      // the solve BUDGET: the busiest accompanying voice past a plugin's budget loses its tail there
      let busy = 0; for (const p of VP) busy = Math.max(busy, p[s + L] - p[s]);
      const budgetPen = Math.min(1, Math.max(0, busy / PHRASE.BUDGET - 1));
      // repeats: other non-overlapping placements of the same material, best first
      const cands = [];
      for (let p = 0; p + L <= n; p++) if (Math.abs(p - s) >= L) cands.push([p, diag(s, p, L)]);
      cands.sort((a, b) => b[1] - a[1]);
      const taken = []; let best = 0;
      for (const [p, v] of cands){
        best = Math.max(best, v);
        if (v < PHRASE.REP_T) break;
        if (taken.every(q => Math.abs(q - p) >= L)) taken.push(p);
      }
      const reps = taken.length;
      // the seam: the song itself goes window-end → window-start there
      const after = s + L < n ? at(s + L, s) : null, before = s > 0 ? at(s - 1, s + L - 1) : null;
      const seam = after ?? before ?? .5;          // (the bar before vs the last bar: only for a window that ends the song)
      const energy = Math.min(1, d / L / p90) * (full / L);
      // the sweet spot, tempo-aware: ~30–75 s, best at 50 s — but never asking for more than a song's
      // longest phrase: at a fast tempo (≥ ~154 bpm) 50 s is MORE than 32 bars of 4/4 (128 beats), so the
      // best length is those 128 beats, and from ~192 bpm the floor is 96 beats (24 bars) — Master of
      // Puppets' 32-bar riff at 220 is 35 s, its 24-bar one 26 s: real phrases, not too-short loops
      const beatSec = sec / wb, lo = Math.min(PHRASE.SEC_LO, PHRASE.SWEET_BEATS * beatSec);
      const mid = Math.min(PHRASE.SEC_MID, Math.max(lo, PHRASE.PHRASE_BEATS * beatSec));
      const lenFit = sec < lo ? (sec / lo) ** 2 : sec > PHRASE.SEC_HI ? Math.max(0, 1 - (sec - PHRASE.SEC_HI) / 30)
                   : 1 - .25 * Math.abs(sec - mid) / 25;
      const fit = lenFit * (L % 8 === 0 ? 1 : .85);   // songs phrase in 8s: a 12- or 20-bar loop cuts one in half
      const ph = ((s - phase) % 4 + 4) % 4;
      const off = .5 * (ph === 0 ? 1 : ph === 2 ? .25 : 0) + .5 * nov(s);
      // repeat = the window is made of recurring material (length-neutral), holds the song's
      // most-recurring phrase (the hook), and recurs itself as a whole
      const rep = .45 * hook / L + .3 * peak / cmax + .25 * (.5 * Math.min(reps, 2) / 2 + .5 * best);
      const terms = { rep, seam, lead: leadFrac, energy, len: fit, align: off, gap: -gapPen, budget: -budgetPen };
      const score = .28 * rep + .24 * seam + .10 * leadFrac + .12 * energy + .16 * fit + .10 * off - .12 * gapPen - .10 * budgetPen;
      out.push({ fromBar: s, bars: L, sec, score, reps, best, peak, hookT, hookA, hookB, seam, leadFrac, leadGap: gap, busy,
                 energy, energyRel: d / L / Math.max(1e-9, mean), terms });
    }
  }
  return out.sort((a, b) => b.score - a.score || a.fromBar - b.fromBar);
}

/** is this lead a SINGER's line? Only then is "the chorus" a fair word for its most-repeated section
    (an instrumental's hook is a theme, not a chorus). program: GM 0–127; name: the track's name. */
export function vocalLead(program, name = ''){
  return [53, 54, 85].includes(program) || /vocal|voice|vox|sing|lyric/i.test(name || '');
}

/** a plain-words name for the chosen window (an honest guess, not a claim). vocal: a sung lead —
    only then are the words "chorus" / "verse" used; an instrumental gets neutral words. */
export function describePhrase(c, { vocal = false } = {}){
  if (!c) return '';
  // peak = how often the window's most-recurring 4-bar phrase comes back elsewhere
  if (c.peak >= Math.max(3, c.hookT ?? 0) && c.energyRel >= .95){
    if (!vocal) return 'the most-repeated section';
    const a = c.hookA ?? 0, b = c.hookB ?? 0, half = c.bars / 2;
    if (a + b >= .6 * c.bars) return 'the chorus';
    return b >= a ? (a <= .3 * half ? 'a verse into the chorus' : 'the chorus') : 'the chorus and the verse after it';
  }
  if (c.peak >= 1) return 'a repeated section';
  return 'the fullest stretch';
}

/** The whole pipeline over beat events: → the best window { fromBar (0-based), bars, startBeat, endBeat,
    sec, label, floor, alts, … } or null (nothing loopable: no window keeps the lead).
    floor = the lead-activity floor the window cleared (LEAD_MIN, or LEAD_RELAX for a sparse lead);
    alts = the next-best DISTINCT windows (≤ TRIES − 1, each overlapping no earlier pick by more
    than half) for convert.js to fall back on if the final import's lead doesn't hold up.
    Ties of the same material go EARLY: within PHRASE.EARLY of the best score, the first statement
    of the same section (diagonal similarity ≥ REP_T) wins — the first full chorus is the canonical
    one; a last one carries the ad-libs and the outro tag. */
export function findPhrase(events, { barBeats = 4, origin = 0, starts = null, tempos = null, bpm = 120, vocal = false, maxBars = PHRASE.MAX_BARS } = {}){
  const g = { barBeats, origin, starts };
  const F = barFeatures(events, { barBeats, origin, starts, maxBars });
  if (F.length < 8) return null;
  const S = selfSimilarity(F), n = F.length;
  // the lead must sound through the loop; a sparse lead (long rests between phrases) relaxes the floor once
  // (tiers: the full rules; then a SHORT loop (an 8-bar phrase) the lead plays through; only then a
  // relaxed lead floor)
  let floor = PHRASE.LEAD_MIN, all = [];
  for (const t of [{}, { minSec: PHRASE.SHORT_SEC }, { leadMin: PHRASE.LEAD_RELAX }]){
    all = scoreWindows(F, S, { barBeats, origin, starts, tempos, bpm, ...t });
    if (all.length){ floor = t.leadMin ?? PHRASE.LEAD_MIN; break; }
  }
  if (!all.length) return null;
  const same = (a, b) => { let x = 0; for (let k = 0; k < a.bars; k++) x += S[(a.fromBar + k) * n + b.fromBar + k]; return x / a.bars >= PHRASE.REP_T; };
  let c = all[0];
  for (const o of all) if (o.bars === c.bars && o.fromBar < c.fromBar && o.score >= all[0].score - PHRASE.EARLY && same(o, all[0])) c = o;
  const picks = [c];
  const overlap = (a, b) => Math.max(0, Math.min(a.fromBar + a.bars, b.fromBar + b.bars) - Math.max(a.fromBar, b.fromBar)) / Math.min(a.bars, b.bars);
  for (const o of all){
    if (picks.length >= PHRASE.TRIES) break;
    if (picks.every(p => overlap(p, o) <= .5)) picks.push(o);
  }
  const out = w => ({ ...w, startBeat: barStart(g, w.fromBar), endBeat: barStart(g, w.fromBar + w.bars),
                      totalBars: n, floor, label: describePhrase(w, { vocal }) });
  // SHORTER loops inside the chosen window, close in score: if it overflows a machine's solve budget
  // for real, convert.js weighs these (the same section, fewer notes per machine) against it
  const sib = w => all.filter(o => o.bars < w.bars && o.fromBar >= w.fromBar && o.fromBar + o.bars <= w.fromBar + w.bars &&
                                   o.score >= w.score - PHRASE.SIBLING).slice(0, 3).map(out);
  return { ...out(c), siblings: sib(c), alts: picks.slice(1).map(w => ({ ...out(w), siblings: sib(w) })) };
}
