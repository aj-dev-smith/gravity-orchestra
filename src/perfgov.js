/* ============================================================
   PERF GOVERNOR — adaptive resolution for slow devices (phones).
   Render-time only: it never touches songTime, the solve, or audio.

   The look is authored at the device's pixel ratio (capped at 2). A phone
   that can't hold the frame budget at that resolution steps DOWN a ladder
   of pixel ratios (and, at the bottom rungs, a lower-resolution bloom
   chain); a 1× screen can't go below native, so it sheds the scene MSAA
   and then the bloom resolution. It measures the median frame interval
   over a short window, so a single hitch (a song build, a GC) never moves it; it only steps UP again
   after a long run of comfortable frames, and every failed probe doubles
   the wait before the next one (no oscillation).
   EVERY STEP DOWN MUST PROVE IT HELPED. Whether pixels are the bottleneck
   can't be read off the clock reliably (a browser that waits on the GPU
   inside render() makes a GPU-starved frame look CPU-bound; a phone capped
   at 30 fps — Low Power Mode, a throttled cross-origin iframe, a 30/50 Hz
   panel — makes an idle GPU look slow). So a slow device takes a TRIAL step
   (up to TRIAL_DEPTH rungs, one window each) and keeps it only if the median
   interval got ≥ GAIN faster than before the trial; otherwise the look goes
   straight back to where it was and further trials back off (twice, then it
   stops trying for the page — a capped device stays at full quality).

   A fast machine never leaves rung 0, so the desktop look is untouched.
   It never goes below native CSS resolution (pr 1) on its own.

     const gov = makePerfGovernor({ screen: () => ({ maxPR, msaa }), apply({ pr, msaa, bloomScale }) {…} })
                                // (screen is re-read when devicePixelRatio changes; or pass maxPR/msaa fixed)
     gov.frame(t0, active)      // once per animate(), AFTER the render; t0 = performance.now() at its top,
                                //   active = playing & visible
     gov.hold(frames)           // ignore the next n frames (a rebuild just happened)
   URL: ?gov=0 disables it · ?pr=<x> pins the pixel ratio (and disables it).
   ============================================================ */

const WIN = 45;          // frames per measurement window
const SLOW = 1000 / 48;  // median frame interval above this (ms) → trial step down
const EASY = 1000 / 57;  // …below this for UP_WINS windows → probe one step up
const UP_WINS = 8;       // ≈ 6 s of comfortable frames before a probe
const MAX_BACKOFF = 64;  // windows (≈ 50 s)
const GAIN = .85;        // a kept step must bring the median to ≤ 85 % of the pre-trial median
                         //   (window-to-window noise on a capped/jittery device is ~10 %; a real GPU-bound rung is 23–44 % fewer pixels)
const TRIAL_DEPTH = 2;   // rungs a trial may descend before it gives up (vsync quantizes small gains)
const DOWN_WAIT = [40];      // windows (≈ 30–60 s) to wait after the 1st failed trial; a 2nd failure ends trials for the page

/* the rungs for a device: native-capped ratio first, then coarser, the bloom chain a notch coarser
   on the last rungs. A 1× screen can't go below native: it sheds its MSAA, then the bloom res. */
export function makeLadder(maxPR, msaa = 0){
  const prs = [maxPR];
  for (const r of [1.75, 1.5, 1.25, 1]) if (r < maxPR - .05) prs.push(r);
  const ladder = prs.map((pr, i) => ({ pr, msaa, bloomScale: i >= prs.length - 2 && prs.length > 2 ? .6 : 1 }));
  if (msaa) ladder.splice(1, 0, { pr: maxPR, msaa: 0, bloomScale: 1 });
  if (prs.length === 1) ladder.push({ pr: maxPR, msaa: 0, bloomScale: .6 });
  return ladder;
}

