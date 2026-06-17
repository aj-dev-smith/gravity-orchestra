import { describe, it, expect } from 'vitest';
import { SONGS } from '../src/songs/index.js';
import { padRadius, layoutPads } from '../src/engine.js';

/* ---------------------------------------------------------------------------
   PAD OVERLAP GUARANTEE
   Pad size encodes register and is a pure function of the note (same note →
   same size, everywhere). Overlap on fast runs must therefore be solved by
   SPACING the pads apart — never by shrinking them, and never by touching
   gravity. This suite proves, up front, that no two pads on a track ever
   overlap across the entire catalogue. If it fails, the layout (not the size)
   needs to give more room. Mirrors main.js buildTrack's per-track setup.
   --------------------------------------------------------------------------- */

const normalizePart = part =>
  Array.isArray(part) ? { notes: part, delay: 0, deep: false }
                      : { notes: part.notes, delay: part.delay || 0, deep: !!part.deep };

// One entry per built track, matching buildWorld(): lead + optional alto/bass.
function tracksOf(song) {
  const out = [{ notes: song.melody, role: 'lead', zBase: 0, delay: 0, deep: false }];
  if (song.alto) { const a = normalizePart(song.alto); out.push({ ...a, role: 'alto', zBase: -3.4 }); }
  if (song.bass) { const b = normalizePart(song.bass); out.push({ ...b, role: 'bass', zBase: 4.2 }); }
  return out;
}

// Build a track's pads through the SAME engine paths buildTrack uses, so the
// guarantee is proven against the real geometry — not a reimplementation.
function padsFor(track, bpm) {
  const radOf = padRadius(track.notes, track.role);
  const pads = layoutPads(track.notes, {
    zBase: track.zBase, isBass: track.role === 'bass',
    delayBeats: track.delay, beat: 60 / bpm, radOf,
  });
  return pads.map(p => ({ pos: p.pos, note: p.note, r: radOf(p.note) }));
}

describe('pad layout — no two pads overlap (size is sacred, spacing gives way)', () => {
  for (const [key, song] of Object.entries(SONGS)) {
    for (const track of tracksOf(song)) {
      it(`${key} / ${track.role}: every pad clears every other`, () => {
        const pads = padsFor(track, song.bpm);
        let worst = Infinity, where = '';
        for (let i = 0; i < pads.length; i++) {
          for (let j = i + 1; j < pads.length; j++) {
            const slack = pads[i].pos.distanceTo(pads[j].pos) - (pads[i].r + pads[j].r);
            if (slack < worst) { worst = slack; where = `${pads[i].note}#${i} vs ${pads[j].note}#${j}`; }
          }
        }
        // slack ≥ 0 means surfaces never interpenetrate
        expect(worst, `tightest pair: ${where} (slack ${worst.toFixed(3)})`).toBeGreaterThanOrEqual(0);
      });
    }
  }
});
