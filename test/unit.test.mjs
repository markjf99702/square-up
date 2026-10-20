// The arithmetic, the settling up, merging and the links, without a browser:  node --test test/unit.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import * as $ from '../js/money.js';
import * as M from '../js/model.js';
import { settle, greedy, fewest, payLinks, cleanHandle } from '../js/settle.js';
import { merge, canon, nothingNew } from '../js/merge.js';
import { pack, unpack, toWire, fromWire, tabLink, readLink } from '../js/share.js';
import { sampleTab } from '../js/sample.js';

function rng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const sum = o => Object.values(o).reduce((a, b) => a + b, 0);

test('reading amounts the way people type them', () => {
  const cases = [
    ['12', 1200], ['12.5', 1250], ['12.50', 1250], ['12,50', 1250], ['$1,234.56', 123456], ['1.234,56', 123456],
    ['1 234,56 €', 123456], ['1,234', 123400], ['0.99', 99], ['.5', 50], ['6.50+4', 1050], ['20 - 2.5', 1750],
    ['€ 7', 700], ['1,000,000', 100000000], ['', null], ['abc', null], ['12.345.6', null], ['1.2.3', null], ['12,34.5', null],
    ['12.345', 1234500], ['3.141', 314100], ['1.999', 199900], ['12.3456', null],
  ];
  for (const [text, want] of cases) assert.equal($.parse(text, 'USD'), want, text);
  // Letters or signs between two digits aren't stripped into some other number: "6.50 x 2" isn't $6,502.
  for (const text of ['6.50 x 2', '6.50×2', '6.50*2', '1e3', '1/2', '12a34']) assert.equal($.parse(text, 'USD'), null, text);
  // Currency before or after the number still works, and so does grouping with spaces or apostrophes.
  const around = [['12 USD', 1200], ['CHF 12.50', 1250], ['R$ 12,50', 1250], ['12 kr', 1200], ['1 234,56 €', 123456],
    ['1 234,56', 123456], ["1'234.50", 123450], ['1’234.50', 123450], ['USD12', 1200], ['12.50$', 1250], ['6,50 + 4', 1050], ['−2+5', 300]];
  for (const [text, want] of around) assert.equal($.parse(text, 'USD'), want, text);
  assert.equal($.parse('1200', 'JPY'), 1200);
  assert.equal($.parse('1,200', 'JPY'), 1200);
  assert.equal($.parse('12.5', 'JPY'), null, 'yen has no cents');
  assert.equal($.parse('99999999999999', 'USD'), null, 'too big');
});

test('writing amounts', () => {
  assert.equal($.plain(1234, 'USD'), '12.34');
  assert.equal($.plain(5, 'USD'), '0.05');
  assert.equal($.plain(1200, 'JPY'), '1200');
  assert.equal($.plain(-250, 'EUR'), '-2.50');
  assert.match($.format(123456, 'USD'), /1,234\.56/);
  assert.match($.format(1200, 'JPY'), /1,200/);
  assert.equal($.formatShort(4000, 'USD'), '$40');
  assert.equal($.formatShort(4010, 'USD'), '$40.10');
  for (const c of Object.keys($.CURRENCIES)) assert.ok($.format(12345, c).length > 2, c);
});

test('percent', () => {
  assert.equal($.percentOf(14750, 2000), 2950);
  assert.equal($.percentOf(1000, 875), 88, '87.5 rounds up');
  assert.equal($.percentOf(999, 1850), 185);
  assert.equal($.parsePercent('18.5'), 1850);
  assert.equal($.parsePercent('20%'), 2000);
  assert.equal($.parsePercent('7,75'), 775);
  assert.equal($.parsePercent('x'), null);
  assert.equal($.percentText(1850), '18.5');
  assert.equal($.percentText(2000), '20');
  assert.equal($.percentText(775), '7.75');
});

