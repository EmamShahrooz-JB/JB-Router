import fs from "node:fs";
import path from "path";
import os from "os";

const APP_NAME = "9router";

function defaultDir() {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), APP_NAME);
  }
  return path.join(os.homedir(), `.${APP_NAME}`);
}

export function getDataDir() {
  // Workers: no homedir fs — use /tmp or in-memory fallback
  const isWorker = typeof navigator !== 'undefined' && (navigator.userAgent === 'Cloudflare-Workers' || globalThis.caches !== undefined);
  if (isWorker) {
    const configured = process.env.DATA_DIR;
    if (configured) {
      try { fs.mkdirSync(configured, { recursive: true }); return configured; } catch {}
      return configured;
    }
    // Try /tmp first, else fallback to in-memory marker
    try { fs.mkdirSync('/tmp/.9router', { recursive: true }); return '/tmp/.9router'; } catch {}
    return '/tmp/.9router';
  }
  const configured = process.env.DATA_DIR;
  if (!configured) return defaultDir();

  // On Windows, ignore Unix-style absolute paths (e.g. /var/lib/...) that come
  // from a Linux-targeted .env or Docker config — they are not valid here.
  if (process.platform === "win32" && /^\//.test(configured)) {
    console.warn(`[DATA_DIR] '${configured}' is a Unix path on Windows → fallback to default`);
    return defaultDir();
  }

  try {
    fs.mkdirSync(configured, { recursive: true });
    return configured;
  } catch (e) {
    if (e?.code === "EACCES" || e?.code === "EPERM") {
      console.warn(`[DATA_DIR] '${configured}' not writable → fallback ~/.${APP_NAME}`);
      return defaultDir();
    }
    // On Workers or restricted env, fallback gracefully instead of throwing
    console.warn(`[DATA_DIR] mkdir failed for '${configured}': ${e.message} → fallback`);
    try { fs.mkdirSync('/tmp/.9router', { recursive: true }); return '/tmp/.9router'; } catch {}
    return '/tmp/.9router';
  }
}

export const DATA_DIR = getDataDir();
