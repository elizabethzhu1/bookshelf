import { CATEGORY_NAMES } from './categories.js';
import { MATERIALS, MATERIAL_IDS, plankURI } from './shelf-material.js';
import { DECOR, DECOR_KINDS, isDecor, decorKind, newDecorId, decorSVG } from './decor.js';
import { runTour } from './tour.js';
// ---------- helpers ----------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => new Date().toLocaleDateString('en-CA');
const THIS_YEAR = new Date().getFullYear();

const STATUSES = [
  ['reading', 'Reading'],
  ['tbr', 'To Read'],
  ['wishlist', 'Wishlist'],
  ['read', 'Read'],
  ['dnf', 'Did Not Finish'],
];
const LABEL = Object.fromEntries(STATUSES);

// Muted cloth-binding colours for spines and faux covers.
const BINDINGS = [
  { bg: '#9a4a36' }, { bg: '#56695a' }, { bg: '#3e4a5c' }, { bg: '#c7a25a', light: true },
  { bg: '#7a6250' }, { bg: '#6d6178' }, { bg: '#2f2d2a' }, { bg: '#ddd4c3', light: true },
  { bg: '#8b3a44' }, { bg: '#5f7a7a' }, { bg: '#b9a88c', light: true }, { bg: '#4a4f45' },
];

const state = {
  books: [],
  config: {},
  settings: { goals: {}, shelfOrder: {} },
  reviewYear: THIS_YEAR, // a year, or 'all'
  journalYear: THIS_YEAR,
  journalDay: null, // ISO date picked on the calendar
  pick: null, // { id, reason, odds }: the To Read book chosen by the spinner
  view: localStorage.getItem('view') || 'shelf',
  shelfMode: localStorage.getItem('shelfMode') || 'covers', // 'covers' | 'spines'
  arrange: localStorage.getItem('arrange') || 'mine', // 'mine' (hand-arranged) | 'category'
  decorShelf: 'tbr', // where the Decorate menu puts new objects
  material: MATERIAL_IDS.includes(localStorage.getItem('shelfMaterial')) ? localStorage.getItem('shelfMaterial') : 'oak',
  q: '',
  filter: 'all',
  sort: 'title',
  openId: null,
  dirty: false,
};

function hash(s) {
  let h = 2166136261;
  for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const binding = b => BINDINGS[hash(b.title + b.author) % BINDINGS.length];
const PARTICLES = new Set(['de', 'du', 'da', 'del', 'della', 'di', 'le', 'la', 'van', 'von', 'der', 'den', 'ter', 'st.']);
const lastName = a => {
  const words = (a || '').replace(/\[\[|\]\]/g, '').split(',')[0].trim().split(/\s+/);
  let i = words.length - 1;
  while (i > 0 && PARTICLES.has(words[i - 1].toLowerCase())) i--;
  return words.slice(i).join(' ');
};
const byId = id => state.books.find(b => b.id === id);
const fmtDate = s => {
  if (!s) return '';
  const d = new Date(`${s}T00:00:00`);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

// The public copy on GitHub Pages has no server: the build (scripts/build-site.js)
// saves the library as JSON files and marks the page <html data-static>.
// Reads come from those files; anything that would change the library is off.
const STATIC = 'static' in document.documentElement.dataset;
const READ_ONLY = 'This is a read-only copy of the bookshelf.';
let staticSimilar;
async function staticApi(url, method) {
  if (method !== 'GET') throw new Error(READ_ONLY);
  const get = async f => { const r = await fetch(`data/${f}`); if (!r.ok) throw new Error(`${r.status} ${r.statusText}`); return r.json(); };
  const [path, query] = url.split('?');
  if (path === '/api/books') return get('books.json');
  if (path === '/api/settings') return get('settings.json');
  if (path === '/api/config') return get('config.json');
  if (path === '/api/recommendations') return get('recommendations.json');
  if (path === '/api/similar') {
    staticSimilar ??= get('similar.json');
    return { books: (await staticSimilar)[new URLSearchParams(query).get('id')] ?? [] };
  }
  throw new Error(READ_ONLY);
}

// The make-your-own site (<html data-local>) has no server either: each
// visitor's library lives in their browser, run by the same library code the
// server uses (lib/library.js over lib/browser-store.js).
const LOCAL = 'local' in document.documentElement.dataset;
// The public sites link to each other (set by scripts/build-site.js).
const EXAMPLE_URL = document.documentElement.dataset.example || 'liz/';
const MAKER_URL = document.documentElement.dataset.maker || '';
let localLibrary;
async function localApi(url, method, body) {
  if (url === '/api/config') return { libraryDir: '' };
  localLibrary ??= Promise.all([import('./lib/library.js'), import('./lib/browser-store.js')])
    .then(([{ createLibrary }, { browserStore }]) => createLibrary(browserStore));
  // JSON round trip: the app gets plain copies, as it would from a server.
  const out = await (await localLibrary).handle(method, url, body && JSON.parse(JSON.stringify(body)));
  if (out === null) throw new Error('Unknown endpoint');
  return JSON.parse(JSON.stringify(out));
}

async function api(url, { method = 'GET', body } = {}) {
  if (STATIC) return staticApi(url, method);
  if (LOCAL) return localApi(url, method, body);
  const r = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `${r.status} ${r.statusText}`);
  return data;
}
const bookUrl = id => `/api/books/${encodeURIComponent(id)}`;

let toastTimer;
function toast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('error', isError);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), isError ? 5000 : 2200);
}

function replaceBook(saved, oldId = saved.id) {
  const i = state.books.findIndex(b => b.id === oldId);
  if (i >= 0) state.books[i] = saved; else state.books.push(saved);
}

// ---------- shared fragments ----------

function starsHTML(r, interactive = false) {
  const v = r || 0;
  const attrs = interactive
    ? `role="slider" tabindex="0" aria-label="Rating" aria-valuemin="0" aria-valuemax="5" aria-valuenow="${v}"`
    : `role="img" aria-label="${v} out of 5"`;
  return `<span class="stars${interactive ? ' interactive' : ''}" data-rating="${v}" ${attrs}>`
    + `<span class="bg">★★★★★</span><span class="fg" style="width:${v * 20}%">★★★★★</span></span>`;
}

function coverHTML(b) {
  const c = binding(b);
  return `<div class="cover${c.light ? ' light' : ''}" style="--c:${c.bg}">
    <div class="faux"><span class="faux-title">${esc(b.title)}</span><span class="faux-rule"></span><span class="faux-author">${esc(b.author)}</span></div>
    ${b.cover ? `<img src="${esc(b.cover)}" alt="" loading="lazy" draggable="false" onerror="this.remove()">` : ''}
  </div>`;
}

function field(label, name, type, value, cls = '', placeholder = '') {
  return `<label class="${cls}"><span class="label">${label}</span>`
    + `<input type="${type}" name="${name}" value="${esc(value ?? '')}" placeholder="${esc(placeholder)}"${type === 'number' ? ' min="0" step="1"' : ''}></label>`;
}

// Categories: the standard list plus any you've typed yourself, for suggestions.
const UNCATEGORIZED = 'Uncategorized';
const categoryOf = b => b.category || UNCATEGORIZED;
function categoryOrder(a, b) {
  const rank = c => (c === UNCATEGORIZED ? 1e6 : CATEGORY_NAMES.includes(c) ? CATEGORY_NAMES.indexOf(c) : 1e3);
  return rank(a) - rank(b) || a.localeCompare(b);
}
function categoryField(value) {
  const all = [...new Set([...CATEGORY_NAMES, ...state.books.map(b => b.category).filter(Boolean)])].sort(categoryOrder);
  return `<label><span class="label">Category</span>
    <input type="text" name="category" value="${esc(value ?? '')}" list="categoryList" placeholder="e.g. Fiction" autocomplete="off"></label>
    <datalist id="categoryList">${all.map(c => `<option value="${esc(c)}">`).join('')}</datalist>`;
}

function statusPills(selected) {
  return `<fieldset class="pills"><legend class="label">Status</legend>${STATUSES.map(([v, l]) =>
    `<label class="pill"><input type="radio" name="status" value="${v}"${selected === v ? ' checked' : ''}><span>${l}</span></label>`).join('')}</fieldset>`;
}

const empty = msg => `<p class="empty">${msg}</p>`;

// ---------- masthead ----------

function renderLedger() {
  const c = s => state.books.filter(b => b.status === s).length;
  const readYear = state.books.filter(b => b.status === 'read' && (b.finished || '').startsWith(String(THIS_YEAR))).length;
  $('#ledger').innerHTML = [
    `${c('reading')} reading`,
    `${c('tbr')} to read`,
    `${c('wishlist')} wishlist`,
    `${readYear}${goalFor(THIS_YEAR) ? ` of ${goalFor(THIS_YEAR)}` : ''} read in ${THIS_YEAR}`,
  ].map(s => `<span>${s}</span>`).join('');
}

// ---------- view: shelves ----------

// In covers mode, books with a cover image stand face-out; everything else shows its spine.
// Page-block depth for the 3D face-out books, scaled by page count.
const thickness = b => (b.pages ? Math.max(8, Math.min(30, Math.round(b.pages / 20))) : 14);

function shelfBook(b) {
  if (state.shelfMode === 'spines' || !b.cover) return spine(b);
  return `<div class="slot${state.pick?.id === b.id ? ' picked' : ''}"${state.arrange === 'mine' ? ' draggable="true"' : ''}><button class="faceout" data-action="open" data-id="${esc(b.id)}" style="--t:${thickness(b)}px"
    title="${esc(b.title)}${b.author ? ' — ' + esc(b.author) : ''}" aria-label="Open ${esc(b.title)}">
    <span class="book3d">${coverHTML(b)}<span class="pages"></span></span>
  </button></div>`;
}

// ---------- spine colours sampled from cover images ----------
// A spine takes the average colour of its cover's left edge (where a real
// spine wraps round), with light or dark text chosen for contrast. Results are
// cached in localStorage; covers whose host blocks reading pixels keep the
// cloth-binding colour.

const COLOR_KEY = 'coverColors';
const coverColors = (() => { try { return JSON.parse(localStorage.getItem(COLOR_KEY)) || {}; } catch { return {}; } })();
const sampling = new Map();

function sampleCover(url) {
  if (coverColors[url]) return Promise.resolve(coverColors[url]);
  if (!sampling.has(url)) sampling.set(url, new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const w = 20, h = 30;
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        const ctx = cv.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, w, h);
        // Columns 1-3 of 20 (skipping the outermost, which is often a scan edge).
        const d = ctx.getImageData(1, 1, 3, h - 2).data;
        let r = 0, g = 0, bl = 0;
        const n = d.length / 4;
        for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; bl += d[i + 2]; }
        [r, g, bl] = [r / n, g / n, bl / n].map(Math.round);
        const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
        const lum = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(bl);
        const color = { bg: '#' + [r, g, bl].map(v => v.toString(16).padStart(2, '0')).join(''), light: lum > 0.2 }; // dark text once it out-contrasts light text
        coverColors[url] = color;
        try { localStorage.setItem(COLOR_KEY, JSON.stringify(coverColors)); } catch { /* storage full: skip caching */ }
        resolve(color);
      } catch {
        resolve(null); // canvas tainted: the image host doesn't allow reading pixels
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  }));
  return sampling.get(url);
}

// Recolour any spines rendered before their cover colour was known.
function tintSpines() {
  $$('.spine[data-cover]').forEach(el => {
    sampleCover(el.dataset.cover).then(c => {
      if (!c || !el.isConnected) return;
      el.style.setProperty('--c', c.bg);
      el.classList.toggle('light', c.light);
      el.removeAttribute('data-cover');
    });
  });
}

function spine(b) {
  const h = hash(b.title + b.author);
  const sampled = b.cover && coverColors[b.cover];
  const c = sampled || binding(b);
  const pending = b.cover && !sampled ? ` data-cover="${esc(b.cover)}"` : '';
  const height = 158 + (h % 6) * 9;
  const width = b.pages ? Math.max(34, Math.min(62, Math.round(b.pages / 9))) : 34 + ((h >> 4) % 18);
  return `<div class="slot${state.pick?.id === b.id ? ' picked' : ''}"${state.arrange === 'mine' ? ' draggable="true"' : ''}><button class="spine band-${h % 3}${c.light ? ' light' : ''}" style="--c:${c.bg};height:${height}px;width:${width}px"${pending}
    data-action="open" data-id="${esc(b.id)}" title="${esc(b.title)}${b.author ? ' — ' + esc(b.author) : ''}">
    <span class="spine-title">${esc(b.title)}</span><span class="spine-author">${esc(lastName(b.author))}</span>
  </button></div>`;
}

// Apply a shelf's hand-arranged order, if it has one. Books not in the saved
// order (added since it was saved) go first, in the shelf's default sort.
function arranged(status, books) {
  const saved = state.settings.shelfOrder?.[status];
  if (!saved?.length) return books;
  const pos = new Map(saved.map((id, i) => [id, i]));
  return [
    ...books.filter(b => !pos.has(b.id)),
    ...books.filter(b => pos.has(b.id)).sort((a, b) => pos.get(a.id) - pos.get(b.id)),
  ];
}

// Grouped by category, each group starts with a little label card standing on
// the plank; within a group the books keep your arranged order.
function categoryRow(books) {
  const groups = new Map();
  books.forEach(b => groups.set(categoryOf(b), [...(groups.get(categoryOf(b)) || []), b]));
  return [...groups.keys()].sort(categoryOrder).map(c =>
    `<div class="cat-divider${c === UNCATEGORIZED ? ' none' : ''}"><span class="cat-card"><span class="cat-name">${esc(c)}</span><small>${groups.get(c).length}</small></span></div>`
    + groups.get(c).map(shelfBook).join('')).join('');
}

// Books and objects together, in the shelf's saved order. Objects are kept
// only in "My order" (grouping by category shows just the books).
function arrangedItems(status, books) {
  const saved = state.settings.shelfOrder?.[status];
  if (!saved?.length) return books;
  const byBook = new Map(books.map(b => [b.id, b]));
  const placed = new Set(saved);
  return [
    ...books.filter(b => !placed.has(b.id)),
    ...saved.map(id => (isDecor(id) ? (DECOR[decorKind(id)] ? { decor: true, id, kind: decorKind(id) } : null) : byBook.get(id))).filter(Boolean),
  ];
}

const decorOut = new Set(JSON.parse(localStorage.getItem('decorOut') || '[]')); // candles you've blown out
function decorSlot(item) {
  const d = DECOR[item.kind];
  const out = item.kind === 'candle' && decorOut.has(item.id);
  return `<div class="slot decor-slot decor-${item.kind}${out ? ' out' : ''}"${state.arrange === 'mine' ? ' draggable="true"' : ''}>`
    + `<button class="decor" data-action="decor" data-id="${esc(item.id)}" title="${esc(d.name)}" aria-label="${esc(d.name)}">${decorSVG(item.kind)}</button>`
    + `<button class="decor-remove" data-action="removeDecor" data-value="${esc(item.id)}" aria-label="Remove ${esc(d.name.toLowerCase())}" tabindex="-1">×</button></div>`;
}

// Each shelf is one long plank that scrolls sideways, however many books it holds.
function shelf(status, title, sub, books) {
  const custom = state.settings.shelfOrder?.[status]?.some(id => !isDecor(id)); // objects alone don't count as rearranging
  books = arranged(status, books);
  const byCategory = state.arrange === 'category';
  const items = byCategory ? books : arrangedItems(status, books); // books and objects, in shelf order
  const note = byCategory
    ? 'Grouped by category.'
    : custom
    ? `Arranged by hand · <button class="link-btn reset-order" data-action="resetOrder" data-value="${status}">restore default order</button>`
    : sub;
  return `<section class="shelf-section">
    <h2 class="plaque">${title} <small>${books.length}</small>${status === 'tbr' && books.length
      ? '<button class="pick-btn" data-action="pickNext">What should I read next?</button>' : ''}</h2>
    <p class="sub">${note}</p>
    ${items.length ? `<div class="shelf-row">
      <button class="shelf-arrow prev" data-action="scrollShelf" data-dir="-1" aria-label="Scroll ${title} left" tabindex="-1">‹</button>
      <div class="shelf-scroll" data-shelf="${status}"><div class="spines${byCategory ? ' by-category' : ''}" data-shelf="${status}">${byCategory ? categoryRow(books) : items.map(x => (x.decor ? decorSlot(x) : shelfBook(x))).join('')}</div></div>
      <button class="shelf-arrow next" data-action="scrollShelf" data-dir="1" aria-label="Scroll ${title} right" tabindex="-1">›</button>
    </div>` : byCategory ? `<div class="spines bare"><p class="empty-shelf">an empty shelf</p></div>`
      // still a drop target, so an empty shelf can be decorated
      : `<div class="shelf-row"><div class="shelf-scroll" data-shelf="${status}"><div class="spines bare" data-shelf="${status}"><p class="empty-shelf">an empty shelf</p></div></div></div>`}
    ${status === 'tbr' ? pickCardHTML() : ''}
  </section>`;
}

