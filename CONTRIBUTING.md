# Contributing to JB-Router

Thanks for helping! This project is a Cloudflare Workers port of
[9Router](https://github.com/decolua/9router); upstream parity matters, so please keep the
dashboard UI, provider registry and routing semantics intact unless the change is the point.

## Getting set up

```bash
npm install
npm install --prefix tests        # Vitest toolchain for the unit suite
npm run dev                       # Next.js dev server (fast UI iteration)
npm run workers:dev               # Worker runtime with Durable Object storage
```

## Before opening a pull request

1. **Build both targets.** `npm run build` (Next) and a Workers build
   (`npm run workers:build`, or the low-memory two-step documented in `WORKERS.md`).
2. **Run the unit tests.** `npx vitest run --root tests` (some suites need network and are
   expected to be skipped/run selectively).
3. **Run the Workers regression scripts** against a local `wrangler dev`:
   `node tests/workers-smoke.mjs`, `node tests/workers-actor-isolation.mjs`.
4. **Never commit secrets or state.** `.dev.vars`, `.wrangler/`, `.open-next/`, provider
   tokens, production URLs or dashboard passwords must not appear in the diff.
5. **Prefer additive changes to migrations.** The Durable Object database is user data;
   schema changes need a migration in `src/lib/db/migrate.js` that works on existing rows.

## Commit / PR style

- One logical change per PR, with a short description of the user-visible effect.
- For Workers-specific fixes, say what the previous behaviour was (e.g. "probe returned
  `HTTP 503` for every provider") and how you verified the new one.
- Attach real evidence (status codes, test output, log lines) rather than assumptions —
  see `WORKERS.md` for the format used so far.

## Reporting bugs

Include the deployment target (Workers or Node), the exact request/response, and whether the
problem reproduces on a fresh login. Security issues go through `SECURITY.md`, not the
public tracker.
