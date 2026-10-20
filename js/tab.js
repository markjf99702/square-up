// A tab: the check with everything on it, squaring up, and the people. Also sending the tab
// as a link, recording payments, and what came in from a link someone sent.
import * as M from './model.js';
import { CURRENCIES, digits, symbol, parse, plain } from './money.js';
import { store } from './store.js';
import { tabLink } from './share.js';
import { settle, payLinks, APPS, cleanHandle } from './settle.js';
import { app, esc, on, go, toast, sheet, copy, money, who, whoLower, several, day, longDay, dayRange, plural, listWords, canSave, download } from './ui.js';

const SECTIONS = [['expenses', 'Expenses', ''], ['square', 'Square up', '/square'], ['people', 'People', '/people']];

export function tabScreen(t, section) {
  let body;
  const bal = M.balances(t);
  const plan = settle(bal, M.people(t).map(p => p.id));
  if (section === 'square') body = squareSection(t, bal, plan);
  else if (section === 'people') body = peopleSection(t);
  else body = expensesSection(t, plan);
  app.innerHTML = `
    <div class="tabhead">
      <div class="tabhead-row">
        <div class="tabhead-title">
          <p class="kicker">${t.local.archived ? '<span class="tag">Archived</span> ' : ''}${esc(M.people(t).length)} people · ${esc(t.currency)}</p>
          <h1 class="written">${esc(t.name || 'Untitled tab')}</h1>
        </div>
        <button type="button" class="btn small send" data-act="send"><span aria-hidden="true">↗</span> Send</button>
      </div>
      <nav class="sections" aria-label="Parts of the tab">${SECTIONS.map(([key, label, path]) => `
        <a href="#/t/${t.id}${path}"${key === section ? ' aria-current="page"' : ''}>${label}${key === 'square' && plan.payments.length ? `<i>${plan.payments.length}</i>` : ''}</a>`).join('')}
      </nav>
    </div>
    ${body}`;
  on(handlers(t, section, plan));
}

const redraw = (t, section) => tabScreen(store.get(t.id), section);

// ---------- Expenses ----------

function splitWords(t, e) {
  const s = e.split;
  if (s.how === 'items') return `by item, ${plural(s.items.length, 'item')}`;
  const ids = Object.keys(s.parts);
  const everyone = M.people(t).every(p => ids.includes(p.id));
  if (s.how === 'equal') return everyone ? 'split evenly' : ids.length === 1 ? `all for ${whoLower(t, ids[0])}` : `split ${ids.length} ways`;
  if (s.how === 'shares') return 'split by shares';
  if (s.how === 'exact') return 'split by amounts';
  return 'split by percent';
}

function paidWords(t, e) {
  const ids = Object.keys(e.paid);
  return `${listWords(ids.map((id, i) => (i ? whoLower(t, id) : who(t, id))))} paid`;
}

function line(t, e, marks) {
  const mark = marks[e.id] ? `<span class="mark">${marks[e.id]}</span>` : '';
  if (e.kind === 'payment') {
    return `
      <button type="button" class="line pay" data-pay="${e.id}">
        <span class="qty" aria-hidden="true">⇄</span>
        <span class="what"><b>${esc(who(t, e.from))} paid ${esc(whoLower(t, e.to))}</b><small>${mark}Payment${e.note ? ` · ${esc(e.note)}` : ''}</small></span>
        <span class="amt">${money(t, e.amount)}</span>
      </button>`;
  }
  const me = t.local.me;
  let mine = '';
  if (me) {
    const s = M.sharesOf(e)[me];
    if (s) mine = ` · your share ${money(t, s)}`;
  }
  return `
    <a class="line" href="#/t/${t.id}/e/${e.id}">
      <span class="qty" aria-hidden="true">${M.CATEGORY[e.category]?.icon || '📎'}</span>
      <span class="what"><b>${esc(e.what || 'Something')}</b><small>${mark}${esc(paidWords(t, e))} · ${splitWords(t, e)}${mine}</small></span>
      <span class="amt">${money(t, e.amount)}</span>
    </a>`;
}

