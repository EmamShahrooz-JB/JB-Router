#!/usr/bin/env node
/**
 * Runs the real wizard script (deployer/static/app.js) under a tiny DOM stub and drives the
 * full install flow through the page — token → account/subdomain resolution → Install →
 * terminal output → toasts. Works against any running deployer (local `wrangler dev` or the
 * deployed Worker).
 *
 *   CFT=<cloudflare token> BASE=https://jb-deployer.<sub>.workers.dev \
 *     node deployer/test/ui-smoke.mjs [--name jb-router-smoke] [--type dryrun]
 */
import { registry, document, installGlobals, fire, textOf } from "./dom-stub.mjs";

const BASE = process.env.BASE || "http://127.0.0.1:8799";
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, "").split("=");
  return [k, v === undefined ? true : v];
}));

installGlobals(BASE);

const $ = (id) => document.getElementById(id);
$("apiToken").value = process.env.CFT || "";
$("workerName").value = args.name || "jb-router-smoke";
$("deployType").value = args.type || "full";

await import("../static/app.js");
await new Promise((r) => setTimeout(r, 100));
console.log("initial terminal:", JSON.stringify(textOf($("output"))));

console.log("→ submitting the wizard form");
const started = Date.now();
await fire($("deployForm"), "submit");
await new Promise((r) => setTimeout(r, 500));

const deadline = Date.now() + 6 * 60 * 1000;
while ($("installButton").disabled && Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 1000));
}

const terminal = textOf($("output"));
console.log("\n---------------- terminal ----------------");
console.log(terminal.trim());
console.log("------------------------------------------");
console.log("deployment toast:", $("deploymentToast").classList.contains("hidden") ? "hidden" : "shown",
  "| dashboard link:", $("liveUrl").href || "(none)");
console.log("quick link toast:", $("privateUrlToast").classList.contains("hidden") ? "hidden" : "shown");
console.log(`elapsed: ${((Date.now() - started) / 1000).toFixed(1)}s`);

const ok = /JB-Router successfully installed!/.test(terminal) && !/✗/.test(terminal);
console.log(ok ? "WIZARD UI SMOKE: PASS ✅" : "WIZARD UI SMOKE: FAIL ❌");
process.exit(ok ? 0 : 1);
