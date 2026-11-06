// Book recommendations from Open Library, based on your own shelves.
//
// 1. Each of your books gets a weight from what you did with it: rated 4–5
//    stars counts most, read or reading counts, owning or wanting it counts a
//    little, and low ratings or "did not finish" count against.
// 2. Open Library's subjects for each book (minus catch-alls like "Fiction"
//    or "Large type books") add up, by those weights, into a taste profile.
// 3. Open Library is searched for the top subjects, and for more by authors
//    you liked, sorted by readers' ratings.
// 4. Each candidate is scored by how much of your taste it shares, plus a
//    little for being well rated; anything already in your library is left
//    out. Each comes with the reason: which of your books it's like, and
//    which subjects they share.

import { guessCategory } from '../categories.js';

const OL = 'https://openlibrary.org/search.json';
// Browsers won't let a page set User-Agent (and Open Library's CORS doesn't need it).
const HEADERS = typeof window === 'undefined' ? { 'User-Agent': 'BookshelfLocalApp/1.0' } : {};
const FIELDS = 'key,title,author_name,first_publish_year,cover_i,isbn,number_of_pages_median,subject,ratings_average,ratings_count';

// Subjects too broad (or too bookkeeping) to say anything about taste.
const GENERIC = /^(fiction|non-?fiction|novel|novels|literature|general|accessible book|protected daisy|in library|large type books|lending library|internet archive wishlist|open library staff picks|reading level|english language|translations?( into .*)?|long now manual for civilization|new york times (reviewed|bestseller)|nyt:|textbooks|juvenile (fiction|literature)|history and criticism|criticism and interpretation|popular print disabled books|readers|fictional works|classics|classic literature|fiction, general|.*\(fictional works.*|literary|biography|history|social life and customs|manners and customs|american literature|english literature|french literature|russian literature|spanish language|french language|study and teaching)$/;
const tidy = s => String(s).toLowerCase().replace(/\s+/g, ' ').replace(/[.\s]+$/, '').trim();
// Catalogue bookkeeping and other-language duplicates of the same idea.
const NOISE = /m(œ|oe)urs|dictionaries|^histoire|^historia|^hermanos|literatur|reading level|open_syllabus|^romans?\b|nouvelles|littérature|^ficci[oó]n|^novela|^roman\b|children's (fiction|stories)|^family$|^love$|^friendship$|^comics|^american fiction|^english fiction|^fiction in english|^[a-z]+ language|^specimens|^bibliography|^catalogs|^exhibitions|^(19th|20th|21st) century$|^sources$|^biography & autobiography|^fiction \/|^nyt|award|^staff picks|^large type/;
// Other-language subjects (Open Library mixes in foreign editions' tags) and bare nationalities.
const FOREIGN = /[à-öø-ÿœ]|\b(e|y|et|de|del|la|le|les|el|und|der|die|des|du)\b|^(pauvres|hermanos|familia|amor|muerte|guerra|histoire)$/;
const NATIONALITY = /^(spanish|french|english|german|italian|russian|americans?|british)$/;
const usable = s => s.length > 2 && s.length < 60 && !GENERIC.test(s) && !NOISE.test(s) && !FOREIGN.test(s) && !NATIONALITY.test(s)
  && !/^fiction, /.test(s) && !/\d{4}-\d{4}/.test(s);
// Anthologies, condensed editions, box sets: not a book to go and read next.
const COLLECTION = /\b(condensed|selections|omnibus|box(ed)? set|collected (works|novels|stories)|complete (works|novels)|novels \d|works of|anthology|reader's digest|three novels|four novels|trilogy set)\b/i;
const latin = t => !/[^\u0000-\u024F\u1E00-\u1EFF\u2000-\u206F\s]/.test(t); // skip titles not in Latin script
const normTitle = t => String(t).toLowerCase().split(/[:(]/)[0].normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9]+/g, ' ').trim();

// How much each book says about your taste.
export function bookWeight(b) {
  if (b.status === 'dnf') return -1.2;
  if (b.rating) return (b.rating - 2.75) * 1.3; // 5★ ≈ 2.9, 4★ ≈ 1.6, 3★ ≈ .3, 2★ ≈ −1
  return { read: 1.2, reading: .9, tbr: .45, wishlist: .4 }[b.status] ?? .3;
}

// ---- Open Library, with a cache so repeat visits are quick ----
const cache = new Map(); // url -> { at, data }
const TTL = 6 * 3600_000;
async function getJSON(url) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw Object.assign(new Error(`Open Library returned ${r.status}`), { status: 502 });
  const data = await r.json();
  cache.set(url, { at: Date.now(), data });
  return data;
}
const search = params => getJSON(`${OL}?${new URLSearchParams({ fields: FIELDS, lang: 'en', ...params })}`).then(d => d.docs || []);

