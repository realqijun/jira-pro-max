import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownText, citationKind } from "./markdown-text";

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
        text: "<script>alert('no')</script>\n\n[Task](/projects/p/tasks?task=t) [Outside](https://example.com)",
      }),
    );

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain('href="/projects/p/tasks?task=t"');
    expect(html).not.toContain('href="https://example.com"');
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
