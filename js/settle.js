// Squaring up: the payments that bring everyone back to zero, as few of them as possible,
// and links that open a payment app with the amount filled in.

import { plain } from './money.js';

// Up to this many people who are up or down, the fewest payments is worked out exactly.
// Beyond it, a quick rule that's usually as good and never needs more than one payment fewer than people.
export const EXACT_LIMIT = 15;

// balances: { personId: amount }, positive for owed and negative for owing, adding up to zero.
// order: person ids, for settling ties the same way every time.
// Returns [{ from, to, amount }] and whether it's known to be the fewest possible.
export function settle(balances, order = Object.keys(balances)) {
  const ids = [...new Set([...order, ...Object.keys(balances)])].filter(id => balances[id]);
  const total = ids.reduce((s, id) => s + balances[id], 0);
  if (total !== 0) throw new Error('balances don’t add up to zero');
  if (ids.length <= EXACT_LIMIT) return { payments: fewest(ids, balances), fewest: true };
  return { payments: greedy(ids, balances), fewest: false };
}

// The quick rule: whoever owes most pays whoever is owed most, as much as it takes to square one of them.
// Everyone who is up or down squares up in at most one payment fewer than there are of them.
export function greedy(ids, balances) {
  const left = Object.fromEntries(ids.map(id => [id, balances[id]]));
  const out = [];
  const pos = new Map(ids.map((id, i) => [id, i]));
  const pick = sign => ids.filter(id => sign * left[id] > 0)
    .sort((a, b) => sign * (left[b] - left[a]) || pos.get(a) - pos.get(b))[0];
  for (;;) {
    const to = pick(1), from = pick(-1);
    if (!to || !from) break;
    const amount = Math.min(left[to], -left[from]);
    out.push({ from, to, amount });
    left[to] -= amount;
    left[from] += amount;
  }
  return out;
}

// The fewest payments. Any group of people whose balances add up to zero can square up among themselves
// in one payment fewer than there are of them, and a payment plan can't do better than that. So the fewest
// payments is the number of people minus the most groups they can be split into that each add up to zero.
// That split is found by going through every subset of people once (2^n of them), which is quick up to 15 or so.
export function fewest(ids, balances) {
  const n = ids.length;
  if (!n) return [];
  const vals = ids.map(id => balances[id]);
  const full = (1 << n) - 1;
  const sum = new Float64Array(full + 1);
  const best = new Int8Array(full + 1); // for each subset: the most zero groups along a chain of removals
  for (let m = 1; m <= full; m++) {
    const low = 31 - Math.clz32(m & -m);
    sum[m] = sum[m & (m - 1)] + vals[low];
    let b = 0;
    for (let r = m; r; r &= r - 1) {
      const v = best[m ^ (r & -r)];
      if (v > b) b = v;
    }
    best[m] = b + (sum[m] === 0 ? 1 : 0);
  }
  // Walk back down from everyone to no one, noting the subsets on the way that add up to zero.
  // Each difference between one of them and the next is a group that squares up on its own.
  const zeros = [];
  for (let m = full; m; ) {
    if (sum[m] === 0) zeros.push(m);
    const target = best[m] - (sum[m] === 0 ? 1 : 0);
    let next = -1;
    for (let r = m; r; r &= r - 1) {
      const without = m ^ (r & -r);
      if (best[without] === target) { next = without; break; }
    }
    m = next;
  }
  zeros.push(0);
  const out = [];
  for (let g = 0; g + 1 < zeros.length; g++) {
    const group = zeros[g] & ~zeros[g + 1];
    const members = ids.filter((_, i) => group & (1 << i));
    out.push(...greedy(members, balances));
  }
  return out;
}

// ---------- Paying through an app ----------
// Optional: each person can have a Venmo username, a Cash App $cashtag or a PayPal.me name.

export const APPS = [
  { key: 'venmo', label: 'Venmo', prefix: '@', currencies: ['USD'], hint: 'username' },
  { key: 'cashapp', label: 'Cash App', prefix: '$', currencies: ['USD', 'GBP'], hint: 'cashtag' },
  { key: 'paypal', label: 'PayPal', prefix: 'paypal.me/', currencies: null, hint: 'PayPal.me name' },
];

// Takes whatever was typed ("@sam-lee", "$samlee", "https://paypal.me/samlee") down to the name alone.
export function cleanHandle(key, text) {
  let s = String(text ?? '').trim();
  if (key === 'paypal') s = s.replace(/^(https?:\/\/)?(www\.)?paypal\.me\//i, '');
  if (key === 'cashapp') s = s.replace(/^(https?:\/\/)?(www\.)?cash\.app\//i, '').replace(/^\$/, '');
  if (key === 'venmo') s = s.replace(/^(https?:\/\/)?(www\.)?venmo\.com\/(u\/)?/i, '').replace(/^@/, '');
  s = s.replace(/[/?#].*$/, '');
  return /^[A-Za-z0-9_.-]{1,40}$/.test(s) ? s : '';
}

// Links to pay this person this amount, for the apps they've given a name for and that take this currency.
//   Venmo:    https://venmo.com/?txn=pay&audience=private&recipients=NAME&amount=12.34&note=...  (US dollars only)
//   Cash App: https://cash.app/$CASHTAG/12.34                                                    (US dollars and pounds)
//   PayPal:   https://paypal.me/NAME/12.34, with the currency code after the amount when it isn't dollars
export function payLinks(person, amount, currency, note = '') {
  const pay = person?.pay || {};
  const amt = plain(amount, currency);
  const out = [];
  for (const app of APPS) {
    const h = cleanHandle(app.key, pay[app.key]);
    if (!h || (app.currencies && !app.currencies.includes(currency))) continue;
    let url;
    if (app.key === 'venmo') url = `https://venmo.com/?txn=pay&audience=private&recipients=${encodeURIComponent(h)}&amount=${amt}&note=${encodeURIComponent(note)}`;
    if (app.key === 'cashapp') url = `https://cash.app/$${encodeURIComponent(h)}/${amt}`;
    if (app.key === 'paypal') url = `https://paypal.me/${encodeURIComponent(h)}/${amt}${currency === 'USD' ? '' : currency}`;
    out.push({ key: app.key, label: app.label, url });
  }
  return out;
}
