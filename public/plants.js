// Two real houseplants, drawn leaf by leaf: a marble queen pothos and a zebra
// plant (Aphelandra squarrosa). Each leaf is built from a curved midrib and a
// width profile, then lit from the upper left: the half facing the light is
// brighter, the other half falls into shade along the crease of the midrib,
// glossy leaves catch a highlight, and every leaf casts a soft shadow onto
// whatever is behind it. Pothos leaves get marbling from fractal noise turned
// to follow the veins; zebra leaves get their cream midrib and arching veins.
//
// The drawings are standalone SVG documents in layers (foliage behind the pot,
// the pot, foliage in front) so the foliage can rustle while the pot stays put.
// They're pure strings (no DOM), and the same seed always grows the same plant.

const r2 = n => Math.round(n * 100) / 100;
const pt = ([x, y]) => `${r2(x)} ${r2(y)}`;

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Smooth open curve through points (Catmull-Rom as cubic Béziers).
function curve(pts, move = true) {
  let d = move ? `M${pt(pts[0])}` : `L${pt(pts[0])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(i - 1, 0)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(i + 2, pts.length - 1)];
    d += `C${pt([p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6])} ${pt([p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6])} ${pt(p2)}`;
  }
  return d;
}

const lerp = (a, b, t) => a + (b - a) * t;
function interp(prof, t) {
  for (let i = 1; i < prof.length; i++) {
    if (t <= prof[i][0]) {
      const [t0, w0] = prof[i - 1], [t1, w1] = prof[i];
      const u = (t - t0) / (t1 - t0 || 1);
      return lerp(w0, w1, u * u * (3 - 2 * u));
    }
  }
  return prof.at(-1)[1];
}

// ---------- leaf geometry ----------
// A leaf is 100 units long, base at the origin, pointing up (−y). Its midrib
// is a quadratic curve that bends sideways by `bend`. `prof` lists
// [position along the midrib, half-width as a fraction of W/2]; positions
// below 0 sit behind the base (the lobes of a heart-shaped leaf).

const L = 100;
function leafGeom({ W, prof, bend = 0, asym = 0, wave = 0, phase = 0 }) {
  const P1 = [bend * L * .45, -L * .55], P2 = [bend * L, -L];
  const mid = t => {
    if (t < 0) return [0, -t * L * 1.1];
    const u = 1 - t;
    return [2 * u * t * P1[0] + t * t * P2[0], 2 * u * t * P1[1] + t * t * P2[1]];
  };
  const tangent = t => {
    t = Math.max(t, 0);
    const x = 2 * (1 - t) * P1[0] + 2 * t * (P2[0] - P1[0]), y = 2 * (1 - t) * P1[1] + 2 * t * (P2[1] - P1[1]);
    const l = Math.hypot(x, y);
    return [x / l, y / l];
  };
  const half = t => {
    return interp(prof, t) * W / 2 * (1 + wave * Math.sin(t * 31 + phase) * Math.min(t * 4, 1));
  };
  // a point at fraction f of the half-width on side s (+1 right, −1 left)
  const at = (t, f, s) => {
    const m = mid(t), [tx, ty] = tangent(t);
    const w = half(t) * f * (1 + s * asym);
    return [m[0] - ty * w * s, m[1] + tx * w * s];
  };
  const ts = prof.map(([t]) => t);
  // dense samples so the outline follows the bent midrib
  const samples = [];
  for (let i = 0; i < ts.length - 1; i++) for (let k = 0; k < 2; k++) samples.push(lerp(ts[i], ts[i + 1], k / 2));
  samples.push(1);
  const right = samples.map(t => at(t, 1, 1));
  const left = samples.map(t => at(t, 1, -1));
  const midline = samples.filter(t => t >= 0).map(mid);
  const outline = `${curve(right)}${curve([...left].reverse(), false).replace(/^L[^C]*/, '')}Z`;
  const rightHalf = `${curve(right)}${curve([...midline].reverse(), false)}Z`;
  const leftHalf = `${curve(left)}${curve([...midline].reverse(), false)}Z`;
  return { mid, tangent, half, at, outline, rightHalf, leftHalf, midline };
}

// Place a leaf: base at (x, y), rotated (0 = pointing up, clockwise degrees),
// sized to `len` world units, foreshortened along its length by fy (leaf
// tipped toward or away from you) and across by fx (leaf turned on edge).
const place = ({ x, y, a, len, fx = 1, fy = 1 }) =>
  `translate(${r2(x)} ${r2(y)}) rotate(${r2(a)}) scale(${r2(len / L * fx)} ${r2(len / L * fy)})`;

// Which half faces the light (upper left)? Local −x points along
// rotate(a)·(−1, 0); it faces up-left when that has a negative y or x.
function litSide(a) {
  const r = a * Math.PI / 180;
  const nx = -Math.cos(r), ny = -Math.sin(r); // world direction of local −x
  return nx * -.5 + ny * -1 > 0 ? -1 : 1; // −1: left half is lit
}

function defsCommon() {
  return `
    <filter id="cast" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="-.3" dy="1.6" stdDeviation="1.5" flood-color="#081404" flood-opacity=".5"/></filter>
    <linearGradient id="shadeL" x2="1"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset=".47" stop-color="#fff" stop-opacity=".03"/><stop offset=".53" stop-color="#000" stop-opacity=".1"/><stop offset="1" stop-color="#000" stop-opacity=".34"/></linearGradient>
    <linearGradient id="shadeR" x2="1"><stop offset="0" stop-color="#000" stop-opacity=".34"/><stop offset=".47" stop-color="#000" stop-opacity=".1"/><stop offset=".53" stop-color="#fff" stop-opacity=".03"/><stop offset="1" stop-color="#fff" stop-opacity=".16"/></linearGradient>
    <radialGradient id="gloss"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".5" stop-color="#fff" stop-opacity=".16"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <linearGradient id="toTip" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#000" stop-opacity=".22"/><stop offset=".35" stop-color="#000" stop-opacity="0"/></linearGradient>`;
}