function expensesSection(t, plan) {
  const entries = M.sorted(M.live(t));
  const m = t.local.merge;
  const marks = {};
  if (m && !m.fresh && !m.nothing) {
    m.added?.forEach(id => { marks[id] = 'New'; });
    m.changed?.forEach(c => { marks[c.id] = 'Changed'; });
  }
  let rows = '';
  let lastDay = null;
  for (const e of entries) {
    if (e.date !== lastDay) { rows += `<div class="day">${esc(longDay(e.date))}</div>`; lastDay = e.date; }
    rows += line(t, e, marks);
  }
  const { rows: led, spent } = M.ledger(t);
  const me = t.local.me;
  const n = M.expenses(t).length;
  const pays = plan.payments.length;
  const stub = !n ? 'Add what people spent and it works out who owes whom.'
    : !pays ? 'Everyone is square.'
      : `${plural(pays, 'payment')} ${pays === 1 ? 'settles' : 'settle'} this tab${me && led[me]?.net ? `. ${led[me].net > 0 ? `You’re owed ${money(t, led[me].net)}` : `You owe ${money(t, -led[me].net)}`}` : ''}.`;
  return `
    ${slip(t)}
    <article class="check">
      <div class="check-head"><span>Guest check</span><span class="serial">No. ${M.serial(t)}</span></div>
      <div class="boxes">
        <div><small>Dates</small><b>${esc(dayRange(M.span(t)))}</b></div>
        <div><small>Guests</small><b>${M.people(t).length}</b></div>
        <div><small>Expenses</small><b>${n}</b></div>
      </div>
      <div class="lines">
        ${rows || `<p class="blank">Nothing on the tab yet.<br>Add the first thing someone paid for.</p><div class="line ghost"></div><div class="line ghost"></div>`}
      </div>
      <div class="totals">
        <div class="tot"><span>Total spent</span><b>${money(t, spent)}</b></div>
        ${me && led[me] ? `<div class="tot sub"><span>Your share</span><b>${money(t, led[me].share)}</b></div>` : ''}
      </div>
      <div class="perf" aria-hidden="true"></div>
      <a class="stub-link" href="#/t/${t.id}/square">
        <span class="printed">Square up</span>
        <span class="stub-text">${stub}</span>
        <span class="go" aria-hidden="true">→</span>
      </a>
    </article>
    <div class="next-bar">
      <a class="btn" href="#/t/${t.id}/add/items"><span aria-hidden="true">🧾</span> Bill by item</a>
      <a class="btn primary" href="#/t/${t.id}/add">Add an expense</a>
    </div>`;
}

