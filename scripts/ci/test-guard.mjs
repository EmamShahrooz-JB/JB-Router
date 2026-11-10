#!/usr/bin/env node
/**
 * Test regression guard.
 *
 * The suite is not fully green on a bare checkout (environment-dependent
 * provider/cloud tests), so `vitest run` alone cannot gate a PR. This runner
 * executes the suite and then compares the set of *failing test files* against
 * a committed baseline:
 *   - a file that starts failing  → CI fails
 *   - a file that stops failing   → CI passes (and nags you to update the baseline)
 *
 *   node scripts/ci/test-guard.mjs             # run + verify
 *   node scripts/ci/test-guard.mjs --update    # refresh the baseline
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TESTS_DIR = path.join(ROOT, "tests");
const BASELINE_FILE = path.join(TESTS_DIR, "__ci__/known-failing.json");
const OUT_FILE = path.join(os.tmpdir(), `jb-router-vitest-${process.pid}.json`);

const run = spawnSync("npx", ["vitest", "run", "--reporter=json", `--outputFile=${OUT_FILE}`], {
  cwd: TESTS_DIR,
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (!fs.existsSync(OUT_FILE)) {
  console.error("[test-guard] ✗ vitest produced no report — treating as a hard failure");
  process.exit(1);
}

const report = JSON.parse(fs.readFileSync(OUT_FILE, "utf8"));
const failing = report.testResults
  .filter((t) => t.status === "failed" || (t.assertionResults || []).some((a) => a.status === "failed"))
  .map((t) => path.relative(TESTS_DIR, t.name).split(path.sep).join("/"))
  .sort();

const summary = {
  total: report.numTotalTests,
  passed: report.numPassedTests,
  failed: report.numFailedTests,
  failingFiles: failing,
};

if (process.argv.includes("--update")) {
  fs.mkdirSync(path.dirname(BASELINE_FILE), { recursive: true });
  fs.writeFileSync(BASELINE_FILE, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`[test-guard] baseline updated: ${summary.passed}/${summary.total} passing, ${failing.length} known-failing files`);
  process.exit(0);
}

if (!fs.existsSync(BASELINE_FILE)) {
  console.error("[test-guard] no baseline found — run with --update once and commit the result");
  process.exit(1);
}

const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, "utf8"));
const known = new Set(baseline.failingFiles || []);
const regressions = failing.filter((f) => !known.has(f));
const fixed = [...known].filter((f) => !failing.includes(f));

console.log(`[test-guard] ${summary.passed}/${summary.total} tests passing`);
if (fixed.length) {
  console.log(`[test-guard] ✓ newly passing (run --update to shrink the baseline): ${fixed.join(", ")}`);
}
if (regressions.length) {
  console.error(`[test-guard] ✗ NEW failing test files:\n  ${regressions.join("\n  ")}`);
  process.exit(1);
}
console.log(`[test-guard] ✓ no regressions vs baseline (${known.size} known-failing files)`);
if (run.status !== 0) process.exit(run.status ?? 1);
