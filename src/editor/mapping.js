/* ============================================================
   MAPPING — creation mode 1: WHO PLAYS WHAT, chosen by a human.

   The orchestra (src/midi/orchestra.js) makes the first guess; this
   module lets a person overrule it, per source track, and turns that
   choice back into a SONG — the same data every other song is. Then
   main rebuilds the room from it: everything is solved up front, so
   re-routing a voice IS a re-solve (rebuildWorld), nothing more.

   Two kinds of source:
     · a MIDI import — each track × program (a "voice", like the orchestra
       splits them) + the channel-10 percussion. A mapping re-runs
       convertToSong with a hand ROUTER (opts.router) in place of
       orchestrate(); everything downstream (timeline zero, loop, quantize,
       drum lanes, each machine's honest FIT — shapePart) is the importer's own.
     · an authored song — its belt tracks (melody / alto / bass), each
       plugin part and the drums. A mapping moves material between them:
       a chained belt track becomes absolute part events, a part becomes a
       chained harmony belt (THE LOCK RULE holds by construction).

   Targets (a string per source):
     'lead'          the belt LEAD (the melodic spine — exactly one)
     'lead+<key>'    the belt lead AND doubled on a machine (the lead's
                     notes, fitted to it)
     'belt'          a harmony belt (≤ 2; alto / bass by register)
     <plugin key>    an instrument plugin: fitted by orchestra.shapePart when
                     the orchestra has a spec for it, else by fitLine (the
                     line machines: turntable, ricochet — one marble, one line)
     'drums'         the marble drum machine (channel 10 only)
     'off'           silent

   Pure: no THREE, no DOM, no audio.
   ============================================================ */
import { orchestrate, shapePart, PART_SPEC, GM_NAMES, midiToName } from '../midi/orchestra.js';
import { convertToSong } from '../midi/convert.js';
import { noteNum } from '../engine.js';
import { normalizeHit } from '../drumkit.js';

export const LEAD = 'lead', BELT = 'belt', DRUMS = 'drums', OFF = 'off';
export const MAX_HARMONY = 2;                      // alto + bass belts
export const doubled = t => typeof t === 'string' && t.startsWith('lead+') ? t.slice(5) : null;
export const isLead = t => t === LEAD || !!doubled(t);
/** the plugin a target feeds (a doubled lead feeds one too), else null */
export const machineOf = t => doubled(t) || (t && ![LEAD, BELT, DRUMS, OFF].includes(t) ? t : null);

const NOTE_RE = /^[A-G]#?\d$/;
const q12 = b => Math.round(b * 12) / 12;
const tidy = b => Math.round(b * 12000) / 12000;
const median = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const sumBeats = notes => notes.reduce((s, [, b]) => s + b, 0);

/* ---- the LINE machines: one marble chaining a single line (no orchestra spec) ----
   lo/hi/center  the sweet range (MIDI): the whole line octave-shifts toward center, strays fold
   minGap        seconds between successive notes (a hop needs a little air; the ricochet
                 collapses closer events — DT_MIN .06 — so they're thinned here, reported)
   maxEvents     a pad / plate per note OCCURRENCE: past this the build gets heavy → keep the strongest */
export const LINE_SPEC = {
  turntable: { lo: 50, hi: 91, center: 70, minGap: .08, maxEvents: 192 },
  ricochet:  { lo: 57, hi: 93, center: 76, minGap: .08, maxEvents: 160 },
};
const LINE_DEFAULT = { lo: 48, hi: 91, center: 70, minGap: .08, maxEvents: 192 };

/** Fit a voice (or several) to a line machine. notes: [{ beat, midi, vel, dur?, voice? }]
    lead-aligned beats. Returns { part: [[beat, note, vel]], warnings } like shapePart. */
