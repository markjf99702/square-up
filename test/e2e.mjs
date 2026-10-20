// Uses the app in Chromium through the real page:  node test/e2e.mjs  (needs Playwright)
// Mark starts a tab and adds every kind of expense, including a dinner split by item. He sends it to Sam,
// they both add things at the same time, Sam sends it back, Mark merges it and everyone squares up.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(join(execSync('npm root -g').toString().trim(), 'playwright')); }
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let body;
  try { body = await readFile(join(root, path === '/' ? 'index.html' : path)); } catch { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'text/html' });
  res.end(body);
}).listen(0);
const base = `http://localhost:${server.address().port}/`;

const browser = await pw.chromium.launch();
const problems = [];

async function device() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, locale: 'en-US' });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = await ctx.newPage();
  page.on('pageerror', e => problems.push(e.message));
  page.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
  page.on('requestfailed', r => problems.push('failed: ' + r.url()));
  page.on('request', r => { if (!r.url().startsWith(base)) problems.push('left the site: ' + r.url()); });
  return { ctx, page };
}

const fits = async (page, where) => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${where} scrolls sideways on a phone`);
// How well an element's text stands out from its background, worked out the way WCAG does (4.5 or more reads well).
const contrast = loc => loc.evaluate(el => {
  const lum = c => {
    const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const s = getComputedStyle(el);
  const [hi, lo] = [lum(s.color), lum(s.backgroundColor)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
});
const text = page => page.locator('main').innerText();
const total = page => page.locator('.tot:not(.sub) b').innerText();

// Picks a person's chip, row or control by their name.
const row = (page, list, name) => page.locator(`${list} li`).filter({ has: page.locator('.nm', { hasText: new RegExp(`^${name}$`) }) });
const payer = (page, name) => page.locator('[data-payer]').filter({ hasText: new RegExp(`^${name}`) });
// How far the end of a person's part sits from the right-hand end of their row: 0 when the parts line up,
// below 0 when it runs past the end.
const fromRight = loc => loc.evaluate(o => {
  const text = document.createRange();
  text.selectNodeContents(o);
  return Math.round(o.closest('li').getBoundingClientRect().right - text.getBoundingClientRect().right);
});

// Waits for a tab to be drawn: the address changes a moment before the page does.
async function onTab(page) {
  await page.waitForURL(/#\/t\/[a-z0-9]+$/);
  await page.locator('.tabhead').waitFor();
}

async function saveExpense(page, name) {
  await page.click('[data-act="save"]');
  await onTab(page);
  await page.locator('.line', { hasText: name }).first().waitFor();
}

// ---------- Mark starts a tab ----------
const mark = await device();
let page = mark.page;
await page.goto(base);
await page.evaluate(() => document.fonts.ready);
assert.match(await text(page), /Split the costs, then square up/);
await fits(page, 'the home screen');

await page.click('text=Start a tab');
await page.fill('#tabName', 'Lisbon trip');
await page.selectOption('#currency', 'EUR');
await page.fill('[data-row="0"]', 'Mark');
await page.fill('[data-row="1"]', 'Sam');
await page.fill('[data-row="2"]', 'Jo');
await page.press('[data-row="2"]', 'Enter'); // Enter on the last name adds another
await page.keyboard.type('Priya');
await fits(page, 'starting a tab');
await page.click('[data-act="open"]');
await onTab(page);
const tabId = page.url().split('/').pop();
assert.match(await page.locator('.blank').innerText(), /Nothing on the tab yet/);
assert.equal(await page.locator('.written').innerText(), 'Lisbon trip');

// Equally, paid by Mark (this phone is his, so he's picked already).
await page.click('text=Add an expense');
await page.fill('[data-key="what"]', 'Apartment');
await page.fill('[data-key="amount"]', '480');
assert.equal(await payer(page, 'Mark').getAttribute('aria-pressed'), 'true');
assert.equal(await row(page, '.split-rows', 'Sam').locator('.each').innerText(), '€120.00');
assert.equal(await fromRight(row(page, '.split-rows', 'Sam').locator('.each')), 0, 'split equally, the parts line up at the right');
await page.fill('[data-key="amount"]', '48000000'); // a long part shows whole too
assert.equal(await row(page, '.split-rows', 'Sam').locator('.each').innerText(), '€12,000,000.00');
assert.equal(await fromRight(row(page, '.split-rows', 'Sam').locator('.each')), 0, 'split equally, a long part shows whole');
await page.fill('[data-key="amount"]', '480');
await fits(page, 'adding an expense');
await saveExpense(page, 'Apartment');
assert.equal(await total(page), '€480.00');

// By shares: Jo counts as two for the groceries. Sam paid.
await page.click('text=Add an expense');
await page.fill('[data-key="what"]', 'Groceries');
await page.fill('[data-key="amount"]', '63,40'); // a comma works as the decimal point
await payer(page, 'Sam').click();
await page.click('[data-how="shares"]');
await row(page, '.split-rows', 'Jo').locator('[data-by="50"]').click();
await row(page, '.split-rows', 'Jo').locator('[data-by="50"]').click();
assert.equal(await row(page, '.split-rows', 'Jo').locator('.each').innerText(), '€25.36');
assert.equal(await row(page, '.split-rows', 'Priya').locator('.each').innerText(), '€12.68');
assert.equal(await fromRight(row(page, '.split-rows', 'Priya').locator('.each')), 0, 'by shares, the parts line up at the right');
await saveExpense(page, 'Groceries');

// Two people paid part each, and it splits by exact amounts. Priya wasn't in the taxi.
await page.click('text=Add an expense');
await page.fill('[data-key="what"]', 'Taxi from the airport');
await page.fill('[data-key="amount"]', '30');
await page.click('[data-act="several"]');
assert.equal(await page.locator('[data-paid]').first().inputValue(), '30.00', 'the first payer starts with the whole amount');
await row(page, '.split-rows', 'Mark').locator('[data-paid]').fill('10');
await row(page, '.split-rows', 'Sam').locator('[data-paid]').fill('20');
assert.equal(await page.locator('#paidStatus').innerText(), 'Adds up to the total');
await page.click('[data-how="exact"]');
for (const n of ['Mark', 'Sam']) await page.locator('li', { has: page.locator(`[data-exact]`) }).filter({ hasText: n }).locator('[data-exact]').fill('10');
assert.match(await page.locator('#splitStatus').innerText(), /€10.00 still to split/);
assert.equal(await page.locator('[data-act="save"]').getAttribute('aria-disabled'), 'true', 'can’t save until it adds up');
await page.locator('li', { has: page.locator('[data-exact]') }).filter({ hasText: 'Jo' }).locator('[data-exact]').fill('10');
assert.equal(await page.locator('#splitStatus').innerText(), 'Adds up to the total');
await saveExpense(page, 'Taxi from the airport');

// By percent.
await page.click('text=Add an expense');
await page.fill('[data-key="what"]', 'Museum');
await page.fill('[data-key="amount"]', '40');
await page.click('[data-how="percent"]');
for (const [n, v] of [['Mark', '50'], ['Sam', '25'], ['Jo', '25']]) await page.locator('li', { has: page.locator('[data-pct]') }).filter({ hasText: n }).locator('[data-pct]').fill(v);
assert.equal(await page.locator('#splitStatus').innerText(), 'Adds up to 100%');
await saveExpense(page, 'Museum');

// ---------- A dinner split by item ----------
await page.click('text=Bill by item');
await page.fill('[data-key="what"]', 'Dinner at Tasca');
await page.locator('[data-iname]').first().fill('Bacalhau');
await page.keyboard.press('Enter'); // on to the price
await page.keyboard.type('18.50');
await page.keyboard.press('Enter'); // the next item
await page.keyboard.type('Octopus');
await page.keyboard.press('Enter');
await page.keyboard.type('22');
await page.keyboard.press('Enter');
await page.keyboard.type('Wine');
await page.keyboard.press('Enter');
await page.keyboard.type('24');
assert.equal(await page.locator('.item').count(), 3);
await page.locator('.item').nth(0).locator('[data-iwho]', { hasText: 'Mark' }).click();
await page.locator('.item').nth(1).locator('[data-iwho]', { hasText: 'Sam' }).click();
// Pass the phone round for the wine.
await page.click('[data-act="round"]');
for (const n of ['Mark', 'Sam', 'Jo', 'Priya']) {
  await page.locator('.sheet h2', { hasText: `${n}, tap what you had` }).waitFor();
  const wine = page.locator('.round-item', { hasText: 'Wine' });
  if (n !== 'Priya') await wine.click();
  assert.equal(await wine.getAttribute('aria-pressed'), String(n !== 'Priya'));
  await fits(page, 'going round the table');
  await page.click('#rtNext');
}
assert.equal(await page.locator('.item').nth(2).locator('[aria-pressed="true"][data-iwho]').count(), 3, 'three had wine');
assert.equal(await page.locator('.item').nth(2).locator('.each').innerText(), '€8.00 each');
// Leaving the round another way (Esc, or a phone's back gesture) still leaves the form showing what was tapped.
await page.click('[data-act="round"]');
await page.locator('.round-item', { hasText: 'Octopus' }).click(); // Mark taps the octopus too
await page.keyboard.press('Escape');
await page.waitForFunction(() => !document.getElementById('sheet').open);
const markOctopus = page.locator('.item').nth(1).locator('[data-iwho]', { hasText: 'Mark' });
assert.equal(await markOctopus.getAttribute('aria-pressed'), 'true', 'the form shows what was tapped in the round');
// And focus goes back to the button that started the round, not to the top of the page.
await page.waitForFunction(() => document.activeElement?.dataset.act === 'round', null, { timeout: 5000 }).catch(() => {});
assert.equal(await page.evaluate(() => document.activeElement?.dataset.act), 'round', 'focus goes back to Go round the table');
await markOctopus.click(); // he didn't have any after all
assert.equal(await markOctopus.getAttribute('aria-pressed'), 'false');
await page.click('[data-tip="2000"]');
await payer(page, 'Jo').click();
assert.equal(await page.locator('#subtotal').innerText(), '€64.50');
assert.equal(await page.locator('#itemsTotal').innerText(), '€77.40');
const each = Object.fromEntries((await page.locator('#eachList li').allInnerTexts()).map(s => { const p = s.split('\n'); return [p[0], p[p.length - 1]]; }));
assert.deepEqual(each, { Mark: '€31.80', Sam: '€36.00', Jo: '€9.60' }, 'tip follows what each person had');
await fits(page, 'the bill by item');
await saveExpense(page, 'Dinner at Tasca');
assert.equal(await total(page), '€690.80');
assert.match(await page.locator('.line', { hasText: 'Dinner at Tasca' }).innerText(), /by item, 3 items · your share €31.80/);

// Change it and change it back: an edit keeps its place.
await page.click('.line:has-text("Museum")');
assert.equal(await page.locator('[data-key="amount"]').inputValue(), '40.00');
await page.click('[data-act="delete"]');
await onTab(page);
assert.equal(await page.locator('.line', { hasText: 'Museum' }).count(), 0);
await page.click('.toast button'); // Undo
await page.locator('.line', { hasText: 'Museum' }).waitFor();
assert.equal(await total(page), '€690.80');

// ---------- Mark sends it to Sam ----------
await page.click('[data-act="send"]');
await page.waitForFunction(() => document.querySelector('#sheetLink').value.includes('#/s/'));
const toSam = await page.locator('#sheetLink').inputValue();
assert.ok(toSam.startsWith(base + '#/s/z'), 'a squeezed link back to this page');
assert.equal(await page.locator('#sheetFrom').inputValue(), await page.evaluate(id => window.squareUp.store.get(id).local.me, tabId));
await page.click('#sheetCopy');
assert.equal(await page.evaluate(() => navigator.clipboard.readText()), toSam, 'Copy link copies it');
await page.click('.sheet button[value="close"]');

const sam = await device();
await sam.page.goto(toSam);
await onTab(sam.page);
assert.equal(sam.page.url().split('/').pop(), tabId, 'the same tab on both phones');
assert.match(await sam.page.locator('.carbon').innerText(), /Mark sent you this tab/);
await sam.page.locator('.carbon [data-me]', { hasText: 'Sam' }).click();
assert.equal(await sam.page.locator('.carbon').count(), 0);
assert.equal(await total(sam.page), '€690.80');
assert.match(await sam.page.locator('.line', { hasText: 'Groceries' }).innerText(), /You paid/);
await fits(sam.page, 'a tab from a link');

// Both add something at the same time.
await sam.page.click('text=Add an expense');
await sam.page.fill('[data-key="what"]', 'Pastéis de nata');
await sam.page.fill('[data-key="amount"]', '12');
assert.equal(await payer(sam.page, 'Sam').getAttribute('aria-pressed'), 'true');
await sam.page.click('[data-cat="food"]');
await saveExpense(sam.page, 'Pastéis de nata');

await page.click('text=Add an expense');
await page.fill('[data-key="what"]', 'Tram tickets');
await page.fill('[data-key="amount"]', '16');
await page.click('[data-cat="travel"]');
await saveExpense(page, 'Tram tickets');

// Sam sends it back.
await sam.page.click('[data-act="send"]');
await sam.page.waitForFunction(() => document.querySelector('#sheetLink').value.includes('#/s/'));
assert.equal(await sam.page.locator('#sheetFrom option:checked').innerText(), 'Sam');
const toMark = await sam.page.locator('#sheetLink').inputValue();
await sam.page.click('.sheet button[value="close"]');

// Mark opens it: Sam's nata comes in, his tram tickets stay.
await page.goto(toMark);
await onTab(page);
const slip = await page.locator('.carbon').innerText();
assert.match(slip, /From Sam’s link/i);
assert.match(slip, /Pastéis de nata\s+€12.00/);
assert.match(slip, /Your copy has 1 change Sam’s didn’t/);
assert.equal(await page.locator('.carbon [data-act="send"]').count(), 1, 'offers to send it back');
assert.equal(await page.locator('.line', { hasText: 'Pastéis de nata' }).locator('.mark').innerText(), 'NEW');
assert.equal(await page.locator('.line', { hasText: 'Tram tickets' }).count(), 1);
assert.equal(await total(page), '€718.80');
await fits(page, 'the merged tab');
await page.click('.carbon [data-act="gotit"]');
assert.equal(await page.locator('.carbon').count(), 0);

// The same link again brings nothing new.
await page.goto(base + '#/');
await page.goto(toMark);
await onTab(page);
assert.match(await page.locator('.carbon').innerText(), /Nothing new/);
assert.equal(await total(page), '€718.80', 'nothing counted twice');

// ---------- Squaring up ----------
await page.click('.sections a:has-text("Square up")');
await page.locator('.standing').waitFor();
const standing = await page.locator('.standing').innerText();
for (const s of ['you’re owed\\s+\\+€344.52', 'owes\\s+−€100.28', 'owes\\s+−€104.56', 'owes\\s+−€139.68']) assert.match(standing, new RegExp(s));
assert.equal(await page.locator('.ticket').count(), 3, 'three payments settle it');
assert.equal(await page.locator('.sections i').innerText(), '3');
// The count on Square up reads well in the dark as well as the light.
await page.emulateMedia({ colorScheme: 'dark' });
assert.ok(await contrast(page.locator('.sections i')) >= 4.5, 'the count of payments reads well in the dark');
await page.emulateMedia({ colorScheme: 'light' });
assert.ok(await contrast(page.locator('.sections i')) >= 4.5, 'the count of payments reads well in the light');
assert.match(await text(page), /That’s the fewest it can be done in/);
assert.match(await page.locator('.ticket').first().innerText(), /Priya\s+pays\s+you\s+€139.68/);
await fits(page, 'squaring up');

// Sam pays part first, then the plan works out again from what's left.
await page.locator('.ticket', { hasText: 'Sam' }).locator('[data-rec]').click();
assert.equal(await page.locator('#payAmount').inputValue(), '100.28');
assert.ok(await page.locator('#payAmount').evaluate(i => i.scrollWidth <= i.clientWidth), 'the amount to record shows whole on a phone');
await page.fill('#payAmount', '50');
await page.click('#payGo');
await page.locator('.toast', { hasText: 'Recorded: Sam paid you €50.00' }).waitFor();
assert.match(await page.locator('.ticket', { hasText: 'Sam' }).innerText(), /€50.28/);
for (let i = 0; await page.locator('[data-rec]').count(); i++) {
  await page.locator('[data-rec]').first().click();
  await page.click('#payGo');
  await page.waitForTimeout(150);
  assert.ok(i < 5, 'the payments end');
}
await page.locator('.stamp.big', { hasText: 'Square' }).waitFor();
assert.match(await text(page), /Everyone is square/);
assert.equal(await page.locator('.sections i').count(), 0, 'no payments left to make');

// Back to Sam: he gets the payments and the tram tickets, and it's square on his phone too.
await page.click('[data-act="send"]');
await page.waitForFunction(() => document.querySelector('#sheetLink').value.includes('#/s/'));
const backToSam = await page.locator('#sheetLink').inputValue();
await page.click('.sheet button[value="close"]');
await sam.page.goto(backToSam);
await onTab(sam.page);
assert.match(await sam.page.locator('.carbon').innerText(), /Tram tickets\s+€16.00/);
assert.match(await sam.page.locator('.carbon').innerText(), /You paid Mark\s+€50.00/);
assert.equal(await total(sam.page), '€718.80');
await sam.page.click('.sections a:has-text("Square up")');
await sam.page.locator('.stamp.big').waitFor();

// ---------- People, archive, backup ----------
await page.click('.sections a:has-text("People")');
await page.locator('.person').first().waitFor();
assert.equal(await page.locator('[data-remove]').first().isDisabled(), true, 'someone on the tab can’t be removed');
await page.locator('.person', { has: page.locator('[value="Priya"]') }).locator('summary').click();
await page.locator('.person', { has: page.locator('[value="Priya"]') }).locator('[data-handle="paypal"]').fill('paypal.me/priyaexample');
await page.locator('.person', { has: page.locator('[value="Priya"]') }).locator('[data-handle="paypal"]').blur();
assert.equal(await page.locator('.person', { has: page.locator('[value="Priya"]') }).locator('[data-handle="paypal"]').inputValue(), 'priyaexample');
await fits(page, 'the people');
// Someone new can be added, and taken off again while they're on nothing.
await page.fill('#newPerson', 'Robin');
await page.press('#newPerson', 'Enter');
await page.locator('.person input[value="Robin"]').waitFor();
assert.equal(await page.locator('.person').count(), 5);
const robin = page.locator('.person', { has: page.locator('[value="Robin"]') });
await robin.locator('summary').click();
await robin.locator('[data-remove]').click();
assert.equal(await page.locator('.person').count(), 4);
await page.click('.toast button'); // Undo
assert.equal(await page.locator('.person').count(), 5);
await page.locator('.person', { has: page.locator('[value="Robin"]') }).locator('summary').click();
await page.locator('.person', { has: page.locator('[value="Robin"]') }).locator('[data-remove]').click();
assert.equal(await page.locator('.person').count(), 4);
// A spreadsheet of the tab.
const [sheetFile] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="csv"]')]);
assert.equal(sheetFile.suggestedFilename(), 'Lisbon trip.csv');
const csv = (await readFile(await sheetFile.path(), 'utf8')).split('\n');
assert.equal(csv[0], 'Date,What,Category,Amount,Paid by,Split,Mark share,Sam share,Jo share,Priya share');
assert.ok(csv.some(l => l.includes('Dinner at Tasca,Food & drink,77.40,Jo 77.40,items,31.80,36.00,9.60,')), 'the dinner row');
assert.ok(csv.some(l => l.startsWith(',Up / down,') && l.endsWith(',0.00,0.00,0.00,0.00')), 'everyone square');
await page.click('[data-act="archive"]');
await page.goto(base + '#/');
await page.locator('details.archived').waitFor();
assert.match(await page.locator('details.archived summary').innerText(), /Archived \(1\)/);
assert.match(await page.locator('details.archived').innerText(), /SQUARE/i);

// A backup has the tab in it, and loading it into Sam's browser changes nothing there.
await page.click('text=Try a sample tab');
await onTab(page);
assert.match(await text(page), /Dinner at Pappy’s/);
await page.goto(base + '#/');
// From the keyboard, Load a backup (a file input inside its label) shows focus on the words you can see.
await page.focus('[data-act="save"]');
await page.keyboard.press('Tab');
assert.equal(await page.evaluate(() => document.activeElement.id), 'loadBackup');
assert.equal(await page.locator('.keep label').evaluate(l => getComputedStyle(l).outlineStyle), 'solid', 'Load a backup shows keyboard focus');
const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="save"]')]);
const backup = await readFile(await download.path(), 'utf8');
assert.equal(JSON.parse(backup).tabs.length, 2);
await sam.page.goto(base + '#/');
await sam.page.setInputFiles('#loadBackup', { name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(backup) });
await sam.page.locator('.toast', { hasText: 'Loaded 2 tabs' }).waitFor();
assert.equal(await sam.page.locator('.stub').count(), 2);

// Survives a reload, and works offline once it has been opened.
await page.reload();
assert.equal(await page.locator('.stub').count(), 2);
await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 10000 }).catch(() => {});
await mark.ctx.setOffline(true);
await page.reload();
assert.match(await text(page), /Your tabs/, 'loads offline');
await page.goto(base + `#/t/${tabId}`);
assert.equal(await total(page), '€718.80', 'the tab opens offline');
await mark.ctx.setOffline(false);