// Show the arrows and edge fades only on the sides that have more books.
function updateScroller(row) {
  const s = row.querySelector('.shelf-scroll');
  row.classList.toggle('can-prev', s.scrollLeft > 2);
  row.classList.toggle('can-next', s.scrollLeft + s.clientWidth < s.scrollWidth - 2);
}
const updateScrollers = () => $$('.shelf-row').forEach(updateScroller);
window.addEventListener('resize', updateScrollers);

async function saveShelfOrder(status, ids) {
  const prev = state.settings.shelfOrder?.[status] ?? null;
  state.settings.shelfOrder = { ...state.settings.shelfOrder, [status]: ids };
  render();
  try {
    state.settings = await api(`/api/shelf-order/${status}`, { method: 'PUT', body: { order: ids } });
  } catch (err) {
    state.settings.shelfOrder = { ...state.settings.shelfOrder, [status]: prev };
    render();
    toast(err.message === 'Unknown endpoint' ? 'Restart the server (npm start) to save your shelf order.' : err.message, true);
  }
}

function nowCard(b) {
  const pct = b.pages && b.progress ? Math.min(100, Math.round((b.progress / b.pages) * 100)) : 0;
  return `<article class="now-card">
    <button class="cover-btn now-book" data-action="open" data-id="${esc(b.id)}" aria-label="Open ${esc(b.title)}" style="--t:${thickness(b)}px">
      <span class="book3d">${coverHTML(b)}<span class="pages"></span></span></button>
    <div class="now-body">
      <button class="link-btn now-title" data-action="open" data-id="${esc(b.id)}">${esc(b.title)}</button>
      <p class="by">${esc(b.author)}</p>
      <div class="progress" aria-hidden="true"><span style="width:${pct}%"></span></div>
      <p class="progress-label">p. <input type="number" min="0"${b.pages ? ` max="${b.pages}"` : ''} value="${b.progress ?? ''}" data-progress data-id="${esc(b.id)}" aria-label="Current page">
        ${b.pages ? `of ${b.pages} &nbsp;·&nbsp; ${pct}%` : ''}</p>
      ${paceHTML(b)}
      ${b.started ? `<p class="meta">begun ${fmtDate(b.started)}</p>` : ''}
      <div class="now-actions">
        <button class="link-btn start-reading" data-action="startReading" data-id="${esc(b.id)}">▶ Start reading</button>
        <button class="link-btn finish" data-action="finish" data-id="${esc(b.id)}">Mark finished</button>
      </div>
    </div>
  </article>`;
}

// A new, empty library: what this is and where to start.
function welcomeHTML() {
  return `<section class="welcome-card">
    <h2>Welcome to your bookshelf</h2>
    <p>Add the books you own, are reading, have finished or want to read. They'll stand on these shelves, and the
      catalog, rankings, journal and recommendations fill in as you go.${LOCAL ? ' Everything is saved in this browser, just for you.' : ''}</p>
    <p class="welcome-actions">
      <button class="stamp" data-action="add">Add your first book</button>
      <button class="link-btn" data-action="tour">Take the tour</button>
      ${LOCAL ? `<a class="link-btn" href="${esc(EXAMPLE_URL)}">See an example shelf</a>` : ''}
    </p>
  </section>`;
}

function shelfView() {
  const of = s => state.books.filter(b => b.status === s);
  const byAuthor = (a, b) => lastName(a.author).localeCompare(lastName(b.author)) || a.title.localeCompare(b.title);
  const reading = of('reading');
  const read = of('read').sort((a, b) => (b.finished || '').localeCompare(a.finished || '') || a.title.localeCompare(b.title));
  const dnf = of('dnf');
  const modes = [['covers', 'Covers'], ['spines', 'Spines']].map(([v, l]) =>
    `<button class="chip${state.shelfMode === v ? ' active' : ''}" data-action="shelfMode" data-value="${v}" aria-pressed="${state.shelfMode === v}">${l}</button>`).join('');
  const arranges = [['mine', 'My order'], ['category', 'By category']].map(([v, l]) =>
    `<button class="chip${state.arrange === v ? ' active' : ''}" data-action="arrange" data-value="${v}" aria-pressed="${state.arrange === v}">${l}</button>`).join('');
  const missing = state.books.filter(b => !b.category).length;
  const fill = state.arrange === 'category' && missing
    ? `<p class="cat-missing">${plural(missing, 'book')} ${missing === 1 ? 'has' : 'have'} no category yet.
        <button class="link-btn" data-action="fillCategories">Fill in from Open Library</button>
        <span class="muted">or set one in a book’s details.</span></p>`
    : '';
  const swatch = id => `<span class="swatch" style="--sw-day:${esc(plankURI(id))};--sw-night:${esc(plankURI(id, true))}"></span>`;
  const picker = `<details class="material-pick">
      <summary class="chip">${swatch(state.material)}${esc(MATERIALS[state.material].name)} shelf</summary>
      <div class="material-menu" role="group" aria-label="Shelf material">
        ${MATERIAL_IDS.map(id => `<button class="material-opt${id === state.material ? ' active' : ''}" data-action="material" data-value="${id}" aria-pressed="${id === state.material}">
          ${swatch(id)}<span>${esc(MATERIALS[id].name)}</span></button>`).join('')}
      </div>
    </details>`;
  const decorShelves = [['tbr', 'On the Shelf'], ['read', 'Finished'], ['dnf', 'Set Aside'], ['wishlist', 'Wishlist']]
    .filter(([s]) => s !== 'dnf' || dnf.length);
  if (!decorShelves.some(([s]) => s === state.decorShelf) && decorShelves.length) state.decorShelf = decorShelves[0][0];
  const decorate = decorShelves.length ? `<details class="decor-pick">
      <summary class="chip">Decorate</summary>
      <div class="decor-menu">
        <p class="decor-to"><span>Put it on</span>${decorShelves.map(([s, l]) =>
          `<button class="chip${state.decorShelf === s ? ' active' : ''}" data-action="decorShelf" data-value="${s}">${l}</button>`).join('')}</p>
        <div class="decor-grid">${DECOR_KINDS.map(k => `<button class="decor-opt" data-action="addDecor" data-value="${k}"${state.arrange === 'mine' ? ' draggable="true"' : ''}>
          <span class="decor-thumb">${decorSVG(k, .5)}</span><span>${esc(DECOR[k].name)}</span></button>`).join('')}</div>
        <p class="decor-help">Drag an object onto any shelf, or click to add it. On the shelf, drag it anywhere, even to another shelf. Click it to play with it; hover for × to remove it.</p>
      </div>
    </details>` : '';
  return `${state.books.length ? '' : welcomeHTML()}
    <div class="shelf-mode">${decorate}${decorate ? '<span class="mode-sep" aria-hidden="true"></span>' : ''}${picker}<span class="mode-sep" aria-hidden="true"></span><div role="group" aria-label="Shelf order">${arranges}</div><span class="mode-sep" aria-hidden="true"></span><div role="group" aria-label="Shelf display">${modes}</div></div>
    ${fill}
    <section class="shelf-section">
      <h2 class="plaque">Currently Reading <small>${reading.length}</small></h2>
      ${reading.length ? `<div class="now-reading">${reading.map(nowCard).join('')}</div>` : empty('Nothing on the nightstand. Pull something from the shelf below.')}
    </section>
    ${shelf('tbr', 'On the Shelf', 'Owned, not yet read.', of('tbr').sort(byAuthor))}
    ${shelf('read', 'Finished', 'Most recent first.', read)}
    ${dnf.length ? shelf('dnf', 'Set Aside', 'Did not finish.', dnf) : ''}
    ${shelf('wishlist', 'Wishlist', 'To buy.', of('wishlist').sort(byAuthor))}`;
}

// ---------- what should I read next? ----------
// Every To Read book gets a weight: 1, plus a bonus for each tag you've rated
// highly on average (a 5★ tag adds 3, a 4★ tag adds 1.5, 3★ or less adds 0).
// The spinner sweeps along the shelf, slows, and pulls the weighted pick out.

function tagAffinity() {
  const sums = new Map();
  state.books.filter(b => b.status === 'read' && b.rating).forEach(b => b.tags.forEach(t => {
    const k = t.toLowerCase();
    const s = sums.get(k) || { tag: t, total: 0, n: 0 };
    s.total += b.rating; s.n += 1;
    sums.set(k, s);
  }));
  return new Map([...sums].map(([k, s]) => [k, { tag: s.tag, avg: s.total / s.n, n: s.n }]));
}

function pickOdds(books) {
  const aff = tagAffinity();
  return books.map(b => {
    const liked = b.tags.map(t => aff.get(t.toLowerCase())).filter(a => a && a.avg > 3).sort((x, y) => y.avg - x.avg);
    const weight = 1 + liked.reduce((sum, a) => sum + (a.avg - 3) * 1.5, 0);
    const top = liked[0];
    const reason = top
      ? `You’ve rated ${esc(top.tag)} books ${top.avg.toFixed(1)}★ on average${liked.length > 1 ? `, and ${liked.length - 1} more of its tags score well` : ''}.`
      : 'A lucky draw: none of its tags have ratings behind them yet.';
    return { weight, reason };
  });
}

function pickCardHTML() {
  const b = state.pick && byId(state.pick.id);
  if (!b || b.status !== 'tbr') return '';
  return `<div class="pick-card" role="status">
    <span class="label">Read next</span>
    <p class="pick-title">${esc(b.title)}${b.author ? ` <span class="by">${esc(b.author)}</span>` : ''}</p>
    <p class="pick-reason">${state.pick.reason} <span class="mono">${state.pick.odds}% chance</span></p>
    <div class="pick-actions">
      <button class="stamp" data-action="startPick">Start reading</button>
      <button class="link-btn" data-action="open" data-id="${esc(b.id)}">Open card</button>
      <button class="link-btn" data-action="pickNext">Spin again</button>
      <button class="link-btn" data-action="dismissPick">Not now</button>
    </div>
  </div>`;
}

let spinning = false;
const wait = ms => new Promise(r => setTimeout(r, ms));
const centreIn = (sc, slot, behavior = 'auto') =>
  sc.scrollTo({ left: slot.offsetLeft - sc.clientWidth / 2 + slot.offsetWidth / 2, behavior });

async function pickNext() {
  if (spinning) return;
  const row = $('.spines[data-shelf="tbr"]');
  if (!row) { toast('Nothing on your To Read shelf yet.'); return; }
  const slots = $$(':scope > .slot:not(.decor-slot)', row);
  const books = slots.map(s => byId(s.firstElementChild.dataset.id));
  const odds = pickOdds(books);
  const total = odds.reduce((sum, o) => sum + o.weight, 0);
  let r = Math.random() * total, target = 0;
  while (target < odds.length - 1 && r >= odds[target].weight) { r -= odds[target].weight; target++; }

  spinning = true;
  view.classList.add('spinning');
  state.pick = null;
  $('.pick-card')?.remove();
  slots.forEach(s => s.classList.remove('picked'));
  const sc = row.closest('.shelf-scroll');
  if (slots.length > 1 && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const laps = Math.max(1, Math.ceil(18 / slots.length));
    const steps = laps * slots.length + target;
    for (let k = 0; k <= steps && row.isConnected; k++) {
      const lit = slots[k % slots.length];
      slots.forEach(s => s.classList.toggle('lit', s === lit));
      const delay = 45 + 430 * (k / steps) ** 3; // fast sweep, slowing to a stop
      centreIn(sc, lit, delay > 140 ? 'smooth' : 'auto');
      await wait(delay);
    }
    slots.forEach(s => s.classList.remove('lit'));
  }
  spinning = false;
  view.classList.remove('spinning');
  state.pick = { id: books[target].id, reason: odds[target].reason, odds: Math.round((odds[target].weight / total) * 100) };
  render();
  const picked = $('.spines[data-shelf="tbr"] .slot.picked');
  if (picked) centreIn(picked.closest('.shelf-scroll'), picked, 'smooth');
}

// ---------- reading journal ----------