// Run tasks a few at a time, to be polite to Open Library.
async function pool(items, n, fn) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]).catch(() => null); }
  }));
  return out;
}

// Find one of your books on Open Library: its work key and subjects.
async function lookup(b) {
  const tries = [];
  if (b.isbn) tries.push({ q: `isbn:${b.isbn}` });
  tries.push({ title: b.title, ...(b.author ? { author: b.author.split(',')[0].trim() } : {}) });
  for (const p of tries) {
    const docs = await search({ ...p, limit: '3' });
    const doc = docs.find(d => d.subject?.length) || docs[0];
    if (doc) return { key: doc.key, subjects: [...new Set((doc.subject || []).slice(0, 60).map(tidy).filter(usable))] };
  }
  return { key: null, subjects: [] };
}

function profileFrom(entries) {
  // entries: [{ book, weight, subjects }]
  const subjects = new Map(); // subject -> { weight, books: Map(book -> weight) }
  for (const { book, weight, subjects: list } of entries) {
    for (const s of list) {
      const e = subjects.get(s) || { weight: 0, books: new Map() };
      e.weight += weight;
      e.books.set(book, (e.books.get(book) || 0) + weight);
      subjects.set(s, e);
    }
  }
  return subjects;
}

// Score and explain candidates against a taste profile.
function rank(docs, { profile, authors, exclude, limit }) {
  const byAuthorName = d => authors.has(String(d.author_name?.[0] || '').toLowerCase());
  const seen = new Set();
  const perAuthor = new Map();
  const scored = [];
  for (const d of docs) {
    if (!d?.title || !d.cover_i || !d.author_name?.length) continue;
    const t = normTitle(d.title);
    if (seen.has(d.key) || seen.has(t) || exclude.keys.has(d.key) || exclude.titles.has(t)) continue;
    if (!latin(d.title) || COLLECTION.test(d.title) || (d.ratings_count || 0) < (byAuthorName(d) ? 2 : 8)) continue; // enough readers to trust it
    if ([...exclude.titles].some(x => x.length > 5 && t.includes(x))) continue; // e.g. "East of Eden and The Wayward Bus"
    seen.add(d.key); seen.add(t);
    const subs = [...new Set((d.subject || []).slice(0, 80).map(tidy).filter(usable))];
    const shared = subs.map(s => [s, profile.get(s)]).filter(([, e]) => e && e.weight > 0);
    const because = new Map();
    let overlap = 0;
    for (const [, e] of shared) {
      overlap += Math.min(e.weight, 4);
      for (const [book, w] of e.books) if (w > 0) because.set(book, (because.get(book) || 0) + w);
    }
    const author = d.author_name[0];
    const byAuthor = authors.get(author.toLowerCase());
    if (byAuthor) because.set(byAuthor.book, (because.get(byAuthor.book) || 0) + byAuthor.weight * 3);
    if (!overlap && !byAuthor) continue;
    const quality = Math.log10((d.ratings_count || 0) + 1) * .7 + ((d.ratings_average || 3.6) - 3.6) * 1.2;
    const score = overlap * 1.4 + (byAuthor ? byAuthor.weight * 1.6 : 0) + quality;
    scored.push({ d, score, shared, because, byAuthor });
  }
  scored.sort((a, b) => b.score - a.score);
  const out = [];
  for (const s of scored) {
    const a = s.d.author_name[0].toLowerCase();
    if ((perAuthor.get(a) || 0) >= 2) continue; // keep the list varied
    perAuthor.set(a, (perAuthor.get(a) || 0) + 1);
    out.push(s);
    if (out.length >= limit) break;
  }
  return out.map(({ d, shared, because, byAuthor }) => ({
    key: d.key,
    title: d.title,
    author: d.author_name.slice(0, 2).join(', '),
    year: d.first_publish_year ?? null,
    pages: d.number_of_pages_median ?? null,
    isbn: (d.isbn || []).find(i => i.length === 13) || (d.isbn || [])[0] || null,
    cover: `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg`,
    category: guessCategory(d.subject),
    rating: d.ratings_average ? Math.round(d.ratings_average * 10) / 10 : null,
    ratings: d.ratings_count || 0,
    because: [...because.entries()].sort((x, y) => y[1] - x[1]).slice(0, 2).map(([book]) => ({ id: book.id, title: book.title, rating: book.rating, status: book.status })),
    moreBy: byAuthor ? byAuthor.book.author : null,
    shared: shared.sort((x, y) => y[1].weight - x[1].weight).slice(0, 3).map(([s]) => s),
    url: `https://openlibrary.org${d.key}`,
  }));
}