test('splitting a total always adds up, largest remainder first, earliest on a tie', () => {
  assert.deepEqual($.allocate(100, [1, 1, 1]), [34, 33, 33]);
  assert.deepEqual($.allocate(200, [1, 1, 1]), [67, 67, 66]);
  assert.deepEqual($.allocate(1000, [1, 2]), [333, 667]);
  assert.deepEqual($.allocate(7, [0, 1]), [0, 7]);
  assert.deepEqual($.allocate(-100, [1, 1, 1]), [-34, -33, -33]);
  assert.throws(() => $.allocate(100, [0, 0]));
  assert.throws(() => $.allocate(100, [1.5, 1]));
  const r = rng(1);
  for (let k = 0; k < 5000; k++) {
    const n = 1 + Math.floor(r() * 12);
    const w = Array.from({ length: n }, () => Math.floor(r() * (r() < 0.5 ? 5 : 100000)));
    if (!w.some(Boolean)) w[0] = 1;
    const total = Math.floor(r() * (r() < 0.2 ? 1e11 : 100000));
    const parts = $.allocate(total, w);
    assert.equal(parts.reduce((a, b) => a + b, 0), total);
    const W = w.reduce((a, b) => a + b, 0);
    parts.forEach((p, i) => {
      assert.ok(Number.isInteger(p));
      assert.ok(Math.abs(p - total * w[i] / W) < 1 + 1e-6 * total, 'within a cent of the exact share');
      if (w[i] === 0) assert.equal(p, 0);
    });
  }
});

// A random tab with every kind of split, for checking the sums against themselves.
function randomTab(seed, { people: np, entries: ne } = {}) {
  const r = rng(seed);
  const t = M.blankTab('Random', r() < 0.2 ? 'JPY' : 'USD');
  const n = np ?? 2 + Math.floor(r() * 7);
  for (let i = 0; i < n; i++) M.addPerson(t, `P${i}`, r() < 0.2 ? 200 : 100);
  const ids = t.people.map(p => p.id);
  const some = () => { const s = ids.filter(() => r() < 0.6); return s.length ? s : [ids[Math.floor(r() * n)]]; };
  const m = ne ?? 1 + Math.floor(r() * 25);
  for (let k = 0; k < m; k++) {
    const e = { id: M.newId(8), added: k, changed: k, date: M.today(), note: '' };
    if (r() < 0.15) {
      const [a, b] = [ids[Math.floor(r() * n)], ids[Math.floor(r() * n)]];
      if (a === b) continue;
      t.entries.push(M.tidy({ ...e, kind: 'payment', from: a, to: b, amount: 1 + Math.floor(r() * 50000) }));
      continue;
    }
    const how = M.HOWS[Math.floor(r() * M.HOWS.length)];
    let amount = 1 + Math.floor(r() * (r() < 0.1 ? 1e9 : 100000));
    const who = some();
    let split;
    if (how === 'equal') split = { how, parts: Object.fromEntries(who.map(id => [id, 1])) };
    if (how === 'shares') split = { how, parts: Object.fromEntries(who.map(id => [id, 1 + Math.floor(r() * 400)])) };
    if (how === 'exact') {
      const cut = $.allocate(amount, who.map(() => 1 + Math.floor(r() * 10)));
      split = { how, parts: Object.fromEntries(who.map((id, i) => [id, cut[i]])) };
      if (cut.some(v => v === 0)) continue;
    }
    if (how === 'percent') {
      const cut = $.allocate(10000, who.map(() => 1 + Math.floor(r() * 10)));
      split = { how, parts: Object.fromEntries(who.map((id, i) => [id, cut[i]])) };
      if (cut.some(v => v === 0)) continue;
    }
    if (how === 'items') {
      const items = Array.from({ length: 1 + Math.floor(r() * 8) }, () => ({ id: M.newId(6), name: 'Thing', amount: Math.floor(r() * 5000), who: some() }));
      const tax = r() < 0.5 ? { pct: Math.floor(r() * 1500) } : { amount: Math.floor(r() * 900) };
      const tip = r() < 0.5 ? { pct: [1500, 1800, 2000, 2200][Math.floor(r() * 4)] } : { amount: Math.floor(r() * 2000) };
      split = { how, items, tax, tip };
      amount = M.itemBreakdown(split, e.id).total;
      if (amount < 1 || items.every(it => !it.amount)) continue;
    }
    const payers = r() < 0.7 ? [ids[Math.floor(r() * n)]] : some();
    const cut = $.allocate(amount, payers.map(() => 1));
    const paid = Object.fromEntries(payers.map((id, i) => [id, cut[i]]));
    if (Object.values(paid).some(v => v === 0)) continue;
    t.entries.push(M.tidy({ ...e, kind: 'expense', what: 'Thing', category: 'other', amount, paid, split }));
  }
  return t;
}

