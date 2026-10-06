import { songShelves } from './songs/index.js';
/* ============================================================
   SONG MENU — the <select>'s shelves (render/UI only, no engine reach).
   The built-in catalogue is grouped by the SONG_GROUPS table (songs/index.js) into
   <optgroup>s. Songs that arrive at runtime — a dropped/?midi import, a share link,
   a ?solo instrument demo — go on a 'Yours' shelf pinned to the TOP, so the thing the
   viewer just brought is the first thing in the list.
   ============================================================ */
const YOURS = 'Yours';

function shelf(sel, label, first = false){
  let g = [...sel.children].find(c => c.tagName === 'OPTGROUP' && c.label === label);
  if (!g){
    g = document.createElement('optgroup'); g.label = label;
    sel.insertBefore(g, first ? sel.firstChild : null);
  }
  return g;
}

/** Fill `sel` from `songs`. `dynamic` = keys that belong on the 'Yours' shelf. */
export function fillSongMenu(sel, songs, dynamic = () => false){
  sel.innerHTML = '';
  const builtIn = Object.fromEntries(Object.entries(songs).filter(([k]) => !dynamic(k)));
  for (const [label, keys] of songShelves(builtIn)){
    const g = shelf(sel, label);
    for (const k of keys) g.appendChild(new Option(songs[k].label, k));
  }
  for (const k of Object.keys(songs).filter(dynamic)) addSongOption(sel, k, songs[k].label);
}

/** Add (or relabel) a runtime song on the 'Yours' shelf at the top of the menu. */
export function addSongOption(sel, key, label){
  let o = [...sel.options].find(x => x.value === key);
  if (!o){ o = new Option(label, key); shelf(sel, YOURS, true).appendChild(o); }
  o.textContent = label;
  return o;
}
