// The LLM surface must be throttleable (a leaked key used to mean unbounded spend).
import { describe, it, expect, beforeEach } from "vitest";
import { consumeRateLimit, resolveRateLimitConfig, resetRateLimits, RATE_LIMIT_DEFAULTS } from "@/lib/rateLimit.js";

describe("gateway rate limiting", () => {
  beforeEach(() => resetRateLimits());

  it("is enabled by default with a sane budget", () => {
    const cfg = resolveRateLimitConfig(undefined);
    expect(cfg.enabled).toBe(true);
    expect(cfg.perMinute).toBe(RATE_LIMIT_DEFAULTS.perMinute);
    expect(cfg.burst).toBe(RATE_LIMIT_DEFAULTS.burst);
  });

  it("allows a burst then answers 429 with Retry-After", () => {
    const cfg = { enabled: true, perMinute: 60, burst: 5 };
    const now = 1_000_000;
    for (let i = 0; i < 5; i++) {
      expect(consumeRateLimit("key:abc", cfg, now).allowed).toBe(true);
    }
    const blocked = consumeRateLimit("key:abc", cfg, now);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
    expect(blocked.limit).toBe(60);
  });

  it("refills over time", () => {
    const cfg = { enabled: true, perMinute: 60, burst: 2 };
    const t0 = 5_000_000;
    consumeRateLimit("key:refill", cfg, t0);
    consumeRateLimit("key:refill", cfg, t0);
    expect(consumeRateLimit("key:refill", cfg, t0).allowed).toBe(false);
    // 60/min → one token per second
    expect(consumeRateLimit("key:refill", cfg, t0 + 1_100).allowed).toBe(true);
  });

  it("isolates buckets per key", () => {
    const cfg = { enabled: true, perMinute: 60, burst: 1 };
    const t = 7_000_000;
    expect(consumeRateLimit("key:a", cfg, t).allowed).toBe(true);
    expect(consumeRateLimit("key:a", cfg, t).allowed).toBe(false);
    expect(consumeRateLimit("key:b", cfg, t).allowed).toBe(true);
  });

  it("can be switched off by settings", () => {
    const cfg = resolveRateLimitConfig({ rateLimitEnabled: false });
    expect(cfg.enabled).toBe(false);
    for (let i = 0; i < 500; i++) {
      expect(consumeRateLimit("key:off", cfg, 1).allowed).toBe(true);
    }
  });
});
