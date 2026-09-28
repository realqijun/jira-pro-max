import { describe, expect, it } from "vitest";
import { citation } from "./citation";
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
