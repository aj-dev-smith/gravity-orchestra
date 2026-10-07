import daybreakEngine from './daybreak-engine.js';
import furElise from './fur-elise.js';
import odeToJoy from './ode-to-joy.js';
import canonInD from './canon-in-d.js';
import greensleeves from './greensleeves.js';
import gymnopedie from './gymnopedie.js';
import preludeInC from './prelude-in-c.js';
import mountainKing from './mountain-king.js';
import toccata from './toccata.js';
import diesIrae from './dies-irae.js';
import backbeat from './backbeat.js';
import canonOrchestra from './canon-orchestra.js';
import carolOfTheBells from './carol-of-the-bells.js';
import morningMood from './morning-mood.js';
import baldMountain from './bald-mountain.js';
import danseMacabre from './danse-macabre.js';
import marionette from './marionette.js';
import winter from './winter.js';

export const SONGS = {
  'daybreak-engine': daybreakEngine,
  'fur-elise': furElise,
  'ode-to-joy': odeToJoy,
  'canon-in-d': canonInD,
  'greensleeves': greensleeves,
  'gymnopedie': gymnopedie,
  'prelude-in-c': preludeInC,
  'mountain-king': mountainKing,
  'toccata': toccata,
  'dies-irae': diesIrae,
  'backbeat': backbeat,
  'canon-orchestra': canonOrchestra,
  'carol-of-the-bells': carolOfTheBells,
  'morning-mood': morningMood,
  'bald-mountain': baldMountain,
  'danse-macabre': danseMacabre,
  'marionette': marionette,
  'winter': winter,
};

/* The picker's SHELVES — data, not engine. One table: shelf label → song keys, in menu
   order. SONGS keeps its own (test-pinned) order; this only decides how the <select>
   reads. A song on no shelf still shows (under 'More'), so a new song can never vanish
   from the menu just because nobody shelved it. */
export const SONG_GROUPS = [
  ['Showcase', ['daybreak-engine']],
  ['The Orchestra', ['canon-orchestra', 'carol-of-the-bells', 'morning-mood']],
  ['October', ['danse-macabre', 'bald-mountain', 'marionette']],
  ['Classics', ['fur-elise', 'ode-to-joy', 'canon-in-d', 'greensleeves', 'gymnopedie',
                'prelude-in-c', 'mountain-king', 'toccata', 'dies-irae']],
  ["Tonight's machines", ['winter']],
  ['Drum showcase', ['backbeat']],
];

/** [[label, [keys…]], …] for every key in `songs`: shelved ones in shelf order, the rest under 'More'. */
export function songShelves(songs = SONGS){
  const seen = new Set();
  const out = SONG_GROUPS.map(([label, keys]) => [label, keys.filter(k => k in songs && !seen.has(k) && seen.add(k))]);
  const rest = Object.keys(songs).filter(k => !seen.has(k));
  if (rest.length) out.push(['More', rest]);
  return out.filter(([, keys]) => keys.length);
}

/* What the page opens on. Seasonal: through October the house plays Danse Macabre (it
   opens in its own graveyard — the song's `room` field); the rest of the year, the
   Daybreak Engine (every machine in the room). Pure fn of the date so it's testable;
   main overrides it with ?song= and pins the Daybreak Engine under ?debug (dev frames
   must not depend on the calendar). */
export const DEFAULT_SONG = 'daybreak-engine';
export const SEASONAL = [{ month: 9, song: 'danse-macabre' }];   // month: 0-based (9 = October)
export function defaultSongKey(date = new Date()){
  const s = SEASONAL.find(x => x.month === date.getMonth());
  return s && SONGS[s.song] ? s.song : DEFAULT_SONG;
}
