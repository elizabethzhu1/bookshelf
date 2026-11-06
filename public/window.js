// A window onto San Francisco, top left of the page.
// The sky follows the real time in SF: sunrise and sunset are worked out here
// for the city (no network needed), and the colours blend smoothly through
// dawn, day, dusk and night. The weather (clouds, fog, rain, snow, storms)
// comes from /api/weather, which asks Open-Meteo for the city's conditions.

const LAT = 37.7749, LNG = -122.4194;
const TZ = 'America/Los_Angeles';
const win = document.getElementById('sfWindow');
const $ = s => win.querySelector(s);
const calm = matchMedia('(prefers-reduced-motion: reduce)');

// ---------- time in San Francisco ----------

const partsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
});
function sfNow(date = new Date()) {
  const p = Object.fromEntries(partsFmt.formatToParts(date).map(x => [x.type, x.value]));
  const y = +p.year, m = +p.month, d = +p.day;
  const minutes = +p.hour * 60 + +p.minute;
  // SF's offset from UTC right now (−480 in winter, −420 in summer), in minutes.
  const offset = Math.round((Date.UTC(y, m - 1, d, +p.hour, +p.minute) - date.getTime()) / 60000);
  return { y, m, d, minutes, offset };
}
const clock = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
// Format minutes-after-midnight on the given SF day as a clock time.
const hm = (mins, sf) => clock.format(new Date(Date.UTC(sf.y, sf.m - 1, sf.d) - sf.offset * 60000 + mins * 60000));

// Sunrise and sunset in SF local minutes (NOAA's approximation, good to a minute or two).
function sunTimes({ y, m, d, offset }) {
  const n = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 0)) / 864e5);
  const g = 2 * Math.PI / 365 * (n - 1);
  const eq = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g)
    + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const rad = Math.PI / 180, lat = LAT * rad;
  const ha = Math.acos(Math.cos(90.833 * rad) / (Math.cos(lat) * Math.cos(decl)) - Math.tan(lat) * Math.tan(decl)) / rad;
  return { rise: 720 - 4 * (LNG + ha) - eq + offset, set: 720 - 4 * (LNG - ha) - eq + offset };
}

// 0 = new moon, 0.5 = full.
const moonPhase = (date = new Date()) => ((((date - Date.UTC(2000, 0, 6, 18, 14)) / 864e5) / 29.530588) % 1 + 1) % 1;

// ---------- sky colours ----------
// Key moments relative to sunrise (r) and sunset (s); colours blend between them.

const KEYS = [
  // [minutes, sky top, horizon, hills, stars, city lights]
  [r => r - 90, '#0b1430', '#1d2a4c', '#0a0f1c', 1, 1],
  [r => r - 35, '#232d5a', '#8f6584', '#151729', .5, .9],
  [r => r, '#4b5f96', '#f2a479', '#2d2b40', 0, .5],
  [r => r + 45, '#6aa5e0', '#f4d8b4', '#4d5a6c', 0, 0],
  [r => r + 130, '#5c9de0', '#c2e0f4', '#5f6f80', 0, 0],
  [(r, s) => s - 130, '#5c9de0', '#c2e0f4', '#5f6f80', 0, 0],
  [(r, s) => s - 40, '#6b98d0', '#f6c785', '#4a5262', 0, 0],
  [(r, s) => s, '#3a4580', '#ec8656', '#2a2738', 0, .5],
  [(r, s) => s + 30, '#222a58', '#87577a', '#141626', .5, .9],
  [(r, s) => s + 85, '#0b1430', '#1d2a4c', '#0a0f1c', 1, 1],
];
const hex = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
const mix = (a, b, t) => `rgb(${hex(a).map((v, i) => Math.round(v + (hex(b)[i] - v) * t)).join(',')})`;

