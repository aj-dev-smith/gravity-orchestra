/* ============================================================
   PERF GOVERNOR — adaptive resolution for slow devices (phones).
   Render-time only: it never touches songTime, the solve, or audio.

   The look is authored at the device's pixel ratio (capped at 2). A phone
   that can't hold the frame budget at that resolution steps DOWN a ladder
   of pixel ratios (and, at the bottom rungs, a lower-resolution bloom
   chain); a 1× screen's only step is dropping the scene MSAA. It measures the median frame interval over a short window, so a
   single hitch (a song build, a GC) never moves it; it only steps UP again
   after a long run of comfortable frames, and every failed probe doubles
   the wait before the next one (no oscillation).
   Resolution only helps a GPU-bound frame: when the frame's own CPU time
   (update + draw submission) is most of the interval, pixels aren't the
   bottleneck and the governor leaves the look alone.

   A fast machine never leaves rung 0, so the desktop look is untouched.
   It never goes below native CSS resolution (pr 1) on its own.

     const gov = makePerfGovernor({ maxPR, msaa, apply({ pr, msaa, bloomScale }) {…} })
     gov.frame(t0, active)      // once per animate(), AFTER the render; t0 = performance.now() at its top,
                                //   active = playing & visible
     gov.hold(frames)           // ignore the next n frames (a rebuild just happened)
   URL: ?gov=0 disables it · ?pr=<x> pins the pixel ratio (and disables it).
   ============================================================ */

const WIN = 45;          // frames per measurement window
const SLOW = 1000 / 48;  // median frame interval above this (ms) → step down
const EASY = 1000 / 57;  // …below this for UP_WINS windows → probe one step up
const UP_WINS = 8;       // ≈ 6 s of comfortable frames before a probe
const MAX_BACKOFF = 64;  // windows (≈ 50 s)

export function makePerfGovernor({ maxPR, msaa = 0, apply, params = new URLSearchParams(location.search) }){
  const pinned = params.has('pr') ? Math.max(.5, Math.min(3, +params.get('pr') || maxPR)) : null;
  const enabled = pinned === null && params.get('gov') !== '0';
  // the ladder: native-capped ratio first, then coarser; bloom drops a notch on the last rungs
  const prs = [maxPR];
  for (const r of [1.75, 1.5, 1.25, 1]) if (r < maxPR - .05) prs.push(r);
  const ladder = prs.map((pr, i) => ({ pr, msaa, bloomScale: i >= prs.length - 2 && prs.length > 2 ? .6 : 1 }));
  // a 1× screen with multisampling sheds the MSAA before anything else (its only rung)
  if (msaa) ladder.splice(1, 0, { pr: maxPR, msaa: 0, bloomScale: 1 });
  let level = 0, last = 0, holdN = 90, buf = [], cbuf = [], cpuMed = 0, easy = 0, wait = UP_WINS, probing = -1, steps = 0, median = 0;

  const set = l => { level = l; steps++; apply(ladder[level]); };
  if (pinned !== null) apply({ pr: pinned, msaa, bloomScale: 1 });

  return {
    frame(t0, active){
      const d = t0 - last; last = t0;
      const cpu = performance.now() - t0;
      if (!enabled || !active || d > 250 || d <= 0) return;   // paused / tab switch / hitch: not a sample
      if (holdN > 0){ holdN--; return; }
      buf.push(d); cbuf.push(cpu);
      if (buf.length < WIN) return;
      buf.sort((a, b) => a - b); cbuf.sort((a, b) => a - b);
      median = buf[WIN >> 1]; cpuMed = cbuf[WIN >> 1]; buf = []; cbuf = [];
      const gpuBound = cpuMed < .7 * median;                    // CPU-bound: fewer pixels would buy nothing
      if (median > SLOW && level < ladder.length - 1 && gpuBound){
        // a probe that failed right away: back off before the next one
        if (probing >= 0 && probing <= 2) wait = Math.min(MAX_BACKOFF, wait * 2);
        probing = -1; easy = 0; set(level + 1); holdN = 20;      // (the resize itself costs a frame or two)
      } else if (level > 0 && (median < EASY || !gpuBound)){    // comfortable — or slow for a reason pixels can't fix
        if (++easy >= wait){ easy = 0; probing = 0; set(level - 1); holdN = 20; }
      } else easy = 0;
      if (probing >= 0 && ++probing > 2) probing = -1;          // survived the probe window
    },
    hold(n = 60){ holdN = Math.max(holdN, n); buf = []; cbuf = []; },
    get state(){ return { enabled, pinned, level, ...(pinned !== null ? { pr: pinned } : ladder[level]), ladder: ladder.map(l => l.pr),
                          medianMs: +median.toFixed(2), cpuMs: +cpuMed.toFixed(2), steps, wait }; },
    force(l){ set(Math.max(0, Math.min(ladder.length - 1, l))); },   // dev: __dev.gov.force(n)
  };
}
