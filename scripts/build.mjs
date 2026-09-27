// Bundles the app into one self-contained HTML file, dist/square-up.html, for sharing as a single page.
// Also writes dist/artifact.html, the same page without the document wrapper,
// for hosts that supply their own <html>/<head>/<body>. The repo itself runs without this step.
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const root = new URL('..', import.meta.url);
const read = p => readFile(new URL(p, root), 'utf8');

const result = await build({
  entryPoints: [new URL('js/app.js', root).pathname],
  bundle: true,
  format: 'iife',
  minify: true,
  target: 'es2020',
  write: false,
});
// data-single tells the page it's the one-file copy, which has no service worker to register,
// can't start downloads when it's shown inside another page, and makes links that point at the real site.
const js = `document.documentElement.dataset.single = '';\n${result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}`;

// A single file can't point at other files, so the fonts and the icon go in as data: URIs,
// and the links that only make sense for the hosted site (manifest, home-screen icon, preloads) come out.
const dataUri = async (path, type) => `data:${type};base64,${(await readFile(new URL(path, root))).toString('base64')}`;
let css = await read('css/app.css');
// Pages shown inside a host that has its own light/dark switch get data-theme on <html>:
// follow the system setting unless it says light, and go dark when it says dark.
const dark = css.match(/@media \(prefers-color-scheme: dark\) \{\n  :root \{([^}]*)\}\n\}/);
if (!dark) throw new Error('css/app.css: dark palette block not found');
css = css.replace(dark[0], `@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"]) {${dark[1]}}\n}\n:root[data-theme="dark"] {${dark[1]}}`);
for (const [, file] of css.matchAll(/url\(\.\.\/(fonts\/[^)]+\.woff2)\)/g)) css = css.replace(`url(../${file})`, `url(${await dataUri(file, 'font/woff2')})`);
const icon = await dataUri('icon.svg', 'image/svg+xml');
const html = (await read('index.html'))
  .replace(/ *<link rel="(manifest|apple-touch-icon|preload)"[^>]*>\n/g, '')
  .replaceAll('"icon.svg"', () => `"${icon}"`)
  .replace('<link rel="stylesheet" href="css/app.css">', () => `<style>\n${css}</style>`)
  .replace(/ *<script type="module" src="js\/app.js"><\/script>\n/, '')
  .replace('</body>', () => `<script>\n${js}</script>\n</body>`);
for (const leftover of ['css/app.css', 'js/app.js', 'manifest.webmanifest', '"icon.svg"']) {
  if (html.includes(leftover)) throw new Error(`the single file still points at ${leftover}`);
}

const fragment = html
  .replace(/<!doctype html>\s*/i, '')
  .replace(/<\/?html[^>]*>\s*/gi, '')
  .replace(/<\/?head>\s*/gi, '')
  .replace(/<\/?body[^>]*>\s*/gi, '')
  .replace(/<meta charset[^>]*>\s*/i, '')
  .replace(/<meta name="viewport"[^>]*>\s*/i, '');

// That host pads the page clear of a phone's notch itself, so the sticky bar sits below the padding instead of adding its own.
const embedded = fragment
  .replace('position: sticky; top: 0; z-index: 10;', 'position: sticky; top: env(safe-area-inset-top, 0px); z-index: 10;')
  .replace('padding: calc(10px + env(safe-area-inset-top)) ', 'padding: 10px ');
if (embedded === fragment) throw new Error('css/app.css: the top bar rules have changed; update scripts/build.mjs');

await mkdir(new URL('dist/', root), { recursive: true });
await writeFile(new URL('dist/square-up.html', root), html);
await writeFile(new URL('dist/artifact.html', root), embedded);
console.log(`dist/square-up.html  ${(html.length / 1024).toFixed(1)} KB`);
console.log(`dist/artifact.html   ${(embedded.length / 1024).toFixed(1)} KB`);
