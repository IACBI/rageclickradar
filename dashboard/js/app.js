// RageClickRadar dashboard — app shell and hash router.
//
// Routes (hash-based, params URL-encoded):
//   #/pages                    pages ranking (default)
//   #/page?page=/path          per-page detail + confusion hotspots
//   #/heatmap?page=/path       heatmap view        (lazy: ./heatmap.js)
//   #/sessions[?page=/path]    session list        (lazy: ./timeline.js)
//   #/session?id=s_abc         session timeline    (lazy: ./timeline.js)
//
// Contract for the lazily loaded views: `heatmap.js` and `timeline.js` each
// `export default function mount(el, params)` where `el` is the view mount
// element (cleared by the router before the call) and `params` is a plain
// object of decoded query params plus `route` (e.g. 'sessions' | 'session').

import { renderPagesList, renderPageDetail } from './pages.js';

const view = document.getElementById('view');

// Cache dynamic-import promises so a missing module is fetched at most once
// per load instead of on every hash change (no request/console spam).
const moduleCache = new Map();
function loadModule(path) {
  if (!moduleCache.has(path)) moduleCache.set(path, import(path));
  return moduleCache.get(path);
}

// Parse '#/route?query' into { route, params }. Params are decoded strings.
function parseHash(hash) {
  const raw = String(hash || '').replace(/^#\/?/, '');
  const q = raw.indexOf('?');
  const route = (q === -1 ? raw : raw.slice(0, q)) || 'pages';
  const params = {};
  const sp = new URLSearchParams(q === -1 ? '' : raw.slice(q + 1));
  for (const [key, value] of sp) params[key] = value;
  return { route, params };
}

function renderMessage(title, body) {
  view.replaceChildren();
  const card = document.createElement('div');
  card.className = 'notice-card';
  const h = document.createElement('h2');
  h.textContent = title;
  card.appendChild(h);
  if (body) {
    const p = document.createElement('p');
    p.textContent = body;
    card.appendChild(p);
  }
  view.appendChild(card);
}

// Route to a lazily loaded view module. Both target modules ship with the
// dashboard, so a rejected import is a genuine load failure — surface a plain
// error and log the underlying cause rather than a "coming soon" placeholder.
async function mountLazy(modulePath, route, params) {
  let mod;
  try {
    mod = await loadModule(modulePath);
  } catch (err) {
    console.error(`Failed to load view module ${modulePath}:`, err);
    renderMessage('Failed to load this view.');
    return;
  }
  view.replaceChildren();
  await mod.default(view, { route, ...params });
}

// Highlight the nav item that owns the current route.
const NAV_SECTION = {
  pages: 'pages',
  page: 'pages',
  heatmap: 'pages',
  sessions: 'sessions',
  session: 'sessions',
};

function updateNav(route) {
  const section = NAV_SECTION[route] || null;
  for (const link of document.querySelectorAll('.app-nav a[data-nav]')) {
    if (link.dataset.nav === section) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

// Monotonic token so a stale async render never overwrites a newer one.
let navToken = 0;

async function render() {
  const token = ++navToken;
  const { route, params } = parseHash(location.hash);
  updateNav(route);

  // Guard: only apply the result if no newer navigation happened meanwhile.
  const stale = () => token !== navToken;

  try {
    switch (route) {
      case 'pages':
        await renderPagesList(view, stale);
        break;
      case 'page':
        await renderPageDetail(view, params, stale);
        break;
      case 'heatmap':
        if (!stale()) await mountLazy('./heatmap.js', route, params);
        break;
      case 'sessions':
      case 'session':
        if (!stale()) await mountLazy('./timeline.js', route, params);
        break;
      default:
        if (!stale()) {
          renderMessage('Page not found', 'That link does not match any dashboard view.');
        }
    }
  } catch (err) {
    if (!stale()) {
      renderMessage(
        'Something went wrong',
        err && err.message ? err.message : 'Unexpected error while rendering this view.',
      );
    }
  }
}

window.addEventListener('hashchange', render);
render();
