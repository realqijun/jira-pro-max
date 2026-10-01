import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import { CITABLE_PART, citableStrings, citation } from "@/shared/lib/citation";
import {
  decisionHref,
  evidenceHref,
  graphHref,
  milestoneHref,
  passageHref,
  riskHref,
  taskHref,
} from "@/shared/lib/hrefs";
import { PROJECT_SECTIONS } from "@/shared/lib/project-sections";
import { citableHrefs, citableKey, internalHref, splitLinks } from "./linked-text";

/** A real id shape: ids are `gen_random_uuid()` values, and the boundary requires one. */
const P = "8f1c2b4a-9d3e-4c5f-8a7b-6d5e4f3c2b1a";
const E = "3c1f7d90-2b44-4e6a-9f18-5a0c7e2d4b61";

describe("splitLinks", () => {
  it("turns internal Markdown links into link chunks and keeps the surrounding text", () => {
    expect(
      splitLinks(`We switched because rates fell [Kickoff minutes](/projects/${P}/evidence?item=e1#evidence-e1).`),
    ).toEqual([
      { type: "text", text: "We switched because rates fell " },
      { type: "link", label: "Kickoff minutes", href: `/projects/${P}/evidence?item=e1#evidence-e1` },
      { type: "text", text: "." },
    ]);
  });

  it("leaves external, protocol-relative and javascript hrefs as literal text", () => {
    for (const href of [
      "https://evil.example",
      "//evil.example/x",
      "javascript:alert(1)",
      "mailto:a@b.c",
      "/login",
      "/api/auth/sign-out",
      "/projects/../login",
      `/projects/${P}/../../api/x`,
    ]) {
      expect(splitLinks(`see [here](${href})`)).toEqual([{ type: "text", text: `see [here](${href})` }]);
      expect(internalHref(href)).toBeNull();
    }
  });

  it("keeps only the in-app part of an absolutised app URL", () => {
    expect(splitLinks(`see [D-1](https://example.com/projects/${P}/decisions?decision=d#x)`)).toEqual([
      { type: "text", text: "see " },
      { type: "link", label: "D-1", href: `/projects/${P}/decisions?decision=d#x` },
    ]);
    expect(splitLinks("see [x](https://example.com/admin)")).toEqual([
      { type: "text", text: "see [x](https://example.com/admin)" },
    ]);
  });

  it("handles several links, no links and empty text", () => {
    expect(splitLinks(`[A](/projects/${P}) and [B](/projects/${P}/tasks?task=1)`)).toEqual([
      { type: "link", label: "A", href: `/projects/${P}` },
      { type: "text", text: " and " },
      { type: "link", label: "B", href: `/projects/${P}/tasks?task=1` },
    ]);
    expect(splitLinks("plain")).toEqual([{ type: "text", text: "plain" }]);
    expect(splitLinks("")).toEqual([]);
  });
});