export function fitLine(key, notes, { bpm, loopBeats, spec = LINE_SPEC[key] || LINE_DEFAULT }){
  const warnings = [], say = m => warnings.push(`${key}: ${m}`);
  const spb = 60 / bpm;
  const inside = notes.filter(n => n.beat >= 0 && n.beat < loopBeats - 1e-9);
  if (inside.length < notes.length) say(`dropped ${plural(notes.length - inside.length, 'note')} outside the loop`);
  // ONE marble → one line: the top note of every onset
  const top = new Map();
  for (const n of inside){ const o = top.get(n.beat); if (!o || n.midi > o.midi) top.set(n.beat, { ...n, vel: Math.max(n.vel, o?.vel ?? 0) }); }
  let ns = [...top.values()].sort((a, b) => a.beat - b.beat);
  if (inside.length > ns.length) say(`kept the top note of ${plural(inside.length - ns.length, 'chord note')} (one marble plays one line)`);
  if (!ns.length) return { part: [], warnings };
  // register: the whole line moves by octaves toward the machine's centre, strays fold in
  const shift = 12 * Math.round((spec.center - median(ns.map(n => n.midi))) / 12);
  if (shift) say(`shifted ${plural(Math.abs(shift / 12), 'octave')} ${shift > 0 ? 'up' : 'down'} into its range`);
  let folded = 0;
  ns = ns.map(n => { let m = n.midi + shift; while (m < spec.lo){ m += 12; folded++; } while (m > spec.hi){ m -= 12; folded++; } return { ...n, midi: m }; });
  if (folded) say(`folded ${plural(folded, 'note')} by octaves into ${midiToName(spec.lo)}–${midiToName(spec.hi)}`);
  // air between hops (the loop seam is a gap too)
  const out = [];
  for (const n of ns) if (!out.length || (n.beat - out[out.length - 1].beat) * spb >= spec.minGap - 1e-9) out.push(n);
  while (out.length > 1 && (out[0].beat + loopBeats - out[out.length - 1].beat) * spb < spec.minGap - 1e-9) out.pop();
  if (out.length < ns.length) say(`thinned ${plural(ns.length - out.length, 'note')} closer than ${spec.minGap}s (a hop needs air)`);
  let kept = out;
  if (out.length > spec.maxEvents){
    const keep = new Set([...out].sort((a, b) => b.vel - a.vel || (a.beat % 1) - (b.beat % 1) || a.beat - b.beat).slice(0, spec.maxEvents));
    kept = out.filter(n => keep.has(n));
    say(`kept the ${spec.maxEvents} strongest of ${out.length} notes (one pad per note — the build budget)`);
  }
  return { part: kept.map(n => [tidy(n.beat), midiToName(n.midi), Math.round(Math.max(.05, Math.min(1, n.vel)) * 100) / 100]), warnings };
}
/** fit material to ANY plugin: the orchestra's own fit when it has a spec, else a line */
export function fitMachine(key, notes, { bpm, loopBeats }){
  return PART_SPEC[key] ? shapePart(key, notes, { bpm, loopBeats }) : fitLine(key, notes, { bpm, loopBeats });
}

/* =================== MIDI sources =================== */

/** tag every note with its source id (track × program; channel 10 = 'drums') — the id
    survives convertToSong's copies, so a router can tell voices apart */
export function tagMidi(parsed, { dropDrums = false } = {}){
  return { ...parsed, tracks: parsed.tracks.map((tr, ti) => ({ ...tr,
    notes: tr.notes.filter(n => !(dropDrums && n.channel === 9))
      .map(n => ({ ...n, _v: n.channel === 9 ? DRUMS : `t${ti}p${n.program ?? 0}` })) })).filter(tr => tr.notes.length) };
}

/** The import's source voices, in file order: [{ id, name, program, gm, channel, drums,
    count, events: [{ beat, midi, vel }] }] (events: absolute beats from the file's zero). */
export function midiSources(parsed){
  const ppq = parsed.ppq, byId = new Map();
  parsed.tracks.forEach((tr, ti) => {
    const progs = new Set(tr.notes.filter(n => n.channel !== 9).map(n => n.program ?? 0));
    for (const n of tr.notes){
      const drums = n.channel === 9, program = n.program ?? 0;
      const id = drums ? DRUMS : `t${ti}p${program}`;
      let v = byId.get(id);
      if (!v){
        const nm = (tr.name || '').trim();
        const base = nm && !/^ch\d+$/.test(nm) ? nm : drums ? 'Percussion' : GM_NAMES[program];
        v = { id, name: drums ? 'Drums' : progs.size > 1 ? `${base} (${GM_NAMES[program]})` : base,
              program: drums ? null : program, gm: drums ? 'GM percussion · ch 10' : GM_NAMES[program],
              channel: n.channel, drums, count: 0, events: [] };
        byId.set(id, v);
      }
      v.count++;
      v.events.push({ beat: n.tick / ppq, midi: n.midi, vel: n.vel / 127 });
    }
  });
  const list = [...byId.values()];
  const seen = new Map();
  for (const v of list) seen.set(v.name, (seen.get(v.name) || 0) + 1);
  for (const v of list) if (!v.drums && seen.get(v.name) > 1) v.name = `${v.name} (ch${v.channel + 1})`;
  return list.sort((a, b) => a.drums - b.drums);       // the drums last, the rest in file order
}

