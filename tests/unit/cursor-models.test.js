import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearCursorModelCache,
  parseCursorUsableModels,
  resolveCursorModels,
} from "../../open-sse/services/cursorModels.js";

const originalFetch = global.fetch;

// The Cursor agent surface is HTTP/2-only in this codebase (see
// open-sse/services/cursorModels.js → http2PostProto), so the catalog fetch is
// mocked at the node:http2 layer instead of at fetch().
const h2 = vi.hoisted(() => ({
  requests: [],
  response: { status: 200, payload: Buffer.alloc(0) },
  reset(status, payload) {
    this.requests = [];
    this.response = { status, payload };
  },
}));

vi.mock("node:http2", () => {
  const makeEmitter = () => {
    const handlers = {};
    return {
      on(event, fn) { (handlers[event] ||= []).push(fn); return this; },
      emit(event, ...args) { for (const fn of handlers[event] || []) fn(...args); },
    };
  };
  return {
    default: {
      connect() {
        const client = makeEmitter();
        client.close = () => {};
        client.request = (options) => {
          h2.requests.push(options);
          const req = makeEmitter();
          req.end = () => {
            queueMicrotask(() => {
              req.emit("response", { ":status": String(h2.response.status) });
              if (h2.response.payload?.length) req.emit("data", h2.response.payload);
              req.emit("end");
            });
          };
          return req;
        };
        return client;
      },
    },
    connect: (...args) => globalThis.__cursorHttp2Connect?.(...args),
  };
});

function varint(value) {
  const bytes = [];
  while (value >= 0x80) {
    bytes.push((value & 0x7f) | 0x80);
    value >>>= 7;
  }
  bytes.push(value);
  return Uint8Array.from(bytes);
}

function field(fieldNumber, value) {
  return Uint8Array.from([(fieldNumber << 3) | 2, ...varint(value.length), ...value]);
}

function text(value) {
  return new TextEncoder().encode(value);
}

function concat(...parts) {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function model(id, name) {
  return field(1, concat(field(1, text(id)), field(4, text(name))));
}

describe("Cursor live model catalog", () => {
  beforeEach(() => {
    clearCursorModelCache();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    clearCursorModelCache();
  });

  it("decodes the GetUsableModels protobuf response", () => {
    const payload = concat(
      model("default", "Auto"),
      model("gpt-5.3-codex", "GPT 5.3 Codex"),
      model("gpt-5.3-codex", "Duplicate"),
    );

    expect(parseCursorUsableModels(payload)).toEqual([
      { id: "default", name: "Auto" },
      { id: "gpt-5.3-codex", name: "GPT 5.3 Codex" },
    ]);
  });

  it("fetches the account-specific catalog over HTTP/2 and caches it", async () => {
    const payload = concat(model("claude-4.6-opus", "Claude 4.6 Opus"));
    h2.reset(200, Buffer.from(payload));
    const credentials = {
      accessToken: "cursor-token",
      providerSpecificData: { machineId: "machine-id" },
    };

    await expect(resolveCursorModels(credentials)).resolves.toEqual({
      models: [{ id: "claude-4.6-opus", name: "Claude 4.6 Opus" }],
    });
    await expect(resolveCursorModels(credentials)).resolves.toEqual({
      models: [{ id: "claude-4.6-opus", name: "Claude 4.6 Opus" }],
    });

    // Second call is served from the in-process cache — one HTTP/2 request only.
    expect(h2.requests).toHaveLength(1);
    expect(h2.requests[0]).toEqual(
      expect.objectContaining({
        ":method": "POST",
        ":scheme": "https",
        ":authority": "agent.api5.cursor.sh",
        ":path": "/agent.v1.AgentService/GetUsableModels",
        // Connect unary call: unframed protobuf, no connect-* headers.
        accept: "application/proto",
        "content-type": "application/proto",
      }),
    );
  });

  it("fails open when the Cursor catalog request fails", async () => {
    h2.reset(403, Buffer.from("no"));

    await expect(resolveCursorModels({
      accessToken: "cursor-token",
      providerSpecificData: { machineId: "machine-id" },
    })).resolves.toBeNull();
  });
});