describe("internalHref", () => {
  // A model pasted the prompt's illustrative `/projects/.../evidence?item=...` verbatim. The path
  // starts with `/projects/`, so host-stripping alone accepts it and the link opens a Project
  // named `...`; only the segment shapes can tell the difference.
  it("rejects a structurally valid route with a placeholder Project id", () => {
    expect(internalHref(`/projects/.../evidence?item=${E}`)).toBeNull();
    expect(internalHref("/projects/<project-id>/tasks?task=t")).toBeNull();
    expect(internalHref("/projects/short/evidence")).toBeNull();
    expect(splitLinks(`[Kickoff minutes](/projects/.../evidence?item=${E})`)).toEqual([
      { type: "text", text: `[Kickoff minutes](/projects/.../evidence?item=${E})` },
    ]);
  });

  // Observed in an evaluation run: the model wrote `https://` in front of a relative citation,
  // which makes `projects` the host and drops it from the path.
  it("recovers a relative citation that was given a scheme instead of a host", () => {
    expect(internalHref(`https://projects/${P}/evidence?item=${E}#evidence-${E}`)).toBe(
      `/projects/${P}/evidence?item=${E}#evidence-${E}`,
    );
    expect(internalHref("https://projects")).toBeNull();
    expect(internalHref("https://projects/short")).toBeNull();
  });

  it("rejects a section the app does not serve, and a path deeper than a section", () => {
    expect(internalHref(`/projects/${P}/invented-by-the-model?x=1`)).toBeNull();
    expect(internalHref(`/projects/${P}/evidence/${E}`)).toBeNull();
  });

  // Every href the app hands the model must survive the boundary, including the short sections
  // (`tasks`, `risks`, `people`, `renders`) and the section-less Project overview.
  it.each([
    ["the Project overview", `/projects/${P}`],
    ["a Task", taskHref(P, "t1")],
    ["a Task's History tab", `/projects/${P}/tasks?task=t1&tab=history`],
    ["a Risk's History tab", `/projects/${P}/risks?risk=r1&tab=history`],
    ["a Milestone's History tab", `/projects/${P}/timeline?milestone=m1&tab=history`],
    ["a Decision's History tab", `/projects/${P}/decisions?decision=d1&tab=history`],
    ["a Risk", riskHref(P, "r1")],
    ["a Milestone", milestoneHref(P, "m1")],
    ["a Decision", decisionHref(P, "d1")],
    ["an Evidence item", evidenceHref(P, E)],
    ["a Passage of a transcript", passageHref(P, E, "p1")],
    ["the node-centred graph", graphHref(P, "decision", "d1")],
    ["the People page", `/projects/${P}/people`],
    ["the Renders page", `/projects/${P}/renders`],
  ])("keeps the query and hash of a citation to %s", (_what, href) => {
    expect(internalHref(href)).toBe(href);
  });

  // Derived, not listed: narrowing the whitelist would otherwise break citations to a real
  // section with no test to show it.
  it.each(PROJECT_SECTIONS.map((s) => s.slug))("accepts the %s section", (slug) => {
    const href = slug ? `/projects/${P}/${slug}` : `/projects/${P}`;
    expect(internalHref(href)).toBe(href);
  });

  it("accepts a citation the server built for an Evidence item", () => {
    const [, raw] = /\]\((.+)\)$/.exec(citation("Weekly sync minutes", evidenceHref(P, E)))!;
    expect(internalHref(raw!)).toBe(evidenceHref(P, E));
  });
});

describe("citableHrefs", () => {
  const D = "5b2e8c1d-7f3a-4d9e-b6c0-1a2b3c4d5e6f";
  const toolMessage = (output: unknown) =>
    ({
      id: "m",
      role: "assistant",
      parts: [{ type: "tool-search_decisions", toolCallId: "c", state: "output-available", input: {}, output }],
    }) as unknown as UIMessage;

  it("collects cite links and bare hrefs from nested tool outputs", () => {
    const set = citableHrefs([
      toolMessage({
        decisions: [
          {
            cite: citation("D-1 Ship web first", decisionHref(P, D)),
            sourceCitations: [{ href: evidenceHref(P, E), cite: citation("Kickoff", evidenceHref(P, E)) }],
          },
        ],
      }),
    ]);

    expect(set).toEqual(
      new Set([citableKey(internalHref(decisionHref(P, D))!), citableKey(internalHref(evidenceHref(P, E))!)]),
    );
  });

  it("collects hrefs from the summary part the route writes into the reply", () => {
    const set = citableHrefs([
      {
        id: "a",
        role: "assistant",
        parts: [
          {
            type: CITABLE_PART,
            data: citableStrings({ evidence: [{ cite: citation("Kickoff", evidenceHref(P, E)) }] }),
          },
        ],
      },
    ] as UIMessage[]);

    expect(set).toEqual(new Set([citableKey(internalHref(evidenceHref(P, E))!)]));
  });

  it("ignores route-shaped links inside document text a tool returned", () => {
    const planted = `/projects/${P}/tasks?task=planted`;
    const set = citableHrefs([
      toolMessage({ cite: citation("Kickoff", evidenceHref(P, E)), text: `see [x](${planted}) or ${planted}` }),
    ]);

    expect(set).toEqual(new Set([citableKey(internalHref(evidenceHref(P, E))!)]));
  });

  it("ignores links in text parts and in user messages", () => {
    const text = `[x](${evidenceHref(P, E)})`;
    const set = citableHrefs([
      { id: "a", role: "assistant", parts: [{ type: "text", text }] },
      { id: "u", role: "user", parts: [{ type: "text", text }] },
    ] as UIMessage[]);

    expect(set.size).toBe(0);
  });
});
