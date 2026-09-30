import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx } from "@/server/core/context";
import { heuristicExtract, modelExtract, sentencesOf } from "./extract";

const model = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/server/modules/assistant/model", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/modules/assistant/model")>()),
  getModelForUser: async () => model.current,
}));

const source = (text: string) => ({ kind: "evidence" as const, entityId: "e1", title: "Notes", text });
const ctx = { people: [], milestones: [], tasks: [], conversation: "" };

describe("heuristicExtract", () => {
  it("proposes one Decision per sentence with a decision verb, citing it verbatim", async () => {
    const text =
      "Attendees: Priya, Marcus.\n\nAfter the pilot we decided to switch from weekly surveys to fortnightly interviews because response rates fell to 4%. The vendor sandbox is still pending.";
    const { proposals } = await heuristicExtract({ sources: [source(text)], context: ctx });
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({
      title: "Switch from weekly surveys to fortnightly interviews because response rates fell to 4%",
      sources: [
        {
          kind: "evidence",
          entityId: "e1",
          excerpt:
            "After the pilot we decided to switch from weekly surveys to fortnightly interviews because response rates fell to 4%.",
        },
      ],
    });
  });

  it("extracts the rejected option after 'instead of' and returns nothing for plain prose", async () => {
    const { proposals } = await heuristicExtract({
      sources: [source("We agreed to run interviews instead of a second survey round. Lunch was late.")],
      context: ctx,
    });
    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.alternatives).toBe("a second survey round");
    expect(
      (await heuristicExtract({ sources: [source("Status is green. Nothing new.")], context: ctx })).proposals,
    ).toEqual([]);
  });

  it("splits sentences on punctuation and blank lines and drops fragments", () => {
    expect(sentencesOf("Short.\n\nA second sentence here! Third one? tiny")).toEqual([
      "A second sentence here!",
      "Third one?",
    ]);
  });
});

describe("modelExtract temperature", () => {
  const userCtx = { userId: "u1" } as Ctx;
  const ok = {
    content: [{ type: "text" as const, text: JSON.stringify({ proposals: [] }) }],
    finishReason: { unified: "stop" as const, raw: "stop" },
    usage: {
      inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 5, text: 5, reasoning: 0 },
    },
    warnings: [],
  };
  const rejected = (body: string) =>
    new APICallError({
      message: "Bad Request",
      url: "https://gateway.example/v1/chat/completions",
      requestBodyValues: {},
      statusCode: 400,
      responseBody: body,
      isRetryable: false,
    });
  const run = (settings?: Parameters<typeof modelExtract>[1]) =>
    modelExtract(userCtx, settings)({ sources: [source("We decided to ship.")], context: ctx });

  beforeEach(() => {
    model.current = null;
  });

  it("samples at 0 by default and leaves temperature unset when asked for the provider default", async () => {
    const m = new MockLanguageModelV4({ doGenerate: ok });
    model.current = m;
    await run();
    await run({ temperature: null });
    expect(m.doGenerateCalls.map((c) => c.temperature)).toEqual([0, undefined]);
  });

  it("retries once without temperature when the endpoint rejects it", async () => {
    const temps: Array<number | undefined> = [];
    model.current = new MockLanguageModelV4({
      doGenerate: async (opts) => {
        temps.push(opts.temperature);
        if (opts.temperature !== undefined)
          throw rejected('{"error":"Unsupported parameter: temperature is not supported with this model"}');
        return ok;
      },
    });
    await expect(run()).resolves.toEqual({ proposals: [] });
    expect(temps).toEqual([0, undefined]);
  });

  it("does not retry other 400s", async () => {
    const m = new MockLanguageModelV4({
      doGenerate: async () => {
        throw rejected('{"error":"context length exceeded"}');
      },
    });
    model.current = m;
    await expect(run()).rejects.toThrow();
    expect(m.doGenerateCalls).toHaveLength(1);
  });
});

describe("modelExtract prompt", () => {
  it("sends the Decision prompt unchanged (evals in evals/cases/ measure this exact text)", async () => {
    const m = new MockLanguageModelV4({
      doGenerate: {
        content: [{ type: "text", text: JSON.stringify({ proposals: [] }) }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 1, text: 1, reasoning: 0 },
        },
        warnings: [],
      },
    });
    model.current = m;
    await modelExtract({ userId: "u1" } as Ctx)({
      sources: [
        { kind: "evidence", entityId: "e1", title: "Call", evidenceKind: "transcript", text: "We decided to ship." },
        { kind: "comment", entityId: "c1", title: "Comment by Priya", text: "Agreed." },
      ],
      context: { people: ["Priya Nair"], milestones: ["UAT begins"], tasks: [], conversation: "user: hi" },
    });
    expect(m.doGenerateCalls[0]!.prompt).toMatchSnapshot();
  });
});
