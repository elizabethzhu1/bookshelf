// A small, dependency-free YAML frontmatter reader/writer.
// It understands the subset Obsidian "Properties" produce: scalars, quoted
// strings, inline lists ([a, b]) and block lists (- a). Anything more exotic
// (nested maps, multi-line strings) is kept verbatim in `raw` so it survives
// a round trip untouched.

const FM_RE = /^﻿?---[ \t]*\r?\n([\s\S]*?)^---[ \t]*(?:\r?\n|$)/m;

export function parse(text) {
  const m = FM_RE.exec(text);
  if (!m || m.index !== 0) return { data: {}, raw: {}, body: text };
  const { data, raw } = parseYaml(m[1]);
  return { data, raw, body: text.slice(m[0].length) };
}

function parseYaml(src) {
  const blocks = [];
  for (const line of src.split(/\r?\n/)) {
    const kv = /^([^\s:#\-][^:]*?):(?:[ \t]+(.*?))?[ \t]*$/.exec(line);
    if (kv) blocks.push({ key: kv[1].trim(), value: kv[2] ?? '', lines: [line] });
    else if (blocks.length) blocks[blocks.length - 1].lines.push(line);
  }

  const data = {};
  const raw = {};
  for (const { key, value, lines } of blocks) {
    while (lines.length > 1 && !lines[lines.length - 1].trim()) lines.pop();
    raw[key] = lines.join('\n');
    const rest = lines.slice(1);

    if (value === '') {
      const items = rest.map(l => /^\s*-(?:\s+(.*))?$/.exec(l)).filter(Boolean);
      data[key] = items.length ? items.map(i => scalar(i[1] ?? '')).filter(v => v !== null) : null;
    } else if (/^[|>][+-]?$/.test(value)) {
      data[key] = rest.map(l => l.trim()).join(value.startsWith('|') ? '\n' : ' ').trim();
    } else if (value.startsWith('[') && value.endsWith(']') && !value.startsWith('[[')) {
      data[key] = splitInline(value.slice(1, -1));
    } else {
      data[key] = scalar(value);
    }
  }
  return { data, raw };
}

function splitInline(s) {
  const out = [];
  let cur = '';
  let quote = null;
  for (const ch of s) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map(scalar).filter(v => v !== null);
}

function scalar(s) {
  s = s.trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    try { return JSON.parse(s); } catch { return s.slice(1, -1); }
  }
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
  s = s.replace(/\s+#.*$/, '');
  if (s === '' || s === '~' || s === 'null') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}

const PLAIN_RE = /^[\p{L}][\p{L}\p{N} .,'’&()!?-]*$/u;
const RESERVED_RE = /^(true|false|null|yes|no|on|off|~)$/i;

export function formatValue(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (PLAIN_RE.test(s) && !RESERVED_RE.test(s) && s === s.trim()) return s;
  return JSON.stringify(s);
}

export function formatEntry(key, v) {
  if (Array.isArray(v)) {
    return v.length ? `${key}:\n${v.map(x => `  - ${formatValue(x)}`).join('\n')}` : `${key}: []`;
  }
  return `${key}: ${formatValue(v)}`;
}
