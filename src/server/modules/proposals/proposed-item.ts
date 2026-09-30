import type { ItemProposalRow, ProposedItem } from "./schema";

/**
 * An item Proposal with `fields` narrowed by `kind`. The jsonb column cannot tie the two together
 * in the row type, so this is the one place that asserts it; trace writes them as a pair.
 */
export const asProposedItem = (row: Pick<ItemProposalRow, "kind" | "fields">) =>
  ({ kind: row.kind, fields: row.fields }) as ProposedItem;

/** A Task's title or a Milestone's name. */
export const itemTitleOf = (item: ProposedItem) => (item.kind === "task" ? item.fields.title : item.fields.name);
