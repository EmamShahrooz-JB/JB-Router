import { v4 as uuidv4 } from "uuid";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/lib/dataDir";
import { getAdapter } from "../driver.js";

// ── At-rest protection for gateway API keys ─────────────────────────────────
// The `key` column holds only a SHA-256 digest (that is what `validateApiKey`
// looks up, so the hot auth path never touches plaintext), `keyEnc` holds an
// AES-256-GCM copy for the few places that must show/forward the real key, and
// `keyPrefix`/`keyId` are safe display identifiers. A dumped DB or a backup
// therefore no longer hands out usable gateway credentials.
const HASH_PREFIX = "sha256:";
const ENC_PREFIX = "enc1:";

let cachedSecret = null;

function loadKeysSecret() {
  if (cachedSecret) return cachedSecret;
  const fromEnv = process.env.API_KEY_SECRET || process.env.JWT_SECRET;
  if (fromEnv) {
    cachedSecret = `jb-router:api-keys:v1:${fromEnv}`;
    return cachedSecret;
  }
  // Self-host without env secrets: a per-install file next to the DB.
  const file = path.join(DATA_DIR, "api-key-secret");
  try {
    const stored = fs.readFileSync(file, "utf8").trim();
    if (stored) {
      cachedSecret = stored;
      return cachedSecret;
    }
  } catch { /* first run (or Workers, where env secrets are mandatory) */ }
  const generated = crypto.randomBytes(32).toString("hex");
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(file, generated, { mode: 0o600 });
  } catch { /* read-only FS: fall back to the in-memory value */ }
  cachedSecret = generated;
  return cachedSecret;
}

function encryptionKey() {
  return crypto.createHash("sha256").update(loadKeysSecret(), "utf8").digest();
}

export function hashApiKey(raw) {
  return HASH_PREFIX + crypto.createHash("sha256").update(String(raw), "utf8").digest("hex");
}

function encryptApiKey(raw) {
  try {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
    const ct = Buffer.concat([cipher.update(String(raw), "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${ENC_PREFIX}${iv.toString("base64url")}.${tag.toString("base64url")}.${ct.toString("base64url")}`;
  } catch {
    return null;
  }
}

function decryptApiKey(stored) {
  if (!stored || typeof stored !== "string" || !stored.startsWith(ENC_PREFIX)) return null;
  try {
    const [ivB64, tagB64, ctB64] = stored.slice(ENC_PREFIX.length).split(".");
    const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivB64, "base64url"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

// `sk-{machineId}-{keyId}-{crc8}` → the 6-char keyId, which is the only part of
// a gateway key that is both stable and non-secret.
export function keyIdFromApiKey(raw) {
  if (typeof raw !== "string") return null;
  const parts = raw.split("-");
  if (parts.length === 4 && parts[0] === "sk" && parts[2]) return parts[2];
  return null;
}

function isLegacyPlaintextKey(stored) {
  return typeof stored === "string" && stored.length > 0 && !stored.startsWith(HASH_PREFIX);
}

function rowToKey(row, { withSecret = false } = {}) {
  if (!row) return null;
  const out = {
    id: row.id,
    name: row.name,
    keyPrefix: row.keyPrefix || null,
    keyId: row.keyId || keyIdFromApiKey(isLegacyPlaintextKey(row.key) ? row.key : null),
    machineId: row.machineId,
    isActive: row.isActive === 1 || row.isActive === true,
    createdAt: row.createdAt,
  };
  if (withSecret) {
    // Legacy rows (pre-hash) still carry the plaintext in `key`.
    out.key = decryptApiKey(row.keyEnc) || (isLegacyPlaintextKey(row.key) ? row.key : null);
  }
  return out;
}

export async function getApiKeys(options = {}) {
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM apiKeys ORDER BY createdAt ASC`);
  return rows.map((r) => rowToKey(r, options));
}

export async function getApiKeyById(id, options = {}) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
  return rowToKey(row, options);
}

export async function createApiKey(name, machineId, options = {}) {
  if (!machineId) throw new Error("machineId is required");
  const db = await getAdapter();
  const { generateApiKeyWithMachine } = await import("@/shared/utils/apiKey");
  const result = generateApiKeyWithMachine(machineId);
  const apiKey = {
    id: uuidv4(),
    name,
    // The caller passes the plaintext through `options.plaintext`; anything else
    // (e.g. a cloud-sync restore) is treated as an already-issued raw key.
    key: options.plaintext || result.key,
    keyId: result.keyId,
    machineId,
    isActive: true,
    createdAt: new Date().toISOString(),
  };
  const fingerprint = hashApiKey(apiKey.key);
  db.run(
    `INSERT INTO apiKeys(id, key, keyEnc, keyPrefix, keyId, name, machineId, isActive, createdAt)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      apiKey.id,
      fingerprint,
      encryptApiKey(apiKey.key),
      apiKey.key.slice(0, 12),
      apiKey.keyId || keyIdFromApiKey(apiKey.key),
      apiKey.name,
      apiKey.machineId,
      1,
      apiKey.createdAt,
    ]
  );
  // Returned exactly once, to the caller that just created it.
  return apiKey;
}

export async function updateApiKey(id, data = {}) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToKey(row), ...data };
    // Never clobber the stored digest unless a brand-new plaintext key is supplied.
    let fingerprint = row.key;
    let keyEnc = row.keyEnc;
    let keyPrefix = row.keyPrefix;
    let keyId = row.keyId;
    if (typeof data.key === "string" && data.key.trim()) {
      const raw = data.key.trim();
      fingerprint = hashApiKey(raw);
      keyEnc = encryptApiKey(raw);
      keyPrefix = raw.slice(0, 12);
      keyId = keyIdFromApiKey(raw);
    }
    db.run(
      `UPDATE apiKeys SET key = ?, keyEnc = ?, keyPrefix = ?, keyId = ?, name = ?, machineId = ?, isActive = ? WHERE id = ?`,
      [fingerprint, keyEnc, keyPrefix, keyId, merged.name, merged.machineId, merged.isActive ? 1 : 0, id]
    );
    result = merged;
  });
  return result;
}

export async function deleteApiKey(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM apiKeys WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}

export async function validateApiKey(key) {
  if (typeof key !== "string" || !key) return false;
  const db = await getAdapter();
  let row = db.get(`SELECT id, isActive FROM apiKeys WHERE key = ?`, [hashApiKey(key)]);

  if (!row) {
    // Opportunistic upgrade for rows written before hashing was introduced:
    // verify against the legacy plaintext value, then replace it in place.
    const legacy = db.get(`SELECT * FROM apiKeys WHERE key = ?`, [key]);
    if (!legacy) return false;
    try {
      db.run(
        `UPDATE apiKeys SET key = ?, keyEnc = ?, keyPrefix = ?, keyId = ? WHERE id = ?`,
        [hashApiKey(key), encryptApiKey(key), key.slice(0, 12), keyIdFromApiKey(key), legacy.id]
      );
    } catch { /* keep validating the legacy row even if the upgrade fails */ }
    row = legacy;
  }

  return row.isActive === 1 || row.isActive === true;
}