// What came in from a link, on a yellow carbon copy.
function slip(t) {
  const m = t.local.merge;
  if (!m) return '';
  const from = m.from || 'someone';
  const ago = agoWords(m.at);
  if (m.fresh) {
    const ppl = M.people(t);
    return `
      <aside class="carbon" aria-label="From a link">
        <div class="carbon-head"><span>Copy</span><span>From ${esc(m.from || 'a link')} · ${ago}</span></div>
        <p><b>${m.from ? `${esc(m.from)} sent you this tab.` : 'Someone sent you this tab.'}</b> Anything you add stays on this phone until you send the tab back. Which one is you?</p>
        <div class="chips">${ppl.map(p => `<button type="button" class="chip" data-me="${p.id}">${esc(p.name)}</button>`).join('')}
          <button type="button" class="chip quiet" data-act="gotit">I’m not on it</button></div>
        ${m.dropped ? `<p class="small">${plural(m.dropped, 'thing')} in the link didn’t add up and ${m.dropped === 1 ? 'was' : 'were'} left out.</p>` : ''}
      </aside>`;
  }
  const lines = [];
  const byId = Object.fromEntries(t.entries.map(e => [e.id, e]));
  const label = e => (e.kind === 'payment' ? `${who(t, e.from)} paid ${whoLower(t, e.to)}` : e.what || 'Something');
  if (m.renamed) lines.push(['~', `Renamed from “${m.renamed[0] || 'Untitled tab'}”`, '']);
  if (m.currency) lines.push(['~', `Now in ${m.currency[1]}, was ${m.currency[0]}`, '']);
  for (const name of m.people || []) lines.push(['+', `${name} joined the tab`, '']);
  for (const name of m.gone || []) lines.push(['−', `${name} left the tab`, '']);
  for (const c of m.edited || []) lines.push(c.back ? ['+', `${c.now.name} ${several(c.now.name) ? 'are' : 'is'} back on the tab`, ''] : ['~', personWords(c), '']);
  for (const id of m.added || []) { const e = byId[id]; if (e && !e.deleted) lines.push(['+', label(e), money(t, e.amount)]); }
  for (const c of m.changed || []) {
    const e = byId[c.id];
    if (e && !e.deleted) lines.push(['~', label(e), c.was !== e.amount && c.was ? `${money(t, e.amount)}, was ${money(t, c.was)}` : `${money(t, e.amount)}, edited`]);
  }
  for (const r of m.removed || []) lines.push(['−', `${r.kind === 'payment' ? `${who(t, r.from)} paid ${whoLower(t, r.to)}` : r.what || 'Something'}`, r.amount ? money(t, r.amount) : '', 'gone']);
  return `
    <aside class="carbon" aria-label="What came in from the link">
      <div class="carbon-head"><span>Copy</span><span>From ${esc(from)}’s link · ${ago}</span></div>
      ${m.nothing ? `<p><b>Nothing new.</b> You already had everything in ${esc(from)}’s link.</p>` : `
        <ul class="changes">${lines.map(([sign, text, amt, cls]) => `<li${cls ? ` class="${cls}"` : ''}><b aria-hidden="true">${sign}</b><span>${esc(text)}${cls ? '<i class="vh">, deleted</i>' : ''}</span><span class="amt">${esc(amt)}</span></li>`).join('')}</ul>`}
      ${m.ours ? `<p>Your copy has ${plural(m.ours, 'change')} ${esc(from)}’s didn’t. Send yours back so you both have everything.</p>` : ''}
      ${m.dropped ? `<p class="small">${plural(m.dropped, 'thing')} in the link didn’t add up and ${m.dropped === 1 ? 'was' : 'were'} left out.</p>` : ''}
      <div class="row">${m.ours ? '<button type="button" class="btn small" data-act="send">Send it back</button>' : ''}<button type="button" class="btn small" data-act="gotit">Got it</button></div>
    </aside>`;
}

// One line for someone whose details came in changed, by the name this phone had for them:
// "Sam is now Samuel", "Sam added Venmo", "Jo & Priya now count as 2", or several of those in one line.
function personWords({ was, now }) {
  const many = several(was.name);
  const apps = test => listWords(APPS.filter(a => test(was.pay?.[a.key], now.pay?.[a.key])).map(a => a.label));
  const added = apps((a, b) => !a && b), renewed = apps((a, b) => a && b && a !== b), dropped = apps((a, b) => a && !b);
  const bits = [];
  if (now.name !== was.name) bits.push(`${many ? 'are' : 'is'} now ${now.name}`);
  if (added) bits.push(`added ${added}`);
  if (renewed) bits.push(`${many ? 'have' : 'has'} a new ${renewed}`);
  if (dropped) bits.push(`removed ${dropped}`);
  if (now.weight !== was.weight) bits.push(`${bits.length ? '' : 'now '}${many ? 'count' : 'counts'} as ${now.weight / 100}`);
  return `${was.name} ${listWords(bits)}`;
}

