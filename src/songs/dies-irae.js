export default {
  label: 'Dies Irae', sub: 'Gregorian chant · doom · three marbles', bpm: 56,
  scale: ['A','C','D','E','F'],
  melody: [
    // the chant, twice — slow bells
    ['F4', 1], ['E4', 1], ['F4', 1], ['D4', 1], ['E4', 1], ['C4', 1], ['D4', 1.5], ['D4', 2.5],
    ['F4', 1], ['E4', 1], ['F4', 1], ['D4', 1], ['E4', 1], ['C4', 1], ['D4', 1.5], ['D4', 2.5],
  ],
  alto: {
    delay: 5, deep: true,   // the cathedral echo: same chant, five beats behind, an octave down
    notes: [
      ['F3', 1], ['E3', 1], ['F3', 1], ['D3', 1], ['E3', 1], ['C3', 1], ['D3', 1.5], ['D3', 2.5],
      ['F3', 1], ['E3', 1], ['F3', 1], ['D3', 1], ['E3', 1],
    ],
  },
  bass: [
    // funeral lobs
    ['D3', 5], ['A3', 5], ['D3', 5], ['A3', 2.5], ['D3', 2.5],
  ],
};
