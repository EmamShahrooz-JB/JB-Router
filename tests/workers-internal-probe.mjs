// No external provider calls: a nonexistent provider must yield the router's
// normal 404, not Cloudflare 1003, deadlock or cross-actor I/O errors.
import assert from 'node:assert/strict';
const base = process.env.TEST_URL || 'http://127.0.0.1:8791';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const clients = [];
async function request(actor, path, method = 'GET', body, cookie) {
  return fetch(`${base}/__actor/${actor}${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000),
  });
}
try {
  for (const actor of ['a', 'b']) {
    const login = await request(actor, '/api/auth/login', 'POST', { password: 'local-regression-only-not-production' });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    await login.arrayBuffer();
    const created = await request(actor, '/api/keys', 'POST', { name: 'local-internal-probe-test' }, cookie);
    assert.equal(created.status, 201);
    clients.push({ actor, cookie, keyId: (await created.json()).id });
  }
  await Promise.all(clients.map(async ({ actor, cookie }) => {
    const res = await request(actor, '/api/models/test', 'POST', { model: 'unknown-provider/internal-routing-probe', kind: 'llm' }, cookie);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.status, 404);
    assert.match(body.error, /No active credentials for provider: unknown-provider/);
    assert.doesNotMatch(body.error, /1003|ActorCacheInterface/);
    console.log('PASS nested dispatch to real inference handler in actor', actor);
  }));
  const denied = await request('a', '/api/models/test', 'POST', { model: 'unknown-provider/internal-routing-probe' });
  assert.equal(denied.status, 401);
  await denied.arrayBuffer();
  console.log('PASS unauthenticated dashboard test remains protected');
} finally {
  for (const { actor, cookie, keyId } of clients) {
    const removed = await request(actor, '/api/keys/' + keyId, 'DELETE', undefined, cookie);
    assert.equal(removed.status, 200);
    await removed.arrayBuffer();
  }
}