function agoWords(at) {
  const s = Math.round((Date.now() - at) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return plural(Math.round(s / 3600), 'hour') + ' ago';
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ---------- Squaring up ----------

function squareSection(t, bal, plan) {
  const ppl = M.people(t);
  const { rows } = M.ledger(t);
  const top = Math.max(1, ...Object.values(bal).map(Math.abs));
  const me = t.local.me;
  const standing = ppl.map(p => {
    const v = bal[p.id] || 0;
    const w = Math.max(v ? 3 : 0, Math.round((Math.abs(v) / top) * 100));
    const many = several(p.name);
    const words = v > 0 ? (p.id === me ? 'you’re owed' : many ? 'are owed' : 'is owed') : v < 0 ? (p.id === me ? 'you owe' : many ? 'owe' : 'owes') : 'square';
    return `
      <li class="${v > 0 ? 'up' : v < 0 ? 'down' : 'even'}">
        <span class="nm">${esc(p.name)}${p.id === me ? ' <small>(you)</small>' : ''}</span>
        <span class="meter" aria-hidden="true"><i style="--w:${w}%"></i></span>
        <span class="v"><small>${words}</small> <b>${v > 0 ? '+' : v < 0 ? '−' : ''}${money(t, Math.abs(v))}</b></span>
      </li>`;
  }).join('');

  const note = `Square Up: ${t.name || 'tab'}`;
  const tickets = plan.payments.map((p, i) => {
    const links = !me || me === p.from ? payLinks(t.people.find(x => x.id === p.to), p.amount, t.currency, note) : [];
    return `
      <li class="ticket">
        <div class="tk-who"><b>${esc(who(t, p.from))}</b> ${p.from === me || several(M.personName(t, p.from)) ? 'pay' : 'pays'} <b>${esc(whoLower(t, p.to))}</b></div>
        <div class="tk-amt">${money(t, p.amount)}</div>
        <div class="tk-acts">
          <button type="button" class="btn small primary" data-rec="${i}">Record it</button>
          ${links.map(l => `<a class="btn small" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)} <span aria-hidden="true">↗</span></a>`).join('')}
        </div>
      </li>`;
  }).join('');
  const n = plan.payments.length;
  const paid = M.sorted(M.payments(t));
  const hasExpenses = M.expenses(t).length > 0;

  return `
    <article class="check">
      <div class="check-head"><span>Who’s up, who’s down</span></div>
      ${hasExpenses ? `<ul class="standing">${standing}</ul>` : '<p class="blank">Nothing to square up yet. Add some expenses first.</p>'}
    </article>

    <article class="check">
      <div class="check-head"><span>${n ? 'Payments that settle it' : 'Settled'}</span></div>
      ${n ? `
        <p class="lede">${n === 1 ? 'One payment squares everyone up.' : `${plural(n, 'payment')} square everyone up.`} ${plan.fewest && n > 1 ? 'That’s the fewest it can be done in.' : ''}</p>
        <ul class="tickets">${tickets}</ul>
        <p class="hint">Paid part of it, or paid someone else? <button type="button" class="link-btn" data-act="pay">Record a different payment</button>. The plan works out again from what’s left.</p>`
    : hasExpenses ? `
        <div class="squared"><span class="stamp big">Square</span><p>Everyone is square. Nobody owes anybody.</p>
        ${t.local.archived ? '' : '<button type="button" class="btn" data-act="archive">Archive this tab</button>'}</div>`
      : '<p class="blank">When there’s something on the tab, the payments that settle it go here.</p>'}
    </article>

    ${paid.length ? `
    <article class="check">
      <div class="check-head"><span>Paid back so far</span></div>
      <div class="lines">${paid.map(e => line(t, e, {}).replace('</small>', ` · ${esc(day(e.date))}</small>`)).join('')}</div>
    </article>` : ''}

    ${hasExpenses ? `
    <article class="check">
      <div class="check-head"><span>Everyone’s totals</span></div>
      <div class="ledger" role="table" aria-label="Everyone’s totals">
        <div class="lr head" role="row"><span role="columnheader">Name</span><span role="columnheader">Paid</span><span role="columnheader">Share</span><span role="columnheader">Up / down</span></div>
        ${ppl.map(p => {
    const r = rows[p.id];
    return `<div class="lr" role="row"><span role="cell">${esc(p.name)}</span><span role="cell">${money(t, r.paid)}</span><span role="cell">${money(t, r.share)}</span><span role="cell" class="${r.net > 0 ? 'up' : r.net < 0 ? 'down' : ''}">${r.net > 0 ? '+' : r.net < 0 ? '−' : ''}${money(t, Math.abs(r.net))}</span></div>`;
  }).join('')}
      </div>
      <p class="hint">Up / down is what someone paid, less their share, plus what they’ve paid back, less what they’ve been paid.</p>
    </article>` : ''}`;
}

