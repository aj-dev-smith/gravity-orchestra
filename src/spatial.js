/* ============================================================
   SPATIAL — where a strike SOUNDS, from where it IS relative to the camera.
   PURE: no THREE, no DOM, no audio. Unit-tested in test/spatial.test.js.

   main.js projects each strike's world position into CAMERA space
   (x right, y up, −z forward — three.js convention) and hands the numbers here,
   plus the shot: { tanH: tan(half horizontal FOV), focus: eye→aim distance }.
   Out comes a tiny "placement" for the live voice:
       { pan, gain, shelf, room }
     pan    −1..1 stereo position — from where the source sits IN THE FRAME
            (screen x), not its bearing: on-screen voices spread across the
            field, off-screen ones lean softly toward their edge (tanh), never
            past PAN_MAX. A close follow shot can't pile the band onto one ear.
     gain   direct-sound level. Distance is RELATIVE TO THE SHOT (d / focus):
            whatever the camera frames is "here" at full level, wide shot or
            close-up; only voices clearly farther than the subject roll off.
     shelf  air absorption as a gentle high-shelf cut (dB ≤ 0) above AIR_HZ —
            real air is ~1 dB at 8 kHz over tens of metres, so this stays subtle.
     room   0..1 reverb-send scale: the reverberant field doesn't fall with
            distance while the direct sound does, so far voices sound WETTER
            (the direct/reverb ratio is how ears judge distance).
   Computed ONCE at the strike (the director cuts, the next strike follows the
   new shot — a note never swims while it rings). Audio-only: the physics,
   timing and visuals never see any of this.
   ============================================================ */

export const PAN_MAX   = .62;    // asymptote: the far off-screen wing still bleeds to both ears
export const PAN_K     = 1.15;   // tanh slope: frame edge (screen x = ±1) → ±PAN_MAX·tanh(PAN_K) ≈ ±.51
export const NEAR      = 1.4;    // ×focus: inside this, full level and full bandwidth
export const ROLLOFF   = .7;     // inverse-distance rolloff past NEAR·focus (0 = none)
export const MIN_GAIN  = .5;     // the farthest voice never drops more than ~6 dB
export const AIR_HZ    = 7000;   // high-shelf corner for air absorption
export const AIR_DB    = 1.5;    // dB of shelf cut per focus-length beyond NEAR…
export const AIR_MAX   = 4.5;    // …never more than this
export const ROOM_MIN  = .55;    // reverb-send scale at/inside NEAR (rises to 1 with distance)
export const PAN_COMP  = Math.SQRT2;   // StereoPannerNode on a MONO source is equal-power (cos/sin,
                                       // .707 per side at centre); ×√2 restores the old mono→stereo
                                       // upmix level (1.0 per side), so panning never costs 3 dB.
export const DEF_TANH  = Math.tan(27.5 * Math.PI / 180) * 16 / 9;   // fallback shot: 55° vfov, 16:9
export const DEF_FOCUS = 20;

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

/** Screen-space x of a camera-space point: −1..1 across the frame width, beyond = off-screen.
    Behind the camera (z ≥ 0) the depth is floored so it reads as far off its own side. */
export function screenX(x, z, tanH = DEF_TANH){
  const depth = Math.max(-z, .35 * Math.abs(x), 1e-3);
  return x / (depth * Math.max(1e-3, tanH));
}

/** Pan from frame position: odd, monotone, ≈ linear near centre, soft toward ±PAN_MAX. */
export function panFor(x, z, tanH = DEF_TANH){
  const sx = screenX(x, z, tanH);
  if (!Number.isFinite(sx) || Math.abs(sx) < 1e-9) return 0;
  return clamp(PAN_MAX * Math.tanh(PAN_K * sx), -PAN_MAX, PAN_MAX);
}

/** Direct-sound gain from shot-relative distance r = d / focus. */
export function gainFor(r){
  if (!(r > NEAR)) return 1;
  return Math.max(MIN_GAIN, NEAR / (NEAR + ROLLOFF * (r - NEAR)));
}

/** Air absorption: high-shelf cut in dB (0 = no filter) from shot-relative distance. */
export function airFor(r){
  if (!(r > NEAR)) return 0;
  return -Math.min(AIR_MAX, Math.round(AIR_DB * (r - NEAR) * 100) / 100);
}

/** Reverb-send scale: constant reverberant field vs falling direct sound → farther = wetter. */
export function roomFor(r){
  if (!(r > NEAR)) return ROOM_MIN;
  return Math.min(1, ROOM_MIN + (1 - ROOM_MIN) * (r - NEAR) / 2);
}

/** Stereo WIDTH by pitch, 0..1 (multiplies pan). Low frequencies barely localize (they
    diffract round the head — no level difference between ears below a few hundred Hz),
    and a bass/kick hard on one side reads as a broken speaker. So lows sit near centre,
    mids/highs take their full place. Log-ramp from WIDTH_LO at ≤ HZ_LO to 1 at ≥ HZ_HI. */
export const WIDTH_LO = .3, HZ_LO = 110, HZ_HI = 520;
export function widthFor(hz){
  if (!(hz > 0)) return 1;
  const u = clamp(Math.log(hz / HZ_LO) / Math.log(HZ_HI / HZ_LO), 0, 1);
  return WIDTH_LO + (1 - WIDTH_LO) * u;
}

/** Per-side gain of a StereoPannerNode (mono in) × PAN_COMP — the pan law place() applies.
    Constant power 2 (= the old mono→stereo upmix) at every pan; exactly 1/1 at centre. */
export function stereoGains(pan){
  const p = clamp(Number.isFinite(pan) ? pan : 0, -1, 1), a = (p + 1) * Math.PI / 4;
  return { L: Math.cos(a) * PAN_COMP, R: Math.sin(a) * PAN_COMP };
}

/** Camera-space position (+ shot) → { pan, gain, shelf, room }. */
export function spatialize(x, y, z, shot = {}){
  if (![x, y, z].every(Number.isFinite)) return { pan: 0, gain: 1, shelf: 0, room: ROOM_MIN };
  const tanH = Number.isFinite(shot.tanH) && shot.tanH > 0 ? shot.tanH : DEF_TANH;
  const focus = Number.isFinite(shot.focus) && shot.focus > 1 ? shot.focus : DEF_FOCUS;
  const r = Math.hypot(x, y, z) / focus;
  return { pan: panFor(x, z, tanH), gain: gainFor(r), shelf: airFor(r), room: roomFor(r) };
}
