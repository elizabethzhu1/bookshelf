// Objects you can stand on a shelf among the books. Each is a small SVG whose
// bottom edge sits on the plank. They live in a shelf's saved order like
// books do, under ids like "decor:cat:k3j2", so dragging, saving and
// arrow-key moving all just work.
//
// Click one to play with it: the cat wakes up, the candle goes out (or is
// relit), the tea steams, the plants rustle, the globe spins.
//
// The pothos and zebra plant are drawn leaf by leaf in plants.js. Those
// drawings are big, so each is made once, kept as an image (blob URL), and
// shown in three layers: leaves behind the pot, the pot, leaves in front.

import { PLANTS } from './plants.js';

const leaf = (angle, len, w, color) =>
  `<g transform="translate(35 80) rotate(${angle})"><path d="M0 0 C${w} ${-len * .3} ${w * .6} ${-len * .8} 0 ${-len} C${-w * .6} ${-len * .8} ${-w} ${-len * .3} 0 0 Z" fill="${color}"/>`
  + `<path d="M0 -2 Q1 ${-len * .5} 0 ${-len * .93}" stroke="#2f5228" stroke-width=".8" fill="none" opacity=".55"/></g>`;

const land = dx => `<g transform="translate(${dx} 0)" fill="#e4d6a4">
  <path d="M6 30 c5 -7 15 -9 19 -2 c3 5 -3 8 -1 13 c2 7 -6 9 -10 4 c-4 -5 -11 -6 -8 -15z"/>
  <path d="M30 18 c6 -3 14 -1 15 5 c1 4 -5 4 -6 8 c-1 5 -7 3 -8 -2 c-1 -4 -4 -8 -1 -11z"/>
  <path d="M40 46 c4 -4 12 -3 14 2 c2 6 -4 12 -9 10 c-4 -2 -8 -7 -5 -12z"/>
  <path d="M55 22 c4 -2 9 0 10 4 c1 5 -4 6 -7 5 c-3 -1 -6 -6 -3 -9z"/>
  <path d="M12 54 c3 -2 8 -1 9 2 c1 3 -3 5 -6 4 c-3 0 -5 -4 -3 -6z"/>
</g>`;

// Built on first use, then shared by every copy on the page.
const plantArt = {};
function plantLayers(kind) {
  if (!plantArt[kind]) {
    const p = PLANTS[kind]();
    plantArt[kind] = { ...p, urls: p.layers.map(svg => URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))) };
  }
  const { w, h, origin: [ox, oy], urls: [back, pot, front] } = plantArt[kind];
  const img = href => `<image href="${href}" width="${w}" height="${h}"/>`;
  return `<g class="plant-leaves" style="transform-origin:${ox}px ${oy}px">${img(back)}</g>${img(pot)}`
    + `<g class="plant-leaves" style="transform-origin:${ox}px ${oy}px">${img(front)}</g>`;
}

