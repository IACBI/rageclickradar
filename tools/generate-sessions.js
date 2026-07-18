// RageClickRadar — synthetic session generator (Task T7).
//
// Generates realistic frustration sessions and POSTs them through the REAL
// collector endpoint (POST {url}/api/collect, content-type text/plain) so the
// dashboard demos convincingly out of the box. Zero runtime dependencies:
// Node built-ins only (global fetch, node:util). ESM.
//
// Usage:
//   node tools/generate-sessions.js [--sessions 40] [--url http://localhost:8639]
//                                   [--seed 42] [--verify]
//
// A seed makes generation fully deterministic: the same seed produces byte-for
// -byte identical sessions and events (only network timing differs). The
// collector rate-limits each IP to 60 requests/minute, so POSTs are sent
// sequentially and transparently retried on HTTP 429.

import { parseArgs } from 'node:util';

// --------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) + small helper surface.
// --------------------------------------------------------------------------
function mulberry32(a) {
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRng(seed) {
  const next = mulberry32(seed >>> 0);
  const rng = {
    next,
    // Uniform float in [min, max).
    float(min, max) {
      return min + (max - min) * next();
    },
    // Uniform integer in [min, max] inclusive.
    int(min, max) {
      return Math.floor(min + (max - min + 1) * next());
    },
    // Coin flip that returns true with probability p.
    bool(p) {
      return next() < p;
    },
    // Uniform pick from a non-empty array.
    pick(arr) {
      return arr[Math.floor(next() * arr.length)];
    },
    // Standard-normal sample (Box–Muller). Consumes two draws.
    gauss() {
      let u = 0;
      let v = 0;
      while (u === 0) u = next();
      while (v === 0) v = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
  };
  return rng;
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const round1 = (n) => Math.round(n * 10) / 10;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --------------------------------------------------------------------------
// Demo pages & trap boxes (1280x720 viewport, page-top-left origin).
// dead/rage traps carry click boxes {x,y,w,h}; form/correction are selectors.
// --------------------------------------------------------------------------
const TRAPS = {
  '/demo/index.html': {
    dh: 1600,
    dead: [
      { sel: '#hero-banner', x: 96, y: 622, w: 1072, h: 96 },
      { sel: '#learn-more-text', x: 96, y: 397, w: 526, h: 55 },
    ],
    rage: [{ sel: '#get-started', x: 96, y: 480, w: 172, h: 53 }],
  },
  '/demo/pricing.html': {
    dh: 1400,
    dead: [
      { sel: '#plan-basic', x: 96, y: 384, w: 341, h: 323 },
      { sel: '#plan-pro', x: 462, y: 384, w: 341, h: 398 },
      { sel: '#plan-enterprise', x: 827, y: 384, w: 341, h: 358 },
    ],
    rage: [],
  },
  '/demo/signup.html': {
    dh: 1200,
    dead: null,
    rage: [{ sel: '#signup-submit', x: 739, y: 623, w: 420, h: 49 }],
    form: '#signup-form',
    correction: '#username',
  },
};

// A gaussian-ish click inside a trap box (desktop coordinate space).
function jitterPoint(rng, box) {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const x = clamp(cx + rng.gauss() * (box.w / 5), box.x + 2, box.x + box.w - 2);
  const y = clamp(cy + rng.gauss() * (box.h / 5), box.y + 2, box.y + box.h - 2);
  return { x, y };
}

// Per-page-view clock: monotonically increasing ms-since-page-load stamps.
function makePacer(rng) {
  let t = rng.int(800, 6000);
  return {
    stamp() {
      const cur = t;
      t += rng.int(1200, 9000);
      return cur;
    },
  };
}

// --------------------------------------------------------------------------
// Event constructors (desktop coordinate space; mobile transform applied later).
// --------------------------------------------------------------------------
function deadClick(rng, box, pacer) {
  const { x, y } = jitterPoint(rng, box);
  return { t: 'dead', ts: pacer.stamp(), x, y, sel: box.sel };
}

function rageBurst(rng, box, pacer, nLo, nHi) {
  const { x, y } = jitterPoint(rng, box);
  return { t: 'rage', ts: pacer.stamp(), x, y, sel: box.sel, n: rng.int(nLo, nHi) };
}

function submitRage(rng, box, pacer) {
  const { x, y } = jitterPoint(rng, box);
  return { t: 'rage', ts: pacer.stamp(), x, y, sel: box.sel, n: rng.int(3, 7) };
}

function formaband(rng, pacer) {
  return {
    t: 'formaband',
    ts: pacer.stamp(),
    sel: TRAPS['/demo/signup.html'].form,
    n: rng.int(2, 4), // engaged fields
    m: { last: '#username', dwell: rng.int(600, 4500) },
  };
}

function correctionEv(rng, pacer) {
  // Fire rule is D >= 8 and D >= 0.5 * I, i.e. I <= 2D. Keep insertions in
  // [D, 2D] so it stays realistic (typed more than deleted) and rule-consistent.
  const d = rng.int(8, 25);
  const i = rng.int(d, 2 * d);
  return {
    t: 'correction',
    ts: pacer.stamp(),
    sel: TRAPS['/demo/signup.html'].correction,
    n: d, // deletions
    m: { i },
  };
}

// --------------------------------------------------------------------------
// Personas — each returns an array of { page, events } in desktop space.
// Every persona guarantees at least one event so the session is recorded.
// --------------------------------------------------------------------------
function pagesCalm(rng) {
  const pvs = [];
  const route = ['/demo/index.html', '/demo/pricing.html', '/demo/signup.html'];
  const nPages = rng.int(2, 3);
  for (let i = 0; i < nPages; i++) {
    const page = route[i];
    const pacer = makePacer(rng);
    const events = [];
    const traps = TRAPS[page];
    if (traps.dead && rng.bool(0.8)) {
      // A calm visitor still trips over a trap or two while browsing.
      const clicks = rng.int(1, 3);
      const box = rng.pick(traps.dead);
      for (let c = 0; c < clicks; c++) events.push(deadClick(rng, box, pacer));
    }
    if (page === '/demo/signup.html' && rng.bool(0.3)) {
      events.push(formaband(rng, pacer));
    }
    if (events.length) pvs.push({ page, events });
  }
  // Guarantee a signal so the session posts at least one batch.
  if (pvs.length === 0) {
    const pacer = makePacer(rng);
    pvs.push({ page: '/demo/index.html', events: [deadClick(rng, TRAPS['/demo/index.html'].dead[0], pacer)] });
  }
  return pvs;
}

function pagesConfused(rng) {
  const pvs = [];
  const route = rng.bool(0.6)
    ? ['/demo/index.html', '/demo/pricing.html', '/demo/signup.html']
    : ['/demo/index.html', '/demo/pricing.html'];
  for (const page of route) {
    const pacer = makePacer(rng);
    const events = [];
    const traps = TRAPS[page];
    if (traps.dead) {
      for (const box of traps.dead) {
        if (rng.bool(0.85)) {
          const clicks = rng.int(2, 5);
          for (let c = 0; c < clicks; c++) events.push(deadClick(rng, box, pacer));
        }
      }
    }
    if (traps.rage.length && rng.bool(0.45)) {
      events.push(rageBurst(rng, traps.rage[0], pacer, 3, 6));
    }
    if (page === '/demo/signup.html') {
      if (rng.bool(0.65)) events.push(formaband(rng, pacer));
      if (rng.bool(0.55)) events.push(correctionEv(rng, pacer));
    }
    if (events.length) pvs.push({ page, events });
  }
  if (pvs.length === 0) {
    const pacer = makePacer(rng);
    pvs.push({ page: '/demo/pricing.html', events: [deadClick(rng, TRAPS['/demo/pricing.html'].dead[0], pacer)] });
  }
  return pvs;
}

function pagesRager(rng) {
  const pvs = [];
  // Lands on index and rages on #get-started.
  {
    const page = '/demo/index.html';
    const pacer = makePacer(rng);
    const events = [];
    const traps = TRAPS[page];
    const bursts = rng.int(2, 4);
    for (let b = 0; b < bursts; b++) events.push(rageBurst(rng, traps.rage[0], pacer, 3, 8));
    for (const box of traps.dead) {
      if (rng.bool(0.7)) {
        const c = rng.int(1, 3);
        for (let i = 0; i < c; i++) events.push(deadClick(rng, box, pacer));
      }
    }
    pvs.push({ page, events });
  }
  // Sometimes proceeds to signup and rages on the submit button.
  if (rng.bool(0.6)) {
    const page = '/demo/signup.html';
    const pacer = makePacer(rng);
    const events = [];
    const traps = TRAPS[page];
    if (rng.bool(0.5)) events.push(correctionEv(rng, pacer));
    if (rng.bool(0.4)) events.push(formaband(rng, pacer));
    const sr = rng.int(1, 2);
    for (let i = 0; i < sr; i++) events.push(submitRage(rng, traps.rage[0], pacer));
    pvs.push({ page, events });
  }
  return pvs;
}

function pagesFormFighter(rng) {
  const pvs = [];
  // Often browses a marketing page first.
  if (rng.bool(0.6)) {
    const page = rng.bool(0.5) ? '/demo/index.html' : '/demo/pricing.html';
    const pacer = makePacer(rng);
    const events = [];
    for (const box of TRAPS[page].dead) {
      if (rng.bool(0.6)) {
        const c = rng.int(1, 3);
        for (let i = 0; i < c; i++) events.push(deadClick(rng, box, pacer));
      }
    }
    if (events.length) pvs.push({ page, events });
  }
  // Fights the signup form.
  {
    const page = '/demo/signup.html';
    const pacer = makePacer(rng);
    const events = [];
    const traps = TRAPS[page];
    const corr = rng.int(1, 3);
    for (let i = 0; i < corr; i++) events.push(correctionEv(rng, pacer));
    events.push(formaband(rng, pacer));
    if (rng.bool(0.7)) {
      const rb = rng.int(1, 2);
      for (let i = 0; i < rb; i++) events.push(submitRage(rng, traps.rage[0], pacer));
    }
    pvs.push({ page, events });
  }
  return pvs;
}

// Weighted persona pick: calm 30%, confused 30%, rager 20%, form-fighter 20%.
function pickPersona(rng) {
  const r = rng.next();
  if (r < 0.3) return 'calm';
  if (r < 0.6) return 'confused';
  if (r < 0.8) return 'rager';
  return 'form-fighter';
}

const PERSONA_PAGES = {
  calm: pagesCalm,
  confused: pagesConfused,
  rager: pagesRager,
  'form-fighter': pagesFormFighter,
};

function makeSid(rng) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const len = rng.int(10, 14);
  let s = 's_';
  for (let i = 0; i < len; i++) s += chars[rng.int(0, chars.length - 1)];
  return s;
}

// Apply the shared envelope (vw/vh/dw/dh) and, for mobile, transform click
// coordinates. Events are sorted by ts ascending as required by the wire rules.
function finalizePageView(pv, mobile) {
  const dhDesktop = TRAPS[pv.page].dh;
  const env = mobile
    ? { vw: 375, vh: 812, dw: 375, dh: Math.round(dhDesktop * 1.4) }
    : { vw: 1280, vh: 720, dw: 1280, dh: dhDesktop };

  const events = pv.events
    .map((e) => {
      const out = { t: e.t, ts: e.ts, sel: e.sel };
      if (e.x !== undefined) {
        // rage/dead carry a click point; formaband/correction do not.
        let x = e.x;
        let y = e.y;
        if (mobile) {
          x = (x * 375) / 1280; // scale x proportionally
          y = y * 1.4; // layout stacks vertically on mobile
        }
        out.x = round1(clamp(x, 0, env.dw));
        out.y = round1(clamp(y, 0, env.dh));
      }
      if (e.n !== undefined) out.n = e.n;
      if (e.m !== undefined) out.m = e.m;
      return out;
    })
    .sort((a, b) => a.ts - b.ts);

  return { page: pv.page, ...env, events };
}

function buildSession(rng) {
  const sid = makeSid(rng);
  const persona = pickPersona(rng);
  const mobile = rng.bool(0.28);
  const rawPages = PERSONA_PAGES[persona](rng);
  return { sid, persona, mobile, rawPages };
}

// Deterministic volume floor: if the persona mix produced fewer than minTotal
// events, append extra plausible dead clicks on trap elements across existing
// sessions' page views, drawn from the SAME seeded PRNG stream. Extra clicks
// keep ts ascending within their page view; batching later splits any page
// view that grows past the 50-event wire limit.
function topUpEvents(rng, sessionsArr, minTotal) {
  let total = 0;
  for (const s of sessionsArr) {
    for (const pv of s.rawPages) total += pv.events.length;
  }
  if (total >= minTotal) return;

  // Candidate page views: those on pages that have dead-click trap boxes.
  const candidates = [];
  for (const s of sessionsArr) {
    for (const pv of s.rawPages) {
      if (TRAPS[pv.page].dead) candidates.push(pv);
    }
  }
  if (candidates.length === 0) {
    // Degenerate mix (e.g. every page view is signup-only): give the first
    // session an index page view to absorb the top-up clicks.
    const pacer = makePacer(rng);
    const pv = {
      page: '/demo/index.html',
      events: [deadClick(rng, TRAPS['/demo/index.html'].dead[0], pacer)],
    };
    sessionsArr[0].rawPages.push(pv);
    candidates.push(pv);
    total += 1;
  }

  while (total < minTotal) {
    const pv = rng.pick(candidates);
    const box = rng.pick(TRAPS[pv.page].dead);
    let last = 0;
    for (const e of pv.events) if (e.ts > last) last = e.ts;
    const { x, y } = jitterPoint(rng, box);
    pv.events.push({ t: 'dead', ts: last + rng.int(1200, 9000), x, y, sel: box.sel });
    total += 1;
  }
}

// --------------------------------------------------------------------------
// Networking: POST one batch, retrying transparently on 429 (rate limit) and
// transient network errors. Resolves true on a 204, false otherwise.
// --------------------------------------------------------------------------
async function postBatch(url, batch) {
  const body = JSON.stringify(batch);
  const endpoint = `${url}/api/collect`;
  const MAX_ATTEMPTS = 30;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let res;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body,
      });
    } catch {
      await sleep(300); // transient network hiccup; retry
      continue;
    }
    if (res.status === 204) return true;
    // Drain the body so the connection can be reused.
    await res.text().catch(() => {});
    if (res.status === 429) {
      await sleep(1100); // bucket refills at ~1 token/sec
      continue;
    }
    return false; // 4xx/5xx that will not fix itself
  }
  return false;
}

