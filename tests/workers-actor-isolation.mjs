// Run against wrangler.actors.jsonc, NEVER a production entry point.
import assert from 'node:assert/strict';
const base = process.env.TEST_URL || 'http://127.0.0.1:8791';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname), 'Local fixture only');
const actors = ['a', 'b', 'c', 'd'];
const sessions = new Map();
const records = new Map();
const name = 'jb-actor-isolation-' + crypto.randomUUID();

async function call(actor, path, method = 'GET', body) {
  const headers = {};
  if (sessions.has(actor)) headers.Cookie = sessions.get(actor);
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return fetch(`${base}/__actor/${actor}${path}`, {
    method, headers, redirect: 'manual',
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(45000),
  });
}
async function jsonOk(actor, path, method = 'GET', body, expected = 200) {
  const response = await call(actor, path, method, body);
  const text = await response.text();
  assert.equal(response.status, expected, `${actor} ${path}: ${text.slice(0, 700)}`);
  return JSON.parse(text);
}
async function checkRecord(actor) {
  const row = await jsonOk(actor, '/api/combos/' + records.get(actor));
  assert.equal(row.name, name);
  const list = await jsonOk(actor, '/api/combos');
  assert.equal(list.combos.filter((x) => x.name === name).length, 1);
  assert.equal(list.combos.find((x) => x.name === name).id, records.get(actor));
}
try {
  // Sequential first access reproduced the old ActorCacheInterface error on B.
  for (const actor of actors) {
    const login = await call(actor, '/api/auth/login', 'POST', {
      password: 'local-regression-only-not-production',
    });
    assert.equal(login.status, 200, `${actor}: ${await login.clone().text()}`);
    sessions.set(actor, login.headers.get('set-cookie').split(';')[0]);
    await login.arrayBuffer();
    assert.equal((await jsonOk(actor, '/api/auth/status')).authenticated, true);
  }
  console.log('PASS four actor initializations and authenticated sessions');
  // Same unique name, four independent SQLite databases.
  await Promise.all(actors.map(async (actor) => {
    const combo = await jsonOk(actor, '/api/combos', 'POST', { name, models: [] }, 201);
    records.set(actor, combo.id);
  }));
  assert.equal(new Set(records.values()).size, 4);
  await Promise.all(actors.map(checkRecord));
  console.log('PASS independent SQLite records (same combo name in four actors)');
  await Promise.all(Array.from({ length: 40 }, async (_, i) => {
    const actor = actors[i % actors.length];
    await jsonOk(actor, '/api/settings');
    await checkRecord(actor);
  }));
  console.log('PASS 120 concurrent database reads across four actors');
  const beforeA = await jsonOk('a', '/__test/instance');
  const beforeB = await jsonOk('b', '/__test/instance');
  await jsonOk('a', '/__test/evict', 'POST', undefined, 503);
  const afterA = await jsonOk('a', '/__test/instance');
  const afterB = await jsonOk('b', '/__test/instance');
  assert.notEqual(beforeA.incarnation, afterA.incarnation, 'Actor A was not recreated');
  assert.equal(beforeB.incarnation, afterB.incarnation, 'Actor B was unexpectedly recreated');
  await checkRecord('a');
  assert.equal((await jsonOk('a', '/api/auth/status')).authenticated, true);
  await Promise.all(actors.map(checkRecord));
  console.log('PASS forced actor recreation, durable data and existing session; B unchanged');
} finally {
  for (const [actor, id] of records) {
    await jsonOk(actor, '/api/combos/' + id, 'DELETE');
  }
}
