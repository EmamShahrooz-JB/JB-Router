import fs from "node:fs";
import path from "path";
import os from "os";

const APP_NAME = "jb-router";
/** Directory used before the rebrand — kept so existing installs keep their database. */
const LEGACY_APP_NAME = "9" + "router";

function legacyDir() {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), LEGACY_APP_NAME);
  }
  return path.join(os.homedir(), `.${LEGACY_APP_NAME}`);
}

/** Prefer an existing legacy data directory so upgrades never look like a fresh install. */
function resolveDefaultDir() {
  const current = defaultDir();
  try {
    if (!fs.existsSync(current) && fs.existsSync(legacyDir())) return legacyDir();
  } catch {
    /* ignore */
  }
  return current;
}

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
    try { fs.mkdirSync('/tmp/.jb-router', { recursive: true }); return '/tmp/.jb-router'; } catch {}
    return '/tmp/.jb-router';
  }
  const configured = process.env.DATA_DIR;
  if (!configured) return resolveDefaultDir();

  // On Windows, ignore Unix-style absolute paths (e.g. /var/lib/...) that come
  // from a Linux-targeted .env or Docker config — they are not valid here.
  if (process.platform === "win32" && /^\//.test(configured)) {
    console.warn(`[DATA_DIR] '${configured}' is a Unix path on Windows → fallback to default`);
    return resolveDefaultDir();
  }

  try {
    fs.mkdirSync(configured, { recursive: true });
    return configured;
  } catch (e) {
    if (e?.code === "EACCES" || e?.code === "EPERM") {
      console.warn(`[DATA_DIR] '${configured}' not writable → fallback ~/.${APP_NAME}`);
      return resolveDefaultDir();
    }
    // On Workers or restricted env, fallback gracefully instead of throwing
    console.warn(`[DATA_DIR] mkdir failed for '${configured}': ${e.message} → fallback`);
    try { fs.mkdirSync('/tmp/.jb-router', { recursive: true }); return '/tmp/.jb-router'; } catch {}
    return '/tmp/.jb-router';
  }
}

export const DATA_DIR = getDataDir();
