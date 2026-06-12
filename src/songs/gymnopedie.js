export default {
  label: 'Gymnopédie No. 1', sub: 'Satie · floating · two marbles', bpm: 66,
  scale: ['A','B','C#','D','F#','G'],
  melody: [
    // the theme, stated twice — every hop hangs nearly a second
    ['F#5', 1], ['A5', 1], ['G5', 1],
    ['F#5', 1], ['C#5', 1], ['B4', 1],
    ['C#5', 1], ['D5', 1], ['A4', 1],
    ['F#4', 6],
    ['F#5', 1], ['A5', 1], ['G5', 1],
    ['F#5', 1], ['C#5', 1], ['B4', 1],
    ['C#5', 1], ['D5', 1], ['A4', 1],
    ['F#4', 6],
  ],
  bass: [
    // the slow oom: one root per bar, maj7 colors against the melody
    ['G3', 3], ['D4', 3], ['A3', 3], ['D3', 3], ['G3', 3],
    ['G3', 3], ['D4', 3], ['A3', 3], ['D3', 3], ['G3', 3],
  ],
};
