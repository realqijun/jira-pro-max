import { describe, expect, it } from "vitest";
import { CITATION_RULES, WHY_RULES, projectSystemPrompt, workspaceSystemPrompt } from "./prompt";

describe("projectSystemPrompt", () => {
  it("carries the citation rules for why-did-we answers", () => {
    const prompt = projectSystemPrompt({ project: { id: "p" } });
    for (const rule of [...CITATION_RULES, ...WHY_RULES]) expect(prompt).toContain(rule);
    expect(prompt).toContain("There is no recorded decision about that.");
    expect(prompt).toContain("supersededBy");
    expect(workspaceSystemPrompt([])).not.toContain("search_decisions");
  });

  it("tells the model to copy a cite for Evidence, not only for Decisions", () => {
    const rules = CITATION_RULES.join("\n");
    for (const tool of ["get_project_summary", "list_evidence", "search_evidence", "read_evidence"]) {
      expect(rules).toContain(tool);
    }
  });

  // A placeholder path in the prompt is a string the model pastes into an answer: an evaluation run
  // saw both `[D-n title](href)` and `/projects/.../evidence?item=...` copied verbatim into citations.
  it("holds no pasteable link placeholder", () => {
    const prompt = projectSystemPrompt({ project: { id: "p" } });
    expect(prompt).not.toContain("](href)");
    expect(prompt).not.toContain("/projects/...");
    expect(prompt).not.toMatch(/\/projects\/[^\s)]*\.\.\./);
  });
});