test('every expense splits into shares that add up to it exactly', () => {
  let n = 0;
  for (let seed = 1; seed <= 400; seed++) {
    const t = randomTab(seed);
    const ids = t.people.map(p => p.id);
    for (const e of M.expenses(t)) {
      assert.equal(M.checkExpense(e, ids), '', `seed ${seed}: ${M.checkExpense(e, ids)}`);
      const s = M.sharesOf(e);
      assert.equal(sum(s), e.amount);
      assert.ok(Object.values(s).every(v => Number.isInteger(v) && v >= 0));
      assert.deepEqual(M.sharesOf(structuredClone(e)), s, 'the same every time');
      n++;
    }
  }
  assert.ok(n > 2000, `checked ${n} expenses`);
});

test('equal splits: the odd cent moves around rather than always landing on the same person', () => {
  const t = M.blankTab();
  const ids = ['a', 'b', 'c'].map(n => M.addPerson(t, n).id);
  const got = {};
  for (let k = 0; k < 60; k++) {
    const s = M.sharesOf({ id: `e${k}`, amount: 100, split: { how: 'equal', parts: Object.fromEntries(ids.map(id => [id, 1])) } });
    const who = Object.keys(s).find(id => s[id] === 34);
    got[who] = (got[who] || 0) + 1;
  }
  assert.equal(Object.keys(got).length, 3);
});

test('a bill by item: tax and tip follow what each person had', () => {
  const split = {
    how: 'items',
    items: [
      { id: 'i1', name: 'Steak', amount: 3000, who: ['a'] },
      { id: 'i2', name: 'Salad', amount: 1000, who: ['b'] },
      { id: 'i3', name: 'Wine', amount: 2000, who: ['a', 'b'] },
    ],
    tax: { amount: 480 },
    tip: { pct: 2000 },
  };
  const b = M.itemBreakdown(split, 'x');
  assert.equal(b.subtotal, 6000);
  assert.equal(b.tip, 1200);
  assert.equal(b.total, 7680);
  assert.equal(b.each.a.items, 4000);
  assert.equal(b.each.b.items, 2000);
  assert.equal(b.each.a.extra, 1120, 'two thirds of the tax and tip');
  assert.equal(b.each.b.extra, 560);
  assert.equal(b.each.a.total + b.each.b.total, 7680);

  // The sample dinner.
  const t = sampleTab();
  const dinner = M.expenses(t).find(e => e.split.how === 'items');
  assert.equal(M.checkExpense(dinner, t.people.map(p => p.id)), '');
  assert.equal(dinner.amount, 14750 + 1143 + 2950);
});

test('what stops an expense from being saved', () => {
  const ids = ['a', 'b'];
  const e = { id: 'e', kind: 'expense', amount: 1000, paid: { a: 1000 }, split: { how: 'equal', parts: { a: 1, b: 1 } } };
  assert.equal(M.checkExpense(e, ids), '');
  assert.match(M.checkExpense({ ...e, amount: 0 }, ids), /amount/);
  assert.match(M.checkExpense({ ...e, paid: {} }, ids), /who paid/);
  assert.match(M.checkExpense({ ...e, paid: { a: 600, b: 300 } }, ids), /less/);
  assert.match(M.checkExpense({ ...e, split: { how: 'equal', parts: {} } }, ids), /who it’s for/);
  assert.match(M.checkExpense({ ...e, split: { how: 'exact', parts: { a: 500, b: 400 } } }, ids), /less than the total/);
  assert.match(M.checkExpense({ ...e, split: { how: 'percent', parts: { a: 5000, b: 4000 } } }, ids), /100/);
  assert.match(M.checkExpense({ ...e, paid: { z: 1000 } }, ids), /who paid/);
  const items = { how: 'items', items: [{ id: 'i', name: 'fries', amount: 1000, who: [] }] };
  assert.match(M.checkExpense({ ...e, split: items }, ids), /who had the fries/);
});

test('balances always add up to zero, and settling up squares everyone', () => {
  for (let seed = 1; seed <= 600; seed++) {
    const t = randomTab(seed);
    const bal = M.balances(t);
    assert.equal(sum(bal), 0, `seed ${seed}`);
    const { payments } = settle(bal, t.people.map(p => p.id));
    const left = { ...bal };
    for (const p of payments) {
      assert.ok(p.amount > 0 && Number.isInteger(p.amount));
      assert.notEqual(p.from, p.to);
      left[p.from] += p.amount;
      left[p.to] -= p.amount;
    }
    assert.ok(Object.values(left).every(v => v === 0), `seed ${seed}: not square after paying`);
    const owing = Object.values(bal).filter(Boolean).length;
    assert.ok(payments.length <= Math.max(0, owing - 1));

    // Recording the payments on the tab squares it too.
    for (const p of payments) t.entries.push(M.tidy({ id: M.newId(8), kind: 'payment', added: 1, changed: 1, date: '', ...p }));
    assert.ok(M.isSquare(t), `seed ${seed}: tab not square after recording`);
  }
});

