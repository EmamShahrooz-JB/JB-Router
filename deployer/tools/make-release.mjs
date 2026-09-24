#!/usr/bin/env node
/**
 * Packages the deploy-ready GitHub release asset:
 *
 *   jb-router-v<version>-opennext-bundle.zip
 *     ├── .open-next/**            the full OpenNext output (worker + assets + server functions)
 *     ├── cloudflare-worker.js     the Worker entry point wrangler uploads
 *     ├── wrangler.jsonc           bindings, Durable Object class, migrations, compat date
 *     └── RELEASE.md               the three commands needed to run it
 *
 * Run from the repository root after `npm run workers:build`:
 *
 *   node deployer/tools/make-release.mjs [--release v0.5.87] [--out dist]
 *
 * Entries are deflated with node:zlib (no external `zip` binary), so the archive is built
 * the same way everywhere and can be re-created from an identical build input.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import path from "node:path";

const root = process.cwd();
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(name);
  return i > -1 ? args[i + 1] : fallback;
};

const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const version = String(arg("--release", `v${pkg.version}`)).replace(/^v/, "");
const outDir = path.resolve(root, arg("--out", "dist"));
const zipPath = path.join(outDir, `jb-router-v${version}-opennext-bundle.zip`);

for (const rel of [".open-next/worker.js", "cloudflare-worker.js", "wrangler.jsonc"]) {
  try {
    statSync(path.join(root, rel));
  } catch {
    console.error(`[release] missing ${rel} — run \`npm run workers:build\` first`);
    process.exit(1);
  }
}

const RELEASE_MD = `# JB-Router v${version} — deploy-ready bundle

This archive is a complete build of JB-Router, the router app that runs entirely on
Cloudflare Workers. To run it on your own Cloudflare account:

\`\`\`bash
unzip jb-router-v${version}-opennext-bundle.zip -d jb-router && cd jb-router
npx wrangler secret put JWT_SECRET          # any long random string
npx wrangler secret put INITIAL_PASSWORD    # the dashboard password
npx wrangler deploy --autoconfig=false
\`\`\`

The installer at https://jb-deployer.jb-router.workers.dev does exactly these steps for you,
including the assets upload and the Durable Object migration.

Everything the app stores (providers, keys, usage, settings) lives in the \`RouterDatabase\`
Durable Object on your own account — nothing is sent to the project maintainers.
`;

/* ---- collect entries ---- */
const entries = [
  { name: "RELEASE.md", data: new Uint8Array(Buffer.from(RELEASE_MD)) },
  { name: "cloudflare-worker.js", data: new Uint8Array(readFileSync(path.join(root, "cloudflare-worker.js"))) },
  { name: "wrangler.jsonc", data: new Uint8Array(readFileSync(path.join(root, "wrangler.jsonc"))) },
];

(function collect(dir) {
  const items = readdirSync(path.join(root, dir), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const item of items) {
    const rel = `${dir}/${item.name}`;
    if (item.isDirectory()) collect(rel);
    else entries.push({ name: rel, data: new Uint8Array(readFileSync(path.join(root, rel))) });
  }
})(".open-next");

/* ---- minimal deflate zip writer ---- */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();
function crc32(bytes) {
  let crc = -1;
  for (let i = 0; i < bytes.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

const encoder = new TextEncoder();
const locals = [];
const centrals = [];
let offset = 0;
for (const entry of entries) {
  const nameBytes = encoder.encode(entry.name);
  const crc = crc32(entry.data);
  const deflated = deflateRawSync(entry.data, { level: 9 });
  const useDeflate = deflated.length < entry.data.length;
  const payload = useDeflate ? new Uint8Array(deflated) : entry.data;

  const local = new Uint8Array(30 + nameBytes.length);
  const lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true);
  lv.setUint16(4, 20, true);
  lv.setUint16(6, 0, true);
  lv.setUint16(8, useDeflate ? 8 : 0, true);
  lv.setUint16(10, 0, true);
  lv.setUint16(12, 0x2821, true); // 2000-01-01, fixed for reproducibility
  lv.setUint32(14, crc, true);
  lv.setUint32(18, payload.length, true);
  lv.setUint32(22, entry.data.length, true);
  lv.setUint16(26, nameBytes.length, true);
  lv.setUint16(28, 0, true);
  local.set(nameBytes, 30);
  locals.push(local, payload);

  const central = new Uint8Array(46 + nameBytes.length);
  const cv = new DataView(central.buffer);
  cv.setUint32(0, 0x02014b50, true);
  cv.setUint16(4, 20, true);
  cv.setUint16(6, 20, true);
  cv.setUint16(8, 0, true);
  cv.setUint16(10, useDeflate ? 8 : 0, true);
  cv.setUint16(12, 0, true);
  cv.setUint16(14, 0x2821, true);
  cv.setUint32(16, crc, true);
  cv.setUint32(20, payload.length, true);
  cv.setUint32(24, entry.data.length, true);
  cv.setUint16(28, nameBytes.length, true);
  cv.setUint32(42, offset, true);
  central.set(nameBytes, 46);
  centrals.push(central);

  offset += local.length + payload.length;
}

const centralSize = centrals.reduce((n, c) => n + c.length, 0);
const end = new Uint8Array(22);
const ev = new DataView(end.buffer);
ev.setUint32(0, 0x06054b50, true);
ev.setUint16(8, entries.length, true);
ev.setUint16(10, entries.length, true);
ev.setUint32(12, centralSize, true);
ev.setUint32(16, offset, true);

const zip = Buffer.concat([...locals, ...centrals, end].map((part) => Buffer.from(part)));
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
writeFileSync(zipPath, zip);

const digest = createHash("sha256").update(zip).digest("hex");
const mb = (n) => `${(n / 1048576).toFixed(2)} MB`;
const rawBytes = entries.reduce((n, e) => n + e.data.length, 0);
console.log(`[release] ${path.relative(root, zipPath)}`);
console.log(`[release] ${entries.length} files · raw ${mb(rawBytes)} → zip ${mb(zip.length)}`);
console.log(`[release] sha256 ${digest}`);
writeFileSync(`${zipPath}.sha256`, `${digest}  ${path.basename(zipPath)}\n`);
