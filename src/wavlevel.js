/* ============================================================
   VOICE WAV LEVEL — how an instrument voice's render becomes its iOS <audio> WAV.

   iOS ignores el.volume (CLAUDE.md §5), so every level difference the sample path
   keeps must be BAKED into the WAV. A plugin voice's render already carries its
   level: the song's `song.mix` gain (the bank gain, main partMix), a soft velocity layer baked
   quieter (dulcimer SOFT_TRIM), a dense voice set by RMS not peak (riff RMS_T).
   The voice WAVs used to be PEAK-NORMALISED (encodeWav's default) — which undid
   every one of those on iOS: a machine a song staged at ×.42 played full, the soft
   piano layer came back up to the hard one's peak, the riff sat ~8 dB over the
   mallets. A voice WAV is now a FIXED scale of its render (the same for every
   voice, so their ratios survive), with a ceiling guard so nothing clips.

   VOICE_WAV_GAIN keeps the old overall level: a unity-mix voice at a typical
   render peak (~.82) lands at ~.9, where the normalised WAV sat (.92) — so the
   iOS balance against the belt / drum samples is unchanged; only the levels
   WITHIN the voices (the staging the live path already had) now hold too.
   Pure — the bank (audio.js) calls it; test/wavlevel.test.js pins it.
   ============================================================ */
export const VOICE_WAV_GAIN = 1.1;     // render → WAV scale (render peaks sit ~.76–.86)
export const VOICE_WAV_TOP = .92;      // the WAV's ceiling (encodeWav's old normalisation target)

/** the scale a voice render of sample-peak `peak` is written to its WAV at */
export function voiceWavScale(peak){
  if (!(peak > 0)) return VOICE_WAV_GAIN;
  return Math.min(VOICE_WAV_GAIN, VOICE_WAV_TOP / peak);
}