// The fewest payments by brute force: people minus the most zero-sum groups, over every way of grouping them.
function bruteFewest(vals) {
  const n = vals.length;
  let bestGroups = 0;
  const groups = [];
  (function place(i) {
    if (i === n) {
      if (groups.every(g => g.reduce((s, k) => s + vals[k], 0) === 0)) bestGroups = Math.max(bestGroups, groups.length);
      return;
    }
    for (const g of groups) { g.push(i); place(i + 1); g.pop(); }
    groups.push([i]); place(i + 1); groups.pop();
  })(0);
  return n - bestGroups;
}

function randomBalances(r, n, small) {
  const vals = Array.from({ length: n - 1 }, () => (Math.floor(r() * (small ? 7 : 20000)) - (small ? 3 : 10000)) * (small ? 500 : 1));
  vals.push(-vals.reduce((a, b) => a + b, 0));
  return vals;
}

test('the fewest payments: never more than the quick rule, and truly the fewest', () => {
  const r = rng(7);
  let better = 0;
  for (let k = 0; k < 3000; k++) {
    const n = 2 + Math.floor(r() * 7);
    const vals = randomBalances(r, n, r() < 0.6); // small whole amounts make lots of groups that cancel out
    const ids = vals.map((_, i) => `p${i}`);
    const bal = Object.fromEntries(ids.map((id, i) => [id, vals[i]]));
    const live = ids.filter(id => bal[id]);
    const quick = greedy(live, bal).length;
    const exact = fewest(live, bal).length;
    assert.ok(exact <= quick, `${exact} > ${quick}`);
    assert.equal(exact, bruteFewest(live.map(id => bal[id])), `not the fewest for ${JSON.stringify(bal)}`);
    if (exact < quick) better++;
  }
  assert.ok(better > 10, `the exact way did better ${better} times`);

  // A case the quick rule gets wrong: the biggest debt goes to the biggest creditor and breaks up a pair that cancels.
  const bal = { a: 800, b: 500, c: -500, d: -400, e: -400 };
  assert.equal(greedy(Object.keys(bal), bal).length, 4);
  assert.equal(fewest(Object.keys(bal), bal).length, 3);
  const bal2 = { a: 7, b: 3, c: -3, d: -7, e: 2, f: 1, g: -3 };
  assert.ok(greedy(Object.keys(bal2), bal2).length >= fewest(Object.keys(bal2), bal2).length);
  assert.equal(fewest(Object.keys(bal2), bal2).length, 4);
});

test('bigger groups: exact up to 15 people who are up or down, quick after that, square either way', () => {
  const r = rng(99);
  for (const n of [12, 15, 16, 30]) {
    for (let k = 0; k < 5; k++) {
      const vals = randomBalances(r, n, true);
      const bal = Object.fromEntries(vals.map((v, i) => [`p${i}`, v]));
      const out = settle(bal);
      assert.equal(out.fewest, Object.values(bal).filter(Boolean).length <= 15);
      const left = { ...bal };
      for (const p of out.payments) { left[p.from] += p.amount; left[p.to] -= p.amount; }
      assert.ok(Object.values(left).every(v => v === 0));
      assert.ok(out.payments.length <= greedy(Object.keys(bal).filter(id => bal[id]), bal).length);
    }
  }
  const t0 = Date.now();
  const bal = Object.fromEntries(randomBalances(rng(3), 15, false).map((v, i) => [`p${i}`, v]));
  settle(bal);
  assert.ok(Date.now() - t0 < 1500, 'fifteen people is quick');
  assert.throws(() => settle({ a: 5, b: -4 }));
});