// ---------- Other tools' offline copies ----------
// The tools at junkdrawer.works share one address, so they share one set of caches too. When Square Up's
// service worker starts, it clears out its own old copy and leaves the other tools' copies alone, even one
// whose name starts the same way as Square Up's.
const shared = await device();
await shared.page.goto(base + 'icon.svg'); // the same address, before Square Up has a service worker
await shared.page.evaluate(async () => {
  await (await caches.open('another-tool-v1')).put('another-tool/', new Response('another tool, kept for offline'));
  await (await caches.open('square-up-x-v1')).put('square-up-x/', new Response('a tool with a longer name, kept for offline'));
  await (await caches.open('square-up-v0')).put('index.html', new Response('an old Square Up'));
});
await shared.page.goto(base);
// The service worker takes over the page once it has cleared out.
await shared.page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 30000 });
assert.equal(await shared.page.evaluate(() => caches.has('another-tool-v1')), true, 'another tool’s offline copy is kept');
assert.equal(await shared.page.evaluate(() => caches.has('square-up-x-v1')), true, 'a tool named square-up-something keeps its offline copy');
assert.equal(await shared.page.evaluate(() => caches.has('square-up-v0')), false, 'Square Up’s old offline copy is cleared out');
await shared.ctx.close();

// ---------- Tabs saved in a shape it doesn't expect ----------
// Storage edited by hand or damaged: a tab that can be drawn still opens, and nothing is thrown away.
const odd = await device();
await odd.page.goto(base);
await odd.page.evaluate(() => localStorage.setItem('square-up', JSON.stringify({ name: '', tabs: [
  { id: 'old', name: 'Old tab', currency: 'USD', created: Date.now(), changed: Date.now(), people: [], entries: [] }, // no local part
  null,
  { id: 'half', name: 'Half a tab', currency: 'USD', local: {} }, // no people or entries
] })));
await odd.page.reload();
assert.equal(await odd.page.locator('.stub').count(), 1, 'the tab that can be drawn is listed');
await odd.page.click('.stub a');
await onTab(odd.page);
assert.equal(await odd.page.locator('.written').innerText(), 'Old tab');
assert.equal(await odd.page.evaluate(() => JSON.parse(localStorage.getItem('square-up')).tabs.length), 3, 'the others are kept as they were');
await odd.page.goto(base + '#/t/half');
await odd.page.locator('.note-card').waitFor(); // the address changes a moment before the page does
assert.match(await text(odd.page), /That tab isn’t here/);
await odd.page.goto(base + '#/');
const [oddBackup] = await Promise.all([odd.page.waitForEvent('download'), odd.page.click('[data-act="save"]')]);
assert.deepEqual(JSON.parse(await readFile(await oddBackup.path(), 'utf8')).tabs.map(t => t.n), ['Old tab']);
await odd.ctx.close();

