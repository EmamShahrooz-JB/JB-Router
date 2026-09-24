import { describe, expect, it, vi } from 'vitest';
import { parseAntigravityModels, resolveAntigravityModels } from '../../open-sse/services/antigravityModels.js';
const conn = { id: 'test-connection', accessToken: 'old-test-token', refreshToken: 'test-refresh', projectId: 'test-project' };
const catalog = { models: { 'gemini-test': { displayName: 'Gemini Test' }, hidden: { isInternal: true } } };
const ok = () => Response.json(catalog);
describe('Antigravity live catalog', () => {
  it('normalizes the live keyed catalog and filters internal entries', () => {
    expect(parseAntigravityModels(catalog)).toEqual([{ id: 'gemini-test', name: 'Gemini Test' }]);
  });
  it('accepts arrays, excludes malformed items and deduplicates IDs', () => {
    expect(parseAntigravityModels({ models: [null, { id: 'x', displayName: 'X' }, { id: 'x' }, {}] })).toEqual([{ id: 'x', name: 'X' }]);
  });
  it('uses the non-sandbox fetchAvailableModels endpoint and project/IDE headers', async () => {
    const fetchModels = vi.fn(async () => ok());
    const result = await resolveAntigravityModels(conn, { fetchModels });
    expect(result.models).toHaveLength(1);
    const [url, options, timeout] = fetchModels.mock.calls[0];
    expect(url).toBe('https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({ project: 'test-project' });
    expect(options.headers.Authorization).toBe('Bearer old-test-token');
    expect(options.headers['X-Client-Name']).toBe('antigravity');
    expect(timeout).toBe(15000);
  });
  it('refreshes once on 401, persists rotated credentials and retries', async () => {
    const fetchModels = vi.fn().mockResolvedValueOnce(new Response('', { status: 401 })).mockResolvedValueOnce(ok());
    const refreshCredentials = vi.fn(async () => ({ accessToken: 'new-test-token', refreshToken: 'rotated', expiresIn: 3600 }));
    const persistCredentials = vi.fn(async () => {});
    const result = await resolveAntigravityModels(conn, { fetchModels, refreshCredentials, persistCredentials });
    expect(result.models).toHaveLength(1);
    expect(refreshCredentials).toHaveBeenCalledOnce();
    expect(persistCredentials).toHaveBeenCalledWith('test-connection', { accessToken: 'new-test-token', refreshToken: 'rotated', expiresIn: 3600 });
    expect(fetchModels.mock.calls[1][1].headers.Authorization).toBe('Bearer new-test-token');
  });
  it('does not loop when a refreshed token also returns 401', async () => {
    const fetchModels = vi.fn(async () => new Response('', { status: 401 }));
    const refreshCredentials = vi.fn(async () => ({ accessToken: 'new' }));
    const result = await resolveAntigravityModels(conn, { fetchModels, refreshCredentials, persistCredentials: vi.fn() });
    expect(result.status).toBe(401);
    expect(fetchModels).toHaveBeenCalledTimes(2);
  });
  it('does not refresh or silently substitute static models on 403', async () => {
    const fetchModels = vi.fn(async () => new Response('sensitive upstream details', { status: 403 }));
    const refreshCredentials = vi.fn();
    const result = await resolveAntigravityModels(conn, { fetchModels, refreshCredentials });
    expect(result.status).toBe(403);
    expect(result.models).toBeUndefined();
    expect(result.error).not.toContain('sensitive');
    expect(refreshCredentials).not.toHaveBeenCalled();
  });
  it('returns a controlled error on network failure, without leaking credentials', async () => {
    const result = await resolveAntigravityModels(conn, { fetchModels: async () => { throw new Error('old-test-token'); } });
    expect(result.status).toBe(502);
    expect(JSON.stringify(result)).not.toContain('old-test-token');
  });
  it('does not fetch when no credentials exist', async () => {
    const fetchModels = vi.fn();
    expect((await resolveAntigravityModels({}, { fetchModels })).status).toBe(401);
    expect(fetchModels).not.toHaveBeenCalled();
  });
});