const isoDay = d => d.toLocaleDateString('en-CA');
const entryPages = e => (e.from != null && e.to != null && e.to > e.from ? e.to - e.from : 0);
const fmtMinutes = m => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`);
const entryRange = e => [e.from != null && e.to != null ? `pp. ${e.from}–${e.to} · ${plural(e.to - e.from, 'page')}` : e.to != null ? `to p. ${e.to}` : '',
  e.minutes ? fmtMinutes(e.minutes) : ''].filter(Boolean).join(' · ');
const longDate = iso => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const allEntries = () => state.books.flatMap(b => (b.journal || []).filter(e => e.date).map(e => ({ ...e, book: b })));

// Add an entry (or extend that day's entry) for a book. Pages start where the
// last earlier entry left off.
function withEntry(b, { date, to, note, minutes = null }) {
  const journal = (b.journal || []).map(e => ({ ...e }));
  const same = journal.find(e => !e.raw && e.date === date);
  if (same) {
    if (to != null) same.to = same.to != null ? Math.max(same.to, to) : to;
    if (minutes) same.minutes = (same.minutes || 0) + minutes;
    if (note) same.note = [same.note, note].filter(Boolean).join(' ');
    if (same.from != null && same.to != null && same.from >= same.to) same.from = null;
    return journal;
  }
  let from = null;
  if (to != null) {
    const earlier = journal.filter(e => !e.raw && e.date < date && e.to != null).map(e => e.to);
    from = earlier.length ? Math.max(...earlier) : date === today() ? (b.progress ?? 0) : null;
    if (from != null && from >= to) from = null;
  }
  journal.push({ date, from, to, minutes, note: note || '' });
  return journal;
}

async function saveJournal(b, journal, progress = b.progress) {
  const saved = await api(bookUrl(b.id), { method: 'PUT', body: { journal, progress, skipAutoLog: true } });
  replaceBook(saved);
  return saved;
}

function streaks(dates, year) {
  let d = new Date();
  if (!dates.has(isoDay(d))) d.setDate(d.getDate() - 1);
  let current = 0;
  while (dates.has(isoDay(d))) { current++; d.setDate(d.getDate() - 1); }
  let longest = 0, run = 0, prev = null;
  [...dates].filter(x => x.startsWith(String(year))).sort().forEach(x => {
    const t = new Date(`${x}T00:00:00`);
    run = prev && Math.round((t - prev) / 864e5) === 1 ? run + 1 : 1; // round: DST days are 23 or 25 hours
    longest = Math.max(longest, run);
    prev = t;
  });
  return { current, longest };
}

const level = day => (!day ? 0 : day.pages >= 100 ? 4 : day.pages >= 50 ? 3 : day.pages >= 25 ? 2 : 1);

// GitHub-style year grid: one column per week (Monday first), shaded by pages read.
function calendarHTML(year, byDay) {
  const jan1 = new Date(year, 0, 1);
  const start = new Date(year, 0, 1 - ((jan1.getDay() + 6) % 7));
  const days = Math.round((new Date(year, 11, 31) - start) / 864e5) + 1;
  const weeks = Math.ceil(days / 7);
  const todayIso = today();
  const cells = [], months = [];
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    if (d.getFullYear() !== year) { cells.push('<span class="day out"></span>'); continue; }
    const iso = isoDay(d);
    if (d.getDate() === 1) months.push(`<span style="grid-column:${Math.floor(i / 7) + 1} / span 4">${MONTHS[d.getMonth()]}</span>`);
    const day = byDay.get(iso);
    const tip = `${fmtDate(iso)}: ${day ? `${day.pages ? plural(day.pages, 'page') : 'reading logged'} · ${[...new Set(day.list.map(e => e.book.title))].join(', ')}` : 'nothing logged'}`;
    const cls = [`day l${level(day)}`, iso > todayIso ? 'future' : '', iso === todayIso ? 'today' : '', iso === state.journalDay ? 'selected' : ''].filter(Boolean).join(' ');
    cells.push(`<button class="${cls}" data-action="journalDay" data-value="${iso}" data-tip="${esc(tip)}" aria-label="${esc(tip)}"${iso > todayIso ? ' disabled' : ''}></button>`);
  }
  return `<div class="cal-scroll"><div class="cal" style="--weeks:${weeks}">
      <div class="cal-months">${months.join('')}</div>
      <div class="cal-days"><span>Mon</span><span></span><span>Wed</span><span></span><span>Fri</span><span></span><span></span></div>
      <div class="cal-grid">${cells.join('')}</div>
    </div></div>
    <div class="cal-legend" title="Pages per day: 1–24, 25–49, 50–99, 100+">Less ${[0, 1, 2, 3, 4].map(l => `<span class="day l${l}"></span>`).join('')} More</div>`;
}

function logFormHTML() {
  const reading = state.books.filter(b => b.status === 'reading');
  const others = state.books.filter(b => b.status !== 'reading' && b.status !== 'wishlist').sort((a, b) => a.title.localeCompare(b.title));
  if (!reading.length && !others.length) return '';
  const opt = b => `<option value="${esc(b.id)}">${esc(b.title)}${b.progress ? ` (p. ${b.progress})` : ''}</option>`;
  return `<form id="logForm" class="log-form" autocomplete="off">
    <span class="label">Log some reading</span>
    <div class="log-fields">
      <select name="book" aria-label="Book">${reading.length ? `<optgroup label="Reading">${reading.map(opt).join('')}</optgroup>` : ''}${others.length ? `<optgroup label="Other books">${others.map(opt).join('')}</optgroup>` : ''}</select>
      <label>to page <input type="number" name="to" min="0" step="1" placeholder="—"></label>
      <input type="text" name="note" placeholder="A thought, a quote, where you were…" aria-label="Note">
      <input type="date" name="date" value="${today()}" max="${today()}" aria-label="Date">
      <button class="stamp" type="submit">Log</button>
    </div>
  </form>`;
}

function journalView() {
  const entries = allEntries();
  const years = [...new Set([THIS_YEAR, ...entries.map(e => Number(e.date.slice(0, 4)))])].sort((a, b) => b - a);
  if (!years.includes(state.journalYear)) state.journalYear = THIS_YEAR;
  const y = state.journalYear;
  const inYear = entries.filter(e => e.date.startsWith(String(y)));
  const byDay = new Map();
  inYear.forEach(e => {
    const day = byDay.get(e.date) || { pages: 0, list: [] };
    day.pages += entryPages(e);
    day.list.push(e);
    byDay.set(e.date, day);
  });
  const { current, longest } = streaks(new Set(entries.map(e => e.date)), y);
  const pages = inYear.reduce((sum, e) => sum + entryPages(e), 0);
  const minutes = inYear.reduce((sum, e) => sum + (e.minutes || 0), 0);
  const tile = (label, value, note = '') => `<div class="tile"><span class="label">${label}</span><span class="tile-value">${value}</span>${note ? `<span class="tile-note">${note}</span>` : ''}</div>`;
  const chips = years.map(v => `<button class="chip${y === v ? ' active' : ''}" data-action="journalYear" data-value="${v}">${v}</button>`).join('');

  const shownDays = [...byDay.keys()].filter(d => !state.journalDay || d === state.journalDay).sort().reverse();
  const feed = shownDays.map(d => `<li class="feed-day">
      <h4 class="feed-date">${longDate(d)}${byDay.get(d).pages ? ` <small>${plural(byDay.get(d).pages, 'page')}</small>` : ''}</h4>
      <ul class="feed-entries">${byDay.get(d).list.map(e => `<li class="entry">
        <button class="thumb-btn" data-action="open" data-id="${esc(e.book.id)}" tabindex="-1" aria-hidden="true"><span class="thumb">${coverHTML(e.book)}</span></button>
        <div class="entry-body">
          <button class="link-btn entry-title" data-action="open" data-id="${esc(e.book.id)}">${esc(e.book.title)}</button>
          ${entryRange(e) ? `<span class="entry-range mono">${entryRange(e)}</span>` : ''}
          ${e.note ? `<p class="entry-note">${esc(e.note)}</p>` : ''}
        </div>
      </li>`).join('')}</ul>
    </li>`).join('');

  return `<div class="chips review-years">${chips}</div>
    <h2 class="review-title">Reading journal</h2>
    ${logFormHTML()}
    <div class="tiles">
      ${tile('Days read', byDay.size, `in ${y}`)}
      ${tile('Pages logged', pages.toLocaleString())}
      ${minutes ? tile('Time read', fmtMinutes(minutes), 'in reading sessions') : ''}
      ${tile('Current streak', plural(current, 'day'), current ? 'keep it going' : 'read today to start one')}
      ${tile('Longest streak', plural(longest, 'day'), `in ${y}`)}
    </div>
    <section class="review-section"><h3 class="plaque">${y}</h3>${calendarHTML(y, byDay)}</section>
    <section class="review-section"><h3 class="plaque">${state.journalDay ? longDate(state.journalDay) : 'Entries'}
      ${state.journalDay ? '<button class="link-btn show-all" data-action="journalDay" data-value="">show all</button>' : ''}</h3>
      ${feed ? `<ol class="feed">${feed}</ol>` : empty(state.journalDay ? 'Nothing logged that day.' : 'No entries yet. Move a bookmark or log some reading above, and it appears here.')}
    </section>`;
}

// ---------- view: card catalog ----------

const SORTS = {
  title: ['Title', (a, b) => a.title.localeCompare(b.title)],
  author: ['Author', (a, b) => lastName(a.author).localeCompare(lastName(b.author)) || a.title.localeCompare(b.title)],
  rating: ['Rating', (a, b) => (b.rating || 0) - (a.rating || 0) || a.title.localeCompare(b.title)],
  added: ['Recently added', (a, b) => (b.added || '').localeCompare(a.added || '')],
  finished: ['Recently finished', (a, b) => (b.finished || '').localeCompare(a.finished || '')],
  category: ['Category', (a, b) => categoryOrder(categoryOf(a), categoryOf(b)) || a.title.localeCompare(b.title)],
};

function catalogView() {
  const count = v => (v === 'all' ? state.books.length : state.books.filter(b => b.status === v).length);
  const chips = [['all', 'All'], ...STATUSES].map(([v, l]) =>
    `<button class="chip${state.filter === v ? ' active' : ''}" data-action="filter" data-value="${v}">${l} <small>${count(v)}</small></button>`).join('');
  return `<div class="toolbar">
      <input id="catalogSearch" type="search" placeholder="Search titles, authors, categories, tags…" value="${esc(state.q)}" aria-label="Search">
      <label class="sort">Sort by <select id="catalogSort">${Object.entries(SORTS).map(([k, [l]]) => `<option value="${k}"${state.sort === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
    </div>
    <div class="chips">${chips}</div>
    <div id="catalogTable"></div>`;
}

function renderCatalogTable() {
  const q = state.q.toLowerCase().trim();
  const rows = state.books
    .filter(b => state.filter === 'all' || b.status === state.filter)
    .filter(b => !q || [b.title, b.author, b.isbn, b.category, ...b.tags].join(' ').toLowerCase().includes(q))
    .sort(SORTS[state.sort][1]);
  $('#catalogTable').innerHTML = rows.length ? `<table class="catalog">
    <thead><tr><th class="c"><span class="sr-only">Cover</span></th><th>Title</th><th>Author</th><th>Category</th><th>Status</th><th>Rating</th><th>Finished</th></tr></thead>
    <tbody>${rows.map(b => `<tr data-action="open" data-id="${esc(b.id)}" tabindex="0">
      <td class="c"><div class="thumb">${coverHTML(b)}</div></td>
      <td class="t">${esc(b.title)}${b.tags.length ? `<span class="tags">${b.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</span>` : ''}</td>
      <td>${esc(b.author)}</td>
      <td class="cat">${b.category ? esc(b.category) : '<span class="muted">—</span>'}</td>
      <td><span class="status s-${b.status}">${LABEL[b.status]}</span>${!b.owned && b.status !== 'wishlist' ? ' <span class="muted">· not owned</span>' : ''}</td>
      <td>${b.rating ? starsHTML(b.rating) : ''}</td>
      <td class="mono">${fmtDate(b.finished)}</td>
    </tr>`).join('')}</tbody></table>` : empty('No cards in this drawer.');
}

// ---------- view: year in review ----------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Theme variables, so day and night each use their own validated pair.
const PIE_COLORS = { read: 'var(--pie-read)', unread: 'var(--pie-unread)' };
const goalFor = y => state.settings.goals?.[y] ?? null;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const finishedYear = b => Number((b.finished || '').slice(0, 4)) || null;

function finishedIn(year) {
  return state.books
    .filter(b => b.status === 'read' && (year === 'all' || finishedYear(b) === year))
    .sort((a, b) => (a.finished || '').localeCompare(b.finished || '') || a.title.localeCompare(b.title));
}

function goalHTML(year, done) {
  const goal = goalFor(year);
  const form = `<form id="goalForm" class="goal-form" data-year="${year}">
      <label>${goal ? 'Change goal' : `Set a goal for ${year}`}
        <input type="number" name="goal" min="1" max="1000" step="1" value="${goal ?? ''}" placeholder="e.g. 24" aria-label="Books to read in ${year}"></label>
      <button class="link-btn" type="submit">Save</button>
    </form>`;
  if (!goal) return `<div class="goal">${form}</div>`;
  const pct = Math.min(100, Math.round((done / goal) * 100));
  let pace;
  if (done >= goal) pace = `Goal met${done > goal ? `, ${done - goal} over` : ''}.`;
  else if (year < THIS_YEAR) pace = `Finished ${plural(goal - done, 'book')} short.`;
  else {
    const start = new Date(year, 0, 1), end = new Date(year + 1, 0, 1);
    const expected = Math.floor(goal * ((Date.now() - start) / (end - start)));
    const diff = done - expected;
    pace = diff === 0 ? 'Right on pace.' : diff > 0 ? `${plural(diff, 'book')} ahead of pace.` : `${plural(-diff, 'book')} behind pace.`;
    pace += ` ${plural(goal - done, 'book')} to go.`;
  }
  return `<div class="goal">
    <p class="goal-figure"><strong>${done}</strong> of ${plural(goal, 'book')} <span class="goal-pct">${pct}%</span></p>
    <div class="meter" role="progressbar" aria-valuemin="0" aria-valuemax="${goal}" aria-valuenow="${done}" aria-label="Reading goal"><span style="width:${pct}%"></span></div>
    <p class="meta">${pace}</p>
    ${form}
  </div>`;
}

function statTiles(books) {
  const withPages = books.filter(b => b.pages);
  const pages = withPages.reduce((s, b) => s + b.pages, 0);
  const rated = books.filter(b => b.rating);
  const avg = rated.length ? rated.reduce((s, b) => s + b.rating, 0) / rated.length : null;
  const longest = withPages.slice().sort((a, b) => b.pages - a.pages)[0];
  const missing = books.length - withPages.length;
  const tile = (label, value, note = '') => `<div class="tile"><span class="label">${label}</span><span class="tile-value">${value}</span>${note ? `<span class="tile-note">${note}</span>` : ''}</div>`;
  return `<div class="tiles">
    ${tile('Books finished', books.length)}
    ${tile('Pages read', pages ? pages.toLocaleString() : '—', missing ? `${plural(missing, 'book')} without a page count` : '')}
    ${tile('Average rating', avg ? avg.toFixed(1) : '—', avg ? starsHTML(Math.round(avg * 2) / 2) : '')}
    ${tile('Longest book', longest ? `${longest.pages.toLocaleString()} pp.` : '—', longest ? esc(longest.title) : '')}
  </div>`;
}

// One bar per month (or per year, for "All time"). Single series, so no legend.
function barsHTML(buckets) {
  const max = Math.max(1, ...buckets.map(b => b.books.length));
  const peak = buckets.reduce((p, b) => (b.books.length > p.books.length ? b : p), buckets[0]);
  return `<div class="bars" role="list">${buckets.map(b => {
    const n = b.books.length;
    const tip = `${b.long}: ${plural(n, 'book')}${n ? ' — ' + b.books.map(x => x.title).join(', ') : ''}`;
    return `<div class="bar-col" role="listitem" tabindex="0" data-tip="${esc(tip)}" aria-label="${esc(tip)}">
      <span class="bar-value">${b === peak && n ? n : ''}</span>
      <span class="bar" style="height:calc((100% - 20px) * ${n / max})"></span>
      <span class="bar-label">${b.label}</span>
    </div>`;
  }).join('')}</div>`;
}

// Of the books you own, how many you've read. Covers the whole library, not one year.
function pieHTML(books) {
  const read = books.filter(b => b.status === 'read').length;
  const parts = [
    { name: 'Read', n: read, color: PIE_COLORS.read },
    { name: 'Not read yet', n: books.length - read, color: PIE_COLORS.unread },
  ];
  const total = books.length;
  const cx = 80, cy = 80, r = 76;
  const pt = a => `${(cx + r * Math.sin(a)).toFixed(2)},${(cy - r * Math.cos(a)).toFixed(2)}`;
  let a0 = 0;
  const slices = parts.filter(p => p.n).map(p => {
    const share = p.n / total;
    const tip = `${p.name}: ${plural(p.n, 'book')} (${Math.round(share * 100)}%)`;
    const attrs = `style="fill:${p.color}" data-tip="${esc(tip)}" tabindex="0" aria-label="${esc(tip)}"`;
    if (share === 1) return `<circle cx="${cx}" cy="${cy}" r="${r}" ${attrs}/>`;
    const a1 = a0 + share * 2 * Math.PI;
    const d = `M${cx},${cy}L${pt(a0)}A${r},${r} 0 ${share > .5 ? 1 : 0} 1 ${pt(a1)}Z`;
    a0 = a1;
    return `<path d="${d}" ${attrs}/>`;
  }).join('');
  const legend = parts.map(p => `<li><span class="swatch" style="background:${p.color}"></span>${p.name}
    <span class="legend-figure">${p.n} · ${Math.round((p.n / total) * 100)}%</span></li>`).join('');
  return `<div class="pie-wrap">
    <svg class="pie" viewBox="0 0 160 160" role="img" aria-label="${read} of the ${total} books you own are read">${slices}</svg>
    <ul class="legend">${legend}</ul>
  </div>`;
}

function reviewView() {
  const years = [...new Set([THIS_YEAR, ...state.books.filter(b => b.status === 'read').map(finishedYear).filter(Boolean)])].sort((a, b) => b - a);
  if (state.reviewYear !== 'all' && !years.includes(state.reviewYear)) state.reviewYear = THIS_YEAR;
  const y = state.reviewYear;
  const chips = [...years.map(v => [v, v]), ['all', 'All time']].map(([v, l]) =>
    `<button class="chip${y === v ? ' active' : ''}" data-action="reviewYear" data-value="${v}">${l}</button>`).join('');
  const books = finishedIn(y);
  const ownedBooks = state.books.filter(b => b.owned);

  let buckets;
  if (y === 'all') {
    buckets = years.slice().sort((a, b) => a - b)
      .map(v => ({ label: String(v), long: String(v), books: books.filter(b => finishedYear(b) === v) }));
    const undated = books.filter(b => !finishedYear(b));
    if (undated.length) buckets.push({ label: 'n.d.', long: 'No finish date', books: undated });
  } else {
    buckets = MONTHS.map((m, i) => ({
      label: m, long: new Date(y, i, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
      books: books.filter(b => Number(b.finished.slice(5, 7)) === i + 1),
    }));
  }

  return `<div class="chips review-years">${chips}</div>
    <h2 class="review-title">${y === 'all' ? 'All time' : `${y} in books`}</h2>
    ${y !== 'all' ? `<section class="review-section"><h3 class="plaque">Reading goal</h3>${goalHTML(y, books.length)}</section>` : ''}
    ${books.length ? `<section class="review-section">${statTiles(books)}</section>` : ''}
    ${books.length || ownedBooks.length ? `<div class="review-charts">
      ${books.length ? `<section class="review-section"><h3 class="plaque">Books finished ${y === 'all' ? 'by year' : 'by month'}</h3>${barsHTML(buckets)}</section>` : '<div></div>'}
      ${ownedBooks.length ? `<section class="review-section"><h3 class="plaque">Your own books</h3><p class="sub">How many you’ve read, across your whole library.</p>${pieHTML(ownedBooks)}</section>` : ''}
    </div>` : ''}
    ${books.length ? `
      <section class="review-section"><h3 class="plaque">${y === 'all' ? 'Everything read' : 'The year’s reading'} <small>${books.length}</small></h3>
        <div class="review-covers">${books.map(b => `<button class="cover-btn" data-action="open" data-id="${esc(b.id)}" title="${esc(b.title)}${b.finished ? ' · finished ' + esc(fmtDate(b.finished)) : ''}">${coverHTML(b)}</button>`).join('')}</div>
      </section>`
    : empty(y === 'all' ? 'No finished books yet.' : `No books finished in ${y} yet.`)}`;
}

// ---------- view: rankings ----------

function rankedBooks() {
  return state.books
    .filter(b => b.status === 'read')
    .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || (b.rating || 0) - (a.rating || 0) || a.title.localeCompare(b.title));
}

function rankingsView() {
  const list = rankedBooks();
  if (!list.length) return empty('Finish a book and it will appear here, ready to be ranked.');
  return `<p></p>
    <ol class="rank-list" id="rankList">${list.map((b, i) => `
      <li class="rank-item" draggable="true" data-id="${esc(b.id)}">
        <span class="numeral">${i + 1}</span>
        <div class="thumb">${coverHTML(b)}</div>
        <div class="rank-body">
          <button class="link-btn rank-title" data-action="open" data-id="${esc(b.id)}">${esc(b.title)}</button>
          <span class="by">${esc(b.author)}</span>
        </div>
        <div class="rank-meta">${b.rating ? starsHTML(b.rating) : ''}<span class="mono">${(b.finished || '').slice(0, 4)}</span>${b.rank == null ? '<span class="unranked">unranked</span>' : ''}</div>
        <div class="arrows">
          <button data-action="move" data-id="${esc(b.id)}" data-dir="-1" aria-label="Move up"${i === 0 ? ' disabled' : ''}>▲</button>
          <button data-action="move" data-id="${esc(b.id)}" data-dir="1" aria-label="Move down"${i === list.length - 1 ? ' disabled' : ''}>▼</button>
        </div>
      </li>`).join('')}
    </ol>`;
}

function bindRankings() {
  const list = $('#rankList');
  if (!list) return;
  const renumber = () => $$('.numeral', list).forEach((n, i) => { n.textContent = i + 1; });
  list.addEventListener('dragstart', e => {
    const li = e.target.closest('.rank-item');
    if (!li) return;
    li.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', li.dataset.id);
  });
  list.addEventListener('dragover', e => {
    e.preventDefault();
    const drag = $('.dragging', list);
    if (!drag) return;
    const after = $$('.rank-item:not(.dragging)', list).find(li => {
      const r = li.getBoundingClientRect();
      return e.clientY < r.top + r.height / 2;
    });
    if (after) { if (after !== drag.nextSibling) list.insertBefore(drag, after); } else if (list.lastElementChild !== drag) list.appendChild(drag);
    renumber();
  });
  list.addEventListener('drop', e => e.preventDefault());
  list.addEventListener('dragend', () => {
    $('.dragging', list)?.classList.remove('dragging');
    const order = $$('.rank-item', list).map(li => li.dataset.id);
    const before = rankedBooks();
    const changed = order.some((id, i) => id !== before[i].id || before[i].rank !== i + 1);
    if (changed) saveOrder(order);
  });
}

async function saveOrder(order) {
  try {
    await api('/api/ranks', { method: 'PUT', body: { order } });
    order.forEach((id, i) => { const b = byId(id); if (b) b.rank = i + 1; });
    toast('Rankings updated.');
  } catch (e) {
    toast(e.message, true);
  }
  render();
}

function moveRank(id, dir) {
  const ids = rankedBooks().map(b => b.id);
  const i = ids.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  saveOrder(ids);
}

// ---------- detail drawer ----------

function journalListHTML(b) {
  const list = (b.journal || []).map((e, i) => [e, i]).filter(([e]) => !e.raw).reverse();
  if (!list.length) return '<li class="journal-empty">Nothing yet. Moving your page forward logs it here.</li>';
  return list.map(([e, i]) => `<li><span class="mono">${fmtDate(e.date)}</span>
    ${entryRange(e) ? `<span class="mono muted">${entryRange(e)}</span>` : ''}
    ${e.note ? `<span class="journal-note">${esc(e.note)}</span>` : ''}
    <button type="button" class="link-btn del" data-del-entry="${i}" aria-label="Delete entry from ${fmtDate(e.date)}">×</button></li>`).join('');
}

function drawerHTML(b) {
  const full = state.config.libraryDir ? `${state.config.libraryDir}/${b.id}` : b.id;
  return `<form class="card" id="bookForm" autocomplete="off" novalidate>
    <button type="button" class="close" data-close aria-label="Close">×</button>
    <div class="card-head">
      ${coverHTML(b)}
      <div class="head-fields">
        <p class="callno">${b.isbn ? `ISBN ${esc(b.isbn)}` : 'Accession card'}${b.added ? ` &nbsp;·&nbsp; acquired ${fmtDate(b.added)}` : ''}</p>
        <input class="title-input" name="title" value="${esc(b.title)}" aria-label="Title" required>
        <input class="author-input" name="author" value="${esc(b.author)}" placeholder="Author" aria-label="Author">
        ${starsHTML(b.rating, true)}
      </div>
    </div>
    ${statusPills(b.status)}
    <label class="check"><input type="checkbox" name="owned"${b.owned ? ' checked' : ''}> In my possession</label>
    ${b.status === 'wishlist' ? '<button type="button" class="link-btn bought" data-bought>I bought it → move to shelf</button>' : ''}
    <div class="grid">
      ${field('Started', 'started', 'date', b.started)}
      ${field('Finished', 'finished', 'date', b.finished)}
      ${field('Current page', 'progress', 'number', b.progress)}
      ${field('Pages', 'pages', 'number', b.pages)}
      ${field('Published', 'year', 'number', b.year)}
      ${field('ISBN', 'isbn', 'text', b.isbn)}
      ${categoryField(b.category)}
      ${field('Tags', 'tags', 'text', b.tags.join(', '), '', 'comma, separated')}
      ${field('Cover image URL', 'cover', 'text', b.cover, 'wide', 'https://…')}
    </div>
    <label class="block"><span class="label">Review</span>
      <textarea name="review" rows="6" class="ruled" placeholder="What did you make of it?">${esc(b.review)}</textarea></label>
    <label class="block"><span class="label">Notes <em>markdown</em></span>
      <textarea name="notes" rows="12" class="ruled" placeholder="Quotes, marginalia, half-formed thoughts…">${esc(b.notes)}</textarea></label>
    <section class="journal-block"><span class="label">Journal</span>
      <ol class="journal-list">${journalListHTML(b)}</ol>
      <div class="journal-add">
        <input type="date" data-j="date" value="${today()}" max="${today()}" aria-label="Entry date">
        <input type="number" data-j="to" min="0" step="1" placeholder="to page" aria-label="Read to page">
        <input type="text" data-j="note" placeholder="A note for this day…" aria-label="Entry note">
        <button type="button" class="link-btn" data-add-entry>Add</button>
      </div>
    </section>
    <section class="similar"><span class="label">Similar books</span>
      <div class="similar-list"><p class="muted rec-loading-inline">Finding books like this one…</p></div></section>
    <p class="filepath mono" title="${esc(full)}">${esc(b.id)}${LOCAL || STATIC ? '' : ` &nbsp;·&nbsp; <a href="obsidian://open?path=${encodeURIComponent(full)}">open in Obsidian</a>`}</p>
    <div class="actions">
      <button type="button" class="ghost danger" data-delete>Remove</button>
      <span class="spacer"></span>
      <span class="save-state mono" aria-live="polite">Changes save as you go</span>
    </div>
  </form>`;
}

let flushCard = async () => {}; // saves the open card's pending changes now

async function openDrawer(id) {
  await flushCard();
  const b = byId(id);
  if (!b) return;
  state.openId = id;
  state.dirty = false;
  const d = $('#drawer');
  d.innerHTML = drawerHTML(b);
  d.hidden = false;
  $('#scrim').hidden = false;
  void d.offsetWidth; // restart the slide-in transition
  d.classList.add('open');
  d.scrollTop = 0;
  bindDrawer(d, b);
  loadSimilar(b, d);
}

async function closeDrawer(force = false) {
  if (!state.openId) return;
  if (!force) await flushCard();
  flushCard = async () => {};
  state.openId = null;
  state.dirty = false;
  const d = $('#drawer');
  d.classList.remove('open');
  $('#scrim').hidden = true;
  setTimeout(() => { if (!state.openId) d.hidden = true; }, 260);
}

function bindStars(el, onChange) {
  const fg = $('.fg', el);
  const valueAt = e => {
    const r = $('.bg', el).getBoundingClientRect();
    return Math.max(0.5, Math.min(5, Math.ceil(((e.clientX - r.left) / r.width) * 10) / 2));
  };
  const show = v => { fg.style.width = `${v * 20}%`; };
  const set = v => { el.dataset.rating = v; el.setAttribute('aria-valuenow', v); show(v); onChange(); };
  el.addEventListener('mousemove', e => show(valueAt(e)));
  el.addEventListener('mouseleave', () => show(+el.dataset.rating));
  el.addEventListener('click', e => { const v = valueAt(e); set(v === +el.dataset.rating ? 0 : v); });
  el.addEventListener('keydown', e => {
    const cur = +el.dataset.rating;
    if (['ArrowRight', 'ArrowUp'].includes(e.key)) { e.preventDefault(); set(Math.min(5, cur + 0.5)); }
    if (['ArrowLeft', 'ArrowDown'].includes(e.key)) { e.preventDefault(); set(Math.max(0, cur - 0.5)); }
  });
}

function bindDrawer(d, b) {
  const form = $('#bookForm', d);
  const f = form.elements;
  const stateEl = $('.save-state', d);
  const showState = (text, cls = '') => { stateEl.textContent = text; stateEl.className = `save-state mono ${cls}`; };

  // ---- autosave ----
  // Every change saves itself: typing after a short pause, everything else
  // (stars, status, dates, checkboxes, page numbers when you leave the field)
  // straight away. Saves run one at a time; a change made during a save
  // queues one more save after it.
  let timer = 0, saving = null, again = false;
  const save = () => {
    clearTimeout(timer);
    state.dirty = false;
    if (saving) { again = true; return saving; }
    saving = (async () => {
      if (!f.title.value.trim()) { showState('A book needs a title', 'error'); return; }
      showState('Saving…');
      try {
        const saved = await api(bookUrl(b.id), { method: 'PUT', body: cardData() });
        replaceBook(saved);
        b = saved;
        render();
        showState('Saved', 'ok');
      } catch (err) {
        state.dirty = true;
        showState('Couldn’t save · retry', 'error');
        toast(err.message, true);
      }
    })().finally(() => {
      saving = null;
      if (again) { again = false; save(); }
    });
    return saving;
  };
  const soon = () => { state.dirty = true; showState('Editing…'); clearTimeout(timer); timer = setTimeout(save, 700); };
  flushCard = () => (state.dirty || saving ? save() : Promise.resolve());
  stateEl.addEventListener('click', () => { if (stateEl.classList.contains('error')) save(); });

  const outsideJournal = e => !e.target.closest('.journal-block'); // journal entries save on their own
  form.addEventListener('input', e => {
    if (!outsideJournal(e)) return;
    if (e.target.matches('textarea, input[type=text], input:not([type])')) soon();
    else if (e.target.type === 'number') { state.dirty = true; showState('Editing…'); } // saved on change
  });
  form.addEventListener('change', e => {
    if (!outsideJournal(e) || e.target.name === 'status') return; // status handled below
    if (e.target.matches('textarea, input[type=text], input:not([type])')) return; // already debounced
    save();
  });
  $('[data-close]', d).addEventListener('click', () => closeDrawer());
  bindStars($('.stars', d), save);

  function cardData() {
    const n = v => (v === '' ? null : Number(v));
    const { journal: _journal, ...rest } = b;
    return {
      ...rest,
      title: f.title.value.trim(),
      author: f.author.value.trim(),
      status: f.status.value,
      owned: f.owned.checked,
      rating: Number($('.stars', form).dataset.rating) || null,
      started: f.started.value || null,
      finished: f.finished.value || null,
      progress: n(f.progress.value),
      pages: n(f.pages.value),
      year: n(f.year.value),
      isbn: f.isbn.value.trim() || null,
      tags: f.tags.value.split(',').map(s => s.trim().replace(/^#/, '')).filter(Boolean),
      category: f.category.value.trim() || null,
      cover: f.cover.value.trim() || null,
      review: f.review.value,
      notes: f.notes.value,
    };
  }

  form.addEventListener('change', e => {
    if (e.target.name !== 'status') return;
    const s = e.target.value;
    if (s === 'reading' && !f.started.value) f.started.value = today();
    if (s === 'read') {
      if (!f.finished.value) f.finished.value = today();
      if (f.pages.value) f.progress.value = f.pages.value;
    }
    if (s === 'wishlist') f.owned.checked = false;
    else if (b.status === 'wishlist') f.owned.checked = true;
    save();
  });

  $('[data-bought]', d)?.addEventListener('click', async () => {
    form.querySelector('input[name=status][value=tbr]').checked = true;
    f.owned.checked = true;
    await save();
    $('[data-bought]', d)?.remove();
    toast('Moved to your shelf.');
  });

  form.addEventListener('submit', e => { e.preventDefault(); save(); }); // Enter or ⌘S: save now

  // Journal: add / delete entries straight away, without touching the rest of the card.
  const jb = $('.journal-block', d);
  const afterJournalSave = saved => {
    b = saved;
    if (f.progress.value === '' || Number(f.progress.value) < (saved.progress ?? 0)) f.progress.value = saved.progress ?? '';
    $('.journal-list', jb).innerHTML = journalListHTML(saved);
    render();
  };
  const addEntry = async () => {
    const date = $('[data-j=date]', jb).value || today();
    const toRaw = $('[data-j=to]', jb).value;
    const to = toRaw === '' ? null : Number(toRaw);
    const note = $('[data-j=note]', jb).value.trim();
    if (to == null && !note) { toast('Add a page number or a note.', true); return; }
    try {
      const saved = await saveJournal(b, withEntry(b, { date, to, note }), to != null && to > (b.progress ?? 0) ? to : b.progress);
      afterJournalSave(saved);
      $('[data-j=to]', jb).value = '';
      $('[data-j=note]', jb).value = '';
      toast('Added to the journal.');
    } catch (err) {
      toast(err.message, true);
    }
  };
  $('[data-add-entry]', jb).addEventListener('click', addEntry);
  jb.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.matches('.journal-add input')) { e.preventDefault(); addEntry(); }
  });
  jb.addEventListener('click', async e => {
    const del = e.target.closest('[data-del-entry]');
    if (!del) return;
    try {
      const journal = b.journal.filter((_, i) => i !== Number(del.dataset.delEntry));
      afterJournalSave(await saveJournal(b, journal));
      toast('Entry removed.');
    } catch (err) {
      toast(err.message, true);
    }
  });

  $('[data-delete]', d).addEventListener('click', async () => {
    if (!confirm(`Remove “${b.title}” from the library?\n\nThe file is moved to the .trash folder, not destroyed.`)) return;
    try {
      await api(bookUrl(b.id), { method: 'DELETE' });
      state.books = state.books.filter(x => x.id !== b.id);
      closeDrawer(true);
      render();
      toast('Removed from the library.');
    } catch (err) {
      toast(err.message, true);
    }
  });
}