export const DECOR = {
  pothos: {
    name: 'Marble pothos', w: 124, h: 152, drop: 24, size: 1.3, // its vines hang over the shelf edge
    svg: () => plantLayers('pothos'),
  },
  zebra: {
    name: 'Zebra plant', w: 132, h: 150, size: 1.35,
    svg: () => plantLayers('zebra'),
  },
  plant: {
    name: 'Potted plant', w: 70, h: 124,
    svg: () => `
      <defs><linearGradient id="dPot" x2="1"><stop offset="0" stop-color="#a5532f"/><stop offset=".45" stop-color="#d98055"/><stop offset="1" stop-color="#8f4527"/></linearGradient></defs>
      <g class="decor-sway">
        ${leaf(-58, 42, 9, '#5f8f4e')}${leaf(-32, 58, 10, '#4f7f42')}${leaf(58, 40, 8, '#6fa05c')}${leaf(36, 52, 9, '#5c8c4b')}
        ${leaf(-9, 68, 11, '#6a9c58')}${leaf(14, 60, 10, '#4a7a3e')}${leaf(-20, 40, 8, '#7aab63')}${leaf(25, 42, 8, '#78a862')}
      </g>
      <ellipse cx="35" cy="81" rx="19" ry="3" fill="#3b2a1e"/>
      <path d="M16 86 L54 86 L50 121 Q35 125 20 121 Z" fill="url(#dPot)"/>
      <rect x="13" y="79" width="44" height="9" rx="2" fill="url(#dPot)"/>
      <rect x="13" y="87" width="44" height="1.5" fill="#000" opacity=".18"/>`,
  },
  candle: {
    name: 'Candle', w: 44, h: 96,
    svg: () => `
      <defs>
        <linearGradient id="dWax" x2="1"><stop offset="0" stop-color="#e2d4b8"/><stop offset=".4" stop-color="#f7efdf"/><stop offset="1" stop-color="#d8c8a8"/></linearGradient>
        <linearGradient id="dBrass" x2="1"><stop offset="0" stop-color="#8a6a2c"/><stop offset=".45" stop-color="#e2c27a"/><stop offset="1" stop-color="#7a5a22"/></linearGradient>
        <radialGradient id="dFlame" cx=".5" cy=".75" r=".7"><stop offset="0" stop-color="#fffbe8"/><stop offset=".45" stop-color="#ffd76a"/><stop offset="1" stop-color="#ff8a2a"/></radialGradient>
        <radialGradient id="dGlow"><stop offset="0" stop-color="#ffcf7a" stop-opacity=".55"/><stop offset="1" stop-color="#ffcf7a" stop-opacity="0"/></radialGradient>
      </defs>
      <g class="decor-flame">
        <circle class="flame-halo" cx="22" cy="28" r="18" fill="url(#dGlow)"/>
        <path class="flame" d="M22 15 C27 23 27.5 31 22 38 C16.5 31 17 23 22 15 Z" fill="url(#dFlame)"/>
        <ellipse cx="22" cy="36.4" rx="2.2" ry="1.3" fill="#6a8cff" opacity=".45"/>
      </g>
      <path class="smoke" d="M22 36 q-4 -6 0 -12 q4 -6 0 -12" stroke="#bbb" stroke-width="1.2" fill="none" opacity="0"/>
      <line x1="22" y1="37" x2="22" y2="44" stroke="#2b2118" stroke-width="1.3"/>
      <rect x="14" y="43" width="16" height="44" rx="2" fill="url(#dWax)"/>
      <ellipse cx="22" cy="43.5" rx="8" ry="2" fill="#fbf6ea"/>
      <path d="M15 45 q1.5 7 0 11 q-1.5 -4 0 -11z M27 45 q1.6 4 0 7 q-1.4 -3 0 -7z" fill="#f4ead6"/>
      <rect x="8" y="84" width="28" height="7" rx="3.5" fill="url(#dBrass)"/>
      <ellipse cx="22" cy="91" rx="19" ry="4.5" fill="url(#dBrass)"/>`,
  },
  mug: {
    name: 'Mug of tea', w: 66, h: 78,
    svg: () => `
      <defs><linearGradient id="dGlaze" x2="1"><stop offset="0" stop-color="#2a5372"/><stop offset=".4" stop-color="#4483ab"/><stop offset="1" stop-color="#244a66"/></linearGradient></defs>
      <g class="steam" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round">
        <path d="M20 24 q-5 -6 0 -11 q5 -5 0 -11"/><path d="M29 22 q-5 -6 0 -11 q5 -5 0 -11"/><path d="M38 24 q-5 -6 0 -11 q5 -5 0 -11"/>
      </g>
      <path d="M47 38 C63 38 63 63 46 63" stroke="url(#dGlaze)" stroke-width="6" fill="none"/>
      <path d="M8 31 L48 31 L46 71 Q46 77 40 77 L16 77 Q10 77 10 71 Z" fill="url(#dGlaze)"/>
      <rect x="9.6" y="60" width="37" height="3" fill="#ece3cf" opacity=".75"/>
      <ellipse cx="28" cy="31" rx="20" ry="4" fill="#1f3f57"/>
      <ellipse cx="28" cy="32" rx="17" ry="2.8" fill="#6b3d1d"/>
      <rect x="14" y="36" width="3" height="34" rx="1.5" fill="#fff" opacity=".14"/>`,
  },
  cat: {
    name: 'Sleeping cat', w: 132, h: 66,
    svg: () => `
      <defs><linearGradient id="dFur" x2="0" y2="1"><stop offset="0" stop-color="#df9d58"/><stop offset="1" stop-color="#b5713a"/></linearGradient></defs>
      <g class="zz" font-family="Georgia, serif" font-style="italic" fill="currentColor"><text x="44" y="18" font-size="9">z</text><text x="51" y="10" font-size="11">z</text><text x="60" y="3" font-size="13">z</text></g>
      <g class="cat-breathe">
        <path d="M18 64 C10 50 20 26 52 22 C80 18 112 26 120 46 C124 56 118 64 108 64 Z" fill="url(#dFur)"/>
        <g stroke="#a4622c" stroke-width="3" stroke-linecap="round" fill="none" opacity=".6">
          <path d="M60 24 q4 8 2 16"/><path d="M74 23 q4 9 1 17"/><path d="M88 26 q3 8 0 15"/><path d="M101 31 q2 7 -1 13"/>
        </g>
      </g>
      <path class="cat-tail" d="M108 63 C100 71 60 71 40 65 C34 63 34 58 40 58 C60 62 92 60 104 56 Z" fill="#c27e3f"/>
      <ellipse cx="48" cy="63" rx="9" ry="3.4" fill="#f0c48f"/>
      <g class="cat-head">
        <path d="M8 56 C2 44 10 30 26 30 C40 30 46 42 42 54 C40 62 30 64 20 64 C14 64 10 61 8 56 Z" fill="#d99854"/>
        <path class="ear" d="M12 37 L10 22 L22 31 Z" fill="#c9813f"/><path d="M13.5 33 L12.5 26 L18 31 Z" fill="#eaa98f"/>
        <path class="ear" d="M30 30 L38 19 L41 34 Z" fill="#c9813f"/><path d="M33 30 L37.5 24 L38.5 32 Z" fill="#eaa98f"/>
        <ellipse cx="27" cy="55" rx="8" ry="4.5" fill="#f0c48f"/>
        <g class="eyes-shut" stroke="#5a3519" stroke-width="1.5" fill="none" stroke-linecap="round"><path d="M15 46 q4 3 8 0"/><path d="M30 45 q4 3 8 0"/></g>
        <g class="eyes-open" fill="#3d5a2a"><ellipse cx="19" cy="46" rx="2.3" ry="2.8"/><ellipse cx="34" cy="45" rx="2.3" ry="2.8"/></g>
        <path d="M25 51 l2.2 2.2 l2.2 -2.2 z" fill="#c46a6a"/>
      </g>`,
  },
  bookend: {
    name: 'Brass bookend', w: 36, h: 132,
    svg: () => `
      <defs><linearGradient id="dBrassB" x2="1"><stop offset="0" stop-color="#7d5d22"/><stop offset=".35" stop-color="#e6c77f"/><stop offset=".6" stop-color="#b8923f"/><stop offset="1" stop-color="#6e501c"/></linearGradient></defs>
      <path d="M6 125 L6 22 Q6 6 18 6 Q30 6 30 22 L30 125 Z" fill="url(#dBrassB)"/>
      <circle cx="18" cy="38" r="8" fill="none" stroke="#6e501c" stroke-width="1.6" opacity=".8"/>
      <path d="M18 31 l2 5 5 .5 -4 3.5 1.3 5 -4.3 -2.8 -4.3 2.8 1.3 -5 -4 -3.5 5 -.5z" fill="#6e501c" opacity=".7"/>
      <rect x="10" y="22" width="1.6" height="96" fill="#fff" opacity=".25"/>
      <rect x="2" y="124" width="32" height="8" rx="1.5" fill="url(#dBrassB)"/>`,
  },
  globe: {
    name: 'Globe', w: 84, h: 124,
    svg: () => `
      <defs>
        <clipPath id="dGlobeClip"><circle cx="42" cy="52" r="31"/></clipPath>
        <radialGradient id="dShade" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".45"/></radialGradient>
        <linearGradient id="dBrassG" x2="1"><stop offset="0" stop-color="#7d5d22"/><stop offset=".45" stop-color="#e2c27a"/><stop offset="1" stop-color="#6e501c"/></linearGradient>
      </defs>
      <ellipse cx="42" cy="120" rx="24" ry="4" fill="url(#dBrassG)"/>
      <rect x="40" y="90" width="4" height="30" fill="#8a6a2c"/>
      <g transform="rotate(-23 42 52)">
        <line x1="42" y1="14" x2="42" y2="90" stroke="#8a6a2c" stroke-width="1.6"/>
        <g clip-path="url(#dGlobeClip)">
          <circle cx="42" cy="52" r="31" fill="#6e9db3"/>
          <g class="globe-land" transform="translate(11 21)">${land(0)}${land(72)}</g>
          <circle cx="42" cy="52" r="31" fill="url(#dShade)"/>
        </g>
        <path d="M42 89 A37 37 0 0 1 42 15" stroke="url(#dBrassG)" stroke-width="3" fill="none"/>
      </g>`,
  },
};
export const DECOR_KINDS = Object.keys(DECOR);