// Two phones start from the same tab and each make changes.
function fork(seed) {
  const r = rng(seed);
  const base = randomTab(seed, { entries: 8 });
  const a = structuredClone(base), b = structuredClone(base);
  let clock = 1000;
  for (const side of [a, b]) {
    for (let k = 0; k < 6; k++) {
      clock += Math.floor(r() * 3);
      const pick = Math.floor(r() * side.entries.length);
      const roll = r();
      if (roll < 0.3 && side.entries[pick] && !side.entries[pick].deleted) {
        side.entries[pick] = { id: side.entries[pick].id, kind: side.entries[pick].kind, changed: clock, deleted: true };
      } else if (roll < 0.6 && side.entries[pick] && !side.entries[pick].deleted) {
        const e = side.entries[pick];
        if (e.kind === 'payment') { e.amount += 1; e.changed = clock; } else { e.note = `edited ${clock}`; e.changed = clock; }
      } else {
        const ids = side.people.map(p => p.id);
        side.entries.push({ id: M.newId(8), kind: 'payment', added: clock, changed: clock, date: '', note: '', from: ids[0], to: ids[1], amount: 100 + k });
      }
    }
    if (r() < 0.5) { side.name = `Renamed ${clock}`; side.changed = clock++; }
    if (r() < 0.5) M.addPerson(side, `New ${clock}`);
  }
  return { a, b };
}
const body = t => canon(M.shareable({ ...t, local: undefined }));

test('merging: either order gives the same tab, twice is the same as once, and nothing is lost', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const { a, b } = fork(seed);
    const ab = merge(a, b).tab, ba = merge(b, a).tab;
    assert.equal(body(ab), body(ba), `seed ${seed}: order matters`);
    assert.equal(body(merge(ab, b).tab), body(ab), 'merging again changes nothing');
    assert.equal(body(merge(ab, a).tab), body(ab));
    assert.ok(nothingNew(merge(ab, ab).changes));
    // Everything either side has is in the result, as the later copy.
    for (const side of [a, b]) for (const e of side.entries) {
      const got = ab.entries.find(x => x.id === e.id);
      assert.ok(got, 'kept');
      assert.ok(got.changed >= e.changed);
    }
    assert.equal(sum(M.balances(ab)), 0);
  }
});

test('merging: what the summary says came in', () => {
  const t = sampleTab();
  const mine = structuredClone(t), theirs = structuredClone(t);
  const ids = t.people.map(p => p.id);
  const later = Math.max(...t.entries.map(e => e.changed)) + 100;
  theirs.entries.push({ id: 'new1', kind: 'payment', added: later, changed: later, date: '', note: '', from: ids[1], to: ids[0], amount: 500 });
  const gone = theirs.entries[0];
  theirs.entries[0] = { id: gone.id, kind: gone.kind, changed: later, deleted: true };
  Object.assign(theirs.entries[1], { amount: theirs.entries[1].amount, note: 'changed', changed: later });
  mine.entries.push({ id: 'mine1', kind: 'payment', added: later, changed: later, date: '', note: '', from: ids[2], to: ids[0], amount: 700 });
  const { tab, changes } = merge(mine, theirs);
  assert.deepEqual(changes.added.map(e => e.id), ['new1']);
  assert.deepEqual(changes.removed.map(e => e.id), [gone.id]);
  assert.equal(changes.changed.length, 1);
  assert.equal(changes.ours, 1, 'this side has one thing theirs doesn’t');
  assert.ok(tab.entries.find(e => e.id === 'mine1'));
  assert.equal(tab.local.me, t.local.me, 'this phone’s own notes stay');

  // An edit made after a deletion on the other phone brings it back; one made before doesn't.
  const x = structuredClone(t), y = structuredClone(t);
  const e = x.entries[2];
  x.entries[2] = { id: e.id, kind: e.kind, changed: later, deleted: true };
  y.entries[2] = { ...y.entries[2], note: 'edited later', changed: later + 5 };
  assert.ok(!merge(x, y).tab.entries.find(z => z.id === e.id).deleted);
  y.entries[2].changed = later - 5;
  assert.ok(merge(x, y).tab.entries.find(z => z.id === e.id).deleted);
});

test('someone deleted on one phone stays while an expense on another still has them', () => {
  const t = sampleTab();
  const a = structuredClone(t), b = structuredClone(t);
  const maya = a.people.find(p => p.name === 'Maya');
  // Phone A takes Maya off everything and deletes her; phone B adds her to something new.
  a.entries = a.entries.map(e => (M.involved(e).includes(maya.id) ? { id: e.id, kind: e.kind, changed: e.changed + 50, deleted: true } : e));
  Object.assign(maya, { deleted: true, changed: maya.changed + 50 });
  assert.ok(!M.people(a).some(p => p.id === maya.id));
  b.entries.push({ id: 'late', kind: 'payment', added: Date.now() + 1e6, changed: Date.now() + 1e6, date: '', note: '', from: maya.id, to: b.people[0].id, amount: 100 });
  const { tab } = merge(a, b);
  assert.ok(M.people(tab).some(p => p.id === maya.id && p.name === 'Maya'));
  assert.equal(sum(M.balances(tab)), 0);
});