// --------------------------------------------------------------------------
// --verify: fetch read endpoints and assert the seeded corpus is demo-ready.
// Read endpoints are built by a parallel task; a 404 means "not ready yet".
// --------------------------------------------------------------------------
function toArray(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    for (const key of ['pages', 'points', 'hotspots', 'cells', 'rows', 'items', 'data', 'results']) {
      if (Array.isArray(data[key])) return data[key];
    }
  }
  return [];
}

function pageOf(x) {
  if (typeof x === 'string') return x;
  if (x && typeof x === 'object') return x.page || x.path || x.url || x.name || null;
  return null;
}

function selOf(x) {
  if (typeof x === 'string') return x;
  if (x && typeof x === 'object') return x.selector || x.sel || x.el || null;
  return null;
}

async function runVerify(url, counters, sessions) {
  const endpoints = {
    pages: `${url}/api/pages`,
    heatmap: `${url}/api/heatmap?page=/demo/index.html`,
    hotspots: `${url}/api/hotspots?page=/demo/index.html`,
  };

  const data = {};
  for (const [key, u] of Object.entries(endpoints)) {
    let res;
    try {
      res = await fetch(u);
    } catch (err) {
      console.error(`verify: could not reach ${u}: ${err.message}`);
      process.exitCode = 2;
      return;
    }
    if (res.status === 404) {
      console.log('verify endpoints not yet available');
      process.exitCode = 2;
      return;
    }
    try {
      data[key] = await res.json();
    } catch {
      data[key] = null;
    }
  }

  const need = Math.ceil(7.5 * sessions);
  const arrPages = toArray(data.pages);
  const firstPage = pageOf(arrPages[0]);
  const hotspotSels = new Set(toArray(data.hotspots).map(selOf).filter(Boolean));

  const checks = [
    ['posts', counters.failures === 0, `${counters.failures} failed POSTs`],
    [
      'volume',
      counters.sessionsPosted >= sessions && counters.eventsPosted >= need,
      `${counters.sessionsPosted} sessions / ${counters.eventsPosted} events (need >=${sessions} / >=${need})`,
    ],
    [
      'pages-ranking',
      firstPage === '/demo/signup.html' || firstPage === '/demo/index.html',
      `top page = ${firstPage}`,
    ],
    ['heatmap', data.heatmap != null, `heatmap returned ${toArray(data.heatmap).length} points`],
    ['hotspots-selectors', hotspotSels.size >= 3, `${hotspotSels.size} distinct selectors`],
  ];

  let allPass = true;
  for (const [name, pass, detail] of checks) {
    console.log(`${pass ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
    if (!pass) allPass = false;
  }
  // Set exitCode rather than calling process.exit(): a hard exit right after
  // in-flight fetch handles close can trip a libuv assertion on Windows.
  process.exitCode = allPass ? 0 : 1;
}

// --------------------------------------------------------------------------
// Main.
// --------------------------------------------------------------------------
async function main() {
  const { values } = parseArgs({
    options: {
      sessions: { type: 'string', default: '40' },
      url: { type: 'string', default: 'http://localhost:8639' },
      seed: { type: 'string', default: '42' },
      verify: { type: 'boolean', default: false },
    },
  });

  const sessions = Number.parseInt(values.sessions, 10);
  const seed = Number.parseInt(values.seed, 10);
  const url = values.url.replace(/\/+$/, '');
  if (!Number.isInteger(sessions) || sessions < 1) {
    console.error('--sessions must be a positive integer');
    process.exit(2);
  }
  if (!Number.isInteger(seed)) {
    console.error('--seed must be an integer');
    process.exit(2);
  }

  const rng = makeRng(seed);

  // Generate everything up front so generation is independent of network I/O
  // and therefore perfectly deterministic for a given seed.
  const allSessions = [];
  for (let i = 0; i < sessions; i++) allSessions.push(buildSession(rng));

  // Guarantee the demo volume floor (avg >= 7.5 events/session) for ANY seed,
  // then apply per-session envelopes (viewport + mobile coordinate transform).
  topUpEvents(rng, allSessions, Math.ceil(7.5 * sessions));
  for (const s of allSessions) {
    s.pageViews = s.rawPages.map((pv) => finalizePageView(pv, s.mobile));
  }

  const counters = {
    sessionsPosted: 0,
    eventsPosted: 0,
    batches: 0,
    failures: 0,
    byType: { rage: 0, dead: 0, formaband: 0, correction: 0 },
  };

  for (const s of allSessions) {
    let anyOk = false;
    for (const pv of s.pageViews) {
      // Split into <=50-event batches; one batch per (session, page) chunk.
      for (let off = 0; off < pv.events.length; off += 50) {
        const chunk = pv.events.slice(off, off + 50);
        const batch = {
          v: 1,
          sid: s.sid,
          page: pv.page,
          vw: pv.vw,
          vh: pv.vh,
          dw: pv.dw,
          dh: pv.dh,
          events: chunk,
        };
        counters.batches++;
        const ok = await postBatch(url, batch);
        if (ok) {
          anyOk = true;
          counters.eventsPosted += chunk.length;
          for (const e of chunk) counters.byType[e.t]++;
        } else {
          counters.failures++;
        }
      }
    }
    if (anyOk) counters.sessionsPosted++;
  }

  const b = counters.byType;
  console.log(
    `seeded ${counters.sessionsPosted}/${allSessions.length} sessions, ` +
      `${counters.eventsPosted} events posted ` +
      `(rage=${b.rage} dead=${b.dead} formaband=${b.formaband} correction=${b.correction}) ` +
      `across ${counters.batches} batches, failures=${counters.failures}`,
  );

  if (values.verify) {
    await runVerify(url, counters, sessions); // sets process.exitCode
    return;
  }

  process.exitCode = counters.failures > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
