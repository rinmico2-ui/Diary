// Run after `npm run build` from the repository root. This starts the real
// production entrypoint with a temporary database and never uses server/.env.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const serverDir = fileURLToPath(new URL('..', import.meta.url));
const publicOrigin = 'https://diary--rinmico2.replit.app';

test('production startup and browser requests behind the deployment proxy', { timeout: 20_000 }, async (t) => {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'our-space-deployment-'));
  const child = spawn(process.execPath, ['dist/index.js'], {
    cwd: serverDir,
    env: {
      ...process.env,
      DOTENV_CONFIG_PATH: path.join(fixture, 'unused.env'),
      NODE_ENV: 'production',
      PORT: '0',
      WEB_ORIGIN: publicOrigin,
      CORS_ORIGINS: publicOrigin,
      COOKIE_SECURE: '1',
      SESSION_SECRET: randomBytes(48).toString('base64url'),
      DATABASE_PATH: path.join(fixture, 'test.db'),
      DATABASE_URL: '',
      DATABASE_AUTH_TOKEN: '',
      DATABASE_SYNC_URL: '',
      TURSO_DATABASE_URL: '',
      TURSO_AUTH_TOKEN: '',
      TURSO_SYNC_URL: '',
      STORAGE_DIR: path.join(fixture, 'storage'),
      LOG_ACCOUNTS: '0',
      SMTP_HOST: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
    // Only remove the unique directory returned by mkdtemp above.
    assert.equal(path.dirname(fixture), path.resolve(os.tmpdir()));
    assert.ok(path.basename(fixture).startsWith('our-space-deployment-'));
    await fs.rm(fixture, { recursive: true, force: true });
  });

  let logs = '';
  child.stderr.on('data', (chunk) => { logs += chunk; });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Server did not start:\n${logs}`)), 10_000);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Server exited with code ${code}:\n${logs}`));
    });
    child.stdout.on('data', (chunk) => {
      logs += chunk;
      const match = /API\s+http:\/\/localhost:(\d+)\/api/.exec(logs);
      if (match) { clearTimeout(timer); resolve(Number(match[1])); }
    });
  });
  const base = `http://127.0.0.1:${port}`;
  // Reproduce the browser's Origin header with an internal proxy hostname.
  const browserHeaders = { Origin: publicOrigin, 'X-Forwarded-Host': 'internal.replit.invalid' };
  const get = (route, headers = browserHeaders) => fetch(`${base}${route}`, {
    headers,
    signal: AbortSignal.timeout(5000),
  });

  let html;
  await t.test('homepage health check returns the built app without a session', async () => {
    const response = await get('/', {});
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/html/);
    assert.equal(response.headers.get('cache-control'), 'no-cache');
    html = await response.text();
    assert.match(html, /<div id="root"><\/div>/);
  });

  await t.test('all bundled JavaScript and CSS load with the browser Origin header', async () => {
    const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"?]+\.(?:js|css))"/g)].map((match) => match[1]);
    assert.ok(assets.some((asset) => asset.endsWith('.js')), 'HTML must reference a built script');
    assert.ok(assets.some((asset) => asset.endsWith('.css')), 'HTML must reference a stylesheet');
    for (const asset of assets) {
      const response = await get(asset);
      assert.equal(response.status, 200, asset);
      assert.match(response.headers.get('content-type'), asset.endsWith('.js') ? /javascript/ : /text\/css/);
      assert.ok((await response.arrayBuffer()).byteLength > 0, asset);
      // Static files must also work when deployment origin settings are stale.
      // This catches the old gate that returned origin_not_allowed for bundles.
      const otherOrigin = await get(asset, { ...browserHeaders, Origin: 'https://preview.replit.invalid' });
      assert.equal(otherOrigin.status, 200, `${asset} must be outside the API origin gate`);
      await otherOrigin.arrayBuffer();
    }
  });

  await t.test('client deep links return the app and missing assets stay 404', async () => {
    const deepLink = await get('/diary/deployment-check');
    assert.equal(deepLink.status, 200);
    assert.equal(await deepLink.text(), html);
    const missingAsset = await get('/assets/missing-deployment-check.js');
    assert.equal(missingAsset.status, 404);
    assert.equal((await missingAsset.json()).error.code, 'not_found');
  });

  await t.test('API accepts the production origin through the proxy', async () => {
    const response = await get('/api/health');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), publicOrigin);
    assert.equal((await response.json()).status, 'ok');
    const preflight = await fetch(`${base}/api/auth/login`, {
      method: 'OPTIONS', headers: browserHeaders, signal: AbortSignal.timeout(5000),
    });
    assert.equal(preflight.status, 204);
  });

  await t.test('API still rejects untrusted origins', async () => {
    const response = await get('/api/health', { Origin: 'https://untrusted.invalid' });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, 'origin_not_allowed');
  });

  await t.test('private API and media still require authentication', async () => {
    for (const route of ['/api/auth/me', '/media/photos/private.webp']) {
      const response = await get(route);
      assert.equal(response.status, 401, route);
      assert.equal((await response.json()).error.code, 'unauthorized');
    }
  });

  await t.test('realtime handshake accepts the production origin', async () => {
    const response = await get('/socket.io/?EIO=4&transport=polling');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), publicOrigin);
    assert.match(await response.text(), /^0\{"sid":/);
  });
});
