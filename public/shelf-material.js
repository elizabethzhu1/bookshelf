// Shelf materials. Each one is drawn as an SVG plank tile: 2400 × 240, the
// plank's top surface at y 205–213 and its front edge at 213–230, with the
// wall shadow beneath. The tile repeats along the shelf at its real size, so
// the grain is never stretched, and each repeat reads as a joint between
// boards. Night versions are the same drawing in dimmer, warmer light.

const W = 2400;

// top / topBack: the top surface, front to back. front: highlight, middle,
// underside of the front edge. ring/fiber: grain colour and strength.
export const MATERIALS = {
  oak:      { name: 'Oak',      kind: 'wood', top: '#c09060', topBack: '#7d5634', front: ['#b38152', '#9a6a3f', '#6f4626'], ring: '#5a3518', rings: .38, fiber: .32, knots: 2, seed: 11 },
  maple:    { name: 'Maple',    kind: 'wood', top: '#e6cc9f', topBack: '#b8956a', front: ['#dcbd8d', '#c9a678', '#a5814f'], ring: '#8f6a3c', rings: .24, fiber: .22, knots: 0, seed: 4 },
  pine:     { name: 'Pine',     kind: 'wood', top: '#e1bb80', topBack: '#a77c45', front: ['#d8ae6c', '#c39552', '#9a6e35'], ring: '#8a5622', rings: .5, fiber: .26, knots: 4, seed: 23 },
  cherry:   { name: 'Cherry',   kind: 'wood', top: '#b8683f', topBack: '#7a3a20', front: ['#ad5a33', '#934726', '#6a2e16'], ring: '#4a1c0c', rings: .32, fiber: .3, knots: 0, seed: 7 },
  mahogany: { name: 'Mahogany', kind: 'wood', top: '#86402a', topBack: '#4e1f12', front: ['#7c3824', '#652a1a', '#45190d'], ring: '#2a0c05', rings: .38, fiber: .34, knots: 0, seed: 31 },
  walnut:   { name: 'Walnut',   kind: 'wood', top: '#755239', topBack: '#3e281a', front: ['#66452d', '#523622', '#311e12'], ring: '#1e120a', rings: .42, fiber: .36, knots: 1, seed: 17 },
  ebony:    { name: 'Ebony',    kind: 'wood', top: '#433832', topBack: '#1d1714', front: ['#3a302a', '#2b231e', '#18120f'], ring: '#000000', rings: .45, fiber: .4, knots: 0, seed: 5 },
  steel:    { name: 'Brushed steel', kind: 'metal', top: '#d9dde1', topBack: '#8e949a', front: ['#eef0f2', '#b9bfc5', '#7c838a'], bolts: '#8b9198' },
  iron:     { name: 'Black iron',    kind: 'metal', top: '#575b60', topBack: '#24272a', front: ['#4b4f54', '#35383c', '#1d1f22'], bolts: '#6a6f75' },
};
export const MATERIAL_IDS = Object.keys(MATERIALS);

// Night: the same colours in dim, warm lamplight.
const hex = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
const toHex = rgb => '#' + rgb.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const dim = c => toHex(hex(c).map((v, i) => v * .58 + [26, 16, 8][i] * .42));