const lookups = new Map(); // book id + title -> lookup result
async function lookupAll(books) {
  return pool(books, 4, async b => {
    const k = `${b.id}|${b.title}|${b.author}|${b.isbn}`;
    if (!lookups.has(k)) lookups.set(k, await lookup(b));
    return lookups.get(k);
  });
}

function exclusions(books, found) {
  return {
    keys: new Set(found.map(f => f?.key).filter(Boolean)),
    titles: new Set(books.map(b => normTitle(b.title))),
  };
}

// Recommendations for the whole library.
export async function recommend(books, { limit = 24 } = {}) {
  const found = await lookupAll(books);
  const entries = books.map((book, i) => ({ book, weight: bookWeight(book), subjects: found[i]?.subjects || [] }));
  const profile = profileFrom(entries);
  // Subjects shared by several of your books say the most; break ties by weight.
  const top = [...profile.entries()]
    .filter(([, e]) => e.weight > 0)
    .sort((a, b) => (b[1].books.size - a[1].books.size) || (b[1].weight - a[1].weight))
    .slice(0, 8);
  // Authors you clearly liked: rated 4+ or finished.
  const authors = new Map();
  for (const { book, weight } of entries) {
    if (weight < 1 || !book.author) continue;
    const name = book.author.split(',')[0].trim();
    const prev = authors.get(name.toLowerCase());
    if (!prev || prev.weight < weight) authors.set(name.toLowerCase(), { name, weight, book });
  }
  const queries = [
    ...top.map(([s]) => ({ subject: s, sort: 'rating', limit: '30' })),
    ...[...authors.values()].sort((a, b) => b.weight - a.weight).slice(0, 4).map(a => ({ author: a.name, sort: 'rating', limit: '12' })),
  ];
  const results = (await pool(queries, 4, search)).flat().filter(Boolean);
  return {
    taste: top.map(([s, e]) => ({ subject: s, weight: Math.round(e.weight * 10) / 10, books: e.books.size })),
    basis: {
      rated: books.filter(b => b.rating).length,
      read: books.filter(b => b.status === 'read').length,
      reading: books.filter(b => b.status === 'reading').length,
      other: books.filter(b => ['tbr', 'wishlist'].includes(b.status)).length,
    },
    books: rank(results, { profile, authors, exclude: exclusions(books, found), limit }),
  };
}

// Books like one particular book.
export async function similar(book, library, { limit = 8 } = {}) {
  const [found] = await lookupAll([book]);
  const subjects = (found?.subjects || []).slice(0, 12);
  const profile = profileFrom([{ book, weight: 1.5, subjects }]);
  const name = book.author ? book.author.split(',')[0].trim() : null;
  const authors = new Map(name ? [[name.toLowerCase(), { name, weight: .8, book }]] : []);
  const queries = [
    ...subjects.slice(0, 4).map(s => ({ subject: s, sort: 'rating', limit: '25' })),
    ...(name ? [{ author: name, sort: 'rating', limit: '8' }] : []),
  ];
  const results = (await pool(queries, 4, search)).flat().filter(Boolean);
  const libFound = await lookupAll(library);
  return { books: rank(results, { profile, authors, exclude: exclusions(library, libFound), limit }) };
}
