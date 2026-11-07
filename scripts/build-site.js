// Builds the public site for GitHub Pages (elizabethzhu1.github.io/bookshelf):
//
//   _site/                     Liz's bookshelf, read-only (<html data-static>): the
//                              library in library/ saved as JSON in _site/data/.
//   _site/digital-bookshelf/   Digital Bookshelf, make your own: the app with an
//                              empty library kept in each visitor's browser
//                              (<html data-local>) and a first-visit tour.
//
//   npm run build-site                 → both
//   npm run build-site -- --no-notes   → same, without reviews, notes and journal notes on Liz's shelf
//
// The two link to each other; set MAKER_URL / EXAMPLE_URL to change where.
// For the read-only copy it starts the real server for a moment and saves what
// the app would ask it for (books, settings, recommendations, similar books).
// The GitHub Actions workflow (.github/workflows/pages.yml) runs this on every
// push to main.

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.join(ROOT, '_site');
const OUT = SITE;
const MAKER = path.join(SITE, 'digital-bookshelf');
const MAKER_URL = process.env.MAKER_URL || 'https://elizabethzhu1.github.io/bookshelf/digital-bookshelf/';
const EXAMPLE_URL = process.env.EXAMPLE_URL || 'https://elizabethzhu1.github.io/bookshelf/';
const PORT = 4300 + Math.floor(Math.random() * 90);
const base = `http://127.0.0.1:${PORT}`;
const noNotes = process.argv.includes('--no-notes');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// The page, three ways: as-is for the desktop app, data-local for the
// make-your-own site, data-static for the read-only copy.
async function mark(dir, attr, title) {
  await fs.cp(path.join(ROOT, 'public'), dir, { recursive: true });
  const index = path.join(dir, 'index.html');
  let html = (await fs.readFile(index, 'utf8')).replace('<html lang="en">', `<html lang="en" ${attr}>`);
  if (title) html = html.replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`).replace(/<h1>[^<]*<\/h1>/, `<h1>${title}</h1>`);
  await fs.writeFile(index, html);
}
async function buildMaker() {
  await fs.rm(MAKER, { recursive: true, force: true });
  await mark(MAKER, `data-local data-example="${EXAMPLE_URL}"`, 'My Bookshelf');
}

const server = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
  env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
  stdio: ['ignore', 'ignore', 'inherit'],
});
const get = async url => {
  const r = await fetch(base + url);
  if (!r.ok) throw new Error(`${url}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
};

try {
  for (let i = 0; ; i++) {
    try { await get('/api/config'); break; } catch (e) { if (i > 50) throw e; await sleep(100); }
  }

  let books = await get('/api/books');
  const settings = await get('/api/settings');
  if (noNotes) {
    books = books.map(b => ({ ...b, review: '', notes: '', journal: (b.journal ?? []).map(e => ({ ...e, note: '' })) }));
  }
  console.log(`  ${books.length} books`);

  // Recommendations and similar books come from Open Library; if it's down,
  // the page still works, just without them.
  let recs = { taste: [], basis: [], books: [] };
  try { recs = await get('/api/recommendations'); console.log(`  ${recs.books.length} recommendations`); }
  catch (e) { console.warn(`  ! recommendations skipped: ${e.message}`); }
  const similar = {};
  const queue = [...books];
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let b; (b = queue.shift());) {
      try { similar[b.id] = (await get(`/api/similar?id=${encodeURIComponent(b.id)}`)).books; }
      catch (e) { console.warn(`  ! similar to ${b.title} skipped: ${e.message}`); }
    }
  }));
  console.log(`  similar books for ${Object.keys(similar).length} of them`);

  await fs.rm(SITE, { recursive: true, force: true });
  await mark(SITE, `data-static data-maker="${MAKER_URL}"`);
  await buildMaker();
  // The shelf used to live at /liz/: send old links home.
  await fs.mkdir(path.join(SITE, 'liz'));
  await fs.writeFile(path.join(SITE, 'liz', 'index.html'), '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=../"><link rel="canonical" href="../"><a href="../">Liz’s Bookshelf</a>\n');
  await fs.mkdir(path.join(OUT, 'data'));
  const updated = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles' });
  const files = {
    'books.json': books,
    'settings.json': settings,
    'recommendations.json': recs,
    'similar.json': similar,
    'config.json': { libraryDir: `updated ${updated}`, label: 'A read-only copy' },
  };
  for (const [name, data] of Object.entries(files)) await fs.writeFile(path.join(OUT, 'data', name), JSON.stringify(data));
  await fs.writeFile(path.join(SITE, '.nojekyll'), ''); // serve files as they are
  console.log('  built _site/ (Liz’s bookshelf) and _site/digital-bookshelf/ (Digital Bookshelf)');
} finally {
  server.kill();
}
