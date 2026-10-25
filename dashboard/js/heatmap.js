// RageClickRadar dashboard — heatmap view (route #/heatmap?page=X).
//
// Renders a live, static preview of the page inside a sandboxed iframe with a
// document-aligned canvas heat overlay. Because click points are captured in
// document space (x/y at a known docW×docH), the iframe is rendered at exactly
// the capture width so element geometry matches, then every point is scaled by
// (renderedWidth / point.docW, renderedHeight / point.docH) so points from
// different capture sizes land proportionally. The iframe is sandboxed WITHOUT
// allow-scripts, so the demo's own tracker never runs and no synthetic events
// pollute the database while viewing.
//
// If the page cannot be embedded (HTTP error, cross-origin frame refusal, or a
// load timeout) the view falls back to the abstract wireframe renderer.

import { getHeatmap, getHotspots } from './api.js';
import { renderWireframe } from './wireframe.js';

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
// These signals never carry click coordinates, so they have no heat to draw.
const COORDLESS = new Set(['formaband', 'correction']);

const BANDS = {
  all: { label: 'All widths' },
  mobile: { label: 'Mobile ≤ 600', vwMax: 600 },
  desktop: { label: 'Desktop > 600', vwMin: 601 },
};

const IFRAME_TIMEOUT_MS = 3000;
const REDACTED_PREVIEW_NOTICE =
  'Live preview is unavailable: this path was redacted, so its identifiers are stored as :id. Showing the abstract layout.';

// Cap the offscreen heat buffer's area so the per-pixel colorize loop stays
// cheap even when a captured document is tens of thousands of px tall.
const MAX_HEAT_AREA = 4_000_000;

// --- Small helpers ---------------------------------------------------------

// Only a same-origin relative path is safe to use as the live-preview iframe
// src. The page comes straight from the URL hash, so a crafted route like
// #/heatmap?page=javascript:... must not become the frame's src. Require a
// leading '/', reject protocol-relative '//host', and reject any scheme.
function isEmbeddablePath(page) {
  const s = String(page || '');
  if (!s.startsWith('/')) return false;
  if (s.startsWith('//')) return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s)) return false;
  return true;
}

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
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// Parse #rgb / #rrggbb into {r,g,b}. Falls back to mid-grey.
function hexToRgb(hex) {
  const s = String(hex || '').trim().replace('#', '');
  if (s.length === 3) {
    return {
      r: parseInt(s[0] + s[0], 16),
      g: parseInt(s[1] + s[1], 16),
      b: parseInt(s[2] + s[2], 16),
    };
  }
  if (s.length >= 6) {
    return {
      r: parseInt(s.slice(0, 2), 16),
      g: parseInt(s.slice(2, 4), 16),
      b: parseInt(s.slice(4, 6), 16),
    };
  }
  return { r: 136, g: 136, b: 136 };
}

// Redacted paths store identifiers as ':id' (see server/collect.js), so a path
// like /users/:id names no real route and cannot be loaded into the preview frame.
export function isRedactedPath(page) {
  return String(page || '').split('/').includes(':id');
}

// Most common docW among points (and the tallest docH seen at that width).
// Used both as the iframe render width and the wireframe aspect ratio.
function dominantDims(points) {
  if (!points.length) return { docW: 1280, docH: 1600 };
  const byW = new Map();
  for (const p of points) {
    const w = p.docW || 1280;
    const e = byW.get(w) || { count: 0, docH: 0 };
    e.count += 1;
    if ((p.docH || 0) > e.docH) e.docH = p.docH || 0;
    byW.set(w, e);
  }
  let bestW = 1280;
  let best = { count: -1, docH: 1600 };
  for (const [w, e] of byW) {
    if (e.count > best.count) {
      best = e;
      bestW = w;
    }
  }
  return { docW: bestW, docH: best.docH || Math.round(bestW * 1.25) };
}

// --- Scoped styles ---------------------------------------------------------