// Gloss: a soft highlight on the lit half, a little way up the leaf.
function glossy(g, lit, i, strength, where = .42) {
  const [x, y] = g.at(where, .45, lit);
  const [tx, ty] = g.tangent(where);
  const ang = Math.atan2(ty, tx) * 180 / Math.PI + 90;
  return `<ellipse cx="${r2(x)}" cy="${r2(y)}" rx="${r2(g.half(where) * .42)}" ry="22" transform="rotate(${r2(ang)} ${r2(x)} ${r2(y)})" fill="url(#gloss)" opacity="${strength}" clip-path="url(#c${i})"/>`;
}

const doc = (w, h, defs, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w * 4}" height="${h * 4}"><defs>${defsCommon()}${defs}</defs>${body}</svg>`;

// ---------- marble queen pothos ----------

const POTHOS_PROF = [[0, 0], [-.05, .2], [-.045, .42], [.03, .68], [.13, .9], [.26, 1], [.41, .94], [.56, .78], [.7, .55], [.83, .3], [.93, .11], [1, 0]];

function pothosLeaf(i, spec, rand) {
  const g = leafGeom({ W: L * .72, prof: POTHOS_PROF, bend: spec.bend, asym: (rand() - .5) * .18, wave: .015, phase: rand() * 6 });
  const lit = litSide(spec.a);
  const z = spec.z; // 0 deep inside the plant … 1 out in front
  const base = `hsl(${r2(lerp(98, 90, z))} ${r2(lerp(50, 56, z))}% ${r2(lerp(25, 37, z))}%)`;
  const ox = r2(rand() * 600), oy = r2(rand() * 600);
  // Marbling: noise stretched along one axis, turned so the streaks fan out
  // from the midrib toward the tip like the veins do.
  const marble = (path, s) => {
    const th = s * 38;
    return `<g transform="rotate(${-th}) translate(${ox} ${oy})" filter="url(#mb${(i % 3) + 1})"><path d="${path}" transform="translate(${-ox} ${-oy}) rotate(${th})"/></g>`;
  };
  const deep = (1 - z) * .42;
  const o = `href="#o${i}"`;
  return `<g filter="url(#cast)"><g transform="${place(spec)}">
    <defs><path id="o${i}" d="${g.outline}"/></defs><clipPath id="c${i}"><use ${o}/></clipPath>
    <use ${o} fill="${base}"/>
    ${marble(g.rightHalf, 1)}${marble(g.leftHalf, -1)}
    <use ${o} fill="url(#${lit < 0 ? 'shadeL' : 'shadeR'})"/>
    <use ${o} fill="url(#toTip)"/>
    ${glossy(g, lit, i, .55 + z * .35)}
    <path d="${curve(g.midline)}" fill="none" stroke="#e4eab0" stroke-width="1.6" opacity=".55"/>
    <path d="${curve(g.midline.map(([x, y]) => [x + lit * 1.6, y]))}" fill="none" stroke="#1d3a10" stroke-width="1.4" opacity=".25" clip-path="url(#c${i})"/>
    ${deep > .02 ? `<use ${o} fill="#0b1d05" opacity="${r2(deep)}"/>` : ''}
    <use ${o} fill="none" stroke="#24410f" stroke-width="1" opacity=".35"/>
  </g></g>`;
}

