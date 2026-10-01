import { z } from "zod";

/**
 * A ready-made Markdown citation for the model to paste verbatim. Brackets and line breaks in
 * a label would break the `[label](href)` parser in the dock, so they are neutralised.
 *
 * Every tool result that names a Project item carries one of these: the model is never asked to
 * build a path, because no tool result exposes the shape of a Project route.
 */
export const citation = (label: string, href: string) =>
  `[${label.replace(/\[/g, "(").replace(/\]/g, ")").replace(/\s+/g, " ").trim() || "source"}](${href})`;

/**
 * A reply part carrying the citable hrefs the model was shown outside a tool call: the Project
 * summary in the system prompt carries a `cite` for every Evidence item, and the dock only links
 * hrefs something on the server handed the model (`citableHrefs` in the Assistant widget).
 */
export const CITABLE = "citable" as const;
export const CITABLE_PART = `data-${CITABLE}` as const;

/**
 * The client resends the whole thread each turn and the chat route validates every data part in
 * it, so the citable part needs a schema or every follow-up message is rejected.
 */
export const citableDataSchemas = { [CITABLE]: z.array(z.string().max(2_000)).max(5_000) };

/** Every `cite` or `href` string inside a tool result or summary, in document order. */
export function citableStrings(value: unknown): string[] {
  if (typeof value === "string") return value.includes("/projects/") ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(citableStrings);
  if (value && typeof value === "object")
    return Object.entries(value).flatMap(([k, v]) =>
      typeof v === "string" ? (k === "cite" || k === "href" ? citableStrings(v) : []) : citableStrings(v),
    );
  return [];
}
