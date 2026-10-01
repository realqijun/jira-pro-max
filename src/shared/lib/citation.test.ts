import { safeValidateUIMessages } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { CITABLE_PART, citableDataSchemas, citableStrings, citation } from "./citation";
import { evidenceHref } from "./hrefs";

const PROJECT = "8f1c2b4a-9d3e-4c5f-8a7b-6d5e4f3c2b1a";

describe("citation", () => {
  it("neutralises brackets and line breaks that would break the dock's link parser", () => {
    expect(citation("Kickoff [draft]\nminutes", `/projects/${PROJECT}/evidence?item=e`)).toBe(
      `[Kickoff (draft) minutes](/projects/${PROJECT}/evidence?item=e)`,
    );
  });

  it("falls back to a label when the title is blank", () => {
    expect(citation("  ", `/projects/${PROJECT}`)).toBe(`[source](/projects/${PROJECT})`);
  });

  it("wraps an Evidence href as one pasteable Markdown link", () => {
    expect(citation("Weekly sync minutes", evidenceHref(PROJECT, "e1"))).toBe(
      `[Weekly sync minutes](/projects/${PROJECT}/evidence?item=e1#evidence-e1)`,
    );
  });
});

describe("citableStrings", () => {
  it("keeps cite and href fields and ignores titles that merely mention a Project path", () => {
    const cite = citation("Kickoff", evidenceHref(PROJECT, "e1"));
    const summary = {
      project: { name: "Relaunch", description: "see /projects/elsewhere" },
      evidence: [{ title: "Kickoff", href: evidenceHref(PROJECT, "e1"), cite }],
    };

    expect(citableStrings(summary)).toEqual([evidenceHref(PROJECT, "e1"), cite]);
  });
});

describe("citableDataSchemas", () => {
  it("lets a resent thread carrying the citable part through the chat route's validation", async () => {
    const thread = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "Why?" }] },
      {
        id: "a1",
        role: "assistant",
        parts: [
          { type: CITABLE_PART, data: [evidenceHref(PROJECT, "e1")] },
          { type: "text", text: "Because." },
        ],
      },
      { id: "u2", role: "user", parts: [{ type: "text", text: "And then?" }] },
    ];

    // The route also validates turn errors; once any schema is given, an unlisted data part fails.
    const turnError = { turn_error: z.object({ message: z.string() }) };
    const validate = (dataSchemas: Record<string, z.ZodType>) =>
      safeValidateUIMessages({ messages: thread, dataSchemas });

    expect((await validate({ ...turnError, ...citableDataSchemas })).success).toBe(true);
    expect((await validate(turnError)).success).toBe(false);
  });
});