const POTHOS_DEFS = [1, 2, 3].map(k => `
  <filter id="mb${k}" x="-5%" y="-5%" width="110%" height="110%" color-interpolation-filters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency=".07 .018" numOctaves="4" seed="${k * 17}" result="n"/>
    <feColorMatrix in="n" result="lime" values="0 0 0 0 .66  0 0 0 0 .79  0 0 0 0 .3  3.6 0 0 0 -1.5"/>
    <feTurbulence type="fractalNoise" baseFrequency=".22 .045" numOctaves="3" seed="${k * 31}" result="n2"/>
    <feColorMatrix in="n2" result="cream" values="0 0 0 0 .92  0 0 0 0 .94  0 0 0 0 .7  0 5.5 0 0 -2.75"/>
    <feMerge result="m"><feMergeNode in="lime"/><feMergeNode in="cream"/></feMerge>
    <feComposite in="m" in2="SourceAlpha" operator="in"/>
  </filter>`).join('') + `
  <linearGradient id="nursery" x2="1"><stop offset="0" stop-color="#101010"/><stop offset=".28" stop-color="#2e2e2e"/><stop offset=".36" stop-color="#4a4a4a"/><stop offset=".5" stop-color="#262626"/><stop offset="1" stop-color="#0c0c0c"/></linearGradient>`;