export const isDecor = id => typeof id === 'string' && id.startsWith('decor:');
export const decorKind = id => id.split(':')[1];
export const newDecorId = kind => `decor:${kind}:${Math.random().toString(36).slice(2, 7)}`;

// Every drawing gets its own gradient/clip ids: browsers resolve url(#id) to
// the first match on the page, which might be a copy in a closed menu.
let drawn = 0;
export function decorSVG(kind, scale = 1) {
  const d = DECOR[kind];
  const n = ++drawn;
  // On a shelf, some things are drawn larger than their viewBox (size); in
  // the menu, tall things are kept to the thumbnail's height.
  const onShelf = scale >= 1;
  scale = onShelf ? scale * (d.size ?? 1) : Math.min(scale, 68 / d.h);
  const drop = d.drop && onShelf ? ` style="margin-bottom:-${d.drop * scale}px"` : '';
  const body = d.svg().replace(/id="(d[A-Z]\w*)"/g, `id="$1-${n}"`).replace(/url\(#(d[A-Z]\w*)\)/g, `url(#$1-${n})`);
  return `<svg class="decor-art" viewBox="0 0 ${d.w} ${d.h}" width="${d.w * scale}" height="${d.h * scale}"${drop} aria-hidden="true">${body}</svg>`;
}