// ---------- A link that only changes people's details ----------
// Alex sends the sample tab to Sam. Sam puts in his full name and his Venmo, and makes Jo & Priya count as
// two and a half, then sends it back. Alex's carbon copy says each of those, rather than coming up blank.
const alex = await device(), samuel = await device();
await alex.page.goto(base + '#/sample');
await onTab(alex.page);
const sampleLink = await alex.page.evaluate(id => window.squareUp.tabLink(window.squareUp.store.get(id), ''), alex.page.url().split('/').pop());
await samuel.page.goto(sampleLink);
await onTab(samuel.page);
await samuel.page.locator('.carbon [data-me]', { hasText: 'Sam' }).click();
await samuel.page.click('.sections a:has-text("People")');
const samRow = samuel.page.locator('.person').nth(1), jpRow = samuel.page.locator('.person').nth(2);
assert.equal(await samRow.locator('[data-name]').inputValue(), 'Sam');
await samRow.locator('[data-name]').fill('Samuel');
await samRow.locator('summary').click(); // leaving the name saves it
await samRow.locator('[data-handle="venmo"]').fill('samuel-k');
await samRow.locator('[data-handle="venmo"]').blur();
await jpRow.locator('summary').click();
await jpRow.locator('[data-by="50"]').click();
assert.equal(await jpRow.locator('.stepper b').innerText(), '2.5');
await samuel.page.click('[data-act="send"]');
await samuel.page.waitForFunction(() => document.querySelector('#sheetLink').value.includes('#/s/'));
const detailsBack = await samuel.page.locator('#sheetLink').inputValue();
await alex.page.goto(base + '#/');
await alex.page.goto(detailsBack);
await onTab(alex.page);
const detailsSlip = await alex.page.locator('.carbon').innerText();
assert.match(detailsSlip, /From Samuel’s link/i);
assert.match(detailsSlip, /Sam is now Samuel and added Venmo/);
assert.match(detailsSlip, /Jo & Priya now count as 2\.5/);
assert.equal(await alex.page.locator('.carbon .changes li').count(), 2, 'a line for each of them');
assert.doesNotMatch(detailsSlip, /Nothing new/);
await fits(alex.page, 'a carbon copy of people’s details');
await alex.ctx.close();
await samuel.ctx.close();

