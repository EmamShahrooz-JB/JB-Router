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

/**
 * POST a FormData body and report upload progress. Browsers can only report upload progress
 * through XMLHttpRequest, so the page uses that; Node (tests) falls back to fetch.
 */
async function uploadRequest({ url, headers, body, signal, onProgress }) {
  if (typeof XMLHttpRequest === "function") {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url);
      for (const [key, value] of Object.entries(headers || {})) xhr.setRequestHeader(key, value);
      if (onProgress && xhr.upload) {
        xhr.upload.addEventListener("progress", (e) => onProgress(e.loaded, e.total || 0));
      }
      xhr.addEventListener("load", () => resolve({ status: xhr.status, text: xhr.responseText || "" }));
      xhr.addEventListener("error", () => reject(new DeployError("network error while uploading the assets")));
      xhr.addEventListener("abort", () => reject(new DeployError("upload aborted")));
      if (signal) signal.addEventListener("abort", () => xhr.abort(), { once: true });
      xhr.send(body);
    });
  }
  const res = await fetch(url, { method: "POST", headers, body, signal });
  return { status: res.status, text: await res.text() };
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

/** Hash → size index of the deployer's own pre-encoded asset sections (fast path only). */
export async function getBundleManifest({ apiBase = "", fetchImpl = fetch, signal }) {
  const res = await fetchImpl(apiBase + "/api/manifest", { signal });
  if (!res.ok) throw new DeployError(`could not read the deployer manifest (HTTP ${res.status})`);
  return res.json();
}

/* ------------------------------------------------------------------ deploy */

