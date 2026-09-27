// The tab: its people, what was spent and who it was for, and what everyone is up or down.
// No page code in here, so the tests run it in Node.
//
// A tab looks like this. Every person and every entry has an id, the time it was added, and the time
// it last changed, so two copies of the tab can be merged (see merge.js). Deleting leaves a marker behind.
//
//   { id, name, currency, created, changed,           the tab's own details and when they last changed
//     people: [{ id, name, weight, pay: { venmo, cashapp, paypal }, added, changed, deleted? }],
//     entries: [expense | payment | { id, kind, changed, deleted: true }],
//     local: { me, archived, merge, seen } }           this device only; never sent in a link
//
//   expense: { id, kind: 'expense', added, changed, what, amount, date, category, note,
//              paid: { personId: amount },               who paid, adding up to amount
//              split: { how, parts: { personId: n }, items, tax, tip } }
//   payment: { id, kind: 'payment', added, changed, from, to, amount, date, note }
//
// Amounts are whole minor units (see money.js). split.how is one of:
//   equal    parts: { id: 1 } for everyone in it
//   shares   parts: { id: hundredths of a share }  (a couple counting as 2 is 200)
//   exact    parts: { id: amount }
//   percent  parts: { id: hundredths of a percent } adding up to 10000
//   items    items: [{ id, name, amount, who: [ids] }], tax and tip: { pct } or { amount }

import { allocate, percentOf, MAX } from './money.js';

export const HOWS = ['equal', 'shares', 'exact', 'percent', 'items'];
export const CATEGORIES = [
  ['food', '🍽️', 'Food & drink'],
  ['groceries', '🛒', 'Groceries'],
  ['home', '🏠', 'Rent & stays'],
  ['travel', '🚕', 'Getting around'],
  ['fun', '🎟️', 'Fun'],
  ['bills', '💡', 'Bills'],
  ['shopping', '🛍️', 'Shopping'],
  ['other', '📎', 'Other'],
];
export const CATEGORY = Object.fromEntries(CATEGORIES.map(([k, icon, label]) => [k, { icon, label }]));

export function newId(n = 10) {
  const abc = 'abcdefghijkmnpqrstuvwxyz23456789';
  let s = '';
  const bytes = globalThis.crypto?.getRandomValues ? crypto.getRandomValues(new Uint8Array(n)) : Array.from({ length: n }, () => Math.floor(Math.random() * 256));
  for (const b of bytes) s += abc[b % abc.length];
  return s;
}

// A change time that always moves forward, even if this device's clock is behind the one that made the last change.
export const stamp = (prev = 0) => Math.max(Date.now(), prev + 1);

export const today = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function blankTab(name = '', currency = 'USD') {
  const now = Date.now();
  return { id: newId(), name, currency, created: now, changed: now, people: [], entries: [], local: {} };
}

export function addPerson(tab, name, weight = 100) {
  // Join times always go up, so everyone keeps their place in the list on every phone.
  const now = stamp(Math.max(0, ...tab.people.map(p => p.added || 0)));
  const p = { id: newId(6), name: String(name).trim().slice(0, 40), weight, pay: {}, added: now, changed: now };
  tab.people.push(p);
  return p;
}

export const live = tab => tab.entries.filter(e => !e.deleted);
export const expenses = tab => live(tab).filter(e => e.kind === 'expense');
export const payments = tab => live(tab).filter(e => e.kind === 'payment');

// Everyone whose name is on something that's still on the tab.
export function involved(e) {
  if (e.deleted) return [];
  if (e.kind === 'payment') return [e.from, e.to];
  const ids = new Set(Object.keys(e.paid || {}));
  if (e.split?.how === 'items') for (const it of e.split.items || []) it.who.forEach(id => ids.add(id));
  else Object.keys(e.split?.parts || {}).forEach(id => ids.add(id));
  return [...ids];
}

// The people on the tab, in the order they joined. Someone deleted on one phone while another phone
// added an expense for them stays, so no amount is ever left without a person.
export function people(tab) {
  const used = new Set(live(tab).flatMap(involved));
  return tab.people.filter(p => !p.deleted || used.has(p.id));
}
export const personName = (tab, id) => tab.people.find(p => p.id === id)?.name || 'Someone';
export const usedBy = (tab, id) => live(tab).filter(e => involved(e).includes(id));

// Split among these people, in a fixed order that comes from the expense itself: ids sorted, then turned
// round by an amount taken from the expense's id. The same expense always splits the same way on every
// phone, and the odd cent doesn't always land on the same person.
function turned(ids, seed) {
  const sorted = [...ids].sort();
  if (!sorted.length) return sorted;
  const k = hash(seed) % sorted.length;
  return [...sorted.slice(k), ...sorted.slice(0, k)];
}