test('links: a tab comes out of a link exactly as it went in', async () => {
  for (let seed = 1; seed <= 150; seed++) {
    const t = randomTab(seed);
    if (seed % 3 === 0) M.removeEntry(t, t.entries[0]?.id);
    if (seed % 4 === 0) { t.people[0].pay = { venmo: 'someone', paypal: 'someone' }; }
    for (const squeeze of [true, false]) {
      const text = await pack(toWire(t, t.people[0].id), { squeeze });
      assert.match(text, squeeze ? /^[zj][A-Za-z0-9_-]+$/ : /^j[A-Za-z0-9_-]+$/);
      const { tab, from, dropped } = fromWire(await unpack(text));
      assert.equal(dropped, 0);
      assert.equal(from, t.people[0].id);
      assert.equal(canon({ ...tab, local: undefined }), canon(M.shareable(t)), `seed ${seed}`);
      assert.ok(nothingNew(merge(t, tab).changes));
    }
  }
});

test('links: squeezed, and short enough to send', async () => {
  const t = sampleTab();
  const plain = await pack(toWire(t), { squeeze: false });
  const z = await pack(toWire(t));
  assert.ok(z.startsWith('z'));
  assert.ok(z.length < plain.length * 0.7, `${z.length} vs ${plain.length}`);
  const link = await tabLink(t, t.local.me);
  assert.ok(link.startsWith('https://junkdrawer.works/square-up/#/s/z'), 'outside a page, links point at the real site');
  assert.ok(link.length < 2500, `sample link is ${link.length} characters`);
  const back = await readLink(link.split('#/s/')[1]);
  assert.equal(back.tab.name, 'Joshua Tree weekend');
});

test('links: anything that doesn’t add up is left out', async () => {
  const t = sampleTab();
  const w = toWire(t);
  w.e[0].m += 1; // the amount no longer matches who paid
  w.e[1].b = { nobody: 5 }; // paid by someone not on the tab
  w.e.push({ k: 'p', i: 'evil', f: w.p[0].i, t: w.p[0].i, m: 5 }); // paying yourself
  w.e.push({ k: 'e', i: '<script>', m: 5 });
  w.n = 'x'.repeat(500);
  const { tab, dropped } = fromWire(w);
  assert.equal(dropped, 4);
  assert.equal(tab.name.length, 80);
  assert.throws(() => fromWire({ v: 2 }));
  await assert.rejects(unpack('zAAAA'));
  await assert.rejects(unpack('q' + 'abc'));
});

test('pay links', () => {
  const sam = { pay: { venmo: '@sam-lee', cashapp: '$samlee', paypal: 'https://paypal.me/samlee' } };
  const usd = payLinks(sam, 4210, 'USD', 'Square Up: Joshua Tree');
  assert.deepEqual(usd.map(l => l.url), [
    'https://venmo.com/?txn=pay&audience=private&recipients=sam-lee&amount=42.10&note=Square%20Up%3A%20Joshua%20Tree',
    'https://cash.app/$samlee/42.10',
    'https://paypal.me/samlee/42.10',
  ]);
  const eur = payLinks(sam, 4210, 'EUR');
  assert.deepEqual(eur.map(l => l.url), ['https://paypal.me/samlee/42.10EUR'], 'Venmo and Cash App only take dollars (and Cash App pounds)');
  assert.deepEqual(payLinks(sam, 4210, 'GBP').map(l => l.key), ['cashapp', 'paypal']);
  assert.equal(payLinks({ pay: {} }, 100, 'USD').length, 0);
  assert.equal(cleanHandle('venmo', 'venmo.com/u/Sam-Lee'), 'Sam-Lee');
  assert.equal(cleanHandle('paypal', 'sam lee'), '', 'spaces aren’t allowed');
  assert.equal(cleanHandle('cashapp', 'https://cash.app/$samlee'), 'samlee');
});

test('the offline copy lists every file the page needs', async () => {
  const sw = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
  const listed = new Set([...sw.match(/const SHELL = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(m => m[1]));
  const want = [];
  for (const dir of ['js', 'css', 'fonts']) for (const f of await readdir(new URL(`../${dir}/`, import.meta.url))) want.push(`${dir}/${f}`);
  for (const f of want) assert.ok(listed.has(f), `sw.js is missing ${f}`);
  for (const f of listed) if (f !== './') await readFile(new URL(`../${f}`, import.meta.url));
});