function pothos(seed = 7) {
  const rand = rng(seed);
  const W = 124, H = 152, cx = 62, crown = [62, 99];
  const back = [], front = [];
  let i = 0;
  const vine = (pts, color = '#6d8c36', width = 1.3) => `<path d="${curve(pts)}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round"/>`;
  const petiole = (from, to, layer) => layer.push(`<path d="M${pt(from)} Q${pt([lerp(from[0], to[0], .3), Math.min(from[1], to[1]) - 4])} ${pt(to)}" fill="none" stroke="#7c9a3c" stroke-width="1" stroke-linecap="round"/>`);

  // The crown: a dome of leaves on long petioles, inner ones in shade.
  const crownLeaves = [];
  for (let k = 0; k < 42; k++) {
    const phi = (rand() * 2 - 1) * 86;               // direction from the crown
    const reach = (1 - Math.abs(phi) / 150) * lerp(8, 52, Math.sqrt(rand()));
    const pr = phi * Math.PI / 180;
    const x = crown[0] + Math.sin(pr) * reach * 1.08, y = crown[1] - Math.cos(pr) * reach * .86 - 4;
    const outward = Math.abs(phi) > 45 ? Math.sign(phi) * lerp(105, 140, rand()) : phi * 1.3 + (rand() - .5) * 50;
    const z = Math.min(1, reach / 52 * .65 + rand() * .45);
    crownLeaves.push({ x, y, a: outward, len: lerp(25, 34, rand()), fx: lerp(.8, 1, rand()), fy: lerp(.55, 1, rand()), bend: (rand() - .5) * .25, z,
      from: [crown[0] + (rand() - .5) * 8, crown[1] + 1], behind: z < .35 });
  }
  // a few held upright in the middle, so the crown has no hole
  for (let k = 0; k < 10; k++) {
    const x = crown[0] + (rand() - .5) * 30, y = crown[1] - lerp(-2, 30, rand());
    crownLeaves.push({ x, y, a: (x - crown[0]) * 2.2 + (rand() - .5) * 40, len: lerp(24, 32, rand()), fx: lerp(.8, 1, rand()), fy: lerp(.55, .9, rand()),
      bend: (rand() - .5) * .2, z: lerp(.3, .6, rand()), from: [crown[0], crown[1] + 1], behind: false });
  }
  crownLeaves.sort((p, q) => p.z - q.z);
  for (const s of crownLeaves) {
    petiole(s.from, [s.x, s.y], back);
    (s.behind ? back : front).push(pothosLeaf(i++, s, rand));
  }

  // Trailing vines spill over the rim and hang down over the shelf edge.
  const vines = [
    [[50, 100], [38, 101], [27, 112], [21, 128], [19, 150]],
    [[74, 100], [88, 102], [97, 116], [101, 134], [103, 152]],
    [[58, 101], [50, 108], [45, 124], [44, 141]],
  ];
  for (const v of vines) {
    front.push(vine(v));
    // leaves along the vine, alternating sides, smaller toward the tip
    const n = Math.round(v.length * 1.6);
    for (let k = 1; k <= n; k++) {
      const t = k / (n + .4), seg = t * (v.length - 1), j = Math.min(Math.floor(seg), v.length - 2), u = seg - j;
      const p = [lerp(v[j][0], v[j + 1][0], u), lerp(v[j][1], v[j + 1][1], u)];
      const dir = Math.atan2(v[j + 1][1] - v[j][1], v[j + 1][0] - v[j][0]) * 180 / Math.PI + 90; // clockwise from up
      const side = k % 2 ? 1 : -1;
      const a = dir + side * lerp(35, 70, rand());
      front.push(pothosLeaf(i++, { x: p[0], y: p[1], a, len: lerp(25, 15, t) * lerp(.9, 1.1, rand()), fx: lerp(.8, 1, rand()), fy: lerp(.6, .95, rand()), bend: side * .12, z: lerp(.95, .7, t) }, rand));
    }
  }

  // A black nursery pot, mostly hidden.
  const pot = `
    <path d="M${cx - 21} 103 L${cx + 21} 103 L${cx + 17} 127 Q${cx} 129.5 ${cx - 17} 127 Z" fill="url(#nursery)"/>
    <path d="M${cx - 21} 106 L${cx + 21} 106" stroke="#000" stroke-width="1.2" opacity=".5"/>
    <rect x="${cx - 23}" y="98" width="46" height="6" rx="1.4" fill="url(#nursery)"/>
    <ellipse cx="${cx}" cy="99.2" rx="21.5" ry="2.6" fill="#2c2117"/>
    <path d="M${cx - 10} 108 L${cx - 9} 125 M${cx + 3} 108 L${cx + 3} 126" stroke="#fff" stroke-width=".5" opacity=".06"/>`;

  return {
    w: W, h: H, drop: 24, origin: crown,
    layers: [doc(W, H, POTHOS_DEFS, back.join('')), doc(W, H, POTHOS_DEFS, pot), doc(W, H, POTHOS_DEFS, front.join(''))],
  };
}

// ---------- zebra plant ----------

const ZEBRA_PROF = [[0, 0], [.04, .14], [.12, .4], [.25, .72], [.38, .93], [.5, 1], [.62, .95], [.74, .78], [.85, .46], [.93, .2], [.98, .06], [1, 0]];

