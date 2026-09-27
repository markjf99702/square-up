// A tab to try things out on: a long weekend away, four households, every kind of split.
import { blankTab, addPerson, newId, today, tidy } from './model.js';

export function sampleTab(now = new Date()) {
  const t = blankTab('Joshua Tree weekend', 'USD');
  t.local = { sample: true };
  const [alex, sam, jp, maya] = [['Alex'], ['Sam'], ['Jo & Priya', 200], ['Maya']].map(([n, w]) => addPerson(t, n, w).id);
  t.local.me = alex;
  const day = back => today(new Date(now.getFullYear(), now.getMonth(), now.getDate() - back));
  let clock = Date.now() - 10000;
  const add = (e) => {
    clock += 10;
    t.entries.push(tidy({ id: newId(8), note: '', added: clock, changed: clock, ...e }));
  };
  const all = [alex, sam, jp, maya];
  const each = (ids, v = 1) => Object.fromEntries(ids.map(id => [id, v]));

  add({ kind: 'expense', what: 'Cabin, three nights', amount: 93000, date: day(5), category: 'home', paid: { [alex]: 93000 },
    split: { how: 'shares', parts: { [alex]: 100, [sam]: 100, [jp]: 200, [maya]: 100 } }, note: 'Jo & Priya count as two.' });
  add({ kind: 'expense', what: 'Groceries', amount: 14862, date: day(5), category: 'groceries', paid: { [sam]: 14862 },
    split: { how: 'shares', parts: { [alex]: 100, [sam]: 100, [jp]: 200, [maya]: 100 } } });
  add({ kind: 'expense', what: 'Gas', amount: 6140, date: day(5), category: 'travel', paid: { [maya]: 6140 },
    split: { how: 'equal', parts: each([alex, sam, maya]) }, note: 'Maya’s car.' });
  add({ kind: 'expense', what: 'Park pass', amount: 3500, date: day(4), category: 'fun', paid: { [jp]: 3500 },
    split: { how: 'equal', parts: each(all) } });
  add({ kind: 'expense', what: 'Climbing lesson', amount: 18000, date: day(4), category: 'fun', paid: { [maya]: 9000, [sam]: 9000 },
    split: { how: 'exact', parts: { [sam]: 9000, [maya]: 9000 } }, note: 'Paid half each at the desk.' });
  const items = [
    ['Brisket plate', 2400, [alex]],
    ['Burger', 1750, [sam]],
    ['Two rib plates', 5200, [jp]],
    ['Veggie tacos', 1500, [maya]],
    ['Pitcher of beer', 2200, [alex, sam, maya]],
    ['Fries to share', 900, all],
    ['Lemonades', 800, [jp]],
  ].map(([name, amount, who]) => ({ id: newId(6), name, amount, who }));
  add({ kind: 'expense', what: 'Dinner at Pappy’s', amount: 0, date: day(3), category: 'food', paid: {},
    split: { how: 'items', items, tax: { amount: 1143 }, tip: { pct: 2000 } } });
  // The dinner's total comes from its items.
  const dinner = t.entries[t.entries.length - 1];
  dinner.amount = 14750 + 1143 + 2950;
  dinner.paid = { [sam]: dinner.amount };
  add({ kind: 'payment', from: maya, to: alex, amount: 10000, date: day(2), note: '' });
  t.changed = clock;
  return t;
}
