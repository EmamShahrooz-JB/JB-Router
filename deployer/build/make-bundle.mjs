#!/usr/bin/env node
/**
 * Builds the payload the JB-Router web deployer ships to a visitor's Cloudflare account:
 *
 *   deployer/static/bundle/worker.js      bundled JB-Router Worker module (raw)
 *   deployer/static/bundle/assets.zip     .open-next/assets/**, ready to unzip in the browser
 *   deployer/static/bundle/meta.json      release tag, sizes, and the mime map used for uploads
 *
 * Run from the repository root:  node deployer/build/make-bundle.mjs [--release vX.Y.Z]
 *
 * The bundled module is produced by `wrangler deploy --dry-run`, i.e. exactly the same
 * module wrangler would upload. The mime map mirrors what wrangler sends as the part
 * content-type for each static asset (unknown extensions become "application/null").
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { copyFileSync } from "node:fs";
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
sh("npx", ["--no-install", "wrangler", "deploy", "--dry-run", "--outdir", bundleDir, "--config", "wrangler.jsonc"]);
const modulePath = path.join(bundleDir, "cloudflare-worker.js");
if (!existsSync(modulePath)) throw new Error("wrangler did not produce " + modulePath);
// served as-is and streamed into the Cloudflare upload request by the deployer Worker
copyFileSync(modulePath, path.join(outDir, "worker.js"));

/* 2. assets zip ------------------------------------------------------------- */
const assetsDir = path.join(root, ".open-next", "assets");
if (!existsSync(assetsDir)) throw new Error("missing " + assetsDir + " — build the app first");
const assetsZip = path.join(outDir, "assets.zip");
try {
  sh("zip", ["-r", "-q", "-X", "-9", assetsZip, "."], { cwd: assetsDir });
} catch {
  // zip not available: fall back to a stored-only archive via Node
  console.warn("[build] `zip` unavailable — writing archive with Node");
  const { zipSync } = await import("./zip-writer.mjs");
  writeFileSync(assetsZip, zipSync(assetsDir, walk(assetsDir)));
}

/* 3. mime map + metadata ---------------------------------------------------- */
let mimeLookup = null;
try {
  const mime = await import("mime");
  mimeLookup = (ext) => mime.default?.getType?.(ext) || mime.getType?.(ext) || null;
} catch {
  console.warn("[build] `mime` package unavailable — using built-in map");
}

const BUILTIN = {
  js: "text/javascript", mjs: "text/javascript", cjs: "text/javascript",
  css: "text/css", html: "text/html", htm: "text/html",
  json: "application/json", map: "application/json", txt: "text/plain",
  xml: "application/xml", svg: "image/svg+xml", ico: "image/x-icon",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", avif: "image/avif", bmp: "image/bmp",
  woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf", eot: "application/vnd.ms-fontobject",
  wasm: "application/wasm", pdf: "application/pdf",
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
    const t = mimeLookup(ext);
    if (t) { mimeMap[ext] = t; continue; }
  }
  if (BUILTIN[ext]) mimeMap[ext] = BUILTIN[ext];
  else mimeMap[ext] = MIME_FALLBACK;
}
writeFileSync(path.join(outDir, "mime-map.js"), "window.JB_MIME = " + JSON.stringify(mimeMap, null, 0) + ";\n");

const totalBytes = files.reduce((n, f) => n + statSync(path.join(assetsDir, f)).size, 0);
const meta = {
  release,
  bundleAsset: BUNDLE_ASSET,
  moduleBytes: statSync(path.join(bundleDir, "cloudflare-worker.js")).size,
  moduleServedBytes: statSync(path.join(outDir, "worker.js")).size,
  assetFiles: files.length,
  assetBytes: totalBytes,
  assetsZipBytes: statSync(assetsZip).size,
  compatibilityDate: "2025-09-23",
  compatibilityFlags: ["nodejs_compat"],
  builtAt: new Date().toISOString()
};
writeFileSync(path.join(outDir, "meta.json"), JSON.stringify(meta, null, 2) + "\n");
console.log("[build] done:", JSON.stringify(meta, null, 2));
