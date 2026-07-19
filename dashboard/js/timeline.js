// RageClickRadar dashboard — session list and per-session timeline views.
//
// Two routes, both lazily mounted by app.js:
//   #/sessions[?page=/path]   route:'sessions' — recent sessions, newest first,
//                             optionally filtered to sessions touching one page.
//   #/session?id=s_abc        route:'session'  — a single session rendered as
//                             one horizontal signal-timeline lane per page.
//
// Rendering is pure DOM/SVG (no libraries). Each timeline lane is an inline
// <svg> with a seconds axis and four stacked mini-rows (one per signal type) so
// overlapping signal types never collide; markers are placed proportionally at
// their ts and reveal a custom tooltip on hover, focus, or tap.

import { getSessions, getSession } from './api.js';

// Signal display metadata. Colors live in CSS (--sig-*). `key` doubles as the
// chip modifier class (.chip--rage) and the row order in a timeline lane.
const SIGNALS = [
  { key: 'rage', label: 'Rage', short: 'Rage', title: 'Rage clicks', shape: 'diamond' },
  { key: 'dead', label: 'Dead', short: 'Dead', title: 'Dead clicks', shape: 'circle' },
  { key: 'formaband', label: 'Abandon', short: 'Abandon', title: 'Form abandonment', shape: 'diamond' },
  { key: 'correction', label: 'Correction', short: 'Correct', title: 'Input corrections', shape: 'circle' },
];
const SIGNAL_BY_KEY = Object.fromEntries(SIGNALS.map((s) => [s.key, s]));
const ROW_INDEX = Object.fromEntries(SIGNALS.map((s, i) => [s.key, i]));

// --- Small DOM helpers (mirrors pages.js conventions) ---------------------

// h('div', { class: 'x', onclick: fn }, child, 'text', ...) -> HTMLElement.
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

function loadingEl(label) {
  return h('p', { class: 'view-loading', role: 'status' }, label);
}

