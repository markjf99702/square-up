// The page: which screen goes with the address, the home screen, starting a tab, and opening links.
import * as M from './model.js';
import { CURRENCIES, symbol, guessCurrency } from './money.js';
import { store } from './store.js';
import { readLink, tabLink } from './share.js';
import { merge, nothingNew } from './merge.js';
import { sampleTab } from './sample.js';
import { settle } from './settle.js';
import { app, esc, on, go, toast, money, moneyShort, whoLower, canSave, download, plural, dayRange } from './ui.js';
import { tabScreen } from './tab.js';
import { editor } from './editor.js';

let lastPath = null;

async function route() {
  const path = location.hash.replace(/^#\/?/, '');
  const [head, a, b, c] = path.split('/');
  document.getElementById('allLink').hidden = !head;
  if (path !== lastPath) {
    window.scrollTo(0, 0);
    lastPath = path;
  }
  document.title = 'Square Up';

  if (head === 'new') return newTab();
  if (head === 'sample') {
    const old = store.all().find(t => t.local?.sample && !t.local.archived);
    const t = old || sampleTab();
    if (!old) store.put(t);
    return go(`/t/${t.id}`, true);
  }
  if (head === 's') return receive(path.slice(2));
  if (head === 't') {
    const t = store.get(a);
    if (!t) return message('That tab isn’t here', 'It may have been deleted, or it was started on another phone. Ask someone on it to send you the link.');
    t.local.opened = Date.now();
    store.put(t);
    document.title = `${t.name || 'Untitled tab'} · Square Up`;
    if (b === 'add') return editor(t, null, c === 'items' ? 'items' : 'equal');
    if (b === 'e') {
      const e = M.live(t).find(x => x.id === c && x.kind === 'expense');
      if (!e) return go(`/t/${t.id}`, true);
      return editor(t, e);
    }
    return tabScreen(t, ['square', 'people'].includes(b) ? b : 'expenses');
  }
  home();
}

function message(title, text) {
  app.innerHTML = `
    <div class="check note-card">
      <div class="check-head"><span>Not found</span></div>
      <h2>${esc(title)}</h2>
      <p class="hint">${esc(text)}</p>
      <a class="btn" href="#/">All tabs</a>
    </div>`;
  on({});
}

// Someone sent a tab. Add it, or bring what's new into the copy already here.
async function receive(data) {
  let got;
  try { got = await readLink(data); } catch (err) {
    return message('That link didn’t come through whole', err.message.startsWith('This browser') ? err.message : 'Ask for it again, or copy all of it into the address bar.');
  }
  const { tab: theirs, from, dropped } = got;
  const fromName = theirs.people.find(p => p.id === from)?.name || '';
  const mine = store.get(theirs.id);
  if (!mine) {
    theirs.local = { opened: Date.now(), merge: { at: Date.now(), from: fromName, fresh: true, dropped } };
    store.put(theirs);
    return go(`/t/${theirs.id}`, true);
  }
  const { tab, changes } = merge(mine, theirs);
  const n = M.people(tab);
  tab.local.merge = {
    at: Date.now(),
    from: fromName,
    nothing: nothingNew(changes),
    added: changes.added.map(e => e.id),
    changed: changes.changed.map(({ before, after }) => ({ id: after.id, was: before.amount })),
    removed: changes.removed.map(e => ({ kind: e.kind, what: e.what, from: e.from, to: e.to, amount: e.amount })),
    people: changes.people.added.filter(p => n.some(x => x.id === p.id)).map(p => p.name),
    gone: changes.people.removed.map(p => p.name),
    renamed: changes.renamed,
    currency: changes.currency,
    ours: changes.ours,
    dropped,
  };
  // Something new on an archived tab brings it back onto the list.
  if (tab.local.archived && !tab.local.merge.nothing) tab.local.archived = false;
  store.put(tab);
  go(`/t/${tab.id}`, true);
}

// ---------- Starting a tab ----------

function newTab() {
  const guess = guessCurrency();
  const rows = [store.name, '', ''];
  const draw = () => {
    app.innerHTML = `
      <div class="edhead"><a class="back" href="#/">All tabs</a><h1>Start a tab</h1></div>
      <form class="check form" id="newForm" autocomplete="off">
        <div class="check-head"><span>New tab</span><span class="serial">No. ——</span></div>
        <label class="field"><span>What’s it for?</span>
          <input class="input" id="tabName" maxlength="80" placeholder="Lisbon trip, 14 Elm Street, Friday dinner" value="${esc(document.getElementById('tabName')?.value || '')}"></label>
        <label class="field"><span>Currency</span>
          <select class="input" id="currency">${Object.keys(CURRENCIES).map(c => `<option value="${c}"${c === (document.getElementById('currency')?.value || guess) ? ' selected' : ''}>${c} ${esc(symbol(c) === c ? '' : symbol(c))}</option>`).join('')}</select></label>
        <fieldset class="field"><legend>Who’s in?</legend>
          <ul class="rows" id="who">${rows.map((v, i) => `
            <li><input class="input" data-row="${i}" maxlength="40" value="${esc(v)}" placeholder="${i === 0 ? 'Your name' : 'Someone else'}" aria-label="${i === 0 ? 'Your name' : `Person ${i + 1}`}">
            ${i === 0 ? '<span class="you-tag">You</span>' : `<button type="button" class="x" data-drop="${i}" aria-label="Remove">✕</button>`}</li>`).join('')}
          </ul>
          <button type="button" class="add" data-act="more">Add someone</button>
          <p class="hint">A couple or a family can go in as one, and count as two or more when you split by shares.</p>
          <p class="problem" id="problem" hidden></p>
        </fieldset>
      </form>
      <div class="next-bar"><a class="btn" href="#/">Cancel</a><button type="button" class="btn primary" data-act="open">Open the tab</button></div>`;
  };
  draw();
  const sync = () => app.querySelectorAll('[data-row]').forEach(inp => { rows[inp.dataset.row] = inp.value; });
  const more = () => {
    sync();
    rows.push('');
    draw();
    app.querySelector(`[data-row="${rows.length - 1}"]`).focus();
  };
  on({
    input(e) { if (e.target.dataset.row) rows[e.target.dataset.row] = e.target.value; },
    keydown(e) {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const i = e.target.dataset.row;
      if (i === undefined) return;
      if (Number(i) === rows.length - 1) more();
      else app.querySelector(`[data-row="${Number(i) + 1}"]`).focus();
    },
    click(e) {
      const t = e.target.closest('button');
      if (!t) return;
      if (t.dataset.act === 'more') more();
      if (t.dataset.drop) { sync(); rows.splice(Number(t.dataset.drop), 1); draw(); }
      if (t.dataset.act === 'open') {
        sync();
        const names = rows.map(r => r.trim()).filter(Boolean);
        const problem = document.getElementById('problem');
        if (names.length < 2) { problem.hidden = false; problem.textContent = 'Add at least two people.'; return; }
        const t = M.blankTab(document.getElementById('tabName').value.trim().slice(0, 80), document.getElementById('currency').value);
        const ids = names.map(n => M.addPerson(t, n).id);
        if (rows[0].trim()) { t.local.me = ids[0]; store.name = rows[0].trim(); }
        t.local.opened = Date.now();
        store.put(t);
        go(`/t/${t.id}`, true);
      }
    },
  });
}

// ---------- Home ----------

function statusOf(t) {
  let bal;
  try { bal = M.balances(t); } catch { return 'Something on this tab doesn’t add up'; }
  const n = M.expenses(t).length;
  if (!n) return 'Nothing on it yet';
  const me = t.local.me;
  const owing = Object.values(bal).filter(Boolean).length;
  if (!owing) return '<span class="stamp small">Square</span>';
  const pays = settle(bal, M.people(t).map(p => p.id)).payments.length;
  const mine = me && bal[me] ? (bal[me] > 0 ? `You’re owed <b>${money(t, bal[me])}</b>` : `You owe <b>${money(t, -bal[me])}</b>`) : me ? 'You’re square' : '';
  return [mine, `${plural(pays, 'payment')} to square up`].filter(Boolean).join(' · ');
}

function tabItem(t) {
  const people = M.people(t);
  let spent = 0;
  try { spent = M.ledger(t).spent; } catch { /* shown in the status */ }
  return `
    <li class="stub">
      <a href="#/t/${t.id}">
        <span class="stub-top"><span>Guest check</span><span class="serial">No. ${M.serial(t)}</span></span>
        <span class="t">${esc(t.name || 'Untitled tab')}</span>
        <span class="s">${esc(people.map(p => whoLower(t, p.id)).join(', ').replace(/^you/, 'You'))}</span>
        <span class="s">${spent ? `${moneyShort(t, spent)} spent · ${esc(dayRange(M.span(t)))}` : `Started ${esc(new Date(t.created).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))}`}${t.local.sample ? ' · <span class="tag">Sample</span>' : ''}</span>
        <span class="state">${statusOf(t)}</span>
      </a>
    </li>`;
}

