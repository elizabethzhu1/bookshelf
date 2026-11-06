// A guided tour: dims the page, lights up one part at a time and explains it
// in a note beside it. Steps are { target, title, body, before?, html? }:
//   target  a selector (or a list, lit together), or null for a centred note
//   before  runs first (switch view, scroll), may return a promise
//   html    extra content (e.g. a field), with `mount(tip)` to wire it up
// Keys: → or Enter next, ← back, Esc to leave.

const PAD = 8;

export function runTour(steps, { onEnd } = {}) {
  let i = 0;
  let current = null;
  const shade = document.createElement('div');
  shade.className = 'tour-shade';
  const spot = document.createElement('div');
  spot.className = 'tour-spot';
  const tip = document.createElement('div');
  tip.className = 'tour-tip';
  tip.setAttribute('role', 'dialog');
  tip.setAttribute('aria-live', 'polite');
  document.body.append(shade, spot, tip);
  document.documentElement.classList.add('touring');

  const targets = step => [].concat(step.target ?? []).flatMap(s => [...document.querySelectorAll(s)]).filter(el => el.getClientRects().length);
  const rectOf = els => {
    const rs = els.map(el => el.getBoundingClientRect());
    const r = { left: Math.min(...rs.map(r => r.left)), top: Math.min(...rs.map(r => r.top)), right: Math.max(...rs.map(r => r.right)), bottom: Math.max(...rs.map(r => r.bottom)) };
    return { ...r, width: r.right - r.left, height: r.bottom - r.top };
  };

  function place() {
    const step = steps[i];
    const els = targets(step);
    const vw = innerWidth, vh = innerHeight;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    if (!els.length) {
      spot.style.cssText = `left:${vw / 2}px;top:${vh / 2}px;width:0;height:0;opacity:0`;
      shade.classList.add('solid');
      tip.style.left = `${(vw - tw) / 2}px`;
      tip.style.top = `${Math.max(20, (vh - th) / 2)}px`;
      return;
    }
    shade.classList.remove('solid');
    const r = rectOf(els);
    const left = Math.max(4, r.left - PAD), top = Math.max(4, r.top - PAD);
    const right = Math.min(vw - 4, r.right + PAD), bottom = Math.min(vh - 4, r.bottom + PAD);
    spot.style.cssText = `left:${left}px;top:${top}px;width:${right - left}px;height:${bottom - top}px;opacity:1`;
    // Beside the lit part: below if it fits, else above, else to the side.
    let x = Math.min(Math.max(12, (left + right) / 2 - tw / 2), vw - tw - 12);
    let y;
    if (bottom + 14 + th < vh) y = bottom + 14;
    else if (top - 14 - th > 0) y = top - 14 - th;
    else {
      y = Math.min(Math.max(12, (top + bottom) / 2 - th / 2), vh - th - 12);
      x = right + 14 + tw < vw ? right + 14 : Math.max(12, left - 14 - tw);
    }
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  }

  async function show(n) {
    i = n;
    const step = steps[i];
    tip.classList.add('moving');
    if (step.before) await step.before();
    const els = targets(step);
    if (els.length) {
      const r = rectOf(els);
      if (r.top < 70 || r.bottom > innerHeight - 40) {
        els[0].scrollIntoView({ block: r.height > innerHeight * .6 ? 'start' : 'center', behavior: 'instant' });
      }
    }
    const last = i === steps.length - 1;
    tip.innerHTML = `
      <p class="tour-count">${i + 1} of ${steps.length}</p>
      <h3>${step.title}</h3>
      <div class="tour-body">${step.body}</div>
      ${step.html ?? ''}
      <div class="tour-nav">
        ${last ? '' : '<button type="button" class="link-btn tour-skip">Skip the tour</button>'}
        <span class="tour-gap"></span>
        ${i ? '<button type="button" class="link-btn tour-back">Back</button>' : ''}
        ${step.actions ?? ''}
        <button type="button" class="stamp tour-next">${step.next ?? (last ? 'Done' : 'Next')}</button>
      </div>`;
    current = step;
    step.mount?.(tip);
    place();
    requestAnimationFrame(() => { tip.classList.remove('moving'); place(); });
    (tip.querySelector('[autofocus]') ?? tip.querySelector('.tour-next')).focus({ preventScroll: true });
  }

  function end(finished) {
    removeEventListener('resize', place);
    removeEventListener('scroll', place, true);
    document.removeEventListener('keydown', keys, true);
    shade.remove(); spot.remove(); tip.remove();
    document.documentElement.classList.remove('touring');
    onEnd?.(finished);
  }
  const next = async () => {
    if ((await current.leave?.(tip)) === false) return;
    if (i < steps.length - 1) show(i + 1); else end(true);
  };
  const back = () => { if (i) show(i - 1); };

  tip.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.classList.contains('tour-next')) next();
    else if (b.classList.contains('tour-back')) back();
    else if (b.classList.contains('tour-skip')) end(false);
    else if (b.dataset.tourAction) current.onAction?.(b.dataset.tourAction, () => end(true));
  });
  function keys(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); end(false); return; }
    const typing = e.target.matches?.('input, textarea');
    if (e.key === 'ArrowRight' && !typing) { e.preventDefault(); next(); }
    else if (e.key === 'ArrowLeft' && !typing) { e.preventDefault(); back(); }
    else if (e.key === 'Enter' && typing) { e.preventDefault(); next(); }
    if (!tip.contains(e.target)) { e.preventDefault(); e.stopImmediatePropagation(); } // the page waits
  }
  addEventListener('resize', place);
  addEventListener('scroll', place, true);
  document.addEventListener('keydown', keys, true);
  show(0);
  return { end: () => end(false) };
}
