import { APICallError, RetryError, type UIMessageChunk } from "ai";
import { describe, expect, it } from "vitest";
import { TURN_ERROR_PART } from "@/shared/lib/assistant-errors";
import { keepTurnErrors, turnErrorDataSchemas, turnErrorMessage } from "./turn-error";

const apiError = (statusCode: number) =>
  new APICallError({
    message: "Incorrect API key provided: sk-or-***1234",
    url: "https://example.test/v1/chat",
    requestBodyValues: {},
    statusCode,
  });

async function collect(chunks: UIMessageChunk[]) {
  const out: UIMessageChunk[] = [];
  const reader = keepTurnErrors(
    new ReadableStream({ start: (c) => (chunks.forEach((x) => c.enqueue(x)), c.close()) }),
  ).getReader();
  for (let r = await reader.read(); !r.done; r = await reader.read()) out.push(r.value);
  return out;
}

describe("turnErrorMessage", () => {
  it("maps provider failures to copy that never echoes the provider's text", () => {
    expect(turnErrorMessage(apiError(401))).toMatch(/rejected the API key/);
    expect(turnErrorMessage(apiError(429))).toMatch(/rate limiting/);
    expect(turnErrorMessage(apiError(503))).toMatch(/unavailable/);
    for (const status of [400, 401, 429, 503]) expect(turnErrorMessage(apiError(status))).not.toContain("sk-");
  });

  it("looks through retries and falls back for anything else", () => {
    const retried = new RetryError({ message: "failed", reason: "maxRetriesExceeded", errors: [apiError(429)] });
    expect(turnErrorMessage(retried)).toMatch(/rate limiting/);
    expect(turnErrorMessage(new Error("boom"))).toBe("The Assistant could not finish this reply. Try again.");
  });
});

describe("keepTurnErrors", () => {
  it("writes the error into the reply right before the error chunk", async () => {
    const out = await collect([
      { type: "start", messageId: "a1" },
      { type: "error", errorText: "The AI provider is unavailable right now. Try again shortly." },
    ]);
    expect(out.map((c) => c.type)).toEqual(["start", TURN_ERROR_PART, "error"]);
    expect(out[1]).toMatchObject({ data: { message: "The AI provider is unavailable right now. Try again shortly." } });
  });

  it("turns a stream that throws into a recorded, mapped error", async () => {
    let sent = false;
    const failing = new ReadableStream<UIMessageChunk>({
      pull(c) {
        if (sent) throw apiError(401);
        sent = true;
        c.enqueue({ type: "start", messageId: "a1" });
      },
    });
    const reader = keepTurnErrors(failing).getReader();
    const out: UIMessageChunk[] = [];
    for (let r = await reader.read(); !r.done; r = await reader.read()) out.push(r.value);
    expect(out.map((c) => c.type)).toEqual(["start", TURN_ERROR_PART, "error"]);
    expect(out[2]).toMatchObject({ errorText: "The AI provider rejected the API key. Check it in Settings." });
  });

  it("clamps a long message to what the thread schema accepts", async () => {
    const out = await collect([{ type: "error", errorText: "x".repeat(2000) }]);
    const data = (out[0] as { data: { message: string } }).data;
    expect(turnErrorDataSchemas.turn_error.safeParse(data).success).toBe(true);
  });

  it("leaves a healthy stream untouched", async () => {
    const chunks: UIMessageChunk[] = [{ type: "start" }, { type: "finish" }];
    expect(await collect(chunks)).toEqual(chunks);
  });
});
