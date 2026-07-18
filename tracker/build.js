// RageClickRadar — tracker bundling script (esbuild API).
// Bundles tracker/src/radar.js (plus its shared/config import) into a single
// minified IIFE and enforces the hard 5120-byte size budget.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

import { CONFIG } from '../shared/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.join(__dirname, 'src', 'radar.js');
const OUTFILE = path.join(__dirname, 'dist', 'radar.min.js');
const BUDGET_BYTES = 5120;

// Keys the tracker actually uses at runtime. The bundle inlines ONLY these:
// shared/config.js stays the single source of truth (read here at build time),
// but server-only keys (ports, body caps, score weights) never ship to the
// browser. window.RadarConfig overrides keep working because the key names
// are preserved verbatim.
const TRACKER_KEYS = [
  'RAGE_MIN_CLICKS',
  'RAGE_MAX_GAP_MS',
  'RAGE_RADIUS_PX',
  'RAGE_SETTLE_MS',
  'DEAD_WAIT_MS',
  'DEAD_MAX_ANCESTORS',
  'DEAD_SCROLL_PX',
  'DEAD_DRAG_PX',
  'FORM_MIN_INPUTS',
  'FORM_BLUR_ABANDON_MS',
  'CORRECTION_MIN_DELETES',
  'CORRECTION_RATIO',
  'MAX_EVENTS_PER_PAGEVIEW',
  'BATCH_MAX_EVENTS',
  'BATCH_INTERVAL_MS',
  'SELECTOR_MAX_LEN',
];
const subset = {};
for (const k of TRACKER_KEYS) subset[k] = CONFIG[k];

// Deterministic short names for config keys: the initials of each _-separated
// word (RAGE_MIN_CLICKS -> RMC). The tracker runtime applies the same rule to
// window.RadarConfig override keys, so public override names keep working
// while the long key names never ship in the bundle. Seeded through esbuild's
// mangleCache so the bundle-side names are exactly these.
const initials = (k) =>
  k
    .split('_')
    .map((w) => w[0])
    .join('');
const mangleCache = {};
for (const k of TRACKER_KEYS) {
  const short = initials(k);
  if (Object.values(mangleCache).includes(short)) {
    throw new Error(`config key initials collide: ${k} -> ${short}`);
  }
  mangleCache[k] = short;
}

// Swap the shared config import for the tracker-only subset at bundle time.
const configSubsetPlugin = {
  name: 'config-subset',
  setup(b) {
    b.onResolve({ filter: /shared[/\\]config\.js$/ }, (args) => ({
      path: 'tracker-config-subset',
      namespace: 'cfg',
    }));
    // Keys must be emitted UNQUOTED: esbuild only mangles unquoted properties.
    b.onLoad({ filter: /.*/, namespace: 'cfg' }, () => ({
      contents: `export const CONFIG = {${TRACKER_KEYS.map((k) => `${k}:${subset[k]}`).join(',')}};`,
    }));
  },
};

// Whitelist of bundle-internal property names that are safe to mangle.
// Deliberately excluded: wire-format keys (t, ts, x, y, sel, n, m, v, sid,
// page, vw, vh, dw, dh, events), CONFIG keys (window.RadarConfig overrides
// must keep matching), and every DOM property name the tracker touches
// (target, id, add, isConnected, matches, ...).
const MANGLE = new RegExp(
  '^(' +
    [
      'onClick',
      'onReaction',
      'onFieldFocus',
      'onFieldBlur',
      'onFieldInput',
      'onSubmit',
      'onFormRemoved',
      'onHide',
      'tick',
      'interactive',
      'allowRapid',
      'isBodyOrHtml',
      'isCanvas',
      'dragged',
      'ignored',
      'formSel',
      'isSearch',
      'formFieldCount',
      'getDocSize',
      'nthOfType',
      'classes',
      'parent',
      'tag',
      'gone',
      'counts',
      'lastSel',
      'engaged',
      'emitted',
      'del',
      'ins',
      'out',
      'field',
      'kind',
      'flush',
      'enqueue',
    ].join('|') +
    // ALL-CAPS config keys (renamed to their initials via mangleCache).
    '|[A-Z][A-Z0-9_]{2,}' +
    ')$',
);

await build({
  entryPoints: [ENTRY],
  bundle: true,
  format: 'iife',
  minify: true,
  target: ['es2020'],
  mangleProps: MANGLE,
  mangleCache,
  charset: 'utf8',
  plugins: [configSubsetPlugin],
  outfile: OUTFILE,
});

const size = fs.statSync(OUTFILE).size;
process.stdout.write(`radar.min.js: ${size} bytes (budget ${BUDGET_BYTES})\n`);
if (size > BUDGET_BYTES) {
  process.stderr.write(`FAIL: bundle exceeds the ${BUDGET_BYTES}-byte budget\n`);
  process.exit(1);
}