function errorCard(err) {
  return h(
    'div',
    { class: 'notice-card notice-card--error' },
    h('h2', {}, 'Could not load data'),
    h('p', {}, err && err.message ? err.message : 'Unexpected error.'),
  );
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

// Relative time for a ms-epoch timestamp: "just now", "5m ago", "3h ago", ...
function relTime(ts) {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return '—';
  const diff = Date.now() - ts;
  if (diff < 45 * 1000) return 'just now';
  const min = Math.round(diff / 60000);
  if (min < 60) return `${min}m ago`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

// "1280×720" device size, guarding against missing dimensions.
function deviceHint(vw, vh) {
  const kind = typeof vw === 'number' && vw <= 600 ? 'Mobile' : 'Desktop';
  const size = typeof vw === 'number' && typeof vh === 'number' ? `${vw}×${vh}` : '';
  return size ? `${kind} · ${size}` : kind;
}

// Seconds label from a ms value: "4s", "4.2s", "0.5s".
function fmtSec(ms) {
  const s = ms / 1000;
  return `${Number.isInteger(s) ? s : round1(s)}s`;
}

function pageDetailHash(page) {
  return `#/page?page=${encodeURIComponent(page)}`;
}
function sessionHash(id) {
  return `#/session?id=${encodeURIComponent(id)}`;
}

// One colored count chip per signal type that has activity (matches pages.js).
function signalChips(counts) {
  const wrap = h('span', { class: 'chips' });
  for (const sig of SIGNALS) {
    const n = (counts && counts[sig.key]) || 0;
    if (n === 0) continue;
    wrap.appendChild(
      h(
        'span',
        { class: `chip chip--${sig.key}`, title: `${sig.title}: ${n}` },
        h('span', { class: 'chip-dot', 'aria-hidden': 'true' }),
        `${sig.label} ${n}`,
      ),
    );
  }
  if (!wrap.childElementCount) wrap.appendChild(h('span', { class: 'chips-none' }, '—'));
  return wrap;
}

// --- Scoped styles --------------------------------------------------------
// View-specific styles live here (never in app.css). They ride along in the
// view subtree and are scoped under .timeline-view so they cannot leak.
const STYLE = `
.timeline-view { position: relative; }

.session-table { width: 100%; border-collapse: collapse; font-size: 0.9rem; min-width: 640px; }
.session-table th {
  text-align: left; font-size: 0.72rem; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.06em; color: var(--text-muted); padding: 0.65rem 0.9rem;
  border-bottom: 1px solid var(--border);
}
.session-table td { padding: 0.7rem 0.9rem; border-bottom: 1px solid var(--border); vertical-align: middle; }
.session-table tbody tr:last-child td { border-bottom: none; }
.session-row { cursor: pointer; }
.session-row:hover { background: var(--accent-soft); }
.session-id { font-family: var(--font-mono); font-size: 0.85rem; color: var(--text); }
.session-row:hover .session-id { color: var(--accent); }
.session-device { color: var(--text-muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
.session-when { color: var(--text-muted); white-space: nowrap; }
.session-total { text-align: right; font-variant-numeric: tabular-nums; }

.path-chips { display: inline-flex; flex-wrap: wrap; gap: 0.3rem; }
.path-chip {
  font-family: var(--font-mono); font-size: 0.72rem; color: var(--text-muted);
  background: var(--surface-2); border: 1px solid var(--border); border-radius: 6px;
  padding: 0.08rem 0.4rem; white-space: nowrap; max-width: 220px; overflow: hidden; text-overflow: ellipsis;
}

.filter-bar { display: flex; align-items: center; gap: 0.5rem; margin: 0.2rem 0 1.1rem; flex-wrap: wrap; }
.filter-label { font-size: 0.82rem; color: var(--text-muted); }
.filter-chip {
  display: inline-flex; align-items: center; gap: 0.45rem; font-size: 0.8rem; font-weight: 600;
  color: var(--accent); background: var(--accent-soft);
  border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
  border-radius: 999px; padding: 0.18rem 0.35rem 0.18rem 0.7rem;
}
.filter-chip code { font-size: 0.78rem; color: inherit; }
.filter-clear {
  font: inherit; line-height: 1; font-size: 0.9rem; color: var(--accent);
  background: color-mix(in srgb, var(--accent) 16%, transparent); border: none;
  border-radius: 50%; width: 18px; height: 18px; cursor: pointer; padding: 0;
  display: inline-flex; align-items: center; justify-content: center;
}
.filter-clear:hover { filter: brightness(1.1); }

.lane { margin: 0 0 1.4rem; background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius); box-shadow: var(--shadow); padding: 0.6rem 0.8rem 0.7rem; }
.lane-svg { display: block; width: 100%; height: auto; overflow: visible; }
.lane-grid { stroke: var(--border); stroke-width: 1; }
.lane-axis { stroke: var(--text-muted); stroke-width: 1; opacity: 0.55; }
.lane-tick-label { fill: var(--text-muted); font-family: var(--font-ui); font-size: 11px; }
.lane-row-label { font-family: var(--font-ui); font-size: 11px; font-weight: 600; }
.lane-baseline { stroke: var(--border); stroke-width: 1; opacity: 0.6; }
.tl-marker { cursor: pointer; }
.tl-marker:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.lane-caption { margin: 0.35rem 0 0; font-size: 0.8rem; color: var(--text-muted); display: flex;
  gap: 0.5rem; align-items: baseline; flex-wrap: wrap; }
.lane-caption a { font-family: var(--font-mono); text-decoration: none; }
.lane-caption a:hover { text-decoration: underline; }
.lane-caption .lane-count { font-variant-numeric: tabular-nums; }

.tl-tooltip {
  position: absolute; z-index: 20; pointer-events: none; min-width: 160px; max-width: 280px;
  background: var(--surface); color: var(--text); border: 1px solid var(--border);
  border-left: 3px solid var(--tip-accent, var(--accent)); border-radius: 8px;
  box-shadow: var(--shadow); padding: 0.5rem 0.65rem; font-size: 0.8rem;
  transform: translate(-50%, calc(-100% - 10px)); opacity: 0; transition: opacity 0.08s ease;
}
.tl-tooltip.is-visible { opacity: 1; }
.tl-tip-head { font-weight: 700; font-size: 0.82rem; color: var(--tip-accent, var(--text)); }
.tl-tip-sel { font-family: var(--font-mono); font-size: 0.75rem; color: var(--text-muted);
  word-break: break-all; margin: 0.15rem 0; }
.tl-tip-meta { color: var(--text-muted); font-variant-numeric: tabular-nums; }
.tl-tip-at { color: var(--text); font-variant-numeric: tabular-nums; font-weight: 600; }

.session-meta { display: flex; gap: 0.6rem; flex-wrap: wrap; align-items: center;
  margin: 0.2rem 0 1.2rem; color: var(--text-muted); font-size: 0.88rem; }
.session-meta code { background: var(--surface-2); border: 1px solid var(--border);
  border-radius: 6px; padding: 0.1rem 0.45rem; color: var(--text); }
.session-empty-lanes { color: var(--text-muted); font-size: 0.9rem; background: var(--surface);
  border: 1px dashed var(--border); border-radius: var(--radius); padding: 1.4rem 1rem; text-align: center; }
`;

function styleEl() {
  return h('style', { 'data-timeline-style': 'true' }, STYLE);
}

// --- Sessions list view ---------------------------------------------------

function emptySessions(filterPage) {
  const card = h(
    'div',
    { class: 'empty-card' },
    h('span', { class: 'empty-glyph', 'aria-hidden': 'true' }),
    h('h2', {}, filterPage ? 'No sessions on this page' : 'No sessions yet'),
    h(
      'p',
      {},
      filterPage
        ? 'No recorded session touched this page. Clear the filter to see all sessions.'
        : 'Once the radar records some visits, individual sessions show up here.',
    ),
  );
  if (filterPage) {
    card.appendChild(
      h('p', {}, h('a', { class: 'back-link', href: '#/sessions' }, 'Show all sessions')),
    );
  }
  return card;
}

function filterBar(filterPage) {
  return h(
    'div',
    { class: 'filter-bar' },
    h('span', { class: 'filter-label' }, 'Filtered to page'),
    h(
      'span',
      { class: 'filter-chip' },
      h('code', {}, filterPage),
      h(
        'button',
        {
          class: 'filter-clear',
          type: 'button',
          title: 'Clear filter',
          'aria-label': 'Clear page filter',
          onclick: () => {
            location.hash = '#/sessions';
          },
        },
        '×',
      ),
    ),
  );
}

function pathChips(pages) {
  const wrap = h('span', { class: 'path-chips' });
  for (const p of pages || []) {
    wrap.appendChild(h('span', { class: 'path-chip', title: p }, p));
  }
  if (!wrap.childElementCount) wrap.appendChild(h('span', { class: 'chips-none' }, '—'));
  return wrap;
}

function sessionsTable(sessions) {
  const head = h(
    'tr',
    {},
    h('th', { scope: 'col' }, 'Session'),
    h('th', { scope: 'col' }, 'Device'),
    h('th', { scope: 'col' }, 'When'),
    h('th', { scope: 'col' }, 'Pages'),
    h('th', { scope: 'col', class: 'session-total' }, 'Signals'),
    h('th', { scope: 'col' }, 'Breakdown'),
  );

  const body = h('tbody', {});
  for (const s of sessions) {
    const row = h(
      'tr',
      { class: 'session-row', tabindex: '0' },
      h('td', {}, h('a', { class: 'session-id', href: sessionHash(s.id) }, s.id)),
      h('td', { class: 'session-device' }, deviceHint(s.vw, s.vh)),
      h('td', { class: 'session-when' }, relTime(s.lastSeen)),
      h('td', {}, pathChips(s.pages)),
      h('td', { class: 'session-total' }, String(s.events)),
      h('td', {}, signalChips(s.counts)),
    );
    const go = () => {
      location.hash = sessionHash(s.id);
    };
    row.addEventListener('click', (ev) => {
      if (ev.target.closest('a')) return; // the anchor already navigates
      go();
    });
    row.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && ev.target === row) go();
    });
    body.appendChild(row);
  }

  return h(
    'div',
    { class: 'table-wrap' },
    h('table', { class: 'session-table' }, h('thead', {}, head), body),
  );
}

