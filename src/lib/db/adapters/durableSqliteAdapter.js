import { getWorkerDatabaseState } from "../workerContext.js";

// Cloudflare's native SQLite is only available inside a SQLite Durable Object.
// cloudflare-worker.js places all dynamic Next requests in the same named object.
export function createDurableSqliteAdapter(storage) {
  if (!storage?.sql) throw new Error('Durable SQLite storage is not bound');
  const sql = storage.sql;
  function assertOwner() {
    if (getWorkerDatabaseState().storage !== storage) {
      throw new Error('SQLite adapter used outside its owning RouterDatabase context');
    }
  }
  const bindings = (params) => params.map((value) => {
    if (value === undefined) return null;
    if (typeof value === 'boolean') return Number(value);
    return value;
  });
  return {
    driver: 'durable-sqlite',
    run(statement, params = []) {
      assertOwner();
      sql.exec(statement, ...bindings(params)).toArray();
      const result = sql.exec('SELECT changes() AS changes, last_insert_rowid() AS lastInsertRowid').one();
      return result;
    },
    get(statement, params = []) {
      assertOwner();
      return sql.exec(statement, ...bindings(params)).toArray()[0];
    },
    all(statement, params = []) {
      assertOwner();
      return sql.exec(statement, ...bindings(params)).toArray();
    },
    exec(statement) {
      assertOwner();
      sql.exec(statement).toArray();
    },
    transaction(fn) {
      assertOwner();
      return storage.transactionSync(() => {
        const result = fn();
        if (result && typeof result.then === 'function') {
          throw new Error('SQLite transactions must be synchronous');
        }
        return result;
      });
    },
    checkpoint() {}, // Durable Objects commits and checkpoints automatically.
    close() {},
    raw: sql,
  };
}
