#!/usr/bin/env node
/**
 * Builds the payload the JB-Router web deployer ships to a visitor's Cloudflare account:
 *
 *   deployer/static/bundle/worker.js    bundled JB-Router Worker module (streamed on upload)
 *   deployer/static/bundle/assets.zip   .open-next/assets/**, ready to unzip in the browser
 *   deployer/static/bundle/parts.bin    pre-built multipart sections, one per asset file
 *   deployer/static/bundle/manifest.json hash/size/offset index of those sections
 *   deployer/static/bundle/meta.json    release, sizes, compatibility date/flags
 *   deployer/static/bundle/mime-map.js  extension → content-type for the asset parts
 *
 * `parts.bin` is what makes the install fast: the deployer Worker streams byte ranges of it
 * straight into Cloudflare's asset-upload endpoint, so the visitor's browser never downloads
 * or uploads the asset payload at all (Cloudflare's API has no CORS, so the browser could not
 * talk to it directly anyway). The base64 encoding Cloudflare requires is done here, at build
 * time, so no Worker CPU is spent per install.
 *
 * Run from the repository root:  node deployer/build/make-bundle.mjs [--release vX.Y.Z]
 *
 * The bundled module comes from `wrangler deploy --dry-run`, i.e. exactly the module wrangler
 * would upload. The mime map mirrors what wrangler sends as each asset part's content-type
 * (unknown extensions become "application/null").
 */
import { execFileSync } from "node:child_process";
import { blake3 } from "../static/vendor/blake3.js";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const outDir = path.join(root, "deployer", "static", "bundle");
const tmp = path.join(root, ".deployer-build");
const release = (() => {
  const i = process.argv.indexOf("--release");
  return i > -1 ? process.argv[i + 1] : "v0.5.86";
})();

const BUNDLE_ASSET = "jb-router-" + release + "-opennext-bundle.zip";
const MIME_FALLBACK = "application/null";

function sh(cmd, args, opts = {}) {
  console.log("[build]", cmd, args.join(" "));
  return execFileSync(cmd, args, { stdio: "inherit", cwd: root, ...opts });
}

/** Same asset hash wrangler uses (and the browser computes): blake3(base64 + extension)[:32]. */
function hashAsset(bytes, assetPath) {
  const base64 = Buffer.from(bytes).toString("base64");
  const dot = assetPath.lastIndexOf(".");
  const ext = dot > -1 ? assetPath.slice(dot + 1).toLowerCase() : "";
  return Buffer.from(blake3(new TextEncoder().encode(base64 + ext))).toString("hex").slice(0, 32);
}

function walk(dir, base = dir, out = []) {
  for (const name of readdirSync(dir)) {
    const abs = path.join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) walk(abs, base, out);
    else if (st.isFile()) out.push(path.relative(base, abs));
  }
  return out;
}

mkdirSync(outDir, { recursive: true });
mkdirSync(tmp, { recursive: true });

/* 1. bundled Worker module -------------------------------------------------- */
const bundleDir = path.join(tmp, "worker");
const modulePath = path.join(bundleDir, "cloudflare-worker.js");
const servedModule = path.join(outDir, "worker.js");
const wranglerBin = path.join(root, "node_modules", ".bin", "wrangler");
if (existsSync(wranglerBin)) {
  sh(wranglerBin, ["deploy", "--dry-run", "--outdir", bundleDir, "--config", "wrangler.jsonc"]);
  if (!existsSync(modulePath)) throw new Error("wrangler did not produce " + modulePath);
  // served as-is and streamed into the Cloudflare upload request by the deployer Worker
  copyFileSync(modulePath, servedModule);
} else if (existsSync(servedModule)) {
  console.warn("[build] wrangler is not installed locally — reusing the existing bundle/worker.js");
} else {
  throw new Error("run `npm ci` first (or pass a prebuilt bundle/worker.js) — wrangler is missing");
}

/* 2. assets zip ------------------------------------------------------------- */
const assetsDir = path.join(root, ".open-next", "assets");
if (!existsSync(assetsDir)) throw new Error("missing " + assetsDir + " — build the app first");
const assetsZip = path.join(outDir, "assets.zip");
try {
  sh("zip", ["-r", "-q", "-X", "-9", assetsZip, "."], { cwd: assetsDir });
} catch {
  if (existsSync(assetsZip)) {
    console.warn("[build] `zip` unavailable — keeping the existing bundle/assets.zip");
  } else {
    // last resort: a stored-only archive written in Node (bigger, still valid)
    console.warn("[build] `zip` unavailable — writing a stored-only archive with Node");
    writeFileSync(assetsZip, zipSync(assetsDir, walk(assetsDir)));
  }
}