const STYLE_ID = 'hm-view-style';
const STYLE = `
.hm-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 0.8rem 1.2rem;
  align-items: center;
  margin: 0.4rem 0 1rem;
}
.hm-chips { display: inline-flex; flex-wrap: wrap; gap: 0.35rem; }
.hm-chip {
  --sig: var(--text-muted);
  display: inline-flex; align-items: center; gap: 0.35rem;
  font: inherit;
  font-size: 0.78rem; font-weight: 600;
  color: var(--sig);
  background: color-mix(in srgb, var(--sig) 8%, var(--surface));
  border: 1px solid color-mix(in srgb, var(--sig) 30%, var(--border));
  border-radius: 999px;
  padding: 0.28rem 0.7rem;
  cursor: pointer;
}
.hm-chip:hover { background: color-mix(in srgb, var(--sig) 16%, var(--surface)); }
.hm-chip[aria-pressed="true"] {
  color: #fff;
  background: var(--sig);
  border-color: var(--sig);
}
@media (prefers-color-scheme: dark) {
  .hm-chip[aria-pressed="true"] { color: #10151a; }
}
.hm-chip-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--sig); }
.hm-chip[aria-pressed="true"] .hm-chip-dot { background: currentColor; }
.hm-band { display: inline-flex; align-items: center; gap: 0.45rem; font-size: 0.82rem; color: var(--text-muted); }
.hm-band select {
  font: inherit; font-size: 0.82rem;
  color: var(--text);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.28rem 0.5rem;
}
.hm-scroll {
  position: relative;
  overflow: auto;
  max-height: 72vh;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}
.hm-scaled { position: relative; margin: 0 auto; }
.hm-stage { position: relative; transform-origin: top left; }
.hm-stage iframe {
  position: absolute; top: 0; left: 0;
  border: 0;
  background: #fff;
  pointer-events: none;
}
.hm-stage canvas {
  position: absolute; top: 0; left: 0;
  pointer-events: none;
}
.hm-note {
  position: absolute; top: 0.7rem; left: 0.7rem;
  z-index: 2;
  max-width: min(90%, 30rem);
  font-size: 0.82rem;
  color: var(--text);
  background: color-mix(in srgb, var(--surface) 88%, transparent);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.5rem 0.7rem;
  box-shadow: var(--shadow);
}
.hm-legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem 1rem;
  margin-top: 0.9rem;
  font-size: 0.8rem;
  color: var(--text-muted);
}
.hm-legend-item { display: inline-flex; align-items: center; gap: 0.35rem; }
.hm-legend-dot { width: 10px; height: 10px; border-radius: 50%; }
.hm-legend-count { font-variant-numeric: tabular-nums; }
.hm-fallback-notice {
  font-size: 0.85rem;
  color: var(--text-muted);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.6rem 0.8rem;
  margin-bottom: 0.9rem;
}
`;

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = STYLE;
  document.head.appendChild(el);
}

// --- Heat rendering --------------------------------------------------------

// Build a 256-entry RGBA lookup table from an intensity ramp. A single active
// signal type ramps transparent -> that color; "All" uses a classic blue ->
// red heat ramp so overlapping types blend into one readable field.
function buildLut(activeType) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 1;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 256, 0);
  if (activeType) {
    const { r, g: gg, b } = hexToRgb(cssVar(SIG_VAR[activeType]) || '#888');
    grad.addColorStop(0.0, `rgba(${r},${gg},${b},0)`);
    grad.addColorStop(0.25, `rgba(${r},${gg},${b},0.55)`);
    grad.addColorStop(0.6, `rgba(${r},${gg},${b},0.82)`);
    grad.addColorStop(1.0, `rgba(${r},${gg},${b},0.98)`);
  } else {
    grad.addColorStop(0.0, 'rgba(0,60,200,0)');
    grad.addColorStop(0.18, 'rgba(0,95,225,0.6)');
    grad.addColorStop(0.42, 'rgba(0,200,235,0.72)');
    grad.addColorStop(0.62, 'rgba(70,215,80,0.8)');
    grad.addColorStop(0.82, 'rgba(240,215,20,0.9)');
    grad.addColorStop(1.0, 'rgba(220,45,45,0.98)');
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 1);
  return g.getImageData(0, 0, 256, 1).data;
}

