// Keeps tabs in this browser. Nothing leaves the device unless you send a link or save a backup.
import { merge } from './merge.js';
import { fromWire, toWire } from './share.js';

const KEY = 'square-up';

function read() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY));
    if (data && Array.isArray(data.tabs)) return data;
  } catch { /* private window, blocked storage or bad data: start empty */ }
  return { tabs: [], name: '' };
}

let state = read();

function write() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* can't save here; it still works for this visit */ }
}

export const store = {
  all: () => [...state.tabs].sort((a, b) => (b.local?.opened || b.created) - (a.local?.opened || a.created)),
  get: id => state.tabs.find(t => t.id === id),
  put(t) {
    t.local ||= {};
    const i = state.tabs.findIndex(x => x.id === t.id);
    if (i >= 0) state.tabs[i] = t; else state.tabs.push(t);
    write();
  },
  remove(id) {
    state.tabs = state.tabs.filter(t => t.id !== id);
    write();
  },
  get name() { return state.name || ''; },
  set name(v) { state.name = String(v || '').slice(0, 40); write(); },
  backup: () => JSON.stringify({ app: 'square-up', version: 1, saved: new Date().toISOString(), name: state.name, tabs: state.tabs.map(t => ({ ...toWire(t), local: t.local })) }),
  // Adds the tabs from a backup. A tab that's already here is merged with the backup's copy, so nothing is lost either way.
  restore(text) {
    let data;
    try { data = JSON.parse(text); } catch { data = null; }
    if (data?.app !== 'square-up' || !Array.isArray(data.tabs)) throw new Error('That file isn’t a Square Up backup.');
    let n = 0;
    for (const w of data.tabs) {
      let t;
      try { t = fromWire(w).tab; } catch { continue; }
      const mine = state.tabs.find(x => x.id === t.id);
      if (mine) {
        const { tab } = merge(mine, t);
        this.put(tab);
      } else {
        t.local = { me: typeof w.local?.me === 'string' ? w.local.me : undefined, archived: !!w.local?.archived };
        this.put(t);
      }
      n++;
    }
    if (!state.name && typeof data.name === 'string') state.name = data.name.slice(0, 40);
    write();
    return n;
  },
};