/* 3. mime map + metadata ---------------------------------------------------- */
let mimeLookup = null;
try {
  const mime = await import("mime");
  mimeLookup = (ext) => mime.default?.getType?.(ext) || mime.getType?.(ext) || null;
} catch {
  console.warn("[build] `mime` package unavailable — using the built-in map");
}

const BUILTIN = {
  js: "text/javascript", mjs: "text/javascript", cjs: "text/javascript",
  css: "text/css", html: "text/html", htm: "text/html",
  json: "application/json", map: "application/json", txt: "text/plain",
  xml: "application/xml", svg: "image/svg+xml", ico: "image/x-icon",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", avif: "image/avif", bmp: "image/bmp",
  woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf",
  eot: "application/vnd.ms-fontobject", wasm: "application/wasm", pdf: "application/pdf",
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
  csv: "text/csv", md: "text/markdown", webmanifest: "application/manifest+json",
  vtt: "text/vtt", zip: "application/zip", gz: "application/gzip"
};

const files = walk(assetsDir);
const mimeMap = {};
for (const rel of files) {
  const ext = path.extname(rel).slice(1).toLowerCase();
  if (!ext || mimeMap[ext]) continue;
  if (mimeLookup) {
    const type = mimeLookup(ext);
    if (type) { mimeMap[ext] = type; continue; }
  }
  mimeMap[ext] = BUILTIN[ext] || MIME_FALLBACK;
}
writeFileSync(path.join(outDir, "mime-map.js"), "window.JB_MIME = " + JSON.stringify(mimeMap) + ";\n");

/* 4. pre-built multipart chunks (server-side upload fast path) --------------- */

const BOUNDARY = "jbrouterassetsboundary";
const CHUNK_TARGET = 2 * 1024 * 1024;   // section bytes per chunk file
const chunkDir = path.join(outDir, "chunks");
rmSync(chunkDir, { recursive: true, force: true });
mkdirSync(chunkDir, { recursive: true });

const sizes = {};
const entries = [];
const chunks = [];
let pending = [];
let pendingBytes = 0;

function flush() {
  if (!pending.length) return;
  const name = `chunk-${String(chunks.length).padStart(3, "0")}.bin`;
  writeFileSync(path.join(chunkDir, name), Buffer.concat(pending));
  chunks.push({ path: `chunks/${name}`, bytes: pendingBytes, files: pending.length, hashes: pendingHashes });
  pending = [];
  pendingHashes = [];
  pendingBytes = 0;
}
let pendingHashes = [];

for (const rel of files) {
  const assetPath = "/" + rel.split(path.sep).join("/");
  const data = readFileSync(path.join(assetsDir, rel));
  const hash = hashAsset(data, assetPath);
  const ext = path.extname(rel).slice(1).toLowerCase();
  const section = Buffer.from(
    `--${BOUNDARY}\r\n` +
    `content-disposition: form-data; name="${hash}"; filename="${hash}"\r\n` +
    `content-type: ${mimeMap[ext] || MIME_FALLBACK}\r\n\r\n` +
    data.toString("base64") + "\r\n"
  );
  sizes[hash] = data.length;
  entries.push({ path: assetPath, hash, size: data.length });
  pending.push(section);
  pendingHashes.push(hash);
  pendingBytes += section.length;
  if (pendingBytes >= CHUNK_TARGET) flush();
}
flush();

writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify({
  release,
  boundary: BOUNDARY,
  tail: `--${BOUNDARY}--\r\n`,
  files: files.length,
  bytes: Object.values(sizes).reduce((n, size) => n + Math.ceil((size * 4) / 3) + 512, 0),
  chunks,
  sizes,
  entries
}) + "\n");

const totalBytes = files.reduce((n, f) => n + statSync(path.join(assetsDir, f)).size, 0);
const meta = {
  release,
  bundleAsset: BUNDLE_ASSET,
  moduleBytes: statSync(servedModule).size,
  moduleServedBytes: statSync(servedModule).size,
  assetFiles: files.length,
  assetBytes: totalBytes,
  assetsZipBytes: statSync(assetsZip).size,
  compatibilityDate: "2025-09-23",
  compatibilityFlags: ["nodejs_compat"],
  chunks: chunks.length,
  chunksBytes: chunks.reduce((n, c) => n + c.bytes, 0),
  streaming: true,
  builtAt: new Date().toISOString()
};
writeFileSync(path.join(outDir, "meta.json"), JSON.stringify(meta, null, 2) + "\n");
console.log("[build] done:", JSON.stringify(meta, null, 2));