// Draw the heat field into `canvas` (sized w×hgt device px). Points are scaled
// per-point from their own capture size into the rendered document space.
function drawHeat(canvas, w, hgt, points, activeType) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, hgt);
  if (!points.length) return;

  // Render the heat field into a downscaled buffer: a full-document canvas can
  // be tens of thousands of px tall, and both the radial fills and the
  // per-pixel colorize loop run on the main thread. Cap the buffer area, then
  // scale up when compositing — heat is soft, so the upscale is visually
  // indistinguishable. When the canvas is already under budget, scale is 1.
  const scale = Math.min(1, Math.sqrt(MAX_HEAT_AREA / (w * hgt)));
  const ow = Math.max(1, Math.round(w * scale));
  const oh = Math.max(1, Math.round(hgt * scale));

  // Accumulate intensity into the alpha channel of an offscreen buffer.
  const off = document.createElement('canvas');
  off.width = ow;
  off.height = oh;
  const octx = off.getContext('2d');
  octx.globalCompositeOperation = 'lighter';
  for (const p of points) {
    if (typeof p.x !== 'number' || typeof p.y !== 'number') continue;
    const sx = ow / (p.docW || w);
    const sy = oh / (p.docH || hgt);
    const px = p.x * sx;
    const py = p.y * sy;
    const n = Math.min(p.n || 1, 8);
    const radius = (18 + 4 * n) * scale;
    const centerA = Math.min(0.7, 0.22 + 0.05 * n);
    const grad = octx.createRadialGradient(px, py, 0, px, py, radius);
    grad.addColorStop(0, `rgba(0,0,0,${centerA})`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    octx.fillStyle = grad;
    octx.beginPath();
    octx.arc(px, py, radius, 0, Math.PI * 2);
    octx.fill();
  }

  // Colorize: map accumulated intensity (alpha) through the LUT. The per-pixel
  // alpha is capped so dense clusters saturate to color instead of whiting out.
  const img = octx.getImageData(0, 0, ow, oh);
  const d = img.data;
  const lut = buildLut(activeType);
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a === 0) continue;
    const o = a * 4;
    d[i] = lut[o];
    d[i + 1] = lut[o + 1];
    d[i + 2] = lut[o + 2];
    d[i + 3] = Math.round(lut[o + 3] * 0.82);
  }
  octx.putImageData(img, 0, 0);

  // Composite the low-res heat layer up to full canvas size with smoothing.
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(off, 0, 0, ow, oh, 0, 0, w, hgt);
}

// --- View mount ------------------------------------------------------------

