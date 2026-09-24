#!/usr/bin/env node
/**
 * Vendors the blake3 implementation the deployer page needs (wrangler hashes static assets
 * with blake3, so the browser must compute exactly the same hashes before uploading).
 *
 *   node deployer/build/make-vendor.mjs      # writes deployer/static/vendor/blake3.js
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const outDir = path.join(root, "deployer", "static", "vendor");
mkdirSync(outDir, { recursive: true });

const entry = path.join(root, ".deployer-build", "blake3-entry.js");
mkdirSync(path.dirname(entry), { recursive: true });
writeFileSync(entry, 'export { blake3 } from "@noble/hashes/blake3";\n');

execFileSync("npx", ["--yes", "--package=node@22", "--package=esbuild@0.25.12", "-c",
  `esbuild ${entry} --bundle --minify --format=esm --outfile=${path.join(outDir, "blake3.js")}`],
  { stdio: "inherit", cwd: root });
console.log("[vendor] wrote", path.join("deployer/static/vendor/blake3.js"));