function skyAt(mins, { rise, set }) {
  const keys = KEYS.map(([f, ...rest]) => [f(rise, set), ...rest]);
  if (mins <= keys[0][0] || mins >= keys.at(-1)[0]) { const k = keys[0]; return { top: k[1], low: k[2], hill: k[3], stars: k[4], lights: k[5] }; }
  const i = keys.findIndex(k => k[0] > mins);
  const [a, b] = [keys[i - 1], keys[i]];
  const t = (mins - a[0]) / (b[0] - a[0]);
  return { top: mix(a[1], b[1], t), low: mix(a[2], b[2], t), hill: mix(a[3], b[3], t),
    stars: a[4] + (b[4] - a[4]) * t, lights: a[5] + (b[5] - a[5]) * t };
}

function phaseAt(mins, { rise, set }) {
  if (mins >= rise - 50 && mins < rise + 40) return 'dawn';
  if (mins >= rise + 40 && mins < set - 40) return 'day';
  if (mins >= set - 40 && mins < set + 50) return 'dusk';
  return 'night';
}

// ---------- weather ----------

const WEATHER = code =>
  code === 0 ? ['clear', 'Clear'] :
  code === 1 ? ['clear', 'Mostly clear'] :
  code === 2 ? ['partly', 'Partly cloudy'] :
  code === 3 ? ['overcast', 'Overcast'] :
  code === 45 || code === 48 ? ['fog', 'Fog'] :
  code >= 51 && code <= 57 ? ['drizzle', 'Drizzle'] :
  (code >= 61 && code <= 67) || (code >= 80 && code <= 82) ? [code === 65 || code === 82 ? 'downpour' : 'rain', code >= 80 ? 'Showers' : 'Rain'] :
  (code >= 71 && code <= 77) || code === 85 || code === 86 ? ['snow', 'Snow'] :
  code >= 95 ? ['storm', 'Thunderstorm'] : ['partly', 'Cloudy'];

let weather = null; // { temp, code, cloud, wind } or null when unknown

// The public copy has no server to ask, so it asks Open-Meteo directly.
const STATIC = 'static' in document.documentElement.dataset;
async function fetchWeather() {
  if (!STATIC) {
    const r = await fetch('/api/weather');
    if (!r.ok) throw new Error();
    return r.json();
  }
  const params = new URLSearchParams({
    latitude: LAT, longitude: LNG, current: 'temperature_2m,weather_code,cloud_cover,wind_speed_10m',
    temperature_unit: 'fahrenheit', wind_speed_unit: 'mph', timezone: TZ,
  });
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!r.ok) throw new Error();
  const { current: c } = await r.json();
  return { temp: c.temperature_2m, code: c.weather_code, cloud: c.cloud_cover, wind: c.wind_speed_10m, time: c.time };
}

async function loadWeather() {
  try {
    weather = await fetchWeather();
  } catch {
    weather = null; // just the sky, then
  }
  paintWeather();
  paint();
}

// Rain, snow and fog are made of little elements; rebuild them only when the kind changes.
let builtKind = null;
function paintWeather() {
  const [kind] = weather ? WEATHER(weather.code) : ['none'];
  const cover = weather ? weather.cloud : 0;
  win.dataset.weather = kind;
  const clouds = kind === 'clear' ? Math.round(cover / 40) : kind === 'partly' ? 2 : ['none'].includes(kind) ? 0 : 4;
  win.style.setProperty('--overcast', ['overcast', 'drizzle', 'rain', 'downpour', 'storm', 'snow'].includes(kind) ? .55 : kind === 'fog' ? .35 : cover / 300);
  win.style.setProperty('--slant', `${Math.min(weather?.wind ?? 0, 30) * .8}deg`);
  $('.clouds').innerHTML = Array.from({ length: clouds }, (_, i) =>
    `<span class="cloud" style="--top:${8 + (i * 23) % 50}%;--w:${34 + (i * 17) % 22}px;--dur:${70 + i * 23}s;--delay:-${i * 31}s"></span>`).join('');
  if (kind === builtKind) return;
  builtKind = kind;
  const n = { drizzle: 14, rain: 28, downpour: 46, storm: 40, snow: 26 }[kind] ?? 0;
  const flake = kind === 'snow';
  $('.precip').innerHTML = Array.from({ length: n }, (_, i) => {
    const left = (i * 37) % 100, delay = ((i * 53) % 100) / 100;
    return `<i style="left:${left}%;animation-delay:-${(delay * (flake ? 6 : .9)).toFixed(2)}s${flake ? `;--sway:${(i % 5) - 2}px;--size:${2 + (i % 3)}px` : ''}"></i>`;
  }).join('');
}

