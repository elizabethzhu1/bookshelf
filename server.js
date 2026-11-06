// The Bookshelf: a tiny local server with no dependencies.
// Books are stored as Markdown files (YAML frontmatter + body) in LIBRARY_DIR.
// Point LIBRARY_DIR at a folder inside your Obsidian vault and both apps share
// the same files.

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { parse, formatEntry } from './lib/frontmatter.js';
import { guessCategory } from './public/categories.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const expandHome = p => (p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p);
const LIBRARY_DIR = path.resolve(expandHome(process.env.LIBRARY_DIR || path.join(ROOT, 'library')));
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 4321;
const HOST = process.env.HOST || '127.0.0.1';

const STATUSES = ['reading', 'tbr', 'wishlist', 'read', 'dnf'];
// Frontmatter keys this app manages, in the order they're written.
const KNOWN = ['title', 'author', 'status', 'owned', 'rating', 'rank', 'pages', 'progress',
  'started', 'finished', 'year', 'isbn', 'cover', 'category', 'tags', 'added'];

// ---------- book <-> markdown ----------

const num = v => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const str = v => (v === null || v === undefined || v === '' ? null : Array.isArray(v) ? v.join(', ') : String(v));

function splitBody(body) {
  const matches = [...body.matchAll(/^##[ \t]+(Review|Notes|Journal)[ \t]*$/gim)];
  if (!matches.length) return { review: '', notes: body.trim(), journal: '' };
  const out = { review: '', notes: '', journal: '' };
  matches.forEach((m, i) => {
    const end = i + 1 < matches.length ? matches[i + 1].index : body.length;
    const key = m[1].toLowerCase();
    const chunk = body.slice(m.index + m[0].length, end).trim();
    out[key] = [out[key], chunk].filter(Boolean).join('\n\n');
  });
  const preamble = body.slice(0, matches[0].index).trim();
  if (preamble) out.notes = [preamble, out.notes].filter(Boolean).join('\n\n');
  return out;
}

// ---------- reading journal ----------
// Kept in each book's file under "## Journal", one dated line per entry, so it
// reads naturally in Obsidian:
//   - 2026-11-05 · pp. 120–141 · Lovely chapter on the House.
//   - 2026-11-06 · p. 160
//   - 2026-11-07 · Just a note, no pages.
// Lines that don't fit the pattern are kept exactly as written.

const JOURNAL_LINE = /^[-*][ \t]+(\d{4}-\d{2}-\d{2})(?:[ \t]+·[ \t]+pp?\.[ \t]*(\d+)(?:[ \t]*[–-][ \t]*(\d+))?)?(?:[ \t]+·[ \t]+(.*))?[ \t]*$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseJournal(text) {
  return text.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
    const m = line.match(JOURNAL_LINE);
    if (!m) return { raw: line };
    const [, date, a, b, note] = m;
    const [from, to] = b !== undefined ? [Number(a), Number(b)] : [null, a !== undefined ? Number(a) : null];
    return { date, from, to, note: (note || '').trim() };
  });
}

function formatJournal(entries) {
  return entries.map(e => {
    if (e.raw) return e.raw;
    const parts = [e.date];
    if (e.to != null) parts.push(e.from != null ? `pp. ${e.from}–${e.to}` : `p. ${e.to}`);
    if (e.note) parts.push(e.note);
    return `- ${parts.join(' · ')}`;
  }).join('\n');
}

