import { DurableObject } from 'cloudflare:workers';
import { AsyncLocalStorage } from 'node:async_hooks';

// Only this context accessor is isolate-global, never storage or an adapter.
// A named object can be evicted/recreated while the module cache survives.
const databaseScope = new AsyncLocalStorage();
Object.defineProperty(globalThis, Symbol.for('jb-router.durable-context'), {
  get: () => databaseScope.getStore(),
});
import nextWorker from './.open-next/worker.js';
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from './.open-next/worker.js';

// Persistent storage: RouterDatabase / jb-router-primary. Do not rename on redeploy.
// A single named object owns this installation and its SQLite database.
// Dynamic requests execute here so the original synchronous repositories use
// real, durable SQLite transactions, not an in-memory SQL imitation.
export class RouterDatabase extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // Adapter and initialization promise belong to THIS object incarnation.
    this.databaseState = {
      storage: ctx.storage,
      // In-process dispatch for dashboard probes: normal auth middleware still
      // runs, but no localhost network fetch or Durable Object self-RPC occurs.
      internalFetch: (request) => this.fetch(request),
      instance: null,
      initPromise: null,
      logged: false,
    };
    this.runtimeContext = {
      waitUntil: (promise) => ctx.waitUntil(promise),
      passThroughOnException() {},
    };
  }
  async fetch(request) {
    return databaseScope.run(this.databaseState, () =>
      nextWorker.fetch(request, this.env, this.runtimeContext)
    );
  }
}

export default {
  async fetch(request, env) {
    return env.ROUTER_DATABASE.getByName('jb-router-primary').fetch(request);
  },
  /**
   * Cron trigger (the deployed Worker has a every-5-minutes schedule).
   * Without this handler every tick logged
   *   "Error: Handler does not export a scheduled() function".
   * Keep it a cheap no-op: it only warms the singleton DO so the first user
   * request after an idle period does not pay the cold-start cost.
   */
  async scheduled(_controller, env, ctx) {
    const warming = env.ROUTER_DATABASE.getByName('jb-router-primary')
      .fetch('https://jb-router.internal/api/health', { method: 'GET' })
      .catch((error) => console.log('[CRON] warm-up skipped:', error?.message || error));
    if (ctx?.waitUntil) ctx.waitUntil(warming);
    else await warming;
  },
};
