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

    // The update check runs on this object's own alarm clock, so it needs no cron trigger and
    // no extra token permission: once a minute after the first boot (to have something to show
    // quickly) and hourly from then on.
    ctx.blockConcurrencyWhile(async () => {
      try {
        if ((await ctx.storage.getAlarm()) === null) {
          await ctx.storage.setAlarm(Date.now() + 60 * 1000);
        }
      } catch (error) {
        console.log('[ALARM] could not schedule the update check:', error?.message || error);
      }
    });
  }

  /**
   * Hourly: refresh the update check (the route caches its own result for an hour, so GitHub is
   * asked at most once an hour) and keep this object warm.
   */
  async alarm() {
    let nextDelayMs = 60 * 60 * 1000;
    try {
      const res = await this.fetch(new Request('https://jb-router.internal/api/version', {
        headers: { 'x-jb-alarm': '1' },
      }));
      const status = await res.json().catch(() => null);
      if (status?.hasUpdate) {
        console.log(`[ALARM] update available: v${status.latestVersion} (running v${status.currentVersion})`);
      }
      if (!status?.checkedAt) nextDelayMs = 10 * 60 * 1000; // the check did not go through: retry in 10 minutes
    } catch (error) {
      console.log('[ALARM] update check failed:', error?.message || error);
      nextDelayMs = 10 * 60 * 1000;
    } finally {
      try {
        await this.ctx.storage.setAlarm(Date.now() + nextDelayMs);
      } catch (error) {
        console.log('[ALARM] could not reschedule:', error?.message || error);
      }
    }
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
   *
   * Two jobs, both cheap:
   *  - warm the singleton DO so the first request after an idle period skips the cold start,
   *  - refresh the update check once an hour (`/api/version` caches its own result for an hour
   *    and calls GitHub only then), so the panel can tell the visitor that a newer release
   *    exists even when nobody has opened it since the last release.
   */
  async scheduled(_controller, env, ctx) {
    const run = async () => {
      const primary = env.ROUTER_DATABASE.getByName('jb-router-primary');
      await primary.fetch('https://jb-router.internal/api/health', { method: 'GET' });
      const status = await primary
        .fetch('https://jb-router.internal/api/version', { method: 'GET', headers: { 'x-jb-cron': '1' } })
        .then((res) => res.json())
        .catch(() => null);
      if (status?.hasUpdate) {
        console.log(`[CRON] update available: v${status.latestVersion} (running v${status.currentVersion})`);
      }
    };
    const job = run().catch((error) => console.log('[CRON] skipped:', error?.message || error));
    if (ctx?.waitUntil) ctx.waitUntil(job);
    else await job;
  },
};
