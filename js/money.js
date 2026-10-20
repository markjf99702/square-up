// Money is always a whole number of the currency's smallest unit (cents for dollars, yen for yen),
// so every split adds up exactly. This file reads and writes amounts and splits them without losing a cent.

// Digits after the decimal point, from ISO 4217. Written out rather than asked of the browser,
// because two browsers that disagreed would read the same link as amounts a hundred times apart.
export const CURRENCIES = {
  USD: 2, EUR: 2, GBP: 2, CAD: 2, AUD: 2, NZD: 2, JPY: 0, CHF: 2, SEK: 2, NOK: 2, DKK: 2, ISK: 0,
  PLN: 2, CZK: 2, HUF: 2, RON: 2, MXN: 2, BRL: 2, ARS: 2, CLP: 0, COP: 2, PEN: 2, INR: 2, CNY: 2,
  HKD: 2, TWD: 2, SGD: 2, KRW: 0, THB: 2, VND: 0, PHP: 2, IDR: 2, MYR: 2, ZAR: 2, TRY: 2, ILS: 2,
  AED: 2, EGP: 2, MAD: 2,
};

export const MAX = 1e11; // the biggest amount anywhere, in minor units: a billion dollars is plenty for dinner

export const digits = currency => CURRENCIES[currency] ?? 2;

const formatters = new Map();
function formatter(currency, compact) {
  const key = currency + (compact ? '~' : '');
  if (!formatters.has(key)) {
    const d = digits(currency);
    let f;
    try {
      f = new Intl.NumberFormat(undefined, { style: 'currency', currency, minimumFractionDigits: compact ? 0 : d, maximumFractionDigits: d });
    } catch {
      f = { format: n => `${currency} ${n.toFixed(d)}`, formatToParts: () => [{ type: 'currency', value: currency }] };
    }
    formatters.set(key, f);
  }
  return formatters.get(key);
}

// 12345 EUR -> "€123.45" in the reader's own style.
export function format(minor, currency) {
  return formatter(currency).format(minor / 10 ** digits(currency));
}

// Leaves off ".00" when there's nothing after the point: for headlines and totals where it's clutter.
export function formatShort(minor, currency) {
  const d = digits(currency);
  return formatter(currency, minor % 10 ** d === 0).format(minor / 10 ** d);
}

export function symbol(currency) {
  try {
    return formatter(currency).formatToParts(0).find(p => p.type === 'currency')?.value || currency;
  } catch { return currency; }
}

// 1234 -> "12.34", for inputs and payment links: plain digits and a point, no symbol, no grouping.
export function plain(minor, currency) {
  const d = digits(currency);
  const sign = minor < 0 ? '-' : '';
  const s = String(Math.abs(minor)).padStart(d + 1, '0');
  return d ? `${sign}${s.slice(0, -d)}.${s.slice(-d)}` : sign + s;
}

