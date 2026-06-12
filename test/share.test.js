import { describe, it, expect } from 'vitest';
import { encodeSong, decodeSong, validateSong } from '../src/share.js';
import { SONGS } from '../src/songs/index.js';

describe('share encode/decode', () => {
  it('round-trips every catalog song exactly', async () => {
    for (const [key, song] of Object.entries(SONGS)) {
      const hash = await encodeSong(song);
      expect(hash, key).toMatch(/^[A-Za-z0-9_-]+$/);          // url-safe, no padding
      expect(await decodeSong(hash), key).toEqual(song);
    }
  });

  it('compresses below raw JSON size', async () => {
    const song = SONGS['canon-in-d'];
    const hash = await encodeSong(song);
    expect(hash.length).toBeLessThan(JSON.stringify(song).length);
  });

  it('rejects garbage hashes', async () => {
    await expect(decodeSong('!!notbase64!!')).rejects.toThrow();
    await expect(decodeSong('aGVsbG8')).rejects.toThrow();    // valid b64, not deflate
  });
});

describe('validateSong', () => {
  const good = () => JSON.parse(JSON.stringify(SONGS['fur-elise']));

  it('accepts every catalog song', () => {
    Object.values(SONGS).forEach(s => expect(() => validateSong(s)).not.toThrow());
  });

  it('rejects non-objects and missing fields', () => {
    expect(() => validateSong(null)).toThrow();
    expect(() => validateSong('hi')).toThrow();
    expect(() => validateSong({})).toThrow();
  });

  it('rejects bad notes and non-positive beats', () => {
    let s = good(); s.melody[0][0] = 'H5';
    expect(() => validateSong(s)).toThrow(/melody/);
    s = good(); s.melody[0][1] = 0;
    expect(() => validateSong(s)).toThrow(/melody/);
    s = good(); s.melody[0][1] = Infinity;
    expect(() => validateSong(s)).toThrow(/melody/);
  });

  it('rejects lock rule violations', () => {
    const s = good();
    s.bass.notes[0][1] += 0.5;
    expect(() => validateSong(s)).toThrow(/lock rule/);
  });
});
