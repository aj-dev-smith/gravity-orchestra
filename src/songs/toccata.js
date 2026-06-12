export default {
  label: 'Toccata in Dm', sub: 'Bach · organ drama · two marbles', bpm: 72,
  scale: ['A','A#','C','C#','D','E','F','G'],
  melody: [
    // the mordent, the held cry, the falling run — then its octave echo
    ['A5', .25], ['G5', .25], ['A5', 2],
    ['G5', .25], ['F5', .25], ['E5', .25], ['D5', .25], ['C#5', .5], ['D5', 2.5],
    ['A4', .25], ['G4', .25], ['A4', 2],
    ['G4', .25], ['F4', .25], ['E4', .25], ['D4', .25], ['C#4', .5], ['D4', 2.5],
    // the diminished climb out of the deep, then the D minor resolution
    ['C#4', .5], ['E4', .5], ['G4', .5], ['A#4', .5],
    ['C#5', .5], ['E5', .5], ['G5', .5], ['A#5', .5],
    ['A5', 1], ['F5', 1], ['D5', 4],
  ],
  bass: {
    delay: 6.5,          // silence under the first cry; the pedal answers the echo
    notes: [
      ['D3', 6.5],       // one vast pedal lob spanning the entire low statement
      ['D3', 2], ['A3', 2], ['D3', 2], ['D4', 4],
    ],
  },
};
