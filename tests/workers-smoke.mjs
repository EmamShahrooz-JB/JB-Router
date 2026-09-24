// Run: INITIAL_PASSWORD=... TEST_URL=https://... npm run workers:test
// Creates a uniquely named empty combo and deletes it in finally.
import assert from 'node:assert/strict';
const base = process.env.TEST_URL || 'http://127.0.0.1:8789';
const password = process.env.INITIAL_PASSWORD;
if (!password) throw new Error('Set INITIAL_PASSWORD to the current dashboard password');
let cookie;
async function request(path, method = 'GET', body, authenticated = true) {
  const headers = {};
  if (authenticated && cookie) headers.Cookie = cookie;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return fetch(base + path, {
    method, headers, redirect: 'manual',
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(45000),
  });
}
let comboId;
try {
  const login = await request('/api/auth/login', 'POST', { password }, false);
  assert.equal(login.status, 200, await login.clone().text());
  cookie = login.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie?.startsWith('auth_token='));
  const status = await request('/api/auth/status');
  assert.equal((await status.json()).authenticated, true);
  for (const path of ['/dashboard', '/dashboard/providers', '/api/settings', '/api/providers', '/api/provider-nodes', '/api/keys', '/api/models', '/api/combos', '/api/usage/stats']) {
    const response = await request(path);
    assert.equal(response.status, 200, `${path}: ${response.status}`);
    await response.arrayBuffer();
    console.log('PASS', path);
  }
  const denied = await request('/api/settings', 'GET', undefined, false);
  assert.equal(denied.status, 401);
  await denied.arrayBuffer();
  const name = 'jb-smoke-' + crypto.randomUUID();
  const created = await request('/api/combos', 'POST', { name, models: [] });
  assert.equal(created.status, 201, await created.clone().text());
  comboId = (await created.json()).id;
  const updated = await request('/api/combos/' + comboId, 'PUT', { models: ['openai/gpt-4o-mini'] });
  assert.equal(updated.status, 200);
  assert.deepEqual((await updated.json()).models, ['openai/gpt-4o-mini']);
  const duplicate = await request('/api/combos', 'POST', { name, models: [] });
  assert.equal(duplicate.status, 400);
  await duplicate.arrayBuffer();
  console.log('PASS authentication, protected endpoints and SQLite combo CRUD');
} finally {
  if (comboId) {
    const removed = await request('/api/combos/' + comboId, 'DELETE');
    assert.equal(removed.status, 200, 'Test combo cleanup failed');
    await removed.arrayBuffer();
  }
}