// Accept entries from the app: valid dates, whole page numbers, one-line notes.
function cleanJournal(list) {
  if (!Array.isArray(list)) throw Object.assign(new Error('Journal must be a list'), { status: 400 });
  const page = v => (v === null || v === undefined || v === '' ? null : Number.isInteger(Number(v)) && Number(v) >= 0 ? Number(v) : NaN);
  const out = list.slice(0, 5000).map(e => {
    if (e && typeof e.raw === 'string') return { raw: e.raw.replace(/\n/g, ' ').trim() };
    const date = String(e?.date ?? '');
    const from = page(e?.from), to = page(e?.to);
    if (!ISO_DATE.test(date) || Number.isNaN(from) || Number.isNaN(to)) {
      throw Object.assign(new Error('Each journal entry needs a date (YYYY-MM-DD) and whole page numbers'), { status: 400 });
    }
    return { date, from: to == null ? null : from, to, note: String(e?.note ?? '').replace(/\s+/g, ' ').trim().slice(0, 2000) };
  }).filter(e => e.raw || e.to != null || e.note);
  return sortJournal(out);
}

const sortJournal = list => list
  .map((e, i) => [e, i])
  .sort(([a, i], [b, j]) => (a.date && b.date ? a.date.localeCompare(b.date) : 0) || i - j)
  .map(([e]) => e);

// Moving your page forward logs it: today's entry is extended, or a new one starts.
function logProgress(journal, date, from, to) {
  const todays = journal.find(e => e.date === date && !e.raw && e.to != null);
  if (todays) {
    todays.to = Math.max(todays.to, to);
    if (todays.from != null && todays.from >= todays.to) todays.from = null;
    return journal;
  }
  return sortJournal([...journal, { date, from: from > 0 && from < to ? from : (from === 0 ? 0 : null), to, note: '' }]);
}

