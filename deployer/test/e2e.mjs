#!/usr/bin/env node
/**
 * End-to-end test of the deployer pipeline against a locally running deployer Worker
 * (`wrangler dev`) and a real Cloudflare account.
 *
 *   CFT=<api token> ACC=<account id> SUB=<workers.dev subdomain> \
 *     node deployer/test/e2e.mjs [--base http://127.0.0.1:8799] [--name jb-router-test] [--no-deploy]
 *
 * It exercises the very same code the browser runs (deployer/static/pipeline.js).
 */
import { inflateRawSync } from "node:zlib";
import { runDeploy, STEPS, readZip, hashAsset, bytesToBase64, assetExt } from "../static/pipeline.js";

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, "").split("=");
  return [k, v === undefined ? true : v];
}));

const base = args.base || "http://127.0.0.1:8799";
const token = process.env.CFT;
const accountId = process.env.ACC;
const subdomain = process.env.SUB;
const name = args.name || "jb-router-test";
if (!token || !accountId || !subdomain) {
  console.error("need CFT, ACC, SUB env vars");
  process.exit(1);
}

const fetchImpl = (url, opts) => fetch(new URL(url, base), opts);
const inflateRaw = async (bytes) => new Uint8Array(inflateRawSync(bytes));

/* ---- sanity: zip reader + hashing against the real payload ---- */
const zip = new Uint8Array(await (await fetchImpl(base + "/bundle/assets.zip")).arrayBuffer());
const entries = await readZip(zip, inflateRaw);
console.log(`payload: ${entries.length} files, first=${entries[0].path}, bytes=${entries[0].bytes.length}`);
console.log(`hash probe ${hashAsset(new TextEncoder().encode("hello world from assets"), "/hello.txt")} (expect 8b2284184b10373595eab3bc2adfbed0)`);
console.log(`ext probe ${assetExt("/_next/static/chunks/a.b.js")} base64 probe ${bytesToBase64(new Uint8Array([104, 105]))}`);

if (args["no-deploy"]) process.exit(0);

/* ---- full deploy ---- */
const meta = await (await fetchImpl(base + "/api/meta")).json();
console.log("meta:", meta.release, meta.assetFiles, "files", meta.assetFiles && "");

const started = Date.now();
const seen = [];
const result = await runDeploy({
  cfToken: token,
  accountId,
  name,
  subdomain,
  jwtSecret: "e2e-" + Math.random().toString(36).slice(2, 18),
  password: "e2e-pass-" + Math.random().toString(36).slice(2, 12),
  release: meta.release,
  apiBase: base,
  fetchImpl,
  inflateRaw,
  onEvent: (event) => {
    seen.push(event);
    const el = ((Date.now() - started) / 1000).toFixed(1) + "s";
    if (event.type === "step") console.log(`  [${el}] step ${event.id}: ${event.state}${event.note ? " (" + event.note + ")" : ""}`);
    else if (event.type === "log") console.log(`  [${el}] log:`, event.text);
    else if (event.type === "progress" && event.total) process.stdout.write(`\r  ${event.id} ${event.received}/${event.total}   `);
  }
});

console.log("\nRESULT", JSON.stringify(result, null, 2), `in ${((Date.now() - started) / 1000).toFixed(1)}s`);
const failed = seen.filter((e) => e.type === "step" && e.state === "error");
console.log(failed.length ? "FAILED STEPS: " + JSON.stringify(failed) : "all steps ok");
