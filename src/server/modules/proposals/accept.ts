import { z } from "zod";
import { ValidationError } from "@/server/core/errors";
import { createMilestoneSchema, type CreateMilestoneInput } from "@/server/modules/milestones/validation";
import { createTaskSchema, type CreateTaskInput } from "@/server/modules/tasks/validation";
import { asProposedItem } from "./proposed-item";
import type { ItemProposalRow } from "./schema";
import { byName, startOnOrBeforeDue, type TraceRefs } from "./trace";

/** The Project's current People and Milestones, against which a Proposal's names and ids are re-checked. */
export type AcceptRefs = Pick<TraceRefs, "people" | "milestones">;

export type ItemAcceptInput =
  { kind: "task"; input: CreateTaskInput } | { kind: "milestone"; input: CreateMilestoneInput };

/** The id when it still exists in the Project, else whatever the name resolves to now, else null. */
const currentId = (rows: Array<{ id: string; name: string }>, id: string | null, name: string | null) =>
  (id && rows.some((r) => r.id === id) ? id : byName(rows, name, (r) => r.name)?.id) ?? null;

function parsed<S extends z.ZodType>(schema: S, value: z.input<S>): z.infer<S> {
  const res = schema.safeParse(value);
  if (res.success) return res.data;
  throw new ValidationError(
    "That proposal cannot be accepted as it stands; edit it first",
    z.flattenError(res.error).fieldErrors as Record<string, string[]>,
  );
}

/**
 * The create input a Proposal stands for, with names and ids resolved against the Project as it
 * is now but not yet validated: what the review dialog prefills, even for a payload the create
 * schema would refuse, so the PM fixes one field rather than re-entering the rest.
 */
export function draftInputOf(
  projectId: string,
  item: Pick<ItemProposalRow, "kind" | "fields">,
  refs: AcceptRefs,
): ItemAcceptInput {
  const proposed = asProposedItem(item);
  if (proposed.kind === "milestone") {
    const f = proposed.fields;
    return {
      kind: "milestone",
      input: {
        projectId,
        name: f.name,
        description: f.description,
        dueDate: f.dueDate,
        ownerId: currentId(refs.people, f.ownerId, f.ownerName),
      },
    };
  }
  const f = proposed.fields;
  return {
    kind: "task",
    input: {
      projectId,
      title: f.title,
      description: f.description,
      priority: "none",
      assigneeId: currentId(refs.people, f.assigneeId, f.assigneeName),
      milestoneId: currentId(refs.milestones, f.milestoneId, f.milestoneName),
      startDate: startOnOrBeforeDue(f.startDate, f.dueDate),
      dueDate: f.dueDate,
    },
  };
}

/**
 * The exact create input a one-click accept submits (issue #115). Ids resolved at pass time are
 * re-checked, so a Person or Milestone deleted since is dropped, and a name that was unresolved
 * then (a Milestone that was itself still a Proposal) is resolved again now. Re-validated by the
 * create schema: the stored payload is never trusted.
 */
export function acceptInputOf(
  projectId: string,
  item: Pick<ItemProposalRow, "kind" | "fields">,
  refs: AcceptRefs,
): ItemAcceptInput {
  const draft = draftInputOf(projectId, item, refs);
  return draft.kind === "milestone"
    ? { kind: "milestone", input: parsed(createMilestoneSchema, draft.input) }
    : { kind: "task", input: parsed(createTaskSchema, draft.input) };
}
