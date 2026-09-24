/**
 * JB-Router web deployer — Cloudflare Worker backend.
 *
 * The page (served from ./static) collects the *visitor's own* Cloudflare API token and
 * drives this Worker, which talks to the Cloudflare API on the visitor's behalf (the
 * browser cannot: api.cloudflare.com sends no CORS headers).
 *
 * Security model
 *  - The visitor's token and the deployer secrets are used in-flight only: they arrive in a
 *    request body/header, are used for one upstream call, and are never logged or stored.
 *  - The relay endpoints only forward to api.cloudflare.com and require either the visitor's
 *    token (session/script/secrets/enable) or a Cloudflare-issued assets JWT (asset buckets).
 *  - /api/health only probes https://*.workers.dev URLs.
 */
const CF = "https://api.cloudflare.com/client/v4";
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;

/** Durable Object class of JB-Router; the migration only applies to a fresh install. */
const MIGRATIONS = { new_tag: "v1-durable-sqlite", steps: [{ new_sqlite_classes: ["RouterDatabase"] }] };
const MIGRATION_ERROR = /(migration tag|actor migration|10079)/i;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      try {
        return await handleApi(request, env, url);
      } catch (err) {
        const message = err && err.message ? err.message : String(err);
        return json({ ok: false, error: message }, 500);
      }
    }

    // The deploy payload changes on every release: never let an edge/browser cache hand a
    // visitor a chunk that no longer matches the manifest.
    if (url.pathname.startsWith("/bundle/")) {
      const res = await env.ASSETS.fetch(request);
      const out = new Response(res.body, res);
      out.headers.set("cache-control", "no-store");
      return out;
    }

    // everything else is the static page
    return env.ASSETS.fetch(request);
  }
};

async function handleApi(request, env, url) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,OPTIONS" } });
  }

  switch (url.pathname) {
    case "/api/meta": {
      const res = await env.ASSETS.fetch(new Request(new URL("/bundle/meta.json", url.origin)));
      const out = new Response(res.body, res);
      out.headers.set("cache-control", "no-store");
      return out;
    }
    case "/api/health":
      return healthProbe(request);
    case "/api/verify":
      return verifyToken(request);
    case "/api/accounts":
      return listAccounts(request);
    case "/api/subdomain":
      return subdomain(request);
    case "/api/manifest":
      return bundleManifest(env, url);
    case "/api/session":
      return assetsSession(request);
    case "/api/session-bundle":
      return sessionFromBundle(request, env, url);
    case "/api/upload-chunk":
      return uploadBundleChunk(request, env, url);
    case "/api/assets-upload":
      return assetsUploadRelay(request, url);
    case "/api/script":
      return deployScript(request, env, url);
    case "/api/secrets":
      return putSecrets(request);
    case "/api/enable":
      return enableSubdomain(request);
    default:
      return json({ ok: false, error: "unknown endpoint " + url.pathname }, 404);
  }
}

/* ------------------------------------------------------------------ helpers */

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

async function readJson(request) {
  const text = await request.text();
  if (text.length > MAX_MANIFEST_BYTES + 65536) throw new Error("request body too large");
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error("invalid JSON body");
  }
}

function requireString(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`missing ${name}`);
  return value.trim();
}

function scriptName(value) {
  const name = requireString(value, "worker name");
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(name)) throw new Error("invalid worker name: use lowercase letters, digits and dashes");
  return name;
}

function accountId(value) {
  const id = requireString(value, "account id");
  if (!/^[0-9a-f]{32}$/i.test(id)) throw new Error("invalid Cloudflare account id");
  return id;
}

/** Calls the Cloudflare API with the visitor's token and normalises errors. */
async function cf(path, { token, method = "GET", body, headers = {}, raw = false } = {}) {
  const res = await fetch(CF + path, {
    method,
    headers: { Authorization: `Bearer ${requireString(token, "cloudflare token")}`, ...headers },
    body
  });
  if (raw) return res;
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok || (data && data.success === false)) {
    const details = data && Array.isArray(data.errors) && data.errors.length
      ? data.errors.map((e) => `${e.code || ""} ${e.message || ""}`.trim()).join("; ")
      : `HTTP ${res.status}`;
    const err = new Error(details);
    err.status = res.status;
    throw err;
  }
  return data;
}

/* ------------------------------------------------------------------ token + account */

