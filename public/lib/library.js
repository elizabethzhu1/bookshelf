// The library itself: books as Markdown (YAML frontmatter + body), the reading
// journal, settings, Open Library lookups and recommendations. It runs in
// Node (server.js keeps books as .md files on disk) and in the browser (the
// public site keeps the same Markdown text in the visitor's browser), so it
// never touches the filesystem itself. It works through a small store:
//
//   list()            → [{ id, text }]   every book file
//   read(id)          → text, or null if there's no such book
//   write(id, text)   create or replace
//   remove(id)        delete (the disk store moves it to .trash instead)
//   readSettings()    → object or null
//   writeSettings(s)
//
// Every function throws errors with a `status` (400, 404, 502…) the server
// sends as the HTTP status; the browser shows the message.

import { parse, formatEntry } from './frontmatter.js';
import { guessCategory } from '../categories.js';
import { recommend, similar } from './recommend.js';

export const STATUSES = ['reading', 'tbr', 'wishlist', 'read', 'dnf'];
// Frontmatter keys this app manages, in the order they're written.
const KNOWN = ['title', 'author', 'status', 'owned', 'rating', 'rank', 'pages', 'progress',
  'started', 'finished', 'year', 'isbn', 'cover', 'category', 'tags', 'added'];

const fail = (message, status) => Object.assign(new Error(message), { status });
const today = () => new Date().toLocaleDateString('en-CA');

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
//   - 2026-11-05 · pp. 120–141 · 32 min · Lovely chapter on the House.
//   - 2026-11-06 · p. 160
//   - 2026-11-07 · Just a note, no pages.
// Lines that don't fit the pattern are kept exactly as written.

const JOURNAL_LINE = /^[-*][ \t]+(\d{4}-\d{2}-\d{2})(?:[ \t]+·[ \t]+pp?\.[ \t]*(\d+)(?:[ \t]*[–-][ \t]*(\d+))?)?(?:[ \t]+·[ \t]+(\d+)[ \t]*min)?(?:[ \t]+·[ \t]+(.*))?[ \t]*$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseJournal(text) {
  return text.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
    const m = line.match(JOURNAL_LINE);
    if (!m) return { raw: line };
    const [, date, a, b, min, note] = m;
    const [from, to] = b !== undefined ? [Number(a), Number(b)] : [null, a !== undefined ? Number(a) : null];
    return { date, from, to, minutes: min !== undefined ? Number(min) : null, note: (note || '').trim() };
  });
}

function formatJournal(entries) {
  return entries.map(e => {
    if (e.raw) return e.raw;
    const parts = [e.date];
    if (e.to != null) parts.push(e.from != null ? `pp. ${e.from}–${e.to}` : `p. ${e.to}`);
    if (e.minutes) parts.push(`${e.minutes} min`);
    if (e.note) parts.push(e.note);
    return `- ${parts.join(' · ')}`;
  }).join('\n');
}