export const STEPS = [
  "verify", "bundle", "hash", "session", "assets", "script", "secrets", "enable", "files", "health"
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
    cfToken, accountId, name, subdomain, jwtSecret, password, release, dryRun = false, preserveSecrets = false,
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
  // Fast path: the deployer Worker streams the asset sections straight into Cloudflare, so
  // the browser never downloads or uploads the ~10 MB of static assets.
  const meta = await (await fetchImpl(apiBase + "/api/meta", { signal })).json();
  if (meta.streaming) {
    return runStreamingDeploy({
      cfToken, accountId, name, subdomain, jwtSecret, password, preserveSecrets, release: release || meta.release,
      apiBase, fetchImpl, onEvent, signal
    });
  }

  step("bundle", "active");
  const zipBytes = await downloadWithProgress(fetchImpl, zipUrl, (received) => {
    emit({ type: "progress", id: "bundle", received, total: meta.assetsZipBytes || 0 });
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
  const jobs = buckets.map((hashes) => {
    let size = 0;
    for (const hash of hashes) {
      const file = byHash.get(hash);
      if (!file) fail("assets", `Asset requested by the upload session is missing: ${hash}`);
      size += file.bytes.length;
    }
    return { hashes, size, sent: 0 };
  });
  const totalBytes = jobs.reduce((n, job) => n + job.size, 0);
  let uploadedBytes = 0;
  const uploadUrl = `${apiBase}/api/assets-upload?account=${encodeURIComponent(accountId)}&name=${encodeURIComponent(name)}`;

  const sendBucket = async (job) => {
    const form = new FormData();
    for (const hash of job.hashes) {
      const file = byHash.get(hash);
      form.append(hash, new File([bytesToBase64(file.bytes)], hash, { type: mimeFor(file.path, mimeMap) }), hash);
    }
    const res = await uploadRequest({
      url: uploadUrl,
      headers: { "x-cf-token": cfToken, "x-assets-jwt": assetsJwt },
      body: form,
      signal,
      onProgress: (loaded) => {
        uploadedBytes += loaded - job.sent;
        job.sent = loaded;
        emit({ type: "progress", id: "assets", received: uploadedBytes, total: totalBytes });
      }
    });
    let data = null;
    try { data = res.text ? JSON.parse(res.text) : null; } catch { data = null; }
    if (res.status < 200 || res.status >= 300 || !data || data.ok !== true) {
      const message = (data && data.error) || `HTTP ${res.status}${res.text ? " " + res.text.slice(0, 160) : ""}`;
      throw new DeployError(`Asset upload failed: ${message}`, res.status);
    }
    if (data.jwt) assetsJwt = data.jwt;
  };

  // Uploading three buckets at once is much faster on high-latency links; a bucket that
  // fails (e.g. because the session token rotated) is retried once with the newest token.
  let cursor = 0;
  const drain = async () => {
    while (cursor < jobs.length) {
      const index = cursor++;
      const job = jobs[index];
      try {
        await sendBucket(job);
      } catch (firstError) {
        try {
          await sendBucket(job);
        } catch {
          fail("assets", firstError.message);
        }
      }
      event("assets.bucket", { index: index + 1, buckets: jobs.length, uploaded: uploadedBytes, pending: totalBytes });
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, jobs.length) }, drain));

  /* Cloudflare answers the odd request with 10013 "unknown error" or an HTML 503 page while an
   * edge is busy streaming a deploy; those are transient, so the step is simply repeated. */
  const postJsonRetry = async (path, body, stepId, attempts = 6) => {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await postJson(fetchImpl, apiBase, path, body, signal);
      } catch (error) {
        const status = error && error.status;
        const message = String((error && error.message) || error);
        const transient = !status || status >= 500 || status === 429 || /10013|unknown error/i.test(message);
        if (!transient || attempt >= attempts) {
          if (transient) throw new DeployError("Cloudflare kept answering " + (status || "with an error") + " — please run the install again.", status);
          throw error;
        }
        event("retry", { path, attempt, status: status || 0 });
        step(stepId, "active", `Cloudflare is busy — retrying (${attempt}/${attempts - 1})`);
        await new Promise((resolve) => setTimeout(resolve, Math.min(2000 + 3000 * attempt, 15000)));
      }
    }
  };

  if (!assetsJwt) fail("assets", "Cloudflare did not return the asset upload JWT.");
  assetsJwt = String(assetsJwt).replace(/^cfwau_/, "");
  event("assets.ok", { total: entries.length, pending });
  step("assets", "done", String(entries.length));

  /* 6. worker script -------------------------------------------------------- */
  step("script", "active");
  // An update keeps the secrets already on the account: the dashboard password and the session
  // secret of a running installation must survive a code update, so they are not even sent.
  const scriptBody = { token: cfToken, accountId, name, assetsJwt, preserveSecrets };
  if (!preserveSecrets) {
    scriptBody.jwtSecret = jwtSecret;
    scriptBody.password = password;
  }
  const script = await postJsonRetry("/api/script", scriptBody, "script");
  event("script.ok", { name: script.id, deploymentId: script.deploymentId, hasAssets: script.hasAssets });
  step("script", "done");

  /* 7. secrets -------------------------------------------------------------- */
  step("secrets", "active");
  const secrets = preserveSecrets
    ? { stored: [] }
    : await postJson(fetchImpl, apiBase, "/api/secrets", {
        token: cfToken, accountId, name,
        secrets: [
          { name: "JWT_SECRET", text: jwtSecret },
          { name: "INITIAL_PASSWORD", text: password }
        ]
      }, signal);
  event("secrets.ok", { stored: secrets.stored, preserved: preserveSecrets });
  step("secrets", "done");

  /* 8. workers.dev ---------------------------------------------------------- */
  step("enable", "active");
  await postJson(fetchImpl, apiBase, "/api/enable", { token: cfToken, accountId, name }, signal);
  const url = `https://${name}.${subdomain}.workers.dev`;
  event("enable.ok", { url });
  step("enable", "done");

  /* Asset completeness, decided by Cloudflare itself. Asking for a fresh upload session over the
   * same manifest returns the parts Cloudflare still considers missing, so this is the only
   * trustworthy completeness signal available to the page: probing the freshly deployed Worker
   * is not possible (its host sends no CORS headers, and Cloudflare refuses Worker→Worker
   * fetches with error 1042) and would be wrong anyway while a new deployment propagates.
   * Whatever is still missing is uploaded and deployed again instead of shipping a panel that
   * 404s a page. */
  step("files", "active");
  let missingAssets = 0;
  try {
    let state = await postJsonRetry("/api/session-bundle", { token: cfToken, accountId, name }, "files");
    for (let attempt = 0; attempt < 3 && (state.pendingFiles || 0) > 0; attempt += 1) {
      const count = state.pendingFiles || 0;
      event("files.repair", { missing: count, attempt: attempt + 1 });
      step("files", "active", `re-uploading ${count} missing file(s)`);
      if (state.jwt) assetsJwt = state.jwt;
      await drain(state.uploads || []);
      const repairBody = {
        token: cfToken, accountId, name, preserveSecrets,
        assetsJwt: String(assetsJwt).replace(/^cfwau_/, "")
      };
      if (!preserveSecrets) {
        repairBody.jwtSecret = jwtSecret;
        repairBody.password = password;
      }
      const repaired = await postJsonRetry("/api/script", repairBody, "files");
      event("files.redeployed", { deploymentId: repaired.deploymentId, attempt: attempt + 1 });
      await new Promise((resolve) => setTimeout(resolve, 2500));
      state = await postJsonRetry("/api/session-bundle", { token: cfToken, accountId, name }, "files");
    }
    missingAssets = state.pendingFiles || 0;
  } catch (error) {
    if (error instanceof DeployError) throw error;
    event("files.skipped", { message: String((error && error.message) || error) });
  }
  event("files.check", { total: index.files, missing: missingAssets });
  step("files", missingAssets ? "error" : "done", missingAssets ? `${missingAssets} missing` : String(index.files));

  /* 9. health --------------------------------------------------------------- */
  step("health", "active");
  const health = await waitForHealth({ fetchImpl, url, signal, emit });
  step("health", health.ok ? "done" : "error", health.ok ? `${health.ms}` : "timeout");
  event(health.ok ? "health.ok" : "health.timeout", { ms: health.ms, status: health.status });

  const result = {
    name, url, loginUrl: url + "/login", apiBaseUrl: url + "/v1",
    health: health.ok ? "ok" : "unknown", status: health.status || 0,
    accountId, release: release || meta.release,
    password: preserveSecrets ? null : password, secretsPreserved: preserveSecrets
  };
  emit({ type: "result", result });
  return result;
}