function zebraLeaf(i, spec, rand) {
  const g = leafGeom({ W: L * .43, prof: ZEBRA_PROF, bend: spec.bend, asym: (rand() - .5) * .12, wave: .035, phase: rand() * 6 });
  const lit = litSide(spec.a);
  const z = spec.z;
  const base = `hsl(${r2(lerp(134, 126, z))} ${r2(lerp(30, 36, z))}% ${r2(lerp(12, 19, z))}%)`;
  const vein = '#e9e8cf';
  // Lateral veins leave the midrib and arch toward the tip.
  const veins = [];
  const N = 11;
  for (const s of [-1, 1]) {
    for (let k = 0; k < N; k++) {
      const t0 = .05 + k * (.8 / N) + (rand() - .5) * .025;
      const t1 = Math.min(t0 + .1 + .1 * (1 - t0), .97);
      const p0 = g.at(t0, 0, s), c = g.at(t0 + .02, .55, s), p1 = g.at(t1, .9, s);
      veins.push(`M${pt(p0)} Q${pt(c)} ${pt(p1)}`);
    }
  }
  const veinPath = veins.join('');
  // The midrib: a cream band, broad at the base, fine at the tip.
  const rib = [];
  const rt = Array.from({ length: 14 }, (_, k) => k / 13);
  const ribW = t => lerp(3, .4, t);
  const ribSide = s => rt.map(t => { const m = g.mid(t), [tx, ty] = g.tangent(t); return [m[0] - ty * ribW(t) * s, m[1] + tx * ribW(t) * s]; });
  rib.push(`${curve(ribSide(1))}${curve(ribSide(-1).reverse(), false)}Z`);
  // A brown, dried tip on some leaves, like the older leaves on a real one.
  let tip = '';
  if (spec.dry) {
    // the dead zone runs a little way down one margin, with a ragged edge
    const edge = Array.from({ length: 11 }, (_, k) => { const f = -1 + k / 5; return g.at(spec.dry - (f + 1) * .05 + (rand() - .5) * .035, f, 1); });
    tip = `<g clip-path="url(#c${i})"><path d="${curve(edge)} L${pt(g.at(1.05, 0, 1))} Z" fill="#7a4e26"/>`
      + `<path d="${curve(edge)}" fill="none" stroke="#a87a3a" stroke-width="2" opacity=".85"/>`
      + `<path d="${curve(edge.map(([x, y]) => [x, y - 3]))} L${pt(g.at(1.05, 0, 1))} Z" fill="#c9a060" opacity=".3"/></g>`;
  }
  const o = `href="#o${i}"`;
  return `<g filter="url(#cast)"><g transform="${place(spec)}">
    <defs><path id="o${i}" d="${g.outline}"/></defs><clipPath id="c${i}"><use ${o}/></clipPath>
    <use ${o} fill="${base}"/>
    <g clip-path="url(#c${i})" fill="none" stroke-linecap="round">
      <path d="${veinPath}" stroke="${vein}" stroke-width="3.4" opacity=".16"/>
      <path d="${veinPath}" stroke="${vein}" stroke-width="1.5" opacity=".9"/>
    </g>
    <path d="${rib[0]}" fill="${vein}"/>
    <path d="${curve(g.midline)}" fill="none" stroke="#fff" stroke-width=".7" opacity=".5"/>
    ${tip}
    <use ${o} fill="url(#${lit < 0 ? 'shadeL' : 'shadeR'})"/>
    <use ${o} fill="url(#toTip)"/>
    ${glossy(g, lit, i, .5 + z * .4, .36)}${glossy(g, -lit, i, .18, .6)}
    ${z < .5 ? `<use ${o} fill="#040c03" opacity="${r2((.5 - z) * .7)}"/>` : ''}
    <use ${o} fill="none" stroke="#0c1a0b" stroke-width="1.2" opacity=".5"/>
  </g></g>`;
}

