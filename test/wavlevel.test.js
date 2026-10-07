import { describe, it, expect } from 'vitest';
import { voiceWavScale, VOICE_WAV_GAIN, VOICE_WAV_TOP } from '../src/wavlevel.js';
import { INSTRUMENTS } from '../src/instruments/index.js';
import { SONGS } from '../src/songs/index.js';

const peakOf = s => { let p = 0; for (const x of s) p = Math.max(p, Math.abs(x)); return p; };
const dB = x => 20 * Math.log10(x);

/* the iOS <audio> bank's instrument WAVs (audio.js encodeWav with voiceWavScale): a voice's level
   is BAKED into its render (song.mix, soft layers, RMS-set voices) — the WAV must keep it */
describe('voice WAV level (the iOS sample path keeps the render level)', () => {
  it('is a fixed scale below the ceiling: ratios between voices survive', () => {
    const a = .8, b = .4;                     // a voice, and the same voice at song.mix .5
    expect(a * voiceWavScale(a) / (b * voiceWavScale(b))).toBeCloseTo(2, 9);
    expect(voiceWavScale(.3)).toBe(VOICE_WAV_GAIN);
  });
  it('never writes a sample past the ceiling', () => {
    for (const p of [.1, .5, .82, .84, .9, 1, 1.4, 3]) expect(p * voiceWavScale(p)).toBeLessThanOrEqual(VOICE_WAV_TOP + 1e-12);
    expect(Number.isFinite(voiceWavScale(0))).toBe(true);
  });
  it('a unity voice at a typical render peak sits where the old normalised WAV did (±1 dB)', () => {
    for (const p of [.76, .8, .82, .86]) expect(Math.abs(dB(p * voiceWavScale(p) / VOICE_WAV_TOP))).toBeLessThan(1);
  });
  it('every shipped voice render peaks where the ceiling guard costs < 1 dB (its level is what reaches the WAV)', () => {
    for (const I of INSTRUMENTS){
      const ids = I.voiceIds ? I.voiceIds(I.demo.part, { beat: 60 / I.demo.bpm, bpm: I.demo.bpm, rollT: 2.6, P: 2.6 + I.demo.beats * 60 / I.demo.bpm + 1.2, loopBeats: I.demo.beats }) : [...new Set(I.demo.part.map(e => e[1]))];
      for (const id of ids.slice(0, 12)){
        const p = peakOf(I.voice(id).samples);
        expect(dB(voiceWavScale(p) / VOICE_WAV_GAIN), `${I.key}:${id} peak ${p}`).toBeGreaterThan(-1);   // the ceiling guard costs < 1 dB
      }
    }
  });
  it('song.mix survives on iOS: a staged machine bakes a WAV that much quieter', () => {
    // The Entertainer stages its strum at .42 — on iOS the normalised WAV used to bring it back to full
    const S = SONGS.entertainer, I = INSTRUMENTS.find(i => i.key === 'strum');
    const id = String(S.parts.strum[0][1]), r = I.voice(id), g = S.mix.strum;
    const full = peakOf(r.samples), staged = full * g;
    const ratio = (staged * voiceWavScale(staged)) / (full * voiceWavScale(full));
    expect(Math.abs(dB(ratio) - dB(g))).toBeLessThan(.5);
  });
});
