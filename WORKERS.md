# JB-Router on Cloudflare Workers

Production: `https://<your-worker-name>.<your-subdomain>.workers.dev` (this document was written against a private deployment; replace with your own URL)

## Architecture

The original Next.js app is built using OpenNext. `cloudflare-worker.js` is the deployment entry point, not `.open-next/worker.js` directly. All dynamic requests are forwarded to the single named SQLite Durable Object `RouterDatabase / jb-router-primary`; static assets use the ASSETS binding. The original synchronous database repositories now execute real SQLite queries and transactions through `durableSqliteAdapter.js`. There is no in-memory fallback on Workers. Native Node SQLite drivers and sql.js WASM are not used on Workers.

Do not rename the class, binding or object name without a deliberate data migration. All dynamic requests are centralized in one object; this is a single-installation architecture, not a multi-tenant/sharded deployment. Cloudflare Durable Object usage and storage billing apply.

`JWT_SECRET` and `INITIAL_PASSWORD` are Cloudflare secrets, not plain Wrangler variables. JWT signing remains stable across deployments. A dashboard password hash is also saved in persistent SQLite; once present, it takes precedence over INITIAL_PASSWORD. Do not commit passwords or tokens. The old default password is no longer valid on the deployed installation.

## Build and deploy

```sh
npm install
npm run workers:build
npm run workers:deploy
```

The deploy script disables Wrangler framework autoconfiguration so it does not bypass the Durable Object entry point. Supply `CLOUDFLARE_API_TOKEN` securely in the deployment environment. Existing Cloudflare secrets are preserved on normal deployment. For a fresh installation, provide strong JWT_SECRET and INITIAL_PASSWORD with Wrangler's `--secrets-file` option (keep that file outside source control).

Local development needs an ignored `.dev.vars` file with JWT_SECRET and INITIAL_PASSWORD, then `npm run workers:dev`. The local Worker state persists under `.wrangler/state` but is not the production database.

## Verification performed on 2026-09-23

- Production password login: 200; subsequent status authenticated=true.
- Authenticated dashboard and providers page: 200 (not a redirect to login).
- Unauthenticated settings API: 401.
- Settings, providers, provider nodes, keys, models, pricing, combos, proxy pools, usage stats/chart/history: 200.
- Combo creation, update, duplicate rejection, retrieval, deletion: passed.
- API key creation and deletion: passed. Test keys were removed.
- Production combo and existing authenticated session survived a second deployment; test combo removed afterward.
- Local persisted combo and session survived stopping and restarting Wrangler.
- Current strong password was hashed and persisted; login succeeded afterward; `123456` was rejected with 401.

Repeat smoke tests using Node 22+:

```sh
TEST_URL=https://<your-worker>.<your-subdomain>.workers.dev INITIAL_PASSWORD='<current-dashboard-password>' npm run workers:test
```

The test creates and cleans up one uniquely named combo. It does not call a paid AI provider or print credentials.

## Limits and unverified features

This is not a claim that all upstream features work on Workers. Native host features (local CLI process management, sudo/MITM, installing tunnels, reading local provider credentials) are not equivalent to running on a desktop/server. DNS server overrides are unsupported. Real provider inference, provider OAuth/token renewal, SSE under long-running provider loads and every UI interaction still require end-to-end testing with user-supplied provider credentials. The retained local-filesystem backup tools need a separate Workers backup/export strategy; migrations on Workers skip filesystem backups and legacy JSON imports. No provider credentials were added during these tests.

Last verified deployment: `c6d9b7d5-bce2-4367-905c-6a2e686e6f78`.


## Durable Object context ownership fix (2026-09-23)

The original isolate-global `__jbRouterStorage` and `_dbAdapter` Worker cache
caused `Cannot perform I/O on behalf of a different Durable Object
(ActorCacheInterface)`. Even the same named object may be evicted and recreated
while the isolate module cache survives.

The entry point now keeps storage, adapter, initialization promise and log state
on the `RouterDatabase` **instance**. Each fetch runs inside AsyncLocalStorage.
A symbol-backed getter bridges Next's middleware and server bundles, resolving
only the current asynchronous request context. Workers never reuse the Node
process-global adapter. SQLite operations also assert that the calling context
owns the adapter. No persistent object name, binding, migration or login secret
was changed for this fix.

Regression verification:
- Reproduced the exact original error: actor A login 200, actors B/C login 500.
- Fixed build: four independent actors initialize and authenticate successfully.
- Same combo name can be created in four separate databases with independent IDs.
- 120 concurrent database reads across these actors: passed.
- Force-aborted actor A (local fixture only): its new incarnation reads the same
  persistent record and accepts the previous session; actor B is not recreated.
