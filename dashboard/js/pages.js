// RageClickRadar dashboard — pages ranking and per-page detail views.

import { getPages, getHotspots } from './api.js';

// Signal display metadata. Colors live in CSS (--sig-*); `key` doubles as the
// chip modifier class, e.g. .chip--rage.
const SIGNALS = [
  { key: 'rage', label: 'Rage', title: 'Rage clicks' },
  { key: 'dead', label: 'Dead', title: 'Dead clicks' },
  { key: 'formaband', label: 'Abandon', title: 'Form abandonment' },
  { key: 'correction', label: 'Correction', title: 'Input corrections' },
];

const SNIPPET = '<script src="/radar.js" defer><\/script>';

// --- Small DOM helpers ----------------------------------------------------

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

const NEVER_STALE = () => false;

function fmtScore(score) {
  return Number.isInteger(score) ? String(score) : score.toFixed(1);
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

function pageDetailHash(page) {
  return `#/page?page=${encodeURIComponent(page)}`;
}

// One colored count chip per signal type that has activity.
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
  if (!wrap.childElementCount) {
    wrap.appendChild(h('span', { class: 'chips-none' }, '—'));
  }
  return wrap;
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

async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = 'Copied';
  } catch {
    button.textContent = 'Copy failed';
  }
  button.classList.add('is-copied');
  setTimeout(() => {
    button.textContent = 'Copy';
    button.classList.remove('is-copied');
  }, 1600);
}

function copyBlock(code) {
  const btn = h('button', { class: 'copy-btn', type: 'button' }, 'Copy');
  btn.addEventListener('click', () => copyText(code, btn));
  return h('div', { class: 'copy-block' }, h('code', {}, code), btn);
}

// --- Empty state ----------------------------------------------------------

function emptyState() {
  return h(
    'div',
    { class: 'empty-card' },
    h('span', { class: 'empty-glyph', 'aria-hidden': 'true' }),
    h('h2', {}, 'No frustration data yet'),
    h(
      'p',
      {},
      'The radar is listening, but nothing has come in. Two ways to light it up:',
    ),
    h(
      'div',
      { class: 'empty-options' },
      h(
        'section',
        { class: 'empty-option' },
        h('h3', {}, 'Try it with demo data'),
        h('p', {}, 'Seed synthetic sessions against the bundled demo site.'),
        copyBlock('npm run seed'),
      ),
      h(
        'section',
        { class: 'empty-option' },
        h('h3', {}, 'Install the tracker'),
        h('p', {}, 'Add one line before the closing body tag of your site.'),
        copyBlock(SNIPPET),
      ),
    ),
  );
}

// --- Pages ranking view ---------------------------------------------------