export function tipOf(sub, t) {
  if (!t) return 0;
  if (Number.isInteger(t.amount)) return t.amount;
  if (Number.isInteger(t.pct)) return percentOf(sub, t.pct);
  return 0;
}

// A bill split by item: each item is shared equally by whoever had it, then tax and tip are spread
// in proportion to what each person's items came to.
export function itemBreakdown(split, seed = '') {
  const items = split.items || [];
  const sub = {};
  let subtotal = 0;
  for (const it of items) {
    subtotal += it.amount;
    if (!it.who.length) continue;
    const ids = turned(it.who, seed + it.id);
    allocate(it.amount, ids.map(() => 1)).forEach((v, i) => { sub[ids[i]] = (sub[ids[i]] || 0) + v; });
  }
  const tax = tipOf(subtotal, split.tax), tip = tipOf(subtotal, split.tip);
  const extra = tax + tip;
  const ids = turned(Object.keys(sub), seed + 'extra');
  const weights = ids.map(id => sub[id]);
  const add = {};
  if (extra && weights.some(w => w > 0)) allocate(extra, weights).forEach((v, i) => { add[ids[i]] = v; });
  const each = {};
  for (const id of ids) each[id] = { items: sub[id], extra: add[id] || 0, total: sub[id] + (add[id] || 0) };
  return { subtotal, tax, tip, total: subtotal + tax + tip, each };
}

// What each person's share of an expense comes to. Always adds up to the amount exactly,
// or throws if the expense doesn't make sense (checkExpense says why in words).
export function sharesOf(e) {
  const s = e.split;
  const out = {};
  if (s.how === 'items') {
    const b = itemBreakdown(s, e.id);
    for (const [id, v] of Object.entries(b.each)) out[id] = v.total;
  } else if (s.how === 'exact') {
    for (const [id, v] of Object.entries(s.parts)) if (v) out[id] = v;
  } else {
    const ids = turned(Object.keys(s.parts).filter(id => s.parts[id] > 0), e.id);
    if (!ids.length) throw new Error('nobody to split it between');
    const weights = ids.map(id => (s.how === 'equal' ? 1 : s.parts[id]));
    allocate(e.amount, weights).forEach((v, i) => { out[ids[i]] = v; });
  }
  const sum = Object.values(out).reduce((a, b) => a + b, 0);
  if (sum !== e.amount) throw new Error(`shares add up to ${sum}, not ${e.amount}`);
  return out;
}

const whole = (v, lo = 0, hi = MAX) => Number.isInteger(v) && v >= lo && v <= hi;
const sumOf = o => Object.values(o || {}).reduce((a, b) => a + b, 0);

// Why an expense can't be saved yet, in words, or '' if it's fine.
export function checkExpense(e, ids) {
  const known = new Set(ids);
  if (!whole(e.amount, 1)) return e.split?.how === 'items' ? 'Add the prices of the items.' : 'Add the amount.';
  const paid = Object.entries(e.paid || {}).filter(([, v]) => v);
  if (!paid.length) return 'Say who paid.';
  if (paid.some(([id, v]) => !known.has(id) || !whole(v, 1))) return 'Check who paid.';
  const p = sumOf(e.paid);
  if (p !== e.amount) return `What people paid comes to ${p < e.amount ? 'less' : 'more'} than the total.`;
  const s = e.split;
  if (!s || !HOWS.includes(s.how)) return 'Say how to split it.';
  if (s.how === 'items') {
    if (!s.items?.length) return 'Add what was on the bill.';
    for (const it of s.items) {
      if (!whole(it.amount, 0)) return 'Check the prices.';
      if (it.amount > 0 && !it.who.length) return `Say who had ${it.name ? `the ${it.name}` : 'each item'}.`;
      if (it.who.some(id => !known.has(id))) return 'Check who had what.';
    }
    for (const t of [s.tax, s.tip]) if (t && !(whole(t.amount, 0) || whole(t.pct, 0, 100000))) return 'Check the tax and tip.';
    const b = itemBreakdown(s, e.id);
    if (b.subtotal <= 0) return 'Add the prices of the items.';
    if (b.total !== e.amount) return 'The items don’t add up to the total.';
    return '';
  }
  const parts = Object.entries(s.parts || {}).filter(([, v]) => v);
  if (!parts.length) return 'Choose who it’s for.';
  if (parts.some(([id, v]) => !known.has(id) || !whole(v, 1))) return 'Check who it’s for.';
  if (s.how === 'exact') {
    const t = sumOf(s.parts);
    if (t !== e.amount) return t < e.amount ? 'The amounts come to less than the total.' : 'The amounts come to more than the total.';
  }
  if (s.how === 'percent' && sumOf(s.parts) !== 10000) return 'The percentages need to add up to 100.';
  return '';
}

