/* ============================================================
   PHRASE — find the LOOP inside a full-length song.

   A full MIDI imports as ONE loop of the whole song (convert.js step 7), so a
   4-minute pop file becomes a 4-minute loop: note budgets thin, belts enter
   160 beats late, the crane plans a marathon, the director goes stale. Real
   songs are built from repeats — verse, chorus, verse, chorus — and the engine
   loops anyway. So: find the best LOOPABLE window and import just that.

   Method (pure, O(bars²) — a 6-minute song is ~180 bars):
     1. a fingerprint per BAR (bar grid from the file's meter): harmony (a
        12-bin chroma of the melodic notes), rhythm (onset slots, melodic and
        drum separately), and the LEAD's own (slot, pitch) set — the tune.
     2. a bar × bar SELF-SIMILARITY matrix of those fingerprints.
     3. every window of 8–32 bars (in 4-bar steps) is scored on
          repeat   how often the same window recurs elsewhere (a diagonal stripe
                   of the matrix) — the chorus / the hook is the most-repeated
          seam     does it LOOP: the bar after the window resembles the window's
                   first bar (the song itself goes end → start there)
          lead     the lead is sounding through it (a hard floor: the belt is the
                   spine; a window it sits out is no song)
          energy   how full it is (choruses are the fullest repeat)
          length   ~30–75 s; aligned to the song's own 4-bar phrase grid
     4. the best window wins; ties go to the earlier one.

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
  SEC_LO: 30, SEC_HI: 75,       // the sweet spot
  LEAD_MIN: .7,                 // the lead must sound in ≥ this share of the window's bars
  LEAD_RELAX: .5,               // …relaxed to this when no window clears LEAD_MIN (a sparse, rest-heavy lead)
  REP_T: .78,                   // mean diagonal similarity that counts as "the same section again"
  CELL: 4,                      // bars: the unit of "this material recurs" (a 4-bar phrase)
  MAX_SHARE: .8,                // a window this close to the whole song isn't worth cutting
  SLOTS: 16,                    // onset slots per 4/4 bar (scaled by the meter)
};

/** the bar grid: the DOMINANT meter (most ticks in force up to the end), as beats per bar,
    and its origin (the bar line the dominant meter is anchored to). [] → 4/4 from 0. */
export function barGrid(timeSigs = [], ppq, endTick){
  if (!timeSigs.length) return { num: 4, den: 4, barBeats: 4, origin: 0 };
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
  return { num: best.num, den: best.den, barBeats, origin };
}

const norm = v => { let s = 0; for (const x of v) s += x * x; s = Math.sqrt(s); return s ? v.map(x => x / s) : v; };
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

/** Per-bar fingerprints. events: [{ beat, midi, vel (0..1), dur (beats | null), kind: 'lead'|'mel'|'drum' }]
    in absolute beats. → [{ chroma, rhythm, lead: Set, leadOn, notes, drums }] */