// Small seeded random generator, so each wood's grain is the same every time.
function rng(seed) {
  let a = seed * 2654435761 >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const f1 = n => n.toFixed(1);

// Grain drawn as lines: long, gently wandering lines running along the board,
// and on the front edge the nested arches ("cathedrals") of flat-sawn wood.
function grain(m, c) {
  const rand = rng(m.seed);
  const lines = [];
  const count = 16 + Math.round(m.rings * 20);
  for (let i = 0; i < count; i++) {
    let y = 205.5 + rand() * 24.5;
    let d = `M0 ${f1(y)}`;
    for (let x = 300; x <= W; x += 300) { y += (rand() - .5) * 2.2; d += ` T${x} ${f1(y)}`; }
    const w = .35 + rand() * .9, o = (.25 + rand() * .75) * m.rings * 1.3;
    lines.push(`<path d='${d.replace('T300', 'Q150 ' + f1(y) + ' 300')}' stroke-width='${w.toFixed(2)}' opacity='${o.toFixed(2)}'/>`);
  }
  const arches = [];
  const cathedrals = Math.round(m.rings * 7);
  for (let i = 0; i < cathedrals; i++) {
    const cx = rand() * W, len = 240 + rand() * 420, peak = 214 + rand() * 5;
    for (let k = 0; k < 4; k++) {
      const half = len / 2 * (1 - k * .2), top = peak + k * 2.6;
      arches.push(`<path d='M${f1(cx - half)} 230.5 C${f1(cx - half * .45)} ${f1(top)} ${f1(cx + half * .45)} ${f1(top)} ${f1(cx + half)} 230.5' stroke-width='${(.5 + rand() * .5).toFixed(2)}' opacity='${(m.rings * (.9 - k * .15)).toFixed(2)}'/>`);
    }
  }
  return `<g clip-path='url(#board)' fill='none' stroke='${c.ring}'>${lines.join('')}</g>`
    + `<g clip-path='url(#face)' fill='none' stroke='${c.ring}'>${arches.join('')}</g>`;
}

function wood(m, c) {
  const [r, g, b] = hex(c.ring).map(v => (v / 255).toFixed(3));
  // Knots: dark oval cores with a few rings swirling round them, spaced along the board.
  const knots = Array.from({ length: m.knots }, (_, i) => {
    const x = Math.round((W / m.knots) * (i + .35 + ((m.seed * (i + 3)) % 7) / 20));
    const y = 219 + ((m.seed + i) % 3) * 2.5;
    return `<g opacity='.55'><ellipse cx='${x}' cy='${y}' rx='15' ry='4.2' fill='none' stroke='${c.ring}' stroke-width='.8' opacity='.5'/>`
      + `<ellipse cx='${x}' cy='${y}' rx='9' ry='2.8' fill='none' stroke='${c.ring}' stroke-width='.9' opacity='.7'/>`
      + `<ellipse cx='${x}' cy='${y}' rx='4.5' ry='1.9' fill='${c.ring}'/></g>`;
  }).join('');
  return `<defs>
    <linearGradient id='t' x2='0' y2='1'><stop offset='0' stop-color='${c.topBack}'/><stop offset='1' stop-color='${c.top}'/></linearGradient>
    <linearGradient id='f' x2='0' y2='1'><stop offset='0' stop-color='${c.front[0]}'/><stop offset='.55' stop-color='${c.front[1]}'/><stop offset='1' stop-color='${c.front[2]}'/></linearGradient>
    <linearGradient id='s' x2='0' y2='1'><stop offset='0' stop-color='#1e1208' stop-opacity='.34'/><stop offset='1' stop-color='#1e1208' stop-opacity='0'/></linearGradient>
    <clipPath id='board'><rect y='205' width='${W}' height='25'/></clipPath>
    <clipPath id='face'><rect y='213' width='${W}' height='17'/></clipPath>
    <filter id='fiber' x='0' y='0' width='100%' height='100%'>
      <feTurbulence type='fractalNoise' baseFrequency='.003 .8' numOctaves='2' seed='${m.seed + 40}'/>
      <feColorMatrix values='0 0 0 0 ${r} 0 0 0 0 ${g} 0 0 0 0 ${b} 0 0 0 -${(m.fiber * 5).toFixed(2)} ${(m.fiber * 2.75).toFixed(2)}'/>
      <feComposite in2='SourceGraphic' operator='in'/>
    </filter>
  </defs>
  <rect y='205' width='${W}' height='8' fill='url(#t)'/>
  <rect y='213' width='${W}' height='17' fill='url(#f)'/>
  ${grain(m, c)}
  <rect y='205' width='${W}' height='25' filter='url(#fiber)'/>
  ${knots}
  <rect y='205' width='${W}' height='1' fill='#000' opacity='.18'/>
  <rect y='212.6' width='${W}' height='1.1' fill='#fff' opacity='.14'/>
  <rect y='213.7' width='${W}' height='1.5' fill='#fff' opacity='.07'/>
  <rect y='229' width='${W}' height='1' fill='${c.front[2]}'/>
  <rect y='205' width='1.4' height='25' fill='#000' opacity='.35'/>
  <rect y='230' width='${W}' height='10' fill='url(#s)'/>`;
}

function metal(m, c) {
  const bolts = Array.from({ length: 4 }, (_, i) => {
    const x = 300 + i * 600;
    return `<circle cx='${x}' cy='221.5' r='2.6' fill='${c.bolts}'/><circle cx='${x - .6}' cy='220.9' r='1.2' fill='#fff' opacity='.35'/>`
      + `<circle cx='${x}' cy='221.5' r='2.6' fill='none' stroke='#000' stroke-width='.5' opacity='.35'/>`;
  }).join('');
  return `<defs>
    <linearGradient id='t' x2='0' y2='1'><stop offset='0' stop-color='${c.topBack}'/><stop offset='1' stop-color='${c.top}'/></linearGradient>
    <linearGradient id='f' x2='0' y2='1'><stop offset='0' stop-color='${c.front[0]}'/><stop offset='.35' stop-color='${c.front[1]}'/><stop offset='1' stop-color='${c.front[2]}'/></linearGradient>
    <linearGradient id='glint' x2='1'><stop offset='0' stop-color='#fff' stop-opacity='0'/><stop offset='.3' stop-color='#fff' stop-opacity='.16'/><stop offset='.42' stop-color='#fff' stop-opacity='0'/><stop offset='.75' stop-color='#fff' stop-opacity='.08'/><stop offset='1' stop-color='#fff' stop-opacity='0'/></linearGradient>
    <linearGradient id='s' x2='0' y2='1'><stop offset='0' stop-color='#10141a' stop-opacity='.36'/><stop offset='1' stop-color='#10141a' stop-opacity='0'/></linearGradient>
    <filter id='brush' x='0' y='0' width='100%' height='100%'>
      <feTurbulence type='fractalNoise' baseFrequency='.0006 .9' numOctaves='2' seed='3'/>
      <feColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 -1.6 .9'/>
      <feComposite in2='SourceGraphic' operator='in'/>
    </filter>
    <filter id='brushDark' x='0' y='0' width='100%' height='100%'>
      <feTurbulence type='fractalNoise' baseFrequency='.0008 .75' numOctaves='2' seed='9'/>
      <feColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -1.4 .7'/>
      <feComposite in2='SourceGraphic' operator='in'/>
    </filter>
  </defs>
  <rect y='206' width='${W}' height='7' fill='url(#t)'/>
  <rect y='213' width='${W}' height='17' fill='url(#f)'/>
  <rect y='206' width='${W}' height='24' filter='url(#brush)' opacity='.5'/>
  <rect y='206' width='${W}' height='24' filter='url(#brushDark)' opacity='.45'/>
  <rect y='213' width='${W}' height='17' fill='url(#glint)'/>
  ${bolts}
  <rect y='205.5' width='${W}' height='1' fill='#000' opacity='.25'/>
  <rect y='212.7' width='${W}' height='.9' fill='#fff' opacity='.55'/>
  <rect y='229' width='${W}' height='1' fill='#000' opacity='.45'/>
  <rect y='230' width='${W}' height='10' fill='url(#s)'/>`;
}

const cache = new Map();
export function plankURI(id, night = false) {
  const key = `${id}:${night}`;
  if (!cache.has(key)) {
    const m = MATERIALS[id] ?? MATERIALS.oak;
    const c = night
      ? { ...m, top: dim(m.top), topBack: dim(m.topBack), front: m.front.map(dim), ring: m.ring && dim(m.ring), bolts: m.bolts && dim(m.bolts) }
      : m;
    const body = m.kind === 'metal' ? metal(m, c) : wood(m, c);
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${W}' height='240' viewBox='0 0 ${W} 240'>${body}</svg>`;
    cache.set(key, `url("data:image/svg+xml,${encodeURIComponent(svg.replace(/\s*\n\s*/g, ''))}")`);
  }
  return cache.get(key);
}
