// The Bookshelf: a tiny local server with no dependencies.
// Books are stored as Markdown files (YAML frontmatter + body) in LIBRARY_DIR.
// Point LIBRARY_DIR at a folder inside your Obsidian vault and both apps share
// the same files. The library logic lives in public/lib/library.js (the public
// site runs the same code in the browser); this file gives it a folder of .md
// files to work on and serves it over HTTP.

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createLibrary, validId } from './public/lib/library.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const expandHome = p => (p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p);
const LIBRARY_DIR = path.resolve(expandHome(process.env.LIBRARY_DIR || path.join(ROOT, 'library')));
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 4321;
const HOST = process.env.HOST || '127.0.0.1';

// ---------- the library folder ----------

const fileFor = id => {
  if (!validId(id) || id !== path.basename(id)) throw Object.assign(new Error('Invalid book id'), { status: 400 });
  return path.join(LIBRARY_DIR, id);
};
// Kept as a hidden JSON file next to the books so it travels with the library.
const SETTINGS_FILE = path.join(LIBRARY_DIR, '.bookshelf.json');

async function writeAtomic(file, text) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  await fs.writeFile(tmp, text, 'utf8');
  await fs.rename(tmp, file);
}

const diskStore = {
  async list() {
    await fs.mkdir(LIBRARY_DIR, { recursive: true });
    const entries = await fs.readdir(LIBRARY_DIR, { withFileTypes: true });
    const files = entries.filter(e => e.isFile() && /\.md$/i.test(e.name) && !e.name.startsWith('.'));
    return Promise.all(files.map(async f => ({ id: f.name, text: await fs.readFile(path.join(LIBRARY_DIR, f.name), 'utf8') })));
  },
  async read(id) {
    try { return await fs.readFile(fileFor(id), 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  },
  async write(id, text, { create } = {}) {
    if (create) { await fs.mkdir(LIBRARY_DIR, { recursive: true }); await fs.writeFile(fileFor(id), text, { encoding: 'utf8', flag: 'wx' }); }
    else await writeAtomic(fileFor(id), text);
  },
  // Soft delete: move into a hidden .trash folder (Obsidian ignores dot-folders).
  async remove(id) {
    const trash = path.join(LIBRARY_DIR, '.trash');
    await fs.mkdir(trash, { recursive: true });
    await fs.rename(fileFor(id), path.join(trash, `${Date.now()}-${id}`));
  },
  async readSettings() { return JSON.parse(await fs.readFile(SETTINGS_FILE, 'utf8')); },
  async writeSettings(s) { await writeAtomic(SETTINGS_FILE, JSON.stringify(s, null, 2) + '\n'); },
};

const library = createLibrary(diskStore);

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
  const { pathname } = new URL(req.url, 'http://localhost');
  try {
    if (pathname === '/api/config') return send(res, 200, { libraryDir: LIBRARY_DIR });
    if (pathname === '/api/weather') return send(res, 200, await sfWeather());
    if (pathname.startsWith('/api/')) {
      const body = ['POST', 'PUT'].includes(req.method) ? await readJson(req) : undefined;
      const out = await library.handle(req.method, req.url, body);
      if (out === null) return send(res, 404, { error: 'Unknown endpoint' });
      return send(res, req.method === 'POST' && pathname === '/api/books' ? 201 : 200, out);
    }
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