// ---------- add dialog ----------

function openAdd() {
  const dlg = $('#addDialog');
  dlg.innerHTML = `<form class="add-card" id="addForm" autocomplete="off" novalidate>
    <button type="button" class="close" data-cancel aria-label="Close">×</button>
    <p class="eyebrow">New accession</p>
    <h2>Add a Book</h2>
    <div class="search-row">
      <input id="olq" type="search" placeholder="Look it up by title, author or ISBN…" aria-label="Search Open Library">
      <button type="button" id="olgo" class="ghost">Search</button>
    </div>
    <div id="olresults" class="results"></div>
    <p class="divider">Details</p>
    <div class="grid">
      ${field('Title', 'title', 'text', '', 'wide')}
      ${field('Author', 'author', 'text', '', 'wide')}
      ${field('Pages', 'pages', 'number', '')}
      ${field('Published', 'year', 'number', '')}
      ${field('ISBN', 'isbn', 'text', '')}
      ${categoryField('')}
      ${field('Cover image URL', 'cover', 'text', '', 'wide')}
    </div>
    ${statusPills('tbr')}
    <div class="actions">
      <button type="button" class="ghost" data-cancel>Cancel</button>
      <span class="spacer"></span>
      <button type="submit" class="stamp">Add to library</button>
    </div>
  </form>`;
  dlg.showModal();
  const form = $('#addForm', dlg);
  const f = form.elements;
  let results = [];

  const search = async () => {
    const q = $('#olq').value.trim();
    if (!q) return;
    const box = $('#olresults');
    box.innerHTML = '<p class="muted">Consulting the catalogue…</p>';
    try {
      results = await api(`/api/search?q=${encodeURIComponent(q)}`);
      box.innerHTML = results.length
        ? results.map((r, i) => `<button type="button" class="result" data-i="${i}">
            ${r.cover ? `<img src="${esc(r.cover.replace('-L.jpg', '-M.jpg'))}" alt="" loading="lazy">` : '<span class="noimg"></span>'}
            <span><strong>${esc(r.title)}</strong><span class="muted">${esc(r.author)}${r.year ? ` · ${r.year}` : ''}</span></span>
          </button>`).join('')
        : '<p class="muted">Nothing found. Enter the details below.</p>';
    } catch (e) {
      box.innerHTML = `<p class="muted">Lookup unavailable (${esc(e.message)}). Enter the details below.</p>`;
    }
  };

  $('#olgo').addEventListener('click', search);
  $('#olq').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); search(); } });
  $('#olq').focus();

  $('#olresults').addEventListener('click', e => {
    const btn = e.target.closest('.result');
    if (!btn) return;
    const r = results[+btn.dataset.i];
    $$('.result', dlg).forEach(x => x.classList.toggle('selected', x === btn));
    f.title.value = r.title || '';
    f.author.value = r.author || '';
    f.pages.value = r.pages ?? '';
    f.year.value = r.year ?? '';
    f.isbn.value = r.isbn ?? '';
    f.cover.value = r.cover ?? '';
    f.category.value = r.category ?? '';
  });

  $$('[data-cancel]', dlg).forEach(b => b.addEventListener('click', () => dlg.close()));

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const title = f.title.value.trim();
    if (!title) { toast('A book needs a title.', true); f.title.focus(); return; }
    const author = f.author.value.trim();
    const dupe = state.books.find(b => b.title.toLowerCase() === title.toLowerCase() && b.author.toLowerCase() === author.toLowerCase());
    if (dupe && !confirm(`“${title}” is already in your library (${LABEL[dupe.status]}). Add another copy?`)) return;
    const status = f.status.value;
    const n = v => (v === '' ? null : Number(v));
    try {
      const saved = await api('/api/books', {
        method: 'POST',
        body: {
          title, author, status,
          owned: status !== 'wishlist',
          pages: n(f.pages.value),
          year: n(f.year.value),
          isbn: f.isbn.value.trim() || null,
          cover: f.cover.value.trim() || null,
          category: f.category.value.trim() || null,
          started: status === 'reading' ? today() : null,
          finished: status === 'read' ? today() : null,
        },
      });
      state.books.push(saved);
      dlg.close();
      render();
      toast(`Added to ${LABEL[saved.status]}.`);
    } catch (err) {
      toast(err.message, true);
    }
  });
}