export function makePerfGovernor({ maxPR, msaa = 0, screen = null, apply, params = new URLSearchParams(location.search), ladderFor = makeLadder }){
  if (screen) ({ maxPR, msaa } = screen());              // screen() → { maxPR, msaa } for the CURRENT display
  const pinned = params.has('pr') ? Math.max(.5, Math.min(3, +params.get('pr') || maxPR)) : null;
  const enabled = pinned === null && params.get('gov') !== '0';
  let ladder = ladderFor(maxPR, msaa);
  let level = 0, last = 0, holdN = 90, buf = [], cbuf = [], cpuMed = 0, easy = 0, wait = UP_WINS, probing = -1, steps = 0, median = 0;
  let trial = null;              // { from: level before the trial, ref: its median } while a step down is on probation
  let fails = 0, downWait = 0, kept = 0, reverted = 0, slowRef = 0;   // slowRef: the previous window's median, when it was slow

  const set = l => { level = l; steps++; apply(ladder[level]); };
  if (pinned !== null) apply({ pr: pinned, msaa, bloomScale: 1 });
  // the display can change under us (browser zoom, the window dragged to another monitor):
  // devicePixelRatio moves → rebuild the ladder for the new screen (one-shot query, re-armed each time)
  const watch = () => {
    if (!screen || pinned !== null || typeof matchMedia !== 'function') return;
    const mq = matchMedia(`(resolution: ${devicePixelRatio}dppx)`);
    mq.addEventListener?.('change', () => { const s = screen(); api.retarget(s.maxPR, s.msaa); watch(); }, { once: true });
  };

  const judge = () => {
    if (trial){
      if (median <= trial.ref * GAIN){ trial = null; kept++; fails = 0; return; }           // it helped: keep it
      if (level < ladder.length - 1 && level - trial.from < TRIAL_DEPTH){ set(level + 1); holdN = 20; return; }   // one rung deeper
      set(trial.from); holdN = 20; trial = null; reverted++; slowRef = 0;                                // no gain: put the look back
      downWait = fails < DOWN_WAIT.length ? DOWN_WAIT[fails] : Infinity; fails++;
      easy = 0; return;
    }
    if (downWait > 0) downWait--;
    // TWO slow windows in a row before a trial (one can be warm-up/compile noise); the
    // reference is the better of the two, so a noisy-high first window can't fake a gain
    const prevSlow = slowRef; slowRef = median > SLOW ? median : 0;
    if (median > SLOW && prevSlow && level < ladder.length - 1 && downWait === 0){
      // a probe up that failed right away: back off before the next one
      if (probing >= 0 && probing <= 2) wait = Math.min(MAX_BACKOFF, wait * 2);
      probing = -1; easy = 0;
      trial = { from: level, ref: Math.min(median, prevSlow) }; slowRef = 0; set(level + 1); holdN = 20;   // (the resize itself costs a frame or two)
      return;
    }
    if (level > 0 && median < EASY){
      if (++easy >= wait){ easy = 0; probing = 0; set(level - 1); holdN = 20; }
    } else easy = 0;
    if (probing >= 0 && ++probing > 2) probing = -1;                        // survived the probe window
  };

  const api = {
    frame(t0, active){
      const d = t0 - last; last = t0;
      const cpu = performance.now() - t0;
      if (!enabled || !active || d > 250 || d <= 0) return;   // paused / tab switch / hitch: not a sample
      if (holdN > 0){ holdN--; return; }
      buf.push(d); cbuf.push(cpu);
      if (buf.length < WIN) return;
      buf.sort((a, b) => a - b); cbuf.sort((a, b) => a - b);
      median = buf[WIN >> 1]; cpuMed = cbuf[WIN >> 1]; buf = []; cbuf = [];   // (cpuMs: a dev readout only)
      judge();
    },
    hold(n = 60){ holdN = Math.max(holdN, n); buf = []; cbuf = []; slowRef = 0; },
    /** the screen changed (browser zoom, window moved to another display): new ladder, back to full quality */
    retarget(newMaxPR, newMsaa = msaa){
      maxPR = newMaxPR; msaa = newMsaa; ladder = ladderFor(maxPR, msaa);
      trial = null; fails = 0; downWait = 0; easy = 0; slowRef = 0; wait = UP_WINS; probing = -1;
      if (enabled){ set(0); holdN = 60; buf = []; cbuf = []; }
    },
    get state(){ return { enabled, pinned, level, ...(pinned !== null ? { pr: pinned } : ladder[level]), ladder: ladder.map(l => l.pr),
                          medianMs: +median.toFixed(2), cpuMs: +cpuMed.toFixed(2), steps, wait,
                          trial: trial && { ...trial }, kept, reverted, downWait }; },
    force(l){ trial = null; set(Math.max(0, Math.min(ladder.length - 1, l))); },   // dev: __dev.gov.force(n)
  };
  watch();
  return api;
}
