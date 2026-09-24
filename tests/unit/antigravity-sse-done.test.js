import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/usageDb.js', () => ({
  trackPendingRequest: vi.fn(), appendRequestLog: vi.fn(async () => {}),
}));
import { createSSETransformStreamWithLogger, createPassthroughStreamWithLogger } from '../../open-sse/utils/stream.js';
import { FORMATS } from '../../open-sse/translator/formats.js';

const payload = { response: {
  responseId: 'test-response', modelVersion: 'gemini-test',
  candidates: [{ content: { role: 'model', parts: [{ text: 'سلام' }] }, finishReason: 'STOP' }],
  usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2, totalTokenCount: 12 },
} };
const input = `data: ${JSON.stringify(payload)}\n\n`;
async function run(text, source = FORMATS.OPENAI, target = FORMATS.ANTIGRAVITY, bytewise = false, passthrough = false) {
  const bytes = new TextEncoder().encode(text);
  const readable = new ReadableStream({ start(controller) {
    if (bytewise) for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
    else controller.enqueue(bytes);
    controller.close();
  } });
  const transform = passthrough
    ? createPassthroughStreamWithLogger('antigravity')
    : createSSETransformStreamWithLogger(target, source, 'antigravity');
  return new Response(readable.pipeThrough(transform)).text();
}
function assertCompleted(text, expectedPromptTokens = 2010) {
  expect(text.endsWith('data: [DONE]\n\n')).toBe(true);
  expect(text.match(/data: \[DONE\]/g)).toHaveLength(1);
  const events = text.split('\n').filter(x => x.startsWith('data: {')).map(x => JSON.parse(x.slice(6)));
  expect(events.map(x => x.choices?.[0]?.delta?.content || '').join('')).toBe('سلام');
  expect(events.at(-1).choices[0].finish_reason).toBe('stop');
  expect(events.at(-1).usage).toMatchObject({ prompt_tokens: expectedPromptTokens, completion_tokens: 2 });
}
describe('Antigravity to OpenAI SSE termination', () => {
  it('emits one terminal marker after finish and usage on clean upstream EOF', async () => {
    assertCompleted(await run(input));
  });
  it('handles UTF-8 and SSE fields split at every byte', async () => {
    assertCompleted(await run(input, FORMATS.OPENAI, FORMATS.ANTIGRAVITY, true));
  });
  it('handles a final JSON event without a newline', async () => {
    // Existing translator applies its 2000-token safety buffer to normal chunks,
    // while buffered EOF chunks retain raw usage. This fix preserves both.
    assertCompleted(await run(input.trimEnd()), 10);
  });
  it('does not mistake an upstream marker for an emitted client marker', async () => {
    assertCompleted(await run(input + 'data: [DONE]\n\n'));
  });
  it('does not duplicate repeated upstream markers', async () => {
    assertCompleted(await run(input + 'data: [DONE]\n\ndata: [DONE]\n\n'));
  });
  it('does not add an OpenAI marker to native Gemini-family passthrough', async () => {
    expect(await run(input, FORMATS.ANTIGRAVITY, FORMATS.ANTIGRAVITY, false, true)).not.toContain('[DONE]');
  });
  it('does not add an OpenAI marker to translated Claude events', async () => {
    const text = await run(input, FORMATS.CLAUDE);
    expect(text).toContain('message_stop');
    expect(text).not.toContain('[DONE]');
  });
  it('does not duplicate the Responses format terminal marker', async () => {
    const text = await run('event: response.completed\ndata: {"type":"response.completed","response":{"id":"r","status":"completed"}}\n\ndata: [DONE]\n\n', FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI_RESPONSES);
    expect(text.match(/data: \[DONE\]/g)).toHaveLength(1);
    expect(text).toContain('response.completed');
  });
});
