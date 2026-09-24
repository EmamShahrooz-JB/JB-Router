import { AsyncLocalStorage } from 'node:async_hooks';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchInternalApi } from '../../src/lib/network/internalApi.js';

const symbol = Symbol.for('jb-router.durable-context');
let als;
let originalContext;
const state = (internalFetch) => ({ storage: {}, internalFetch });
describe('Worker internal API transport (Cloudflare error 1003 regression)', () => {
  beforeEach(() => {
    als = new AsyncLocalStorage();
    originalContext = Object.getOwnPropertyDescriptor(globalThis, symbol);
    Object.defineProperty(globalThis, symbol, { configurable: true, get: () => als.getStore() });
    vi.stubGlobal('navigator', { userAgent: 'Cloudflare-Workers' });
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network fetch must not run'); }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalContext) Object.defineProperty(globalThis, symbol, originalContext);
    else delete globalThis[symbol];
  });
  it('dispatches to the active object with method, body, auth headers and path intact', async () => {
    const internalFetch = vi.fn(async request => {
      expect(request.url).toBe('https://jb-router.internal/api/v1/chat/completions');
      expect(request.method).toBe('POST');
      expect(request.headers.get('Authorization')).toBe('Bearer local-test-key');
      expect(await request.json()).toEqual({ model: 'test/model' });
      return Response.json({ choices: [] });
    });
    const res = await als.run(state(internalFetch), () => fetchInternalApi('/api/v1/chat/completions', {
      method: 'POST', headers: { Authorization: 'Bearer local-test-key', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'test/model' }),
    }, 'https://untrusted.example'));
    expect(res.status).toBe(200);
    expect(internalFetch).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('returns authentication failures unchanged rather than bypassing middleware', async () => {
    const res = await als.run(state(async () => Response.json({ error: 'Unauthorized' }, { status: 401 })),
      () => fetchInternalApi('/api/providers/test-connection/models'));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('Unauthorized');
  });
  it('resolves a separate dispatcher per concurrent actor context', async () => {
    const a = state(async () => { await Promise.resolve(); return new Response('a'); });
    const b = state(async () => { await Promise.resolve(); return new Response('b'); });
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => als.run(i % 2 ? a : b, async () =>
      (await fetchInternalApi('/api/v1/embeddings')).text())));
    expect(results).toEqual(Array.from({ length: 20 }, (_, i) => i % 2 ? 'a' : 'b'));
  });
  it('fails closed without an owning actor rather than fetching localhost', async () => {
    await expect(fetchInternalApi('/api/v1/chat/completions')).rejects.toThrow('active RouterDatabase');
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['https://example.com/api/v1/chat/completions', '//example.com', '/api/settings', '/api/providers/../models'])('rejects untrusted target %s', async path => {
    await expect(fetchInternalApi(path)).rejects.toThrow('Unsupported internal API');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps the caller deadline for an in-process request', async () => {
    const controller = new AbortController();
    const dispatch = vi.fn(async request => {
      expect(request.signal.aborted).toBe(false);
      return new Promise(() => {});
    });
    const promise = als.run(state(dispatch), () => fetchInternalApi('/api/v1/chat/completions', { signal: controller.signal }));
    const assertion = expect(promise).rejects.toThrow('test timeout');
    await Promise.resolve();
    controller.abort(new Error('test timeout'));
    await assertion;
    expect(dispatch).toHaveBeenCalledOnce();
  });
  it('does not start an already-cancelled request', async () => {
    const dispatch = vi.fn();
    const signal = AbortSignal.abort(new Error('cancelled'));
    await expect(als.run(state(dispatch), () => fetchInternalApi('/api/v1/embeddings', { signal }))).rejects.toThrow('cancelled');
    expect(dispatch).not.toHaveBeenCalled();
  });
  it('preserves normal loopback fetch on Node installations', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Node.js' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok')));
    await fetchInternalApi('/api/v1/embeddings', { method: 'POST', body: '{}' }, 'http://127.0.0.1:20127');
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:20127/api/v1/embeddings', { method: 'POST', body: '{}' });
  });
});