// Accept entries from the app: valid dates, whole page numbers, one-line notes.
function cleanJournal(list) {
  if (!Array.isArray(list)) throw fail('Journal must be a list', 400);
  const page = v => (v === null || v === undefined || v === '' ? null : Number.isInteger(Number(v)) && Number(v) >= 0 ? Number(v) : NaN);
  const out = list.slice(0, 5000).map(e => {
    if (e && typeof e.raw === 'string') return { raw: e.raw.replace(/\n/g, ' ').trim() };
    const date = String(e?.date ?? '');
    const from = page(e?.from), to = page(e?.to);
    if (!ISO_DATE.test(date) || Number.isNaN(from) || Number.isNaN(to)) {
      throw fail('Each journal entry needs a date (YYYY-MM-DD) and whole page numbers', 400);
    }
    const minutes = Number.isFinite(Number(e?.minutes)) && Number(e.minutes) > 0 ? Math.round(Number(e.minutes)) : null;
    return { date, from: to == null ? null : from, to, minutes, note: String(e?.note ?? '').replace(/\s+/g, ' ').trim().slice(0, 2000) };
  }).filter(e => e.raw || e.to != null || e.minutes || e.note);
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

export function toBook(id, text) {
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

export function serialize(book, prevRaw = {}) {
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

// A book's id is its file name: "Title - Author.md".
export function validId(id) {
  return typeof id === 'string' && /\.md$/i.test(id) && !id.startsWith('.') && !/[\\/]/.test(id) && id.length < 300;
}
export function filenameFor(book) {
  return [book.title, book.author].filter(Boolean).join(' - ')
    .replace(/[\\/:*?"<>|#^[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'Untitled';
}

// ---------- Open Library lookup ----------

const OL_HEADERS = typeof window === 'undefined' ? { 'User-Agent': 'BookshelfLocalApp/1.0' } : {};

export async function searchOpenLibrary(q) {
  const fields = 'title,author_name,first_publish_year,cover_i,isbn,number_of_pages_median,subject';
  const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=12&fields=${fields}`;
  const r = await fetch(url, { headers: OL_HEADERS, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw fail(`Open Library returned ${r.status}`, 502);
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
    const r = await fetch(url, { headers: OL_HEADERS, signal: AbortSignal.timeout(10000) });
    if (!r.ok) continue;
    const { docs = [] } = await r.json();
    const category = guessCategory(docs.flatMap(d => (d.subject || []).slice(0, 40)));
    if (category) return category;
  }
  return null;
}

// ---------- the library over a store ----------

export function createLibrary(store) {
  const readText = async id => {
    if (!validId(id)) throw fail('Invalid book id', 400);
    const text = await store.read(id);
    if (text == null) throw fail('Book not found', 404);
    return text;
  };

  async function readSettings() {
    const s = await store.readSettings().catch(() => null);
    const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
    return { goals: obj(s?.goals), shelfOrder: obj(s?.shelfOrder) };
  }
  const writeSettings = async s => { await store.writeSettings(s); return s; };

  async function listBooks() {
    const books = (await store.list()).map(({ id, text }) => {
      try { return toBook(id, text); } catch (e) { console.warn(`Skipping ${id}: ${e.message}`); return null; }
    });
    return books.filter(Boolean).sort((a, b) => a.title.localeCompare(b.title));
  }

  async function getBook(id) { return toBook(id, await readText(id)); }

  async function createBook(input) {
    if (!input?.title || !String(input.title).trim()) throw fail('A title is required', 400);
    const base = filenameFor(input);
    let id = `${base}.md`;
    for (let n = 2; (await store.read(id)) != null; n++) id = `${base} (${n}).md`;
    const status = STATUSES.includes(input.status) ? input.status : 'tbr';
    const book = {
      ...input,
      title: String(input.title).trim(),
      status,
      owned: input.owned ?? status !== 'wishlist',
      added: input.added || today(),
    };
    await store.write(id, serialize(book), { create: true });
    return getBook(id);
  }

  async function updateBook(id, input) {
    const text = await readText(id);
    const prev = parse(text);
    const current = toBook(id, text);
    const { skipAutoLog, ...fields } = input ?? {};
    const merged = { ...current, ...fields };
    if (!STATUSES.includes(merged.status)) merged.status = current.status;
    // The app only sends `journal` when editing it; otherwise keep what's saved.
    merged.journal = fields.journal !== undefined ? cleanJournal(fields.journal) : current.journal;
    const before = current.progress ?? 0;
    const after = num(merged.progress);
    if (!skipAutoLog && after !== null && after > before) merged.journal = logProgress(merged.journal, today(), before, after);
    await store.write(id, serialize(merged, prev.raw));
    return getBook(id);
  }

  async function deleteBook(id) {
    await readText(id);
    await store.remove(id);
  }

  async function setRanks(order) {
    if (!Array.isArray(order)) throw fail('order must be an array of ids', 400);
    await Promise.all(order.map(async (id, i) => {
      const text = await readText(id);
      const book = toBook(id, text);
      if (book.rank !== i + 1) await store.write(id, serialize({ ...book, rank: i + 1 }, parse(text).raw));
    }));
  }

  // The hand-arranged order of one shelf, as a list of ids. null clears it,
  // so the shelf goes back to its default sort.
  async function setShelfOrder(status, order) {
    if (!STATUSES.includes(status)) throw fail('Unknown shelf', 400);
    if (order !== null && !(Array.isArray(order) && order.length <= 10000 && order.every(id => typeof id === 'string' && id.length < 300))) {
      throw fail('Order must be a list of book ids', 400);
    }
    const settings = await readSettings();
    if (order === null) delete settings.shelfOrder[status]; else settings.shelfOrder[status] = order;
    return writeSettings(settings);
  }

  async function setGoal(year, goal) {
    if (!/^\d{4}$/.test(String(year))) throw fail('Invalid year', 400);
    const n = num(goal);
    if (n !== null && (!Number.isInteger(n) || n < 1 || n > 1000)) throw fail('Goal must be a whole number from 1 to 1000', 400);
    const settings = await readSettings();
    if (n === null) delete settings.goals[year]; else settings.goals[year] = n;
    return writeSettings(settings);
  }

  // Fill in a category for every book that doesn't have one yet. Books Open
  // Library can't place are left alone.
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

  // Recommendations: remembered until a rating, status or book changes, or
  // for half an hour.
  let recCache = null;
  async function recommendations(refresh = false) {
    const books = await listBooks();
    const sig = books.map(b => `${b.id}:${b.status}:${b.rating ?? ''}`).join('|');
    if (!refresh && recCache && recCache.sig === sig && Date.now() - recCache.at < 30 * 60_000) return recCache.data;
    const data = await recommend(books);
    recCache = { sig, at: Date.now(), data };
    return data;
  }

  const similarTo = async id => similar(await getBook(id), await listBooks());

  // One entry point for both the HTTP server and the in-browser library:
  // the same routes the app calls.
  async function handle(method, url, body) {
    const { pathname, searchParams } = new URL(url, 'http://local');
    if (pathname === '/api/settings' && method === 'GET') return readSettings();
    const g = pathname.match(/^\/api\/goals\/(\d{4})$/);
    if (g && method === 'PUT') return setGoal(g[1], body?.goal);
    const so = pathname.match(/^\/api\/shelf-order\/([a-z]+)$/);
    if (so && method === 'PUT') return setShelfOrder(so[1], body?.order ?? null);
    if (pathname === '/api/books' && method === 'GET') return listBooks();
    if (pathname === '/api/books' && method === 'POST') return createBook(body);
    if (pathname === '/api/ranks' && method === 'PUT') { await setRanks(body?.order); return { ok: true }; }
    if (pathname === '/api/categorize-missing' && method === 'POST') return categorizeMissing();
    if (pathname === '/api/recommendations') return recommendations(searchParams.has('refresh'));
    if (pathname === '/api/similar') return similarTo(searchParams.get('id') || '');
    if (pathname === '/api/search') {
      const q = (searchParams.get('q') || '').trim();
      return q ? searchOpenLibrary(q) : [];
    }
    const m = pathname.match(/^\/api\/books\/(.+)$/);
    if (m) {
      const id = decodeURIComponent(m[1]);
      if (method === 'GET') return getBook(id);
      if (method === 'PUT') return updateBook(id, body);
      if (method === 'DELETE') { await deleteBook(id); return { ok: true }; }
    }
    return null; // not a library route
  }

  return { handle, listBooks, getBook, createBook, updateBook, deleteBook, setRanks, setShelfOrder, setGoal, readSettings, writeSettings, categorizeMissing, recommendations, similarTo };
}
