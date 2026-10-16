import test from 'node:test';
import assert from 'node:assert';
import worker from '../worker/index.js';

function fakeKv() {
  const m = new Map();
  return {
    m,
    async put(k, v, opts) { m.set(k, { v, opts }); },
    async get(k) { return m.has(k) ? m.get(k).v : null; },
    async delete(k) { m.delete(k); },
  };
}
const ORIGIN = 'https://donkalot.github.io';
const call = (env, path, init = {}, origin = ORIGIN) =>
  worker.fetch(new Request(`https://relay.test${path}`, { ...init, headers: { ...(origin ? { Origin: origin } : {}), ...(init.headers || {}) } }), env);

test('store, fetch, delete, with a 24h TTL and CORS for the app', async () => {
  const env = { BLOBS: fakeKv() };
  const res = await call(env, '/t', { method: 'POST', body: new Uint8Array([1, 2, 3]) });
  assert.equal(res.status, 201);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  const { id } = await res.json();
  assert.match(id, /^[A-Za-z0-9_-]{22}$/);
  assert.equal(env.BLOBS.m.get(id).opts.expirationTtl, 86400);

  const got = await call(env, `/t/${id}`);
  assert.equal(got.status, 200);
  assert.deepEqual(new Uint8Array(await got.arrayBuffer()), new Uint8Array([1, 2, 3]));

  assert.equal((await call(env, `/t/${id}`, { method: 'DELETE' })).status, 204);
  assert.equal((await call(env, `/t/${id}`)).status, 404);
});

test('other origins are refused', async () => {
  const env = { BLOBS: fakeKv() };
  assert.equal((await call(env, '/t', { method: 'POST', body: 'x' }, 'https://evil.example')).status, 403);
  assert.equal((await call(env, '/t', { method: 'POST', body: 'x' }, null)).status, 403);
  assert.equal(env.BLOBS.m.size, 0);
  assert.equal((await call(env, '/t', { method: 'POST', body: 'x' }, 'http://localhost:8766')).status, 201);
});

test('preflight, empty, oversized and unknown paths', async () => {
  const env = { BLOBS: fakeKv() };
  const pre = await call(env, '/t', { method: 'OPTIONS' });
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get('Access-Control-Allow-Methods'), /DELETE/);
  assert.equal((await call(env, '/t', { method: 'POST', body: new Uint8Array(0) })).status, 400);
  assert.equal((await call(env, '/t', { method: 'POST', body: new Uint8Array(20 * 1024 * 1024 + 1) })).status, 413);
  assert.equal((await call(env, '/t/short')).status, 404);
  assert.equal((await call(env, '/')).status, 404);
  assert.equal(env.BLOBS.m.size, 0);
});
