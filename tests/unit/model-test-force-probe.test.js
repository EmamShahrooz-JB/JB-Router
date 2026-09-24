// Regression: dashboard "test model" probes used to report whatever the router
// itself answered. Because a failed call puts the model in cooldown and every
// later call for that model is answered with 503 ("all accounts locked" + the
// original error embedded in the message), most providers looked like they were
// returning HTTP 503 even when the real upstream answer was 402/403/404/429.
//
// Two behaviours are covered here:
//   1. explicit probes bypass recorded cooldowns (x-jb-router-force-test), so the user
//      always gets a real upstream attempt;
//   2. when the router does answer with its cooldown 503, the probe reports the
//      real upstream status/message/cooldown instead of a bare 503.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getSettings: vi.fn(),
  updateProviderConnection: vi.fn(),
  validateApiKey: vi.fn(),
  getProxyPools: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getSettings: mocks.getSettings,
  updateProviderConnection: mocks.updateProviderConnection,
  validateApiKey: mocks.validateApiKey,
  getProxyPools: mocks.getProxyPools,
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn(async () => ({})),
  pickProxyPoolId: vi.fn(() => null),
}));
vi.mock("@/shared/constants/providers.js", () => ({
  FREE_PROVIDERS: {},
  resolveProviderId: (provider) => provider,
}));
vi.mock("@/sse/utils/logger.js", () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn() }));

const { describeUpstreamFailure } = await import("../../open-sse/utils/upstreamStatus.js");
const { isForceTestRequest, FORCE_TEST_HEADER } = await import("../../open-sse/utils/requestFlags.js");
const { getProviderCredentials } = await import("../../src/sse/services/auth.js");

const MODEL = "gpt-oss-120b";
const LOCK_IN_2M = new Date(Date.now() + 120_000).toISOString();

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSettings.mockResolvedValue({});
  mocks.getProxyPools.mockResolvedValue([]);
});

describe("describeUpstreamFailure", () => {
  it("recovers the real upstream status from the router cooldown 503", () => {
    const parsed = {
      error: {
        message:
          `[api-airforce/${MODEL}] [402]: {"error":{"message":"Model 'gpt-oss-120b' requires an active subscription or a positive Pay-As-You-Go balance.","type":"paid_model_required"}} (reset after 2m)`,
      },
    };

    const result = describeUpstreamFailure(503, parsed, JSON.stringify(parsed));

    expect(result.ok).toBe(false);
    expect(result.status).toBe(402);
    expect(result.upstreamStatus).toBe(402);
    expect(result.routerStatus).toBe(503);
    expect(result.locked).toBe(true);
    expect(result.cooldown).toBe("reset after 2m");
    expect(result.error).toContain("HTTP 402");
    expect(result.error).toContain("requires an active subscription");
    expect(result.error).not.toContain("HTTP 503:");
  });

  it("keeps a genuine upstream status untouched", () => {
    const result = describeUpstreamFailure(
      404,
      { error: "No active credentials for provider: unknown-provider" },
      "",
    );

    expect(result.status).toBe(404);
    expect(result.upstreamStatus).toBeNull();
    expect(result.locked).toBe(false);
    expect(result.error).toBe("HTTP 404: No active credentials for provider: unknown-provider");
  });

  it("reports a bare cooldown 503 without inventing an upstream code", () => {
    const result = describeUpstreamFailure(503, { error: { message: "Unavailable" } }, "");

    expect(result.status).toBe(503);
    expect(result.locked).toBe(true);
    expect(result.cooldown).toBeNull();
  });

  it("handles rate-limit cooldowns the same way", () => {
    const parsed = {
      error: {
        message: `[api-airforce/${MODEL}] [429]: {"error":{"message":"Global rate limit exceeded (1 requests per second)"}} (reset after 4s)`,
      },
    };

    const result = describeUpstreamFailure(503, parsed, "");

    expect(result.status).toBe(429);
    expect(result.cooldown).toBe("reset after 4s");
    expect(result.error).toContain("Global rate limit exceeded");
  });

  it("strips the redundant status prefix from a plain upstream error", () => {
    const parsed = {
      error: {
        message: `[402]: {"error":{"message":"Model 'gpt-oss-120b' requires an active subscription","type":"paid_model_required"}}`,
      },
    };

    const result = describeUpstreamFailure(402, parsed, "");

    expect(result.status).toBe(402);
    expect(result.error).toBe("HTTP 402: Model 'gpt-oss-120b' requires an active subscription");
  });
});

describe("isForceTestRequest", () => {
  it("is true only for the explicit probe header value", () => {
    expect(isForceTestRequest(new Request("https://x/api/v1/chat/completions", {
      headers: { [FORCE_TEST_HEADER]: "1" },
    }))).toBe(true);
    expect(isForceTestRequest(new Request("https://x/api/v1/chat/completions", {
      headers: { [FORCE_TEST_HEADER]: "0" },
    }))).toBe(false);
    expect(isForceTestRequest(new Request("https://x/api/v1/chat/completions"))).toBe(false);
    expect(isForceTestRequest(null)).toBe(false);
  });
});

describe("getProviderCredentials cooldown bypass", () => {
  beforeEach(() => {
    mocks.getProviderConnections.mockResolvedValue([
      {
        id: "af-1",
        provider: "api-airforce",
        name: "af-1",
        isActive: true,
        status: "error",
        [`modelLock_${MODEL}`]: LOCK_IN_2M,
      },
    ]);
  });

  it("reports the model as unavailable for normal traffic", async () => {
    const result = await getProviderCredentials("api-airforce", null, MODEL);

    expect(result?.allRateLimited).toBe(true);
    expect(result?.retryAfterHuman).toContain("reset after");
  });

  it("ignores the cooldown for an explicit dashboard probe", async () => {
    const result = await getProviderCredentials("api-airforce", null, MODEL, {
      ignoreModelLocks: true,
    });

    expect(result?.allRateLimited).toBeUndefined();
    expect(result?.connectionId).toBe("af-1");
    expect(result?._connection?.modelLock_gpt_oss_120b ?? result?._connection?.[`modelLock_${MODEL}`]).toBeTruthy();
  });

  it("still honours the excluded-connection filter during a probe", async () => {
    const result = await getProviderCredentials("api-airforce", new Set(["af-1"]), MODEL, {
      ignoreModelLocks: true,
    });

    // No lock is replayed for a probe: with the only connection excluded the
    // caller must see "no credentials", never a fabricated cooldown 503.
    expect(result?.allRateLimited).toBeUndefined();
    expect(result?.retryAfterHuman).toBeUndefined();
  });
});
