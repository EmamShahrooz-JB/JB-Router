# JB-Router web deployer (`jb-deployer`)

**One-click install of JB-Router into any Cloudflare account:** the visitor pastes their own
Cloudflare API token and the Worker, static assets, Durable Object and secrets are created on
*their* account in about 20 seconds.

The page is a single card with the steps list, install-type select, live terminal panel and
success/quick-link toasts — the wizard *layout* popularised by
[BPB-Wizard](https://github.com/bia-pain-bache/BPB-Wizard) (GPL-3.0, re-implemented from
scratch — see [Credits](#credits)) — but **painted entirely with JB-Router's own design tokens**,
copied from the dashboard's `src/app/globals.css`: brand orange `#E56A4A`, the light
`#FDFAF6` / dark `#1a1a1a` neutral-warm surfaces, 10/14 px radii, the faint landing-grid
overlay, Inter, and the same card/Button/Input recipes. It follows the dashboard's theme
contract too: the `dark` class on `<html>` driven by the persisted `theme` key, plus a
moon/sun toggle in the header.

- **صفحهٔ زنده:** https://jb-deployer.jb-router.workers.dev
- بدون CLI، بدون Git، بدون GitHub — فقط یک API Token با قالب *Edit Cloudflare Workers*.

---

## Why a Worker sits in the middle

`api.cloudflare.com` returns **no `Access-Control-Allow-Origin` headers** at all (verified: a
`GET /user/tokens/verify` with an `Origin` header answers `200` without any CORS header, and an
`OPTIONS` preflight answers `400`). A static browser page therefore cannot deploy to Cloudflare
directly — no matter whether it is hosted on GitHub Pages, S3 or a Worker.

So the page is served by this Worker and every Cloudflare API call is proxied through it:

```
browser ──(visitor's token, one request at a time)──▶ jb-deployer Worker ──▶ api.cloudflare.com
   │                                                         │
   └── downloads payload, unzips + blake3-hashes assets,     └── streams the bundled Worker
       uploads asset buckets, polls /api/health                  module into the script upload
```

## Security model

| Concern | How it is handled |
| --- | --- |
| Visitor token | Used in-flight only. It is never written to storage, never logged, and never included in an error message. |
| Open-proxy abuse | Every relay endpoint forwards to a **fixed** Cloudflare path. Token endpoints are validated by Cloudflare itself; the asset relay additionally requires a Cloudflare-issued assets JWT (obtainable only with a valid token). |
| `/api/script` | Uploads *our own published build* (from this Worker's static assets) — a caller can only install JB-Router into an account they already control. |
| `/api/health` | Restricted to `https://*.workers.dev` targets. |
| Payload integrity | `worker.js` + `assets.zip` are built from the public release by `deployer/tools/make-bundle.mjs` and shipped with the Worker, so nothing is fetched from third parties at deploy time. |
| Everything else | Full source in this folder; MIT; the deployed page says exactly what happens to the token and tells users they can roll the token afterwards. |

## What the deployer actually does (reverse-engineered API details)

These are the pieces that make a *programmatic* deploy possible without `wrangler`:

1. **Static assets**: `POST /accounts/{id}/workers/scripts/{name}/assets-upload-session` with
   `{manifest}` where the hash per file is **`blake3(base64(content) + extension)` → hex → first 32 chars**
   (that is what wrangler's `hashFile` does). The response holds `buckets` (arrays of hashes) and a JWT.
2. **Bucket upload**: `POST /accounts/{id}/workers/assets/upload?base64=true` — multipart where each part
   is named *and* filed as the hash with **base64** content (`?base64=true` is mandatory, raw bytes are rejected).
   The response returns the JWT that must be passed as `metadata.assets.jwt`.
3. **Script upload**: `PUT /accounts/{id}/workers/scripts/{name}` as `multipart/form-data` with
   `metadata` (JSON) + the ES module part (`application/javascript+module`). Chunked/streamed bodies are accepted,
   which is how the 21 MB module is piped straight from our assets binding into the request.
4. **Durable Object migration**: `metadata.migrations = {new_tag, steps:[{new_sqlite_classes:[…]}]}` on a
   *fresh* install; re-deploying an existing Worker with the same tag fails with
   `10079 Actor migration tag precondition failed`, so that case is retried without the migrations block.
5. **Secrets**: either inline in `metadata.bindings` (`{type:"secret_text", name, text}`) or via
   `PUT /accounts/{id}/workers/scripts/{name}/secrets` — the deployer does both.
6. **workers.dev URL**: `POST /accounts/{id}/workers/scripts/{name}/subdomain` (note: `POST`, not `PUT`;
   `PUT` answers `10405 Method not allowed for this authentication scheme`). The URL becomes reachable
   ~10–60 s later, so the page polls `/api/health`.
7. **Health polling happens in the browser**, not in the Worker: a subrequest to `*.workers.dev` made from
   inside Cloudflare resolves against the local worker registry and returns `404 / error code: 1042`,
   while the same URL answers `200` from the public internet. JB-Router's `/api/health` sends
   `access-control-allow-origin: *`, so the visitor's browser can poll it cross-origin.

## Layout

```
deployer/
├── src/index.js              Worker: page host + Cloudflare API proxy (no state, no storage)
├── web/                      the wizard page source (React 19 + Vite + Tailwind v4)
│   ├── src/App.tsx           layout: hero, stepper, configuration form, terminal panel, toasts
│   ├── src/lib/deployer.ts   typed bridge to static/pipeline.js (one shared deploy core)
│   ├── src/hooks/useTheme.ts + src/components/ThemeToggle.tsx
│   └── vite.config.ts        builds a single self-contained index.html
├── static/
│   ├── index.html            the built page (output of build/make-page.mjs)
│   ├── favicon.svg           panel icon
│   ├── pipeline.js           deploy logic — shared by the page and the Node tests
│   ├── vendor/blake3.js      generated by build/make-vendor.mjs
│   └── bundle/               generated by build/make-bundle.mjs
│       ├── worker.js         bundled JB-Router Worker module (streamed to Cloudflare)
│       ├── assets.zip        .open-next/assets/** for the browser to unzip + upload
│       ├── mime-map.js       extension → content-type used for asset parts
│       └── meta.json         release, sizes, compatibility date/flags
├── build/make-bundle.mjs     wrangler --dry-run → worker.js, zip → assets.zip, meta + mime map
├── build/make-vendor.mjs     esbuild → static/vendor/blake3.js
├── build/zip-writer.mjs      store-only zip fallback when the `zip` binary is missing
└── test/
    ├── e2e.mjs               real deploy of the whole pipeline against a running deployer
    └── ui-smoke.mjs          real Chromium (puppeteer) drives the page: install + assertions
```

## Build & deploy the deployer

```bash
npm run workers:build                 # produces .open-next/ (the app bundle the deployer ships)
node deployer/tools/make-vendor.mjs   # static/vendor/blake3.js
node deployer/tools/make-bundle.mjs --release v0.5.87

cd deployer
CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… npx wrangler deploy --config wrangler.jsonc
```

The `Deploy deployer Worker` workflow (`.github/workflows/deploy-deployer.yml`) does the same from CI
with the `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` repository secrets.

## Tests

```bash
# full pipeline against a locally running `wrangler dev`
cd deployer && npx wrangler dev --port 8799
CFT=<token> ACC=<account id> SUB=<workers.dev subdomain> \
  node deployer/test/e2e.mjs --base=http://127.0.0.1:8799 --name=jb-router-test

# build the page (React + Vite) into static/index.html
node deployer/tools/make-page.mjs

# the page itself: real Chromium fills the form, presses Install, asserts the terminal
CFT=… BASE=https://jb-deployer.<sub>.workers.dev \
  node deployer/test/ui-smoke.mjs --name=jb-router-test        # add --type=dryrun for a dry run
```

Verified end to end on 2026-09-24 against a real Cloudflare account:
fresh install **19.7 s** (234 asset files in 3 buckets, worker + secrets + workers.dev + health OK) and
re-install **13.2 s**.

## Wizard features

| Feature | Notes |
| --- | --- |
| Stack | React 19 + Vite + Tailwind v4 + framer-motion, built to one self-contained `index.html` (no runtime CSS-in-JS, no icon font: lucide-react icons are inlined by the bundler). |
| Token template link | The "Create a token" link opens the Cloudflare dashboard with the permission groups pre-selected (`workers_scripts:edit`, `workers_kv_storage:edit`, `account_settings:read`, `user_details:read`) and the name `JB-Router-Wizard`. |
| Account picker | A select appears only when the token can see more than one account; a single-account token goes straight through. |
| Subdomain runner | If the account has no `workers.dev` subdomain, the input is revealed and the wizard registers the name the visitor types (`PUT /workers/accounts/{id}/workers/subdomain`). |
| Install type | `Cloudflare Workers — full installation` or `validate only (dry run)`, which stops after the token/account check. |
| Live terminal | One line per milestone (payload, hashes, buckets, deployment id, secrets, URL, health) plus the generated dashboard password with a copy button. |
| Toasts | "Successfully installed" (with the dashboard link) and a "quick link" that re-opens the wizard with the same worker name, subdomain, install type and account pre-filled. |
| Random credentials | A 24-char dashboard password and 48-char `JWT_SECRET` are generated per install and never written anywhere else. |

## Credits

Two independent influences, no code shared with either:

1. **Colour, type and components** come from JB-Router's own dashboard, i.e. the JB-Router theme
   (`src/app/globals.css`): brand `#E56A4A` scale, warm neutrals, `--radius-brand` 10px,
   `--shadow-focus` ring, landing-grid overlay, favicon gradient `#f97815 → #c2590a`,
   Inter. The wizard reads the same `theme` localStorage key and toggles the same `dark`
   class, so it looks like a page of the panel it installs.
2. **Page layout** (hero + stepper → configuration card → terminal console → toasts → footer)
   follows
   [BPB-Wizard](https://github.com/bia-pain-bache/BPB-Wizard) by
   [bia-pain-bache](https://github.com/bia-pain-bache), which is **GPL-3.0** — so none of its
   code, CSS or assets were copied; the markup/CSS here is an independent implementation.

## Limits & caveats

- The visitor's account must fit the script: JB-Router's module is **21.5 MB raw / 4.2 MB gzipped**, so a
  **Workers Paid** plan is required (free-plan limit is 3 MB). The page states this before installing.
- The deployer never touches billing, routes, custom domains or the visitor's other Workers.
- Deleting an install is left to the visitor (`Workers & Pages → <name> → Delete`); the Durable Object
  class and its data go away with the script.