// ---------- night mode ----------
// 'auto' follows the clock (night from 7pm to 7am); 'night' and 'day' pin it.
// index.html applies the same rule before first paint to avoid a flash.

const LAMP = {
  auto: { glyph: '◐', label: 'Lighting: automatic, night from 7pm to 7am' },
  night: { glyph: '☾', label: 'Lighting: always night' },
  day: { glyph: '☀', label: 'Lighting: always day' },
};
let lampMode = LAMP[localStorage.getItem('lamp')] ? localStorage.getItem('lamp') : 'auto';
const isEvening = (d = new Date()) => d.getHours() >= 19 || d.getHours() < 7;

// The bulb follows the room (lit at night) until the chain is pulled; the pull
// holds until the room itself next switches between day and night.
let bulbPulled = null; // null = follow the room, otherwise true/false
let lastTheme = null;

function applyLamp() {
  const night = lampMode === 'night' || (lampMode === 'auto' && isEvening());
  const theme = night ? 'night' : 'day';
  if (theme !== lastTheme) bulbPulled = null;
  lastTheme = theme;
  document.documentElement.dataset.theme = theme;
  $('#lamp').classList.toggle('lit', bulbPulled ?? night);
  const btn = $('#lampBtn');
  btn.textContent = LAMP[lampMode].glyph;
  btn.title = LAMP[lampMode].label;
  btn.setAttribute('aria-label', `${LAMP[lampMode].label}. Click to change.`);
}

function tugChain() {
  const lamp = $('#lamp');
  lamp.classList.remove('tug');
  void lamp.getBoundingClientRect(); // restart the tug if pulled again quickly
  lamp.classList.add('tug');
}

// The header button cycles the room's lighting: auto → night → day.
$('#lampBtn').addEventListener('click', () => {
  lampMode = { auto: 'night', night: 'day', day: 'auto' }[lampMode];
  localStorage.setItem('lamp', lampMode);
  document.documentElement.classList.add('theme-fade');
  applyLamp();
  setTimeout(() => document.documentElement.classList.remove('theme-fade'), 900);
  toast(LAMP[lampMode].label.replace('Lighting: ', 'Lighting ') + '.');
});

// The pull chain only switches the bulb, not the room.
$('#lamp .lamp-chain').addEventListener('click', () => {
  tugChain();
  const lit = !$('#lamp').classList.contains('lit');
  // The light changes as the chain bottoms out, a beat after the pull.
  setTimeout(() => { bulbPulled = lit; applyLamp(); }, 150);
});
applyLamp();
setInterval(applyLamp, 60_000); // switch over at 7pm / 7am without a reload

// ---------- moving the lamp ----------
// The lamp is a pendulum hanging from the top of the page. Drag the shade to
// move it (the cord lengthens as you pull it down); brush the cursor across
// the shade and it swings away from the push, then slowly settles. Its light
// swings with it. The spot is saved relative to the page's centre so it stays
// put when the window resizes.

const lampEl = $('#lamp');
const lampSwing = $('#lamp .lamp-swing');
const lampGrab = $('#lamp .lamp-grab');
const lampLight = $('#lampLight');
const BULB_Y = 116;  // bulb centre inside the 80×170 drawing
const LIGHT_Y = 92;  // where the beam starts (hidden inside the shade)
const GRAVITY = 2000; // px/s²: about a 1.5 s swing on the short cord
const DAMPING = 0.9;  // per second; a few swings before it settles
const calm = matchMedia('(prefers-reduced-motion: reduce)');
let lampPos = JSON.parse(localStorage.getItem('lampPos') || 'null'); // { dx, drop } or null = default spot
let lampDrop = 0;
// φ: how far the shade has swung, in radians; positive means swung to the right.
const swing = { phi: 0, vel: 0 };

function placeLamp() {
  const root = document.documentElement;
  const pageW = root.clientWidth;
  let x, drop;
  if (lampPos) {
    x = Math.min(Math.max(pageW / 2 + lampPos.dx, 40), pageW - 40);
    drop = Math.max(0, lampPos.drop);
  } else {
    x = $('.masthead').getBoundingClientRect().right + scrollX + 56; // the right margin
    drop = 0;
  }
  root.style.setProperty('--lamp-x', `${x}px`);
  root.style.setProperty('--lamp-drop', `${drop}px`);
  $('#lampCord').setAttribute('y1', -drop);
  lampEl.classList.toggle('placed', !!lampPos);
  lampDrop = drop;
  return { x, drop };
}

// Draw the lamp swung by φ around the point its cord hangs from, and move the
// beam so it still comes out of the shade.
function tiltLamp(phi) {
  const deg = -phi * 180 / Math.PI; // CSS rotates clockwise, which swings the shade left
  const len = lampDrop + LIGHT_Y;
  lampSwing.style.transform = `rotate(${deg}deg)`;
  lampLight.style.transform = `translate(${len * Math.sin(phi)}px, ${len * (Math.cos(phi) - 1)}px) rotate(${deg}deg)`;
}

let lastFrame = 0;
function swingFrame(t) {
  const dt = Math.min((t - (lastFrame || t)) / 1000, 1 / 20);
  lastFrame = t;
  const len = lampDrop + BULB_Y;
  if (!lampDrag) {
    const acc = -(GRAVITY / len) * Math.sin(swing.phi) - DAMPING * swing.vel;
    swing.vel += acc * dt;
    swing.phi = Math.max(-.6, Math.min(.6, swing.phi + swing.vel * dt));
    if (calm.matches) swing.phi = swing.vel = 0;
  }
  // A faint draught keeps it moving a few px even when nobody touches it.
  const draught = calm.matches || lampDrag ? 0 : Math.atan(3 / len) * Math.sin(t / 1000 * 2 * Math.PI / 7);
  tiltLamp(swing.phi + draught);
  requestAnimationFrame(swingFrame);
}
requestAnimationFrame(swingFrame);

// Brushing past the shade pushes it the way the cursor was moving.
let cursor = null; // last pointer sample, for velocity
let cursorOnShade = false;
addEventListener('pointermove', e => {
  if (e.pointerType !== 'mouse' || lampDrag) { cursor = null; return; }
  const prev = cursor;
  cursor = { x: e.clientX, y: e.clientY, t: e.timeStamp };
  const r = lampGrab.getBoundingClientRect();
  const on = e.clientX > r.left - 4 && e.clientX < r.right + 4 && e.clientY > r.top - 4 && e.clientY < r.bottom + 4;
  if (on && prev && !calm.matches) {
    const vx = (e.clientX - prev.x) / Math.max(e.timeStamp - prev.t, 8) * 1000; // px/s
    const len = lampDrop + BULB_Y;
    // A full kick when the cursor first hits the shade, a nudge while it moves through.
    const push = Math.max(-900, Math.min(900, vx)) / len * (cursorOnShade ? .03 : .2);
    swing.vel = Math.max(-.6, Math.min(.6, swing.vel + push)); // at most ~15°
  }
  cursorOnShade = on;
}, { passive: true });

let lampDrag = null;

lampGrab.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  e.preventDefault();
  const { x, drop } = placeLamp();
  lampDrag = { offX: e.pageX - x, offY: e.pageY - drop, lastX: e.pageX, lastT: e.timeStamp, moved: false };
  lampGrab.setPointerCapture(e.pointerId);
  lampEl.classList.add('dragging');
});

lampGrab.addEventListener('pointermove', e => {
  if (!lampDrag) return;
  const pageW = document.documentElement.clientWidth;
  const maxDrop = document.documentElement.scrollHeight - 180;
  const x = Math.min(Math.max(e.pageX - lampDrag.offX, 40), pageW - 40);
  const drop = Math.min(Math.max(e.pageY - lampDrag.offY, 0), maxDrop);
  lampPos = { dx: x - pageW / 2, drop };
  placeLamp();
  // The shade trails behind the way you're dragging, more for a faster drag.
  const dt = Math.max(e.timeStamp - lampDrag.lastT, 1);
  const vx = (e.pageX - lampDrag.lastX) / dt; // px per ms
  const lag = Math.min(Math.max(-vx * 40, -45), 45);
  const target = calm.matches ? 0 : Math.atan2(lag, drop + BULB_Y);
  const phi = swing.phi + (target - swing.phi) * 0.35;
  swing.vel = (phi - swing.phi) / (dt / 1000); // carried into the swing when you let go
  swing.phi = phi;
  lampDrag.lastX = e.pageX;
  lampDrag.lastT = e.timeStamp;
  lampDrag.moved = true;
});

function endLampDrag() {
  if (!lampDrag) return;
  if (lampDrag.moved) localStorage.setItem('lampPos', JSON.stringify(lampPos));
  lampDrag = null;
  swing.vel = Math.max(-.8, Math.min(.8, swing.vel));
  lampEl.classList.remove('dragging');
}
lampGrab.addEventListener('pointerup', endLampDrag);
lampGrab.addEventListener('pointercancel', endLampDrag);

// Double-click the shade to send it back to the margin.
lampGrab.addEventListener('dblclick', () => {
  lampPos = null;
  localStorage.removeItem('lampPos');
  placeLamp();
});

new ResizeObserver(() => placeLamp()).observe(document.body); // window resizes, scrollbar appearing
placeLamp();

// ---------- objects on the shelves ----------

function addDecor(kind) {
  const status = state.decorShelf;
  if (state.arrange !== 'mine') { state.arrange = 'mine'; localStorage.setItem('arrange', 'mine'); render(); }
  const row = $(`.spines[data-shelf="${status}"]`);
  if (!row) { toast('That shelf is empty. Put a book on it first.', true); return; }
  // Stand it at the left edge of what you can currently see of the shelf.
  const scroller = row.closest('.shelf-scroll');
  const slots = $$(':scope > .slot', row);
  const at = Math.max(0, slots.findIndex(s => s.offsetLeft + s.offsetWidth > scroller.scrollLeft + 30));
  const ids = shelfIds(row);
  const id = newDecorId(kind);
  ids.splice(at, 0, id);
  $('.decor-pick')?.removeAttribute('open');
  saveShelfOrder(status, ids);
  const placed = $(`.spines[data-shelf="${status}"] [data-id="${CSS.escape(id)}"]`)?.parentElement;
  if (placed) {
    placed.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
    placed.classList.add('just-placed');
    setTimeout(() => placed.classList.remove('just-placed'), 1400);
  }
  toast(`${DECOR[kind].name} added. Drag it along the shelf to move it.`);
}

function removeDecor(id) {
  for (const [status, order] of Object.entries(state.settings.shelfOrder || {})) {
    if (!order?.includes(id)) continue;
    const rest = order.filter(x => x !== id);
    saveShelfOrder(status, rest.length ? rest : null);
  }
  decorOut.delete(id);
  localStorage.setItem('decorOut', JSON.stringify([...decorOut]));
}

// Click an object to play with it.
function pokeDecor(btn) {
  const slot = btn.parentElement;
  const id = btn.dataset.id;
  if (decorKind(id) === 'candle') {
    const out = !slot.classList.contains('out');
    slot.classList.toggle('out', out);
    if (out) decorOut.add(id); else decorOut.delete(id);
    localStorage.setItem('decorOut', JSON.stringify([...decorOut]));
    slot.classList.remove('poke');
    void slot.offsetWidth;
  }
  slot.classList.remove('poke');
  void slot.offsetWidth; // restart the animation
  slot.classList.add('poke');
  clearTimeout(slot._poke);
  slot._poke = setTimeout(() => slot.classList.remove('poke'), 2600);
}
document.addEventListener('click', e => {
  const open = $('.decor-pick[open]');
  if (open && !open.contains(e.target)) open.open = false;
});

// ---------- shelf material ----------
// The plank drawing for the chosen wood or metal, in day and night light.

function applyMaterial() {
  const root = document.documentElement;
  root.dataset.shelf = state.material;
  root.style.setProperty('--plank-day', plankURI(state.material));
  root.style.setProperty('--plank-night', plankURI(state.material, true));
}
applyMaterial();
document.addEventListener('click', e => {
  const open = $('.material-pick[open]');
  if (open && !open.contains(e.target)) open.open = false;
});

// ---------- categories ----------
// Ask the server to look up every uncategorised book on Open Library.

async function fillCategories(btn) {
  btn.disabled = true;
  btn.textContent = 'Looking them up…';
  try {
    const { updated, skipped } = await api('/api/categorize-missing', { method: 'POST' });
    updated.forEach(b => replaceBook(b));
    render();
    toast(`Filled in ${updated.length} ${updated.length === 1 ? 'category' : 'categories'}.`
      + (skipped ? ` Open Library couldn’t place ${skipped}; set ${skipped === 1 ? 'it' : 'them'} in the book’s details.` : ''));
  } catch (err) {
    render();
    toast(err.message === 'Unknown endpoint' ? 'Restart the server (npm start) to fill in categories.' : err.message, true);
  }
}

// ---------- reading pace ----------
// How fast you're reading a book: pages a day over the last two weeks (or
// since you started, if that's sooner), from its journal. The finish date is
// what's left at that pace.

