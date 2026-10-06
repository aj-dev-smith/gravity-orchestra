import { describe, it, expect, vi } from 'vitest';
import { makePerfGovernor } from '../src/perfgov.js';

/* drive the governor with synthetic frames: interval d ms, of which cpu ms is the frame's own work */
function rig(maxPR = 2, params = '', msaa = 0){
  const applied = [];
  let now = 0;
  const gov = makePerfGovernor({ maxPR, msaa, apply: q => applied.push(q), params: new URLSearchParams(params) });
  const run = (n, d, cpu) => {
    for (let i = 0; i < n; i++){
      now += d;
      const t0 = now;
      vi.spyOn(performance, 'now').mockReturnValue(t0 + cpu);
      gov.frame(t0, true);
    }
    vi.restoreAllMocks();
  };
  return { gov, applied, run };
}

describe('perf governor', () => {
  it('a fast device never leaves rung 0 (desktop look untouched)', () => {
    const { gov, applied, run } = rig(2);
    run(2000, 16.7, 4);
    expect(gov.state.level).toBe(0);
    expect(applied).toEqual([]);
  });
  it('a GPU-bound phone steps down the pixel-ratio ladder, then back up when it recovers', () => {
    const { gov, run } = rig(2);
    run(1000, 33.3, 6);                      // slow, and the frame's own CPU is small → pixels are the cost
    expect(gov.state.pr).toBe(1);
    expect(gov.state.bloomScale).toBeLessThan(1);
    run(3000, 16.7, 6);
    expect(gov.state.level).toBe(0);
  });
  it('a CPU-bound frame keeps its resolution (fewer pixels would buy nothing)', () => {
    const { gov, applied, run } = rig(2);
    run(1000, 33.3, 30);
    expect(gov.state.level).toBe(0);
    expect(applied).toEqual([]);
  });
  it('one hitch never moves it; a 1x screen has nothing below native', () => {
    const { gov, run } = rig(1);
    run(200, 16.7, 4); run(1, 200, 4); run(200, 16.7, 4);
    expect(gov.state.level).toBe(0);
    expect(gov.state.ladder).toEqual([1]);
  });
  it('a 1x screen with MSAA sheds only the multisampling when GPU-bound', () => {
    const { gov, applied, run } = rig(1, '', 4);
    expect(gov.state.ladder).toEqual([1, 1]);
    run(1000, 33.3, 5);
    expect(applied.at(-1)).toEqual({ pr: 1, msaa: 0, bloomScale: 1 });
  });
  it('?pr pins the ratio and disables it', () => {
    const { gov, applied, run } = rig(2, 'pr=1.5');
    expect(applied).toEqual([{ pr: 1.5, msaa: 0, bloomScale: 1 }]);
    run(1000, 40, 5);
    expect(gov.state.enabled).toBe(false);
  });
});