function toBook(id, text) {
  const { data, body } = parse(text);
  const { review, notes, journal } = splitBody(body);
  const status = STATUSES.includes(data.status) ? data.status : 'tbr';
  const tags = Array.isArray(data.tags)
    ? data.tags.map(String)
    : data.tags ? String(data.tags).split(',').map(s => s.trim()).filter(Boolean) : [];
  return {
    id,
    title: str(data.title) ?? id.replace(/\.md$/i, ''),
    author: str(data.author) ?? '',
    status,
    owned: typeof data.owned === 'boolean' ? data.owned : status !== 'wishlist',
    rating: num(data.rating),
    rank: num(data.rank),
    pages: num(data.pages),
    progress: num(data.progress),
    started: str(data.started),
    finished: str(data.finished),
    year: num(data.year),
    isbn: str(data.isbn),
    cover: str(data.cover),
    category: str(data.category),
    tags: tags.map(t => t.replace(/^#/, '')),
    added: str(data.added),
    review,
    notes,
    journal: parseJournal(journal),
  };
}

function clean(key, v) {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v === 'number' && Number.isNaN(v)) return undefined;
  if (key === 'tags') return Array.isArray(v) && v.length ? v.map(String) : undefined;
  if (key === 'owned') return Boolean(v);
  if (['rating', 'rank', 'pages', 'progress', 'year'].includes(key)) return num(v) ?? undefined;
  return String(v);
}

function serialize(book, prevRaw = {}) {
  const lines = ['---'];
  for (const key of KNOWN) {
    const v = clean(key, book[key]);
    if (v !== undefined) lines.push(formatEntry(key, v));
  }
  // Preserve any extra properties you added in Obsidian, exactly as written.
  for (const [key, raw] of Object.entries(prevRaw)) if (!KNOWN.includes(key)) lines.push(raw);
  lines.push('---', '');
  const review = (book.review || '').trim();
  const notes = (book.notes || '').trim();
  const journal = formatJournal(book.journal || []);
  return `${lines.join('\n')}\n## Review\n\n${review}${review ? '\n' : ''}\n## Notes\n\n${notes}${notes ? '\n' : ''}`
    + (journal ? `\n## Journal\n\n${journal}\n` : '');
}

// ---------- filesystem ----------

function fileFor(id) {
  if (typeof id !== 'string' || id !== path.basename(id) || !/\.md$/i.test(id) || id.startsWith('.')) {
    throw Object.assign(new Error('Invalid book id'), { status: 400 });
  }
  return path.join(LIBRARY_DIR, id);
}

async function readBookFile(id) {
  try {
    return await fs.readFile(fileFor(id), 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') throw Object.assign(new Error('Book not found'), { status: 404 });
    throw e;
  }
}

async function writeAtomic(file, text) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  await fs.writeFile(tmp, text, 'utf8');
  await fs.rename(tmp, file);
}

// ---------- settings (reading goals, shelf order) ----------
// Kept as a hidden JSON file next to the books so it travels with the library.

const SETTINGS_FILE = path.join(LIBRARY_DIR, '.bookshelf.json');

async function readSettings() {
  try {
    const s = JSON.parse(await fs.readFile(SETTINGS_FILE, 'utf8'));
    const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
    return { goals: obj(s?.goals), shelfOrder: obj(s?.shelfOrder) };
  } catch {
    return { goals: {}, shelfOrder: {} };
  }
}

async function writeSettings(settings) {
  await fs.mkdir(LIBRARY_DIR, { recursive: true });
  await writeAtomic(SETTINGS_FILE, JSON.stringify(settings, null, 2) + '\n');
  return settings;
}

// The hand-arranged order of one shelf, as a list of book ids (file names).
// null clears it, so the shelf goes back to its default sort.
async function setShelfOrder(status, order) {
  if (!STATUSES.includes(status)) throw Object.assign(new Error('Unknown shelf'), { status: 400 });
  if (order !== null && !(Array.isArray(order) && order.length <= 10000 && order.every(id => typeof id === 'string' && id.length < 300))) {
    throw Object.assign(new Error('Order must be a list of book ids'), { status: 400 });
  }
  const settings = await readSettings();
  if (order === null) delete settings.shelfOrder[status]; else settings.shelfOrder[status] = order;
  return writeSettings(settings);
}

async function setGoal(year, goal) {
  if (!/^\d{4}$/.test(String(year))) throw Object.assign(new Error('Invalid year'), { status: 400 });
  const n = num(goal);
  if (n !== null && (!Number.isInteger(n) || n < 1 || n > 1000)) {
    throw Object.assign(new Error('Goal must be a whole number from 1 to 1000'), { status: 400 });
  }
  const settings = await readSettings();
  if (n === null) delete settings.goals[year]; else settings.goals[year] = n;
  return writeSettings(settings);
}

async function listBooks() {
  await fs.mkdir(LIBRARY_DIR, { recursive: true });
  const entries = await fs.readdir(LIBRARY_DIR, { withFileTypes: true });
  const files = entries.filter(e => e.isFile() && /\.md$/i.test(e.name) && !e.name.startsWith('.'));
  const books = await Promise.all(files.map(async f => {
    try {
      return toBook(f.name, await fs.readFile(path.join(LIBRARY_DIR, f.name), 'utf8'));
    } catch (e) {
      console.warn(`Skipping ${f.name}: ${e.message}`);
      return null;
    }
  }));
  return books.filter(Boolean).sort((a, b) => a.title.localeCompare(b.title));
}

function filenameFor(book) {
  const base = [book.title, book.author].filter(Boolean).join(' - ')
    .replace(/[\\/:*?"<>|#^[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'Untitled';
  return base;
}

async function createBook(input) {
  if (!input.title || !String(input.title).trim()) throw Object.assign(new Error('A title is required'), { status: 400 });
  await fs.mkdir(LIBRARY_DIR, { recursive: true });
  const base = filenameFor(input);
  let id = `${base}.md`;
  for (let n = 2; await exists(path.join(LIBRARY_DIR, id)); n++) id = `${base} (${n}).md`;
  const status = STATUSES.includes(input.status) ? input.status : 'tbr';
  const book = {
    ...input,
    title: String(input.title).trim(),
    status,
    owned: input.owned ?? status !== 'wishlist',
    added: input.added || new Date().toLocaleDateString('en-CA'),
  };
  await fs.writeFile(path.join(LIBRARY_DIR, id), serialize(book), { encoding: 'utf8', flag: 'wx' });
  return toBook(id, await readBookFile(id));
}

async function updateBook(id, input) {
  const text = await readBookFile(id);
  const prev = parse(text);
  const current = toBook(id, text);
  const { skipAutoLog, ...fields } = input;
  const merged = { ...current, ...fields };
  if (!STATUSES.includes(merged.status)) merged.status = current.status;
  // The app only sends `journal` when editing it; otherwise keep what's on disk.
  merged.journal = fields.journal !== undefined ? cleanJournal(fields.journal) : current.journal;
  const before = current.progress ?? 0;
  const after = num(merged.progress);
  if (!skipAutoLog && after !== null && after > before) {
    merged.journal = logProgress(merged.journal, new Date().toLocaleDateString('en-CA'), before, after);
  }
  await writeAtomic(fileFor(id), serialize(merged, prev.raw));
  return toBook(id, await readBookFile(id));
}

async function deleteBook(id) {
  // Soft delete: move into a hidden .trash folder (Obsidian ignores dot-folders).
  const trash = path.join(LIBRARY_DIR, '.trash');
  await fs.mkdir(trash, { recursive: true });
  await fs.rename(fileFor(id), path.join(trash, `${Date.now()}-${id}`));
}

async function setRanks(order) {
  if (!Array.isArray(order)) throw Object.assign(new Error('order must be an array of ids'), { status: 400 });
  await Promise.all(order.map(async (id, i) => {
    const text = await readBookFile(id);
    const book = toBook(id, text);
    if (book.rank === i + 1) return;
    await writeAtomic(fileFor(id), serialize({ ...book, rank: i + 1 }, parse(text).raw));
  }));
}

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

// ---------- Open Library lookup ----------

async function searchOpenLibrary(q) {
  const fields = 'title,author_name,first_publish_year,cover_i,isbn,number_of_pages_median,subject';
  const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=12&fields=${fields}`;
  const r = await fetch(url, { headers: { 'User-Agent': 'BookshelfLocalApp/1.0' }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw Object.assign(new Error(`Open Library returned ${r.status}`), { status: 502 });
  const { docs = [] } = await r.json();
  return docs.map(d => ({
    title: d.title,
    author: (d.author_name || []).slice(0, 3).join(', '),
    year: d.first_publish_year ?? null,
    pages: d.number_of_pages_median ?? null,
    isbn: (d.isbn || []).find(i => i.length === 13) || (d.isbn || [])[0] || null,
    cover: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg` : null,
    category: guessCategory(d.subject),
  }));
}

