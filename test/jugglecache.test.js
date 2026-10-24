import { describe, it, expect, afterEach } from 'vitest';
import { makeJuggleCache, JCACHE } from '../src/jugglecache.js';

const fakeStore = ({ quota = Infinity, broken = false } = {}) => {
  const m = new Map();
  const size = () => [...m.values()].reduce((a, v) => a + v.length, 0);
  const no = () => { throw new Error('SecurityError'); };
  return { m,
    getItem: broken ? no : k => (m.has(k) ? m.get(k) : null),
    setItem: broken ? no : (k, v) => { const was = m.get(k)?.length || 0; if (size() - was + v.length > quota) throw new Error('QuotaExceededError'); m.set(k, String(v)); },
    removeItem: broken ? no : k => { m.delete(k); } };
};
const plan = n => [{ c: [[0, 0, 1]], d: Array.from({ length: n }, (_, j) => [j % 3, j % 2, 0, 0]), h: [5, 0], cost: n, bad: 0, beam: 40 }];
const saved = { ...JCACHE };
afterEach(() => Object.assign(JCACHE, saved));

describe('the page remembers the juggles it solved (jugglecache.js)', () => {
  it('a plan comes back exactly as it went in', () => {
    const c = makeJuggleCache(fakeStore());
    expect(c.get('k1')).toBe(null);
    c.put('k1', plan(5));
    expect(c.get('k1')).toEqual(plan(5));
  });
  it('the least recently USED plan goes first (count bound)', () => {
    JCACHE.MAX_N = 3;
    const st = fakeStore(), c = makeJuggleCache(st);
    for (const k of ['a', 'b', 'c']) c.put(k, plan(2));
    c.get('a');                                           // a is used again: b is now the oldest
    c.put('d', plan(2));
    expect(c.get('b')).toBe(null);
    for (const k of ['a', 'c', 'd']) expect(c.get(k)).toEqual(plan(2));
    expect([...st.m.keys()].filter(k => k.startsWith('cascade:juggle:')).length).toBe(3);
  });
  it('the total size stays bounded; a plan bigger than the whole budget is never kept', () => {
    JCACHE.MAX_CHARS = 2000;
    const st = fakeStore(), c = makeJuggleCache(st);
    for (let i = 0; i < 12; i++) c.put('p' + i, plan(20));
    const kept = [...st.m.entries()].filter(([k]) => k.startsWith('cascade:juggle:'));
    expect(kept.reduce((a, [, v]) => a + v.length, 0)).toBeLessThanOrEqual(2000);
    expect(c.get('p11')).toEqual(plan(20));
    c.put('huge', plan(400));
    expect(c.get('huge')).toBe(null);
  });
  it('a full storage makes room once (its own oldest plans), else just forgets', () => {
    const st = fakeStore({ quota: 1500 }), c = makeJuggleCache(st);
    for (let i = 0; i < 6; i++) c.put('q' + i, plan(15));
    expect(c.get('q5')).toEqual(plan(15));
    st.m.set('other-app', 'x'.repeat(1400));              // somebody else fills the origin
    expect(() => c.put('r', plan(15))).not.toThrow();
  });
  it('a corrupted entry or index reads as missing, never throws; drop() forgets one', () => {
    const st = fakeStore(), c = makeJuggleCache(st);
    st.m.set('cascade:juggle:bad', '{not json');
    st.m.set('cascade:juggle-index', '"nope"');
    expect(c.get('bad')).toBe(null);
    st.m.set('cascade:juggle:obj', '{"a":1}');
    expect(c.get('obj')).toBe(null);                      // (a plan is a list of voices)
    c.put('ok', plan(3));
    expect(c.get('ok')).toEqual(plan(3));
    c.drop('ok');
    expect(c.get('ok')).toBe(null);
  });
  it('blocked or missing storage (private mode, iframe policy): it remembers nothing, quietly', () => {
    for (const c of [makeJuggleCache(fakeStore({ broken: true })), makeJuggleCache(null)]){
      expect(() => c.put('k', plan(3))).not.toThrow();
      expect(c.get('k')).toBe(null);
      expect(() => c.drop('k')).not.toThrow();
    }
  });
});