async function verifyToken(request) {
  const { token } = await readJson(request);
  const data = await cf("/user/tokens/verify", { token });
  return json({ ok: true, id: data.result && data.result.id, status: data.result && data.result.status });
}

async function listAccounts(request) {
  const { token } = await readJson(request);
  const data = await cf("/accounts?per_page=50", { token });
  const accounts = (data.result || []).map((a) => ({ id: a.id, name: a.name }));
  return json({ ok: true, accounts });
}

async function subdomain(request) {
  const { token, accountId: acc, set } = await readJson(request);
  const account = accountId(acc);
  const current = await cf(`/accounts/${account}/workers/subdomain`, { token });
  let subdomainValue = current.result && current.result.subdomain;
  if (!subdomainValue && set) {
    const created = await cf(`/accounts/${account}/workers/subdomain`, {
      token, method: "PUT", headers: JSON_HEADERS, body: JSON.stringify({ subdomain: String(set).trim().toLowerCase() })
    });
    subdomainValue = created.result && created.result.subdomain;
  }
  return json({ ok: true, subdomain: subdomainValue || null });
}

/* ------------------------------------------------------------------ assets */

async function assetsSession(request) {
  const { token, accountId: acc, name, manifest } = await readJson(request);
  const account = accountId(acc);
  const script = scriptName(name);
  if (!manifest || typeof manifest !== "object") throw new Error("missing manifest");
  const data = await cf(`/accounts/${account}/workers/scripts/${script}/assets-upload-session`, {
    token, method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ manifest })
  });
  const result = data.result || {};
  return json({ ok: true, jwt: result.jwt || null, buckets: result.buckets || [] });
}

/* -------------------------------------------------- bundle streaming (fast path) */

/** The build-time index of the pre-encoded asset sections; small and cached per isolate. */
let bundleIndexCache = null;
async function bundleIndex(env, origin) {
  if (bundleIndexCache) return bundleIndexCache;
  const res = await env.ASSETS.fetch(new Request(new URL("/bundle/manifest.json", origin)));
  if (!res.ok) throw new Error("the deployer bundle has no manifest.json (build with make-bundle.mjs)");
  const index = await res.json();
  bundleIndexCache = index;
  return index;
}

/** Public, browser-friendly summary of the bundle: chunk plan, so the page can show progress. */
async function bundleManifest(env, url) {
  const index = await bundleIndex(env, url.origin);
  return json({
    ok: true,
    release: index.release,
    files: index.files,
    bytes: index.bytes,
    streaming: true,
    chunks: index.chunks.map((chunk, i) => ({ index: i, bytes: chunk.bytes, files: chunk.files }))
  });
}

/**
 * Creates the asset upload session from our own manifest and answers with the hashes
 * Cloudflare still wants. Cloudflare's own bucketing is ignored on purpose: the caller
 * decides how to split the work (see /api/upload-part).
 */
async function sessionFromBundle(request, env, url) {
  const body = await readJson(request);
  const token = requireString(body.token, "cloudflare token");
  const account = accountId(body.accountId);
  const script = scriptName(body.name);

  const index = await bundleIndex(env, url.origin);
  const manifest = {};
  for (const entry of index.entries) manifest[entry.path] = { hash: entry.hash, size: entry.size };

  const data = await cf(`/accounts/${account}/workers/scripts/${script}/assets-upload-session`, {
    token, method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ manifest })
  });
  const result = data.result || {};
  const wanted = new Set();
  for (const bucket of result.buckets || []) for (const hash of bucket) wanted.add(hash);

  // Which pre-built chunks carry the missing assets? Uploading a whole chunk may include a few
  // files Cloudflare no longer asked for — measured against the API, extra parts are accepted.
  const uploads = [];
  let pendingBytes = 0;
  index.chunks.forEach((chunk, i) => {
    const files = chunk.hashes.filter((hash) => wanted.has(hash));
    if (!files.length) return;
    uploads.push({ index: i, bytes: chunk.bytes, files: files.length });
    pendingBytes += chunk.bytes;
  });

  return json({
    ok: true,
    jwt: result.jwt || null,
    totalFiles: index.files,
    pendingFiles: wanted.size,
    pendingBytes,
    uploads
  });
}

/**
 * Streams one pre-built multipart chunk (bundle/chunks/chunk-N.bin) plus the closing boundary
 * straight into Cloudflare's assets upload endpoint. Nothing is buffered and no encoding
 * happens at runtime: the body is piped through, so the Worker stays far below its CPU budget.
 */
