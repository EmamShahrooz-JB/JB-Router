// LOCAL REGRESSION FIXTURE ONLY. Never deploy this entry point.
// It exposes multiple actors and forced eviction for lifecycle regression tests.
import { RouterDatabase as ProductionRouterDatabase } from '../../cloudflare-worker.js';
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from '../../cloudflare-worker.js';

export class RouterDatabase extends ProductionRouterDatabase {
  constructor(ctx, env) {
    super(ctx, env);
    this.testIncarnation = crypto.randomUUID();
  }
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === '/__test/instance') {
      return Response.json({ incarnation: this.testIncarnation });
    }
    if (path === '/__test/evict') {
      this.ctx.abort('Intentional local lifecycle regression test');
    }
    return super.fetch(request);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const parts = url.pathname.split('/');
    if (parts[1] !== '__actor' || !['a', 'b', 'c', 'd'].includes(parts[2])) {
      return new Response('Local test fixture', { status: 404 });
    }
    const actor = parts[2];
    url.pathname = '/' + parts.slice(3).join('/');
    try {
      return await env.TEST_ACTORS.getByName(actor).fetch(new Request(url, request));
    } catch (error) {
      if (url.pathname === '/__test/evict') {
        return Response.json({ evicted: true }, { status: 503 });
      }
      throw error;
    }
  },
};
