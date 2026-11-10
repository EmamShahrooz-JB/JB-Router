// Gateway API keys must never be stored (or logged) in a usable form.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jb-router-apikey-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
});

afterAll(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("API keys at rest", () => {
  it("stores a digest, never the plaintext key", async () => {
    const created = await db.createApiKey("at-rest", "machine-xyz");
    expect(created.key).toMatch(/^sk-machine-xyz-[a-z0-9]{6}-[0-9a-f]{8}$/);

    const rows = await db.getApiKeys();
    const row = rows.find((k) => k.id === created.id);
    expect(row).toBeDefined();
    // Default read must not expose either the key or its digest.
    expect(row.key).toBeUndefined();
    expect(JSON.stringify(row)).not.toContain(created.key);
    expect(row.keyId).toBe(created.keyId);
  });

  it("validates a presented key and rejects anything else", async () => {
    const created = await db.createApiKey("validate", "machine-xyz");
    expect(await db.validateApiKey(created.key)).toBe(true);
    expect(await db.validateApiKey(`${created.key}x`)).toBe(false);
    expect(await db.validateApiKey("")).toBe(false);
    expect(await db.validateApiKey(null)).toBe(false);
  });

  it("can still recover the key where the app itself needs it", async () => {
    const created = await db.createApiKey("recover", "machine-xyz");
    const withSecret = await db.getApiKeys({ withSecret: true });
    expect(withSecret.find((k) => k.id === created.id).key).toBe(created.key);
  });

  it("disabling a key blocks validation", async () => {
    const created = await db.createApiKey("toggle", "machine-xyz");
    await db.updateApiKey(created.id, { isActive: false });
    expect(await db.validateApiKey(created.key)).toBe(false);
    await db.updateApiKey(created.id, { isActive: true });
    expect(await db.validateApiKey(created.key)).toBe(true);
  });

  it("upgrades a legacy plaintext row in place and keeps it valid", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const adapter = await getAdapter();
    const legacyKey = "sk-legacymachine01-abc123-deadbeef";
    adapter.run(
      `INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt) VALUES(?, ?, ?, ?, ?, ?)`,
      ["legacy-1", legacyKey, "legacy", "legacymachine01", 1, new Date().toISOString()],
    );

    expect(await db.validateApiKey(legacyKey)).toBe(true);
    const row = adapter.get(`SELECT key FROM apiKeys WHERE id = ?`, ["legacy-1"]);
    expect(row.key.startsWith("sha256:")).toBe(true);
    // and still valid after the upgrade
    expect(await db.validateApiKey(legacyKey)).toBe(true);
  });
});

describe("usage log key handling", () => {
  it("fingerprints keys so usage history never stores a credential", async () => {
    const { apiKeyFingerprint, normalizeStoredApiKey } = await import("@/shared/utils/apiKeyFingerprint.js");
    const raw = "sk-abcdefghijklmnop-q1w2e3-12345678";
    const fp = apiKeyFingerprint(raw);
    expect(fp).toBe("id:q1w2e3");
    expect(fp).not.toContain(raw);
    expect(normalizeStoredApiKey(raw)).toBe(fp);
    expect(normalizeStoredApiKey(fp)).toBe(fp);
    expect(normalizeStoredApiKey(null)).toBe(null);
    // legacy/unknown key shapes fall back to a digest
    expect(apiKeyFingerprint("some-user-key")).toMatch(/^h:[0-9a-f]{8}$/);
  });
});
