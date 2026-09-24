/**
 * Core of the JB-Router web deployer: reads the deploy payload, hashes the static assets
 * exactly like wrangler does, uploads them to the visitor's Cloudflare account and finally
 * asks the deployer Worker to push the bundled Worker + secrets.
 *
 * Runs in the browser (static assets) and in Node (integration test) — it only needs
 * fetch, DecompressionStream (overridable) and blake3.
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
  const total = Number(res.headers.get("content-length") || 0);
  if (!res.body || !onBytes) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const parts = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    received += value.length;
    onBytes(received, total);
  }
  const out = new Uint8Array(received);
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

/* ------------------------------------------------------------------ deploy */

export const STEPS = [
  { id: "verify", label: "بررسی توکن Cloudflare" },
  { id: "bundle", label: "دریافت بستهٔ نصب JB-Router" },
  { id: "hash", label: "محاسبهٔ هش فایل‌های استاتیک" },
  { id: "session", label: "ساخت نشست آپلود دارایی‌ها" },
  { id: "assets", label: "آپلود دارایی‌های استاتیک" },
  { id: "script", label: "نصب ورکر JB-Router" },
  { id: "secrets", label: "ثبت رمزها (JWT_SECRET / INITIAL_PASSWORD)" },
  { id: "enable", label: "فعال‌سازی آدرس workers.dev" },
  { id: "health", label: "تأیید سلامت نصب" }
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
 * @param {string} [opts.apiBase]    deployer Worker base url ("" = same origin)
 * @param {string} [opts.zipUrl]     payload url (default /bundle/assets.zip)
 * @param {string} [opts.mimeMapUrl]
 * @param {Function} [opts.fetchImpl]
 * @param {Function} [opts.inflateRaw]
 * @param {Function} [opts.onEvent]  ({type, ...}) progress callback
 * @param {AbortSignal} [opts.signal]
 */
export async function runDeploy(opts) {
  const {
    cfToken, accountId, name, subdomain, jwtSecret, password, release,
    apiBase = "", zipUrl = apiBase + "/bundle/assets.zip", mimeMapUrl = apiBase + "/bundle/mime-map.js",
    fetchImpl = fetch, inflateRaw = inflateRawStream, onEvent = () => {}, signal
  } = opts;

  const emit = (event) => { try { onEvent(event); } catch { /* ignore */ } };
  const log = (text) => emit({ type: "log", text });
  const step = (id, state, note) => emit({ type: "step", id, state, note });
  const fail = (id, message) => { emit({ type: "step", id, state: "error", note: "خطا" }); throw new DeployError(message); };

  /* 1. token ---------------------------------------------------------------- */
  step("verify", "active");
  const verified = await postJson(fetchImpl, apiBase, "/api/verify", { token: cfToken }, signal);
  if (verified.status !== "active") fail("verify", `وضعیت توکن Cloudflare «${verified.status}» است`);
  log(`توکن Cloudflare معتبر است (id ${String(verified.id).slice(0, 8)}…).`);
  step("verify", "done");

  /* 2. payload -------------------------------------------------------------- */
  step("bundle", "active");
  const meta = await (await fetchImpl(apiBase + "/api/meta", { signal })).json();
  const zipBytes = await downloadWithProgress(fetchImpl, zipUrl, (received, total) => {
    emit({ type: "progress", id: "bundle", received, total });
  }, signal);
  log(`بستهٔ نصب ${release || meta.release} دریافت شد (${(zipBytes.length / 1048576).toFixed(1)} مگابایت، ${meta.assetFiles} فایل).`);
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
    if (++index % 40 === 0 || index === entries.length) {
      emit({ type: "progress", id: "hash", received: index, total: entries.length });
    }
  }
  log(`${entries.length} فایل استاتیک هش شد (blake3، همان الگوریتم wrangler).`);
  step("hash", "done", `${entries.length} فایل`);

  /* 4. upload session ------------------------------------------------------- */
  step("session", "active");
  const session = await postJson(fetchImpl, apiBase, "/api/session", { token: cfToken, accountId, name, manifest }, signal);
  let assetsJwt = session.jwt;
  const buckets = session.buckets || [];
  const pending = buckets.reduce((n, bucket) => n + bucket.length, 0);
  log(`نشست آپلود ساخته شد؛ ${pending} فایل تازه برای آپلود.`);
  step("session", "done");

  /* 5. asset buckets -------------------------------------------------------- */
  step("assets", "active");
  let uploaded = 0;
  for (let i = 0; i < buckets.length; i++) {
    const form = new FormData();
    for (const hash of buckets[i]) {
      const file = byHash.get(hash);
      if (!file) fail("assets", `فایل ناشناخته در نشست آپلود: ${hash}`);
      form.append(hash, new File([bytesToBase64(file.bytes)], hash, { type: mimeFor(file.path, mimeMap) }), hash);
    }
    // No content-type header here on purpose: fetch adds it together with the boundary that
    // matches the body it serialises, and the deployer Worker forwards it verbatim.
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
      fail("assets", `آپلود دارایی‌ها ناموفق بود: ${(data && data.error) || "HTTP " + res.status}`);
    }
    if (data.jwt) assetsJwt = data.jwt;
    uploaded += buckets[i].length;
    emit({ type: "progress", id: "assets", received: uploaded, total: pending });
    log(`بخش ${i + 1}/${buckets.length} آپلود شد (${uploaded}/${pending} فایل).`);
  }
  if (!assetsJwt) fail("assets", "سرور آپلود، توکن نهایی دارایی‌ها را برنگرداند");
  assetsJwt = String(assetsJwt).replace(/^cfwau_/, "");
  if (!pending) log("همهٔ دارایی‌ها از قبل روی این حساب موجود بودند.");
  step("assets", "done", `${entries.length} فایل`);

  /* 6. worker script -------------------------------------------------------- */
  step("script", "active");
  const script = await postJson(fetchImpl, apiBase, "/api/script", {
    token: cfToken, accountId, name, assetsJwt, jwtSecret, password
  }, signal);
  log(`ورکر «${script.id}» نصب شد (deployment ${String(script.deploymentId).slice(0, 8)}…، assets: ${script.hasAssets}).`);
  step("script", "done", "worker + assets");

  /* 7. secrets -------------------------------------------------------------- */
  step("secrets", "active");
  const secrets = await postJson(fetchImpl, apiBase, "/api/secrets", {
    token: cfToken, accountId, name,
    secrets: [
      { name: "JWT_SECRET", text: jwtSecret },
      { name: "INITIAL_PASSWORD", text: password }
    ]
  }, signal);
  log(`رمزها ثبت شدند: ${secrets.stored.join(", ")}.`);
  step("secrets", "done");

  /* 8. workers.dev ---------------------------------------------------------- */
  step("enable", "active");
  await postJson(fetchImpl, apiBase, "/api/enable", { token: cfToken, accountId, name }, signal);
  const url = `https://${name}.${subdomain}.workers.dev`;
  log(`آدرس عمومی فعال شد: ${url}`);
  step("enable", "done");

  /* 9. health --------------------------------------------------------------- */
  step("health", "active");
  const health = await waitForHealth({ fetchImpl, url, signal, log, emit });
  step("health", health.ok ? "done" : "error", health.ok ? `${health.ms}ms` : "بی‌پاسخ");

  const result = {
    name, url, loginUrl: url + "/login", apiBaseUrl: url + "/v1",
    health: health.ok ? "ok" : "unknown", status: health.status || 0, accountId, release: release || meta.release
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
 * (A server-side probe from the deployer Worker would not work: requests to *.workers.dev
 * made *from inside* Cloudflare resolve against the local worker registry and 404 with 1042.)
 */
async function waitForHealth({ fetchImpl, url, signal, log, emit }) {
  const started = Date.now();
  const deadline = started + 5 * 60 * 1000;
  let attempt = 0;
  let last = null;
  let announced = false;
  while (Date.now() < deadline) {
    attempt++;
    try {
      const res = await fetchImpl(`${url}/api/health?jb_probe=${Date.now()}`, { cache: "no-store", signal });
      last = res.status;
      if (res.ok) {
        const data = await res.json().catch(() => null);
        if (data && data.ok) return { ok: true, ms: Date.now() - started, status: res.status };
      }
      if (!announced) {
        log("ورکر نصب شد؛ آدرس عمومی هنوز در حال فعال شدن است، چند لحظه صبر می‌کنیم…");
        announced = true;
      }
    } catch (err) {
      if (signal && signal.aborted) throw err;
      last = last || "network";
    }
    await new Promise((r) => setTimeout(r, 4000));
    emit({ type: "wait", attempt });
  }
  log(`پاسخ سلامت تا پایان زمان انتظار نرسید (آخرین وضعیت: ${last ?? "بی‌پاسخ"}).`);
  return { ok: false, status: last };
}
