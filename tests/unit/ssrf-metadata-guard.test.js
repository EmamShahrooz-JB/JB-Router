// Provider/relay URL probes must not be able to reach cloud metadata endpoints.
import { describe, it, expect } from "vitest";
import { assertNotMetadataUrl, assertPublicUrl, assertPublicUrlResolved } from "@/shared/utils/ssrfGuard.js";

describe("ssrfGuard", () => {
  it("blocks cloud metadata endpoints", () => {
    for (const url of [
      "http://169.254.169.254/latest/meta-data/",
      "http://metadata.google.internal/",
      "http://metadata/",
      "http://100.100.100.200/",
      "http://[::ffff:169.254.169.254]/",
      "http://[fd00:ec2::254]/",
    ]) {
      expect(() => assertNotMetadataUrl(url), url).toThrow(/metadata/i);
    }
  });

  it("still allows loopback/LAN provider endpoints", () => {
    for (const url of [
      "http://localhost:1234/v1",
      "http://127.0.0.1:8080",
      "http://192.168.1.20:11434",
      "http://10.0.0.5:3000/v1",
      "https://api.openai.com/v1",
    ]) {
      expect(() => assertNotMetadataUrl(url), url).not.toThrow();
    }
  });

  it("strict variant still blocks private ranges for public-facing fetches", async () => {
    expect(() => assertPublicUrl("http://127.0.0.1/")).toThrow();
    expect(() => assertPublicUrl("http://10.1.2.3/")).toThrow();
    expect(() => assertPublicUrl("http://localhost./")).toThrow(); // trailing-dot FQDN
    await expect(assertPublicUrlResolved("http://169.254.169.254/")).rejects.toThrow();
  });
});