async function mountSessions(root, params) {
  const filterPage = params && params.page ? params.page : null;
  root.appendChild(loadingEl('Loading sessions…'));

  let sessions;
  try {
    sessions = await getSessions(filterPage ? { page: filterPage } : undefined);
  } catch (err) {
    root.replaceChildren(styleEl(), errorCard(err));
    return;
  }

  const header = h(
    'div',
    { class: 'view-header' },
    h('h1', {}, 'Sessions'),
    h(
      'p',
      { class: 'view-sub' },
      'Recent visitor sessions, newest first. Open one to see its frustration timeline.',
    ),
  );

  const children = [styleEl(), header];
  if (filterPage) children.push(filterBar(filterPage));

  if (!Array.isArray(sessions) || sessions.length === 0) {
    children.push(emptySessions(filterPage));
  } else {
    children.push(sessionsTable(sessions));
  }
  root.replaceChildren(...children);
}

// --- Session detail: timeline lanes ---------------------------------------

// Group a session's events into ordered per-page buckets. Groups appear in the
// order each page is first seen; events keep their (ts-ascending) order.
function groupByPage(events) {
  const groups = new Map();
  for (const ev of events || []) {
    let g = groups.get(ev.page);
    if (!g) {
      g = [];
      groups.set(ev.page, g);
    }
    g.push(ev);
  }
  return groups;
}