/** The import's sources as the LOOP plays them (a phrase window: convert.js's `phrase`, its
    [startBeat, endBeat) in the file's beats): the same rows and ids as midiSources — so a mapping
    stays valid — but each row's count + sparkline are the notes INSIDE the window (on convert's
    1/12-beat grid), and a voice that never plays there is flagged `idle` ("not in the loop") and
    listed after the ones that do. */
export function midiSourcesIn(parsed, win){
  const all = midiSources(parsed);
  if (!win) return all;
  const lo = win.startBeat - 1e-9, hi = win.endBeat - 1e-9;
  const rows = all.map(s => {
    const events = s.events.filter(e => { const b = q12(e.beat); return b >= lo && b < hi; });
    return { ...s, events, count: events.length, idle: !events.length };
  });
  return [...rows.filter(s => !s.idle), ...rows.filter(s => s.idle)];   // who plays the loop first (file order kept)
}

/** What the importer did on its own, as a mapping: { id: target }. Reads the orchestra's
    routing (spied through opts.router: whatever the AUTO router does — programs or roles) — or, for a file the importer kept belts-only
    (no program changes), the legacy rule: the 3 busiest lines, by register. */
export function defaultMidiMapping(parsed, opts = {}){
  const sources = midiSources(parsed), map = {};
  for (const s of sources) map[s.id] = s.drums ? DRUMS : OFF;
  let cap = null;
  try { convertToSong(tagMidi(parsed), { ...opts, router: (t, o, auto) => (cap = auto(t, o)) }); }
  catch (e){ return map; }
  if (cap){
    cap.belt.forEach((b, i) => { const id = b.notes[0]?._v; if (id) map[id] = i ? BELT : LEAD; });
    for (const p of cap.parts){
      const id = p.notes[0]?._v;
      if (!id) continue;
      if (map[id] === LEAD) map[id] = `lead+${p.key}`;
      else if (map[id] === OFF) map[id] = p.key;
    }
    return map;
  }
  // legacy (belts only): busiest 3 monophonic lines, the highest leads
  const ppq = parsed.ppq;
  const lines = tagMidi(parsed).tracks.map(tr => {
    const mel = tr.notes.filter(n => n.channel !== 9);
    if (!mel.length) return null;
    const byOn = new Map();
    for (const n of mel){ const k = q12(n.tick / ppq); const o = byOn.get(k); if (!o || n.midi > o.midi) byOn.set(k, n); }
    const top = [...byOn.values()];
    return { id: mel[0]._v, onsets: top.length, mean: top.reduce((s, n) => s + n.midi, 0) / top.length };
  }).filter(Boolean);
  const kept = lines.length > 3 ? [...lines].sort((a, b) => b.onsets - a.onsets).slice(0, 3) : lines;
  [...kept].sort((a, b) => b.mean - a.mean).forEach((l, i) => { map[l.id] = i ? BELT : LEAD; });
  return map;
}

/** Re-import with a hand mapping. Returns { song, warnings }. Throws (with a message
    fit for the panel) when the mapping can't make a song — no lead, nothing melodic. */