export function checkPayment(e, ids) {
  const known = new Set(ids);
  if (!known.has(e.from) || !known.has(e.to)) return 'Say who paid whom.';
  if (e.from === e.to) return 'Pick two different people.';
  if (!whole(e.amount, 1)) return 'Add the amount.';
  return '';
}

// What everyone paid, what their shares came to, the payments between them, and where that leaves them.
// net is positive for someone who is owed money and negative for someone who owes. Nets always add up to zero.
export function ledger(tab) {
  const rows = {};
  for (const p of people(tab)) rows[p.id] = { paid: 0, share: 0, sent: 0, got: 0, net: 0 };
  const row = id => (rows[id] ||= { paid: 0, share: 0, sent: 0, got: 0, net: 0 });
  let spent = 0;
  for (const e of live(tab)) {
    if (e.kind === 'expense') {
      spent += e.amount;
      for (const [id, v] of Object.entries(e.paid)) row(id).paid += v;
      for (const [id, v] of Object.entries(sharesOf(e))) row(id).share += v;
    } else if (e.kind === 'payment') {
      row(e.from).sent += e.amount;
      row(e.to).got += e.amount;
    }
  }
  for (const r of Object.values(rows)) r.net = r.paid - r.share + r.sent - r.got;
  return { rows, spent };
}

export const balances = tab => Object.fromEntries(Object.entries(ledger(tab).rows).map(([id, r]) => [id, r.net]));
export const isSquare = tab => Object.values(balances(tab)).every(v => v === 0);

// Newest first by date, then by when they were added.
export function sorted(entries) {
  return [...entries].sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.added - a.added);
}

// The first and last dates on the tab.
export function span(tab) {
  const ds = live(tab).map(e => e.date).filter(Boolean).sort();
  return ds.length ? [ds[0], ds[ds.length - 1]] : null;
}

// A tab with only what travels in a link or a backup: no local notes.
export function shareable(tab) {
  const copy = structuredClone(tab);
  delete copy.local;
  return copy;
}

// Mark something as changed: its change time moves on, and so does the tab's if it's the tab itself.
export function touch(rec) {
  rec.changed = stamp(rec.changed);
  return rec;
}

export function removeEntry(tab, id) {
  const i = tab.entries.findIndex(e => e.id === id);
  if (i < 0) return null;
  const old = tab.entries[i];
  tab.entries[i] = { id, kind: old.kind, changed: stamp(old.changed), deleted: true };
  return old;
}

export function putEntry(tab, e) {
  const i = tab.entries.findIndex(x => x.id === e.id);
  e.changed = stamp(i >= 0 ? tab.entries[i].changed : 0);
  if (i >= 0) tab.entries[i] = e; else tab.entries.push(e);
  return e;
}

// Puts an expense or payment into the one shape it's kept and sent in: no zero amounts, no empty tax,
// names trimmed. Two phones holding the same thing then hold exactly the same thing.
export function tidy(e) {
  const nonzero = o => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => v));
  const common = { id: e.id, kind: e.kind, added: e.added, changed: e.changed, amount: e.amount, date: e.date || '', note: String(e.note || '').trim().slice(0, 300) };
  if (e.kind === 'payment') return { ...common, from: e.from, to: e.to };
  const s = e.split;
  const extra = t => (t && (t.pct || t.amount) ? (Number.isInteger(t.pct) ? { pct: t.pct } : { amount: t.amount }) : undefined);
  const split = s.how === 'items'
    ? {
      how: 'items',
      items: s.items.map(it => ({ id: it.id, name: String(it.name || '').trim().slice(0, 60), amount: it.amount, who: [...new Set(it.who)] })),
      ...(extra(s.tax) ? { tax: extra(s.tax) } : {}),
      ...(extra(s.tip) ? { tip: extra(s.tip) } : {}),
    }
    : { how: s.how, parts: nonzero(s.parts) };
  return { ...common, what: String(e.what || '').trim().slice(0, 80), category: CATEGORY[e.category] ? e.category : 'other', paid: nonzero(e.paid), split };
}

// A short, stable number for the check's corner, taken from the tab's id.
export const serial = tab => String(hash(tab.id) % 1000000).padStart(6, '0');
