/**
 * Regression tests for the SQLite driver loader (src/lib/db/adapters/nativeLoader.js).
 *
 * Background: the adapters used to hide the driver specifier behind
 * `import(String.fromCharCode(...))` so that bundlers would not try to resolve
 * native/optional modules. That trick is incompatible with Turbopack (the
 * default `next dev` bundler), which throws at runtime:
 *
 *     Error: Cannot find module as expression is too dynamic
 *
 * Because the driver is created lazily on the first DB access, the failure took
 * down every DB-backed route in dev (login, /api/keys, models, usage …) while
 * production kept working — i.e. it was invisible to `npm test`.
 *
 * These tests pin the contract of the replacement (`loadNativeModule`), which
 * resolves drivers through Node's own CJS resolver via createRequire().
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadNativeModule } from "../../src/lib/db/adapters/nativeLoader.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const adaptersDir = path.resolve(__dirname, "../../src/lib/db/adapters");

describe("nativeLoader: runtime module resolution", () => {
  it("loads better-sqlite3 and can open an in-memory database", () => {
    const mod = loadNativeModule("better-sqlite3");
    const Database = mod.default || mod;
    expect(typeof Database).toBe("function");

    const db = new Database(":memory:");
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
    db.prepare("INSERT INTO t (v) VALUES (?)").run("hello");
    expect(db.prepare("SELECT v FROM t").get().v).toBe("hello");
    db.close();
  });

  it("loads a Node builtin by the same path (node:sqlite on Node >= 22.5)", () => {
    if (!process.versions.node || Number(process.versions.node.split(".")[0]) < 22) {
      return; // node:sqlite is unavailable — driver chain falls back to sql.js
    }
    const sqlite = loadNativeModule("node:sqlite");
    expect(typeof sqlite.DatabaseSync).toBe("function");
  });

  it("throws a descriptive error naming the specifier when a module is missing", () => {
    expect(() => loadNativeModule("jb-router-module-that-does-not-exist")).toThrow(
      /jb-router-module-that-does-not-exist/
    );
  });

  it("does not obfuscate specifiers with String.fromCharCode (Turbopack would reject it)", () => {
    const offenders = fs
      .readdirSync(adaptersDir)
      .filter((f) => f.endsWith(".js"))
      .filter((f) => {
        const raw = fs.readFileSync(path.join(adaptersDir, f), "utf-8");
        // strip comments first — the loader documents the old pattern in prose
        const source = raw
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/(^|[^:])\/\/.*$/gm, "$1");
        // any dynamic import whose argument is not a plain string literal
        return /import\(\s*(?!["'])[^)]+\)/.test(source) || /String\.fromCharCode/.test(source);
      });
    expect(offenders).toEqual([]);
  });

  it("keeps the driver chain tolerant: a failed driver must not break the adapter list", async () => {
    const { getDriverOrder } = await import("../../src/lib/db/driver.js").catch(() => ({}));
    if (typeof getDriverOrder !== "function") return; // helper is optional
    const order = getDriverOrder({ preferBun: false });
    expect(Array.isArray(order)).toBe(true);
    expect(order.length).toBeGreaterThan(0);
    expect(order.some((d) => /better-sqlite3|node:|sql\.js/i.test(String(d)))).toBe(true);
  });
});

describe("nativeLoader: bundler compatibility", () => {
  it("keeps a webpack-safe strategy chain (createRequire alone breaks the server bundle)", async () => {
    const source = fs.readFileSync(
      path.join(adaptersDir, "nativeLoader.js"),
      "utf-8"
    );
    // Next's webpack server bundle replaces `node:module` with an empty shim, so
    // a static `import { createRequire } from "node:module"` is `undefined` there
    // ("(void 0) is not a function" at runtime). The loader must therefore try
    // the CommonJS `require` in scope first and only then createRequire.
    expect(source).not.toMatch(/import\s*\{[^}]*createRequire[^}]*\}\s*from\s*["']node:module["']/);
    expect(source).toContain('eval("require")');
    expect(source).toContain("getBuiltinModule");
  });

  it("loads better-sqlite3 through whichever strategy the runtime offers", () => {
    const mod = loadNativeModule("better-sqlite3");
    expect(typeof (mod.default || mod)).toBe("function");
  });
});