// ---------- painting ----------

let fixedTime = null; // set by sfWindow.at() to preview another time
function paint() {
  const now = fixedTime ?? new Date();
  const sf = sfNow(now);
  const sun = sunTimes(sf);
  const mins = sf.minutes;
  const sky = skyAt(mins, sun);
  const phase = phaseAt(mins, sun);
  win.dataset.phase = phase;
  win.style.setProperty('--sky-top', sky.top);
  win.style.setProperty('--sky-low', sky.low);
  win.style.setProperty('--hill', sky.hill);
  win.style.setProperty('--stars', sky.stars.toFixed(2));
  win.style.setProperty('--lights', sky.lights.toFixed(2));

  // The sun crosses the window on an arc from sunrise to sunset; the moon
  // takes the night shift on the same arc.
  const arc = t => ({ x: 8 + t * 84, y: 70 - Math.sin(t * Math.PI) * 58 });
  const day = (mins - sun.rise) / (sun.set - sun.rise);
  const nightLen = 1440 - (sun.set - sun.rise);
  const night = ((mins - sun.set + 1440) % 1440) / nightLen;
  const s = arc(Math.min(Math.max(day, -.05), 1.05));
  const m = arc(Math.min(Math.max(night, 0), 1));
  win.style.setProperty('--sun-x', `${s.x}%`);
  win.style.setProperty('--sun-y', `${s.y}%`);
  win.style.setProperty('--sun-up', day > -.015 && day < 1.015 ? 1 : 0); // sets within ~10 min of sunset
  win.style.setProperty('--moon-x', `${m.x}%`);
  win.style.setProperty('--moon-y', `${m.y}%`);
  win.style.setProperty('--moon-up', night > 0 && night < 1 ? 1 : 0);
  // Low sun burns orange.
  win.style.setProperty('--sun-color', Math.sin(Math.min(Math.max(day, 0), 1) * Math.PI) < .35 ? '#ffb05e' : '#fff3c4');
  // Moon phase: a shadow disc slides across (waxing lit on the right, as seen from the northern hemisphere).
  const ph = moonPhase(now);
  win.style.setProperty('--moon-shadow', `${(ph < .5 ? -ph * 2 : 2 - ph * 2) * 100}%`);

  const [, label] = weather ? WEATHER(weather.code) : [null, null];
  const temp = weather ? `${Math.round(weather.temp)}°` : '';
  $('.sf-plate').innerHTML = `<span>San Francisco</span>${clock.format(now)}${temp ? ` · ${temp}` : ''}`;
  const desc = `San Francisco, ${clock.format(now)}: ${phase}${label ? `, ${label.toLowerCase()}, ${Math.round(weather.temp)}°F` : ''}. `
    + `Sunrise ${hm(sun.rise, sf)}, sunset ${hm(sun.set, sf)}.`;
  win.title = desc;
  win.setAttribute('aria-label', desc);
}

// Lightning, now and then, in a storm.
function flash() {
  if (win.dataset.weather === 'storm' && !calm.matches) {
    win.classList.remove('flash');
    void win.offsetWidth;
    win.classList.add('flash');
  }
  setTimeout(flash, 5000 + Math.random() * 9000);
}

paint();
loadWeather();
setInterval(paint, 30_000);
setInterval(loadWeather, 10 * 60_000);
flash();

// For trying out conditions from the console:
//   sfWindow.preview({ code: 61, temp: 54, cloud: 90 })   weather (WMO code)
//   sfWindow.at('2026-11-05T17:05:00-08:00')              another time
//   sfWindow.live()                                         back to now
window.sfWindow = {
  preview(w) { weather = { temp: 60, cloud: 50, wind: 8, ...w }; paintWeather(); paint(); },
  at(date) { fixedTime = date ? new Date(date) : null; paint(); },
  live() { fixedTime = null; loadWeather(); },
};
