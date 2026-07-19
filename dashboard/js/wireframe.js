// RageClickRadar dashboard — abstract wireframe renderer.
//
// Used as the heatmap view's fallback when a page cannot be embedded in an
// iframe (cross-origin refusal, 404, or a load timeout). Renders an honest,
// low-fidelity stand-in: a proportional page rectangle with each frustration
// point plotted as a colored dot, plus the page's top confusion hotspots
// listed down the right margin (the heatmap API returns no per-point selector,
// so labels live in the ranked list rather than on the canvas).

const SIGNALS = [
  { key: 'rage', label: 'Rage', title: 'Rage clicks' },
  { key: 'dead', label: 'Dead', title: 'Dead clicks' },
  { key: 'formaband', label: 'Abandon', title: 'Form abandonment' },
  { key: 'correction', label: 'Correction', title: 'Input corrections' },
];
const SIG_VAR = {
  rage: '--sig-rage',
  dead: '--sig-dead',
  formaband: '--sig-formaband',
  correction: '--sig-correction',
};

// h('div', { class: 'x' }, child, 'text') -> HTMLElement.
function h(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2), value);
    } else {
      node.setAttribute(key, value === true ? '' : String(value));
    }
  }
  for (const child of children) {
    if (child === undefined || child === null || child === false) continue;
    node.append(child instanceof Node ? child : String(child));
  }
  return node;
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
}

const STYLE_ID = 'wf-view-style';
const STYLE = `
.wf-view { margin-top: 0.4rem; }
.wf-stage {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  align-items: flex-start;
}
.wf-canvas-card {
  flex: 1 1 320px;
  min-width: 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 1rem;
  display: flex;
  justify-content: center;
}
.wf-canvas-card canvas {
  width: auto;
  max-width: 100%;
  height: auto;
  max-height: 62vh;
  border-radius: 8px;
}
.wf-side { flex: 1 1 260px; min-width: 240px; }
.wf-side h3 {
  margin: 0 0 0.5rem;
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
}
.wf-hotspots { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.45rem; }
.wf-hotspot {
  display: flex;
  align-items: flex-start;
  gap: 0.55rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.5rem 0.6rem;
}
.wf-rank {
  flex: none;
  width: 22px; height: 22px;
  display: inline-flex; align-items: center; justify-content: center;
  font-family: var(--font-mono);
  font-size: 0.72rem; font-weight: 700;
  color: var(--text-muted);
  background: var(--surface-2);
  border-radius: 50%;
}
.wf-hs-main { min-width: 0; display: flex; flex-direction: column; gap: 0.3rem; }
.wf-hs-sel { font-family: var(--font-mono); font-size: 0.8rem; word-break: break-all; }
.wf-chips { display: inline-flex; flex-wrap: wrap; gap: 0.3rem; }
.wf-chip {
  --sig: var(--text-muted);
  display: inline-flex; align-items: center; gap: 0.28rem;
  font-size: 0.7rem; font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--sig);
  background: color-mix(in srgb, var(--sig) 11%, transparent);
  border: 1px solid color-mix(in srgb, var(--sig) 28%, transparent);
  border-radius: 999px;
  padding: 0.05rem 0.5rem;
  white-space: nowrap;
}
.wf-chip-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--sig); }
.wf-empty {
  color: var(--text-muted);
  font-size: 0.9rem;
  background: var(--surface);
  border: 1px dashed var(--border);
  border-radius: var(--radius);
  padding: 1.2rem 1rem;
  text-align: center;
}
`;

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = STYLE;
  document.head.appendChild(el);
}

