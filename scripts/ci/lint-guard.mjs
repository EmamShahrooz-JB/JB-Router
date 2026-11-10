#!/usr/bin/env node
/**
 * Lint regression guard.
 *
 * The repo carries a backlog of ESLint findings (mostly React hook rules in the
 * dashboard), so a plain `eslint .` gate would be red on day one and therefore
 * ignored. This guard compares the current totals against a committed baseline
 * and fails only when they get worse — new code cannot add findings, and every
 * cleanup ratchets the baseline down.
 *
 *   node scripts/ci/lint-guard.mjs            # verify
 *   node scripts/ci/lint-guard.mjs --update   # rewrite the baseline
 */
import { ESLint } from "eslint";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BASELINE_FILE = path.join(ROOT, "scripts/ci/lint-baseline.json");

const eslint = new ESLint({ cwd: ROOT });
const results = await eslint.lintFiles(["."]);

const byRule = {};
const byFile = {};
let errors = 0;
let warnings = 0;

for (const result of results) {
  for (const message of result.messages) {
    if (message.severity === 2) errors += 1;
    else warnings += 1;
    const rule = message.ruleId || "(fatal)";
    byRule[rule] = (byRule[rule] || 0) + 1;
  }
  if (result.messages.length) {
    const rel = path.relative(ROOT, result.filePath);
    byFile[rel] = result.messages.length;
  }
}

const current = { errors, warnings, byRule, byFile };

if (process.argv.includes("--update")) {
  fs.writeFileSync(BASELINE_FILE, `${JSON.stringify(current, null, 2)}\n`);
  console.log(`[lint-guard] baseline updated: ${errors} errors, ${warnings} warnings`);
  process.exit(0);
}

if (!fs.existsSync(BASELINE_FILE)) {
  console.error("[lint-guard] no baseline found — run with --update once and commit the result");
  process.exit(1);
}

const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, "utf8"));
let failed = false;

if (errors > baseline.errors) {
  failed = true;
  console.error(`[lint-guard] ✗ ESLint errors increased: ${baseline.errors} → ${errors}`);
  for (const [file, count] of Object.entries(byFile)) {
    const before = baseline.byFile?.[file] || 0;
    if (count > before) console.error(`   ${file}: ${before} → ${count}`);
  }
}
if (warnings > baseline.warnings) {
  failed = true;
  console.error(`[lint-guard] ✗ ESLint warnings increased: ${baseline.warnings} → ${warnings}`);
}
for (const [rule, count] of Object.entries(byRule)) {
  const before = baseline.byRule?.[rule] || 0;
  if (count > before) {
    failed = true;
    console.error(`[lint-guard] ✗ rule ${rule}: ${before} → ${count}`);
  }
}

if (failed) process.exit(1);
console.log(
  `[lint-guard] ✓ no new findings (errors ${errors}/${baseline.errors}, warnings ${warnings}/${baseline.warnings})`,
);