// ---------- People ----------

function peopleSection(t) {
  const ppl = M.people(t);
  const me = t.local.me;
  const hasMoney = M.live(t).length > 0;
  const lockCurrency = hasMoney;
  return `
    <article class="check">
      <div class="check-head"><span>Guests</span><span class="serial">${ppl.length}</span></div>
      <ul class="people">${ppl.map(p => {
    const used = M.usedBy(t, p.id).length;
    const handles = APPS.filter(a => p.pay?.[a.key]).map(a => a.label);
    return `
        <li class="person" data-person="${p.id}">
          <div class="p-top">
            <input class="input p-name" data-name="${p.id}" value="${esc(p.name)}" maxlength="40" aria-label="Name">
            <label class="me-pick"><input type="radio" name="me" value="${p.id}"${p.id === me ? ' checked' : ''}> This is me</label>
          </div>
          <details>
            <summary>Counts as ${p.weight / 100}${handles.length ? ` · ${esc(handles.join(', '))}` : ' · no payment apps'}</summary>
            <div class="p-more">
              <div class="p-row"><span>Counts as</span>
                <span class="stepper"><button type="button" data-weight="${p.id}" data-by="-50" aria-label="Fewer">−</button><b>${p.weight / 100}</b><button type="button" data-weight="${p.id}" data-by="50" aria-label="More">+</button></span></div>
              <p class="hint">When an expense is split by shares. A couple sharing a room counts as 2.</p>
              ${APPS.map(a => `
                <label class="p-row handle"><span>${a.label}</span><span class="pre"><i>${esc(a.prefix)}</i><input class="input" data-handle="${a.key}" data-pid="${p.id}" value="${esc(p.pay?.[a.key] || '')}" placeholder="${a.hint}" autocomplete="off" autocapitalize="none" spellcheck="false"></span></label>`).join('')}
              <p class="hint">Optional. With these, squaring up shows a button that opens the app with the amount filled in.${t.currency !== 'USD' ? ` Venmo only takes US dollars${t.currency === 'GBP' ? '' : ', and Cash App dollars and pounds'}.` : ''}</p>
              <button type="button" class="link-btn danger" data-remove="${p.id}"${used ? ` disabled title="On ${plural(used, 'thing')}"` : ''}>Remove ${esc(p.name)}</button>
              ${used ? `<p class="hint">${esc(p.name)} is on ${plural(used, 'thing')} on the tab, so can’t be removed.</p>` : ''}
            </div>
          </details>
        </li>`;
  }).join('')}
      </ul>
      <form class="add-person" data-form="add"><input class="input" id="newPerson" maxlength="40" placeholder="Add someone" aria-label="New person’s name"><button type="submit" class="btn">Add</button></form>
    </article>

    <article class="check">
      <div class="check-head"><span>The tab</span><span class="serial">No. ${M.serial(t)}</span></div>
      <label class="field"><span>Name</span><input class="input" id="tabName" value="${esc(t.name)}" maxlength="80" placeholder="Untitled tab"></label>
      <label class="field"><span>Currency</span>
        <select class="input" id="currency">${Object.keys(CURRENCIES).filter(c => !lockCurrency || digits(c) === digits(t.currency)).map(c => `<option value="${c}"${c === t.currency ? ' selected' : ''}>${c} ${esc(symbol(c) === c ? '' : symbol(c))}</option>`).join('')}</select></label>
      ${lockCurrency ? `<p class="hint">Changing it keeps the amounts as they are and changes the sign in front. Once there are amounts on the tab, only currencies ${digits(t.currency) ? 'with cents' : 'without cents'} are listed.</p>` : ''}
      <div class="tab-acts">
        <button type="button" class="btn" data-act="archive">${t.local.archived ? 'Take out of the archive' : 'Archive this tab'}</button>
        ${canSave() && hasMoney ? '<button type="button" class="btn" data-act="csv">Save as a spreadsheet</button>' : ''}
        <button type="button" class="btn danger" data-act="delete">Delete this tab</button>
      </div>
      <p class="hint">Archiving and deleting only change this phone. Anyone else with the tab keeps their copy.</p>
    </article>`;
}