// Rounded-rect path helper (roundRect is widely supported but guard anyway).
function roundRect(ctx, x, y, w, hgt, r) {
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(x, y, w, hgt, r);
    return;
  }
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + hgt, r);
  ctx.arcTo(x + w, y + hgt, x, y + hgt, r);
  ctx.arcTo(x, y + hgt, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function chipsFor(counts) {
  const wrap = h('span', { class: 'wf-chips' });
  for (const sig of SIGNALS) {
    const n = (counts && counts[sig.key]) || 0;
    if (!n) continue;
    wrap.appendChild(
      h(
        'span',
        { class: 'wf-chip', style: `--sig: var(${SIG_VAR[sig.key]})`, title: `${sig.title}: ${n}` },
        h('span', { class: 'wf-chip-dot', 'aria-hidden': 'true' }),
        `${sig.label} ${n}`,
      ),
    );
  }
  return wrap;
}

/**
 * Render an abstract page layout with plotted frustration points.
 * @param {HTMLElement} el mount point (its children are replaced)
 * @param {{points?: Array, hotspots?: Array, docW?: number, docH?: number}} data
 */
export function renderWireframe(el, data) {
  ensureStyle();
  const points = Array.isArray(data && data.points) ? data.points : [];
  const hotspots = Array.isArray(data && data.hotspots) ? data.hotspots : [];
  const docW = (data && data.docW) || 1280;
  const docH = (data && data.docH) || Math.round(docW * 1.25);

  const view = h('div', { class: 'wf-view' });

  if (!points.length && !hotspots.length) {
    view.appendChild(
      h(
        'div',
        { class: 'wf-empty' },
        'No frustration signals recorded for this page yet.',
      ),
    );
    el.replaceChildren(view);
    return;
  }

  // --- Canvas (proportional page rectangle + dots) ---
  const canvas = h('canvas', { width: String(docW), height: String(docH) });
  // Cap CSS width so tall pages stay reasonable; aspect preserved by height:auto.
  canvas.style.maxWidth = Math.min(docW, 560) + 'px';
  const ctx = canvas.getContext('2d');

  // Page surface.
  ctx.clearRect(0, 0, docW, docH);
  ctx.fillStyle = cssVar('--surface-2');
  ctx.strokeStyle = cssVar('--border');
  ctx.lineWidth = Math.max(2, docW / 640);
  roundRect(ctx, ctx.lineWidth, ctx.lineWidth, docW - 2 * ctx.lineWidth, docH - 2 * ctx.lineWidth, 18);
  ctx.fill();
  ctx.stroke();

  // Dots, colored per signal type.
  for (const p of points) {
    if (typeof p.x !== 'number' || typeof p.y !== 'number') continue;
    const pw = p.docW || docW;
    const ph = p.docH || docH;
    const px = (p.x / pw) * docW;
    const py = (p.y / ph) * docH;
    const r = 4 + Math.min(p.n || 1, 6) * 1.6;
    ctx.beginPath();
    ctx.globalAlpha = 0.82;
    ctx.fillStyle = cssVar(SIG_VAR[p.type] || '--text-muted');
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // --- Right margin: ranked hotspot list ---
  const side = h('div', { class: 'wf-side' });
  side.appendChild(h('h3', {}, 'Confusion hotspots'));
  if (!hotspots.length) {
    side.appendChild(h('p', { class: 'wf-empty' }, 'No element-level hotspots on this page.'));
  } else {
    const list = h('ol', { class: 'wf-hotspots' });
    for (const [i, hs] of hotspots.slice(0, 8).entries()) {
      list.appendChild(
        h(
          'li',
          { class: 'wf-hotspot' },
          h('span', { class: 'wf-rank', 'aria-hidden': 'true' }, String(i + 1)),
          h(
            'div',
            { class: 'wf-hs-main' },
            h('code', { class: 'wf-hs-sel' }, hs.selector),
            chipsFor(hs.counts),
          ),
        ),
      );
    }
    side.appendChild(list);
  }

  view.appendChild(
    h(
      'div',
      { class: 'wf-stage' },
      h('div', { class: 'wf-canvas-card' }, canvas),
      side,
    ),
  );
  el.replaceChildren(view);
}

export default renderWireframe;