// Choose a "nice" seconds tick step so the axis shows ~4-6 intervals.
function niceTicks(maxMs) {
  const axisMax = maxMs > 0 ? maxMs : 1000; // empty/zero → minimal 1s axis
  const steps = [500, 1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000, 300000, 600000];
  let step = steps[steps.length - 1];
  for (const s of steps) {
    if (axisMax / s <= 6) {
      step = s;
      break;
    }
  }
  const ticks = [];
  for (let t = 0; t <= axisMax + 0.5; t += step) ticks.push(t);
  // Ensure the axis end is represented even if it is not a step multiple.
  if (ticks[ticks.length - 1] < axisMax) ticks.push(axisMax);
  return { axisMax, ticks };
}

// Radius for a marker, subtly scaled by magnitude n and capped.
function markerRadius(n) {
  const mag = Math.max(1, Math.min(Number(n) || 1, 8));
  return 4 + mag * 0.5; // 4.5 (n=1) .. 8 (n>=8)
}

// Human tooltip line describing one event's magnitude/meta.
function metaLine(ev) {
  const m = ev.meta && typeof ev.meta === 'object' ? ev.meta : null;
  if (ev.type === 'formaband') {
    const fields = Number(ev.n) || 0;
    const parts = [`${fields} field${fields === 1 ? '' : 's'} touched`];
    if (m && Number.isFinite(Number(m.dwell))) parts.push(`dwell ${fmtSec(Number(m.dwell))}`);
    return parts.join(', ');
  }
  if (ev.type === 'correction') {
    const del = Number(ev.n) || 0;
    const ins = m && Number.isFinite(Number(m.i)) ? Number(m.i) : null;
    return ins === null ? `${del} deletions` : `${del} deletions vs ${ins} insertions`;
  }
  // rage / dead: magnitude is a click count.
  const n = Number(ev.n) || 1;
  const noun = ev.type === 'rage' ? 'clicks in burst' : 'clicks';
  return `${n} ${noun}`;
}

