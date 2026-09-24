/**
 * Core of the JB-Router web deployer: reads the deploy payload, hashes the static assets
 * exactly like wrangler does, uploads them to the visitor's Cloudflare account and finally
 * asks the deployer Worker to push the bundled Worker + secrets.
 *
 * Runs in the browser (static assets) and in Node (integration tests) — it only needs fetch,
 * DecompressionStream (overridable), blake3 and FormData.
 *
 * Every callback event is a plain object so the UI layer owns all wording:
 *   {type:"step",     id, state:"active"|"done"|"error", note}
 *   {type:"event",    key, data}        // progress milestones, keys documented below
 *   {type:"progress", id, received, total}
 *   {type:"result",   result}
 */
import { blake3 } from "./vendor/blake3.js";

export const MIME_FALLBACK = "application/null";

/* ------------------------------------------------------------------ bytes */

export function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  if (typeof btoa === "function") return btoa(binary);
  return Buffer.from(bytes).toString("base64");
}

function toHex(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

/** wrangler's asset hash: blake3(base64(content) + extension) → hex → first 32 chars. */
export function hashAsset(bytes, path) {
  return toHex(blake3(new TextEncoder().encode(bytesToBase64(bytes) + assetExt(path)))).slice(0, 32);
}

export function assetExt(path) {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

export function mimeFor(path, mimeMap) {
  return (mimeMap && mimeMap[assetExt(path)]) || MIME_FALLBACK;
}

/* ------------------------------------------------------------------ zip */

export async function inflateRawStream(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Minimal zip reader: enough for the archives this project produces (stored + deflate). */
export async function readZip(bytes, inflateRaw = inflateRawStream) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  const from = Math.max(0, bytes.length - 66000);
  for (let i = bytes.length - 22; i >= from; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("not a zip archive");
  const count = view.getUint16(eocd + 10, true);
  if (count === 0xffff) throw new Error("zip64 archives are not supported");
  let offset = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error("corrupt central directory");
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith("/")) continue;
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = bytes.subarray(dataStart, dataStart + compressedSize);
    const data = method === 0 ? raw.slice() : await inflateRaw(raw);
    entries.push({ path: "/" + name.replace(/^\.?\//, ""), bytes: data });
  }
  return entries;
}

/* ------------------------------------------------------------------ http */

export class DeployError extends Error {
  constructor(message, status) { super(message); this.name = "DeployError"; this.status = status; }
}

async function postJson(fetchImpl, apiBase, path, body, signal) {
  const res = await fetchImpl(apiBase + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok || !data || data.ok !== true) {
    throw new DeployError((data && data.error) || `HTTP ${res.status}${text ? " " + text.slice(0, 200) : ""}`, res.status);
  }
  return data;
}

async function downloadWithProgress(fetchImpl, url, onBytes, signal) {
  const res = await fetchImpl(url, { signal });
  if (!res.ok) throw new DeployError(`could not download the deploy payload (HTTP ${res.status})`);
  if (!res.body || !onBytes) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const parts = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    received += value.length;
    onBytes(received);
  }
  const out = new Uint8Array(received);
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

/* ------------------------------------------------------------------ helpers */

/** Cloudflare account lookup used by the wizard when the token can see several accounts. */
export async function listAccounts({ cfToken, apiBase = "", fetchImpl = fetch, signal }) {
  return postJson(fetchImpl, apiBase, "/api/accounts", { token: cfToken }, signal);
}

export async function getSubdomain({ cfToken, accountId, apiBase = "", fetchImpl = fetch, signal }) {
  return postJson(fetchImpl, apiBase, "/api/subdomain", { token: cfToken, accountId }, signal);
}

/* ------------------------------------------------------------------ deploy */

export const STEPS = [
  "verify", "bundle", "hash", "session", "assets", "script", "secrets", "enable", "health"
];

/**
 * @param {object} opts
 * @param {string} opts.cfToken      visitor's Cloudflare API token (never stored)
 * @param {string} opts.accountId    Cloudflare account id
 * @param {string} opts.name         worker name
 * @param {string} opts.subdomain    workers.dev subdomain (for the final URL)
 * @param {string} opts.jwtSecret    value for the JWT_SECRET secret
 * @param {string} opts.password     value for the INITIAL_PASSWORD secret
 * @param {string} [opts.release]    release tag (log only)
 * @param {boolean} [opts.dryRun]    stop after token/account validation
 * @param {string} [opts.apiBase]    deployer Worker base url ("" = same origin)
 * @param {string} [opts.zipUrl]     payload url (default /bundle/assets.zip)
 * @param {string} [opts.mimeMapUrl] mime map url (default /bundle/mime-map.js)
 * @param {Function} [opts.fetchImpl]
 * @param {Function} [opts.inflateRaw]
 * @param {Function} [opts.onEvent]  progress callback
 * @param {AbortSignal} [opts.signal]
 */
export async function runDeploy(opts) {
  const {
    cfToken, accountId, name, subdomain, jwtSecret, password, release, dryRun = false,
    apiBase = "", zipUrl = apiBase + "/bundle/assets.zip", mimeMapUrl = apiBase + "/bundle/mime-map.js",
    fetchImpl = fetch, inflateRaw = inflateRawStream, onEvent = () => {}, signal
  } = opts;

  const emit = (event) => { try { onEvent(event); } catch { /* ignore */ } };
  const event = (key, data) => emit({ type: "event", key, data });
  const step = (id, state, note) => emit({ type: "step", id, state, note });
  const fail = (id, message) => { emit({ type: "step", id, state: "error" }); event("failure", { id, message }); throw new DeployError(message); };

  /* 1. token ---------------------------------------------------------------- */
  step("verify", "active");
  const verified = await postJson(fetchImpl, apiBase, "/api/verify", { token: cfToken }, signal);
  if (verified.status !== "active") fail("verify", `Token status is "${verified.status}".`);
  event("verify.ok", { tokenId: verified.id });
  step("verify", "done");

  if (dryRun) {
    event("dryrun.ok", { accountId, name, url: `https://${name}.${subdomain}.workers.dev` });
    const result = { dryRun: true, name, accountId, url: `https://${name}.${subdomain}.workers.dev`, health: "skipped" };
    emit({ type: "result", result });
    return result;
  }

  /* 2. payload -------------------------------------------------------------- */
  step("bundle", "active");
  const meta = await (await fetchImpl(apiBase + "/api/meta", { signal })).json();
  const zipBytes = await downloadWithProgress(fetchImpl, zipUrl, (received) => {
    emit({ type: "progress", id: "bundle", received, total: 0 });
  }, signal);
  event("bundle.ok", { release: release || meta.release, bytes: zipBytes.length, files: meta.assetFiles });
  step("bundle", "done");

  /* 3. manifest ------------------------------------------------------------- */
  step("hash", "active");
  const mimeMap = await loadMimeMap(fetchImpl, mimeMapUrl, signal);
  const entries = await readZip(zipBytes, inflateRaw);
  const manifest = {};
  const byHash = new Map();
  let index = 0;
  for (const entry of entries) {
    const hash = hashAsset(entry.bytes, entry.path);
    manifest[entry.path] = { hash, size: entry.bytes.length };
    if (!byHash.has(hash)) byHash.set(hash, { path: entry.path, bytes: entry.bytes });
    index++;
    if (index % 40 === 0) emit({ type: "progress", id: "hash", received: index, total: entries.length });
  }
  emit({ type: "progress", id: "hash", received: entries.length, total: entries.length });
  event("hash.ok", { files: entries.length });
  step("hash", "done", String(entries.length));

  /* 4. upload session ------------------------------------------------------- */
  step("session", "active");
  const session = await postJson(fetchImpl, apiBase, "/api/session", { token: cfToken, accountId, name, manifest }, signal);
  let assetsJwt = session.jwt;
  const buckets = session.buckets || [];
  const pending = buckets.reduce((n, bucket) => n + bucket.length, 0);
  event("session.ok", { pending, buckets: buckets.length });
  step("session", "done");

  /* 5. asset buckets -------------------------------------------------------- */
  step("assets", "active");
  let uploaded = 0;
  for (let i = 0; i < buckets.length; i++) {
    const form = new FormData();
    for (const hash of buckets[i]) {
      const file = byHash.get(hash);
      if (!file) fail("assets", `Asset requested by the upload session is missing: ${hash}`);
      form.append(hash, new File([bytesToBase64(file.bytes)], hash, { type: mimeFor(file.path, mimeMap) }), hash);
    }
    // The content-type header is intentionally left to fetch so the multipart boundary matches.
    const res = await fetchImpl(`${apiBase}/api/assets-upload?account=${encodeURIComponent(accountId)}&name=${encodeURIComponent(name)}`, {
      method: "POST",
      headers: { "x-cf-token": cfToken, "x-assets-jwt": assetsJwt },
      body: form,
      signal
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!res.ok || !data || data.ok !== true) {
      fail("assets", `Asset upload failed: ${(data && data.error) || "HTTP " + res.status}`);
    }
    if (data.jwt) assetsJwt = data.jwt;
    uploaded += buckets[i].length;
    emit({ type: "progress", id: "assets", received: uploaded, total: pending });
    event("assets.bucket", { index: i + 1, buckets: buckets.length, uploaded, pending });
  }
  if (!assetsJwt) fail("assets", "Cloudflare did not return the asset upload JWT.");
  assetsJwt = String(assetsJwt).replace(/^cfwau_/, "");
  event("assets.ok", { total: entries.length, pending });
  step("assets", "done", String(entries.length));

  /* 6. worker script -------------------------------------------------------- */
  step("script", "active");
  const script = await postJson(fetchImpl, apiBase, "/api/script", {
    token: cfToken, accountId, name, assetsJwt, jwtSecret, password
  }, signal);
  event("script.ok", { name: script.id, deploymentId: script.deploymentId, hasAssets: script.hasAssets });
  step("script", "done");

  /* 7. secrets -------------------------------------------------------------- */
  step("secrets", "active");
  const secrets = await postJson(fetchImpl, apiBase, "/api/secrets", {
    token: cfToken, accountId, name,
    secrets: [
      { name: "JWT_SECRET", text: jwtSecret },
      { name: "INITIAL_PASSWORD", text: password }
    ]
  }, signal);
  event("secrets.ok", { stored: secrets.stored });
  step("secrets", "done");

  /* 8. workers.dev ---------------------------------------------------------- */
  step("enable", "active");
  await postJson(fetchImpl, apiBase, "/api/enable", { token: cfToken, accountId, name }, signal);
  const url = `https://${name}.${subdomain}.workers.dev`;
  event("enable.ok", { url });
  step("enable", "done");

  /* 9. health --------------------------------------------------------------- */
  step("health", "active");
  const health = await waitForHealth({ fetchImpl, url, signal, emit });
  step("health", health.ok ? "done" : "error", health.ok ? `${health.ms}` : "timeout");
  event(health.ok ? "health.ok" : "health.timeout", { ms: health.ms, status: health.status });

  const result = {
    name, url, loginUrl: url + "/login", apiBaseUrl: url + "/v1",
    health: health.ok ? "ok" : "unknown", status: health.status || 0,
    accountId, release: release || meta.release, password
  };
  emit({ type: "result", result });
  return result;
}

async function loadMimeMap(fetchImpl, url, signal) {
  try {
    const res = await fetchImpl(url, { signal });
    if (!res.ok) return {};
    const text = await res.text();
    const match = text.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : {};
  } catch {
    return {};
  }
}

/**
 * Polls the freshly deployed Worker from the visitor's browser. The request is cross-origin,
 * which is fine because JB-Router's /api/health answers with `access-control-allow-origin: *`.
 * (A server-side probe from the deployer Worker would not work: requests to *.workers.dev made
 * *from inside* Cloudflare resolve against the local worker registry and 404 with error 1042.)
 */
async function waitForHealth({ fetchImpl, url, signal, emit }) {
  const started = Date.now();
  const deadline = started + 5 * 60 * 1000;
  let attempt = 0;
  let last = null;
  while (Date.now() < deadline) {
    attempt++;
    try {
      const res = await fetchImpl(`${url}/api/health?jb_probe=${Date.now()}`, { cache: "no-store", signal });
      last = res.status;
      if (res.ok) {
        const data = await res.json().catch(() => null);
        if (data && data.ok) return { ok: true, ms: Date.now() - started, status: res.status };
      }
      if (attempt === 1) emit({ type: "event", key: "health.waiting", data: {} });
    } catch (err) {
      if (signal && signal.aborted) throw err;
      last = last || "network";
    }
    await new Promise((r) => setTimeout(r, 4000));
    emit({ type: "wait", attempt });
  }
  return { ok: false, status: last };
}
