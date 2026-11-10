/**
 * Non-reversible fingerprint of a gateway API key, safe to persist in usage
 * logs and request details.
 *
 * Usage history used to store the raw `sk-…` credential, so a DB dump (or the
 * usage CSV export) handed out working gateway keys. Storing a fingerprint
 * keeps "which key was used" attribution without keeping the secret:
 *   - keys issued by this app use `sk-{machineId}-{keyId}-{crc8}`, so the
 *     6-char keyId is already a stable public identifier → `id:<keyId>`
 *   - anything else (legacy `sk-<random>` keys, user-supplied strings) gets an
 *     FNV-1a digest → `h:<8 hex chars>`
 * Both forms are opaque and cannot be turned back into a key.
 */

const FINGERPRINT_RE = /^(id|h):[A-Za-z0-9_-]+$/;

function fnv1aHex(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function apiKeyFingerprint(raw) {
  if (typeof raw !== "string" || !raw) return null;
  const parts = raw.split("-");
  if (parts.length === 4 && parts[0] === "sk" && parts[2]) return `id:${parts[2]}`;
  return `h:${fnv1aHex(raw)}`;
}

export function isApiKeyFingerprint(value) {
  return typeof value === "string" && FINGERPRINT_RE.test(value);
}

/**
 * Normalise whatever is stored in an existing usage row: fingerprinted values
 * pass through, legacy raw keys are fingerprinted on read (and are therefore
 * never displayed or exported again).
 */
export function normalizeStoredApiKey(value) {
  if (!value || typeof value !== "string") return value || null;
  if (isApiKeyFingerprint(value)) return value;
  return apiKeyFingerprint(value);
}