// Build one <svg> timeline lane. Returns { svg, markers } where markers is the
// data array indexed by each marker element's data-idx.
function buildLane(events) {
  const W = 1000;
  const gutter = 66; // left label column
  const padR = 20;
  const padTop = 12;
  const rowH = 22;
  const axisGap = 8;
  const rows = SIGNALS.length;
  const plotLeft = gutter;
  const plotRight = W - padR;
  const plotW = plotRight - plotLeft;
  const rowsBottom = padTop + rows * rowH;
  const axisY = rowsBottom + axisGap;
  const totalH = axisY + 20;

  const maxTs = events.reduce((m, e) => (typeof e.ts === 'number' && e.ts > m ? e.ts : m), 0);
  const { axisMax, ticks } = niceTicks(maxTs);
  const xFor = (ts) => plotLeft + (axisMax > 0 ? (Math.max(0, ts) / axisMax) * plotW : 0);

  const parts = [];
  parts.push(
    `<svg class="lane-svg" viewBox="0 0 ${W} ${totalH}" role="img" ` +
      `preserveAspectRatio="xMidYMid meet" aria-label="Signal timeline lane">`,
  );

  // Vertical grid + tick labels.
  for (const t of ticks) {
    const x = round1(xFor(t));
    parts.push(
      `<line class="lane-grid" x1="${x}" y1="${padTop}" x2="${x}" y2="${rowsBottom}" opacity="0.35" />`,
    );
    parts.push(
      `<text class="lane-tick-label" x="${x}" y="${totalH - 5}" text-anchor="middle">${fmtSec(t)}</text>`,
    );
  }
  // Axis baseline.
  parts.push(
    `<line class="lane-axis" x1="${plotLeft}" y1="${axisY}" x2="${plotRight}" y2="${axisY}" />`,
  );

  // Per-type row: baseline + left label.
  for (const sig of SIGNALS) {
    const i = ROW_INDEX[sig.key];
    const cy = round1(padTop + i * rowH + rowH / 2);
    parts.push(
      `<line class="lane-baseline" x1="${plotLeft}" y1="${cy}" x2="${plotRight}" y2="${cy}" />`,
    );
    parts.push(
      `<text class="lane-row-label" x="${gutter - 10}" y="${cy + 4}" text-anchor="end" ` +
        `fill="var(--sig-${sig.key})">${sig.short}</text>`,
    );
  }

  // Markers. Per-type running index drives deterministic vertical jitter.
  const markers = [];
  const perTypeCount = {};
  for (const ev of events) {
    const sig = SIGNAL_BY_KEY[ev.type];
    if (!sig) continue; // unknown type: skip defensively
    const i = ROW_INDEX[ev.type];
    const k = (perTypeCount[ev.type] = (perTypeCount[ev.type] || 0) + 1) - 1;
    const jitter = ((k % 3) - 1) * (rowH * 0.16);
    const cx = round1(xFor(ev.ts || 0));
    const cy = round1(padTop + i * rowH + rowH / 2 + jitter);
    const r = round1(markerRadius(ev.n));
    const idx = markers.length;
    markers.push(ev);
    const fill = `var(--sig-${ev.type})`;
    if (sig.shape === 'diamond') {
      const pts = `${cx},${round1(cy - r)} ${round1(cx + r)},${cy} ${cx},${round1(cy + r)} ${round1(cx - r)},${cy}`;
      parts.push(
        `<polygon class="tl-marker" data-idx="${idx}" tabindex="0" points="${pts}" ` +
          `fill="${fill}" stroke="var(--surface)" stroke-width="1" />`,
      );
    } else {
      parts.push(
        `<circle class="tl-marker" data-idx="${idx}" tabindex="0" cx="${cx}" cy="${cy}" r="${r}" ` +
          `fill="${fill}" stroke="var(--surface)" stroke-width="1" />`,
      );
    }
  }

  parts.push('</svg>');
  return { svg: parts.join(''), markers };
}

// Attach the shared tooltip behaviour to every marker inside a mounted lane.
function wireLaneMarkers(laneEl, markers, tip, root) {
  const show = (markerEl) => {
    const idx = Number(markerEl.dataset.idx);
    const ev = markers[idx];
    if (!ev) return;
    const sig = SIGNAL_BY_KEY[ev.type];
    tip.style.setProperty('--tip-accent', `var(--sig-${ev.type})`);
    tip.replaceChildren(
      h('div', { class: 'tl-tip-head' }, sig ? sig.title : ev.type),
      h('div', { class: 'tl-tip-sel' }, ev.selector || '(no selector)'),
      h('div', { class: 'tl-tip-meta' }, metaLine(ev)),
      h('div', { class: 'tl-tip-at' }, `at ${fmtSec(ev.ts || 0)}`),
    );
    // Position relative to the view root, above the marker, clamped horizontally.
    const rootRect = root.getBoundingClientRect();
    const mRect = markerEl.getBoundingClientRect();
    let left = mRect.left - rootRect.left + mRect.width / 2;
    const top = mRect.top - rootRect.top;
    const halfW = 140;
    left = Math.max(halfW + 4, Math.min(left, rootRect.width - halfW - 4));
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
    tip.classList.add('is-visible');
  };
  const hide = () => tip.classList.remove('is-visible');

  for (const markerEl of laneEl.querySelectorAll('.tl-marker')) {
    const idx = Number(markerEl.dataset.idx);
    const ev = markers[idx];
    if (ev) {
      const sig = SIGNAL_BY_KEY[ev.type];
      markerEl.setAttribute(
        'aria-label',
        `${sig ? sig.title : ev.type} at ${fmtSec(ev.ts || 0)}: ${ev.selector || 'no selector'}`,
      );
      markerEl.setAttribute('role', 'button');
    }
    markerEl.addEventListener('mouseenter', () => show(markerEl));
    markerEl.addEventListener('mouseleave', hide);
    markerEl.addEventListener('focus', () => show(markerEl));
    markerEl.addEventListener('blur', hide);
    // Tap-to-toggle for touch: stop the root handler from immediately hiding.
    markerEl.addEventListener('click', (e) => {
      e.stopPropagation();
      if (tip.classList.contains('is-visible') && tip.dataset.for === String(idx)) {
        hide();
      } else {
        tip.dataset.for = String(idx);
        show(markerEl);
      }
    });
  }
}

