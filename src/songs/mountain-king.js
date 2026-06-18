// inclusive-of-`from`, exclusive-of-`to` beat grid — for steady drum subdivisions
const every = (from, to, step) => {
  const out = [];
  for (let b = from; b < to - 1e-9; b += step) out.push(+b.toFixed(5));
  return out;
};

export default {
  label: 'Mountain King', sub: 'Grieg · accelerando · two marbles', bpm: 100,
  scale: ['A','B','C','D','D#','E'],
  melody: [
    // the same phrase, four times, each faster — rhythm compressing into geometry
    ['A4', 1], ['B4', 1], ['C5', 1], ['D5', 1], ['E5', 1], ['C5', 1], ['E5', 2],
    ['D#5', 1], ['B4', 1], ['D#5', 2], ['D5', 1], ['B4', 1], ['D5', 2],
    ['A4', .75], ['B4', .75], ['C5', .75], ['D5', .75], ['E5', .75], ['C5', .75], ['E5', 1.5],
    ['D#5', .75], ['B4', .75], ['D#5', 1.5], ['D5', .75], ['B4', .75], ['D5', 1.5],
    ['A4', .5], ['B4', .5], ['C5', .5], ['D5', .5], ['E5', .5], ['C5', .5], ['E5', 1],
    ['D#5', .5], ['B4', .5], ['D#5', 1], ['D5', .5], ['B4', .5], ['D5', 1],
    ['A4', .375], ['B4', .375], ['C5', .375], ['D5', .375], ['E5', .375], ['C5', .375], ['E5', .75],
    ['D#5', .375], ['B4', .375], ['D#5', .75], ['D5', .375], ['B4', .375], ['D5', .75],
    ['A4', 1], ['E5', 1], ['A5', 1],                  // the stinger
  ],
  bass: [
    // stomping root–fifth, accelerating in lockstep
    ['A3', 2], ['E4', 2], ['A3', 2], ['E4', 2], ['A3', 2], ['E4', 2], ['A3', 2], ['E4', 2],
    ['A3', 1.5], ['E4', 1.5], ['A3', 1.5], ['E4', 1.5], ['A3', 1.5], ['E4', 1.5], ['A3', 1.5], ['E4', 1.5],
    ['A3', 1], ['E4', 1], ['A3', 1], ['E4', 1], ['A3', 1], ['E4', 1], ['A3', 1], ['E4', 1],
    ['A3', .75], ['E4', .75], ['A3', .75], ['E4', .75], ['A3', .75], ['E4', .75], ['A3', .75], ['E4', .75],
    ['A3', 1], ['E3', 1], ['A3', 1],
  ],
  // The first percussion track. Each lane lists the ABSOLUTE beats it strikes
  // (a hit is `beat` or `[beat, velocity]`, velocity 0..1). No lock rule — hits
  // are pinned to the grid, so they can't desync; they need only fall inside the
  // 45-beat loop (= the melody's total). Each lane = one stationary drum, struck
  // by mortal balls on closed-form arcs. The groove tightens with the accelerando:
  // the kick tracks the bass stomp, the snare cracks the backbeat, the hat
  // subdivides ever finer (1 → ¾ → ½ → ⅜) until the 3-beat stinger.
  drums: {
    kick: [
      0, 4, 8, 12,                        // S1  (quarter=1 beat) — four bars
      16, 19, 22, 25,                     // S2  (×.75) — every 3
      28, 30, 32, 34,                     // S3  (×.5)  — every 2
      36, 37.5, 39, 40.5,                 // S4  (×.375)— every 1.5
      42, 43, 44,                         // stinger — three stabs
    ],
    snare: [
      2, 6, 10, 14,                       // S1 backbeats
      17.5, 20.5, 23.5, 26.5,             // S2
      29, 31, 33, 35,                     // S3
      36.75, 38.25, 39.75, 41.25,         // S4
      [41.5, .35], [41.75, .55],          // ghost roll-in to the stinger (velocity!)
      42, 43, 44,                         // stinger stabs, in unison with the kick
    ],
    hat: [
      ...every(0,  16, 1),                // S1 — quarter pulse
      ...every(16, 28, .75),              // S2 — tightening
      ...every(28, 36, .5),               // S3
      ...every(36, 42, .375),             // S4 — fastest ride
    ],
  },
};
