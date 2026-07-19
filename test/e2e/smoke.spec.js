// RageClickRadar — end-to-end smoke test.
//
// Drives the bundled CloudNimbus demo with real Chromium input, then asserts
// the full detection pipeline: tracker → sendBeacon flush → /api/collect →
// aggregation queries → dashboard rendering. The three-step demo (rage, dead,
// correction+abandonment) is encoded here as serial tests so event
// accumulation is deterministic (later assertions read data the earlier tests
// produced).
//
// Timing discipline: detector settle windows (rage 700ms, dead 600ms) are the
// only fixed waits — they are hard requirements of the tracker, not flake
// masking. Everything downstream (beacon delivery, DB write, aggregation) is
// reached via API polling with a bounded timeout, never a sleep.

import { test, expect } from '@playwright/test';

const INDEX = '/demo/index.html';
const SIGNUP = '/demo/signup.html';

// --- Small helpers ---------------------------------------------------------

// GET a same-origin JSON endpoint (baseURL comes from the config).
async function getJson(request, path) {
  const res = await request.get(path);
  expect(res.ok(), `GET ${path} -> ${res.status()}`).toBeTruthy();
  return res.json();
}

function hotspotsUrl(page) {
  return `/api/hotspots?page=${encodeURIComponent(page)}`;
}

// Locate one selector's hotspot entry in a /api/hotspots response.
function findHotspot(data, selector) {
  const list = (data && Array.isArray(data.hotspots) && data.hotspots) || [];
  return list.find((h) => h.selector === selector);
}

// Poll /api/hotspots until `selector` shows at least one occurrence of `type`.
async function expectHotspotCount(request, page, selector, type) {
  await expect
    .poll(
      async () => {
        const data = await getJson(request, hotspotsUrl(page));
        const hs = findHotspot(data, selector);
        return hs && hs.counts ? hs.counts[type] || 0 : 0;
      },
      { timeout: 10_000, intervals: [200, 400, 700, 1000] },
    )
    .toBeGreaterThanOrEqual(1);
}

// Click the same viewport point `n` times with a short inter-click delay,
// producing a tight cluster the rage detector will fold into one burst.
async function rapidClick(page, x, y, n, delayMs) {
  for (let i = 0; i < n; i++) {
    await page.mouse.click(x, y);
    if (i < n - 1) await page.waitForTimeout(delayMs);
  }
}

// --- Tests -----------------------------------------------------------------