async function uploadBundleChunk(request, env, url) {
  const body = await readJson(request);
  const token = requireString(body.token, "cloudflare token");
  const account = accountId(body.accountId);
  const script = scriptName(body.name);
  const jwt = requireString(body.assetsJwt, "assets jwt");
  const chunkIndex = Number(body.chunk);
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0) throw new Error("missing chunk index");

  await cf("/user/tokens/verify", { token }); // the visitor's token stays meaningful

  const index = await bundleIndex(env, url.origin);
  const chunk = index.chunks[chunkIndex];
  if (!chunk) throw new Error(`the bundle has no chunk ${chunkIndex}`);

  const chunkRes = await env.ASSETS.fetch(new Request(new URL("/bundle/" + chunk.path, url.origin)));
  if (!chunkRes.ok || !chunkRes.body) throw new Error(`chunk ${chunk.path} is missing from the deployer assets`);

  const tail = new TextEncoder().encode(index.tail || `--${index.boundary}--\r\n`);
  const stream = new ReadableStream({
    async start(controller) {
      const reader = chunkRes.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
        controller.enqueue(tail);
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    }
  });

  const upstream = await fetch(`${CF}/accounts/${account}/workers/assets/upload?base64=true`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      "content-type": `multipart/form-data; boundary=${index.boundary}`
    },
    body: stream,
    duplex: "half"
  });
  const text = await upstream.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!upstream.ok || (data && data.success === false)) {
    return json({ ok: false, error: errorText(data, upstream.status) }, 400);
  }
  return json({ ok: true, jwt: (data.result && data.result.jwt) || null, files: chunk.files, bytes: chunk.bytes });
}