// ---------- Handlers ----------

function handlers(t, section, plan) {
  const save = () => store.put(t);
  return {
    click(e) {
      const b = e.target.closest('button, a');
      if (!b) return;
      const d = b.dataset;
      if (d.act === 'send') return sendSheet(t);
      if (d.act === 'gotit') { delete t.local.merge; save(); return redraw(t, section); }
      if (d.me) { t.local.me = d.me; delete t.local.merge; save(); toast(`Got it: you’re ${M.personName(t, d.me)}`); return redraw(t, section); }
      if (d.pay) return paymentSheet(t, M.live(t).find(x => x.id === d.pay), section);
      if (d.rec !== undefined) return paymentSheet(t, null, section, plan.payments[Number(d.rec)]);
      if (d.act === 'pay') return paymentSheet(t, null, section);
      if (d.act === 'archive') {
        t.local.archived = !t.local.archived;
        save();
        toast(t.local.archived ? 'Archived. It’s under Archived on the list of tabs.' : 'Back on the list of tabs');
        return redraw(t, section);
      }
      if (d.act === 'csv') return download(`${(t.name || 'tab').replace(/[^\w -]+/g, '').trim() || 'tab'}.csv`, csv(t), 'text/csv');
      if (d.act === 'delete') return deleteSheet(t);
      if (d.weight) {
        const p = t.people.find(x => x.id === d.weight);
        p.weight = Math.min(2000, Math.max(50, p.weight + Number(d.by)));
        M.touch(p);
        save();
        const li = b.closest('.person');
        li.querySelector('.stepper b').textContent = p.weight / 100;
        li.querySelector('summary').firstChild.textContent = `Counts as ${p.weight / 100}`;
        return;
      }
      if (d.remove) {
        const p = t.people.find(x => x.id === d.remove);
        if (M.usedBy(t, p.id).length) return;
        Object.assign(p, { deleted: true, pay: {} });
        M.touch(p);
        if (t.local.me === p.id) delete t.local.me;
        save();
        redraw(t, section);
        toast(`Removed ${p.name}`, { label: 'Undo', run: () => { delete p.deleted; M.touch(p); save(); redraw(t, section); } });
      }
    },
    change(e) {
      const el = e.target;
      if (el.name === 'me') { t.local.me = el.value; save(); toast(`This phone is ${M.personName(t, el.value)}’s`); return; }
      if (el.dataset.name) {
        const p = t.people.find(x => x.id === el.dataset.name);
        const v = el.value.trim().slice(0, 40);
        if (!v) { el.value = p.name; return; }
        if (v !== p.name) { p.name = v; M.touch(p); save(); }
        return;
      }
      if (el.dataset.handle) {
        const p = t.people.find(x => x.id === el.dataset.pid);
        const v = el.value.trim() ? cleanHandle(el.dataset.handle, el.value) : '';
        if (el.value.trim() && !v) { toast('That doesn’t look like a name the app would use.'); el.value = p.pay?.[el.dataset.handle] || ''; return; }
        p.pay = { ...p.pay };
        if (v) p.pay[el.dataset.handle] = v; else delete p.pay[el.dataset.handle];
        el.value = v;
        M.touch(p);
        save();
        const handles = APPS.filter(a => p.pay[a.key]).map(a => a.label);
        el.closest('.person').querySelector('summary').textContent = `Counts as ${p.weight / 100}${handles.length ? ` · ${handles.join(', ')}` : ' · no payment apps'}`;
        return;
      }
      if (el.id === 'tabName') {
        const v = el.value.trim().slice(0, 80);
        if (v !== t.name) { t.name = v; M.touch(t); save(); document.querySelector('.tabhead h1').textContent = v || 'Untitled tab'; }
        return;
      }
      if (el.id === 'currency') {
        if (el.value !== t.currency) { t.currency = el.value; M.touch(t); save(); redraw(t, section); toast(`Now in ${t.currency}`); }
      }
    },
    keydown(e) {
      if (e.key === 'Enter' && e.target.id === 'newPerson') { e.preventDefault(); addPersonFrom(t, section); }
    },
  };
}

