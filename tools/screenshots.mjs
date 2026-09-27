// Renders the README screenshots (docs/*.png) and the link preview (og.png):  node tools/screenshots.mjs
// The clock and the random ids are fixed, so the same pictures come out every time. Needs Playwright, and upng-js from `npm install`.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(join(execSync('npm root -g').toString().trim(), 'playwright')); }
const UPNG = require('upng-js');
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
const SEED = 11;
const NOW = new Date('2026-09-27T18:30:00');
const browser = await pw.chromium.launch();
await mkdir(join(root, 'docs'), { recursive: true });

// A 256-colour palette keeps the PNGs small.
async function save(shot, path) {
  const img = UPNG.decode(shot);
  await writeFile(join(root, path), Buffer.from(UPNG.encode(UPNG.toRGBA8(img), img.width, img.height, 256)));
}

async function open(viewport, deviceScaleFactor) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor, hasTouch: true, serviceWorkers: 'block', reducedMotion: 'reduce', colorScheme: 'light', locale: 'en-US' });
  const page = await ctx.newPage();
  await page.clock.setFixedTime(NOW);
  await page.addInitScript(seed => {
    let a = seed; // mulberry32
    Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    Object.defineProperty(crypto, 'getRandomValues', { value: arr => { for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256); return arr; } });
  }, SEED);
  await page.goto(base);
  await page.evaluate(() => document.fonts.ready);
  return page;
}

// Opens the sample tab and returns its id.
async function sample(page) {
  await page.goto(base + '#/sample');
  await page.waitForSelector('.tabhead');
  return page.evaluate(() => location.hash.split('/')[2]);
}

const scrollTo = (page, sel, pad = 64) => page.evaluate(([s, p]) => window.scrollTo(0, document.querySelector(s).getBoundingClientRect().top + scrollY - p), [sel, pad]);

// Sam's copy of the sample tab, with a few changes, sent back as a link.
async function samsLink(page, id) {
  return page.evaluate(async id => {
    const { store, M, tabLink } = window.squareUp;
    const t = store.get(id);
    const c = structuredClone(t);
    const by = name => c.people.find(p => p.name === name).id;
    const later = Date.now() + 60000;
    c.entries.push(M.tidy({ id: 'shakes1', kind: 'expense', added: later, changed: later, what: 'Date shakes', amount: 2400, date: M.today(), category: 'food', note: '', paid: { [by('Sam')]: 2400 }, split: { how: 'equal', parts: { [by('Sam')]: 1, [by('Maya')]: 1, [by('Alex')]: 1 } } }));
    const gas = c.entries.find(e => e.what === 'Gas');
    Object.assign(gas, { amount: 6480, paid: { [by('Maya')]: 6480 }, changed: later });
    c.entries.push(M.tidy({ id: 'jppaid1', kind: 'payment', added: later + 1, changed: later + 1, from: by('Jo & Priya'), to: by('Alex'), amount: 20000, date: M.today(), note: '' }));
    return tabLink(c, by('Sam'));
  }, id);
}

// Phone screenshots for the README.
{
  const page = await open({ width: 390, height: 844 }, 2);
  const id = await sample(page);
  await page.mouse.move(0, 0);
  await save(await page.screenshot(), 'docs/phone-check.png');

  await page.click('.sections a:has-text("Square up")');
  await page.waitForSelector('.standing');
  await save(await page.screenshot(), 'docs/phone-square.png');

  await page.click('.sections a:has-text("Expenses")');
  await page.click('.line:has-text("Dinner at Pappy’s")');
  await page.waitForSelector('.items');
  await scrollTo(page, '.extras', 62);
  await save(await page.screenshot(), 'docs/phone-bill.png');

  await page.click('[data-act="round"]');
  await page.click('#rtNext');
  await page.waitForSelector('.sheet h2:has-text("Sam")');
  await save(await page.screenshot(), 'docs/phone-round.png');
  await page.click('#rtBack');
  await page.click('#rtBack');

  await page.goto(base + `#/t/${id}`);
  await page.waitForSelector('.tabhead');
  const link = await samsLink(page, id);
  await page.goto(link);
  await page.waitForSelector('.carbon');
  await save(await page.screenshot(), 'docs/phone-merge.png');
  await page.context().close();
}

// Link preview, 1200 x 630: the name and one line on the left, the sample tab's own check on the right.
{
  const page = await open({ width: 1200, height: 630 }, 1);
  await sample(page);
  await page.evaluate(async () => {
    const check = document.querySelector('.check').cloneNode(true);
    // Keep the first few lines, so the totals and the tear-off stub fit.
    const lines = check.querySelector('.lines');
    const keep = [...lines.children].slice(0, 6);
    lines.replaceChildren(...keep);
    document.body.innerHTML = `<div class="ogcard">
      <div class="ogtext">
        <img src="icon.svg" alt="" width="76" height="76">
        <h1>Square Up</h1>
        <p>Split costs for a trip, a house or a dinner, and settle in the fewest payments.</p>
        <ul><li>Split a bill by item, with tax and tip</li><li>The fewest payments to square up</li><li>Send the tab as a link, no accounts</li></ul>
      </div>
      <div class="ogcheck"></div>
    </div>`;
    document.querySelector('.ogcheck').append(check);
    const style = document.createElement('style');
    style.textContent = `
      body { width: 1200px; height: 630px; overflow: hidden; background: var(--table); }
      .bar, .toast { display: none !important; }
      .ogcard { display: grid; grid-template-columns: 590px 1fr; align-items: center; height: 630px; padding: 0 60px 0 70px; gap: 36px; }
      .ogtext img { border-radius: 17px; display: block; }
      .ogtext h1 { font-size: 104px; line-height: .95; margin: 24px 0 18px; font-stretch: 72%; font-weight: 850; text-transform: uppercase; letter-spacing: .02em; white-space: nowrap; }
      .ogtext p { font-size: 31px; line-height: 1.28; color: var(--ink-2); margin: 0 0 24px; font-weight: 500; }
      .ogtext ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 10px; }
      .ogtext li { font-size: 23px; font-weight: 650; color: var(--muted); display: flex; align-items: center; gap: 12px; }
      .ogtext li::before { content: ''; width: 18px; height: 0; border-top: 6px double var(--red); }
      .ogcheck { position: relative; height: 630px; }
      .ogcheck .check { position: absolute; top: 44px; left: 0; width: 460px; transform: rotate(2.2deg); margin: 0; box-shadow: 0 2px 0 rgba(40,50,30,.08), 0 26px 50px -22px rgba(40,50,30,.55); }
      .ogcheck .line { min-height: 60px; }`;
    document.head.append(style);
    await document.fonts.ready;
  });
  await page.waitForTimeout(200);
  await save(await page.screenshot(), 'og.png');
  await page.context().close();
}

await browser.close();
server.close();
console.log('screenshots written');
