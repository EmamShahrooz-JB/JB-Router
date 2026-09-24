import { defineCloudflareConfig } from "@opennextjs/cloudflare";

const cfg = defineCloudflareConfig({
  // keep defaults
});

// Fix for JB-Router -> JB-Router: middleware bundling fails on node/bun sqlite + opentelemetry
// @opennextjs/cloudflare hardcodes edgeExternals to ["node:crypto"], we extend it
cfg.edgeExternals = [
  ...(cfg.edgeExternals || []),
  "bun:sqlite",
  "better-sqlite3",
  "node:sqlite",
  "bun:sqlite:lite",
  "@opentelemetry/api",
  "@opentelemetry/api-logs",
  "@opentelemetry/core",
];

export default cfg;