const PACE_DAYS = 14;
const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00`); d.setDate(d.getDate() + n); return isoDay(d); };
const dayDiff = (a, b) => Math.round((new Date(`${b}T00:00:00`) - new Date(`${a}T00:00:00`)) / 864e5);

function readingPace(b) {
  const now = today();
  const perDay = new Map();
  (b.journal || []).forEach(e => { if (e.date && !e.raw) perDay.set(e.date, (perDay.get(e.date) || 0) + entryPages(e)); });
  const dates = [...perDay.keys()].sort();
  const first = [b.started, dates[0]].filter(Boolean).sort()[0] || now;
  const from = [addDays(now, -(PACE_DAYS - 1)), first].sort().at(-1); // window start
  const days = Math.max(1, dayDiff(from, now) + 1);
  const bars = Array.from({ length: PACE_DAYS }, (_, i) => {
    const date = addDays(now, i - (PACE_DAYS - 1));
    return { date, pages: perDay.get(date) || 0 };
  });
  const inWindow = bars.filter(x => x.date >= from);
  const pages = inWindow.reduce((s, x) => s + x.pages, 0);
  const activeDays = inWindow.filter(x => x.pages).length;
  const perDayPace = pages / days;
  const left = b.pages ? Math.max(0, b.pages - (b.progress ?? 0)) : null;
  const daysLeft = left != null && perDayPace > 0 ? Math.ceil(left / perDayPace) : null;
  const lastRead = dates.filter(d => perDay.get(d)).at(-1) || null;
  return { pages, days, activeDays, perDay: perDayPace, left, daysLeft, finish: daysLeft != null ? addDays(now, daysLeft) : null, bars, lastRead };
}

function finishPhrase(p) {
  if (p.left === 0) return 'on the last page';
  if (p.daysLeft == null) return '';
  if (p.daysLeft <= 1) return 'done by tomorrow';
  if (p.daysLeft < 7) return `done in ${p.daysLeft} days`;
  const d = new Date(`${p.finish}T00:00:00`);
  const sameYear = d.getFullYear() === THIS_YEAR;
  return `done around ${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })}`;
}

function paceHTML(b) {
  const p = readingPace(b);
  if (!p.pages) {
    const msg = p.lastRead
      ? `<span>Nothing logged in two weeks</span><span class="pace-sub">last read ${fmtDate(p.lastRead)}</span>`
      : '<span>Move your page forward to see your pace</span>';
    return `<div class="pace muted"><span class="pace-text">${msg}</span></div>`;
  }
  const rate = p.perDay >= 10 ? Math.round(p.perDay) : Math.round(p.perDay * 10) / 10;
  const max = Math.max(...p.bars.map(x => x.pages), 1);
  const tip = `${plural(p.pages, 'page')} over ${plural(p.days, 'day')}, read on ${p.activeDays} of them`
    + (p.left != null ? ` · ${plural(p.left, 'page')} to go` : '');
  return `<div class="pace" title="${esc(tip)}">
    <span class="pace-bars" aria-hidden="true">${p.bars.map(x =>
      `<i style="height:${x.pages ? Math.max(12, Math.round((x.pages / max) * 100)) : 0}%" title="${esc(fmtDate(x.date))}: ${plural(x.pages, 'page')}"></i>`).join('')}</span>
    <span class="pace-text"><span><strong>${rate}</strong> ${rate === 1 ? 'page' : 'pages'} a day</span>${finishPhrase(p) ? `<span class="pace-sub">${finishPhrase(p)}</span>` : ''}</span>
  </div>`;
}

// ---------- library search ----------
// ⌘K (or /) anywhere: search every book's title, author, category, tags,
// review, notes and journal. Accents don't matter ("cote" finds "côté");
// every word you type has to appear somewhere in the book.

const fold = s => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

// Where the terms occur in `text`, as [start, end] ranges of the original string.
function matchRanges(text, terms) {
  let folded = '';
  const map = [];
  for (let i = 0; i < text.length; i++) { const f = fold(text[i]); for (const ch of f) { folded += ch; map.push(i); } }
  const ranges = [];
  for (const t of terms) {
    let at = folded.indexOf(t);
    while (at !== -1) { ranges.push([map[at], map[at + t.length - 1] + 1]); at = folded.indexOf(t, at + t.length); }
  }
  return ranges.sort((a, b) => a[0] - b[0]);
}
function highlight(text, ranges) {
  let out = '', pos = 0;
  for (const [a, b] of ranges) { if (a < pos) continue; out += esc(text.slice(pos, a)) + `<mark>${esc(text.slice(a, b))}</mark>`; pos = b; }
  return out + esc(text.slice(pos));
}
function snippet(text, ranges, room = 46) {
  const [a, b] = ranges[0];
  const start = Math.max(0, text.lastIndexOf(' ', Math.max(0, a - room)) + 1);
  const end = Math.min(text.length, (text.indexOf(' ', b + room) + 1 || text.length + 1) - 1);
  const piece = text.slice(start, end).replace(/\s+/g, ' ');
  const shifted = matchRanges(piece, state.searchTerms);
  return `${start > 0 ? '…' : ''}${highlight(piece, shifted)}${end < text.length ? '…' : ''}`;
}

const SEARCH_FIELDS = [
  ['title', 10, b => b.title],
  ['author', 7, b => b.author],
  ['category', 5, b => b.category || ''],
  ['tags', 5, b => b.tags.join(', ')],
  ['review', 2, b => b.review || '', 'Review'],
  ['notes', 2, b => b.notes || '', 'Notes'],
];

function searchLibrary(q) {
  const terms = fold(q).split(/\s+/).filter(Boolean);
  state.searchTerms = terms;
  if (!terms.length) return [];
  return state.books.map(b => {
    const texts = SEARCH_FIELDS.map(([key, weight, get, label]) => ({ key, weight, label, text: get(b), folded: fold(get(b)) }));
    (b.journal || []).filter(e => e.note).forEach(e => texts.push({ key: 'journal', weight: 2, label: `Journal, ${fmtDate(e.date)}`, text: e.note, folded: fold(e.note) }));
    let score = 0;
    for (const t of terms) {
      const hits = texts.filter(x => x.folded.includes(t));
      if (!hits.length) return null; // every word must match somewhere
      score += Math.max(...hits.map(x => x.weight + (new RegExp(`(^|[^a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(x.folded) ? 1 : 0)));
    }
    // Show where it matched in the text, when the words weren't all in the title or author.
    const inHead = terms.every(t => fold(b.title).includes(t) || fold(b.author).includes(t));
    const body = inHead ? null : texts.find(x => x.label && terms.some(t => x.folded.includes(t)));
    return { b, score, body };
  }).filter(Boolean).sort((x, y) => y.score - x.score || x.b.title.localeCompare(y.b.title)).slice(0, 30);
}

let searchSel = 0;
function renderSearchResults() {
  const dlg = $('#searchDialog');
  const q = $('#librarySearch', dlg).value;
  const list = $('.search-results', dlg);
  const results = q.trim()
    ? searchLibrary(q)
    : state.books.filter(b => b.status === 'reading').map(b => ({ b, score: 0, body: null }));
  searchSel = Math.min(searchSel, Math.max(0, results.length - 1));
  const terms = state.searchTerms || [];
  list.innerHTML = results.length ? results.map(({ b, body }, i) => {
    const meta = [b.author ? highlight(b.author, matchRanges(b.author, terms)) : '', LABEL[b.status],
      b.category ? highlight(b.category, matchRanges(b.category, terms)) : ''].filter(Boolean).join(' · ');
    return `<li><button type="button" class="search-hit${i === searchSel ? ' selected' : ''}" data-id="${esc(b.id)}" data-i="${i}">
      <span class="thumb">${coverHTML(b)}</span>
      <span class="hit-body"><span class="hit-title">${highlight(b.title, matchRanges(b.title, terms))}</span>
        <span class="hit-meta">${meta}</span>
        ${body ? `<span class="hit-snippet"><em>${esc(body.label)}</em> ${snippet(body.text, matchRanges(body.text, terms))}</span>` : ''}
      </span></button></li>`;
  }).join('') : `<li class="search-empty">${q.trim() ? `Nothing in your library matches “${esc(q.trim())}”.` : 'Type to search titles, authors, categories, tags, reviews, notes and journal entries.'}</li>`;
  $('.search-head small', dlg).textContent = q.trim() ? plural(results.length, 'book') : results.length ? 'Reading now' : '';
}

function openSearch() {
  const dlg = $('#searchDialog');
  if (dlg.open) { $('#librarySearch', dlg).select(); return; }
  if ($('#addDialog').open) return;
  dlg.innerHTML = `<div class="search-box">
    <div class="search-field">
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10.4 10.4 14 14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
      <input id="librarySearch" type="search" placeholder="Search your library…" autocomplete="off" spellcheck="false" aria-label="Search your library" aria-controls="searchResults">
      <kbd>esc</kbd>
    </div>
    <p class="search-head"><small></small><span class="mono">↑↓ to move · ↵ to open</span></p>
    <ul class="search-results" id="searchResults"></ul>
  </div>`;
  searchSel = 0;
  dlg.showModal();
  const input = $('#librarySearch', dlg);
  input.addEventListener('input', () => { searchSel = 0; renderSearchResults(); });
  input.addEventListener('keydown', e => {
    const hits = $$('.search-hit', dlg);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!hits.length) return;
      searchSel = (searchSel + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length;
      hits.forEach((h, i) => h.classList.toggle('selected', i === searchSel));
      hits[searchSel].scrollIntoView({ block: 'nearest' });
    }
    if (e.key === 'Enter' && hits[searchSel]) { e.preventDefault(); openFromSearch(hits[searchSel].dataset.id); }
  });
  $('.search-results', dlg).addEventListener('click', e => {
    const hit = e.target.closest('.search-hit');
    if (hit) openFromSearch(hit.dataset.id);
  });
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); }); // click outside the box
  renderSearchResults();
  input.focus();
}
function openFromSearch(id) {
  $('#searchDialog').close();
  openDrawer(id);
}

$('#searchBtn').addEventListener('click', openSearch);
document.addEventListener('keydown', e => {
  const typing = e.target.closest?.('input, textarea, select, [contenteditable]');
  if (((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') || (e.key === '/' && !typing && !state.openId)) {
    e.preventDefault();
    openSearch();
  }
});

// ---------- reading mode ----------
// "Start reading" on a book you're reading: the room goes dark, the book sits
// in the middle, the lamp glides over and switches on above it, and a timer
// runs. When you're done you say what page you reached, and the session goes
// into the journal with its minutes. The session survives a reload.

const SESSION_KEY = 'readingSession';
let session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); // { id, startPage, began, elapsed, runningSince }
let sessionTick = 0;
let lampBefore = null; // where the lamp was, to put it back afterwards
const pageTitle = document.title;

const sessionMs = () => session ? session.elapsed + (session.runningSince ? Date.now() - session.runningSince : 0) : 0;
const clockText = ms => {
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
};
const saveSession = () => (session ? localStorage.setItem(SESSION_KEY, JSON.stringify(session)) : localStorage.removeItem(SESSION_KEY));

function startReading(id) {
  const b = byId(id);
  if (!b) return;
  session = { id, startPage: b.progress ?? 0, began: Date.now(), elapsed: 0, runningSince: Date.now() };
  saveSession();
  enterReadingRoom();
}

function enterReadingRoom() {
  const b = byId(session.id);
  if (!b) { session = null; saveSession(); return; }
  const room = $('#readingRoom');
  const p = readingPace(b);
  const togo = b.pages ? Math.max(0, b.pages - (b.progress ?? 0)) : null;
  room.innerHTML = `<div class="rr-stage">
    <div class="rr-book" style="--t:${thickness(b) * 1.6}px"><span class="book3d">${coverHTML(b)}<span class="pages"></span></span></div>
    <div class="rr-info">
      <p class="rr-eyebrow">Reading</p>
      <h2 class="rr-title">${esc(b.title)}</h2>
      <p class="rr-author">${esc(b.author)}</p>
      <div class="rr-reading">
        <p class="rr-timer" aria-live="off">00:00</p>
        <p class="rr-sub">from p. ${session.startPage}${togo != null ? ` · ${plural(togo, 'page')} to go` : ''}${p.pages ? ` · about ${Math.round(p.perDay)} a day lately` : ''}</p>
        <div class="rr-controls">
          <button type="button" class="ghost rr-pause" data-rr="pause">Pause</button>
          <button type="button" class="stamp" data-rr="done">I’m done</button>
        </div>
        <p class="rr-hint mono">space to pause · esc when you’re done</p>
      </div>
      <form class="rr-finish" hidden autocomplete="off">
        <p class="rr-summary"></p>
        <label><span class="label">What page are you on?</span>
          <input type="number" name="page" min="0" step="1"${b.pages ? ` max="${b.pages}"` : ''} value="${b.progress ?? session.startPage}" required></label>
        <label><span class="label">A note <em>optional</em></span>
          <input type="text" name="note" placeholder="Where you are, a line you liked…"></label>
        <div class="rr-controls">
          <button type="button" class="link-btn" data-rr="discard">Discard session</button>
          <span class="spacer"></span>
          <button type="button" class="ghost" data-rr="back">Keep reading</button>
          <button type="submit" class="stamp">Log it</button>
        </div>
      </form>
    </div>
  </div>`;
  room.hidden = false;
  document.documentElement.classList.add('reading');
  requestAnimationFrame(() => room.classList.add('in'));
  lampOverBook();
  clearInterval(sessionTick);
  sessionTick = setInterval(tickSession, 250);
  tickSession();
  $('[data-rr=done]', room).focus();
}

function tickSession() {
  if (!session) return;
  const t = clockText(sessionMs());
  const el = $('#readingRoom .rr-timer');
  if (el) el.textContent = t;
  $('#readingRoom')?.classList.toggle('paused', !session.runningSince);
  const b = byId(session.id);
  document.title = `${session.runningSince ? '▶' : '❚❚'} ${t} · ${b?.title ?? 'Reading'}`;
}

function pauseSession(pause = !!session.runningSince) {
  if (pause && session.runningSince) { session.elapsed += Date.now() - session.runningSince; session.runningSince = null; }
  else if (!pause && !session.runningSince) session.runningSince = Date.now();
  saveSession();
  const btn = $('#readingRoom [data-rr=pause]');
  if (btn) btn.textContent = session.runningSince ? 'Pause' : 'Resume';
  tickSession();
}

function showFinish(show = true) {
  const room = $('#readingRoom');
  if (show) pauseSession(true); else pauseSession(false);
  $('.rr-reading', room).hidden = show;
  $('.rr-finish', room).hidden = !show;
  if (show) {
    const mins = Math.round(sessionMs() / 60000);
    $('.rr-summary', room).textContent = mins >= 1 ? `${plural(mins, 'minute')} of reading.` : 'Under a minute. Log it anyway?';
    $('.rr-finish [name=page]', room).select();
  } else {
    $('[data-rr=done]', room).focus();
  }
}

async function finishSession(form) {
  const b = byId(session.id);
  const page = form.page.value === '' ? null : Number(form.page.value);
  const note = form.note.value.trim();
  const minutes = Math.max(1, Math.round(sessionMs() / 60000));
  const moved = page != null && page > (b.progress ?? 0);
  try {
    const journal = withEntry(b, { date: today(), to: moved ? page : null, note, minutes });
    await saveJournal(b, journal, moved ? page : b.progress);
    const read = moved ? page - (b.progress ?? 0) : 0;
    toast(`Logged ${plural(minutes, 'minute')}${read ? ` and ${plural(read, 'page')}` : ''}.`);
    leaveReadingRoom();
    render();
  } catch (err) {
    toast(err.message, true);
  }
}

function leaveReadingRoom() {
  clearInterval(sessionTick);
  session = null;
  saveSession();
  document.title = pageTitle;
  const room = $('#readingRoom');
  room.classList.remove('in');
  document.documentElement.classList.remove('reading');
  setTimeout(() => { if (!session) { room.hidden = true; room.innerHTML = ''; } }, 450);
  lampBack();
}

// The lamp glides over to hang just above the book, and switches on.
function lampOverBook() {
  if (!lampBefore) lampBefore = { pos: lampPos, pulled: bulbPulled };
  const book = $('#readingRoom .rr-book').getBoundingClientRect();
  const pageW = document.documentElement.clientWidth;
  const x = book.left + book.width / 2 + scrollX;
  const drop = Math.max(0, scrollY + book.top - 64 - BULB_Y);
  glideLamp({ dx: x - pageW / 2, drop }, x);
  bulbPulled = true;
  applyLamp();
}
function lampBack() {
  if (!lampBefore) return;
  const { pos, pulled } = lampBefore;
  lampBefore = null;
  const from = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--lamp-x')) || 0;
  lampPos = pos;
  bulbPulled = pulled;
  applyLamp();
  glide(() => placeLamp(), from);
}
function glideLamp(pos, toX) {
  const from = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--lamp-x')) || toX;
  lampPos = pos; // not saved: your own spot for the lamp stays as it was
  glide(() => placeLamp(), from);
}
// Animate the move, keep the cord reaching the ceiling the whole way, and give
// the shade a swing from the motion.
function glide(move, fromX) {
  const root = document.documentElement;
  const before = lampDrop;
  root.classList.add('lamp-gliding');
  move();
  const cord = Math.max(before, lampDrop);
  $('#lampCord').setAttribute('y1', -cord);
  const dx = (parseFloat(getComputedStyle(root).getPropertyValue('--lamp-x')) || fromX) - fromX;
  if (!calm.matches) swing.vel = Math.max(-.5, Math.min(.5, swing.vel - dx / 900));
  setTimeout(() => { root.classList.remove('lamp-gliding'); placeLamp(); }, 1300);
}

$('#readingRoom').addEventListener('click', e => {
  const act = e.target.closest('[data-rr]')?.dataset.rr;
  if (act === 'pause') pauseSession();
  if (act === 'done') showFinish(true);
  if (act === 'back') showFinish(false);
  if (act === 'discard' && confirm('Discard this reading session? Nothing will be logged.')) { leaveReadingRoom(); toast('Session discarded.'); }
});
$('#readingRoom').addEventListener('submit', e => { e.preventDefault(); finishSession(e.target); });
document.addEventListener('keydown', e => {
  if (!session || $('#readingRoom').hidden) return;
  const finishing = !$('#readingRoom .rr-finish').hidden;
  if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); showFinish(!finishing); }
  else if (e.key === ' ' && !finishing && !e.target.closest('input, textarea, button')) { e.preventDefault(); pauseSession(); }
}, true);
addEventListener('resize', () => { if (session && !$('#readingRoom').hidden) lampOverBook(); });

// ---------- recommendations ----------
// "For You": books picked from Open Library to match your shelves, weighted
// by your ratings (see lib/recommend.js). Each book card also shows a few
// books like it. Anything can go straight onto your wishlist.