/** Keeps polling after the foreground wait expired and reports success whenever it lands. */
async function continueHealthInBackground({ fetchImpl, url, signal, emit, started, deadline }) {
  while (Date.now() < deadline) {
    try {
      const res = await fetchImpl(`${url}/api/health?jb_probe=${Date.now()}`, { cache: "no-store", signal });
      if (res.ok) {
        const data = await res.json().catch(() => null);
        if (data && data.ok) {
          emit({ type: "event", key: "health.late", data: { ms: Date.now() - started } });
          return;
        }
      }
    } catch { /* keep trying */ }
    await new Promise((r) => setTimeout(r, 5000));
  }
  emit({ type: "event", key: "health.giveup", data: { ms: Date.now() - started } });
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
async function waitForHealth({ fetchImpl, url, signal, emit, foregroundMs = 0 }) {
  const started = Date.now();
  const deadline = started + 3 * 60 * 1000;
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
      if (foregroundMs && Date.now() - started > foregroundMs) {
        // The deployment itself is done; only the workers.dev route is still warming up. Hand
        // control back to the caller and keep probing in the background so the page never
        // looks stuck for minutes on a slow edge.
        emit({ type: "event", key: "health.slow", data: { ms: Date.now() - started } });
        void continueHealthInBackground({ fetchImpl, url, signal, emit, started, deadline });
        return { ok: false, ms: Date.now() - started, status: res.status, pending: true };
      }
      }
      if (attempt === 1) emit({ type: "event", key: "health.waiting", data: {} });
    } catch (err) {
      if (signal && signal.aborted) throw err;
      last = last || "network";
    }
    await new Promise((r) => setTimeout(r, 2500));
    emit({ type: "wait", attempt });
  }
  return { ok: false, status: last };
}


/* ------------------------------------------------------------------ fast path */

/**
 * Server-side install: the browser sends only hash lists; every asset byte travels inside
 * Cloudflare (deployer Worker → assets upload endpoint) and the 21 MB module is streamed the
 * same way by /api/script. The visitor's connection carries a few kilobytes in total.
 */