async function mountSession(root, params) {
  const id = params && params.id;
  if (!id) {
    root.replaceChildren(
      styleEl(),
      h(
        'div',
        { class: 'notice-card' },
        h('h2', {}, 'No session selected'),
        h('p', {}, h('a', { href: '#/sessions' }, 'Back to all sessions')),
      ),
    );
    return;
  }

  root.appendChild(loadingEl('Loading session…'));

  let session;
  try {
    session = await getSession(id);
  } catch (err) {
    root.replaceChildren(styleEl(), errorCard(err));
    return;
  }

  const events = Array.isArray(session.events) ? session.events : [];
  const groups = groupByPage(events);

  const header = h(
    'div',
    { class: 'view-header' },
    h('a', { class: 'back-link', href: '#/sessions' }, '← All sessions'),
    h('h1', { class: 'page-title' }, h('code', {}, session.id)),
    h(
      'div',
      { class: 'session-meta' },
      h('span', {}, deviceHint(session.vw, session.vh)),
      h('span', {}, `${events.length} signal${events.length === 1 ? '' : 's'}`),
      h('span', {}, `${groups.size} page${groups.size === 1 ? '' : 's'}`),
    ),
  );

  // A single tooltip element shared across every lane in this view. It lives in
  // the view subtree, so navigation (which clears #view) disposes of it.
  const tip = h('div', { class: 'tl-tooltip', role: 'status', 'aria-live': 'polite' });

  const lanesWrap = h('div', { class: 'lanes' });
  if (groups.size === 0) {
    lanesWrap.appendChild(
      h('p', { class: 'session-empty-lanes' }, 'This session recorded no signal events.'),
    );
  }

  const laneMarkerSets = [];
  for (const [page, evs] of groups) {
    const { svg, markers } = buildLane(evs);
    const laneEl = h('div', { class: 'lane' });
    laneEl.insertAdjacentHTML('beforeend', svg);
    const caption = h(
      'p',
      { class: 'lane-caption' },
      h('a', { href: pageDetailHash(page) }, page),
      h('span', { class: 'lane-count' }, `${evs.length} signal${evs.length === 1 ? '' : 's'}`),
    );
    laneEl.appendChild(caption);
    lanesWrap.appendChild(laneEl);
    laneMarkerSets.push({ laneEl, markers });
  }

  root.replaceChildren(styleEl(), header, lanesWrap, tip);

  // Wire tooltips after the lanes are in the document (getBoundingClientRect).
  for (const { laneEl, markers } of laneMarkerSets) {
    wireLaneMarkers(laneEl, markers, tip, root);
  }
  // Tapping empty space dismisses the tooltip; scoped to the view root so the
  // listener is discarded when #view is cleared on the next navigation.
  root.addEventListener('click', () => tip.classList.remove('is-visible'));
}

// --- Entry point ----------------------------------------------------------

/**
 * Mount the sessions list or a single session timeline.
 * @param {HTMLElement} el mount point (cleared by the router)
 * @param {{route:'sessions'|'session', page?:string, id?:string}} params
 */
export default async function mount(el, params) {
  const root = h('div', { class: 'timeline-view' });
  el.replaceChildren(root);
  if (params && params.route === 'session') {
    await mountSession(root, params);
  } else {
    await mountSessions(root, params);
  }
}