const recDismissed = new Set(JSON.parse(localStorage.getItem('recDismissed') || '[]'));
const recTitle = t => fold(String(t)).split(/[:(]/)[0].replace(/[^a-z0-9]+/g, ' ').trim();
const inLibrary = r => state.books.some(b => recTitle(b.title) === recTitle(r.title));

async function loadRecs(refresh = false) {
  state.recs = { status: 'loading', data: state.recs?.data ?? null };
  if (state.view === 'foryou') render();
  try {
    state.recs = { status: 'ready', data: await api(`/api/recommendations${refresh ? '?refresh' : ''}`) };
  } catch (err) {
    state.recs = { status: 'error', error: err.message === 'Unknown endpoint' ? 'Restart the server (npm start) to get recommendations.' : err.message, data: state.recs?.data ?? null };
  }
  if (state.view === 'foryou') render();
}

// "Because you loved Stoner and have California on your shelf"
const becausePhrase = list => {
  if (!list?.length) return '';
  const link = b => `<button class="link-btn" data-action="open" data-id="${esc(b.id)}">${esc(b.title)}</button>`;
  const say = b => (b.rating >= 4 ? `loved ${link(b)}` : b.status === 'read' ? `read ${link(b)}` : b.status === 'reading' ? `are reading ${link(b)}`
    : b.status === 'wishlist' ? `want ${link(b)}` : `have ${link(b)} on your shelf`);
  const verb = b => say(b).split(' ')[0];
  if (list.length === 2 && verb(list[0]) === verb(list[1]) && !say(list[1]).endsWith('on your shelf')) {
    return `Because you ${say(list[0])} and ${link(list[1])}`; // "loved East of Eden and Stoner"
  }
  return `Because you ${list.map(say).join(' and ')}`;
};

function recCardHTML(r, i, compact = false) {
  const owned = inLibrary(r);
  const stars = r.rating ? `<span class="rec-stars" title="${r.rating} average from ${plural(r.ratings, 'reader')} on Open Library">${starsHTML(Math.round(r.rating * 2) / 2)} <small>${r.rating}</small></span>` : '';
  return `<article class="rec${compact ? ' compact' : ''}" data-rec="${i}">
    <a class="rec-cover" href="${esc(r.url)}" target="_blank" rel="noopener" title="See it on Open Library"><img src="${esc(r.cover.replace('-L.jpg', '-M.jpg'))}" alt="" loading="lazy"></a>
    <div class="rec-body">
      <h3 class="rec-title">${esc(r.title)}</h3>
      <p class="rec-by">${esc(r.author)}${r.year ? ` · ${r.year}` : ''}</p>
      ${compact ? '' : stars}
      ${compact ? '' : `<p class="rec-why">${r.moreBy ? `More by ${esc(r.moreBy)}. ` : ''}${becausePhrase(r.because)}</p>`}
      ${r.shared?.length ? `<p class="rec-shared">${r.shared.map(s => `<span>${esc(s)}</span>`).join('')}</p>` : ''}
      <div class="rec-actions">
        ${owned ? '<span class="rec-added">✓ In your library</span>'
          : `<button type="button" class="link-btn rec-add" data-action="recWish" data-rec="${i}">+ Wishlist</button>`}
        ${compact || owned ? '' : `<button type="button" class="link-btn rec-skip" data-action="recSkip" data-rec="${i}">Not for me</button>`}
      </div>
    </div>
  </article>`;
}

function forYouView() {
  if (!state.books.length) {
    return `<p class="eyebrow review-years">Recommendations</p><h2 class="review-title">For you</h2>
      <div class="welcome">${empty('Add a few books you’ve read and rate them, and recommendations from Open Library will appear here.')}
      <button class="stamp" data-action="add">Add a book</button></div>`;
  }
  if (!state.recs) { state.recs = { status: 'loading', data: null }; queueMicrotask(() => loadRecs()); }
  const { status, data, error } = state.recs;
  const books = (data?.books || []).filter(r => !recDismissed.has(r.key));
  state.recList = books;
  const basis = data?.basis;
  const basisLine = basis ? [basis.rated && `${plural(basis.rated, 'book')} you rated`, basis.read && `${basis.read} you've read`,
    basis.reading && `${basis.reading} you're reading`, basis.other && `${basis.other} on your shelves and wishlist`].filter(Boolean).join(', ') : '';
  const head = `<p class="eyebrow review-years">Recommendations</p>
    <h2 class="review-title">For you</h2>
    <p class="sub rec-sub">${basisLine ? `Picked from Open Library to match ${basisLine}. Your ratings count most: rate more books to sharpen these.` : 'Picked from Open Library to match your shelves.'}
      <button class="link-btn rec-refresh" data-action="recRefresh"${status === 'loading' ? ' disabled' : ''}>${status === 'loading' ? 'Looking…' : 'Refresh'}</button></p>
    ${data?.taste?.length ? `<p class="taste"><span class="label">Your taste, as your shelves tell it</span>${data.taste.map(t => `<span class="taste-chip">${esc(t.subject)}</span>`).join('')}</p>` : ''}`;
  if (status === 'loading' && !data) return `${head}<div class="rec-loading"><span class="dots"><i></i><i></i><i></i></span>Reading your shelves and asking Open Library… the first time takes a few seconds.</div>`;
  if (status === 'error' && !data) return `${head}${empty(`Couldn't get recommendations: ${esc(error)}`)}`;
  return `${head}
    ${books.length ? `<div class="rec-grid">${books.map((r, i) => recCardHTML(r, i)).join('')}</div>` : empty('No recommendations left. Try Refresh, or rate a few more books.')}`;
}

async function addRecToWishlist(r, btn) {
  if (inLibrary(r)) return;
  btn.disabled = true;
  try {
    const saved = await api('/api/books', {
      method: 'POST',
      body: { title: r.title, author: r.author, status: 'wishlist', owned: false, pages: r.pages, year: r.year, isbn: r.isbn, cover: r.cover, category: r.category },
    });
    state.books.push(saved);
    btn.outerHTML = '<span class="rec-added">✓ On your wishlist</span>';
    renderLedger();
    toast(`“${r.title}” is on your wishlist.`);
  } catch (err) {
    btn.disabled = false;
    toast(err.message, true);
  }
}

// Similar books, inside a book's card.
const similarCache = new Map();
async function loadSimilar(b, d) {
  const box = $('.similar', d);
  if (!box) return;
  try {
    if (!similarCache.has(b.id)) similarCache.set(b.id, (await api(`/api/similar?id=${encodeURIComponent(b.id)}`)).books);
    const list = similarCache.get(b.id).filter(r => !recDismissed.has(r.key)).slice(0, 6);
    if (!$('.similar', d)) return; // card closed meanwhile
    box.dataset.list = JSON.stringify(list);
    box.querySelector('.similar-list').innerHTML = list.length
      ? list.map((r, i) => recCardHTML(r, i, true)).join('')
      : '<p class="muted">Open Library had nothing close enough.</p>';
  } catch (err) {
    box.querySelector('.similar-list').innerHTML = `<p class="muted">${esc(err.message === 'Unknown endpoint' ? 'Restart the server (npm start) to see similar books.' : err.message)}</p>`;
  }
}
$('#drawer').addEventListener('click', e => {
  const btn = e.target.closest('[data-action=recWish]');
  if (!btn) return;
  e.stopPropagation();
  const list = JSON.parse(btn.closest('.similar').dataset.list || '[]');
  addRecToWishlist(list[+btn.dataset.rec], btn);
});

// ---------- render & events ----------

function render() {
  $$('.tabs [data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === state.view));
  renderLedger();
  const v = $('#view');
  if (state.view === 'catalog') {
    v.innerHTML = catalogView();
    renderCatalogTable();
  } else if (state.view === 'review') {
    v.innerHTML = reviewView();
  } else if (state.view === 'journal') {
    v.innerHTML = journalView();
  } else if (state.view === 'foryou') {
    v.innerHTML = forYouView();
  } else if (state.view === 'rankings') {
    v.innerHTML = rankingsView();
    bindRankings();
  } else {
    const scrolls = new Map($$('.shelf-scroll', v).map(s => [s.dataset.shelf, s.scrollLeft]));
    v.innerHTML = shelfView();
    $$('.shelf-scroll', v).forEach(s => { if (scrolls.has(s.dataset.shelf)) s.scrollLeft = scrolls.get(s.dataset.shelf); });
    updateScrollers();
    tintSpines();
  }
}

async function quickUpdate(id, patch) {
  const b = byId(id);
  if (!b) return;
  try {
    const { journal: _journal, ...rest } = b;
    const saved = await api(bookUrl(id), { method: 'PUT', body: { ...rest, ...patch } });
    replaceBook(saved);
    render();
    return saved;
  } catch (e) {
    toast(e.message, true);
  }
}

$('.tabs').addEventListener('click', e => {
  const btn = e.target.closest('[data-view]');
  if (!btn) return;
  state.view = btn.dataset.view;
  localStorage.setItem('view', state.view);
  render();
});
$('#addBtn').addEventListener('click', openAdd);
$('#scrim').addEventListener('click', () => closeDrawer());
$('#addDialog').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.close(); });

const view = $('#view');
view.addEventListener('click', async e => {
  const t = e.target.closest('[data-action]');
  if (!t) return;
  const { action, id } = t.dataset;
  if (action === 'open') openDrawer(id);
  else if (action === 'tour') startTour();
  else if (action === 'add') openAdd();
  else if (action === 'filter') { state.filter = t.dataset.value; render(); }
  else if (action === 'pickNext') pickNext();
  else if (action === 'dismissPick') { state.pick = null; render(); }
  else if (action === 'startPick') {
    const b = byId(state.pick?.id);
    state.pick = null;
    if (b && await quickUpdate(b.id, { status: 'reading', started: b.started || today() })) toast(`Started “${b.title}”. Enjoy.`);
  }
  else if (action === 'journalYear') { state.journalYear = Number(t.dataset.value); state.journalDay = null; render(); }
  else if (action === 'journalDay') { state.journalDay = t.dataset.value && t.dataset.value !== state.journalDay ? t.dataset.value : null; render(); }
  else if (action === 'reviewYear') { state.reviewYear = t.dataset.value === 'all' ? 'all' : Number(t.dataset.value); render(); }
  else if (action === 'scrollShelf') {
    const sc = t.closest('.shelf-row').querySelector('.shelf-scroll');
    sc.scrollBy({ left: Number(t.dataset.dir) * sc.clientWidth * 0.8, behavior: 'smooth' });
  }
  else if (action === 'resetOrder') {
    const keep = (state.settings.shelfOrder?.[t.dataset.value] || []).filter(isDecor); // objects stay, books go back to the default order
    saveShelfOrder(t.dataset.value, keep.length ? keep : null);
  }
  else if (action === 'shelfMode') { state.shelfMode = t.dataset.value; localStorage.setItem('shelfMode', state.shelfMode); render(); }
  else if (action === 'startReading') startReading(t.dataset.id);
  else if (action === 'recWish') addRecToWishlist(state.recList[+t.dataset.rec], t);
  else if (action === 'recSkip') { const r = state.recList[+t.dataset.rec]; recDismissed.add(r.key); localStorage.setItem('recDismissed', JSON.stringify([...recDismissed])); t.closest('.rec').classList.add('leaving'); setTimeout(render, 280); }
  else if (action === 'recRefresh') loadRecs(true);
  else if (action === 'decorShelf') { state.decorShelf = t.dataset.value; $$('.decor-to .chip').forEach(c => c.classList.toggle('active', c === t)); }
  else if (action === 'addDecor') addDecor(t.dataset.value);
  else if (action === 'removeDecor') removeDecor(t.dataset.value);
  else if (action === 'decor') pokeDecor(t);
  else if (action === 'material') { state.material = t.dataset.value; localStorage.setItem('shelfMaterial', state.material); applyMaterial(); render(); }
  else if (action === 'arrange') { state.arrange = t.dataset.value; localStorage.setItem('arrange', state.arrange); state.pick = null; render(); }
  else if (action === 'fillCategories') fillCategories(t);
  else if (action === 'move') moveRank(id, Number(t.dataset.dir));
  else if (action === 'finish') {
    const b = byId(id);
    const saved = await quickUpdate(id, { status: 'read', finished: b.finished || today(), progress: b.pages ?? b.progress });
    if (saved) toast(`“${saved.title}” finished. Rate it?`);
    if (saved) openDrawer(saved.id);
  }
});
view.addEventListener('submit', async e => {
  if (e.target.id !== 'logForm') return;
  e.preventDefault();
  const f = e.target.elements;
  const b = byId(f.book.value);
  const to = f.to.value === '' ? null : Number(f.to.value);
  const note = f.note.value.trim();
  const date = f.date.value || today();
  if (!b) return;
  if (to == null && !note) { toast('Add a page number or a note.', true); return; }
  try {
    const journal = withEntry(b, { date, to, note });
    const saved = await saveJournal(b, journal, to != null && to > (b.progress ?? 0) ? to : b.progress);
    const entry = saved.journal.find(x => x.date === date);
    toast(`Logged${entry && entryPages(entry) ? ` ${plural(entryPages(entry), 'page')} of` : ''} “${saved.title}”.`);
    state.journalDay = null;
    render();
    $('#logForm select').value = saved.id;
  } catch (err) {
    toast(err.message, true);
  }
});

view.addEventListener('submit', async e => {
  if (e.target.id !== 'goalForm') return;
  e.preventDefault();
  const year = e.target.dataset.year;
  const raw = e.target.goal.value.trim();
  try {
    state.settings = await api(`/api/goals/${year}`, { method: 'PUT', body: { goal: raw === '' ? null : Number(raw) } });
    toast(raw === '' ? 'Goal cleared.' : `Goal set: ${plural(Number(raw), 'book')} in ${year}.`);
    render();
  } catch (err) {
    toast(err.message === 'Unknown endpoint' ? 'Restart the server (npm start) to save goals.' : err.message, true);
  }
});

