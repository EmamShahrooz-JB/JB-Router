// The MiMo login session cookie carries `upstreamBase` + the upstream cookie
// jar, so it MUST be signed: an unsigned payload turns the app into an open
// forwarder for an arbitrary host.
import { describe, it, expect, beforeAll } from "vitest";

let mod;
const SESSION = {
  state: "st-1",
  region: "cn",
  proxyUrl: null,
  createdAt: Date.now(),
  jar: new Map([["passToken|account.xiaomi.com|/", { name: "passToken", value: "secret", domain: "account.xiaomi.com", path: "/" }]]),
};

beforeAll(async () => {
  process.env.JWT_SECRET = "test-secret-for-cookie-signing";
  mod = await import("../../src/lib/mimoLoginSession.js");
});

describe("mimo session cookie integrity", () => {
  it("round-trips a signed cookie", async () => {
    const raw = await mod.encodeSessionCookie(SESSION);
    expect(raw.startsWith("v3.")).toBe(true);
    const decoded = await mod.decodeSessionCookie(raw);
    expect(decoded).not.toBeNull();
    expect(decoded.state).toBe("st-1");
    expect(decoded.jar.get("passToken|account.xiaomi.com|/").value).toBe("secret");
  });

  it("rejects an unsigned (legacy v2) payload", async () => {
    const body = Buffer.from(JSON.stringify({ s: "x", r: "cn", t: Date.now(), j: [] })).toString("base64url");
    expect(await mod.decodeSessionCookie(`v2.${body}`)).toBeNull();
  });

  it("rejects a forged payload with no/other signature", async () => {
    const body = Buffer.from(JSON.stringify({ s: "x", r: "cn", t: Date.now(), j: [] })).toString("base64url");
    expect(await mod.decodeSessionCookie(`v3.${body}`)).toBeNull();
    expect(await mod.decodeSessionCookie(`v3.${body}.deadbeef`)).toBeNull();
  });

  it("rejects a tampered payload that keeps the original signature", async () => {
    const raw = await mod.encodeSessionCookie(SESSION);
    const [, , sig] = raw.split(".");
    const evil = Buffer.from(
      JSON.stringify({ s: "st-1", r: "cn", t: Date.now(), j: [], upstreamBase: "http://169.254.169.254" }),
    ).toString("base64url");
    expect(await mod.decodeSessionCookie(`v3.${evil}.${sig}`)).toBeNull();
  });

  it("expires old sessions", async () => {
    const old = { ...SESSION, createdAt: Date.now() - 16 * 60 * 1000 };
    const raw = await mod.encodeSessionCookie(old);
    expect(await mod.decodeSessionCookie(raw)).toBeNull();
  });
});
