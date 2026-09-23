import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import { repairInterruptedToolCalls } from "./repair";

const toolPart = (state: string, extra: Record<string, unknown> = {}) =>
  ({
    type: "tool-create_task",
    toolCallId: "call_1",
    state,
    input: { title: "x" },
    ...extra,
  }) as unknown as UIMessage["parts"][number];

const thread = (parts: UIMessage["parts"][number][]): UIMessage[] => [
  { id: "u1", role: "user", parts: [{ type: "text", text: "hi" }] },
  { id: "a1", role: "assistant", parts },
];

describe("repairInterruptedToolCalls", () => {
  it("rewrites calls that never ran as interrupted errors", () => {
    for (const state of ["input-streaming", "input-available", "approval-requested"]) {
      const part = state === "approval-requested" ? toolPart(state, { approval: { id: "ap1" } }) : toolPart(state);
      const [, repaired] = repairInterruptedToolCalls(thread([part]));
      const fixed = repaired!.parts[0] as { state: string; errorText?: string; approval?: unknown };
      expect(fixed.state).toBe("output-error");
      expect(fixed.errorText).toContain("interrupted");
      expect(fixed.approval).toBeUndefined();
    }
  });

  it("leaves terminal and answered-approval parts untouched", () => {
    const parts = [
      toolPart("output-available", { output: { id: "t1" } }),
      toolPart("output-error", { errorText: "boom" }),
      toolPart("approval-responded", { approval: { id: "ap2", approved: true } }),
      toolPart("output-denied", { approval: { id: "ap3", approved: false } }),
    ];
    const [, repaired] = repairInterruptedToolCalls(thread(parts));
    expect(repaired!.parts).toEqual(parts);
  });

  it("does not touch provider-executed calls or non-assistant messages", () => {
    const provider = toolPart("input-available", { providerExecuted: true });
    const [user, assistant] = repairInterruptedToolCalls(thread([provider]));
    expect(assistant!.parts[0]).toBe(provider);
    expect(user!.parts).toEqual([{ type: "text", text: "hi" }]);
  });
});
