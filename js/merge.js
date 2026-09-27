// Bringing two copies of a tab together, say yours and the one in a link someone sent back.
// People and entries are matched by id, and for each one the copy that changed last wins.
// A deletion is a change too, so something deleted on one phone stays deleted, and something
// added on either phone is kept. Merging in either order gives the same tab.

// Which of two copies of the same record to keep: the later change, and when two changed at the
// same moment, the same one on every phone (compared by content).
export function newer(a, b) {
  if (!b) return true;
  if (!a) return false;
  if ((a.changed || 0) !== (b.changed || 0)) return (a.changed || 0) > (b.changed || 0);
  return canon(a) > canon(b);
}

// The same record always turns into the same text, whatever order its keys were added in.
export function canon(v) {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

const byId = list => new Map(list.map(x => [x.id, x]));
const same = (a, b) => canon(a) === canon(b);

// Merges `theirs` into `mine` and says what changed on this side. Neither argument is changed.
// Returns { tab, changes }, where changes lists what came in and what this copy had that theirs didn't:
//   added, changed, removed: entries (removed holds the entry as it was here)
//   people: { added, changed, removed }, renamed: [old, new] or null, currency: [old, new] or null
//   ours: how many things this copy has that the other one didn't, so it's worth sending back
export function merge(mine, theirs) {
  const tab = structuredClone(mine);
  const changes = { added: [], changed: [], removed: [], people: { added: [], changed: [], removed: [] }, renamed: null, currency: null, ours: 0 };

  // The tab's own name and currency.
  const infoMine = { changed: mine.changed, name: mine.name, currency: mine.currency };
  const infoTheirs = { changed: theirs.changed, name: theirs.name, currency: theirs.currency };
  if (!same(infoMine, infoTheirs)) {
    if (newer(infoTheirs, infoMine)) {
      if (theirs.name !== mine.name) changes.renamed = [mine.name, theirs.name];
      if (theirs.currency !== mine.currency) changes.currency = [mine.currency, theirs.currency];
      Object.assign(tab, infoTheirs);
    } else changes.ours++;
  }
  tab.created = Math.min(mine.created || Infinity, theirs.created || Infinity);
  if (!Number.isFinite(tab.created)) tab.created = Date.now();

  // People.
  const pm = byId(mine.people), pt = byId(theirs.people);
  const people = [];
  for (const id of new Set([...pm.keys(), ...pt.keys()])) {
    const a = pm.get(id), b = pt.get(id);
    if (a && b && same(a, b)) { people.push(structuredClone(a)); continue; }
    if (newer(b, a)) {
      people.push(structuredClone(b));
      if (!a) { if (!b.deleted) changes.people.added.push(b); }
      else if (b.deleted && !a.deleted) changes.people.removed.push(a);
      else if (!b.deleted) changes.people.changed.push(b);
    } else {
      people.push(structuredClone(a));
      if (!b ? !a.deleted : !a.deleted || !b.deleted) changes.ours++;
    }
  }
  tab.people = people.sort((x, y) => (x.added || 0) - (y.added || 0) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));

  // Expenses and payments.
  const em = byId(mine.entries), et = byId(theirs.entries);
  const entries = [];
  for (const id of new Set([...em.keys(), ...et.keys()])) {
    const a = em.get(id), b = et.get(id);
    if (a && b && same(a, b)) { entries.push(structuredClone(a)); continue; }
    if (newer(b, a)) {
      entries.push(structuredClone(b));
      if (!a || a.deleted) { if (!b.deleted) changes.added.push(b); }
      else if (b.deleted) changes.removed.push(a);
      else changes.changed.push({ before: a, after: b });
    } else {
      entries.push(structuredClone(a));
      if (!b ? !a.deleted : !(a.deleted && b.deleted)) changes.ours++;
    }
  }
  tab.entries = entries.sort((x, y) => (x.added || 0) - (y.added || 0) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  return { tab, changes };
}

export const nothingNew = c => !c.added.length && !c.changed.length && !c.removed.length
  && !c.people.added.length && !c.people.changed.length && !c.people.removed.length && !c.renamed && !c.currency;
