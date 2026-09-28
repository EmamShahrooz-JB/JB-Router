import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fsPromises from "fs/promises";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

// Contract note: the route probes platform-specific Cursor db paths, then reads the
// tokens with the bundled driver (`require("better-sqlite3")` → exact keys first, then
// the alternate names, unwrapping JSON-encoded values). When the driver cannot open
// the file it falls back to the `sqlite3` CLI and finally to a manual paste
// ({ found:false, windowsManual:true, dbPath }).
//
// The fixtures below are REAL sqlite databases written with the same driver — loaded
// through Node's own `createRequire` so vitest's module mocks cannot intercept it.
// Mocking the driver out would only prove that the mock works.

// Mock next/server
vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body, init) => ({
      status: init?.status || 200,
      body,
      json: async () => body,
    })),
  },
}));

// Mock os — homedir is redirected per test at a real temp directory.
const HOME = vi.hoisted(() => ({ dir: "/mock/home" }));
vi.mock("os", () => ({
  default: { homedir: vi.fn(() => HOME.dir) },
  homedir: vi.fn(() => HOME.dir),
}));

// Mock fs/promises (the route only uses access/constants.R_OK to probe candidates)
vi.mock("fs/promises", () => ({
  access: vi.fn(),
  constants: { R_OK: 4 },
}));

const nativeRequire = createRequire(import.meta.url);
const Database = nativeRequire("better-sqlite3");

const CURSOR_DB_REL =
  "Library/Application Support/Cursor/User/globalStorage/state.vscdb";
const CURSOR_INSIDERS_DB_REL =
  "Library/Application Support/Cursor - Insiders/User/globalStorage/state.vscdb";

let tmpHome = null;
let GET;

/** Point homedir at a fresh temp dir; optionally seed a real Cursor db there. */
const makeHome = (rows = null) => {
  tmpHome = fs.mkdtempSync(path.join(process.cwd(), ".tmp-cursor-home-"));
  HOME.dir = tmpHome;
  const dbPath = path.join(tmpHome, CURSOR_DB_REL);
  if (rows) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const db = new Database(dbPath);
    db.exec("CREATE TABLE itemTable (key TEXT PRIMARY KEY, value TEXT)");
    const insert = db.prepare("INSERT INTO itemTable (key, value) VALUES (?, ?)");
    for (const [key, value] of Object.entries(rows)) insert.run(key, value);
    db.close();
  }
  return { home: tmpHome, dbPath };
};

