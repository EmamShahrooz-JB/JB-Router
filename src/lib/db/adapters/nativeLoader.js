// Runtime-only module loader for the SQLite drivers.
//
// Why this exists
// ---------------
// The drivers are optional/runtime-specific:
//   • better-sqlite3  – native addon, must never be touched by a bundler
//   • node:sqlite     – Node >= 22.5 builtin, missing on older runtimes
//   • bun:sqlite      – only resolvable under Bun
//
// A literal `import("better-sqlite3")` makes webpack/Turbopack try to bundle
// (and statically fail on) a module that may legitimately not exist for the
// current runtime. The previous workaround obfuscated the specifier with
// `String.fromCharCode(...)`, which webpack tolerates but Turbopack (the
// default `next dev` bundler since Next 15) rejects at *runtime* with:
//
//     Error: Cannot find module as expression is too dynamic
//
// Because db/driver.js calls every adapter lazily, that error surfaced on the
// very first settings/connection read in dev mode, so every DB-backed route
// (login, /api/keys, models, usage …) silently degraded to empty defaults.
//
// createRequire() hands resolution back to Node/Bun at runtime — exactly like a
// plain CJS require — so the bundler never analyses the specifier and the
// driver chain keeps working in dev, in `next build` output and under Bun.

import path from "node:path";

const LOADER_STUB = "__jb_router_native_loader__.cjs";

function candidateRequireBases() {
  const bases = [];

  // 1) Project root — correct for `next dev`, `next start` and vitest because
  //    every one of them runs with the repository/app root as cwd.
  try {
    bases.push(path.join(process.cwd(), LOADER_STUB));
  } catch {
    /* cwd unavailable – ignore */
  }

  // 2) Directory of the module as emitted by the bundler. Node resolution walks
  //    up from there, so `<app>/.next/server/chunks/x.js` still finds
  //    `<app>/node_modules`.
  try {
    const here = new URL(import.meta.url);
    if (here.protocol === "file:") {
      const dir = path.dirname(decodeURIComponent(here.pathname));
      const base = path.join(dir, LOADER_STUB);
      if (!bases.includes(base)) bases.push(base);
    }
  } catch {
    /* import.meta unavailable – ignore */
  }

  return bases;
}

/**
 * Require a runtime-only module without exposing the specifier to the bundler.
 * Throws the last resolution error when every base fails, so callers can keep
 * their existing try/catch fallback chains.
 *
 * @param {string} specifier e.g. "better-sqlite3", "node:sqlite", "bun:sqlite"
 * @returns {any} the CommonJS module namespace
 */
export function loadNativeModule(specifier) {
  const strategies = runtimeRequireStrategies();
  const errors = [];
  for (const strategy of strategies) {
    try {
      return strategy.require(specifier);
    } catch (error) {
      errors.push(error?.message || String(error));
    }
  }
  const detail = errors.length ? `: ${[...new Set(errors)].join(" | ")}` : "";
  throw new Error(`Cannot load runtime module "${specifier}"${detail}`);
}

/**
 * Node's `require` is reachable differently depending on how this file was
 * loaded, and the fallbacks matter:
 *
 *   1. Next's webpack server bundle is CommonJS, so a module function can see
 *      the file-level `require` through `eval("require")` — webpack does not
 *      rewrite the string, and the identifier resolves up the closure chain.
 *   2. Turbopack (and plain `node file.mjs`) load real ES modules where no
 *      `require` exists, but `node:module` exports a working `createRequire`.
 *
 * Importing `createRequire` statically is not enough: in the webpack server
 * bundle `node:module` is replaced by an empty shim, so the import is
 * `undefined` and calling it throws "(void 0) is not a function".
 */
function runtimeRequireStrategies() {
  const strategies = [];

  strategies.push({
    name: "eval-require",
    require: (specifier) => {
      const req = eval("require"); // eslint-disable-line no-eval
      if (typeof req !== "function") throw new Error("no CommonJS require in scope");
      return req(specifier);
    },
  });

  for (const base of candidateRequireBases()) {
    strategies.push({
      name: `createRequire:${base}`,
      require: (specifier) => {
        // Loaded lazily so a shimmed module in a bundle cannot break the others.
        const { createRequire } = nodeModule();
        if (typeof createRequire !== "function") throw new Error("createRequire unavailable");
        return createRequire(base)(specifier);
      },
    });
  }

  return strategies;
}

// `node:module` is only touched lazily; see runtimeRequireStrategies().
let cachedNodeModule = null;
function nodeModule() {
  if (cachedNodeModule) return cachedNodeModule;
  const mod = globalThis.process?.getBuiltinModule?.("node:module");
  if (mod) {
    cachedNodeModule = mod;
    return mod;
  }
  throw new Error("node:module is not available");
}

export default loadNativeModule;