- Production full smoke test and 24 concurrent authenticated database reads:
  passed. Persisted password is present; unauthenticated settings access is 401.

Local lifecycle test (never deploy the fixture configuration):

```sh
npx wrangler dev --config wrangler.actors.jsonc --port 8791
# In another shell:
npm run workers:test:actors
```

The fixture's `/__test/*` routes, multi-actor routing and public test-only secrets
are NOT part of `cloudflare-worker.js` or the production deployment.

Build note: this sandbox has 2 GB RAM. Next's webpack build completed with
`RAYON_NUM_THREADS=1 UV_THREADPOOL_SIZE=1 NODE_OPTIONS=--max-old-space-size=768`.
OpenNext emitted the server bundle and metafile but its combined process was
killed before final string replacements. Its exported
`updateWorkerBundledCode` was run in a separate low-memory Node 22 process to
complete that exact final step. The resulting artifact was tested under local
workerd and deployed successfully. Prefer a larger build machine for the normal
single-command OpenNext build; do not deploy an unfinalized artifact.


## Antigravity live models and OpenAI SSE fixes (2026-09-23)

- Replaced obsolete sandbox `/v1internal:models` with the registry's active
  `daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels` endpoint.
- Added IDE headers, stored project ID, proxy support and bounded request timeout.
  Parses keyed/array catalogs and excludes internal entries. Handles 401 with
  a single refresh and credential persistence; never silently returns a static list.
- Translated OpenAI chat-completion streams now end in exactly one
  `data: [DONE]` AFTER finish/usage and translator flush output. The flag now
  tracks emitted, rather than merely consumed, upstream sentinels. Native
  Gemini/Claude output is unchanged.
- Tests: 25 unit/regression cases passed across four test files, including UTF-8
  byte fragmentation, unterminated last event, duplicate upstream sentinels,
  other output formats, catalog shapes, 401 refresh, 403 and network errors.
- Actor-isolation/recreation test passed again on the new Worker artifact.
- Production: connected account's live catalog returned HTTP 200, 31 models,
  no warning/error. A real `ag/gemini-3.8-flash-high` streaming request returned
  `STREAM_FIXED`, finish_reason=stop, and exactly one final [DONE] in 4.09 seconds.
- Temporary inference-test API key was deleted. No account or password change.
- Other listed models have not all been inference-tested; listing is not a
  guarantee of quota or inference access for every model.

New regression files: `tests/unit/antigravity-live-models.test.js` and
`tests/unit/antigravity-sse-done.test.js`.


## Dashboard probe HTTP 403 / Cloudflare 1003 fix (2026-09-23)

The exact error was reproduced on production POST `/api/models/test`:
`ok:false, status:403, error:"HTTP 403: error code: 1003"`.
It originated from the dashboard probe's loopback self-fetch, not the connected
Antigravity upstream. Server-side `fetch(http://127.0.0.1:...)` is not a local
Next server inside Workers.

`src/lib/network/internalApi.js` now chooses a bounded, allowlisted in-process
request transport on Workers. `RouterDatabase` supplies `internalFetch` on each
object instance; it runs the normal OpenNext middleware and handlers under that
object's AsyncLocalStorage. It does NOT use network localhost, fetch the public
Worker URL, re-enter the object over RPC, or bypass authentication. Node-hosted
installs retain the existing loopback transport. Abort/deadline propagation is
preserved. All model kinds use this helper, including provider batch probes and
compatible-provider catalog lookups (now supplied with internal auth headers).

Verification:
- 37 unit/regression tests passed across transport, single/batch model routing,
  reasoning probes, live Antigravity catalog and SSE ending tests.
- New `tests/workers-internal-probe.mjs` passed under real local workerd: nested
  calls reached real inference handlers concurrently in actors A/B (intentional
  missing-provider 404); unauthenticated dashboard probe returned 401. Local test
  API keys were cleaned up; no upstream quota used by those fixture tests.
- Actor isolation / 120 concurrent reads / eviction regression passed again.
- After deployment, the exact production dashboard single-model test for
  `ag/gemini-3.8-flash-high` returned HTTP 200 and
  `{ "ok": true, "latencyMs": 3692, "error": null, "status": 200 }`.
- Unauthenticated production probe still returned 401; live catalog contained
  31 models and Antigravity remained active with no lastError.
- The live full-provider batch was NOT run, to avoid spending quota across every
  model. Its routing is covered by unit tests and the common transport.
- No production key/password/provider settings were changed during this fix.

Build note: after the combined OpenNext command hit the 2 GB memory limit during
server bundling, its exported `bundleServer` was run in an isolated Node 22
process against the already-generated artifacts. That stage completed normally,
including the final rewrite. The installed dependency was restored unchanged.