describe("GET /api/oauth/cursor/auto-import", () => {
  const originalPlatform = process.platform;

  beforeEach(async () => {
    vi.clearAllMocks();
    HOME.dir = "/mock/home";
    // Force darwin so macOS-specific logic is exercised
    Object.defineProperty(process, "platform", { value: "darwin", writable: true });
    // Re-import to pick up fresh mocks each run
    const mod = await import("../../src/app/api/oauth/cursor/auto-import/route.js");
    GET = mod.GET;
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform, writable: true });
    HOME.dir = "/mock/home";
    if (tmpHome) {
      fs.rmSync(tmpHome, { recursive: true, force: true });
      tmpHome = null;
    }
  });

  // ── macOS path probing ────────────────────────────────────────────────

  it("returns not-found when no macOS cursor db paths are accessible", async () => {
    makeHome();
    vi.mocked(fsPromises.access).mockRejectedValue(new Error("ENOENT"));

    const response = await GET();

    expect(response.body.found).toBe(false);
    expect(response.body.error).toContain("Cursor database not found");
    // Both macOS candidates (stable + Insiders) are reported back to the user.
    expect(response.body.error).toContain(CURSOR_DB_REL);
    expect(response.body.error).toContain(CURSOR_INSIDERS_DB_REL);
    // Both candidates were probed.
    expect(fsPromises.access).toHaveBeenCalledTimes(2);
  });

  it("falls back to manual paste when the db file exists but cannot be opened", async () => {
    // access() says the candidate is readable, but nothing is actually there, so the
    // driver (fileMustExist) and the sqlite3 CLI both fail.
    makeHome();
    vi.mocked(fsPromises.access).mockResolvedValue();

    const response = await GET();

    expect(response.body.found).toBe(false);
    expect(response.body.windowsManual).toBe(true);
    expect(response.body.dbPath).toContain("state.vscdb");
  });

  // ── Token extraction ──────────────────────────────────────────────────

  it("extracts tokens using exact keys", async () => {
    const { dbPath } = makeHome({
      "cursorAuth/accessToken": "test-token",
      "storage.serviceMachineId": "test-machine-id",
    });
    vi.mocked(fsPromises.access).mockResolvedValue();

    const response = await GET();

    expect(response.body.found).toBe(true);
    expect(response.body.accessToken).toBe("test-token");
    expect(response.body.machineId).toBe("test-machine-id");
    expect(response.body.dbPath).toBeUndefined();
    expect(fs.existsSync(dbPath)).toBe(true);
  });

  it("unwraps JSON-encoded string values", async () => {
    makeHome({
      "cursorAuth/accessToken": '"json-token"',
      "storage.serviceMachineId": '"json-machine-id"',
    });
    vi.mocked(fsPromises.access).mockResolvedValue();

    const response = await GET();

    expect(response.body.found).toBe(true);
    expect(response.body.accessToken).toBe("json-token");
    expect(response.body.machineId).toBe("json-machine-id");
  });

  it("accepts the alternate key names used by other Cursor builds", async () => {
    makeHome({
      "cursorAuth/token": "fallback-token",
      "storage.machineId": "fallback-machine",
    });
    vi.mocked(fsPromises.access).mockResolvedValue();

    const response = await GET();

    expect(response.body.found).toBe(true);
    expect(response.body.accessToken).toBe("fallback-token");
    expect(response.body.machineId).toBe("fallback-machine");
  });

  it("prefers the primary key when both key names are present", async () => {
    makeHome({
      "cursorAuth/accessToken": "primary-token",
      "cursorAuth/token": "alternate-token",
      "storage.serviceMachineId": "primary-machine",
      "storage.machineId": "alternate-machine",
    });
    vi.mocked(fsPromises.access).mockResolvedValue();

    const response = await GET();

    expect(response.body.accessToken).toBe("primary-token");
    expect(response.body.machineId).toBe("primary-machine");
  });

  it("asks for a manual paste when the db has no token rows", async () => {
    makeHome({ "telemetry.somethingElse": "not-a-token" });
    vi.mocked(fsPromises.access).mockResolvedValue();

    const response = await GET();

    expect(response.body.found).toBe(false);
    expect(response.body.windowsManual).toBe(true);
    expect(response.body.dbPath).toContain("state.vscdb");
  });

  // ── Platform handling ─────────────────────────────────────────────────

  it("linux probes the XDG config paths and reports them back", async () => {
    Object.defineProperty(process, "platform", { value: "linux", writable: true });
    makeHome();
    vi.mocked(fsPromises.access).mockRejectedValue(new Error("ENOENT"));

    const response = await GET();

    expect(response.body.found).toBe(false);
    expect(response.body.error).toContain("Cursor database not found");
    expect(response.body.error).toContain(".config/Cursor/User/globalStorage/state.vscdb");
    // The linux probe hits fs/promises.access for each candidate path.
    expect(fsPromises.access).toHaveBeenCalled();
  });

  it("non-macOS/Windows platforms fall back to the XDG paths instead of throwing", async () => {
    Object.defineProperty(process, "platform", { value: "freebsd", writable: true });
    makeHome();
    vi.mocked(fsPromises.access).mockRejectedValue(new Error("ENOENT"));

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.body.found).toBe(false);
    expect(response.body.error).toContain(".config/Cursor/User/globalStorage/state.vscdb");
  });
});
