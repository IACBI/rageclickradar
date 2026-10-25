// RageClickRadar — one-command demo launcher (Task T13).
//
// `npm run demo` should, from a clean checkout, Just Work:
//   1. Build the tracker bundle if it is missing.
//   2. Start the server on PORT (default 8639) against a dedicated demo DB.
//   3. Wait for the server to answer, then seed synthetic sessions if empty.
//   4. Print a clean summary and keep running until Ctrl+C.
//
// Zero runtime dependencies: Node built-ins only. ESM.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const PORT = Number(process.env.PORT) || 8639;
const DB_PATH = process.env.DB_PATH || './data/demo.db';
const BASE_URL = `http://127.0.0.1:${PORT}`;

const TRACKER_BUNDLE = path.join(ROOT, 'tracker', 'dist', 'radar.min.js');
const BUILD_SCRIPT = path.join(ROOT, 'tracker', 'build.js');
const SERVER_ENTRY = path.join(ROOT, 'server', 'index.js');
const SEEDER = path.join(ROOT, 'tools', 'generate-sessions.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --------------------------------------------------------------------------
// Step 1 — build the tracker bundle if it is not already present.
// --------------------------------------------------------------------------
function ensureTracker() {
  if (fs.existsSync(TRACKER_BUNDLE)) {
    console.log(`[demo] tracker bundle present, skipping build (${TRACKER_BUNDLE})`);
    return;
  }
  console.log('[demo] tracker bundle missing, building it...');
  const res = spawnSync(process.execPath, [BUILD_SCRIPT], { cwd: ROOT, stdio: 'inherit' });
  if (res.error) {
    console.error(`[demo] failed to launch the tracker build: ${res.error.message}`);
    process.exit(1);
  }
  if (res.status !== 0) {
    console.error(`[demo] tracker build failed (exit ${res.status}). Aborting.`);
    process.exit(1);
  }
  if (!fs.existsSync(TRACKER_BUNDLE)) {
    console.error('[demo] tracker build reported success but the bundle is still missing. Aborting.');
    process.exit(1);
  }
  console.log('[demo] tracker built.');
}

// --------------------------------------------------------------------------
// Step 2 — start the server as a child process.
// --------------------------------------------------------------------------
function startServer() {
  const env = { ...process.env, PORT: String(PORT), DB_PATH };
  // Silence the node:sqlite ExperimentalWarning noise in the child. The typed
  // form of --no-warnings is supported on the Node versions this project
  // targets (>=22.5); if a future Node rejects it the child simply prints the
  // warning, which is harmless.
  const child = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', SERVER_ENTRY], {
    cwd: ROOT,
    env,
    stdio: 'inherit',
  });
  child.on('error', (err) => {
    console.error(`[demo] failed to start the server: ${err.message}`);
    process.exit(1);
  });
  return child;
}

// --------------------------------------------------------------------------
// Step 3 — wait until /api/pages answers (server is up and routing).
// --------------------------------------------------------------------------
async function waitForServer(timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/api/pages`);
      if (res.ok) {
        return await res.json();
      }
    } catch {
      // not up yet
    }
    await sleep(200);
  }
  throw new Error(`server did not respond at ${BASE_URL}/api/pages within ${timeoutMs} ms`);
}

// --------------------------------------------------------------------------
// Step 4 — seed synthetic sessions if the demo DB has no data yet.
// --------------------------------------------------------------------------
function seedIfEmpty(pages) {
  const isEmpty = Array.isArray(pages) && pages.length === 0;
  if (!isEmpty) {
    console.log(`[demo] demo database already has ${pages.length} page(s), skipping seed.`);
    return;
  }
  console.log('[demo] demo database is empty, seeding 40 synthetic sessions...');
  const res = spawnSync(
    process.execPath,
    [SEEDER, '--sessions', '40', '--seed', '42', '--url', BASE_URL],
    { cwd: ROOT, stdio: 'inherit' },
  );
  if (res.error) {
    console.warn(`[demo] WARNING: could not launch the seeder: ${res.error.message}`);
    console.warn('[demo] continuing with an empty dashboard.');
    return;
  }
  if (res.status !== 0) {
    console.warn(`[demo] WARNING: the seeder exited ${res.status}. Continuing with whatever landed.`);
    return;
  }
  console.log('[demo] seeding complete.');
}

// --------------------------------------------------------------------------
// Step 5 — print a plain-ASCII summary box.
// --------------------------------------------------------------------------
function printSummary() {
  const lines = [
    'RageClickRadar demo is running',
    '',
    `Dashboard:  ${BASE_URL}/`,
    `Demo site:  ${BASE_URL}/demo/`,
    '',
    'Try it: open the demo site, rage-click the "Get Started"',
    'button a few times, then refresh the dashboard to see it.',
    '',
    'Stop: press Ctrl+C in this terminal.',
  ];
  const width = Math.max(...lines.map((l) => l.length));
  const top = '+' + '-'.repeat(width + 2) + '+';
  const out = [top];
  for (const l of lines) out.push('| ' + l.padEnd(width) + ' |');
  out.push(top);
  console.log('\n' + out.join('\n') + '\n');
}

// --------------------------------------------------------------------------
// Main.
// --------------------------------------------------------------------------
async function main() {
  ensureTracker();

  const server = startServer();

  let stopping = false;
  const stop = (signal) => {
    if (stopping) return;
    stopping = true;
    if (!server.killed) server.kill(signal === 'SIGTERM' ? 'SIGTERM' : 'SIGINT');
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));

  // If the server child dies, mirror its exit and stop the launcher too.
  server.on('exit', (code, signal) => {
    if (!stopping) {
      console.error(`[demo] server exited unexpectedly (code=${code}, signal=${signal}).`);
    }
    process.exit(code == null ? 0 : code);
  });

  let pages;
  try {
    pages = await waitForServer();
  } catch (err) {
    console.error(`[demo] ${err.message}`);
    stop('SIGTERM');
    process.exit(1);
  }

  seedIfEmpty(pages);
  printSummary();
  // Keep the process alive; the server child's 'exit' handler owns shutdown.
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
