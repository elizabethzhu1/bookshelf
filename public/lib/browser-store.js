// A library kept in the visitor's browser, for the public site: each book is
// the same Markdown text the desktop app writes to a .md file, saved in
// localStorage under "bookshelf:book:<file name>". Settings (goals, shelf
// order) sit under "bookshelf:settings". Export/Import (see app.js) turns
// these into real .md files and back.

const BOOK = 'bookshelf:book:';
const SETTINGS = 'bookshelf:settings';

function put(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    throw Object.assign(new Error('Your browser’s storage for this site is full. Export your library to keep a copy.'), { status: 507 });
  }
}

export const browserStore = {
  async list() {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key.startsWith(BOOK)) out.push({ id: key.slice(BOOK.length), text: localStorage.getItem(key) });
    }
    return out;
  },
  async read(id) { return localStorage.getItem(BOOK + id); },
  async write(id, text, { create } = {}) {
    if (create && localStorage.getItem(BOOK + id) != null) throw Object.assign(new Error('That book already exists'), { status: 409 });
    put(BOOK + id, text);
  },
  async remove(id) { localStorage.removeItem(BOOK + id); },
  async readSettings() { return JSON.parse(localStorage.getItem(SETTINGS) || 'null'); },
  async writeSettings(s) { put(SETTINGS, JSON.stringify(s)); },
  // Everything, for Start over.
  clear() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith(BOOK) || k === SETTINGS) keys.push(k); }
    keys.forEach(k => localStorage.removeItem(k));
  },
};