export function applyMidiMapping(parsed, mapping, opts = {}){
  const sources = midiSources(parsed);
  const leadId = sources.find(s => isLead(mapping[s.id]))?.id;
  if (!leadId) throw new Error('the belt needs a LEAD — pick one voice to lead');
  const extra = [];
  const route = tracks => {
    const voices = new Map();
    for (const tr of tracks) for (const n of tr.notes){
      if (!voices.has(n._v)) voices.set(n._v, []);
      voices.get(n._v).push(n);
    }
    const name = id => sources.find(s => s.id === id)?.name ?? id;
    const belt = [], parts = [], warnings = [];
    if (voices.has(leadId)) belt.push({ name: name(leadId), notes: voices.get(leadId) });
    let vid = 0;
    for (const [id, notes] of voices){
      const t = mapping[id] ?? OFF;
      if (t === BELT){
        if (belt.length <= MAX_HARMONY) belt.push({ name: name(id), notes });
        else warnings.push(`"${name(id)}": the belt has room for ${MAX_HARMONY} harmony voices — left silent`);
      }
      const key = machineOf(t);
      if (key) parts.push({ key, name: name(id), notes, program: notes[0].program ?? 0, voice: vid++ });
    }
    return { belt, parts, warnings };
  };
  const tagged = tagMidi(parsed, { dropDrums: mapping[DRUMS] === OFF });
  const { song, warnings, phrase } = convertToSong(tagged, { ...opts, orchestra: true, router: route });
  // the LINE machines (no orchestra spec — convert carried their notes into the loop length
  // but can't fit them): fit here, on the lead's timeline exactly as convert aligned the rest
  const loopBeats = sumBeats(song.melody), ppq = parsed.ppq;
  const leadNotes = tagged.tracks.flatMap(tr => tr.notes.filter(n => n._v === leadId));
  const leadOffset = Math.min(...leadNotes.map(n => q12(n.tick / ppq)));
  const lineKeys = new Set(sources.map(s => machineOf(mapping[s.id])).filter(k => k && !PART_SPEC[k]));
  for (const key of lineKeys){
    const notes = tagged.tracks.flatMap(tr => tr.notes.filter(n => machineOf(mapping[n._v]) === key))
      .map(n => ({ beat: tidy(q12(n.tick / ppq) - leadOffset), midi: n.midi, vel: Math.max(.01, Math.min(1, n.vel / 127)) }));
    const r = fitMachine(key, notes, { bpm: song.bpm, loopBeats });
    extra.push(...r.warnings);
    if (!r.part.length){ extra.push(`${key}: no playable notes left — part dropped`); continue; }
    const had = song.parts && Object.keys(song.parts).length;
    song.parts = { ...(song.parts || {}), [key]: r.part };
    song.sub += had ? `, ${key}` : ` + ${key}`;
  }
  return { song, warnings: [...warnings, ...extra], phrase };
}

/* =================== authored songs =================== */

const chainEvents = (notes, delay = 0) => { let b = delay; return notes.map(([n, d]) => { const e = { beat: b, midi: noteNum(n), vel: .8, dur: d }; b += d; return e; }); };
const asChain = d => Array.isArray(d) ? { notes: d, delay: 0 } : d;

/** An authored song's sources: [{ id, name, role, count, events, drums? }].
    ids: 'melody' | 'alto' | 'bass' | 'part:<key>' | 'drums'. */
export function songSources(song, labels = {}){
  const out = [];
  out.push({ id: 'melody', name: 'Melody', gm: 'belt · the lead', events: chainEvents(song.melody), lead: true });
  for (const role of ['alto', 'bass']) if (song[role]){
    const d = asChain(song[role]);
    out.push({ id: role, name: role === 'alto' ? 'Alto' : 'Bass line', gm: `belt · ${role}${d.delay ? ` (enters beat ${d.delay})` : ''}`, events: chainEvents(d.notes, d.delay || 0) });
  }
  for (const [key, part] of Object.entries(song.parts || {})){
    if (!Array.isArray(part) || !part.length) continue;
    const events = part.filter(e => Array.isArray(e) && NOTE_RE.test(e[1]))
      .map(e => ({ beat: e[0], midi: noteNum(e[1]), vel: e[2] ?? 1, dur: e[3] ?? null }));
    out.push({ id: `part:${key}`, name: labels[key] || key, gm: `part · ${key}`, events, home: key });
  }
  if (song.drums && Object.keys(song.drums).length){
    const lanes = Object.keys(song.drums), events = [];
    lanes.forEach((lane, i) => (song.drums[lane] || []).forEach(h => { const { beat, vel } = normalizeHit(h); events.push({ beat, midi: i, vel }); }));
    out.push({ id: DRUMS, name: 'Drums', gm: lanes.join(' · '), events, drums: true });
  }
  for (const s of out) s.count = s.events.length;
  return out;
}
export function defaultSongMapping(song){
  const map = {};
  for (const s of songSources(song)) map[s.id] = s.id === 'melody' ? LEAD : s.drums ? DRUMS : s.home || BELT;
  return map;
}