async function runStreamingDeploy(opts) {
  const {
    cfToken, accountId, name, subdomain, jwtSecret, password, release, preserveSecrets = false,
    apiBase = "", fetchImpl = fetch, onEvent = () => {}, signal, foregroundMs = 0
  } = opts;

  const emit = (event) => { try { onEvent(event); } catch { /* ignore */ } };
  const event = (key, data) => emit({ type: "event", key, data });
  const step = (id, state, note) => emit({ type: "step", id, state, note });
  const fail = (id, message) => { emit({ type: "step", id, state: "error" }); event("failure", { id, message }); throw new DeployError(message); };

  /* payload index (a few kB) */
  step("bundle", "active");
  const index = await getBundleManifest({ apiBase, fetchImpl, signal });
  event("bundle.ok", { release: release || index.release, bytes: index.bytes, files: index.files, streamed: true });
  step("bundle", "done");

  /* upload session built from the deployer's own manifest */
  step("session", "active");
  const session = await postJson(fetchImpl, apiBase, "/api/session-bundle", { token: cfToken, accountId, name }, signal);
  let assetsJwt = session.jwt;
  const uploads = session.uploads || [];
  event("session.ok", {
    pending: session.pendingFiles || 0, buckets: uploads.length, files: index.files,
    pendingBytes: session.pendingBytes || 0, streamed: true, repair: !!session.repair
  });
  step("session", "done");

  /* Asset chunks, streamed inside Cloudflare. Uploaded one chunk at a time on purpose:
   * issuing several uploads into the same assets session concurrently makes Cloudflare
   * occasionally drop a file from a bucket without reporting an error, which leaves the
   * installed Worker with a missing chunk and a broken page. */
  step("assets", "active");
  let pending = session.pendingFiles || 0;
  const drain = async (list) => {
    const totalBytes = list.reduce((n, u) => n + u.bytes, 0);
    let uploadedBytes = 0;
    let done = 0;
    for (const item of list) {
      const result = await postJsonRetry("/api/upload-chunk", {
        token: cfToken, accountId, name, assetsJwt, chunk: item.index
      }, "assets");
      if (result.jwt) assetsJwt = result.jwt;
      uploadedBytes += item.bytes;
      done += 1;
      emit({ type: "progress", id: "assets", received: uploadedBytes, total: totalBytes });
      event("assets.chunk", { index: done, chunks: list.length, files: item.files });
      if (done < list.length) await new Promise((resolve) => setTimeout(resolve, 400));
    }
  };
  /* Cloudflare answers the odd request with 10013 "unknown error" or a 5xx when a burst of
   * installs hits it; those are transient, so the step is repeated instead of failing the
   * whole install on a hiccup. */
  const postJsonRetry = async (path, body, stepId, attempts = 6) => {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await postJson(fetchImpl, apiBase, path, body, signal);
      } catch (error) {
        const status = error && error.status;
        const message = String((error && error.message) || error);
        // Cloudflare answers 503/5xx with an HTML error page when the edge is busy streaming
        // a deploy; that is transient and the step is simply repeated.
        const transient = !status || status >= 500 || status === 429 || /10013|unknown error/i.test(message);
        if (!transient || attempt >= attempts) {
          if (transient) throw new DeployError("Cloudflare kept answering " + (status || "with an error") + " — please run the install again.", status);
          throw error;
        }
        event("retry", { path, attempt, status: status || 0 });
        step(stepId, "active", `Cloudflare is busy — retrying (${attempt}/${attempts - 1})`);
        await new Promise((resolve) => setTimeout(resolve, Math.min(2000 + 3000 * attempt, 15000)));
      }
    }
  };

  await drain(uploads);

  /* Completeness signal: Cloudflare only mints the "session complete" JWT (audience `ewc`) once
   * every part it asked for has landed. If that token never shows up, a part was dropped —
   * something the assets endpoint does not report as an error — so the parts are sent again
   * inside the same session instead of deploying a Worker with silently missing files.
   * The session JWT itself is never replaced: the deployment must reference the session the
   * parts were actually uploaded into. */
  const jwtAudience = (value) => {
    try {
      const payload = String(value).split(".")[1] || "";
      const padded = payload.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (payload.length % 4)) % 4);
      return JSON.parse(atob(padded)).aud || null;
    } catch {
      return null;
    }
  };
  let complete = !uploads.length || jwtAudience(assetsJwt) === "ewc";
  for (let attempt = 0; attempt < 3 && !complete; attempt += 1) {
    event("assets.retry", { attempt: attempt + 1, files: index.files });
    step("assets", "active", `re-sending ${uploads.length} parts (${attempt + 1})`);
    await drain(uploads);
    complete = jwtAudience(assetsJwt) === "ewc";
  }
  if (uploads.length && !complete) {
    fail("assets", "Cloudflare did not confirm the asset upload — the install would be missing files. Please run the install again.");
  }
  if (!assetsJwt) fail("assets", "Cloudflare did not return the asset upload JWT.");
  assetsJwt = String(assetsJwt).replace(/^cfwau_/, "");
  event("assets.ok", { total: index.files, pending: complete ? 0 : pending, streamed: true });
  step("assets", "done", String(index.files));

  /* worker module (streamed from the deployer's own assets), secrets, url */
  step("script", "active");
  const streamingScriptBody = { token: cfToken, accountId, name, assetsJwt, preserveSecrets };
  if (!preserveSecrets) {
    streamingScriptBody.jwtSecret = jwtSecret;
    streamingScriptBody.password = password;
  }
  const script = await postJsonRetry("/api/script", streamingScriptBody, "script");
  event("script.ok", { name: script.id, deploymentId: script.deploymentId, hasAssets: script.hasAssets });
  step("script", "done");

  step("secrets", "active");
  const secrets = preserveSecrets
    ? { stored: [] }
    : await postJson(fetchImpl, apiBase, "/api/secrets", {
        token: cfToken, accountId, name,
        secrets: [
          { name: "JWT_SECRET", text: jwtSecret },
          { name: "INITIAL_PASSWORD", text: password }
        ]
      }, signal);
  event("secrets.ok", { stored: secrets.stored, preserved: preserveSecrets });
  step("secrets", "done");

  step("enable", "active");
  await postJson(fetchImpl, apiBase, "/api/enable", { token: cfToken, accountId, name }, signal);
  const url = `https://${name}.${subdomain}.workers.dev`;
  event("enable.ok", { url });
  step("enable", "done");

  /* Asset completeness, decided by Cloudflare itself. Asking for a fresh upload session over the
   * same manifest returns the parts Cloudflare still considers missing, so this is the only
   * trustworthy completeness signal available to the page: probing the freshly deployed Worker
   * is not possible (its host sends no CORS headers, and Cloudflare refuses Worker→Worker
   * fetches with error 1042) and would be wrong anyway while a new deployment propagates.
   * Whatever is still missing is uploaded and deployed again instead of shipping a panel that
   * 404s a page. */
  step("files", "active");
  let missingAssets = 0;
  try {
    let state = await postJsonRetry("/api/session-bundle", { token: cfToken, accountId, name }, "files");
    for (let attempt = 0; attempt < 3 && (state.pendingFiles || 0) > 0; attempt += 1) {
      const count = state.pendingFiles || 0;
      event("files.repair", { missing: count, attempt: attempt + 1 });
      step("files", "active", `re-uploading ${count} missing file(s)`);
      if (state.jwt) assetsJwt = state.jwt;
      await drain(state.uploads || []);
      const repairBody = {
        token: cfToken, accountId, name, preserveSecrets,
        assetsJwt: String(assetsJwt).replace(/^cfwau_/, "")
      };
      if (!preserveSecrets) {
        repairBody.jwtSecret = jwtSecret;
        repairBody.password = password;
      }
      const repaired = await postJsonRetry("/api/script", repairBody, "files");
      event("files.redeployed", { deploymentId: repaired.deploymentId, attempt: attempt + 1 });
      await new Promise((resolve) => setTimeout(resolve, 2500));
      state = await postJsonRetry("/api/session-bundle", { token: cfToken, accountId, name }, "files");
    }
    missingAssets = state.pendingFiles || 0;
  } catch (error) {
    if (error instanceof DeployError) throw error;
    event("files.skipped", { message: String((error && error.message) || error) });
  }
  event("files.check", { total: index.files, missing: missingAssets });
  step("files", missingAssets ? "error" : "done", missingAssets ? `${missingAssets} missing` : String(index.files));

  /* health, polled from the visitor's browser (see waitForHealth) */
  step("health", "active");
  const health = await waitForHealth({ fetchImpl, url, signal, emit, foregroundMs });
  step("health", health.ok ? "done" : "error", health.ok ? `${health.ms}` : "timeout");
  event(health.ok ? "health.ok" : "health.timeout", { ms: health.ms, status: health.status });

  const result = {
    name, url, loginUrl: url + "/login", apiBaseUrl: url + "/v1",
    health: health.ok ? "ok" : "unknown", status: health.status || 0,
    accountId, release: release || index.release,
    password: preserveSecrets ? null : password, secretsPreserved: preserveSecrets, streamed: true
  };
  emit({ type: "result", result });
  return result;
}