const ZEBRA_DEFS = `
  <linearGradient id="clay" x2="1"><stop offset="0" stop-color="#7c3a1e"/><stop offset=".22" stop-color="#b8643a"/><stop offset=".38" stop-color="#d98a5c"/><stop offset=".5" stop-color="#c0703f"/><stop offset=".8" stop-color="#99492a"/><stop offset="1" stop-color="#6b2f18"/></linearGradient>
  <linearGradient id="stem" x2="1"><stop offset="0" stop-color="#2a1720"/><stop offset=".4" stop-color="#5a3443"/><stop offset="1" stop-color="#24131b"/></linearGradient>
  <filter id="grit" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="4"/><feColorMatrix values="0 0 0 0 .3  0 0 0 0 .15  0 0 0 0 .08  0 0 0 -1.4 .9"/><feComposite in2="SourceGraphic" operator="in"/></filter>`;

function zebra(seed = 11) {
  const rand = rng(seed);
  const W = 132, H = 150, cx = 66;
  const behind = [], front = [];
  let i = 0;
  // stem: thick at the soil, thinner toward the bud
  const stemPts = [[cx + 1, 120], [cx + 1.5, 96], [cx + .5, 70], [cx + 2.5, 48], [cx + 3, 36]];
  const stem = (pts, w0, w1) => {
    const out = [];
    for (let k = 0; k < pts.length - 1; k++) {
      const w = lerp(w0, w1, k / (pts.length - 1));
      out.push(`<path d="M${pt(pts[k])} L${pt(pts[k + 1])}" stroke="url(#stem)" stroke-width="${r2(w)}" stroke-linecap="round"/>`);
    }
    return out.join('');
  };
  behind.push(stem(stemPts, 3.2, 1.4));
  const side = [[cx - 3, 120], [cx - 9, 102], [cx - 15, 88]];
  const side2 = [[cx + 3, 120], [cx + 9, 104], [cx + 14, 92]];
  behind.push(stem(side, 2.6, 1.5), stem(side2, 2.6, 1.5));

  const stemAt = y => { // x of the main stem at height y
    for (let k = 0; k < stemPts.length - 1; k++) {
      const [a, b] = [stemPts[k], stemPts[k + 1]];
      if (y <= a[1] && y >= b[1]) return lerp(a[0], b[0], (a[1] - y) / (a[1] - b[1]));
    }
    return cx;
  };
  // Opposite leaves, each pair turned 90° from the last (so every other pair
  // points at you and away, foreshortened). Lower leaves are bigger and droop.
  const leaves = [];
  const pair = (y, len, a, opts = {}) => {
    const x = stemAt(y);
    const droop = s => s * .24 * Math.abs(Math.sin(a * Math.PI / 180));
    a += (rand() - .5) * 12;
    leaves.push({ x: x + 1.2, y, a, len, bend: droop(1), fx: .88, fy: opts.fy ?? .9, z: opts.z ?? .8, dry: opts.dryR, layer: opts.front ? front : behind });
    leaves.push({ x: x - 1.2, y: y + .5, a: -a + (rand() - .5) * 14, len: len * lerp(.92, 1.04, rand()), bend: droop(-1), fx: .88, fy: opts.fy ?? .9, z: opts.z ?? .8, dry: opts.dryL, layer: opts.front ? front : behind });
  };
  const facing = (y, len, aFront, aBack, opts = {}) => {
    const x = stemAt(y);
    leaves.push({ x: x - 1, y: y - 1, a: aBack, len: len * .9, bend: Math.sign(aBack) * .1, fy: .6, z: .2, layer: behind });
    leaves.push({ x, y, a: aFront, len, bend: Math.sign(aFront) * .16, fy: opts.fy ?? .62, fx: 1.05, z: 1, dry: opts.dry, layer: opts.front ? front : behind });
  };
  pair(113, 56, 112, { fy: .84, z: .6, front: true, dryR: .88 });
  facing(103, 50, 158, -14, { front: true, dry: .9, fy: .58 });
  pair(93, 54, 84, { fy: .92, z: .7, dryL: .9 });
  facing(81, 46, 128, -44, { fy: .7 });
  pair(70, 42, 58, { z: .8 });
  facing(60, 34, 30, -30, { fy: .78 });
  pair(51, 26, 30, { z: .88 });
  pair(44, 17, 12, { z: .95 });
  // side shoots, one each side, filling the plant out
  leaves.push({ x: side[1][0], y: side[1][1], a: -136, len: 48, bend: -.18, fy: .72, z: .5, layer: behind });
  leaves.push({ x: side[2][0], y: side[2][1], a: -74, len: 42, bend: -.16, fy: .8, z: .62, layer: behind });
  leaves.push({ x: side[2][0] + 1, y: side[2][1] - 1, a: -24, len: 32, bend: -.08, fy: .85, z: .45, layer: behind });
  leaves.push({ x: side2[1][0], y: side2[1][1], a: 132, len: 47, bend: .18, fy: .7, z: .52, layer: behind });
  leaves.push({ x: side2[2][0], y: side2[2][1], a: 66, len: 40, bend: .15, fy: .78, z: .58, layer: behind });
  leaves.push({ x: side2[2][0] - 1, y: side2[2][1] - 1, a: 20, len: 30, bend: .06, fy: .9, z: .4, layer: behind });

  for (const layer of [behind, front]) {
    for (const s of leaves.filter(l => l.layer === layer).sort((p, q) => p.z - q.z)) {
      layer.push(`<path d="M${pt([s.x, s.y])} l${r2(Math.sin(s.a * Math.PI / 180) * 3)} ${r2(-Math.cos(s.a * Math.PI / 180) * 3)}" stroke="#4a2a36" stroke-width="1.6" stroke-linecap="round"/>`);
      const r = s.a * Math.PI / 180;
      layer.push(zebraLeaf(i++, { ...s, x: s.x + Math.sin(r) * 2.6, y: s.y - Math.cos(r) * 2.6 }, rand));
    }
  }
  // the bud at the top: tight, pale new leaves
  const bud = [-14, 12, -2].map((a, k) => zebraLeaf(i++, { x: stemAt(37) + (k - 1) * .6, y: 38, a, len: lerp(10, 13, rand()), fx: .6, fy: 1, bend: 0, z: 1 }, rand)
    .replace(/hsl\([^)]*\)/, 'hsl(96 40% 36%)'));
  behind.push(...bud);

  // A terracotta pot with a rolled rim.
  const pot = `
    <ellipse cx="${cx}" cy="118.5" rx="22.5" ry="3" fill="#2a1d14"/>
    <path d="M${cx - 22} 125 L${cx + 22} 125 L${cx + 18} 147 Q${cx} 150.5 ${cx - 18} 147 Z" fill="url(#clay)"/>
    <path d="M${cx - 22} 125 L${cx + 22} 125 L${cx + 18} 147 Q${cx} 150.5 ${cx - 18} 147 Z" filter="url(#grit)" opacity=".5"/>
    <path d="M${cx - 21.6} 126.6 L${cx + 21.6} 126.6" stroke="#3a1a0c" stroke-width="2" opacity=".35"/>
    <rect x="${cx - 25}" y="116.5" width="50" height="9.5" rx="2.2" fill="url(#clay)"/>
    <rect x="${cx - 25}" y="116.5" width="50" height="9.5" rx="2.2" filter="url(#grit)" opacity=".45"/>
    <rect x="${cx - 24}" y="117.2" width="48" height="1.3" rx=".6" fill="#f0b088" opacity=".4"/>`;

  return {
    w: W, h: H, drop: 0, origin: [cx, 118],
    layers: [doc(W, H, ZEBRA_DEFS, behind.join('')), doc(W, H, ZEBRA_DEFS, pot), doc(W, H, ZEBRA_DEFS, front.join(''))],
  };
}

export const PLANTS = { pothos, zebra };