/** Re-arrange an authored song. Returns { song, warnings } — a NEW song (the input is untouched). */
export function applySongMapping(song, mapping){
  const warnings = [];
  const srcs = songSources(song), get = id => mapping[id] ?? defaultSongMapping(song)[id];
  const loopBeats = sumBeats(song.melody);
  const out = { ...song };
  delete out.alto; delete out.bass; delete out.parts;
  if (!isLead(get('melody'))) warnings.push('the melody always leads the belt (the engine needs its spine)');

  // HARMONY belts
  const harm = srcs.filter(s => s.id !== 'melody' && get(s.id) === BELT);
  if (harm.length > MAX_HARMONY) warnings.push(`the belt has room for ${MAX_HARMONY} harmony voices — "${harm.slice(MAX_HARMONY).map(s => s.name).join('", "')}" left silent`);
  const belts = harm.slice(0, MAX_HARMONY).map(s => {
    const mean = s.events.reduce((a, e) => a + e.midi, 0) / Math.max(1, s.events.length);
    if (s.id === 'alto' || s.id === 'bass') return { role: s.id, mean, data: song[s.id] };
    return { role: null, mean, data: monoChain(s.events, loopBeats, s.name, warnings) };
  }).filter(b => b.data);
  if (belts.length === 2 && !(belts[0].role && belts[1].role && belts[0].role !== belts[1].role)){
    belts.sort((a, b) => b.mean - a.mean); belts[0].role = 'alto'; belts[1].role = 'bass';
  } else if (belts.length === 1 && !belts[0].role) belts[0].role = belts[0].mean < 57 ? 'bass' : 'alto';
  for (const b of belts) out[b.role] = b.data;

  // MACHINES: everything routed to one plugin, fitted together (an untouched part keeps its authoring)
  const byKey = new Map();
  for (const s of srcs){ const key = machineOf(get(s.id)); if (key && !s.drums){ if (!byKey.has(key)) byKey.set(key, []); byKey.get(key).push(s); } }
  const parts = {};
  for (const [key, list] of byKey){
    if (list.length === 1 && list[0].home === key){ parts[key] = song.parts[key]; continue; }
    const notes = list.flatMap((s, vi) => s.events.map(e => ({ ...e, voice: vi, src: s.name })));
    const r = fitMachine(key, notes, { bpm: song.bpm, loopBeats });
    warnings.push(...r.warnings);
    if (r.part.length) parts[key] = r.part;
  }
  if (Object.keys(parts).length) out.parts = parts;
  if (get(DRUMS) === OFF) delete out.drums;
  return { song: out, warnings };
}
/** absolute events → a chained harmony belt { delay, notes } (top note per onset; the last
    note fills to the loop: delay + Σbeats = loopBeats — THE LOCK RULE, by construction) */
export function monoChain(events, loopBeats, name = 'voice', warnings = []){
  const top = new Map();
  for (const e of events){ if (!(e.beat >= 0 && e.beat < loopBeats)) continue; const b = tidy(e.beat); const o = top.get(b); if (!o || e.midi > o.midi) top.set(b, e); }
  const ons = [...top.entries()].sort((a, b) => a[0] - b[0]);
  if (!ons.length) return null;
  if (events.length > ons.length) warnings.push(`"${name}" on the belt: kept the top note of each chord (one marble, one line)`);
  // a belt voice sits where a phone can hear it (the importer's bass rule): mean into C3..C6
  const mean = ons.reduce((s, [, e]) => s + e.midi, 0) / ons.length;
  const shift = mean < 48 ? 12 * Math.ceil((48 - mean) / 12) : mean > 84 ? -12 * Math.ceil((mean - 84) / 12) : 0;
  const notes = ons.map(([b, e], i) => [midiToName(Math.max(12, Math.min(119, e.midi + shift))), i + 1 < ons.length ? tidy(ons[i + 1][0] - b) : 0]);
  // the LAST note closes the loop exactly: whatever the (rounded) others leave, summed in the
  // order the lock check sums them — so delay + Σbeats === loopBeats to the last bit, not to ~1e-13
  const delay = ons[0][0];
  const prev = notes.slice(0, -1).reduce((a, [, d]) => a + d, 0);
  notes[notes.length - 1][1] = loopBeats - delay - prev;
  if (prev + notes[notes.length - 1][1] + delay !== loopBeats) notes[notes.length - 1][1] = (loopBeats - prev) - delay;
  return { delay, notes };
}