// Reads what someone typed: "12", "12.5", "12,50", "$1,234.56", "1.234,56", and sums like "6.50+4" or "$12 + $4".
// Currency signs and codes before or after the number are fine ("CHF 12.50", "12 kr"), and so is a sign on each
// number of a sum ("12 € + 4 €"), but anything else between two digits ("6.50 x 2", "1e3", "12 USD + 4 USD")
// means it isn't an amount written out, so it isn't read as one.
// Returns minor units, or null if it can't be read as an amount.
export function parse(text, currency = 'USD') {
  const d = digits(currency);
  const typed = String(text ?? '');
  // Between two digits only spaces, points, commas, the apostrophes some countries group thousands with, and + or −.
  // Where there's a + or −, currency signs too ("$12 + $4", "£5+£3"); letters never ("1e-3", "12 USD + 4 USD").
  const odd = gap => /[^\s.,'’+\-−]/.test(/[+\-−]/.test(gap) ? gap.replace(/\p{Sc}/gu, '') : gap);
  if ((typed.match(/\d\D+(?=\d)/g) || []).some(gap => odd(gap.slice(1)))) return null;
  const s = typed.replace(/[\s  ']/g, '').replace(/[^\d.,+\-−]/g, '').replace(/−/g, '-');
  if (!/\d/.test(s)) return null;
  const terms = s.match(/[+-]?[^+-]+/g);
  if (!terms || terms.join('') !== s) return null;
  let total = 0;
  for (const t of terms) {
    const sign = t[0] === '-' ? -1 : 1;
    const v = parseTerm(t.replace(/^[+-]/, ''), d);
    if (v === null) return null;
    total += sign * v;
  }
  return Math.abs(total) > MAX ? null : total;
}

function parseTerm(t, d) {
  if (!/^[\d.,]+$/.test(t) || !/\d/.test(t)) return null;
  const dot = t.lastIndexOf('.'), comma = t.lastIndexOf(',');
  let point = -1;
  if (dot >= 0 && comma >= 0) point = Math.max(dot, comma);
  else if (dot >= 0 || comma >= 0) {
    const at = Math.max(dot, comma);
    const count = t.split(t[at]).length - 1;
    const after = t.length - at - 1;
    // "1,234" and "1.234.567" group thousands; "12.5" and "12,50" have a decimal point.
    const grouping = count > 1 || (after === 3 && d < 3 && at > 0);
    if (!grouping) point = at;
  }
  let whole = point >= 0 ? t.slice(0, point) : t;
  const frac = point >= 0 ? t.slice(point + 1) : '';
  // Thousands come in threes: "1,234,567" but not "12,34" or "1.2.3".
  if (/[.,]/.test(whole)) {
    const groups = whole.split(/[.,]/);
    if (!/^\d{1,3}$/.test(groups[0]) || groups.slice(1).some(g => !/^\d{3}$/.test(g))) return null;
    whole = groups.join('');
  }
  if (/[.,]/.test(frac) || frac.length > d) return null;
  if (whole.length > 13) return null;
  return Number(whole || '0') * 10 ** d + Number(frac.padEnd(d, '0') || '0');
}

// Splits a whole number in proportion to whole-number weights so the parts add up exactly.
// Each part gets its rounded-down share, then the cents left over go one each to the parts
// that lost the most in rounding (largest remainder), earliest first when two lost the same.
export function allocate(total, weights) {
  if (!weights.length) throw new Error('nothing to split between');
  if (total < 0) return allocate(-total, weights).map(v => (v ? -v : 0));
  const W = weights.map(w => {
    if (!Number.isInteger(w) || w < 0) throw new Error('weights must be whole numbers, zero or more');
    return BigInt(w);
  });
  const sum = W.reduce((a, b) => a + b, 0n);
  if (sum === 0n) throw new Error('every weight is zero');
  const T = BigInt(total);
  const out = W.map(w => (T * w) / sum);
  const rem = W.map(w => (T * w) % sum);
  let left = Number(T - out.reduce((a, b) => a + b, 0n));
  const order = rem.map((r, i) => i).sort((a, b) => (rem[b] > rem[a] ? 1 : rem[b] < rem[a] ? -1 : a - b));
  for (const i of order) {
    if (left <= 0) break;
    out[i] += 1n;
    left--;
  }
  return out.map(Number);
}

// A percentage of an amount, rounded to the nearest minor unit (halves round up).
// Percent is in hundredths: 1850 is 18.5%.
export function percentOf(amount, hundredths) {
  const v = BigInt(amount) * BigInt(hundredths);
  const q = v / 10000n, r = v % 10000n;
  return Number(r * 2n >= 10000n ? q + 1n : q);
}

// "18.5" -> 1850, the percent in hundredths; null if it isn't a sensible percent.
export function parsePercent(text) {
  const s = String(text ?? '').trim().replace('%', '').replace(',', '.');
  if (!/^\d{1,4}(\.\d{0,2})?$|^\.\d{1,2}$/.test(s)) return null;
  const [w, f = ''] = s.split('.');
  const v = Number(w || '0') * 100 + Number(f.padEnd(2, '0'));
  return v > 100000 ? null : v;
}

export const percentText = h => (h % 100 === 0 ? String(h / 100) : (h / 100).toFixed(h % 10 === 0 ? 1 : 2));

// A guess at the currency from the browser's language, for a new tab.
export function guessCurrency(lang = globalThis.navigator?.language || 'en-US') {
  const region = (lang.split('-')[1] || '').toUpperCase();
  const byRegion = {
    US: 'USD', GB: 'GBP', UK: 'GBP', CA: 'CAD', AU: 'AUD', NZ: 'NZD', JP: 'JPY', CH: 'CHF', SE: 'SEK', NO: 'NOK',
    DK: 'DKK', IS: 'ISK', PL: 'PLN', CZ: 'CZK', HU: 'HUF', RO: 'RON', MX: 'MXN', BR: 'BRL', AR: 'ARS', CL: 'CLP',
    CO: 'COP', PE: 'PEN', IN: 'INR', CN: 'CNY', HK: 'HKD', TW: 'TWD', SG: 'SGD', KR: 'KRW', TH: 'THB', VN: 'VND',
    PH: 'PHP', ID: 'IDR', MY: 'MYR', ZA: 'ZAR', TR: 'TRY', IL: 'ILS', AE: 'AED', EG: 'EGP', MA: 'MAD',
    IE: 'EUR', DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR', BE: 'EUR', AT: 'EUR', PT: 'EUR', FI: 'EUR', GR: 'EUR',
  };
  if (byRegion[region]) return byRegion[region];
  const byLang = { ja: 'JPY', ko: 'KRW', de: 'EUR', fr: 'EUR', es: 'EUR', it: 'EUR', nl: 'EUR', fi: 'EUR', pt: 'EUR', sv: 'SEK', nb: 'NOK', da: 'DKK', pl: 'PLN', cs: 'CZK' };
  return byLang[lang.split('-')[0]] || 'USD';
}
