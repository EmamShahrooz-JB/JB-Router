#!/usr/bin/env node
/**
 * Browser smoke test for the deployer page: launches a real Chromium (puppeteer), fills the
 * wizard form, presses Install and waits for the terminal to report the result. Works against
 * a local `wrangler dev` or the deployed Worker.
 *
 *   CFT=<cloudflare token> BASE=https://jb-deployer.<sub>.workers.dev \
 *     node deployer/test/ui-smoke.mjs [--name jb-ui-smoke] [--type dryrun] [--headed]
 *
 * Skips (exit 0) when puppeteer or a browser is not available, so CI can run it optionally.
 */
import { existsSync } from "node:fs";

const BASE = process.env.BASE || "http://127.0.0.1:8799";
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, "").split("=");
  return [k, v === undefined ? true : v];
}));
const name = args.name || "jb-ui-smoke";
const type = args.type || "full";

let puppeteer;
try {
  puppeteer = (await import("puppeteer")).default;
} catch {
  console.log("SKIP: puppeteer is not installed (npm i puppeteer) — browser smoke test not run");
  process.exit(0);
}

let browser;
try {
  browser = await puppeteer.launch({
    headless: !args.headed,
    args: ["--no-sandbox", "--disable-dev-shm-usage"]
  });
} catch (err) {
  console.log("SKIP: no usable browser for puppeteer —", err.message.split("\n")[0]);
  process.exit(0);
}

const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1200, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", (err) => errors.push("pageerror: " + err.message));

console.log(`→ opening ${BASE}`);
await page.goto(BASE, { waitUntil: "networkidle2", timeout: 60000 });
await new Promise((r) => setTimeout(r, 1500));

const started = Date.now();
await page.type("input[placeholder*='API token']", process.env.CFT || "", { delay: 1 });
const textInputs = await page.$$("input[type=text]");
if (textInputs[0]) {
  await textInputs[0].click({ clickCount: 3 });
  await textInputs[0].type(name);
}
await page.select("select", type === "dryrun" ? "dryrun" : "full");
await page.click("button[type=submit]");

const readTerminal = () => page.evaluate(() => {
  const panels = [...document.querySelectorAll("div")].filter((d) => d.className.toString().includes("font-mono"));
  return panels.length ? panels[panels.length - 1].innerText : "";
});

let text = "";
let bodyText = "";
const deadline = Date.now() + 6 * 60 * 1000;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 1000));
  text = await readTerminal();
  bodyText = await page.evaluate(() => document.body.innerText);
  if (/JB-Router successfully installed!|Dry run finished/i.test(text) || /✗/.test(text)) break;
  if (!(await page.$("button[type=submit]:disabled"))) break;
}

const checks = {
  "install completed": type === "dryrun" ? /Dry run finished/i.test(text) : /JB-Router successfully installed!/i.test(text),
  "no terminal error": !/✗/.test(text),
  "success toast": /Successfully installed/i.test(bodyText) || type === "dryrun",
  "dashboard URL shown": type === "dryrun" ? true : /https:\/\/[a-z0-9-]+\.[a-z0-9.-]+\.workers\.dev\/login/.test(text),
  "api endpoint shown": type === "dryrun" ? true : /\.workers\.dev\/v1/.test(text),
  "password shown": type === "dryrun" ? true : /Dashboard password: [A-Za-z0-9]{24}/.test(text),
  "no JS errors": errors.length === 0
};

console.log("\n---------------- terminal ----------------");
console.log(text.trim().split("\n").slice(-24).join("\n"));
console.log("------------------------------------------");
for (const [label, ok] of Object.entries(checks)) console.log(`${ok ? "✓" : "✗"} ${label}`);
console.log(`elapsed: ${((Date.now() - started) / 1000).toFixed(1)}s`);

await browser.close();
const passed = Object.values(checks).every(Boolean);
console.log(passed ? "WIZARD UI SMOKE: PASS ✅" : "WIZARD UI SMOKE: FAIL ❌");
process.exit(passed ? 0 : 1);
