import { describe, it, expect, vi } from 'vitest';
import { makePerfGovernor, makeLadder } from '../src/perfgov.js';

/* drive the governor with synthetic frames. `d` is the frame interval (ms) — a number, or a
   function of the current rung ({pr, msaa, bloomScale}) to model a device whose pace depends
   on resolution; cpu ms is the frame's own measured work (only a dev readout now). */
function rig(maxPR = 2, params = '', msaa = 0){
  const applied = [];
  let now = 0;
  const gov = makePerfGovernor({ maxPR, msaa, apply: q => applied.push(q), params: new URLSearchParams(params) });
  const run = (n, d, cpu = 4) => {
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    for (let i = 0; i < n; i++){
      now += typeof d === 'function' ? d(gov.state) : d;
      clock = now + cpu;
      gov.frame(now, true);
    }
    vi.restoreAllMocks();
  };
  return { gov, applied, run };
}
/* a GPU-bound phone: interval ∝ pixels (pr²), a little less with the coarser bloom */
const gpu = base => s => base * (s.pr / 2) ** 2 * (s.bloomScale < 1 ? .9 : 1);

describe('perf governor', () => {
  it('a fast device never leaves rung 0 (desktop look untouched)', () => {
    const { gov, applied, run } = rig(2);
    run(2000, 16.7, 4);
    expect(gov.state.level).toBe(0);
    expect(applied).toEqual([]);
  });
  it('a GPU-bound phone steps down the ladder (each step proven), then back up when it recovers', () => {
    const { gov, run } = rig(2);
    run(1500, gpu(60));                       // 60 ms at pr 2 → each rung measurably faster
    expect(gov.state.pr).toBeLessThan(2);
    expect(gov.state.kept).toBeGreaterThan(0);
    expect(gov.state.reverted).toBe(0);
    run(3000, 16.7);
    expect(gov.state.level).toBe(0);
  });
  it('a GPU-starved phone whose browser blocks on the GPU inside render() is still helped', () => {
    const { gov, run } = rig(2);
    run(1500, gpu(40), 38);                   // measured CPU ≈ interval: the old share test called this CPU-bound
    expect(gov.state.level).toBeGreaterThan(0);
    expect(gov.state.medianMs).toBeLessThan(1000 / 48);
  });
  it('a 30 fps-capped phone (Low Power Mode / throttled iframe) keeps full quality after one trial', () => {
    const { gov, applied, run } = rig(2);
    run(3200, 33.3, 3);
    expect(gov.state.level).toBe(0);
    expect(applied.at(-1)).toEqual(makeLadder(2)[0]);
    expect(gov.state.kept).toBe(0);
    expect(gov.state.reverted).toBeGreaterThan(0);
    // trials back off and then stop: a capped device is not flickered forever
    run(5000, 33.3, 3);
    const n = applied.length;
    run(20000, 33.3, 3);
    expect(applied.length).toBe(n);
    expect(gov.state.level).toBe(0);
  });
  it('a JITTERY capped device (window medians wander ±10 %) never keeps a step it did not earn', () => {
    const { gov, run } = rig(2);
    let k = 0, phase = 0;
    // slow drift between windows (a compile, a GC, the rAF skip landing differently) — independent of the rung
    run(12000, () => { if (++k % 45 === 0) phase = (phase * 7 + 3) % 11; return 36 + phase * .8; }, 3);
    expect(gov.state.kept).toBe(0);
    expect(gov.state.level).toBe(0);
  });
  it('a CPU-bound frame keeps its resolution (fewer pixels buy nothing, the trial is reverted)', () => {
    const { gov, run } = rig(2);
    run(4000, 33.3, 30);
    expect(gov.state.level).toBe(0);
    expect(gov.state.kept).toBe(0);
  });
  it('one hitch never moves it; a 1x screen never goes below native', () => {
    const { gov, run } = rig(1);
    run(200, 16.7, 4); run(1, 200, 4); run(200, 16.7, 4);
    expect(gov.state.level).toBe(0);
    expect(gov.state.ladder.every(pr => pr === 1)).toBe(true);
  });
  it('a 1x screen with MSAA sheds the multisampling, then the bloom resolution', () => {
    expect(makeLadder(1, 4)).toEqual([
      { pr: 1, msaa: 4, bloomScale: 1 }, { pr: 1, msaa: 0, bloomScale: 1 }, { pr: 1, msaa: 0, bloomScale: .6 }]);
    const { gov, applied, run } = rig(1, '', 4);
    run(1500, s => (s.msaa ? 40 : 30) * (s.bloomScale < 1 ? .8 : 1), 5);
    expect(applied[0]).toEqual({ pr: 1, msaa: 0, bloomScale: 1 });
    expect(gov.state.bloomScale).toBe(.6);
  });
  it('retarget (the display changed) rebuilds the ladder and returns to full quality', () => {
    const { gov, applied, run } = rig(2);
    run(1500, gpu(60));
    expect(gov.state.level).toBeGreaterThan(0);
    gov.retarget(1, 4);
    expect(gov.state.level).toBe(0);
    expect(applied.at(-1)).toEqual({ pr: 1, msaa: 4, bloomScale: 1 });
  });
  it('?pr pins the ratio and disables it', () => {
    const { gov, applied, run } = rig(2, 'pr=1.5');
    expect(applied).toEqual([{ pr: 1.5, msaa: 0, bloomScale: 1 }]);
    run(1000, 40, 5);
    expect(gov.state.enabled).toBe(false);
  });
});
