import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownText, citationKind } from "./markdown-text";

const P = "8f1c2b4a-9d3e-4c5f-8a7b-6d5e4f3c2b1a";

describe("MarkdownText", () => {
  it("renders common Assistant Markdown", () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownText, { text: "## Plan\n\n- **Ship** the `parser`\n- Test it" }),
    );

    expect(html).toContain("<h2");
    expect(html).toContain("<ul");
    expect(html).toContain("<strong");
    expect(html).toContain("<code");
  });

  it("keeps raw HTML inert and only links to Project routes", () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownText, {
        text: `<script>alert('no')</script>\n\n[Task](/projects/${P}/tasks?task=t) [Outside](https://example.com)`,
      }),
    );

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain(`href="/projects/${P}/tasks?task=t"`);
    expect(html).not.toContain('href="https://example.com"');
  });

  it("renders a placeholder Project id as plain text instead of a link", () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownText, { text: "[Kickoff minutes](/projects/.../evidence?item=e1)" }),
    );

    expect(html).not.toContain("<a");
    expect(html).toContain("Kickoff minutes");
  });
});

describe("citationKind", () => {
  it.each([
    ["/projects/p/decisions?decision=d", "decisions"],
    ["/projects/p/evidence?item=e#passage-x", "evidence"],
    ["/projects/p/tasks?note=x&task=t", "tasks"],
    ["/projects/p/renders?render=r", "renders"],
    ["/projects/p/graph?node=decision:d", "graph"],
    ["/projects/p", "overview"],
    ["/projects/p/?utm=x", "overview"],
    ["/projects/p/invented-by-the-model", "other"],
  ])("reports %s as %s from a closed set", (href, kind) => {
    expect(citationKind(href)).toBe(kind);
  });
});
