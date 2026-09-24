// cloudflare-worker.js exposes an AsyncLocalStorage-backed getter at this symbol.
// Next's middleware/server bundles may duplicate this module; the symbol bridges
// them without ever storing a DurableObjectStorage handle in a global cache.
export function getWorkerDatabaseState() {
  const state = globalThis[Symbol.for('jb-router.durable-context')];
  if (!state?.storage) {
    throw new Error('Database access requires an active RouterDatabase request context');
  }
  return state;
}