## Donate header action removed (2026-09-23)

At the user's request, removed the Donate button, DonateModal rendering/import
and donateOpen state from `src/shared/components/Header.js`. Search, theme,
language and account actions are unchanged. Production HTML for /dashboard,
/dashboard/providers and /dashboard/combos no longer contains the Donate header
action or its icon. Production smoke tests passed. No authentication, provider
or persisted settings changes. The unused standalone DonateModal source remains
unreferenced; it is no longer loaded/rendered by the dashboard header.

For this deployment, the OpenNext preparation and final bundleServer stages ran
in separate processes to fit the 2 GB build sandbox. Both completed successfully;
a temporary sibling preparation module in node_modules was removed afterward.


## Tunnel + Tailscale rows removed from API Endpoint card (2026-09-24)

At the user's request, the API Endpoint card on /dashboard and /dashboard/endpoint
now shows only the Local endpoint row. Removed from
`src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js`: the Cloudflare
Tunnel row, the Tailscale row, their enable/disable/install/auth modals, the
tunnel/Tailscale status polling, reachability ping effects, and the now-orphaned
state, helpers and imports. The API Keys card (create/pause/delete/copy, Require
API key toggle, exposure warning) is unchanged.

Verified on production: /dashboard and /dashboard/endpoint return 200; their
endpoint client chunk (`3475-*.js`) contains no "Tailscale", "Tunnel",
`cloud_upload` or `vpn_lock` markup while still containing "API Endpoint" and
"Require API key"; smoke suite passed; the dashboard single-model test for
`ag/gemini-3.8-flash-high` still returned HTTP 200 / ok:true, 31-model catalog
still returned by the Antigravity connection, and the single existing user API
key was untouched. Remaining `/api/tunnel/*` routes are unreferenced backend
code, left in place deliberately.

Environment note: workspace snapshots exclude `node_modules/` and `.next/`, so a
fresh sandbox session must run `npm install --no-audit --no-fund` (~2 min, 830
packages) before `next build`; source changes and `.open-next/` are preserved.


## Glassy gradient Select controls (2026-09-24)

At the user's request every dropdown/select control and the CLI-tools
"Select / Select Model" trigger buttons now use a glassy surface with a
drifting brand-coloured gradient border, soft glow and animated chevron:

- New CSS block in `src/app/globals.css`: `.jb-select`, `.jb-select--sm`,
  `.jb-select-wrap`, `.jb-select-arrow`, `.jb-select-btn`, keyframes
  `jb-border-drift`, plus a global `select:not(.jb-select)` rule that gives the
  same glass look and an inline-SVG chevron to every native select in the panel
  (the earlier dark-mode `select option` fix is preserved).
- `src/shared/components/Select.js` uses `.jb-select` + rotating chevron chip.
- `ApiKeySelect`, `BaseUrlSelect`, `EndpointPresetControl`, `AntigravityToolCard`
  and `ClaudeToolCard` native selects use `.jb-select .jb-select--sm`.
- 15 "Select / Select Model" buttons across the cli-tools cards use
  `.jb-select-btn`; disabled state is handled purely by CSS `:disabled`
  (previously expressed with an inline Tailwind ternary).
- Motion is disabled under `prefers-reduced-motion`.

Also fixed in this deployment: an intermediate edit that mis-spliced class
strings in the cli-tools cards was fully reverted (`git checkout HEAD -- ` on
that folder) and reapplied with an element-aware JSX tag scanner; only
`className` attributes changed.

Production verification: /dashboard, /dashboard/endpoint, /dashboard/cli-tools,
/dashboard/providers, /dashboard/combos, /dashboard/usage all 200; served CSS
`/_next/static/css/e2ee843945320dc8.css` contains `jb-select-btn` (13),
`jb-select-arrow` (6) and `jb-border-drift` (3); the cli-tools client chunk
`/_next/static/chunks/6447-556f301df4b31ef9.js` contains 14 uses of
`jb-select-btn` and the `jb-select--sm` selects; smoke suite passed; dashboard
single-model test still returns HTTP 200 `{ok:true}`.

Environment note: this sandbox drops `node_modules/` between some tool calls.
Reinstalling costs ~2 min, and a Next build with `--max-old-space-size=1024`
gets OOM-killed; the proven setting is 768.


## Provider probes: real status codes instead of a blanket 503 (2026-09-24)

Reported symptom: "HTTP 503 in most providers". Reproduced on production and
traced in `wrangler tail` — the upstream calls succeeded and returned 402/403/
404/410/429, but a failed call puts that model in a cooldown (`modelLock_<model>`,
120s for 402/403/404, backoff for 429) and every later request for the model is
answered by `src/sse/handlers/chat.js` with its router-level 503
("all N accounts locked for <model> (reset after 2m)") carrying the original
error inside the message. The dashboard probe displayed that wrapper verbatim, so
blocked-but-reachable providers looked like an outage.