// Guess a book's category from Open Library's subjects: by ISBN first, then by
// title and author. Returns null when Open Library has nothing to go on.
async function lookupCategory(book) {
  const tries = [];
  if (book.isbn) tries.push({ q: `isbn:${book.isbn}` });
  tries.push({ title: book.title, ...(book.author ? { author: book.author.split(',')[0].trim() } : {}) });
  for (const params of tries) {
    const url = `https://openlibrary.org/search.json?${new URLSearchParams({ ...params, fields: 'subject', limit: '3' })}`;
    const r = await fetch(url, { headers: { 'User-Agent': 'BookshelfLocalApp/1.0' }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) continue;
    const { docs = [] } = await r.json();
    const category = guessCategory(docs.flatMap(d => (d.subject || []).slice(0, 40)));
    if (category) return category;
  }
  return null;
}

// Fill in a category for every book that doesn't have one yet. Books Open
// Library can't place are left alone. Returns the updated books.
async function categorizeMissing() {
  const missing = (await listBooks()).filter(b => !b.category);
  const updated = [];
  for (let i = 0; i < missing.length; i += 4) {
    await Promise.all(missing.slice(i, i + 4).map(async b => {
      const category = await lookupCategory(b).catch(() => null);
      if (category) updated.push(await updateBook(b.id, { category, skipAutoLog: true }));
    }));
  }
  return { updated, skipped: missing.length - updated.length };
}

// ---------- San Francisco weather (for the window) ----------
// Open-Meteo: free, no key. Cached for 10 minutes so reloads don't refetch.

let weatherCache = null; // { at, data }
async function sfWeather() {
  if (weatherCache && Date.now() - weatherCache.at < 10 * 60_000) return weatherCache.data;
  const params = new URLSearchParams({
    latitude: '37.7749', longitude: '-122.4194',
    current: 'temperature_2m,weather_code,cloud_cover,is_day,wind_speed_10m',
    temperature_unit: 'fahrenheit', wind_speed_unit: 'mph', timezone: 'America/Los_Angeles',
  });
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw Object.assign(new Error(`Weather service returned ${r.status}`), { status: 502 });
  const { current: c } = await r.json();
  const data = { temp: c.temperature_2m, code: c.weather_code, cloud: c.cloud_cover, wind: c.wind_speed_10m, time: c.time };
  weatherCache = { at: Date.now(), data };
  return data;
}

// ---------- HTTP ----------

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
};

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 5e6) throw Object.assign(new Error('Payload too large'), { status: 413 });
    chunks.push(c);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch {
    throw Object.assign(new Error('Invalid JSON'), { status: 400 });
  }
}

