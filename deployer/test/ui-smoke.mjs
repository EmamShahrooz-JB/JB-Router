#!/usr/bin/env node
/**
 * Runs the real page script (deployer/static/deployer.js) under a tiny DOM stub so the UI
 * flow — token check, account/subdomain resolution, install button, result rendering — is
 * exercised end to end against a live (or local) deployer Worker.
 *
 *   CFT=<token> ACC=<account id> BASE=https://jb-deployer.<sub>.workers.dev SUB=<subdomain> \
 *     node deployer/test/ui-smoke.mjs [--name jb-router-fresh]
 */
const BASE = process.env.BASE || "http://127.0.0.1:8799";
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, "").split("=");
  return [k, v === undefined ? true : v];
}));

/* ---------------------------------------------------------------- DOM stub */
class StubClassList {
  constructor(node) { this.node = node; this.set = new Set(); }
  add(...names) { names.forEach((n) => this.set.add(n)); }
  remove(...names) { names.forEach((n) => this.set.delete(n)); }
  contains(name) { return this.set.has(name); }
}
class StubNode {
  constructor(tag = "div") {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.handlers = {};
    this.style = {};
    this.classList = new StubClassList(this);
    this._text = "";
    this._html = "";
    this.value = "";
    this.type = "text";
    this.disabled = false;
    this.readOnly = false;
    this.placeholder = "";
    this.scrollTop = 0;
    this.scrollHeight = 0;
    this.className = "";
  }
  set textContent(v) { this._text = String(v); }
  get textContent() { return this._text; }
  set innerHTML(v) { this._html = String(v); this.children = []; }
  get innerHTML() { return this._html; }
  appendChild(child) { this.children.push(child); return child; }
  addEventListener(type, fn) { (this.handlers[type] = this.handlers[type] || []).push(fn); }
  querySelector() { return new StubNode("span"); }
  click() { (this.handlers.click || []).forEach((fn) => fn()); }
  get firstChild() { return this.children[0]; }
}
const registry = new Map();
const document = {
  readyState: "complete",
  getElementById(id) {
    if (!registry.has(id)) registry.set(id, new StubNode(id.includes("Btn") || id === "checkToken" ? "button" : "div"));
    return registry.get(id);
  },
  createElement(tag) { return new StubNode(tag); },
  addEventListener() {}
};
globalThis.document = document;
globalThis.window = globalThis;

/* <select> behaves like a real one: value mirrors the selected (first appended) option */
const select = document.getElementById("accountId");
select.tagName = "SELECT";
Object.defineProperty(select, "value", {
  get: () => (select.children[0] ? select.children[0].value : ""),
  set: () => {},
  configurable: true
});

/* fetch shim: page uses site-relative urls */
const realFetch = globalThis.fetch;
globalThis.fetch = (url, opts) => realFetch(typeof url === "string" && url.startsWith("/") ? new URL(url, BASE) : url, opts);

/* prefill the form before the module boots */
const prefill = {
  cfToken: process.env.CFT,
  workerName: args.name || "jb-router-fresh",
  password: "ui-smoke-pass-" + Math.random().toString(36).slice(2, 10),
  jwtSecret: "ui-smoke-jwt-" + Math.random().toString(36).slice(2, 10)
};
for (const [id, value] of Object.entries(prefill)) document.getElementById(id).value = value;

await import("../static/deployer.js");
await new Promise((r) => setTimeout(r, 50));

const $ = (id) => document.getElementById(id);
const status = () => $("statusText").textContent;
console.log("boot status:", status());

/* 1. token check button */
console.log("→ clicking «بررسی توکن»");
await $("checkToken").click();
await new Promise((r) => setTimeout(r, 4000));
console.log("   status:", status());
console.log("   subdomain field:", $("subdomain").value, "| readonly:", $("subdomain").readOnly);
console.log("   account select value:", $("accountId").value);
if (!$("accountId").value) { console.error("no account selected — aborting"); process.exit(1); }
$("subdomain").value = process.env.SUB || $("subdomain").value;

/* 2. install button */
console.log("→ clicking «نصب روی اکانت من»");
const started = Date.now();
await $("startBtn").click();
await new Promise((r) => setTimeout(r, 500));
console.log(`   [${((Date.now() - started) / 1000).toFixed(1)}s] status:`, status());
while ($("stopBtn").disabled === false && Date.now() - started < 8 * 60 * 1000) {
  await new Promise((r) => setTimeout(r, 2000));
  process.stdout.write(`   [${((Date.now() - started) / 1000).toFixed(1)}s] ${status()}\n`);
}
console.log("final status:", status());
console.log("result box:", $("resultBox").innerHTML.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 400));
console.log("steps:", JSON.stringify(registry.get("stepsStatus").children.map((c) => c._html || c._text || "").slice(0, 3)));
const ok = /نصب با موفقیت|نصب کامل شد/.test(status()) || /با موفقیت نصب شد/.test($("resultBox").innerHTML);
console.log(ok ? "UI SMOKE: PASS ✅" : "UI SMOKE: FAIL ❌");
process.exit(ok ? 0 : 1);
