export default {
  label: 'Greensleeves', sub: 'Traditional · A minor · two marbles', bpm: 116,
  scale: ['A','B','C','D','E','F#','G','G#'],
  melody: [
    // 6/8 lilt: long-short hop pairs — 48 eighth-beats
    ['A4', 1],
    ['C5', 2], ['D5', 1], ['E5', 1.5], ['F#5', .5], ['E5', 1],
    ['D5', 2], ['B4', 1], ['G4', 1.5], ['A4', .5], ['B4', 1],
    ['C5', 2], ['A4', 1], ['A4', 1.5], ['G#4', .5], ['A4', 1],
    ['B4', 2], ['G#4', 1], ['E4', 3],
    ['A4', 1],
    ['C5', 2], ['D5', 1], ['E5', 1.5], ['F#5', .5], ['E5', 1],
    ['D5', 2], ['B4', 1], ['G4', 1.5], ['A4', .5], ['B4', 1],
    ['C5', 1.5], ['B4', .5], ['A4', 1], ['G#4', 1.5], ['F#4', .5], ['G#4', 1],
    ['A4', 4],
  ],
  bass: {
    delay: 1,            // the pickup note sings alone
    notes: [
      // root–fifth in dotted-quarter strides, V–i cadence to close
      ['A3', 3], ['E4', 3], ['G3', 3], ['D4', 3],
      ['A3', 3], ['E4', 3], ['E3', 3], ['B3', 3],
      ['A3', 3], ['E4', 3], ['G3', 3], ['D4', 3],
      ['A3', 3], ['E4', 3],
      ['E3', 2], ['A3', 3],
    ],
  },
};