// Shared hover/focus tooltip for chart marks (anything with data-tip).
const tip = document.createElement('div');
tip.className = 'tip';
tip.hidden = true;
document.body.append(tip);
function showTip(el, x, y) {
  tip.textContent = el.dataset.tip;
  tip.hidden = false;
  const w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, x - w / 2))}px`;
  tip.style.top = `${y - h - 12 < 8 ? y + 16 : y - h - 12}px`;
}
view.addEventListener('mousemove', e => {
  const el = e.target.closest('[data-tip]');
  if (el) showTip(el, e.clientX, e.clientY); else tip.hidden = true;
});
view.addEventListener('mouseleave', () => { tip.hidden = true; });
view.addEventListener('focusin', e => {
  const el = e.target.closest('[data-tip]');
  if (!el) return;
  const r = el.getBoundingClientRect();
  showTip(el, r.left + r.width / 2, r.top);
});
view.addEventListener('focusout', () => { tip.hidden = true; });

view.addEventListener('scroll', e => {
  if (e.target.classList?.contains('shelf-scroll')) updateScroller(e.target.closest('.shelf-row'));
}, true);

// ---------- drag books around a shelf ----------
// The dragged book moves through the row live; neighbours slide aside (FLIP).
// Dropping saves the new order; Escape or dropping off the shelf puts it back.

let drag = null; // { slot, row, scroller, before, dropped }
const shelfIds = row => $$('.slot > [data-id]', row).map(x => x.dataset.id);

function slideTo(row, mutate) {
  const slots = [...row.children];
  const first = new Map(slots.map(s => [s, s.offsetLeft]));
  mutate();
  slots.forEach(s => {
    const dx = first.get(s) - s.offsetLeft;
    if (!dx || s === drag?.slot) return;
    s.style.transition = 'none';
    s.style.transform = `translateX(${dx}px)`;
    s.offsetWidth; // apply the inverted position before animating back
    s.style.transition = 'transform .22s ease';
    s.style.transform = '';
  });
}

// Books move along their own shelf. Objects can go anywhere: along a shelf,
// onto another shelf, or straight from the Decorate menu onto a shelf.
view.addEventListener('dragstart', e => {
  const opt = e.target.closest?.('.decor-opt[draggable]');
  if (opt) {
    const kind = opt.dataset.value;
    const holder = document.createElement('div');
    holder.innerHTML = decorSlot({ id: newDecorId(kind), kind });
    drag = { slot: holder.firstElementChild, row: null, scroller: null, before: null, from: null, decor: true, fresh: kind };
    e.dataTransfer.effectAllowed = 'copyMove';
    e.dataTransfer.setData('text/plain', kind);
    e.dataTransfer.setDragImage(opt.querySelector('svg'), 20, 40);
    view.classList.add('dragging-books', 'dragging-decor');
    return;
  }
  const slot = e.target.closest?.('.spines[data-shelf] > .slot');
  if (!slot) return;
  const row = slot.parentElement;
  const decor = slot.classList.contains('decor-slot');
  drag = { slot, row, scroller: row.closest('.shelf-scroll'), before: shelfIds(row), from: row, decor };
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', slot.firstElementChild.dataset.id);
  tip.hidden = true;
  view.classList.add('dragging-books');
  if (decor) view.classList.add('dragging-decor');
  requestAnimationFrame(() => slot.classList.add('dragging'));
});

view.addEventListener('dragover', e => {
  if (!drag) return;
  const scroller = e.target.closest('.shelf-scroll');
  if (!scroller) return;
  if (scroller !== drag.scroller) {
    // Books stay on their own shelf; objects hop onto whichever shelf you're over.
    if (!drag.decor) return;
    const row = $('.spines[data-shelf]', scroller);
    if (!row || row.classList.contains('by-category')) return;
    drag.row = row;
    drag.scroller = scroller;
    row.appendChild(drag.slot);
    drag.slot.classList.add('dragging');
  }
  e.preventDefault();
  e.dataTransfer.dropEffect = drag.fresh ? 'copy' : 'move';
  // Near either edge, keep the shelf scrolling so things can travel any distance.
  const r = scroller.getBoundingClientRect();
  const edge = 70;
  if (e.clientX < r.left + edge) scroller.scrollLeft -= Math.ceil((r.left + edge - e.clientX) / 4);
  else if (e.clientX > r.right - edge) scroller.scrollLeft += Math.ceil((e.clientX - (r.right - edge)) / 4);
  // Insert before the first other item whose centre is right of the pointer.
  const x = e.clientX - drag.row.getBoundingClientRect().left;
  const next = [...drag.row.children].find(s => s !== drag.slot && x < s.offsetLeft + s.offsetWidth / 2) ?? null;
  if (drag.slot.nextElementSibling === next) return;
  slideTo(drag.row, () => drag.row.insertBefore(drag.slot, next));
});

view.addEventListener('drop', e => { if (drag) { e.preventDefault(); drag.dropped = true; } });

view.addEventListener('dragend', () => {
  if (!drag) return;
  const { slot, row, from, before, dropped, fresh } = drag;
  drag = null;
  slot.classList.remove('dragging');
  view.classList.remove('dragging-books', 'dragging-decor');
  if (!dropped || !row) { render(); return; } // Escape, or let go off a shelf: put it back
  if (fresh) {
    $('.decor-pick')?.removeAttribute('open');
    saveShelfOrder(row.dataset.shelf, shelfIds(row));
    toast(`${DECOR[fresh].name} added.`);
    return;
  }
  // Read both shelves before saving: each save re-renders the page.
  const toIds = shelfIds(row);
  if (from && from !== row) {
    const fromIds = shelfIds(from);
    saveShelfOrder(from.dataset.shelf, fromIds.length ? fromIds : null);
    saveShelfOrder(row.dataset.shelf, toIds);
    return;
  }
  if (toIds.join('\n') !== before.join('\n')) saveShelfOrder(row.dataset.shelf, toIds);
});

view.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.matches('tr[data-action=open]')) openDrawer(e.target.dataset.id);
  // Alt+Left / Alt+Right moves the focused book along its shelf.
  if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    const btn = e.target.closest('.spines[data-shelf] > .slot > [data-id]');
    if (!btn) return;
    e.preventDefault();
    const row = btn.closest('.spines');
    const ids = shelfIds(row);
    const i = ids.indexOf(btn.dataset.id);
    const j = i + (e.key === 'ArrowLeft' ? -1 : 1);
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    saveShelfOrder(row.dataset.shelf, ids); // re-renders synchronously before saving
    const moved = $(`.spines[data-shelf="${row.dataset.shelf}"] [data-id="${CSS.escape(btn.dataset.id)}"]`);
    moved?.focus();
    moved?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }
});
view.addEventListener('input', e => {
  if (e.target.id === 'catalogSearch') { state.q = e.target.value; renderCatalogTable(); }
});
view.addEventListener('change', async e => {
  if (e.target.id === 'catalogSort') { state.sort = e.target.value; renderCatalogTable(); }
  if (e.target.matches('[data-progress]')) {
    const v = e.target.value === '' ? null : Math.max(0, Number(e.target.value));
    if (await quickUpdate(e.target.dataset.id, { progress: v })) toast('Bookmark moved.');
  }
});

document.addEventListener('keydown', e => {
  if ($('#addDialog').open) return;
  if (e.key === 'Escape' && state.openId) closeDrawer();
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's' && state.openId) {
    e.preventDefault();
    $('#bookForm')?.requestSubmit();
  }
});
window.addEventListener('beforeunload', e => { if (state.dirty) e.preventDefault(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) flushCard(); }); // save before you switch away

// Re-read the library whenever you come back to the tab, so edits made in
// Obsidian show up without a manual refresh.
async function load() {
  try {
    state.books = await api('/api/books');
    state.settings = await api('/api/settings').catch(() => state.settings);
  } catch (e) {
    toast(`Could not reach the library: ${e.message}`, true);
  }
  const focused = document.activeElement?.id;
  render();
  if (focused === 'catalogSearch') $('#catalogSearch')?.focus();
  if (session && $('#readingRoom').hidden) enterReadingRoom(); // a session was running before a reload
}
window.addEventListener('focus', load);

api('/api/config').then(c => {
  state.config = c;
  $('#libraryDir').textContent = c.libraryDir;
  if (STATIC) $('.colophon span').textContent = c.label ?? 'Read-only copy';
}).catch(() => {});
const firstLoad = load();

// ---------- the read-only public copy ----------
// Editing controls are hidden by CSS (:root[data-static]); this stops the rest:
// typing into a card, dragging books, and actions that would save something.
if (STATIC) {
  const KEEP = '#catalogSearch, #catalogSort, #librarySearch';
  const lock = root => $$('input, textarea, select', root).forEach(el => {
    if (el.matches(KEEP)) return;
    if (el.matches('input[type=text], input[type=number], input[type=date], input:not([type]), textarea')) el.readOnly = true;
    else el.disabled = true;
  });
  new MutationObserver(() => { lock(view); lock($('#drawer')); }).observe(document.body, { childList: true, subtree: true });
  const SAVES = new Set(['add', 'addDecor', 'removeDecor', 'resetOrder', 'startReading', 'finish', 'startPick', 'recWish', 'recSkip', 'recRefresh', 'fillCategories', 'move']);
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-action]');
    if (t && SAVES.has(t.dataset.action)) { e.preventDefault(); e.stopImmediatePropagation(); toast(READ_ONLY); }
  }, true);
  document.addEventListener('dragstart', e => { if (e.target.closest?.('#view')) e.preventDefault(); }, true);
  document.addEventListener('submit', e => { e.preventDefault(); e.stopImmediatePropagation(); }, true);
  // star ratings in a card, and Alt+arrow moving books along a shelf
  document.addEventListener('click', e => { if (e.target.closest?.('#drawer .stars')) e.stopImmediatePropagation(); }, true);
  document.addEventListener('keydown', e => {
    if (e.target.closest?.('#drawer .stars') || (e.altKey && /^Arrow/.test(e.key))) e.stopImmediatePropagation();
  }, true);
}

// ---------- the tour, and your own bookshelf ----------
// First visit to an empty bookshelf (and any time from the footer or the
// welcome card): a walk round each part of the page.

const setView = v => { if (state.view !== v) { state.view = v; localStorage.setItem('view', v); render(); } };
const closeMenus = () => $$('details[open]').forEach(d => { d.open = false; });

// The shelf's name, on the make-your-own site: "Maya's Bookshelf".
const shelfTitle = name => (name ? `${name}${/s$/i.test(name) ? '’' : '’s'} Bookshelf` : 'My Bookshelf');
function applyName() {
  if (!LOCAL) return;
  const title = shelfTitle(localStorage.getItem('bookshelf:name'));
  $('.masthead h1').textContent = title;
  document.title = title;
}
function setName(name) {
  name = name.trim().slice(0, 40);
  if (name) localStorage.setItem('bookshelf:name', name); else localStorage.removeItem('bookshelf:name');
  applyName();
}
if (LOCAL) {
  applyName();
  // Click the title to rename the shelf.
  const h1 = $('.masthead h1');
  h1.classList.add('renamable');
  h1.title = 'Click to rename your bookshelf';
  h1.addEventListener('click', () => {
    if (h1.querySelector('input')) return;
    const input = document.createElement('input');
    input.className = 'name-input';
    input.value = localStorage.getItem('bookshelf:name') ?? '';
    input.placeholder = 'Your name';
    input.setAttribute('aria-label', 'Your name, for the bookshelf’s title');
    h1.replaceChildren(input, document.createTextNode('’s Bookshelf'));
    input.focus();
    let done = false;
    const finish = save => { if (done) return; done = true; if (save) setName(input.value); else applyName(); };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); });
    input.addEventListener('blur', () => finish(true));
  });
}

const TOUR = () => [
  {
    target: null,
    title: LOCAL ? 'Welcome! This bookshelf is yours.' : 'Welcome to your bookshelf',
    body: `<p>Here's a quick look around: where your books go, how to make the shelves your own, and the little things
      that make the room. It takes about a minute.</p>${LOCAL ? '<p>First, whose bookshelf is this?</p>' : ''}`,
    html: LOCAL ? `<label class="tour-field"><input id="tourName" placeholder="Your name" autocomplete="given-name" maxlength="40" autofocus
      value="${esc(localStorage.getItem('bookshelf:name') ?? '')}"><span>’s Bookshelf</span></label>` : '',
    next: 'Show me around',
    before: () => { closeMenus(); setView('shelf'); window.scrollTo(0, 0); },
    leave: tip => { const n = tip.querySelector('#tourName'); if (n) setName(n.value); },
  },
  {
    target: '#addBtn',
    title: 'Add your books',
    body: `<p>Search Open Library by title, author or ISBN and the cover, pages and category fill themselves in, or type
      a book in by hand. Put it on a shelf as you add it: reading, to read, finished, set aside, or the wishlist.</p>`,
  },
  {
    target: '.shelf-section:has(.spines[data-shelf=tbr])',
    title: 'Your shelves',
    body: `<p>Books stand here, one shelf for each kind: Currently Reading at the top, then On the Shelf, Finished and
      your Wishlist. Drag books to arrange them. Click one to open its card, where you rate it, track your page and
      keep notes and a review.</p>`,
    before: () => setView('shelf'),
  },
  {
    target: '.shelf-mode',
    title: 'Make it yours',
    body: `<p><b>Decorate</b> puts objects among your books: two houseplants, a candle, a sleeping cat, tea, a globe.
      Drag them anywhere; click them to play. Choose a <b>wood or metal</b> for the shelves, group books <b>by
      category</b>, and show them by <b>cover or spine</b>.</p>`,
    before: () => { setView('shelf'); closeMenus(); },
  },
  {
    target: '#lampBtn',
    title: 'Day and night',
    body: `<p>Switch the whole room between day and night. Until you choose, it follows the clock and dims after 7 pm.</p>`,
  },
  {
    target: '#lamp',
    title: 'The reading lamp',
    body: `<p>Drag the lamp anywhere and it lights the spot beneath it. Pull its chain to switch the bulb on or off,
      brush past it to set it swinging, and double-click to hang it back up.</p>`,
    before: () => window.scrollTo(0, 0),
  },
  {
    target: '#sfWindow',
    title: 'A window onto San Francisco',
    body: `<p>The sky follows the real time of day in San Francisco, from dawn through dusk to stars, with the city's
      live weather: fog, rain and all. Hover over it for sunrise and sunset.</p>`,
  },
  {
    target: '#searchBtn',
    title: 'Find anything',
    body: `<p>Search every title, author, note and review in your library. Press <kbd>⌘K</kbd> or <kbd>/</kbd> from anywhere.</p>`,
  },
  {
    target: ['.tabs [data-view]'],
    title: 'Everything else',
    body: `<p><b>Card Catalog</b> lists every book, to sort and filter. <b>Rankings</b> is your favourites in order.
      <b>Year in Review</b> counts up your reading and sets a yearly goal. <b>Journal</b> logs what you read each day.
      <b>For You</b> recommends books based on what you've rated and read.</p>`,
  },
  ...(LOCAL ? [{
    target: '.colophon',
    title: 'Saved in this browser',
    body: `<p>Your library is kept on this device, private to you; there's no account. <b>Export</b> downloads every
      book as a Markdown file (they open in Obsidian too), and <b>Import</b> brings them back, here or on another
      computer.</p>`,
    before: () => window.scrollTo(0, document.body.scrollHeight),
  }] : []),
  {
    target: null,
    title: 'That’s the tour',
    body: `<p>Start with a book you're reading now, or one you loved. You can take this tour again from the bottom of the page.</p>`,
    actions: '<button type="button" class="link-btn" data-tour-action="add">Add a book</button>',
    next: 'Explore',
    before: () => window.scrollTo(0, 0),
    onAction: (a, end) => { if (a === 'add') { end(); openAdd(); } },
  },
];

let touring = null;
function startTour() {
  if (touring || STATIC) return;
  if (state.openId) closeDrawer();
  touring = runTour(TOUR(), { onEnd: () => { touring = null; localStorage.setItem('bookshelf:toured', '1'); } });
}

// The footer: where the library lives, and (in the browser) its backup.
async function exportLibrary() {
  const [{ browserStore }, { makeZip }] = await Promise.all([import('./lib/browser-store.js'), import('./lib/zip.js')]);
  const files = (await browserStore.list()).map(({ id, text }) => ({ name: `Bookshelf/${id}`, text }));
  if (!files.length) { toast('There are no books to export yet.'); return; }
  const count = files.length;
  const settings = await browserStore.readSettings();
  if (settings) files.push({ name: 'Bookshelf/.bookshelf.json', text: JSON.stringify(settings, null, 2) + '\n' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(makeZip(files));
  a.download = `Bookshelf ${today()}.zip`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  toast(`Exported ${plural(count, 'book')}.`);
}

async function importLibrary(fileList) {
  const [{ browserStore }, { readZip }, { validId }] = await Promise.all([import('./lib/browser-store.js'), import('./lib/zip.js'), import('./lib/library.js')]);
  const files = [];
  try {
    for (const f of fileList) {
      if (/\.zip$/i.test(f.name)) files.push(...await readZip(f));
      else files.push({ name: f.name, text: await f.text() });
    }
    let books = 0;
    for (const { name, text } of files) {
      const parts = name.split('/');
      const base = parts.pop();
      if (parts.some(p => p.startsWith('.') || p === '__MACOSX')) continue; // .trash, Finder's extras
      if (base === '.bookshelf.json') {
        const s = JSON.parse(text);
        const mine = (await browserStore.readSettings()) ?? {};
        await browserStore.writeSettings({ goals: { ...mine.goals, ...s.goals }, shelfOrder: { ...mine.shelfOrder, ...s.shelfOrder } });
      } else if (validId(base)) {
        await browserStore.write(base, text); // same file name: the imported copy wins
        books++;
      }
    }
    state.recs = null;
    await load();
    toast(books ? `Imported ${plural(books, 'book')}.` : 'No books (.md files) found in that.', !books);
  } catch (err) {
    toast(err.message, true);
  }
}

async function startOver() {
  if (!confirm('Remove every book from this bookshelf? This can’t be undone. (Export first if you want a copy.)')) return;
  const { browserStore } = await import('./lib/browser-store.js');
  browserStore.clear();
  state.recs = null;
  await load();
  toast('Your shelves are empty again.');
}

function setupFooter() {
  const foot = $('.colophon');
  if (STATIC) {
    // Liz's read-only shelf points visitors to the make-your-own site.
    if (MAKER_URL) foot.insertAdjacentHTML('beforeend', `<span class="foot-gap"></span><a class="link-btn" href="${esc(MAKER_URL)}">Make your own bookshelf →</a>`);
    return;
  }
  if (LOCAL) {
    foot.innerHTML = `<span>Saved in this browser</span>
      <button type="button" class="link-btn" data-foot="export">Export</button>
      <label class="link-btn">Import<input type="file" accept=".md,.zip,.json,text/markdown" multiple hidden data-foot="import"></label>
      <button type="button" class="link-btn" data-foot="reset">Start over</button>
      <span class="foot-gap"></span>
      <button type="button" class="link-btn" data-foot="tour">Take the tour</button>
      <a class="link-btn" href="${esc(EXAMPLE_URL)}">See an example shelf</a>`;
  } else {
    foot.insertAdjacentHTML('beforeend', '<span class="foot-gap"></span><button type="button" class="link-btn" data-foot="tour">Take the tour</button>');
  }
  foot.addEventListener('click', e => {
    const what = e.target.closest('button[data-foot]')?.dataset.foot;
    if (what === 'export') exportLibrary();
    else if (what === 'reset') startOver();
    else if (what === 'tour') startTour();
  });
  foot.addEventListener('change', e => {
    if (e.target.matches('[data-foot=import]') && e.target.files.length) { importLibrary([...e.target.files]); e.target.value = ''; }
  });
}
setupFooter();

// A first visit to an empty bookshelf starts the tour by itself.
if (!STATIC && !localStorage.getItem('bookshelf:toured')) {
  firstLoad.then(() => { if (!state.books.length) setTimeout(startTour, 500); });
}
