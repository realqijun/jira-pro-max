/**
 * A ready-made Markdown citation for the model to paste verbatim. Brackets and line breaks in
 * a label would break the `[label](href)` parser in the dock, so they are neutralised.
 *
 * Every tool result that names a Project item carries one of these: the model is never asked to
 * build a path, because no tool result exposes the shape of a Project route.
 */
export const citation = (label: string, href: string) =>
  `[${label.replace(/\[/g, "(").replace(/\]/g, ")").replace(/\s+/g, " ").trim() || "source"}](${href})`;