async function serveStatic(pathname, res) {
  const rel = path.normalize(decodeURIComponent(pathname === '/' ? '/index.html' : pathname));
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden', 'text/plain');
  try {
    const data = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch {
    send(res, 404, 'Not found', 'text/plain');
  }
}

const server = http.createServer(async (req, res) => {
  const { pathname, searchParams } = new URL(req.url, 'http://localhost');
  try {
    if (pathname === '/api/config') return send(res, 200, { libraryDir: LIBRARY_DIR });
    if (pathname === '/api/settings' && req.method === 'GET') return send(res, 200, await readSettings());
    const g = pathname.match(/^\/api\/goals\/(\d{4})$/);
    if (g && req.method === 'PUT') return send(res, 200, await setGoal(g[1], (await readJson(req)).goal));
    const so = pathname.match(/^\/api\/shelf-order\/([a-z]+)$/);
    if (so && req.method === 'PUT') return send(res, 200, await setShelfOrder(so[1], (await readJson(req)).order ?? null));
    if (pathname === '/api/books' && req.method === 'GET') return send(res, 200, await listBooks());
    if (pathname === '/api/books' && req.method === 'POST') return send(res, 201, await createBook(await readJson(req)));
    if (pathname === '/api/ranks' && req.method === 'PUT') {
      await setRanks((await readJson(req)).order);
      return send(res, 200, { ok: true });
    }
    if (pathname === '/api/categorize-missing' && req.method === 'POST') return send(res, 200, await categorizeMissing());
    if (pathname === '/api/weather') return send(res, 200, await sfWeather());
    if (pathname === '/api/search') {
      const q = (searchParams.get('q') || '').trim();
      return send(res, 200, q ? await searchOpenLibrary(q) : []);
    }
    const m = pathname.match(/^\/api\/books\/(.+)$/);
    if (m) {
      const id = decodeURIComponent(m[1]);
      if (req.method === 'GET') return send(res, 200, toBook(id, await readBookFile(id)));
      if (req.method === 'PUT') return send(res, 200, await updateBook(id, await readJson(req)));
      if (req.method === 'DELETE') { await deleteBook(id); return send(res, 200, { ok: true }); }
    }
    if (pathname.startsWith('/api/')) return send(res, 404, { error: 'Unknown endpoint' });
    return serveStatic(pathname, res);
  } catch (e) {
    if (!e.status) console.error(e);
    send(res, e.status || 500, { error: e.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n  📚 The Bookshelf is open at http://localhost:${PORT}`);
  console.log(`     Library folder: ${LIBRARY_DIR}\n`);
});
