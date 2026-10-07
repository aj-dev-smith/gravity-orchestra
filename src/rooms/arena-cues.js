/* ============================================================
   ARENA CUES — the Metal Arena's pyro / CO2 / blinder cue sheet,
   SOLVED AT SONG LOAD from the song's drum lanes (pure: no THREE, no DOM).

   A real arena show is cued by a programmer who knows the song: flame on the
   crash, a CO2 blast where the band comes back in, a pop on every big downbeat.
   Cascade knows the song too — it's data — so the cue sheet is solved up front
   and the room plays it back as a pure fn of songTime (scrub-safe, no state):

     • BIG  (crash hits)          → every free flame jet + the blinders
     • SECTION (loop head; a bar where the drums come back in after a silent
       bar; a bar whose onset count jumps ≥ 1.6× and ≥ 6)  → the CO2 cannons +
       the blinders (+ every free jet when no crash already took them)
     • POP  (a kick on a bar downbeat, or kick + snare in unison — a stab)
                                  → ONE pair of jets, round-robin across the rig
   No drums at all: the loop head is the section, and the melody's longest
   holds (≥ 2 beats) pop.

   THE POOL IS CONSTANT. Each emitter is one physical device; it cannot fire
   again until its burn is over (JET_BURN / CO2_BURN seconds), checked ACROSS the
   loop seam too (period P). Big cues claim jets first; a pop that finds no free
   pair is dropped — never a second flame stacked on a burning one.

   solveArenaCues({drums, melody, loopBeats, beat, P, bar}) →
     { jets:  [[fireLoopSec, vel, big], …] per jet   (JETS arrays),
       co2:   [[fireLoopSec, vel], …]     per cannon (CANNONS arrays),
       blind: [[fireLoopSec, vel], …],
       events: [{beat, kind, vel, jets:[…]}] }       (for tests / the audit)
   fire times are LOOP seconds (rollT + beat·beat), the same frame as every strike.
   ============================================================ */

export const JETS = 8;              // flame projectors: 4 mirrored L/R pairs (see arena.js JET_POS)
export const CANNONS = 4;           // CO2 cannons on the truss towers
export const JET_BURN = 1.15;       // s: one flame's whole life (rise · hold · lift-off) — busy until it ends
export const CO2_BURN = 1.6;        // s: one blast + its plume
const EPS = 1e-6;

const hitsOf = lane => (lane || []).map(h => Array.isArray(h) ? { b: +h[0], v: h[1] ?? 1 } : { b: +h, v: 1 })
  .filter(h => Number.isFinite(h.b) && Number.isFinite(h.v));

