// Adding or changing an expense: what, how much, who paid, and how it splits. Also the bill split
// by item, where each item goes to whoever had it and tax and tip follow, and going round the table
// with one phone so each person taps what they had.
import * as M from './model.js';
import { parse, plain, symbol, parsePercent, percentText, format } from './money.js';
import { store } from './store.js';
import { app, esc, on, go, toast, sheet, closeSheet, money, who, short, plural } from './ui.js';

const HOW_LABELS = [['equal', 'Equally'], ['shares', 'Shares'], ['exact', 'Amounts'], ['percent', 'Percent'], ['items', 'By item']];
const TIPS = [1500, 1800, 2000, 2200];

export function editor(t, existing, startHow = 'equal') {
  const ppl = M.people(t);
  const ids = ppl.map(p => p.id);
  const cur = t.currency;
  const me = ids.includes(t.local.me) ? t.local.me : ids[0];
  const e0 = existing ? structuredClone(existing) : null;
  const s0 = e0?.split;

  // Everything the form holds. Each way of splitting keeps its own numbers, so trying another one loses nothing.
  const st = {
    what: e0?.what || '',
    amountText: e0 && s0.how !== 'items' ? plain(e0.amount, cur) : '',
    date: e0?.date || M.today(),
    category: e0?.category || (startHow === 'items' ? 'food' : ''),
    note: e0?.note || '',
    payer: e0 ? Object.keys(e0.paid)[0] : me,
    several: e0 ? Object.keys(e0.paid).length > 1 : false,
    paidText: Object.fromEntries(Object.entries(e0?.paid || {}).map(([id, v]) => [id, plain(v, cur)])),
    how: s0?.how || startHow,
    incl: new Set(s0 && ['equal', 'shares'].includes(s0.how) ? Object.keys(s0.parts) : ids),
    shares: Object.fromEntries(ppl.map(p => [p.id, s0?.how === 'shares' ? (s0.parts[p.id] || p.weight) : p.weight])),
    exactText: Object.fromEntries(Object.entries(s0?.how === 'exact' ? s0.parts : {}).map(([id, v]) => [id, plain(v, cur)])),
    pctText: Object.fromEntries(Object.entries(s0?.how === 'percent' ? s0.parts : {}).map(([id, v]) => [id, percentText(v)])),
    items: s0?.how === 'items'
      ? s0.items.map(it => ({ id: it.id, name: it.name, amtText: it.amount ? plain(it.amount, cur) : '', who: new Set(it.who) }))
      : [newItem()],
    tax: s0?.tax ? (Number.isInteger(s0.tax.pct) ? { mode: 'pct', text: percentText(s0.tax.pct) } : { mode: 'amount', text: plain(s0.tax.amount, cur) }) : { mode: 'amount', text: '' },
    tip: s0?.how === 'items'
      ? (s0.tip ? (Number.isInteger(s0.tip.pct) ? { mode: 'pct', text: percentText(s0.tip.pct) } : { mode: 'amount', text: plain(s0.tip.amount, cur) }) : { mode: 'pct', text: '' })
      : { mode: 'pct', text: '' },
    otherTip: false,
    tried: false, // what's missing shows in red once they've tried to save
  };
  if (st.how === 'items' && s0?.tip && !(Number.isInteger(s0.tip.pct) && TIPS.includes(s0.tip.pct))) st.otherTip = true;
  if (!st.payer || !ids.includes(st.payer)) st.payer = ids[0];

  function newItem() { return { id: M.newId(6), name: '', amtText: '', who: new Set() }; }

  // ---------- From the form to an expense ----------

  const amt = text => parse(text, cur);
  function extra(x) {
    if (!String(x.text).trim()) return undefined;
    if (x.mode === 'pct') { const v = parsePercent(x.text); return v === null ? { bad: true } : { pct: v }; }
    const v = amt(x.text);
    return v === null || v < 0 ? { bad: true } : { amount: v };
  }

  function build() {
    let split;
    let amount = amt(st.amountText) ?? 0;
    if (st.how === 'items') {
      const items = st.items.map(it => ({ id: it.id, name: it.name.trim(), amount: amt(it.amtText) ?? (it.amtText.trim() ? -1 : 0), who: ids.filter(id => it.who.has(id)) }))
        .filter(it => it.amount !== 0 || it.name || it.who.length);
      const tax = extra(st.tax), tip = extra(st.tip);
      split = { how: 'items', items, tax, tip };
      const bad = items.some(it => it.amount < 0) || tax?.bad || tip?.bad;
      amount = bad ? -1 : M.itemBreakdown({ ...split, items: items.map(it => ({ ...it, who: it.who.length ? it.who : [] })) }, id).total;
      if (bad) split.bad = true;
    } else if (st.how === 'equal') split = { how: 'equal', parts: Object.fromEntries(ids.filter(i => st.incl.has(i)).map(i => [i, 1])) };
    else if (st.how === 'shares') split = { how: 'shares', parts: Object.fromEntries(ids.filter(i => st.incl.has(i)).map(i => [i, st.shares[i]])) };
    else if (st.how === 'exact') split = { how: 'exact', parts: Object.fromEntries(ids.map(i => [i, amt(st.exactText[i] || '') ?? 0])) };
    else split = { how: 'percent', parts: Object.fromEntries(ids.map(i => [i, parsePercent(st.pctText[i] || '') ?? 0])) };
    const paid = st.several
      ? Object.fromEntries(ids.map(i => [i, amt(st.paidText[i] || '') ?? 0]))
      : { [st.payer]: amount };
    return {
      id, kind: 'expense', added: e0?.added || M.stamp(), changed: e0?.changed || 0,
      what: st.what, amount, date: st.date, category: st.category || 'other', note: st.note, paid, split,
    };
  }
  const id = e0?.id || M.newId(8);

  function problem(e) {
    if (st.how === 'items' && e.split.bad) return 'Check the prices, tax and tip.';
    if (st.how !== 'items' && st.amountText.trim() && amt(st.amountText) === null) return 'Check the amount.';
    if (!st.what.trim()) return 'Say what it was for.';
    return M.checkExpense(M.tidy(e), ids);
  }

  // ---------- Drawing ----------

  const chip = (attrs, label, on = false, cls = '') => `<button type="button" class="chip ${cls}" ${attrs} aria-pressed="${on}">${label}</button>`;
  const moneyInput = (key, value, attrs = '', cls = '') => `<span class="money ${cls}"><i>${esc(symbol(cur))}</i><input class="input" data-key="${key}" ${attrs} inputmode="decimal" autocomplete="off" value="${esc(value)}" placeholder="${plain(0, cur)}"></span>`;

  function draw() {
    const items = st.how === 'items';
    const title = existing ? 'Change an expense' : items ? 'Split a bill by item' : 'Add an expense';
    app.innerHTML = `
      <div class="edhead"><a class="back" href="#/t/${t.id}">${esc(t.name || 'Untitled tab')}</a><h1>${title}</h1></div>
      <form class="check form" id="expenseForm" autocomplete="off" novalidate>
        <div class="check-head"><span>${items ? 'By item' : 'Expense'}</span><span class="serial">No. ${M.serial(t)}</span></div>
        <label class="field"><span>What for</span>
          <input class="input" data-key="what" maxlength="80" value="${esc(st.what)}" placeholder="${items ? 'Dinner at…' : 'Groceries, a taxi, the rent'}"></label>
        ${items ? '' : `
        <div class="pair">
          <label class="field grow"><span>Amount</span>${moneyInput('amount', st.amountText, '', 'big')}</label>
          <label class="field"><span>Date</span><input class="input" type="date" data-key="date" value="${esc(st.date)}"></label>
        </div>`}
        ${items ? itemsBlock() : ''}

        <fieldset class="field"><legend>Paid by</legend>
          <div class="chips">
            ${ppl.map(p => chip(`data-payer="${p.id}" data-key="payer-${p.id}"`, esc(p.name) + (p.id === t.local.me ? ' <small>you</small>' : ''), !st.several && st.payer === p.id)).join('')}
            ${chip('data-act="several" data-key="several"', 'Several people', st.several, 'quiet')}
          </div>
          ${st.several ? `
            <ul class="split-rows paid-rows">${ppl.map(p => `
              <li><span class="nm">${esc(p.name)}</span>${moneyInput(`paid-${p.id}`, st.paidText[p.id] || '', `data-paid="${p.id}"`, 'small')}</li>`).join('')}
            </ul>
            <p class="status" id="paidStatus"></p>` : ''}
        </fieldset>

        ${items ? `
        <fieldset class="field"><legend>Each person</legend>
          <ul class="each-list" id="eachList"></ul>
          <div class="seg-switch"><span>Split another way:</span>${HOW_LABELS.filter(([k]) => k !== 'items').map(([k, l]) => `<button type="button" class="link-btn" data-how="${k}">${l}</button>`).join('')}</div>
        </fieldset>` : splitBlock()}

        <fieldset class="field"><legend>Category</legend>
          <div class="chips cats">${M.CATEGORIES.map(([k, icon, label]) => chip(`data-cat="${k}" data-key="cat-${k}"`, `<span aria-hidden="true">${icon}</span> ${esc(label)}`, st.category === k)).join('')}</div>
        </fieldset>
        ${items ? `<label class="field"><span>Date</span><input class="input" type="date" data-key="date" value="${esc(st.date)}"></label>` : ''}
        <label class="field"><span>Note</span><textarea class="input" data-key="note" rows="2" maxlength="300" placeholder="Anything worth remembering">${esc(st.note)}</textarea></label>
      </form>
      <div class="next-bar">
        <p class="note" id="why"></p>
        ${existing ? '<button type="button" class="btn danger" data-act="delete">Delete</button>' : ''}
        <button type="button" class="btn primary" data-act="save">${existing ? 'Save' : 'Add it'}</button>
      </div>`;
    refresh();
  }

  function splitBlock() {
    const rows = ppl.map(p => {
      let control = '';
      const incl = st.incl.has(p.id);
      if (st.how === 'shares') control = `<span class="stepper${incl ? '' : ' off'}"><button type="button" data-step="${p.id}" data-by="-50" data-key="sm-${p.id}" aria-label="Fewer shares for ${esc(p.name)}">−</button><b>${st.shares[p.id] / 100}</b><button type="button" data-step="${p.id}" data-by="50" data-key="sp-${p.id}" aria-label="More shares for ${esc(p.name)}">+</button></span>`;
      if (st.how === 'exact') control = moneyInput(`ex-${p.id}`, st.exactText[p.id] || '', `data-exact="${p.id}" aria-label="${esc(p.name)}’s amount"`, 'small');
      if (st.how === 'percent') control = `<span class="money small pct"><input class="input" data-key="pc-${p.id}" data-pct="${p.id}" inputmode="decimal" autocomplete="off" value="${esc(st.pctText[p.id] || '')}" placeholder="0" aria-label="${esc(p.name)}’s percent"><i>%</i></span>`;
      const tick = ['equal', 'shares'].includes(st.how)
        ? `<button type="button" class="tick" data-incl="${p.id}" data-key="in-${p.id}" aria-pressed="${incl}" aria-label="${esc(p.name)} is in"><span aria-hidden="true">✓</span></button>` : '';
      return `<li class="${tick && !incl ? 'out' : ''}">${tick}<span class="nm">${esc(p.name)}</span>${control}<output class="each" data-each="${p.id}"></output></li>`;
    }).join('');
    return `
      <fieldset class="field"><legend>Split</legend>
        <div class="seg" role="group" aria-label="How to split it">${HOW_LABELS.map(([k, l]) => `<button type="button" data-how="${k}" data-key="how-${k}" aria-pressed="${st.how === k}">${l}</button>`).join('')}</div>
        <p class="hint">${{
    equal: 'The same for everyone ticked.',
    shares: 'In proportion to shares: someone with 2 pays twice as much as someone with 1.',
    exact: 'Type what each person’s part came to.',
    percent: 'A percent for each person, adding up to 100.',
  }[st.how]}</p>
        <ul class="split-rows">${rows}</ul>
        <p class="status" id="splitStatus"></p>
      </fieldset>`;
  }

  function itemsBlock() {
    const tipPreset = st.tip.mode === 'pct' && !st.otherTip ? parsePercent(st.tip.text) : null;
    return `
      <fieldset class="field items-field"><legend>What was on the bill</legend>
        <ol class="items">${st.items.map((it, i) => `
          <li class="item" data-item="${it.id}">
            <div class="item-top">
              <input class="input iname" data-key="in-${it.id}" data-iname="${it.id}" maxlength="60" value="${esc(it.name)}" placeholder="Item ${i + 1}" aria-label="Item ${i + 1}" enterkeyhint="next">
              ${moneyInput(`ia-${it.id}`, it.amtText, `data-iamt="${it.id}" aria-label="Price of item ${i + 1}" enterkeyhint="next"`, 'small')}
              <button type="button" class="x" data-idrop="${it.id}" aria-label="Take off item ${i + 1}">✕</button>
            </div>
            <div class="who">
              ${ppl.map(p => chip(`data-iwho="${it.id}" data-pid="${p.id}" data-key="iw-${it.id}-${p.id}"`, esc(short(p.name)), it.who.has(p.id), 'mini')).join('')}
              ${chip(`data-iall="${it.id}" data-key="ial-${it.id}" aria-label="Everyone had it"`, 'All', ids.every(x => it.who.has(x)), 'mini quiet')}
              <output class="each" data-ieach="${it.id}"></output>
            </div>
          </li>`).join('')}
        </ol>
        <button type="button" class="add" data-act="additem" data-key="additem">Add an item</button>
        <button type="button" class="btn wide round-btn" data-act="round"><span aria-hidden="true">↻</span> Go round the table</button>
        <p class="hint">Type the items in, then pass the phone round and each person taps what they had.</p>
      </fieldset>
      <fieldset class="field extras"><legend>Tax and tip</legend>
        <div class="ex-row"><span>Items</span><output id="subtotal"></output></div>
        <div class="ex-row">
          <span>Tax</span>
          ${st.tax.mode === 'pct'
    ? `<span class="money small pct"><input class="input" data-key="tax" data-extra="tax" inputmode="decimal" value="${esc(st.tax.text)}" placeholder="0" aria-label="Tax"><i>%</i></span>`
    : moneyInput('tax', st.tax.text, 'data-extra="tax" aria-label="Tax"', 'small')}
          <span class="unit">${chip('data-unit="tax" data-mode="amount" data-key="tu-a"', esc(symbol(cur)), st.tax.mode === 'amount', 'mini')}${chip('data-unit="tax" data-mode="pct" data-key="tu-p"', '%', st.tax.mode === 'pct', 'mini')}</span>
        </div>
        <div class="ex-row tip">
          <span>Tip</span>
          <span class="chips">
            ${chip('data-tip="none" data-key="tip-none"', 'None', !st.otherTip && !String(st.tip.text).trim(), 'mini')}
            ${TIPS.map(v => chip(`data-tip="${v}" data-key="tip-${v}"`, `${v / 100}%`, tipPreset === v, 'mini')).join('')}
            ${chip('data-tip="other" data-key="tip-other"', 'Other', st.otherTip, 'mini')}
          </span>
        </div>
        ${st.otherTip ? `
        <div class="ex-row">
          <span></span>
          ${st.tip.mode === 'pct'
    ? `<span class="money small pct"><input class="input" data-key="tipv" data-extra="tip" inputmode="decimal" value="${esc(st.tip.text)}" placeholder="0" aria-label="Tip"><i>%</i></span>`
    : moneyInput('tipv', st.tip.text, 'data-extra="tip" aria-label="Tip"', 'small')}
          <span class="unit">${chip('data-unit="tip" data-mode="amount" data-key="pu-a"', esc(symbol(cur)), st.tip.mode === 'amount', 'mini')}${chip('data-unit="tip" data-mode="pct" data-key="pu-p"', '%', st.tip.mode === 'pct', 'mini')}</span>
        </div>` : ''}
        <div class="ex-row total"><span>Total</span><output id="itemsTotal"></output></div>
        <p class="hint">Tip is worked out on the items before tax. Tax and tip are shared out in proportion to what each person had.</p>
      </fieldset>`;
  }

  // Updates the sums without redrawing, so typing isn't interrupted.
  function refresh() {
    const e = build();
    const why = problem(e);
    // Exact shares as soon as the split itself adds up, whatever else is still missing.
    let shares = null;
    try {
      const probe = M.tidy({ ...e, what: e.what || '-', paid: { [ids[0]]: e.amount } });
      if (e.amount > 0 && !M.checkExpense(probe, ids)) shares = M.sharesOf(probe);
    } catch { shares = null; }
    const $ = sel => app.querySelector(sel);
    const each = (pid, text) => { const o = app.querySelector(`[data-each="${pid}"]`); if (o) o.textContent = text; };
    const amountKnown = e.amount > 0;

    if (st.how === 'items') {
      const b = e.split.bad ? null : M.itemBreakdown({ ...e.split, items: e.split.items }, id);
      $('#subtotal').textContent = b ? money(t, b.subtotal) : '—';
      $('#itemsTotal').textContent = b ? money(t, b.total) : '—';
      for (const it of st.items) {
        const out = app.querySelector(`[data-ieach="${it.id}"]`);
        const v = amt(it.amtText);
        const n = it.who.size;
        if (out) out.textContent = v && n > 1 ? `${money(t, Math.round(v / n))} each` : '';
      }
      const list = $('#eachList');
      if (list) {
        list.innerHTML = b ? ppl.filter(p => b.each[p.id]).map(p => {
          const x = b.each[p.id];
          return `<li><span class="nm">${esc(p.name)}</span><small>${money(t, x.items)}${x.extra ? ` + ${money(t, x.extra)} tax and tip` : ''}</small><b>${money(t, x.total)}</b></li>`;
        }).join('') || '<li class="empty">Say who had each item and the totals show up here.</li>' : '<li class="empty">Check the prices, tax and tip.</li>';
        const nobody = st.items.filter(it => amt(it.amtText) > 0 && !it.who.size).length;
        if (b && nobody) list.insertAdjacentHTML('beforeend', `<li class="empty">${plural(nobody, 'item')} with nobody on ${nobody === 1 ? 'it' : 'them'} yet.</li>`);
      }
    } else {
      for (const p of ppl) {
        if (shares) each(p.id, shares[p.id] ? money(t, shares[p.id]) : '');
        else if (st.how === 'exact') each(p.id, '');
        else if (st.how === 'percent') {
          const pc = parsePercent(st.pctText[p.id] || '');
          each(p.id, pc && amountKnown ? `≈ ${money(t, Math.round(e.amount * pc / 10000))}` : '');
        } else if (amountKnown && st.incl.has(p.id)) {
          const total = ids.filter(i => st.incl.has(i)).reduce((s, i) => s + (st.how === 'shares' ? st.shares[i] : 1), 0);
          each(p.id, `≈ ${money(t, Math.round(e.amount * (st.how === 'shares' ? st.shares[p.id] : 1) / total))}`);
        } else each(p.id, '');
      }
      const status = $('#splitStatus');
      if (status) {
        let text = '';
        if (st.how === 'exact') {
          const sum = ids.reduce((s, i) => s + (amt(st.exactText[i] || '') ?? 0), 0);
          const left = e.amount - sum;
          text = !amountKnown ? '' : left > 0 ? `${money(t, left)} still to split` : left < 0 ? `${money(t, -left)} more than the total` : 'Adds up to the total';
          status.dataset.ok = amountKnown && !left;
        } else if (st.how === 'percent') {
          const sum = ids.reduce((s, i) => s + (parsePercent(st.pctText[i] || '') ?? 0), 0);
          text = `Adds up to ${percentText(sum)}%${sum === 10000 ? '' : ', needs to be 100%'}`;
          status.dataset.ok = sum === 10000;
        } else {
          const n = st.incl.size;
          text = !n ? 'Tick who it’s for.' : n === ppl.length ? `Split between everyone` : `Split between ${plural(n, 'person', 'people')}`;
          status.dataset.ok = n > 0;
        }
        status.textContent = text;
      }
    }
    const ps = $('#paidStatus');
    if (ps) {
      const sum = ids.reduce((s, i) => s + (amt(st.paidText[i] || '') ?? 0), 0);
      const left = e.amount - sum;
      ps.textContent = e.amount <= 0 ? `Paid so far: ${money(t, sum)}` : left > 0 ? `${money(t, left)} still to account for` : left < 0 ? `${money(t, -left)} more than the total` : 'Adds up to the total';
      ps.dataset.ok = e.amount > 0 && !left;
    }
    const whyEl = $('#why');
    whyEl.textContent = why || (e.amount > 0 ? `${money(t, e.amount)}, ${Object.keys(M.tidy(e).paid).length > 1 ? 'paid by several people' : `paid by ${who(t, st.payer, 'you')}`}` : '');
    whyEl.dataset.ok = !why;
    whyEl.dataset.soft = !st.tried;
    const saveBtn = app.querySelector('[data-act="save"]');
    saveBtn.setAttribute('aria-disabled', String(!!why));
  }

  // Redraws after a tap that changes the form's shape, keeping focus and the cursor where they were.
  function redrawKeepingFocus(focusKey) {
    const a = document.activeElement;
    const key = focusKey || a?.dataset?.key;
    const pos = a && 'selectionStart' in a ? [a.selectionStart, a.selectionEnd] : null;
    draw();
    const el = key && app.querySelector(`[data-key="${key}"]`);
    if (el) {
      el.focus({ preventScroll: true });
      if (pos && !focusKey && el.setSelectionRange && el.type !== 'date') try { el.setSelectionRange(...pos); } catch { /* not a text field */ }
    }
  }

  function save() {
    const e = build();
    const why = problem(e);
    if (why) {
      st.tried = true;
      refresh();
      toast(why);
      return;
    }
    const clean = M.tidy(e);
    M.putEntry(t, clean);
    store.put(t);
    go(`/t/${t.id}`);
    toast(existing ? `Saved ${clean.what}` : `Added ${clean.what}, ${format(clean.amount, cur)}`);
  }

  function addItem() {
    const it = newItem();
    st.items.push(it);
    redrawKeepingFocus(`in-${it.id}`);
  }

  // ---------- Going round the table ----------

  function goRound(start = 0) {
    const real = st.items.filter(it => it.name.trim() || amt(it.amtText));
    if (!real.length) { toast('Add the items first.'); return; }
    let at = start;
    // Each tap redraws the form, the button that opened the round with it, so however the round ends
    // (Done, Stop, Esc, a phone's back gesture) focus goes back to the new one. Not once the page has moved on.
    const here = location.hash;
    document.getElementById('sheet').addEventListener('close', () => {
      if (location.hash === here) app.querySelector('[data-act="round"]')?.focus({ preventScroll: true });
    }, { once: true });
    const drawRound = () => {
      const p = ppl[at];
      sheet(`
        <p class="kicker">${at + 1} of ${ppl.length}</p>
        <h2>${esc(p.name)}, tap what you had</h2>
        <p>Tap anything you shared too. Then pass the phone on.</p>
        <ul class="round-items">${real.map(it => {
    const others = ids.filter(x => x !== p.id && it.who.has(x)).map(x => short(M.personName(t, x)));
    const v = amt(it.amtText);
    return `<li><button type="button" class="round-item" data-rt="${it.id}" aria-pressed="${it.who.has(p.id)}">
            <span class="tick" aria-hidden="true">✓</span>
            <span class="nm">${esc(it.name.trim() || `Item ${st.items.indexOf(it) + 1}`)}${others.length ? `<small>with ${esc(others.join(', '))}</small>` : ''}</span>
            <span class="amt">${v ? money(t, v) : ''}</span></button></li>`;
  }).join('')}
        </ul>
        <div class="row">
          <button type="button" class="btn" id="rtBack">${at ? 'Back' : 'Stop'}</button>
          <span class="grow"></span>
          <button type="button" class="btn primary" id="rtNext">${at < ppl.length - 1 ? `Next: ${esc(short(ppl[at + 1].name))}` : 'Done'}</button>
        </div>`, (body, close) => {
        body.querySelectorAll('[data-rt]').forEach(b => {
          b.onclick = () => {
            const it = st.items.find(x => x.id === b.dataset.rt);
            if (it.who.has(p.id)) it.who.delete(p.id); else it.who.add(p.id);
            b.setAttribute('aria-pressed', it.who.has(p.id));
            draw(); // the form behind keeps up, so it's right however the sheet is closed (Esc, a phone's back gesture)
          };
        });
        body.querySelector('#rtBack').onclick = () => { if (at) { at--; drawRound(); } else { close(); draw(); } };
        body.querySelector('#rtNext').onclick = () => {
          if (at < ppl.length - 1) { at++; drawRound(); body.scrollTop = 0; return; }
          close();
          draw();
          const nobody = real.filter(it => amt(it.amtText) > 0 && !it.who.size);
          toast(nobody.length ? `${plural(nobody.length, 'item')} still with nobody on ${nobody.length === 1 ? 'it' : 'them'}` : 'Everyone’s done');
        };
      }, 'round');
    };
    drawRound();
  }

  // ---------- Handling taps and typing ----------

  on({
    input(ev) {
      const el = ev.target, k = el.dataset.key || '';
      if (k === 'what') st.what = el.value;
      else if (k === 'amount') st.amountText = el.value;
      else if (k === 'date') st.date = el.value;
      else if (k === 'note') st.note = el.value;
      else if (el.dataset.paid) st.paidText[el.dataset.paid] = el.value;
      else if (el.dataset.exact) st.exactText[el.dataset.exact] = el.value;
      else if (el.dataset.pct) st.pctText[el.dataset.pct] = el.value;
      else if (el.dataset.iname) st.items.find(x => x.id === el.dataset.iname).name = el.value;
      else if (el.dataset.iamt) st.items.find(x => x.id === el.dataset.iamt).amtText = el.value;
      else if (el.dataset.extra) st[el.dataset.extra].text = el.value;
      else return;
      refresh();
    },
    keydown(ev) {
      if (ev.key !== 'Enter' || ev.target.tagName === 'TEXTAREA') return;
      const el = ev.target;
      ev.preventDefault();
      // At the table: name, price, name, price... Enter on the last price starts the next item.
      if (el.dataset.iname) return app.querySelector(`[data-iamt="${el.dataset.iname}"]`)?.focus();
      if (el.dataset.iamt) {
        const i = st.items.findIndex(x => x.id === el.dataset.iamt);
        if (i === st.items.length - 1) return addItem();
        return app.querySelector(`[data-iname="${st.items[i + 1].id}"]`)?.focus();
      }
      if (el.dataset.key === 'what' && st.how !== 'items') return app.querySelector('[data-key="amount"]')?.focus();
      if (el.dataset.key === 'what' && st.how === 'items') return app.querySelector('[data-iname]')?.focus();
      el.blur();
    },
    focusout(ev) {
      // Tidy a typed amount once you leave it: "12,5" becomes "12.50", "6+4" becomes "10.00".
      const el = ev.target;
      if (!el.closest?.('.money') || el.closest('.pct')) return;
      const v = amt(el.value);
      if (v !== null && v >= 0 && el.value.trim()) {
        el.value = plain(v, cur);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    },
    click(ev) {
      const b = ev.target.closest('button');
      if (!b) return;
      const d = b.dataset;
      if (d.act === 'save') return save();
      if (d.act === 'delete') {
        const old = M.removeEntry(t, existing.id);
        store.put(t);
        go(`/t/${t.id}`);
        return toast(`Deleted ${old.what || 'it'}`, { label: 'Undo', run: () => { const x = store.get(t.id); M.putEntry(x, old); store.put(x); location.hash === `#/t/${t.id}` ? dispatchEvent(new HashChangeEvent('hashchange')) : go(`/t/${t.id}`); } });
      }
      if (d.payer) { st.payer = d.payer; st.several = false; return redrawKeepingFocus(); }
      if (d.act === 'several') {
        st.several = !st.several;
        if (st.several && !Object.values(st.paidText).some(v => amt(v))) {
          const e = build();
          st.paidText = e.amount > 0 ? { [st.payer]: plain(e.amount, cur) } : {};
        }
        if (!st.several) st.payer = ids.find(i => amt(st.paidText[i] || '') > 0) || st.payer;
        return redrawKeepingFocus();
      }
      if (d.how) {
        if (d.how === 'items' && st.how !== 'items') {
          // Start the bill from what's there: one item for the whole amount, shared by whoever it was for.
          const a = st.amountText;
          const whoNow = st.how === 'equal' || st.how === 'shares' ? new Set(st.incl) : new Set();
          if (a && st.items.length === 1 && !st.items[0].amtText) Object.assign(st.items[0], { amtText: a, who: whoNow });
        }
        if (st.how === 'items' && d.how !== 'items') {
          const e = build();
          if (e.amount > 0) st.amountText = plain(e.amount, cur);
        }
        st.how = d.how;
        return redrawKeepingFocus();
      }
      if (d.incl) { st.incl.has(d.incl) ? st.incl.delete(d.incl) : st.incl.add(d.incl); return redrawKeepingFocus(); }
      if (d.step) {
        st.shares[d.step] = Math.min(10000, Math.max(50, st.shares[d.step] + Number(d.by)));
        st.incl.add(d.step);
        return redrawKeepingFocus();
      }
      if (d.cat) { st.category = st.category === d.cat ? '' : d.cat; return redrawKeepingFocus(); }
      if (d.act === 'additem') return addItem();
      if (d.idrop) {
        st.items = st.items.filter(x => x.id !== d.idrop);
        if (!st.items.length) st.items.push(newItem());
        return redrawKeepingFocus();
      }
      if (d.iwho) {
        const it = st.items.find(x => x.id === d.iwho);
        it.who.has(d.pid) ? it.who.delete(d.pid) : it.who.add(d.pid);
        return redrawKeepingFocus();
      }
      if (d.iall) {
        const it = st.items.find(x => x.id === d.iall);
        it.who = ids.every(x => it.who.has(x)) ? new Set() : new Set(ids);
        return redrawKeepingFocus();
      }
      if (d.unit) {
        st[d.unit].mode = d.mode;
        st[d.unit].text = '';
        return redrawKeepingFocus(d.unit === 'tax' ? 'tax' : 'tipv');
      }
      if (d.tip) {
        if (d.tip === 'none') { st.otherTip = false; st.tip = { mode: 'pct', text: '' }; }
        else if (d.tip === 'other') { st.otherTip = true; st.tip = { mode: 'pct', text: st.tip.mode === 'pct' ? st.tip.text : '' }; return redrawKeepingFocus('tipv'); }
        else { st.otherTip = false; st.tip = { mode: 'pct', text: percentText(Number(d.tip)) }; }
        return redrawKeepingFocus();
      }
      if (d.act === 'round') return goRound();
    },
  });

  draw();
  if (!existing) app.querySelector('[data-key="what"]')?.focus({ preventScroll: true });
  window.addEventListener('hashchange', closeSheet, { once: true });
}
