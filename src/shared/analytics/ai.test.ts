import {
  APICallError,
  NoObjectGeneratedError,
  simulateReadableStream,
  streamText,
  tool,
  type LanguageModelUsage,
} from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { beforeEach, describe, expect, it, vi } from "vitest";

const server = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock("./server", () => ({ capture: server.capture }));

const usage = {
  inputTokens: 1200,
  outputTokens: 80,
  inputTokenDetails: { cacheReadTokens: 1024 },
  outputTokenDetails: { reasoningTokens: 0 },
} as LanguageModelUsage;

const telemetry = { userId: "user-a", properties: { project_id: "project-a" } };
const call = { span: "proposal_extraction" as const, provider: "openai", model: "gpt-4o-mini" };

beforeEach(() => {
  vi.resetAllMocks();
  server.capture.mockResolvedValue(undefined);
});

describe("LLM generation telemetry", () => {
  it("records tokens and latency in PostHog's $ai_generation shape, without prompt or output", async () => {
    const { traceGeneration } = await import("./ai");
    const result = await traceGeneration(telemetry, call, async () => ({ proposals: [], usage }));
    expect(result).toEqual({ proposals: [], usage });
    const [userId, event, properties] = server.capture.mock.calls[0];
    expect(userId).toBe("user-a");
    expect(event).toBe("$ai_generation");
    expect(properties).toMatchObject({
      project_id: "project-a",
      $ai_span_name: "proposal_extraction",
      $ai_provider: "openai",
      $ai_model: "gpt-4o-mini",
      $ai_input_tokens: 1200,
      $ai_output_tokens: 80,
      $ai_cache_read_input_tokens: 1024,
      $ai_is_error: false,
    });
    expect(properties.$ai_trace_id).toEqual(expect.any(String));
    expect(properties.$ai_latency).toBeGreaterThanOrEqual(0);
    expect(properties).not.toHaveProperty("$ai_input");
    expect(properties).not.toHaveProperty("$ai_output_choices");
    expect(properties).not.toHaveProperty("$ai_error");
  });

  it("only runs the call when no User is attributed", async () => {
    const { traceGeneration } = await import("./ai");
    await expect(traceGeneration(undefined, call, async () => ({ usage }))).resolves.toEqual({ usage });
    expect(server.capture).not.toHaveBeenCalled();
  });

  it("records a failed call by error class only and rethrows it unchanged", async () => {
    const { traceGeneration } = await import("./ai");
    const failure = new TypeError("prompt text echoed by the provider");
    await expect(
      traceGeneration(telemetry, call, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(server.capture.mock.calls[0][2]).toMatchObject({ $ai_is_error: true, $ai_error: "TypeError" });
    expect(JSON.stringify(server.capture.mock.calls[0][2])).not.toContain("prompt text");
  });

  it("keeps the tokens a schema mismatch spent", async () => {
    const { traceGeneration } = await import("./ai");
    const failure = new NoObjectGeneratedError({
      message: "no object",
      text: "{}",
      response: { id: "r", timestamp: new Date(), modelId: "gpt-4o-mini" },
      usage,
      finishReason: "stop",
    });
    await expect(traceGeneration(telemetry, call, () => Promise.reject(failure))).rejects.toBe(failure);
    expect(server.capture.mock.calls[0][2]).toMatchObject({ $ai_is_error: true, $ai_input_tokens: 1200 });
  });

  it("reports one provider family for the SDK's per-API provider names", async () => {
    const { captureGeneration } = await import("./ai");
    await captureGeneration("user-a", { ...call, provider: "openai.responses", traceId: "t", latencyMs: 5 });
    expect(server.capture.mock.calls[0][2]).toMatchObject({ $ai_provider: "openai", $ai_latency: 0.005 });
  });

  it("never lets telemetry fail the model call", async () => {
    server.capture.mockRejectedValue(new Error("collector down"));
    const { traceGeneration } = await import("./ai");
    await expect(traceGeneration(telemetry, call, async () => ({ usage }))).resolves.toEqual({ usage });
  });
});

describe("streamText generation recorder", () => {
  const providerUsage = {
    inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 5, text: 5, reasoning: 0 },
  };
  const text = [
    { type: "text-start" as const, id: "1" },
    { type: "text-delta" as const, id: "1", delta: "hi" },
  ];
  const finish = (unified: "stop" | "error" | "tool-calls") => ({
    type: "finish" as const,
    finishReason: { unified, raw: unified },
    usage: providerUsage,
  });
  const streaming = (...chunks: unknown[][]) => {
    let call = 0;
    return new MockLanguageModelV4({
      doStream: async () => ({ stream: simulateReadableStream({ chunks: chunks[call++] as never[] }) }),
    });
  };

  async function run(model: MockLanguageModelV4, extra: Record<string, unknown> = {}) {
    const { generationRecorder } = await import("./ai");
    const g = generationRecorder("user-a", { traceId: "turn-1", provider: "openai", model: "gpt-4o-mini" });
    await streamText({
      model,
      prompt: "x",
      maxRetries: 1,
      ...g,
      onError: ({ error }) => g.onError(error),
      ...extra,
    }).consumeStream();
    return server.capture.mock.calls.map((c) => c[2]);
  }

  it("records each successful call once with its usage and step", async () => {
    const events = await run(
      streaming(
        [{ type: "tool-call", toolCallId: "c", toolName: "echo", input: "{}" }, finish("tool-calls")],
        [...text, { type: "text-end", id: "1" }, finish("stop")],
      ),
      { tools: { echo: tool({ inputSchema: z.object({}), execute: async () => "ok" }) }, stopWhen: () => false },
    );
    expect(events).toHaveLength(2);
    expect(events.map((e) => [e.step, e.$ai_is_error, e.$ai_input_tokens])).toEqual([
      [0, false, 10],
      [1, false, 10],
    ]);
    expect(events[0]).toMatchObject({ $ai_trace_id: "turn-1", $ai_span_name: "assistant_turn" });
  });

  it("records a stream that fails midway once, as an error", async () => {
    const events = await run(streaming([...text, { type: "error", error: new Error("mid") }, finish("error")]));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ $ai_is_error: true, step: 0 });
  });

  it("records a mid-stream error with no finish chunk", async () => {
    const events = await run(streaming([...text, { type: "error", error: new Error("mid") }]));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ $ai_is_error: true });
  });

  it("records a call that failed before streaming, once across retries", async () => {
    const model = new MockLanguageModelV4({
      doStream: async () => {
        throw new APICallError({
          message: "down",
          url: "u",
          requestBodyValues: {},
          statusCode: 500,
          isRetryable: true,
        });
      },
    });
    const events = await run(model);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ $ai_is_error: true, $ai_error: "AI_RetryError" });
  });

  it("does not count an error outside a model call as a generation", async () => {
    const { generationRecorder } = await import("./ai");
    const g = generationRecorder("user-a", { traceId: "t", provider: "openai", model: "gpt-4o-mini" });
    await g.onError(new Error("tool approval signature"));
    expect(server.capture).not.toHaveBeenCalled();
  });
});
