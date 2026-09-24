import { ensureDirs, DATA_FILE } from "./paths.js";
import { getWorkerDatabaseState } from "./workerContext.js";

const isCFWorker = typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers' || typeof globalThis !== 'undefined' && !!globalThis.caches;

// Node dev hot-reload may use a process-global adapter. Workers must not:
// object eviction/recreation and multiple actors can share this module cache.
function getState() {
  if (isCFWorker) return getWorkerDatabaseState();
  return globalThis._dbAdapter ??= { instance: null, initPromise: null, logged: false };
}

async function tryBunSqlite() {
  if (isCFWorker) return null;
  // Bun runtime only — built-in, no install needed
  if (!process.versions.bun) return null;
  try {
    const { createBunSqliteAdapter } = await import("./adapters/bunSqliteAdapter.js");
    return await createBunSqliteAdapter(DATA_FILE);
  } catch (e) {
    console.warn(`[DB] bun:sqlite unavailable: ${e.message}`);
    return null;
  }
}

async function tryBetterSqlite() {
  if (isCFWorker) return null;
  // Skip on Bun — better-sqlite3 native bindings unsupported
  if (process.versions.bun) return null;
  // Skip on Node >= 24: the native addon SIGSEGVs on load there, which is a
  // process-level crash the try/catch below cannot recover from. node:sqlite covers it.
  const [nodeMajor] = process.versions.node.split(".").map(Number);
  if (nodeMajor >= 24) return null;
  try {
    const { createBetterSqliteAdapter } = await import("./adapters/betterSqliteAdapter.js");
    return createBetterSqliteAdapter(DATA_FILE);
  } catch (e) {
    console.warn(`[DB] better-sqlite3 unavailable: ${e.message}`);
    return null;
  }
}

async function tryNodeSqlite() {
  if (isCFWorker) return null;
  // Built-in since Node 22.5.0 — no install needed. Skip under Bun (no node:sqlite).
  if (process.versions.bun) return null;
  const [maj, min] = process.versions.node.split(".").map(Number);
  if (maj < 22 || (maj === 22 && min < 5)) return null;
  try {
    const { createNodeSqliteAdapter } = await import("./adapters/nodeSqliteAdapter.js");
    return await createNodeSqliteAdapter(DATA_FILE);
  } catch (e) {
    console.warn(`[DB] node:sqlite unavailable: ${e.message}`);
    return null;
  }
}

async function trySqlJs() {
  try {
    const { createSqlJsAdapter } = await import("./adapters/sqljsAdapter.js");
    return await createSqlJsAdapter(DATA_FILE);
  } catch (e) {
    console.warn(`[DB] sql.js unavailable: ${e.message}`);
    return null;
  }
}

async function initAdapter(state) {
  ensureDirs();
  if (isCFWorker) {
    const { createDurableSqliteAdapter } = await import("./adapters/durableSqliteAdapter.js");
    const adapter = createDurableSqliteAdapter(state.storage);
    const { runMigrationOnce } = await import("./migrate.js");
    await runMigrationOnce(adapter);
    if (!state.logged) {
      console.log("[DB] Driver: durable-sqlite (persistent)");
      state.logged = true;
    }
    return adapter;
  }
  // Order per runtime:
  //   Bun:  bun:sqlite → sql.js
  //   Node: better-sqlite3 → node:sqlite (≥22.5) → sql.js
  let adapter = await tryBunSqlite();
  if (!adapter) adapter = await tryBetterSqlite();
  if (!adapter) adapter = await tryNodeSqlite();
  if (!adapter) adapter = await trySqlJs();
  if (!adapter) throw new Error("[DB] No SQLite driver available (bun/better/node/sql.js all failed)");

  if (!state.logged) {
    console.log(`[DB] Driver: ${adapter.driver} | file: ${DATA_FILE}`);
    state.logged = true;
  }

  const { runMigrationOnce } = await import("./migrate.js");
  await runMigrationOnce(adapter);
  return adapter;
}

export async function getAdapter() {
  const state = getState();
  if (state.instance) return state.instance;
  if (!state.initPromise) state.initPromise = initAdapter(state).then((a) => { state.instance = a; return a; }).catch((error) => { state.initPromise = null; throw error; });
  return state.initPromise;
}

export function getAdapterSync() {
  const state = getState();
  if (!state.instance) throw new Error("[DB] adapter not initialized — await getAdapter() first");
  return state.instance;
}
