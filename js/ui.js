// Small pieces every screen uses: escaping, amounts and dates, the toast, the sheet,
// copying links, and one set of event handlers for whichever screen is showing.
import { format, formatShort } from './money.js';
import { personName } from './model.js';

export const app = document.getElementById('app');

export const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

export function go(path, replace = false) {
  const hash = '#' + path;
  if (replace) location.replace(hash); else location.hash = hash;
}

export const money = (tab, v) => format(v, tab.currency);
export const moneyShort = (tab, v) => formatShort(v, tab.currency);

// "You" for whoever this phone belongs to, their name for everyone else.
export const who = (tab, id, you = 'You') => (id && id === tab.local?.me ? you : personName(tab, id));
export const whoLower = (tab, id) => who(tab, id, 'you');

const asDate = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const day = s => (s ? asDate(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '');
export const longDay = s => (s ? asDate(s).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : 'No date');
export function dayRange(span) {
  if (!span) return '—';
  const [a, b] = span;
  if (a === b) return day(a);
  const [ya, ma] = a.split('-'), [yb, mb] = b.split('-');
  if (ya === yb && ma === mb) return `${day(a)} – ${Number(b.split('-')[2])}`;
  return `${day(a)} – ${day(b)}`;
}

export const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
// A household on the tab, like "Jo & Priya", takes "pay" and "owe" rather than "pays" and "owes".
export const several = name => /\s(&|and|\+)\s/i.test(String(name || ''));
export function listWords(xs) {
  if (xs.length <= 1) return xs.join('');
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

// One set of listeners on the page; each screen says what they do.
let handlers = {};
export function on(h) { handlers = h; }
for (const type of ['click', 'input', 'change', 'keydown', 'focusout']) {
  app.addEventListener(type, e => handlers[type]?.(e));
}

let toastTimer;
export function toast(message, action) {
  const el = document.getElementById('toast');
  el.innerHTML = `<span>${esc(message)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
  el.hidden = false;
  if (action) el.querySelector('button').onclick = () => { el.hidden = true; action.run(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, action ? 6000 : 2800);
}

// The sheet that slides up. bind() wires up what's inside once it's drawn, and gets a way to close it.
export function sheet(html, bind, cls = '') {
  const dlg = document.getElementById('sheet');
  const body = dlg.querySelector('.sheet-body');
  dlg.className = `sheet ${cls}`.trim();
  body.innerHTML = html;
  if (!dlg.open) {
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
  }
  const close = () => (dlg.close ? dlg.close() : dlg.removeAttribute('open'));
  bind?.(body, close);
  return close;
}
export function closeSheet() {
  const dlg = document.getElementById('sheet');
  if (dlg.open) dlg.close ? dlg.close() : dlg.removeAttribute('open');
}

export async function copy(text, field) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Link copied');
  } catch {
    // Some browsers and embedded views refuse the clipboard: select the link so it can be copied by hand.
    field?.focus();
    field?.select();
    let done = false;
    try { done = document.execCommand('copy'); } catch { /* not allowed here either */ }
    toast(done ? 'Link copied' : 'The link is selected. Copy it from there.');
  }
}

// The one-file copy shown inside another page can't start a download.
export function canSave() {
  if (!('single' in document.documentElement.dataset)) return true;
  try { return window.top === window.self; } catch { return false; }
}

export function download(name, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// A short name for a chip: the first word, or the whole thing if it's short.
export function short(name) {
  const s = String(name || '').trim();
  return s.length <= 10 ? s : s.split(/\s+/)[0].slice(0, 10);
}
