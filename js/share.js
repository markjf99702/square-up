// Links that carry a whole tab from one person to another, and back.
// Everything travels in the part of the link after #, which browsers never send to a server.
//
//   #/s/<data>   a tab. Opening it adds the tab here, or brings its changes into the copy already here.
//
// <data> is "z" and the tab squeezed with deflate, or "j" and plain JSON for browsers that can't squeeze,
// either way in URL-safe base64. Links are read carefully: anything that doesn't add up is left out.

import { CURRENCIES, MAX } from './money.js';
import { checkExpense, checkPayment, HOWS, CATEGORY } from './model.js';

export const SITE = 'https://junkdrawer.works/square-up/';

// Where links should point: this page when it's the real site or a local copy, the real site otherwise
// (for example the single-file copy, which lives somewhere a link can't reach).
export function base(loc = globalThis.location) {
  if (!loc || !/^https?:$/.test(loc.protocol)) return SITE;
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(loc.hostname);
  if (local || loc.hostname.endsWith('junkdrawer.works')) return loc.origin + loc.pathname;
  return SITE;
}

const b64 = bytes => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64 = text => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), ch => ch.charCodeAt(0));

async function through(bytes, stream, limit = Infinity) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream)).body.getReader();
  const parts = [];
  let size = 0;
  for (;;) {
    const { done, value } = await out.read();
    if (done) break;
    size += value.length;
    if (size > limit) { out.cancel(); throw new Error('too big'); }
    parts.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const p of parts) { all.set(p, at); at += p.length; }
  return all;
}

export async function pack(obj, { squeeze = true } = {}) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  if (squeeze && typeof CompressionStream === 'function') {
    try {
      const z = await through(bytes, new CompressionStream('deflate-raw'));
      if (z.length < bytes.length) return 'z' + b64(z);
    } catch { /* fall back to plain */ }
  }
  return 'j' + b64(bytes);
}

export async function unpack(text) {
  const kind = text[0];
  let bytes = unb64(text.slice(1));
  if (kind === 'z') {
    if (typeof DecompressionStream !== 'function') throw new Error('This browser can’t open squeezed links. Try a newer one.');
    bytes = await through(bytes, new DecompressionStream('deflate-raw'), 4e6);
  } else if (kind !== 'j') throw new Error('not a tab');
  return JSON.parse(new TextDecoder().decode(bytes));
}

// ---------- The tab, written short for the link ----------

const tax = t => (!t ? 0 : Number.isInteger(t.pct) ? { p: t.pct } : { a: t.amount });

export function toWire(tab, from = '') {
  return {
    v: 1, i: tab.id, n: tab.name, c: tab.currency, a: tab.created, u: tab.changed, f: from || '',
    // Someone deleted keeps their name, in case the other phone has just put them on something new.
    p: tab.people.map(p => ({ i: p.id, n: p.name, w: p.weight, a: p.added, u: p.changed,
      ...(Object.values(p.pay || {}).some(Boolean) && !p.deleted ? { $: p.pay } : {}), ...(p.deleted ? { x: 1 } : {}) })),
    e: tab.entries.map(e => {
      if (e.deleted) return { i: e.id, k: e.kind === 'payment' ? 'p' : 'e', u: e.changed, x: 1 };
      const common = { i: e.id, a: e.added, u: e.changed, m: e.amount, d: e.date, ...(e.note ? { o: e.note } : {}) };
      if (e.kind === 'payment') return { k: 'p', ...common, f: e.from, t: e.to };
      const s = e.split;
      return {
        k: 'e', ...common, w: e.what, c: e.category, b: e.paid, h: s.how,
        ...(s.how === 'items'
          ? { l: s.items.map(it => [it.id, it.name, it.amount, it.who]), ...(s.tax ? { tx: tax(s.tax) } : {}), ...(s.tip ? { tp: tax(s.tip) } : {}) }
          : { s: s.parts }),
      };
    }),
  };
}