// ---------- Square Up open in several windows ----------
// Each window saves on top of what the others saved, so nothing is written over. A tab deleted in one window
// stays deleted when another only has it open, and comes back when something is added to it there.
const twin = await device();
const w1 = twin.page, w2 = await twin.ctx.newPage(), w3 = await twin.ctx.newPage();
for (const p of [w2, w3]) {
  p.on('pageerror', e => problems.push(e.message));
  p.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
}
await w1.goto(base + '#/sample');
await onTab(w1);
const twinId = w1.url().split('/').pop();
// Window two starts adding ice while window one adds firewood and saves first.
await w2.goto(base + `#/t/${twinId}/add`);
await w2.fill('[data-key="what"]', 'Ice');
await w2.fill('[data-key="amount"]', '8');
await w1.click('text=Add an expense');
await w1.fill('[data-key="what"]', 'Firewood');
await w1.fill('[data-key="amount"]', '20');
await saveExpense(w1, 'Firewood');
await saveExpense(w2, 'Ice');
assert.equal(await w2.locator('.line', { hasText: 'Firewood' }).count(), 1, 'window two shows window one’s firewood');
await w1.reload();
await onTab(w1);
for (const what of ['Firewood', 'Ice']) assert.equal(await w1.locator('.line', { hasText: what }).count(), 1, `${what} is saved`);
// Window three is adding matches when window one deletes the tab. Undo brings it back; then it's deleted again.
await w3.goto(base + `#/t/${twinId}/add`);
await w3.fill('[data-key="what"]', 'Matches');
await w3.fill('[data-key="amount"]', '3');
const deleteTab = async () => {
  await w1.click('.sections a:has-text("People")');
  await w1.click('[data-act="delete"]');
  await w1.click('#delGo');
  await w1.waitForURL(/#\/$/);
};
await deleteTab();
await w1.click('.toast button'); // Undo
await w1.waitForURL(/\/people$/);
await w1.locator('.person').first().waitFor();
await deleteTab();
// Window two only moves to Square up, which isn't a change to the tab: it stays deleted.
await w2.click('.sections a:has-text("Square up")');
await w2.locator('.note-card').waitFor();
assert.match(await text(w2), /That tab isn’t here/);
await w1.reload();
await w1.locator('.hero').waitFor();
assert.equal(await w1.locator('.stub').count(), 0, 'still deleted');
// Window three saves the matches: something added to the tab brings it back, the way a link sent back does.
await saveExpense(w3, 'Matches');
await w1.reload();
await w1.locator('.stub').first().waitFor();
await w1.click('.stub a');
await onTab(w1);
for (const what of ['Firewood', 'Ice', 'Matches']) assert.equal(await w1.locator('.line', { hasText: what }).count(), 1, `${what} is on the tab that came back`);
await twin.ctx.close();

// ---------- When this browser won't save ----------
// The tools at junkdrawer.works share the browser's room for saving, and it can fill up. Then a notice on the tab
// and the home screen says the tabs aren't being saved, with a button that saves a backup of everything here.
const full = await device();
await full.page.goto(base + '#/sample');
await onTab(full.page);
assert.equal(await full.page.locator('.unsaved').count(), 0, 'no notice while saving works');
await full.page.evaluate(() => {
  const set = Storage.prototype.setItem;
  window.roomAgain = () => { Storage.prototype.setItem = set; };
  Storage.prototype.setItem = function () { throw new DOMException('The quota has been exceeded.', 'QuotaExceededError'); };
});
await full.page.click('text=Add an expense');
await full.page.fill('[data-key="what"]', 'Firewood');
await full.page.fill('[data-key="amount"]', '20');
await saveExpense(full.page, 'Firewood');
const unsavedWords = 'This browser isn’t saving your tabs: its storage is full. Save a backup so you don’t lose them.';
assert.equal(await full.page.locator('.unsaved p').innerText(), unsavedWords);
await full.page.locator('.toast', { hasText: 'Added Firewood' }).waitFor(); // the toast doesn't take its place
assert.equal(await full.page.locator('[role="alert"]').textContent(), unsavedWords, 'said once to a screen reader');
await fits(full.page, 'a tab that isn’t being saved');
// It's on the home screen too, once, and its button saves a backup with what couldn't be saved.
await full.page.click('#allLink');
await full.page.locator('.stubs').waitFor();
assert.equal(await full.page.locator('.unsaved').count(), 1);
const [rescue] = await Promise.all([full.page.waitForEvent('download'), full.page.click('.unsaved [data-act="backup"]')]);
assert.ok(JSON.parse(await readFile(await rescue.path(), 'utf8')).tabs[0].e.some(e => e.w === 'Firewood'), 'the backup has the firewood');
// Once a save works again (opening the tab saves), the notice goes, and everything waiting is saved.
await full.page.evaluate(() => window.roomAgain());
await full.page.click('.stub a');
await onTab(full.page);
assert.equal(await full.page.locator('.unsaved').count(), 0, 'the notice goes once a save works');
await full.page.reload();
await onTab(full.page);
assert.equal(await full.page.locator('.line', { hasText: 'Firewood' }).count(), 1, 'the firewood is saved now');
await full.ctx.close();

// ---------- Without JavaScript ----------
// The message saying what it needs JavaScript for is the first thing on the page, above the footer.
const nojs = await browser.newContext({ viewport: { width: 390, height: 844 }, javaScriptEnabled: false });
const nojsPage = await nojs.newPage();
await nojsPage.goto(base);
const [said, foot] = await Promise.all([nojsPage.locator('.noscript').boundingBox(), nojsPage.locator('.jd-foot').boundingBox()]);
assert.ok(said.y + said.height <= foot.y, 'the no-JavaScript message comes before the footer');
await nojs.close();

assert.deepEqual(problems.filter(p => !p.startsWith('failed:')), [], 'problems while using it');
await browser.close();
server.close();
console.log('all good');
