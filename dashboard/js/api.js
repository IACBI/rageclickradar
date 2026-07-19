// RageClickRadar dashboard — read-API client.
// Thin fetch wrapper plus one typed helper per read endpoint. All helpers
// return parsed JSON or throw an ApiError with a human-readable message.

/** Error thrown for any failed API call. `status` is 0 for network failures. */
export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/**
 * Fetch `path` (same-origin) and parse the JSON body.
 * @param {string} path e.g. '/api/pages'
 * @returns {Promise<any>}
 * @throws {ApiError} on network failure or non-2xx response.
 */
export async function getJSON(path) {
  let res;
  try {
    res = await fetch(path, { headers: { accept: 'application/json' } });
  } catch {
    throw new ApiError('Could not reach the server. Is it still running?', 0);
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    // Non-JSON body (proxy error page, empty response); fall through.
  }
  if (!res.ok) {
    const detail = body && typeof body.error === 'string' ? body.error : null;
    throw new ApiError(detail || `Request failed with status ${res.status}`, res.status);
  }
  return body;
}

// Build a query string from a params object, skipping empty values.
function qs(params) {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== '') sp.set(key, value);
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

/** Per-page confusion summary, ranked by score descending. */
export function getPages() {
  return getJSON('/api/pages');
}

/**
 * Click points for a page's heatmap.
 * @param {{page:string, type?:string, vwMin?:number, vwMax?:number}} params
 */
export function getHeatmap(params) {
  return getJSON(`/api/heatmap${qs(params)}`);
}

/** Selector-level hotspots for one page, ranked by score descending. */
export function getHotspots(page) {
  return getJSON(`/api/hotspots${qs({ page })}`);
}

/**
 * Recent sessions, newest first.
 * @param {{page?:string, limit?:number}} [params]
 */
export function getSessions(params) {
  return getJSON(`/api/sessions${qs(params)}`);
}

/** Full detail (ordered events) for one session. */
export function getSession(id) {
  return getJSON(`/api/session${qs({ id })}`);
}