test.describe.serial('RageClickRadar detection pipeline', () => {
  // 1) The tracker is served as a small JS bundle. Proves the /radar.js route
  //    and the 5 KB size budget the demo pages depend on.
  test('serves the tracker bundle under budget', async ({ request }) => {
    const res = await request.get('/radar.js');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('text/javascript');
    const body = await res.body();
    expect(body.length).toBeLessThanOrEqual(5120);
  });

  // 2) Rage clicks: hammer the no-feedback CTA, let the burst settle, flush via
  //    pagehide. Proves rage detection reaches both the coordinate heatmap and
  //    the selector hotspots for #get-started.
  test('detects a rage-click burst on #get-started', async ({ page, request }) => {
    await page.goto(INDEX, { waitUntil: 'load' });

    const box = await page.locator('#get-started').boundingBox();
    expect(box).not.toBeNull();
    const cx = Math.round(box.x + box.width / 2);
    const cy = Math.round(box.y + box.height / 2);

    // 5 rapid clicks at one point: >= RAGE_MIN_CLICKS, gaps < RAGE_MAX_GAP_MS,
    // 0 px apart. The CTA's own navigation is delayed 2s, so we settle first.
    await rapidClick(page, cx, cy, 5, 80);
    await page.waitForTimeout(1000); // > RAGE_SETTLE_MS (700ms): burst emits
    await page.goto('about:blank'); // pagehide → sendBeacon flush

    // Coordinate heatmap: at least one rage point landed (selector-agnostic).
    await expect
      .poll(
        async () => {
          const data = await getJson(
            request,
            `/api/heatmap?page=${encodeURIComponent(INDEX)}&type=rage`,
          );
          return data && Array.isArray(data.points) ? data.points.length : 0;
        },
        { timeout: 10_000, intervals: [200, 400, 700, 1000] },
      )
      .toBeGreaterThanOrEqual(1);

    // Selector hotspot: the burst is attributed to #get-started.
    await expectHotspotCount(request, INDEX, '#get-started', 'rage');
  });

  // 3) Dead click: a single click on the inert promo banner with no follow-up
  //    interaction. Proves dead-click detection for a non-interactive element.
  test('detects a dead click on #hero-banner', async ({ page, request }) => {
    await page.goto(INDEX, { waitUntil: 'load' });

    await page.locator('#hero-banner').click();
    await page.waitForTimeout(700); // > DEAD_WAIT_MS (600ms), no other input
    await page.goto('about:blank'); // flush

    await expectHotspotCount(request, INDEX, '#hero-banner', 'dead');
  });

  // 4) Correction churn + form abandonment on the signup form. Type then delete
  //    heavily in #fullname (D=10 >= 8 and >= 0.5×12), blur to evaluate the
  //    correction, engage a second field, then abandon. Proves both the
  //    per-field correction signal and the form-level abandonment signal.
  test('detects correction churn and form abandonment on signup', async ({ page, request }) => {
    await page.goto(SIGNUP, { waitUntil: 'load' });

    await page.locator('#fullname').click();
    await page.keyboard.type('Ada Lovelace', { delay: 30 }); // 12 insertions
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('Backspace'); // 10 deletions
      await page.waitForTimeout(30);
    }

    // Blur #fullname (correction evaluated on blur) and engage #email.
    await page.locator('#email').click();
    await page.keyboard.type('a@bc', { delay: 30 });

    await page.goto('about:blank'); // pagehide → form abandonment + flush

    await expectHotspotCount(request, SIGNUP, '#fullname', 'correction');
    await expectHotspotCount(request, SIGNUP, '#signup-form', 'formaband');
  });

  // 5) Pages ranking: both demo pages now surface with a positive weighted
  //    confusion score. Proves the /api/pages aggregation across sessions.
  test('ranks both demo pages with a positive score', async ({ request }) => {
    const pages = await getJson(request, '/api/pages');
    expect(Array.isArray(pages)).toBeTruthy();

    const byPage = new Map(pages.map((p) => [p.page, p]));
    for (const path of [INDEX, SIGNUP]) {
      const entry = byPage.get(path);
      expect(entry, `expected ${path} in /api/pages`).toBeTruthy();
      expect(entry.score).toBeGreaterThan(0);
    }
  });

  // 6) Dashboard heatmap renders a non-blank overlay for the index page and the
  //    dashboard raises no page errors. Proves the heatmap view draws the rage
  //    points captured in test 2 onto its canvas.
  test('renders a non-blank heatmap canvas without page errors', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err));

    await page.goto(`/#/heatmap?page=${encodeURIComponent(INDEX)}`, { waitUntil: 'load' });

    // Wait for a canvas to exist (live-iframe overlay or wireframe fallback).
    await page.waitForSelector('canvas', { timeout: 10_000 });

    // Poll the canvas pixels: some sampled cell must have alpha > 0 once the
    // overlay has drawn (drawing happens async after the iframe load).
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const canvases = Array.from(document.querySelectorAll('canvas'));
            for (const c of canvases) {
              if (!c.width || !c.height) continue;
              const ctx = c.getContext('2d');
              if (!ctx) continue;
              const step = 24;
              for (let y = 0; y < c.height; y += step) {
                for (let x = 0; x < c.width; x += step) {
                  if (ctx.getImageData(x, y, 1, 1).data[3] > 0) return true;
                }
              }
            }
            return false;
          }),
        { timeout: 10_000, intervals: [300, 500, 800, 1000] },
      )
      .toBe(true);

    expect(pageErrors, pageErrors.map((e) => e.message).join('\n')).toEqual([]);
  });

  // 7) Dashboard pages view lists the demo pages in API score order. Proves the
  //    pages table renders and preserves the server's ranking.
  test('lists demo pages in the pages table in API score order', async ({ page, request }) => {
    const apiPages = await getJson(request, '/api/pages');
    const apiOrder = apiPages.map((p) => p.page);

    await page.goto('/', { waitUntil: 'load' });
    await page.waitForSelector('.pages-table tbody tr', { timeout: 10_000 });

    const domOrder = await page.$$eval('.pages-table tbody .cell-page a', (as) =>
      as.map((a) => a.textContent.trim()),
    );

    // Both demo pages present, and the table order matches the API ranking.
    expect(domOrder).toContain(INDEX);
    expect(domOrder).toContain(SIGNUP);
    expect(domOrder).toEqual(apiOrder);
  });
});
