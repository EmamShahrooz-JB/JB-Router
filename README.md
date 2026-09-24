<div align="center">

# JB-Router

**Self-hosted AI router & dashboard, running entirely on Cloudflare Workers.**

One endpoint for all your AI providers — connect Claude Code, Cursor, Codex, Cline,
Antigravity, Gemini, OpenCode, Copilot and more to 40+ providers and 100+ models,
with a full web dashboard, usage analytics, combos and durable storage.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
![Platform](https://img.shields.io/badge/platform-Cloudflare%20Workers-orange)
![Next.js](https://img.shields.io/badge/Next.js-16-black)
![Storage](https://img.shields.io/badge/storage-Durable%20Objects%20%2B%20SQLite-blue)

</div>

---

## What is JB-Router?

JB-Router is a **Cloudflare Workers port of [9Router](https://github.com/decolua/9router)** —
the same Next.js App Router application (same UI, same routing engine, same provider
registry), compiled with [OpenNext](https://opennext.js.org/cloudflare) and served from a
single Worker:

- **No server to run.** Deploy once to your own Cloudflare account — no VM, no Docker, no
  port forwarding.
- **State lives in a Durable Object.** Provider connections, API keys, settings, usage
  history and combos are stored in SQLite inside a Durable Object (`RouterDatabase`), so
  the app is durable across cold starts and deploys.
- **OpenAI-compatible gateway.** Point any client at `https://<your-worker>/v1` and talk to
  any connected provider with an API key you create in the dashboard.
- **Full dashboard.** Providers, models, combos, usage stats, request logs, quotas, CLI tool
  configuration and translation tools — all server-rendered by the Worker.

## Features

| Area | What you get |
| --- | --- |
| **Providers** | 40+ providers (Anthropic, Gemini/Antigravity, OpenAI-compatible endpoints, Copilot, Cline, Codex, NVIDIA, Cloudflare AI, and many more) with a registry-driven model catalog |
| **Gateway** | OpenAI-compatible `/v1/chat/completions`, `/v1/embeddings`, `/v1/images`, `/v1/audio`, plus native Claude and Gemini endpoints |
| **Combos** | Route a request across several models with automatic fallback, capability-aware ordering and fusion |
| **Resilience** | Per-connection model cooldowns, account fallback, retry/backoff config, structured error surfacing (`upstream_status`, `Retry-After`) |
| **Dashboard** | Providers, models, combos, keys, usage stats & charts, request details, quota views, console log, CLI tools |
| **Storage** | Durable Object SQLite, migrations included, single source of truth per deployment |
| **Security** | Password login with signed cookies, per-key API auth, `requireApiKey` gate, secure-cookie flag |

## Quick start (deploy your own)

```bash
git clone https://github.com/EmamShahrooz-JB/JB-Router.git
cd JB-Router
npm install

# 1. Authenticate Wrangler with your Cloudflare account
npx wrangler login

# 2. Set the two runtime secrets (never commit these)
npx wrangler secret put JWT_SECRET          # long random string
npx wrangler secret put INITIAL_PASSWORD    # dashboard password you will log in with

# 3. Build the Next.js app and package it for Workers
npm run workers:build

# 4. Deploy
npm run workers:deploy
```

Open `https://<your-worker>.<your-subdomain>.workers.dev/login` and log in with
`INITIAL_PASSWORD`.

Then:

1. **Providers → add a connection** (OAuth or API key) for the provider you want.
2. **Endpoint → create an API key** and copy the endpoint URL.
3. Use `https://<your-worker>.<your-subdomain>.workers.dev/v1` as the base URL in any
   OpenAI-compatible client.

> **Low-memory build hosts:** if the OpenNext bundle step is OOM-killed on a small machine,
> run the Next build first (`npm run build`), then
> `npx opennextjs-cloudflare build --skipNextBuild`, and deploy the produced `.open-next`
> artifact. `WORKERS.md` documents the exact commands used for this port.

## Local development

```bash
# .dev.vars (git-ignored) — local secrets for `wrangler dev`
JWT_SECRET=dev-secret
INITIAL_PASSWORD=dev-password

npm run workers:dev     # wrangler dev, local Durable Object + SQLite state
npm run workers:test    # smoke tests against a running instance (TEST_URL / INITIAL_PASSWORD)
```

Useful scripts:

| Script | Purpose |
| --- | --- |
| `npm run dev` | Plain Next.js dev server (no Workers runtime) |
| `npm run build` | Next.js production build |
| `npm run workers:build` | OpenNext + Wrangler build for Workers |
| `npm run workers:dev` | Local Worker with Durable Object storage |
| `npm run workers:deploy` | Deploy to your Cloudflare account |
| `npm run workers:test` | End-to-end smoke tests (auth, dashboard, API, CRUD) |
| `npm run workers:test:actors` | Durable Object isolation / concurrency regression test |

Unit tests live in `tests/unit` and run with Vitest (`npm install --prefix tests`, then
`npx vitest run --root tests`).

## Architecture

```
Browser / AI clients
        │
        ▼
 Cloudflare Worker  (cloudflare-worker.js)
        │  routes every request through one Durable Object
        ▼
 RouterDatabase DO  ──  SQLite: connections, keys, settings, usage, combos
        │  runs the OpenNext-compiled Next.js handler
        ▼
 .open-next/worker.js  ──  App Router pages, API routes, provider executors
        │
        ▼
 Provider upstreams (Anthropic, Google, OpenAI-compatible, …)
```

- **`cloudflare-worker.js`** — Worker entry point; resolves the singleton Durable Object
  (`jb-router-primary`) and dispatches requests through it.
- **`src/lib/db/adapters/durableSqliteAdapter.js`** — the durable-SQLite driver used in the
  Worker; the Durable Object owns the database actor-locally.
- **`src/lib/network/internalApi.js`** — internal request transport used by dashboard probes
  (in-process dispatch on Workers, loopback on Node).
- **`open-sse/`** — provider registry, executors, translators, streaming and error handling.
- **`src/app/(dashboard)/`** — the dashboard UI.

Design notes, the Workers-specific bug history and verification evidence are in
[`WORKERS.md`](./WORKERS.md).

## Configuration

Runtime variables are set through Wrangler (`vars` in `wrangler.jsonc` or
`wrangler secret put`):

| Name | Purpose |
| --- | --- |
| `JWT_SECRET` | Signs dashboard session cookies (secret) |
| `INITIAL_PASSWORD` | First-login dashboard password (secret; change it in Profile) |
| `DATA_DIR` | Filesystem scratch path used by legacy import/backup paths on Workers (`/tmp/.9router`) |
| `AUTH_COOKIE_SECURE` | Set `"true"` on HTTPS deployments so session cookies are `Secure` |
| `ROUTER_DATABASE` | Durable Object binding for the database (configured in `wrangler.jsonc`) |

`.env.example` documents the Node/self-hosted equivalent.

## Releases & related projects

| | |
| --- | --- |
| **Deploy-ready build** | [`v0.5.86`](https://github.com/EmamShahrooz-JB/JB-Router/releases/tag/v0.5.86) — `jb-router-v0.5.86-opennext-bundle.zip` (unzip and `wrangler deploy`) |
| **CLI** | `cli/` is published as the [`jb-router-cli`](https://www.npmjs.com/package/jb-router-cli) npm package (bin: `jb-router`). Publishing runs from the *Publish CLI to npm* workflow with an `NPM_TOKEN` secret, because the CLI embeds a full production build |
| **Edge Lite (prototype)** | [JB-Router-Edge-Lite](https://github.com/EmamShahrooz-JB/JB-Router-Edge-Lite) — the early small Hono + static-dashboard Worker, kept for reference only |

## Credits & attribution

JB-Router is a **Cloudflare Workers port of [9Router](https://github.com/decolua/9router)**
by [decolua](https://github.com/decolua) and contributors. The dashboard UI, provider
registry, routing/combo engine and translators originate from that project; this repository
adds the Workers runtime port (Durable Object SQLite storage, OpenNext packaging, internal
request transport, probe/health fixes) and the JB-Router branding.

Upstream documentation is kept in [`gitbook/`](./gitbook), [`README.zh-CN.md`](./README.zh-CN.md)
and [`i18n/`](./i18n) and may still reference 9Router naming.

## License

[MIT](./LICENSE) — original copyright © 2024-2026 decolua and contributors (9Router),
JB-Router modifications © 2026 EmamShahrooz-JB and contributors.

## Security

Please do not report security issues in public issues — see [`SECURITY.md`](./SECURITY.md).