function addPersonFrom(t, section) {
  const input = document.getElementById('newPerson');
  const name = input.value.trim();
  if (!name) return input.focus();
  M.addPerson(t, name);
  store.put(t);
  redraw(t, section);
  document.getElementById('newPerson').focus();
  toast(`Added ${name}`);
}
document.addEventListener('submit', e => {
  if (e.target.dataset?.form !== 'add') return;
  e.preventDefault();
  const id = location.hash.split('/')[2];
  const t = store.get(id);
  if (t) addPersonFrom(t, 'people');
});

// ---------- Sheets ----------

function sendSheet(t) {
  const ppl = M.people(t);
  const canShare = typeof navigator.share === 'function';
  sheet(`
    <h2>Send the tab</h2>
    <p>This link carries the whole tab. Whoever opens it gets their own copy to add to, and can send a link back. Opening one here brings in what’s new and keeps anything you added in the meantime.</p>
    <label class="field"><span>Sent by</span>
      <select class="input" id="sheetFrom"><option value="">Don’t say</option>${ppl.map(p => `<option value="${p.id}"${p.id === t.local.me ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
    <textarea id="sheetLink" readonly aria-label="The link">Making the link…</textarea>
    <p class="small" id="sheetSize"></p>
    <div class="row">
      <button class="btn" value="close">Close</button>
      <button type="button" class="btn${canShare ? '' : ' primary'}" id="sheetCopy">Copy link</button>
      ${canShare ? '<button type="button" class="btn primary" id="sheetShare">Share…</button>' : ''}
    </div>
    <p class="small">Or pass this phone round: anyone can add to the tab here.</p>`, body => {
    const field = body.querySelector('#sheetLink');
    const from = body.querySelector('#sheetFrom');
    const update = async () => {
      field.value = await tabLink(t, from.value);
      body.querySelector('#sheetSize').textContent = `${plural(M.live(t).length, 'thing')} on the tab, in a link ${field.value.length.toLocaleString()} characters long.`;
    };
    update();
    from.addEventListener('change', () => {
      if (from.value) { t.local.me = from.value; store.put(t); }
      update();
    });
    body.querySelector('#sheetCopy').onclick = () => copy(field.value, field);
    const share = body.querySelector('#sheetShare');
    if (share) share.onclick = () => navigator.share({ title: t.name || 'Square Up', text: `${t.name || 'Our tab'} on Square Up`, url: field.value }).catch(() => {});
  });
}

// Record a payment, suggested or not, or change one already recorded.
function paymentSheet(t, existing, section, suggested) {
  const ppl = M.people(t);
  const me = t.local.me;
  const p = existing || {
    from: suggested?.from || (me && ppl.some(x => x.id === me) ? me : ppl[0]?.id),
    to: suggested?.to || ppl.find(x => x.id !== (suggested?.from || me || ppl[0]?.id))?.id,
    amount: suggested?.amount || 0,
    date: M.today(),
  };
  const opts = sel => ppl.map(x => `<option value="${x.id}"${x.id === sel ? ' selected' : ''}>${esc(x.name)}${x.id === me ? ' (you)' : ''}</option>`).join('');
  sheet(`
    <h2>${existing ? 'A payment' : 'Record a payment'}</h2>
    <p>${suggested ? 'Change the amount if they paid part of it.' : 'Money that changed hands between two people on the tab.'}</p>
    <div class="pay-pair">
      <label class="field"><span>Who paid</span><select class="input" id="payFrom">${opts(p.from)}</select></label>
      <span class="arrow" aria-hidden="true">→</span>
      <label class="field"><span>Paid to</span><select class="input" id="payTo">${opts(p.to)}</select></label>
    </div>
    <div class="pay-pair">
      <label class="field"><span>Amount</span><span class="money"><i>${esc(symbol(t.currency))}</i><input class="input" id="payAmount" inputmode="decimal" value="${p.amount ? plain(p.amount, t.currency) : ''}" autocomplete="off"></span></label>
      <label class="field"><span>Date</span><input class="input" type="date" id="payDate" value="${esc(p.date || M.today())}"></label>
    </div>
    <p class="problem" id="payProblem" hidden></p>
    <div class="row">
      ${existing ? '<button type="button" class="btn danger" id="payDelete">Delete</button><span class="grow"></span>' : ''}
      <button class="btn" value="close">Cancel</button>
      <button type="button" class="btn primary" id="payGo">${existing ? 'Save' : 'Record it'}</button>
    </div>`, (body, close) => {
    body.querySelector('#payGo').onclick = () => {
      const e = {
        ...(existing || { id: M.newId(8), added: M.stamp() }),
        kind: 'payment',
        from: body.querySelector('#payFrom').value,
        to: body.querySelector('#payTo').value,
        amount: parse(body.querySelector('#payAmount').value, t.currency) ?? 0,
        date: body.querySelector('#payDate').value || M.today(),
        note: existing?.note || '',
      };
      const problem = M.checkPayment(e, ppl.map(x => x.id));
      if (problem) { const el = body.querySelector('#payProblem'); el.hidden = false; el.textContent = problem; return; }
      const saved = M.putEntry(t, M.tidy(e));
      store.put(t);
      close();
      redraw(t, section);
      toast(`${existing ? 'Saved' : 'Recorded'}: ${who(t, saved.from)} paid ${whoLower(t, saved.to)} ${money(t, saved.amount)}`, existing ? undefined : {
        label: 'Undo', run: () => { M.removeEntry(t, saved.id); store.put(t); redraw(t, section); },
      });
    };
    body.querySelector('#payDelete')?.addEventListener('click', () => {
      const old = M.removeEntry(t, existing.id);
      store.put(t);
      close();
      redraw(t, section);
      toast('Payment deleted', { label: 'Undo', run: () => { M.putEntry(t, old); store.put(t); redraw(t, section); } });
    });
  });
}

function deleteSheet(t) {
  sheet(`
    <h2>Delete “${esc(t.name || 'Untitled tab')}”?</h2>
    <p>It goes from this phone. Anyone you sent it to keeps their copy, and sending it back to you brings it back.</p>
    <div class="row"><button class="btn" value="close">Cancel</button><button type="button" class="btn danger" id="delGo">Delete it</button></div>`, (body, close) => {
    body.querySelector('#delGo').onclick = () => {
      store.remove(t.id);
      close();
      go('/');
      toast(`Deleted “${t.name || 'Untitled tab'}”`, { label: 'Undo', run: () => { store.put(t); go(`/t/${t.id}/people`); } });
    };
  });
}

// ---------- A spreadsheet ----------

function csv(t) {
  const ppl = M.people(t);
  const cell = v => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const amt = v => (v ? plain(v, t.currency) : '');
  const head = ['Date', 'What', 'Category', 'Amount', 'Paid by', 'Split', ...ppl.map(p => `${p.name} share`)];
  const out = [head];
  for (const e of M.sorted(M.live(t)).reverse()) {
    if (e.kind === 'payment') {
      out.push([e.date, `${M.personName(t, e.from)} paid ${M.personName(t, e.to)}`, 'Payment', amt(e.amount), M.personName(t, e.from), '', ...ppl.map(() => '')]);
      continue;
    }
    const s = M.sharesOf(e);
    out.push([e.date, e.what, M.CATEGORY[e.category]?.label || '', amt(e.amount),
      Object.entries(e.paid).map(([id, v]) => `${M.personName(t, id)} ${amt(v)}`).join('; '), e.split.how, ...ppl.map(p => amt(s[p.id] || 0))]);
  }
  const { rows } = M.ledger(t);
  out.push([]);
  out.push(['', 'Up / down', '', '', '', '', ...ppl.map(p => plain(rows[p.id].net, t.currency))]);
  return out.map(r => r.map(cell).join(',')).join('\n') + '\n';
}
