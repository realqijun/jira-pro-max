import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownText, citationKind } from "./markdown-text";

const P = "8f1c2b4a-9d3e-4c5f-8a7b-6d5e4f3c2b1a";
const none = new Set<string>();

describe("MarkdownText", () => {
  it("renders common Assistant Markdown", () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownText, { text: "## Plan\n\n- **Ship** the `parser`\n- Test it", citable: none }),
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
        citable: new Set([`/projects/${P}/tasks?task=t`]),
      }),
    );

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain(`href="/projects/${P}/tasks?task=t"`);
    expect(html).not.toContain('href="https://example.com"');
  });

  it("renders a placeholder Project id as plain text instead of a link", () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownText, { text: "[Kickoff minutes](/projects/.../evidence?item=e1)", citable: none }),
    );

    expect(html).not.toContain("<a");
    expect(html).toContain("Kickoff minutes");
  });

  it("renders a well-formed route no tool returned as plain text", () => {
    const returned = `/projects/${P}/evidence?item=c892f171-ee2a-4233-a091-000000000001`;
    const miscopied = `/projects/${P}/evidence?item=c892f171-ee2a-4233-0a91-000000000001`;
    const html = renderToStaticMarkup(
      createElement(MarkdownText, { text: `[Real](${returned}) [Typo](${miscopied})`, citable: new Set([returned]) }),
    );

    expect(html).toContain(`href="${returned}"`);
    expect(html).not.toContain(miscopied);
    expect(html).toContain("Typo");
  });

  it("links a tool's citation even when the model drops its scroll fragment", () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownText, {
        text: `[Kickoff](/projects/${P}/evidence?item=e1)`,
        citable: new Set([`/projects/${P}/evidence?item=e1`]),
      }),
    );

    expect(html).toContain(`href="/projects/${P}/evidence?item=e1"`);
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