/* =================== the target menu =================== */

/** The menu for one source: [{ group, options: [{ value, label }] }]. machines: [{ key, label }]
    (the instrument registry, in display order). */
export function targetsFor(source, machines, { authored = false } = {}){
  if (source.drums) return [{ group: '', options: [{ value: DRUMS, label: 'Drum machine' }, { value: OFF, label: 'off' }] }];
  const mach = machines.map(m => ({ value: m.key, label: m.label }));
  const lead = [{ value: LEAD, label: 'Belt · lead' }, ...machines.map(m => ({ value: `lead+${m.key}`, label: `Belt lead + ${m.label}` }))];
  if (authored && source.lead) return [{ group: 'the melody leads the belt', options: lead }];
  return [
    { group: 'Belt', options: [...(authored ? [] : [{ value: LEAD, label: 'Belt · lead' }]), { value: BELT, label: 'Belt · harmony' }] },
    { group: 'Machines', options: mach },
    ...(authored ? [] : [{ group: 'Lead, doubled', options: lead.slice(1) }]),
    { group: '', options: [{ value: OFF, label: 'off' }] },
  ];
}

/** Change one source's target, keeping the mapping legal: one lead (a new lead demotes the
    old one to a harmony belt — or off, if the belt is full), ≤ MAX_HARMONY harmony belts.
    Returns { mapping, note } — note says what else moved (or why nothing did). */
export function setTarget(mapping, id, target, sources){
  const m = { ...mapping }, prev = m[id], name = k => sources.find(s => s.id === k)?.name ?? k;
  let note = '';
  if (isLead(prev) && !isLead(target)){
    // the lead steps off the belt: its busiest harmony belt takes over (else it can't leave)
    const heir = sources.filter(s => s.id !== id && m[s.id] === BELT).sort((a, b) => (b.count ?? 0) - (a.count ?? 0))[0];
    if (!heir) return { mapping, note: 'the belt needs a lead — make another voice the lead first' };
    m[heir.id] = LEAD;
    note = `"${name(heir.id)}" now leads the belt`;
  }
  m[id] = target;
  if (isLead(target)){
    for (const k of Object.keys(m)) if (k !== id && isLead(m[k])){
      const harmony = Object.keys(m).filter(j => j !== k && m[j] === BELT).length;
      m[k] = harmony < MAX_HARMONY ? BELT : OFF;
      note = `"${name(k)}" moved to ${m[k] === BELT ? 'a harmony belt' : 'off'}`;
    }
  }
  if (target === BELT && Object.keys(m).filter(k => m[k] === BELT).length > MAX_HARMONY)
    return { mapping, note: `the belt has room for ${MAX_HARMONY} harmony voices — free one first` };
  return { mapping: m, note };
}

export const sameMapping = (a, b) => {
  const ks = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  for (const k of ks) if ((a || {})[k] !== (b || {})[k]) return false;
  return true;
};

/* =================== persistence =================== */
const TARGET_RE = /^(lead(\+[a-z][a-z0-9_-]*)?|belt|drums|off|[a-z][a-z0-9_-]*)$/i;
const ID_RE = /^(melody|alto|bass|drums|part:[a-z][a-z0-9_-]*|t\d+p\d+)$/i;
/** untrusted → a clean mapping (unknown ids / odd targets dropped) */
export function sanitizeMapping(obj){
  const out = {};
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
  for (const [k, v] of Object.entries(obj)) if (ID_RE.test(k) && typeof v === 'string' && TARGET_RE.test(v)) out[k] = v;
  return out;
}
export const mappingKey = songId => `cascade:map:${songId}`;
export function loadMapping(storage, songId){
  try { const m = sanitizeMapping(JSON.parse(storage?.getItem(mappingKey(songId)) || 'null')); return Object.keys(m).length ? m : null; }
  catch (e){ return null; }
}
/** saved only when it differs from the importer's own routing (`defaults`) — else cleared */
export function saveMapping(storage, songId, mapping, defaults){
  try {
    if (!mapping || sameMapping(mapping, defaults)) storage?.removeItem(mappingKey(songId));
    else storage?.setItem(mappingKey(songId), JSON.stringify(sanitizeMapping(mapping)));
    return true;
  } catch (e){ return false; }
}
