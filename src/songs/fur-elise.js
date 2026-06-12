export default {
  label: 'Für Elise', sub: 'Beethoven · A minor · two marbles', bpm: 84,
  scale: ['A','B','C','D','D#','E','G#'],
  melody: [
    ['E5', .5], ['D#5', .5], ['E5', .5], ['D#5', .5],
    ['E5', .5], ['B4', .5], ['D5', .5], ['C5', .5],
    ['A4', 1.0], ['C4', .5], ['E4', .5], ['A4', .5],
    ['B4', 1.0], ['E4', .5], ['G#4', .5], ['B4', .5],
    ['C5', 1.0], ['E4', .5],
    ['E5', .5], ['D#5', .5], ['E5', .5], ['D#5', .5],
    ['E5', .5], ['B4', .5], ['D5', .5], ['C5', .5],
    ['A4', 1.0], ['C4', .5], ['E4', .5], ['A4', .5],
    ['B4', 1.0], ['E4', .5], ['C5', .5], ['B4', .5],
    ['A4', 2.0],
  ],
  bass: {
    delay: 4,            // rests through the opening trill-run, like the score
    notes: [
      // rolling left-hand arpeggios: A–E–A under the home phrases,
      // E–E–G# under the dominant, one huge lob vaulting trill-run 2
      ['A3', .5], ['E4', .5], ['A4', 1.5],
      ['E3', .5], ['E4', .5], ['G#4', 1.5],
      ['A3', .5], ['E4', .5], ['A4', 4.5],
      ['A3', .5], ['E4', .5], ['A4', 1.5],
      ['E3', .5], ['E4', .5], ['G#4', 1.5],
      ['A3', .5], ['E4', .5], ['A4', 1],
    ],
  },
};
