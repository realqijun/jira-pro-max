import { isToolUIPart, type UIMessage } from "ai";
import Link from "next/link";
import * as React from "react";
import { CITABLE_PART, citableStrings } from "@/shared/lib/citation";
import { PROJECT_SECTIONS } from "@/shared/lib/project-sections";

export type TextChunk = { type: "text"; text: string } | { type: "link"; label: string; href: string };

const LINK = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;

/** Project sections a citation can land on (plus the graph, which is a page but not a tab). */
export const CITATION_KINDS = new Set<string>([...PROJECT_SECTIONS.map((s) => s.slug).filter(Boolean), "graph"]);

/**
 * Ids are database-generated (`gen_random_uuid()` into a `text` column), so an identifier shape
 * is asserted rather than a UUID. This is what rejects a copied ellipsis such as
 * `/projects/.../evidence?item=<id>`, which is a structurally valid route to a Project named `...`.
 */
const PROJECT_ID = /^[A-Za-z0-9_-]{8,}$/;

/**
 * A pathname that is a real Project route: `/projects/<id>` or `/projects/<id>/<section>`, with
 * the section from the closed set the app actually serves. Nothing deeper exists, so a longer
 * path is not one of ours. Sanitisation cannot rescue a wrong path, so the boundary only accepts
 * shapes it recognises.
 */
export function isInternalHref(pathname: string) {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length < 2 || segments.length > 3) return false;
  const [root, projectId, section] = segments;
  if (root !== "projects" || !PROJECT_ID.test(projectId!)) return false;
  return section === undefined || CITATION_KINDS.has(section);
}

/**
 * Models sometimes "absolutise" a relative href with an invented host, and sometimes paste a
 * placeholder path. Keep only the in-app part (path, query, hash) of a relative or http(s) URL
 * whose normalised path (so `/projects/../login` cannot slip through) is a Project route;
 * anything else is null.
 */
export function internalHref(href: string): string | null {
  if (!href.startsWith("/projects/") && !/^https?:\/\//i.test(href)) return null;
  try {
    const u = new URL(href, "http://app.local");
    // Prefixing `https://` to a relative citation makes its first segment the host, so
    // `https://projects/<id>/evidence` parses with host `projects` and loses that segment.
    // Putting it back is the same repair as stripping an invented host, and the recovered path
    // is validated like any other.
    const pathname = u.hostname === "projects" ? `/projects${u.pathname}` : u.pathname;
    return isInternalHref(pathname) ? `${pathname}${u.search}${u.hash}` : null;
  } catch {
    return null;
  }
}

/**
 * What makes two citations the same target: path and query. The fragment only scrolls the page, so
 * a model that drops a tool's `#evidence-<id>` still points at the item it was given.
 */
export const citableKey = (href: string) => href.split("#")[0]!;

/**
 * Every in-app href the server handed the model anywhere in this Conversation - tool results, and
 * the Project summary from the system prompt (`CITABLE_PART`) - normalised by `internalHref`.
 * Tools hand the model ready-made `cite` links (and `href` fields), so a citation the model copied
 * correctly is always in this set. A citation that is not - a mis-copied id, an id from another
 * Project, or a path the model wrote itself - is route-shaped but points at nothing the tools
 * vouched for, and the dock renders it as plain text.
 */
export function citableHrefs(messages: UIMessage[]): Set<string> {
  const out = new Set<string>();
  const add = (value: string) => {
    const links = [...value.matchAll(LINK)].map((m) => m[2]!);
    for (const raw of links.length ? links : [value]) {
      const href = internalHref(raw);
      if (href) out.add(citableKey(href));
    }
  };
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    for (const part of m.parts) {
      // Only `cite` and `href` fields count: a route-shaped link inside Evidence text or a Task
      // description was written by a person, not handed out by a tool.
      if (isToolUIPart(part) && part.state === "output-available") citableStrings(part.output).forEach(add);
      else if (part.type === CITABLE_PART && Array.isArray(part.data))
        part.data.forEach((v: unknown) => typeof v === "string" && add(v));
    }
  }
  return out;
}

/** Split Assistant text into plain runs and internal Markdown links; anything else stays literal text. */
export function splitLinks(text: string): TextChunk[] {
  const out: TextChunk[] = [];
  let last = 0;
  for (const m of text.matchAll(LINK)) {
    const [whole, label, raw] = m as unknown as [string, string, string];
    const start = m.index ?? 0;
    const href = internalHref(raw);
    if (!href) continue;
    if (start > last) out.push({ type: "text", text: text.slice(last, start) });
    out.push({ type: "link", label, href });
    last = start + whole.length;
  }
  if (last < text.length) out.push({ type: "text", text: text.slice(last) });
  return out;
}

/** Assistant text with clickable citations (issue #40). Links open in-app dialogs via their query params. */
export function LinkedText({ text }: { text: string }) {
  return (
    <p className="whitespace-pre-wrap">
      {splitLinks(text).map((c, i) =>
        c.type === "text" ? (
          <React.Fragment key={i}>{c.text}</React.Fragment>
        ) : (
          <Link key={i} href={c.href} className="text-primary underline decoration-primary/40 hover:decoration-primary">
            {c.label}
          </Link>
        ),
      )}
    </p>
  );
}
