// inclusive-of-`from`, exclusive-of-`to` beat grid — for steady drum subdivisions
const every = (from, to, step) => {
  const out = [];
  for (let b = from; b < to - 1e-9; b += step) out.push(+b.toFixed(5));
  return out;
};

/* BACKBEAT — a plain groove whose only job is to show the WHOLE kit in motion so we
   can tune the drum instrument's look & feel. The engine needs a melodic spine (it
   drives loop length / timeline-zero / the camera), so there's a minimal low riff on
   the lead conveyor — deliberately sparse, the drums are the star. 16-beat loop; all
   drum hits live in [0,16). Exercises kick / snare / hat / crash / ride (+ its bell) / a choked china / a splash and a five-tom
   descending fill into the loop seam. */
export default {
  label: 'Backbeat', sub: 'a groove — drum-kit showcase', bpm: 96,
  scale: ['E','F#','G','A','B','C','D'],
  // minimal spine: a low two-bar riff (sum = 16, the loop length)
  melody: [
    ['E3', 2], ['B3', 2], ['G3', 2], ['A3', 2],
    ['E3', 2], ['D4', 2], ['B3', 2], ['A3', 2],
  ],
  drums: {
    // driving kick: downbeats + the syncopated "and" of 2/3
    kick:  [0, 2.5, 4, 6.5, 8, 10.5, 12],
    // backbeat crack on 2 and 4 of each bar (dropped on the last to clear the fill)
    snare: [2, 6, 10],
    // steady eighths through the groove, stopping for the fill
    hat:   every(0, 14, .5),
    // crash accents the top of each bar; ride marks the second half, its BELL on the &s
    crash: [[0, 1], [8, .85]],
    ride:  [8, 9, 10, 11, 12, 13],
    rideBell: [[8.5, .6], [9.5, .55], [10.5, .6], [11.5, .55], [12.5, .65], [13.5, .6]],
    // the china STABS on 4 and is CHOKED half a beat later (the magnet clamp grabs it);
    // a splash answers on the & of 6
    china:  [[4, .9, .5]],
    splash: [[6.5, .75]],
    // a fast five-tom cascade into the loop — high→low, reading as a tonal sweep
    tomHigh:   [14],
    tomHiMid:  [14.25],
    tomMid:    [14.5],
    tomLow:    [14.75],
    floorHigh: [15, 15.5],
  },
};
