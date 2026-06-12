/* ============================================================
   share.js — song JSON ↔ URL hash.
   deflate-raw via native CompressionStream: zero deps, ~40% of
   raw JSON size, so even long songs fit comfortably in a URL.
   ============================================================ */

const b64url = bytes => {
  let s = '';
  bytes.forEach(b => s += String.fromCharCode(b));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export async function encodeSong(song){
  const raw = new TextEncoder().encode(JSON.stringify(song));
  const stream = new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return b64url(new Uint8Array(await new Response(stream).arrayBuffer()));
}

export async function decodeSong(hash){
  const bin = atob(hash.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const song = JSON.parse(await new Response(stream).text());
  validateSong(song);
  return song;
}

/* hash payloads are untrusted input — reject anything buildWorld would choke on */
const NOTE_RE = /^[A-G]#?\d$/;
const checkNotes = (notes, name) => {
  if (!Array.isArray(notes) || !notes.length) throw new Error(`${name}: empty`);
  for (const n of notes){
    if (!Array.isArray(n) || !NOTE_RE.test(n[0]) || !(n[1] > 0) || !Number.isFinite(n[1]))
      throw new Error(`${name}: bad entry ${JSON.stringify(n)}`);
  }
};
export function validateSong(song){
  if (typeof song !== 'object' || !song) throw new Error('not an object');
  if (typeof song.label !== 'string' || !song.label) throw new Error('bad label');
  if (!(song.bpm > 0) || !Number.isFinite(song.bpm)) throw new Error('bad bpm');
  if (!Array.isArray(song.scale) || !song.scale.length) throw new Error('bad scale');
  checkNotes(song.melody, 'melody');
  const sum = a => a.reduce((s, [, b]) => s + b, 0);
  const total = sum(song.melody);
  for (const part of ['alto', 'bass']){
    if (!song[part]) continue;
    const d = Array.isArray(song[part]) ? {notes: song[part], delay: 0} : song[part];
    checkNotes(d.notes, part);
    if (Math.abs(sum(d.notes) + (d.delay || 0) - total) > 1e-9)
      throw new Error(`${part}: lock rule violated`);   // THE LOCK RULE — desyncs at the seam
  }
  return song;
}