function home() {
  const all = store.all();
  const open = all.filter(t => !t.local.archived), shut = all.filter(t => t.local.archived);
  const sample = all.some(t => t.local.sample && !t.local.archived);
  app.innerHTML = `
    <section class="hero${all.length ? ' compact' : ''}">
      ${all.length ? '' : heroCheck()}
      <h1>${all.length ? 'Your tabs' : 'Split the costs, then square up.'}</h1>
      ${all.length ? '' : `<p>Keep a tab for a trip, a shared house or a dinner out. Add what each person paid and who it was for, and Square Up works out who’s up, who’s down, and the fewest payments that settle it. Send the tab to the others as a link: no accounts.</p>`}
      <div class="hero-acts"><a class="btn primary" href="#/new">Start a tab</a><a class="btn" href="#/sample">${sample ? 'Open the sample tab' : 'Try a sample tab'}</a></div>
    </section>
    ${open.length ? `<ul class="stubs">${open.map(tabItem).join('')}</ul>` : ''}
    ${shut.length ? `
      <details class="archived"${open.length ? '' : ' open'}>
        <summary>Archived (${shut.length})</summary>
        <ul class="stubs">${shut.map(tabItem).join('')}</ul>
      </details>` : ''}
    <div class="keep">
      <p>Your tabs stay in this browser. Nothing is sent anywhere unless you send a link, and links carry the tab after the #, which browsers don’t send to any server.</p>
      ${canSave() ? `<button type="button" class="link-btn" data-act="save"${all.length ? '' : ' hidden'}>Save a backup</button>
      <label class="link-btn">Load a backup<input type="file" id="loadBackup" accept=".json,application/json"></label>` : ''}
    </div>`;

  on({
    click(e) {
      const t = e.target.closest('button');
      if (t?.dataset.act === 'save') download(`square-up-${M.today()}.json`, store.backup());
    },
    async change(e) {
      if (e.target.id !== 'loadBackup' || !e.target.files[0]) return;
      try {
        const n = store.restore(await e.target.files[0].text());
        home();
        toast(n ? `Loaded ${plural(n, 'tab')}` : 'Nothing in that backup');
      } catch (err) {
        toast(err.message.startsWith('That file') ? err.message : 'That file isn’t a Square Up backup.');
      }
    },
  });
}

// The little guest check on the first screen.
function heroCheck() {
  return `
    <div class="hero-check" aria-hidden="true">
      <div class="check-head"><span>Guest check</span><span class="serial">No. 000001</span></div>
      <div class="hc-line"><span>Cabin</span><span>930.00</span></div>
      <div class="hc-line"><span>Groceries</span><span>148.62</span></div>
      <div class="hc-line"><span>Dinner, by item</span><span>188.43</span></div>
      <div class="hc-line total"><span>Total</span><span>1,267.05</span></div>
      <span class="stamp">Square</span>
    </div>`;
}

window.addEventListener('hashchange', route);
route();

if ('serviceWorker' in navigator && !('single' in document.documentElement.dataset) && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// For the screenshot tool and tests: the store and the model, so they can set things up without tapping through.
window.squareUp = { store, M, sampleTab, tabLink };
