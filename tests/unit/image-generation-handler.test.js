/**
 * Request-level tests for the app-side image-generation handler.
 * These cover the request flags and account lookup that the core-adapter tests do not.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(),
  clearAccountError: vi.fn(),
  extractApiKey: vi.fn(() => null),
  isValidApiKey: vi.fn(async () => true),
  getSettings: vi.fn(async () => ({ requireApiKey: false })),
  getModelInfo: vi.fn(async () => ({ provider: "openai", model: "gpt-image-1" })),
  getComboModels: vi.fn(async () => null),
  handleImageGenerationCore: vi.fn(),
  checkAndRefreshToken: vi.fn(async (_provider, credentials) => credentials),
  updateProviderCredentials: vi.fn(),
  handleComboChat: vi.fn(),
}));

vi.mock("@/sse/services/auth.js", () => ({
  getProviderCredentials: mocks.getProviderCredentials,
  markAccountUnavailable: mocks.markAccountUnavailable,
  clearAccountError: mocks.clearAccountError,
  extractApiKey: mocks.extractApiKey,
  isValidApiKey: mocks.isValidApiKey,
}));
vi.mock("@/lib/localDb", () => ({ getSettings: mocks.getSettings }));
vi.mock("@/sse/services/model.js", () => ({
  getModelInfo: mocks.getModelInfo,
  getComboModels: mocks.getComboModels,
}));
vi.mock("open-sse/handlers/imageGenerationCore.js", () => ({
  handleImageGenerationCore: mocks.handleImageGenerationCore,
}));
vi.mock("@/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken: mocks.checkAndRefreshToken,
  updateProviderCredentials: mocks.updateProviderCredentials,
}));
vi.mock("open-sse/services/combo.js", () => ({ handleComboChat: mocks.handleComboChat }));
vi.mock("@/sse/utils/logger.js", () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

import { handleImageGeneration } from "@/sse/handlers/imageGeneration.js";

const account = {
  connectionId: "image-connection",
  apiKey: "image-provider-key",
  authType: "apikey",
};

function request(headers = {}) {
  return new Request("https://jb-router.test/v1/images/generations", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ model: "openai/gpt-image-1", prompt: "a red kite" }),
  });
}

beforeEach(() => {
  mocks.getProviderCredentials.mockReset().mockResolvedValue(account);
  mocks.markAccountUnavailable.mockReset().mockResolvedValue({ shouldFallback: false });
  mocks.clearAccountError.mockReset().mockResolvedValue(undefined);
  mocks.extractApiKey.mockReset().mockReturnValue(null);
  mocks.isValidApiKey.mockReset().mockResolvedValue(true);
  mocks.getSettings.mockReset().mockResolvedValue({ requireApiKey: false });
  mocks.getModelInfo.mockReset().mockResolvedValue({ provider: "openai", model: "gpt-image-1" });
  mocks.getComboModels.mockReset().mockResolvedValue(null);
  mocks.handleImageGenerationCore.mockReset().mockResolvedValue({
    success: true,
    response: new Response(JSON.stringify({ created: 1, data: [{ url: "https://images.test/a.png" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  });
  mocks.checkAndRefreshToken.mockReset().mockImplementation(async (_provider, credentials) => credentials);
  mocks.updateProviderCredentials.mockReset().mockResolvedValue(undefined);
  mocks.handleComboChat.mockReset();
});

afterEach(() => vi.restoreAllMocks());

describe("handleImageGeneration request routing", () => {
  it("routes a credentialed image request without a server-side ReferenceError", async () => {
    const response = await handleImageGeneration(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: [{ url: "https://images.test/a.png" }] });
    expect(mocks.getProviderCredentials).toHaveBeenCalledWith(
      "openai",
      expect.any(Set),
      "gpt-image-1",
      expect.objectContaining({ ignoreModelLocks: false })
    );
    expect(mocks.handleImageGenerationCore).toHaveBeenCalledTimes(1);
  });

  it("propagates the explicit force-test flag for dashboard image probes", async () => {
    const response = await handleImageGeneration(request({ "x-jb-router-force-test": "1" }));

    expect(response.status).toBe(200);
    expect(mocks.getProviderCredentials).toHaveBeenCalledWith(
      "openai",
      expect.any(Set),
      "gpt-image-1",
      expect.objectContaining({ ignoreModelLocks: true })
    );
  });
});
