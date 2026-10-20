// Keeps tabs in this browser. Nothing leaves the device unless you send a link or save a backup.
//
// Square Up can be open in more than one window, and they all keep their tabs in the same place. So every
// save reads what's there first: the tab being saved is merged with its saved copy, the way a link is
// (merge.js), and every other tab is kept as it's saved, so one window never writes over what another saved
// in the meantime. Deleted tabs are remembered for a while, so a window that only opens a tab another one
// deleted doesn't bring it back. A change made to it there does, as a link sent back does.
import { merge } from './merge.js';
import { fromWire, toWire } from './share.js';

const KEY = 'square-up';
const REMEMBER = 100; // how many deleted tabs are remembered

const isObject = v => !!v && typeof v === 'object' && !Array.isArray(v);
// A tab the screens can draw. Anything else in storage (edited by hand, or damaged) stays there as it was,
// so nothing is lost on the next save, but it isn't listed, opened or put in a backup.
const usable = t => isObject(t) && typeof t.id === 'string' && Array.isArray(t.people) && Array.isArray(t.entries);

// What's saved, or null when there's nothing readable: nothing yet, blocked storage or bad data.
function read() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY));
    if (data && Array.isArray(data.tabs)) {
      // This device's own notes on a tab: put() always writes them, so a tab saved without them gets an empty set.
      for (const t of data.tabs) if (usable(t) && !isObject(t.local)) t.local = {};
      // Saves from before deleted tabs were remembered have none, and a deleted tab that's here again is back.
      const here = new Set(data.tabs.map(t => t?.id));
      data.deleted = (Array.isArray(data.deleted) ? data.deleted : [])
        .filter(d => isObject(d) && typeof d.id === 'string' && Number.isFinite(d.at) && !here.has(d.id));
      return data;
    }
  } catch { /* private window, blocked storage or bad data */ }
  return null;
}

let state = read() || { tabs: [], name: '', deleted: [] };

// Changes made in this window that couldn't be saved yet (storage full or blocked). Every save puts them
// back on top of what's saved, so they stay here, and go in a backup, until a save works.
const unsaved = { tabs: new Map(), gone: new Map(), name: undefined };

// Whether this copy of a tab has changed since a moment: its name or currency, anyone on it or anything on it.
const changedSince = (t, at) => [t, ...t.people, ...t.entries].some(x => (x?.changed || 0) > at);

// Puts this window's copy of a tab in with what's saved, merged with the saved copy, and returns it as it
// will be saved. If another window deleted it, it stays deleted (and this returns null) unless this copy has
// changed since then or `back` says to bring it back.
function place(next, t, back) {
  const d = next.deleted.findIndex(x => x.id === t.id);
  if (d >= 0) {
    if (!back && !changedSince(t, next.deleted[d].at)) return null;
    next.deleted.splice(d, 1);
  }
  const i = next.tabs.findIndex(x => x?.id === t.id);
  const tab = usable(next.tabs[i]) ? merge(t, next.tabs[i]).tab : structuredClone(t);
  if (i >= 0) next.tabs[i] = tab; else next.tabs.push(tab);
  return tab;
}

function forget(next, id, at) {
  next.tabs = next.tabs.filter(t => t?.id !== id);
  next.deleted = [...next.deleted.filter(d => d.id !== id), { id, at }].slice(-REMEMBER);
}

function replay(next) {
  for (const [id, at] of unsaved.gone) forget(next, id, at);
  for (const [id, back] of unsaved.tabs) {
    const t = state.tabs.find(x => usable(x) && x.id === id);
    if (t) place(next, t, back);
  }
  if (unsaved.name !== undefined) next.name = unsaved.name;
}

// Saves one change: reads what's saved, puts back anything from here that isn't saved yet, makes the change
// and writes the lot. When nothing readable is saved, this window's own copy is all there is to work from.
// Says whether it could be written.
function commit(change) {
  const saved = read();
  const next = saved || { ...state, tabs: [...state.tabs], deleted: [...state.deleted] };
  if (saved) replay(next);
  change(next);
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    return false; // can't save here; it still works for this visit
  }
  unsaved.tabs.clear();
  unsaved.gone.clear();
  unsaved.name = undefined;
  return true;
}

// Another window saved: take what it saved, keeping anything from here that isn't saved yet.
globalThis.addEventListener?.('storage', e => {
  if (e.key !== KEY && e.key !== null) return;
  const saved = read();
  if (!saved) return;
  replay(saved);
  state = saved;
});

export const store = {
  all: () => state.tabs.filter(usable).sort((a, b) => (b.local?.opened || b.created) - (a.local?.opened || a.created)),
  get: id => state.tabs.find(t => usable(t) && t.id === id),
  // Saves a tab and returns it as saved, with anything another window saved to it meanwhile, or null when
  // another window deleted it and this copy only had it open. `back` brings a deleted tab back regardless:
  // for a link, a backup or an undo.
  put(t, { back = false } = {}) {
    t.local ||= {};
    let tab = null;
    if (!commit(next => { tab = place(next, t, back); }) && tab) unsaved.tabs.set(t.id, back || unsaved.tabs.get(t.id) || false);
    return tab;
  },
  remove(id) {
    const at = Date.now();
    if (!commit(next => forget(next, id, at))) {
      unsaved.tabs.delete(id);
      unsaved.gone.set(id, at);
    }
  },
  get name() { return state.name || ''; },
  set name(v) {
    const name = String(v || '').slice(0, 40);
    if (!commit(next => { next.name = name; })) unsaved.name = name;
  },
  backup: () => JSON.stringify({ app: 'square-up', version: 1, saved: new Date().toISOString(), name: state.name, tabs: state.tabs.filter(usable).map(t => ({ ...toWire(t), local: t.local })) }),
  // Adds the tabs from a backup. A tab that's already here is merged with the backup's copy, so nothing is lost
  // either way, and keeps this device's own notes on it. One deleted here comes back, as it would from a link.
  restore(text) {
    let data;
    try { data = JSON.parse(text); } catch { data = null; }
    if (data?.app !== 'square-up' || !Array.isArray(data.tabs)) throw new Error('That file isn’t a Square Up backup.');
    const tabs = [];
    for (const w of data.tabs) {
      let t;
      try { t = fromWire(w).tab; } catch { continue; }
      t.local = { me: typeof w.local?.me === 'string' ? w.local.me : undefined, archived: !!w.local?.archived };
      tabs.push(t);
    }
    const name = typeof data.name === 'string' ? data.name.slice(0, 40) : '';
    let named = false;
    const ok = commit(next => {
      for (const t of tabs) {
        next.deleted = next.deleted.filter(d => d.id !== t.id);
        const i = next.tabs.findIndex(x => x?.id === t.id);
        if (usable(next.tabs[i])) next.tabs[i] = merge(next.tabs[i], t).tab;
        else if (i >= 0) next.tabs[i] = t;
        else next.tabs.push(t);
      }
      if (!next.name && name) { next.name = name; named = true; }
    });
    if (!ok) {
      for (const t of tabs) unsaved.tabs.set(t.id, true);
      if (named) unsaved.name = name;
    }
    return tabs.length;
  },
};