export function solveArenaCues({ drums = null, melody = null, loopBeats, beat, P, rollT = 0, bar = 4 }){
  const loopSec = b => rollT + b * beat;
  const inLoop = b => b >= -EPS && b < loopBeats - EPS;
  const raw = [];                                     // {beat, kind: 'big'|'section'|'pop', vel}
  const lanes = drums ? Object.fromEntries(Object.entries(drums).map(([k, v]) => [k, hitsOf(v)])) : {};
  const hasDrums = Object.values(lanes).some(l => l.length);

  raw.push({ beat: 0, kind: 'section', vel: 1 });     // the loop head: the marble lands, the room answers
  if (hasDrums){
    for (const h of lanes.crash || []) if (inLoop(h.b)) raw.push({ beat: h.b, kind: 'big', vel: h.v });
    // sections by bar: onsets of every lane (the hat counts toward density, not toward "playing")
    const nb = Math.ceil(loopBeats / bar - EPS);
    const ons = new Array(nb).fill(0), body = new Array(nb).fill(0);
    for (const [k, l] of Object.entries(lanes)) for (const h of l){
      if (!inLoop(h.b)) continue;
      const i = Math.floor(h.b / bar + EPS);
      ons[i]++; if (k !== 'hat' && k !== 'hatOpen' && k !== 'ride') body[i]++;
    }
    for (let i = 1; i < nb; i++){
      const back = i - 1;
      const enters = body[i] > 0 && body[back] === 0;
      const surges = ons[i] >= 6 && ons[i] >= 1.6 * Math.max(1, ons[back]);
      if (enters || surges) raw.push({ beat: i * bar, kind: 'section', vel: enters ? 1 : .85 });
    }
    // pops: a kick on a bar downbeat, or a kick + snare stab
    const snareAt = new Map((lanes.snare || []).map(h => [Math.round(h.b * 1e4), h.v]));
    for (const h of lanes.kick || []){
      if (!inLoop(h.b) || h.v < .5) continue;
      const down = Math.abs(h.b / bar - Math.round(h.b / bar)) < EPS;
      const stab = snareAt.has(Math.round(h.b * 1e4));
      if (down || stab) raw.push({ beat: h.b, kind: 'pop', vel: stab ? Math.max(h.v, snareAt.get(Math.round(h.b * 1e4))) : h.v });
    }
  } else if (melody && melody.length){
    let b = 0;
    const holds = [];
    for (const [, d] of melody){ if (d >= 2 && b > EPS) holds.push({ beat: b, d }); b += d; }
    holds.sort((x, y) => y.d - x.d || x.beat - y.beat);
    for (const h of holds.slice(0, 4)) raw.push({ beat: h.beat, kind: 'pop', vel: Math.min(1, .55 + .1 * h.d) });
  }

  // merge coincident cues (a crash ON a section start is one moment, the bigger reading wins)
  const RANK = { big: 2, section: 1, pop: 0 };
  raw.sort((a, b) => a.beat - b.beat || RANK[b.kind] - RANK[a.kind]);
  const merged = [];
  for (const e of raw){
    const m = merged.find(x => Math.abs(x.beat - e.beat) < .26);
    if (!m){ merged.push({ ...e, co2: e.kind === 'section' }); continue; }
    if (e.kind === 'section') m.co2 = true;
    if (RANK[e.kind] > RANK[m.kind]){ m.kind = e.kind; }
    m.vel = Math.max(m.vel, e.vel);
  }

  // ---- the pool: claim emitters, big first, then pops in time order ----
  const jets = Array.from({ length: JETS }, () => []), co2 = Array.from({ length: CANNONS }, () => []), blind = [];
  const free = (list, t, burn) => list.every(([u]) => { const d = Math.abs(t - u); return Math.min(d, P - d) >= burn - EPS; });
  const order = [...merged].sort((a, b) => (a.kind === 'pop') - (b.kind === 'pop') || a.beat - b.beat);
  const events = [];
  let rr = 0;
  for (const e of order){
    const t = loopSec(e.beat), used = [];
    if (e.kind === 'pop'){
      for (let k = 0; k < JETS / 2; k++){             // round-robin pairs: 0-1, 2-3, 4-5, 6-7
        const p = (rr + k) % (JETS / 2), a = 2 * p, b = a + 1;
        if (free(jets[a], t, JET_BURN) && free(jets[b], t, JET_BURN)){ used.push(a, b); rr = p + 1; break; }
      }
      if (!used.length) continue;                     // the rig is burning — drop it, never stack
    } else {
      for (let j = 0; j < JETS; j++) if (free(jets[j], t, JET_BURN)) used.push(j);
    }
    for (const j of used) jets[j].push([t, e.vel, e.kind !== 'pop']);
    let cans = [];
    if (e.co2) for (let c = 0; c < CANNONS; c++) if (free(co2[c], t, CO2_BURN)){ co2[c].push([t, e.vel]); cans.push(c); }
    if (e.kind !== 'pop' && free(blind, t, .5)) blind.push([t, e.vel]);
    events.push({ beat: e.beat, kind: e.kind, vel: e.vel, jets: used, co2: cans });
  }
  for (const l of [...jets, ...co2, blind]) l.sort((a, b) => a[0] - b[0]);
  events.sort((a, b) => a.beat - b.beat);
  return { jets, co2, blind, events };
}

/* the most recent firing of one emitter at songTime t: seconds since it fired (Infinity
   if never / before the count-in `start`), and its row. Loop-time wrap like every strike. */
export function lastFire(list, t, P, start = -Infinity){
  const lt = ((t % P) + P) % P;
  let best = Infinity, row = null;
  for (let i = 0; i < list.length; i++){
    const u = list[i][0];
    const age = ((lt - u) % P + P) % P;
    if (age < best && t - age >= start - EPS){ best = age; row = list[i]; }
  }
  return { age: best, row };
}
