/* The juggler's SEARCH off the main thread (src/juggle.js — seconds on a dense import). One worker
   runs one JOB (src/jugglejobs.js runJob); jugglejobs.js planInWorkers runs several side by side:
     { id, song, vi, m }   → { id, key, vi, m, plan }   one voice at one beam width (solveVoiceAt)
     { id, song, solved }  → { id, key, hold }          the plates' HOLDS for a settled solve
     { id, song }          → { id, key, solved }        all of it, in order (solveJuggler + holds)
   Each re-derives the layout from the song (layoutJuggler is pure: the belt voices + bpm are all
   it reads), so the key it answers with must be main's — main re-solves on a mismatch. */
import { runJob } from './jugglejobs.js';

self.onmessage = e => self.postMessage(runJob(e.data));
