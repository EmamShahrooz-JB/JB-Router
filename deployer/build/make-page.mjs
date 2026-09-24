#!/usr/bin/env node
/**
 * Builds the deployer *page*: deployer/web (React + Vite + Tailwind v4) → a single
 * self-contained deployer/static/index.html that the jb-deployer Worker serves.
 *
 *   node deployer/build/make-page.mjs            # installs deps on first run
 *   node deployer/build/make-page.mjs --skip-install
 *
 * The page imports deployer/static/pipeline.js, the same module the Node tests use, so the UI
 * and the end-to-end tests can never drift apart.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const web = path.join(root, "deployer", "web");
const staticDir = path.join(root, "deployer", "static");
const skipInstall = process.argv.includes("--skip-install");

if (!existsSync(web)) throw new Error("deployer/web is missing — the page source was not found");
if (!skipInstall && !existsSync(path.join(web, "node_modules"))) {
  console.log("[page] installing page dependencies (first run)");
  execFileSync("npm", ["install", "--no-audit", "--no-fund"], { cwd: web, stdio: "inherit" });
}

console.log("[page] building deployer/web with vite");
execFileSync("npm", ["run", "build"], { cwd: web, stdio: "inherit" });

const built = path.join(web, "dist", "index.html");
if (!existsSync(built)) throw new Error("vite did not produce " + built);
mkdirSync(staticDir, { recursive: true });
copyFileSync(built, path.join(staticDir, "index.html"));
console.log("[page] wrote deployer/static/index.html");

const favicon = path.join(web, "dist", "favicon.svg");
if (existsSync(favicon)) {
  copyFileSync(favicon, path.join(staticDir, "favicon.svg"));
  console.log("[page] wrote deployer/static/favicon.svg");
}
