// RageClickRadar — startup configuration tests. A bad setting must print one
// readable line and exit 1, and the RETENTION_DAYS and PATH_REDACTION switches
// must take effect in the real server. These spawn server/index.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { openDb } from '../../server/db.js';

const SERVER = fileURLToPath(new URL('../../server/index.js', import.meta.url));
const DAY = 24 * 60 * 60 * 1000;
const SETTINGS = ['PORT', 'HOST', 'DB_PATH', 'TRUST_PROXY', 'RETENTION_DAYS', 'PATH_REDACTION'];

// Start from the parent environment without our settings, so a developer's own
// PORT or TRUST_PROXY cannot change what these tests see.
function childEnv(extra) {
  const env = { ...process.env };
  for (const k of SETTINGS) delete env[k];
  return { ...env, ...extra };
}

function runToFailure(extra) {
  return spawnSync(process.execPath, [SERVER], {
    env: childEnv({ DB_PATH: ':memory:', ...extra }),
    encoding: 'utf8',
    timeout: 15000,
  });
}

function assertFriendlyExit(res, message) {
  assert.equal(res.status, 1, `exit status; stderr: ${res.stderr}`);
  assert.ok(
    res.stderr.split(/\r?\n/).includes(`RageClickRadar: ${message}`),
    `expected line "${message}" in stderr: ${res.stderr}`,
  );
  assert.doesNotMatch(res.stderr, /\n\s+at /, 'stderr must not contain a stack trace');
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

// Boot the server on a free loopback port, run fn(baseUrl), then stop it.
async function withServer(extraEnv, fn) {
  const port = await freePort();
  const child = spawn(process.execPath, [SERVER], {
    env: childEnv({ DB_PATH: ':memory:', HOST: '127.0.0.1', PORT: String(port), ...extraEnv }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (c) => (out += c));
  child.stderr.on('data', (c) => (out += c));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start: ${out}`)), 15000);
    child.stdout.on('data', () => {
      if (out.includes('listening')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited early (${code}): ${out}`));
    });
  });
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill();
    await exited;
  }
}

function collectBody(page) {
  return JSON.stringify({
    v: 1,
    sid: 's_a1b2c3d4e5f6',
    page,
    vw: 800,
    vh: 600,
    dw: 800,
    dh: 600,
    events: [{ t: 'dead', ts: 1 }],
  });
}

// --- Friendly startup errors ----------------------------------------------

test('a malformed TRUST_PROXY exits 1 with one readable line and no stack trace', () => {
  const res = runToFailure({ TRUST_PROXY: 'proxy.internal' });
  assertFriendlyExit(res, 'TRUST_PROXY: invalid IP address "proxy.internal"');
});

test('an invalid PORT exits 1 with a readable line', () => {
  const res = runToFailure({ PORT: 'eighty' });
  assertFriendlyExit(res, 'PORT: must be an integer from 1 to 65535, got "eighty"');
});

test('an invalid RETENTION_DAYS exits 1 with a readable line', () => {
  const res = runToFailure({ RETENTION_DAYS: '90d' });
  assertFriendlyExit(res, 'RETENTION_DAYS: must be a whole number of days, got "90d"');
});

test('an unknown PATH_REDACTION value exits 1 instead of silently disabling redaction', () => {
  const res = runToFailure({ PATH_REDACTION: 'of' });
  assertFriendlyExit(res, 'PATH_REDACTION: must be "on" or "off", got "of"');
});

test('a port that is already in use exits 1 with a readable line', async () => {
  const holder = net.createServer();
  await new Promise((resolve) => holder.listen(0, '127.0.0.1', resolve));
  const { port } = holder.address();
  try {
    const res = runToFailure({ HOST: '127.0.0.1', PORT: String(port) });
    assertFriendlyExit(res, `cannot listen on 127.0.0.1:${port} (EADDRINUSE)`);
  } finally {
    await new Promise((resolve) => holder.close(resolve));
  }
});

// --- Switches take effect in the real server ------------------------------

test('RETENTION_DAYS removes old rows at startup; without it nothing is removed', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rcr-retention-'));
  const file = path.join(dir, 'radar.db');
  const now = Date.now();
  try {
    const seed = openDb(file);
    const insSession = seed.prepare(
      'INSERT INTO sessions (id, started_at, last_seen, vw, vh) VALUES (?, ?, ?, ?, ?)',
    );
    const insEvent = seed.prepare(
      'INSERT INTO events (session_id, page, type, ts, received_at) VALUES (?, ?, ?, ?, ?)',
    );
    insSession.run('s_old000000001', now - 120 * DAY, now - 120 * DAY, 800, 600);
    insEvent.run('s_old000000001', '/a', 'dead', 1, now - 120 * DAY);
    insSession.run('s_new000000001', now - DAY, now - DAY, 800, 600);
    insEvent.run('s_new000000001', '/a', 'dead', 1, now - DAY);
    seed.close();

    const counts = () => {
      const db = openDb(file);
      try {
        return {
          events: db.prepare('SELECT COUNT(*) AS c FROM events').get().c,
          sessions: db.prepare('SELECT COUNT(*) AS c FROM sessions').get().c,
        };
      } finally {
        db.close();
      }
    };

    await withServer({ DB_PATH: file }, async () => {});
    assert.deepEqual(counts(), { events: 2, sessions: 2 }, 'retention is off by default');

    await withServer({ DB_PATH: file, RETENTION_DAYS: '90' }, async () => {});
    assert.deepEqual(counts(), { events: 1, sessions: 1 }, 'the 120-day-old rows are removed');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
});

test('path redaction is on by default and PATH_REDACTION=off stores raw paths', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rcr-redact-'));
  const file = path.join(dir, 'radar.db');
  const pagesStored = () => {
    const db = openDb(file);
    try {
      return db
        .prepare('SELECT page FROM events ORDER BY id')
        .all()
        .map((r) => r.page);
    } finally {
      db.close();
    }
  };
  const post = (base) =>
    fetch(`${base}/api/collect`, { method: 'POST', body: collectBody('/users/12345') });
  try {
    await withServer({ DB_PATH: file }, async (base) => {
      assert.equal((await post(base)).status, 204);
    });
    await withServer({ DB_PATH: file, PATH_REDACTION: 'off' }, async (base) => {
      assert.equal((await post(base)).status, 204);
    });
    assert.deepEqual(pagesStored(), ['/users/:id', '/users/12345']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
});
