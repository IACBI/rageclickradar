// RageClickRadar — Playwright e2e config.
//
// Boots the real server (`npm start`) on a fixed test port with a fresh,
// per-run SQLite file so accumulated events never leak between runs. Flake
// resistance comes from API polling inside the specs (never fixed sleeps),
// so retries stay at 0.

import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

const PORT = 8670;
const BASE_URL = `http://localhost:${PORT}`;

// One fresh DB file per run — timestamped so no two runs share state. The
// server creates parent directories itself, so os.tmpdir() is enough.
const DB_PATH = path.join(os.tmpdir(), `rcr-e2e-${Date.now()}.db`);

export default defineConfig({
  testDir: __dirname,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['line']],

  use: {
    baseURL: BASE_URL,
    viewport: { width: 1280, height: 720 },
    trace: 'off',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } },
    },
  ],

  webServer: {
    command: 'npm start',
    cwd: REPO_ROOT,
    url: `${BASE_URL}/api/pages`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      PORT: String(PORT),
      DB_PATH,
    },
  },
});