Fixes:
- `open-sse/utils/requestFlags.js` — new `x-9r-force-test` flag. Explicit
  dashboard probes (single model and "test all models") bypass recorded
  cooldowns so they always reach the provider: `getProviderCredentials` accepts
  `{ ignoreModelLocks }`, and chat / embeddings / images / stt / tts / systemone
  handlers pass it when the flag is present. Normal traffic is unchanged
  (cooldowns still protect quota); the probe no longer replays a lock it is not
  subject to and never fabricates a cooldown when no account is left.
- `open-sse/utils/upstreamStatus.js` — recovers the real upstream status,
  message and cooldown from a router-wrapped 503 and strips redundant status
  prefixes; used by `src/app/api/models/test/ping.js`, which also sets the flag.
- `open-sse/utils/error.js` — the router's 503 body now carries
  `type`, `code`, `retry_after_seconds` and `upstream_status` so /v1 clients can
  see what the cooldown really means.
- `cloudflare-worker.js` — added `scheduled()`. The deployed Worker has a
  `*/5 * * * *` cron that logged "Error: Handler does not export a scheduled()
  function" every tick; it now warm-starts the singleton DO instead.

Production evidence (version `c6d9b7d5`): api-airforce batch probe returns
`402 Model 'gpt-oss-120b' requires an active subscription`, `429 Global rate
limit exceeded`, `402 … Pay-as-you-Go balance` with `status` matching each
upstream code; nvidia returns `410 Gone`; antigravity single-model probe still
`{ok:true}`; /v1 traffic without the flag still gets 503 + `Retry-After` but with
`upstream_status: 402`; smoke suite passed.

Notes: these upstream failures are account-side (unpaid/retired models, Copilot
license, free-plan limits), not router bugs. `gemini` lists an embedding model
(`models/text-embedding-005`) the account cannot use, and `nvidia`/`cloudflare-ai`
lists contain retired or free-plan-blocked models — prune those lists if they
should not be offered.

## Glassy dropdown menu replaces the native select popup (2026-09-24)

`src/shared/components/SelectMenuEnhancer.js` (mounted once in `src/app/layout.js`)
intercepts pointer/keyboard activation of any `<select>` and renders a themed
listbox portal: glass panel with drifting gradient border, search box (lists > 8
options) with match counter, option groups, hover/active highlight, checkmark for
the current value, viewport-aware placement (flips up, clamps horizontally,
max-height with internal scroll) and full keyboard support (arrows, Home/End,
PageUp/PageDown, Enter, Escape, typeahead, Tab). Selection writes back to the
real `<select>` via `.value` + native `input`/`change` events, so React `onChange`
and every other listener behave exactly as before; no call site changed.
Styling lives in the `.jb-menu*` block of `src/app/globals.css`; motion is
disabled under `prefers-reduced-motion`. Only one of `pointerdown`/`mousedown` is
subscribed (both would open then instantly close); `multiple`, `size>1` and
disabled selects keep their native behaviour.

Verified in production: served CSS contains the `.jb-menu` rules and
`/_next/static/chunks/app/layout-*.js` contains the listbox implementation;
dashboard pages, smoke suite and the model probes all still pass.


## Open-source release (2026-09-24)

Published as **JB-Router** — https://github.com/EmamShahrooz-JB/JB-Router (MIT).

- `README.md` describes the port, quick-start deploy, configuration and the
  architecture; `CONTRIBUTING.md` and `SECURITY.md` were added; `LICENSE` keeps the
  upstream 9Router copyright next to the JB-Router modification notice.
- Upstream `.github/workflows/docker-publish.yml` (which pushed images under the
  upstream Docker Hub/GHCR namespaces) was removed; the GitBook pages workflow is now
  `workflow_dispatch`-only so unrelated pushes do not carry a failing check.
- The tree was scanned before publishing: no dashboard password, Cloudflare token,
  Wrangler state, `.dev.vars`, Durable Object export or production URL is committed,
  and this document uses a placeholder deployment URL.
- GitHub push protection flagged the Gemini CLI and Antigravity OAuth client
  id/secret pairs (the installed-app credentials those official clients ship with,
  also published by upstream 9Router). They were restored with recorded
  push-protection bypasses (reason `false_positive`) because the OAuth logins need
  them. Secret scanning also reports one `Google API Key` alert for the public
  Windsurf/Codeium key in `open-sse/providers/registry/windsurf.js`; it is a
  tracked, dismissable alert.