const str = (s, max) => (typeof s === 'string' ? s.slice(0, max) : '');
const int = (v, lo = 0, hi = MAX) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);
const id = s => (typeof s === 'string' && /^[a-z0-9]{1,16}$/i.test(s) ? s : null);
const time = v => int(v, 0, 8.64e15) ?? 0;
const date = s => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '');

function amounts(o, known) {
  const out = {};
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  for (const [k, v] of Object.entries(o)) {
    if (!known.has(k) || int(v, 0) === null) return null;
    if (v) out[k] = v;
  }
  return out;
}

function readTax(t) {
  if (!t || typeof t !== 'object') return undefined;
  if (int(t.p, 0, 100000) !== null) return { pct: t.p };
  if (int(t.a, 0) !== null) return { amount: t.a };
  return undefined;
}

// Reads a tab out of a link, keeping only what makes sense. Returns { tab, from, dropped }.
export function fromWire(w) {
  if (!w || w.v !== 1 || !id(w.i) || !Array.isArray(w.p) || !Array.isArray(w.e)) throw new Error('not a tab');
  const currency = CURRENCIES[w.c] !== undefined ? w.c : 'USD';
  const people = [];
  const seen = new Set();
  for (const p of w.p.slice(0, 60)) {
    const pid = id(p?.i);
    if (!pid || seen.has(pid)) continue;
    seen.add(pid);
    const pay = {};
    if (!p.x) for (const k of ['venmo', 'cashapp', 'paypal']) if (typeof p.$?.[k] === 'string' && p.$[k]) pay[k] = str(p.$[k], 60);
    people.push({ id: pid, name: str(p.n, 40) || 'Someone', weight: int(p.w, 1, 100000) ?? 100, pay, added: time(p.a), changed: time(p.u), ...(p.x ? { deleted: true } : {}) });
  }
  const known = new Set(people.map(p => p.id));
  const ids = [...known];
  const entries = [];
  const eseen = new Set();
  let dropped = 0;
  for (const e of w.e.slice(0, 5000)) {
    const eid = id(e?.i);
    if (!eid || eseen.has(eid)) { dropped++; continue; }
    eseen.add(eid);
    const kind = e.k === 'p' ? 'payment' : 'expense';
    if (e.x) { entries.push({ id: eid, kind, changed: time(e.u), deleted: true }); continue; }
    const common = { id: eid, kind, added: time(e.a), changed: time(e.u), amount: int(e.m, 1), date: date(e.d), note: str(e.o, 300) };
    let out;
    if (kind === 'payment') {
      out = { ...common, from: id(e.f), to: id(e.t) };
      if (checkPayment(out, ids)) { dropped++; continue; }
    } else {
      const how = HOWS.includes(e.h) ? e.h : null;
      let split;
      if (how === 'items') {
        const items = Array.isArray(e.l) ? e.l.slice(0, 200).map(r => Array.isArray(r) && id(r[0]) && int(r[2], 0) !== null && Array.isArray(r[3])
          ? { id: r[0], name: str(r[1], 60), amount: r[2], who: [...new Set(r[3].filter(x => known.has(x)))] } : null) : [];
        if (items.some(x => !x)) { dropped++; continue; }
        split = { how, items, ...(readTax(e.tx) ? { tax: readTax(e.tx) } : {}), ...(readTax(e.tp) ? { tip: readTax(e.tp) } : {}) };
      } else split = { how, parts: amounts(e.s, known) || {} };
      out = { ...common, what: str(e.w, 80), category: CATEGORY[e.c] ? e.c : 'other', paid: amounts(e.b, known) || {}, split };
      if (!how || checkExpense(out, ids)) { dropped++; continue; }
    }
    entries.push(out);
  }
  const tab = {
    id: w.i, name: str(w.n, 80), currency, created: time(w.a) || Date.now(), changed: time(w.u),
    people, entries, local: {},
  };
  return { tab, from: id(w.f) || '', dropped };
}

export async function tabLink(tab, from) {
  return `${base()}#/s/${await pack(toWire(tab, from))}`;
}

export async function readLink(data) {
  return fromWire(await unpack(data));
}
