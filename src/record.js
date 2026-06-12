/* ============================================================
   record.js — capture one perfect loop.
   The timeline is analytic, so main.js arms a recording and
   starts/stops it exactly at the loop seam; end state equals
   start state, so the exported video loops seamlessly.
   This module is just the MediaRecorder mechanics.
   ============================================================ */

export const recSupported = canvas =>
  !!(canvas.captureStream && window.MediaRecorder);

/* socials want mp4; Safari obliges, Chrome gives webm */
const MIMES = [
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm',
];
const pickMime = () => MIMES.find(m => MediaRecorder.isTypeSupported(m)) || '';

export function startRecording(canvas, audioStream){
  const stream = canvas.captureStream(60);
  if (audioStream) audioStream.getAudioTracks().forEach(t => stream.addTrack(t));
  const mime = pickMime();
  const rec = new MediaRecorder(stream, {
    ...(mime && {mimeType: mime}),
    videoBitsPerSecond: 12e6,
  });
  const chunks = [];
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  const blob = new Promise(res => {
    rec.onstop = () => res(new Blob(chunks, {type: mime.split(';')[0] || 'video/webm'}));
  });
  rec.start(250);                                       // chunked: a crash keeps what it had
  return {
    stop(){
      try { rec.stop(); stream.getVideoTracks().forEach(t => t.stop()); } catch(e){}
      return blob;
    },
  };
}