export default async function mount(el, params) {
  ensureStyle();
  const page = params && params.page;

  if (!page) {
    el.replaceChildren(
      h(
        'div',
        { class: 'notice-card' },
        h('h2', {}, 'No page selected'),
        h('p', {}, h('a', { href: '#/pages' }, 'Back to all pages')),
      ),
    );
    return;
  }

  const enc = encodeURIComponent(page);

  // View state.
  let activeType = null; // null = All
  let band = 'all';
  let hotspots = [];
  let totals = null; // page-wide per-type counts from the server (uncapped)
  let token = 0; // guards against out-of-order async renders

  // --- Header + controls (built once) ---
  const chipsWrap = h('div', { class: 'hm-chips', role: 'group', 'aria-label': 'Signal type filter' });

  function makeChip(key, label, sigVar) {
    const chip = h(
      'button',
      {
        type: 'button',
        class: 'hm-chip',
        style: sigVar ? `--sig: var(${sigVar})` : '--sig: var(--accent)',
        'aria-pressed': (activeType === key || (key === null && activeType === null)) ? 'true' : 'false',
      },
      h('span', { class: 'hm-chip-dot', 'aria-hidden': 'true' }),
      label,
    );
    chip.addEventListener('click', () => {
      activeType = key;
      for (const c of chipsWrap.querySelectorAll('.hm-chip')) {
        c.setAttribute('aria-pressed', c === chip ? 'true' : 'false');
      }
      refresh();
    });
    return chip;
  }

  chipsWrap.appendChild(makeChip(null, 'All', null));
  for (const sig of SIGNALS) chipsWrap.appendChild(makeChip(sig.key, sig.label, SIG_VAR[sig.key]));

  const bandSelect = h('select', { 'aria-label': 'Viewport width band' });
  for (const [key, def] of Object.entries(BANDS)) {
    bandSelect.appendChild(h('option', { value: key }, def.label));
  }
  bandSelect.value = band;
  bandSelect.addEventListener('change', () => {
    band = bandSelect.value;
    refresh();
  });

  const main = h('div', { class: 'hm-main' });
  const legend = h('div', { class: 'hm-legend' });

  el.replaceChildren(
    h(
      'div',
      { class: 'hm-view' },
      h(
        'div',
        { class: 'view-header' },
        h('a', { class: 'back-link', href: `#/page?page=${enc}` }, '← Page detail'),
        h('h1', { class: 'page-title' }, h('code', {}, page)),
        h('p', { class: 'view-sub' }, 'Click heatmap — where users clicked when frustrated.'),
      ),
      h(
        'div',
        { class: 'hm-controls' },
        chipsWrap,
        h('label', { class: 'hm-band' }, 'Viewport', bandSelect),
      ),
      main,
      legend,
    ),
  );

  // Hotspots don't change with the filter — fetch once for counts + fallback.
  try {
    const hs = await getHotspots(page);
    hotspots = hs && Array.isArray(hs.hotspots) ? hs.hotspots : [];
    totals = hs && hs.totals ? hs.totals : null;
  } catch {
    hotspots = [];
    totals = null;
  }

  // --- Legend ---
  function renderLegend(points) {
    const perType = { rage: 0, dead: 0, formaband: 0, correction: 0 };
    for (const p of points) if (perType[p.type] !== undefined) perType[p.type] += 1;
    legend.replaceChildren(
      h('span', { class: 'hm-legend-count' }, `${points.length} plotted point${points.length === 1 ? '' : 's'}`),
      ...SIGNALS.map((sig) =>
        h(
          'span',
          { class: 'hm-legend-item', title: sig.title },
          h('span', { class: 'hm-legend-dot', style: `background: var(${SIG_VAR[sig.key]})`, 'aria-hidden': 'true' }),
          `${sig.label}`,
          COORDLESS.has(sig.key) ? ' (no coords)' : ` ${perType[sig.key]}`,
        ),
      ),
    );
  }

  // Page-wide count of a signal type. Summing the hotspot list would undercount,
  // since the list is capped and leaves out NULL and empty selectors.
  function pageTotal(type) {
    return (totals && totals[type]) || 0;
  }

  function bandParams() {
    const def = BANDS[band] || {};
    const out = { page };
    if (activeType) out.type = activeType;
    if (def.vwMin !== undefined) out.vwMin = def.vwMin;
    if (def.vwMax !== undefined) out.vwMax = def.vwMax;
    return out;
  }

  // --- Fallback to the wireframe renderer ---
  function fallback(points, notice) {
    const dims = dominantDims(points);
    const wrap = h('div', {});
    if (notice) wrap.appendChild(h('div', { class: 'hm-fallback-notice' }, notice));
    const host = h('div', {});
    wrap.appendChild(host);
    main.replaceChildren(wrap);
    renderWireframe(host, { points, hotspots, docW: dims.docW, docH: dims.docH });
  }

  // --- Empty states ---
  function emptyState() {
    return h(
      'div',
      { class: 'empty-card' },
      h('span', { class: 'empty-glyph', 'aria-hidden': 'true' }),
      h('h2', {}, 'No click signals for this filter'),
      h(
        'p',
        {},
        'Nothing has landed here yet. Try a different signal type or viewport band, interact with the page to generate signals, or seed synthetic sessions with npm run seed.',
      ),
    );
  }

  function coordlessNote() {
    const sig = SIGNALS.find((s) => s.key === activeType);
    const n = pageTotal(activeType);
    const label = sig ? sig.title.toLowerCase() : activeType;
    const note = h(
      'div',
      { class: 'hm-fallback-notice' },
      n > 0
        ? `${n} ${label} signal${n === 1 ? '' : 's'} on this page carry no click coordinates, so there is nothing to plot on the heatmap. See the confusion hotspots on the `
        : `${sig ? sig.label : activeType} signals never carry click coordinates and cannot be plotted. See the `,
      h('a', { href: `#/page?page=${enc}` }, 'page detail'),
      ' for element-level detail.',
    );
    main.replaceChildren(note);
  }

  // --- Live iframe + canvas overlay ---
  function buildStage(points, dims) {
    const renderWidth = dims.docW;

    const scroll = h('div', { class: 'hm-scroll' });
    const scaledBox = h('div', { class: 'hm-scaled' });
    const stage = h('div', { class: 'hm-stage', style: `width:${renderWidth}px;height:${dims.docH}px` });
    const iframe = h('iframe', {
      src: page,
      sandbox: 'allow-same-origin',
      scrolling: 'no',
      title: `Preview of ${page}`,
      style: `width:${renderWidth}px;height:${dims.docH}px`,
    });
    const canvas = h('canvas', { width: String(renderWidth), height: String(dims.docH) });
    canvas.style.width = renderWidth + 'px';
    canvas.style.height = dims.docH + 'px';

    stage.append(iframe, canvas);
    scaledBox.appendChild(stage);
    scroll.appendChild(scaledBox);

    if (!points.length) {
      scroll.appendChild(h('div', { class: 'hm-note' }, 'No click signals for this filter yet.'));
    }
    main.replaceChildren(scroll);

    // Fit the (possibly wide) stage into the scroll container by scaling it
    // down uniformly; the scaled wrapper carries the visual box so scrollbars
    // track the scaled size.
    let renderedHeight = dims.docH;
    function applyLayout() {
      const avail = Math.max(120, scroll.clientWidth - 2);
      const scale = Math.min(1, avail / renderWidth);
      stage.style.transform = `scale(${scale})`;
      scaledBox.style.width = renderWidth * scale + 'px';
      scaledBox.style.height = renderedHeight * scale + 'px';
    }
    applyLayout();

    // Track container resizes; self-disconnect once detached from the document.
    const ro = new ResizeObserver(() => {
      if (!scroll.isConnected) {
        ro.disconnect();
        return;
      }
      applyLayout();
    });
    ro.observe(scroll);

    return { iframe, canvas, stage, scaledBox, setHeight, applyLayout };

    function setHeight(px) {
      renderedHeight = px;
      stage.style.height = px + 'px';
      iframe.style.height = px + 'px';
      canvas.width = renderWidth;
      canvas.height = px;
      canvas.style.height = px + 'px';
    }
  }

  // Render the stage and resolve to true on success, false if it fell back.
  function renderStage(points, dims, myToken) {
    return new Promise((resolve) => {
      const parts = buildStage(points, dims);
      const { iframe, canvas } = parts;
      const renderWidth = dims.docW;
      let settled = false;

      const timer = setTimeout(() => finish(false), IFRAME_TIMEOUT_MS);

      function finish(ok) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (token !== myToken) {
          resolve(false);
          return;
        }
        if (!ok) {
          fallback(points, "This page can't be embedded — showing an abstract layout.");
        }
        resolve(ok);
      }

      // Probe the page: an HTTP error or non-HTML body means no live preview.
      fetch(page, { headers: { accept: 'text/html' } })
        .then((res) => {
          const ct = res.headers.get('content-type') || '';
          if (!res.ok || !/text\/html/i.test(ct)) finish(false);
        })
        .catch(() => {
          /* network/CORS: defer to iframe load/error/timeout */
        });

      iframe.addEventListener('error', () => finish(false));
      iframe.addEventListener('load', () => {
        if (settled) return;
        let doc;
        try {
          doc = iframe.contentDocument;
        } catch {
          doc = null;
        }
        if (!doc || !doc.body) {
          finish(false);
          return;
        }
        // Measure the rendered document height and size the overlay to match.
        const rendered = Math.max(
          dims.docH,
          doc.documentElement ? doc.documentElement.scrollHeight : 0,
          doc.body.scrollHeight || 0,
        );
        parts.setHeight(rendered);
        parts.applyLayout();
        drawHeat(canvas, renderWidth, rendered, points, activeType);
        finish(true);
      });
    });
  }

  // --- Fetch + render for the current filter state ---
  async function refresh() {
    const myToken = ++token;
    main.replaceChildren(h('p', { class: 'view-loading', role: 'status' }, 'Loading heatmap…'));

    let points;
    try {
      const res = await getHeatmap(bandParams());
      points = res && Array.isArray(res.points) ? res.points : [];
    } catch (err) {
      if (token !== myToken) return;
      main.replaceChildren(
        h(
          'div',
          { class: 'notice-card notice-card--error' },
          h('h2', {}, 'Could not load heatmap'),
          h('p', {}, err && err.message ? err.message : 'Unexpected error.'),
        ),
      );
      return;
    }
    if (token !== myToken) return;

    renderLegend(points);

    if (!points.length) {
      // A coordinate-less type filter has data, just nothing to plot — say so.
      if (activeType && COORDLESS.has(activeType) && pageTotal(activeType) > 0) {
        coordlessNote();
      } else {
        main.replaceChildren(emptyState());
      }
      return;
    }

    const dims = dominantDims(points);
    if (isRedactedPath(page)) {
      fallback(points, REDACTED_PREVIEW_NOTICE);
      return;
    }
    // Only embed same-origin relative paths; anything else (scheme, host)
    // renders through the wireframe fallback instead of an iframe src.
    if (!isEmbeddablePath(page)) {
      fallback(points, "This page can't be embedded — showing an abstract layout.");
      return;
    }
    await renderStage(points, dims, myToken);
  }

  await refresh();
}