function pagesTable(pages) {
  // reduce, not Math.max(...spread): a large pages array would overflow the
  // call-stack argument limit and throw RangeError.
  const maxScore = pages.reduce((m, p) => Math.max(m, p.score), 1);

  const head = h(
    'tr',
    {},
    h('th', { scope: 'col' }, 'Page'),
    h('th', { scope: 'col', class: 'col-score' }, 'Frustration'),
    h('th', { scope: 'col' }, 'Signals'),
    h('th', { scope: 'col', class: 'col-num' }, 'Sessions'),
    h('th', { scope: 'col', class: 'col-last' }, 'Last seen'),
  );

  const body = h('tbody', {});
  for (const p of pages) {
    const pct = Math.max(4, Math.round((p.score / maxScore) * 100));
    const row = h(
      'tr',
      { class: 'page-row', tabindex: '0' },
      h('td', { class: 'cell-page' }, h('a', { href: pageDetailHash(p.page) }, p.page)),
      h(
        'td',
        { class: 'col-score' },
        h(
          'span',
          { class: 'score-meter', title: `Weighted confusion score: ${fmtScore(p.score)}` },
          h('span', { class: 'score-meter-bar', style: `--w:${pct}%` }),
          h('span', { class: 'score-meter-value' }, fmtScore(p.score)),
        ),
      ),
      h('td', {}, signalChips(p.counts)),
      h('td', { class: 'col-num' }, String(p.sessions)),
      h('td', { class: 'col-last' }, relTime(p.lastSeen)),
    );
    const go = () => {
      location.hash = pageDetailHash(p.page);
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
    h('table', { class: 'pages-table' }, h('thead', {}, head), body),
  );
}

/**
 * Pages ranking view (route #/pages).
 * @param {HTMLElement} el mount point
 * @param {() => boolean} [stale] returns true if navigation superseded us
 */
export async function renderPagesList(el, stale = NEVER_STALE) {
  el.replaceChildren(loadingEl('Loading pages…'));
  let pages;
  try {
    pages = await getPages();
  } catch (err) {
    if (!stale()) el.replaceChildren(errorCard(err));
    return;
  }
  if (stale()) return;

  const header = h(
    'div',
    { class: 'view-header' },
    h('h1', {}, 'Pages by frustration'),
    h('p', { class: 'view-sub' }, 'Ranked by weighted confusion score across all sessions.'),
  );

  if (!Array.isArray(pages) || pages.length === 0) {
    el.replaceChildren(header, emptyState());
    return;
  }
  el.replaceChildren(header, pagesTable(pages));
}

// --- Page detail view -----------------------------------------------------

function summaryChip(label, value, extraClass) {
  return h(
    'div',
    { class: `stat${extraClass ? ` ${extraClass}` : ''}` },
    h('span', { class: 'stat-value' }, value),
    h('span', { class: 'stat-label' }, label),
  );
}

function hotspotsList(hotspots) {
  if (!hotspots.length) {
    return h(
      'p',
      { class: 'hotspots-empty' },
      'No element-level hotspots recorded for this page yet.',
    );
  }
  // reduce, not Math.max(...spread): guards against RangeError on huge arrays.
  const maxScore = hotspots.reduce((m, hs) => Math.max(m, hs.score), 1);
  const list = h('ol', { class: 'hotspots' });
  for (const [i, hs] of hotspots.entries()) {
    const pct = Math.max(4, Math.round((hs.score / maxScore) * 100));
    list.appendChild(
      h(
        'li',
        { class: 'hotspot' },
        h('span', { class: 'hotspot-rank', 'aria-hidden': 'true' }, String(i + 1)),
        h(
          'div',
          { class: 'hotspot-main' },
          h('code', { class: 'hotspot-selector' }, hs.selector),
          signalChips(hs.counts),
        ),
        h(
          'div',
          { class: 'hotspot-numbers' },
          h(
            'span',
            { class: 'score-meter', title: `Weighted confusion score: ${fmtScore(hs.score)}` },
            h('span', { class: 'score-meter-bar', style: `--w:${pct}%` }),
            h('span', { class: 'score-meter-value' }, fmtScore(hs.score)),
          ),
          h(
            'span',
            { class: 'hotspot-mag', title: 'Total signal magnitude (e.g. clicks in bursts)' },
            `${hs.totalMagnitude} signals`,
          ),
        ),
      ),
    );
  }
  return list;
}

/**
 * Per-page detail view (route #/page?page=X).
 * @param {HTMLElement} el mount point
 * @param {{page?: string}} params decoded route params
 * @param {() => boolean} [stale] returns true if navigation superseded us
 */
export async function renderPageDetail(el, params, stale = NEVER_STALE) {
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

  el.replaceChildren(loadingEl('Loading page detail…'));
  let pages;
  let hotspotsRes;
  try {
    [pages, hotspotsRes] = await Promise.all([getPages(), getHotspots(page)]);
  } catch (err) {
    if (!stale()) el.replaceChildren(errorCard(err));
    return;
  }
  if (stale()) return;

  const summary = (Array.isArray(pages) ? pages : []).find((p) => p.page === page) || {
    page,
    score: 0,
    counts: { rage: 0, dead: 0, formaband: 0, correction: 0 },
    sessions: 0,
    lastSeen: null,
  };

  const enc = encodeURIComponent(page);
  const stats = h(
    'div',
    { class: 'stats' },
    summaryChip('score', fmtScore(summary.score), 'stat--score'),
    ...SIGNALS.map((sig) =>
      summaryChip(sig.title.toLowerCase(), String(summary.counts[sig.key] || 0), `stat--${sig.key}`),
    ),
    summaryChip('sessions', String(summary.sessions)),
  );

  el.replaceChildren(
    h(
      'div',
      { class: 'view-header' },
      h('a', { class: 'back-link', href: '#/pages' }, '← All pages'),
      h('h1', { class: 'page-title' }, h('code', {}, page)),
      summary.lastSeen != null
        ? h('p', { class: 'view-sub' }, `Last activity ${relTime(summary.lastSeen)}`)
        : null,
    ),
    stats,
    h(
      'div',
      { class: 'detail-actions' },
      h('a', { class: 'btn btn--primary', href: `#/heatmap?page=${enc}` }, 'Open heatmap'),
      h('a', { class: 'btn', href: `#/sessions?page=${enc}` }, 'View sessions'),
    ),
    h(
      'section',
      { class: 'hotspots-section' },
      h('h2', {}, 'Confusion hotspots'),
      h(
        'p',
        { class: 'view-sub' },
        'Elements ranked by weighted frustration signals on this page.',
      ),
      hotspotsList(hotspotsRes && Array.isArray(hotspotsRes.hotspots) ? hotspotsRes.hotspots : []),
    ),
  );
}