export function barFeatures(events, { barBeats = 4, origin = 0, nBars } = {}){
  const slots = Math.max(4, Math.round(PHRASE.SLOTS * barBeats / 4));
  const barOf = b => Math.floor((b - origin) / barBeats + 1e-9);
  if (nBars == null){ nBars = 0; for (const e of events) nBars = Math.max(nBars, barOf(e.beat) + 1); }
  const F = Array.from({ length: nBars }, () => ({
    chroma: new Array(12).fill(0), mel: new Array(slots).fill(0), drum: new Array(slots).fill(0),
    lead: new Set(), leadOn: false, notes: 0, drums: 0, leadN: 0, leadSum: 0, low: 128, high: 0 }));
  for (const e of events){
    const i = barOf(e.beat);
    if (i < 0 || i >= nBars) continue;
    const f = F[i], into = e.beat - origin - i * barBeats;
    const slot = Math.min(slots - 1, Math.max(0, Math.round(into / barBeats * slots) % slots));
    if (e.kind === 'drum'){ f.drum[slot] += 1; f.drums++; continue; }
    const w = (e.vel ?? .8) * Math.min(barBeats, Math.max(.25, e.dur ?? 1));
    f.chroma[e.midi % 12] += w;
    f.mel[slot] += 1; f.notes++; f.low = Math.min(f.low, e.midi); f.high = Math.max(f.high, e.midi);
    if (e.kind === 'lead'){
      f.lead.add(slot * 128 + e.midi); f.leadN++; f.leadSum += e.midi;
      // a held lead note keeps the lead "on" through the bars it rings across (≤ 2 bars)
      const end = Math.min(nBars - 1, barOf(e.beat + Math.min(2 * barBeats, Math.max(0, (e.dur ?? 0) - 1e-6))));
      for (let j = i; j <= end; j++) F[j].leadOn = true;
    }
  }
  for (const f of F){
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
export function scoreWindows(F, S, { barBeats = 4, bpm = 120, lengths = PHRASE.LENGTHS, leadMin = PHRASE.LEAD_MIN } = {}){
  const n = F.length, at = (i, j) => S[i * n + j];
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
  const secOf = L => L * barBeats * 60 / bpm;
  const fits = lengths.filter(L => L < n * PHRASE.MAX_SHARE - 1e-9 && secOf(L) <= PHRASE.MAX_SEC);
  const minSec = fits.some(L => secOf(L) >= PHRASE.MIN_SEC) ? PHRASE.MIN_SEC : 0;   // a slow song: take what fits
  for (const L of fits){
    const sec = secOf(L);
    if (sec < minSec) continue;
    for (let s = first; s + L <= n; s++){
      let on = 0, full = 0, d = 0, hook = 0, peak = 0, hookA = 0, hookB = 0;
      for (let k = s; k < s + L; k++){
        if (F[k].leadOn) on++; if (F[k].notes || F[k].drums) full++; d += dens[k];
        hook += Math.min(cnt[k], 3) / 3; peak = Math.max(peak, cnt[k]);
        if (cnt[k] >= hookT){ if (k < s + L / 2) hookA++; else hookB++; }
      }
      const leadFrac = on / L;
      if (leadFrac < leadMin) continue;
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
      const lenFit = sec < PHRASE.SEC_LO ? (sec / PHRASE.SEC_LO) ** 2 : sec > PHRASE.SEC_HI ? Math.max(0, 1 - (sec - PHRASE.SEC_HI) / 30)
                   : 1 - .25 * Math.abs(sec - 50) / 25;
      const fit = lenFit * (L % 8 === 0 ? 1 : .85);   // songs phrase in 8s: a 12- or 20-bar loop cuts one in half
      const ph = ((s - phase) % 4 + 4) % 4;
      const off = .5 * (ph === 0 ? 1 : ph === 2 ? .25 : 0) + .5 * nov(s);
      // repeat = the window is made of recurring material (length-neutral), holds the song's
      // most-recurring phrase (the hook), and recurs itself as a whole
      const rep = .45 * hook / L + .3 * peak / cmax + .25 * (.5 * Math.min(reps, 2) / 2 + .5 * best);
      const terms = { rep, seam, lead: leadFrac, energy, len: fit, align: off };
      const score = .28 * rep + .24 * seam + .10 * leadFrac + .12 * energy + .16 * fit + .10 * off;
      out.push({ fromBar: s, bars: L, sec, score, reps, best, peak, hookT, hookA, hookB, seam, leadFrac, energy, energyRel: d / L / Math.max(1e-9, mean), terms });
    }
  }
  return out.sort((a, b) => b.score - a.score || a.fromBar - b.fromBar);
}

/** a plain-words name for the chosen window (an honest guess, not a claim) */
export function describePhrase(c){
  if (!c) return '';
  // peak = how often the window's most-recurring 4-bar phrase comes back elsewhere
  if (c.peak >= Math.max(3, c.hookT ?? 0) && c.energyRel >= .95){
    const a = c.hookA ?? 0, b = c.hookB ?? 0, half = c.bars / 2;
    if (a + b >= .6 * c.bars) return 'the chorus';
    return b >= a ? (a <= .3 * half ? 'a verse into the chorus' : 'the chorus') : 'the chorus and the verse after it';
  }
  if (c.peak >= 2) return 'the main theme';
  if (c.peak >= 1) return 'a repeated section';
  return 'the fullest stretch';
}

/** The whole pipeline over beat events: → the best window { fromBar (0-based), bars, startBeat, endBeat,
    sec, label, … } or null (nothing loopable: no window keeps the lead). */
export function findPhrase(events, { barBeats = 4, origin = 0, bpm = 120 } = {}){
  const F = barFeatures(events, { barBeats, origin });
  if (F.length < 8) return null;
  const S = selfSimilarity(F);
  // the lead must sound through the loop; a sparse lead (long rests between phrases) relaxes the floor once
  let all = scoreWindows(F, S, { barBeats, bpm });
  if (!all.length) all = scoreWindows(F, S, { barBeats, bpm, leadMin: PHRASE.LEAD_RELAX });
  const c = all[0];
  if (!c) return null;
  return { ...c, startBeat: origin + c.fromBar * barBeats, endBeat: origin + (c.fromBar + c.bars) * barBeats,
           totalBars: F.length, label: describePhrase(c) };
}