/** Streams an asset bucket straight through to Cloudflare (base64 multipart, as wrangler does). */
async function assetsUploadRelay(request, url) {
  const account = accountId(url.searchParams.get("account"));
  const script = scriptName(url.searchParams.get("name"));
  const jwt = requireString(request.headers.get("x-assets-jwt"), "assets jwt");
  const token = requireString(request.headers.get("x-cf-token"), "cloudflare token");
  const contentType = requireString(request.headers.get("content-type"), "content-type");

  // Keep the visitor's token meaningful: verify it before relaying anything.
  await cf("/user/tokens/verify", { token });

  const upstream = await fetch(`${CF}/accounts/${account}/workers/assets/upload?base64=true`, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}`, "content-type": contentType },
    body: request.body,
    duplex: "half"
  });
  const text = await upstream.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!upstream.ok || (data && data.success === false)) {
    return json({ ok: false, error: errorText(data, upstream.status) }, 400);
  }
  return json({ ok: true, jwt: (data.result && data.result.jwt) || null, script });
}

/* ------------------------------------------------------------------ script upload */

async function deployScript(request, env, url) {
  const body = await readJson(request);
  const token = requireString(body.token, "cloudflare token");
  const account = accountId(body.accountId);
  const script = scriptName(body.name);
  const assetsJwt = requireString(body.assetsJwt, "assets jwt").replace(/^cfwau_/, "");

  const metaRes = await env.ASSETS.fetch(new Request(new URL("/bundle/meta.json", url.origin)));
  const meta = await metaRes.json();

  const metadata = {
    main_module: "worker.js",
    bindings: [
      { type: "assets", name: "ASSETS" },
      { type: "durable_object_namespace", name: "ROUTER_DATABASE", class_name: "RouterDatabase" },
      { type: "plain_text", name: "DATA_DIR", text: "/tmp/.jb-router" },
      { type: "plain_text", name: "AUTH_COOKIE_SECURE", text: "true" },
      ...(body.jwtSecret ? [{ type: "secret_text", name: "JWT_SECRET", text: String(body.jwtSecret) }] : []),
      ...(body.password ? [{ type: "secret_text", name: "INITIAL_PASSWORD", text: String(body.password) }] : [])
    ],
    compatibility_date: meta.compatibilityDate || "2025-09-23",
    compatibility_flags: meta.compatibilityFlags || ["nodejs_compat"],
    assets: { jwt: assetsJwt, config: {} },
    observability: { enabled: true }
  };

  /**
   * Uploads the script. The Durable Object migration is only valid for the first install —
   * re-deploying an existing Worker with the same tag fails with "migration tag precondition
   * failed" (10079), so that case is retried without the migrations block, exactly like
   * wrangler does when the deployed tag already matches the configuration.
   */
  const upload = async (withMigrations) => {
    const moduleRes = await env.ASSETS.fetch(new Request(new URL("/bundle/worker.js", url.origin)));
    if (!moduleRes.ok || !moduleRes.body) throw new Error("bundled worker module is missing from the deployer assets");

    const boundary = "----jbdeployer" + crypto.randomUUID().replace(/-/g, "");
    const encoder = new TextEncoder();
    const payload = withMigrations ? { ...metadata, migrations: MIGRATIONS } : metadata;
    const prefix = encoder.encode(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="metadata"\r\n` +
      `Content-Type: application/json\r\n\r\n` +
      JSON.stringify(payload) + `\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="worker.js"; filename="worker.js"\r\n` +
      `Content-Type: application/javascript+module\r\n\r\n`
    );
    const suffix = encoder.encode(`\r\n--${boundary}--\r\n`);

    // The bundled Worker module is streamed from our own static assets into the upload
    // request: no buffering, no decompression, no CPU-heavy work in this Worker.
    const stream = new ReadableStream({
      async start(controller) {
        controller.enqueue(prefix);
        const reader = moduleRes.body.getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
          controller.enqueue(suffix);
          controller.close();
        } catch (err) {
          controller.error(err);
        }
      }
    });

    const res = await fetch(`${CF}/accounts/${account}/workers/scripts/${script}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "content-type": `multipart/form-data; boundary=${boundary}` },
      body: stream,
      duplex: "half"
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    return { res, data, ok: res.ok && !(data && data.success === false) };
  };

  let attempt = await upload(true);
  if (!attempt.ok && MIGRATION_ERROR.test(errorText(attempt.data, attempt.res.status))) {
    attempt = await upload(false);
  }
  if (!attempt.ok) {
    return json({ ok: false, error: errorText(attempt.data, attempt.res.status) }, 400);
  }
  const result = attempt.data.result || {};
  return json({ ok: true, id: result.id, etag: result.etag, deploymentId: result.deployment_id, hasAssets: result.has_assets });
}

/* ------------------------------------------------------------------ secrets + workers.dev */

async function putSecrets(request) {
  const { token, accountId: acc, name, secrets } = await readJson(request);
  const account = accountId(acc);
  const script = scriptName(name);
  if (!Array.isArray(secrets) || !secrets.length) throw new Error("missing secrets");
  const stored = [];
  for (const secret of secrets) {
    const key = requireString(secret.name, "secret name");
    const value = requireString(secret.text, "secret value");
    await cf(`/accounts/${account}/workers/scripts/${script}/secrets`, {
      token, method: "PUT", headers: JSON_HEADERS,
      body: JSON.stringify({ name: key, text: value, type: "secret_text" })
    });
    stored.push(key);
  }
  return json({ ok: true, stored });
}

async function enableSubdomain(request) {
  const { token, accountId: acc, name } = await readJson(request);
  const account = accountId(acc);
  const script = scriptName(name);
  const data = await cf(`/accounts/${account}/workers/scripts/${script}/subdomain`, {
    token, method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ enabled: true, previews_enabled: false })
  });
  return json({ ok: true, subdomain: data.result || null });
}

/* ------------------------------------------------------------------ health */

async function healthProbe(request) {
  const { url: target } = await readJson(request);
  const base = requireString(target, "url");
  let parsed;
  try { parsed = new URL(base); } catch { throw new Error("invalid url"); }
  if (parsed.protocol !== "https:") throw new Error("only https targets are allowed");
  if (!/(^|\.)workers\.dev$/.test(parsed.hostname)) throw new Error("only *.workers.dev targets are allowed");
  const res = await fetch(new URL("/api/health", parsed), { headers: { accept: "application/json" } });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = null; }
  return json({ ok: true, status: res.status, body: data || text.slice(0, 400) });
}

function errorText(data, status) {
  if (data && Array.isArray(data.errors) && data.errors.length) {
    return data.errors.map((e) => `${e.code || ""} ${e.message || ""}`.trim()).join("; ");
  }
  if (data && data.error) return String(data.error);
  if (data && data.raw) return String(data.raw).slice(0, 300);
  return `HTTP ${status}`;
}
