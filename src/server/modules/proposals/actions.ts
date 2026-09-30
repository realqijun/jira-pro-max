"use server";

import { z } from "zod";
import { runAction } from "@/server/core/action";
import { revalidateProject } from "@/server/core/revalidate";
import { createMilestoneSchema } from "@/server/modules/milestones/validation";
import { createTaskSchema } from "@/server/modules/tasks/validation";
import { proposalsService } from "./service";

const byProject = z.object({ projectId: z.string() });
const byId = z.object({ id: z.string() });

// The pass, the accept and the reject record themselves (issue #74): an automatic pass never
// reaches an action, and only the transitions know what they really created or changed.
export async function runProposalPassAction(input: z.input<typeof byProject>) {
  const res = await runAction(byProject, input, (ctx, { projectId }) =>
    proposalsService.runPass(ctx, projectId, { trigger: "manual" }),
  );
  if (res.ok) revalidateProject(input.projectId);
  return res;
}
export async function acceptProposalAction(input: z.input<typeof byId>) {
  const res = await runAction(byId, input, (ctx, { id }) => proposalsService.accept(ctx, { id }));
  if (res.ok) revalidateProject(res.data.projectId);
  return res;
}
export async function rejectProposalAction(input: z.input<typeof byId>) {
  const res = await runAction(byId, input, (ctx, { id }) => proposalsService.reject(ctx, id));
  if (res.ok) revalidateProject(res.data.projectId);
  return res;
}

// Item Proposals (#115). One click accepts the Proposal as it stands; the dialogs post the
// Task or Milestone form, validated by the same schema a plain create uses.
const acceptTaskSchema = createTaskSchema.extend({ proposalId: z.string() });
const acceptMilestoneSchema = createMilestoneSchema.extend({ proposalId: z.string() });

export async function acceptItemProposalAction(input: z.input<typeof byId>) {
  const res = await runAction(byId, input, (ctx, { id }) => proposalsService.acceptItem(ctx, { id }));
  if (res.ok) revalidateProject(res.data.item.projectId);
  return res;
}
export async function acceptTaskProposalAction(fd: FormData) {
  const res = await runAction(acceptTaskSchema, fd, (ctx, { proposalId, ...input }) =>
    proposalsService.acceptItem(ctx, { id: proposalId, input: { kind: "task", input } }),
  );
  if (res.ok) revalidateProject(res.data.item.projectId);
  return res;
}
export async function acceptMilestoneProposalAction(fd: FormData) {
  const res = await runAction(acceptMilestoneSchema, fd, (ctx, { proposalId, ...input }) =>
    proposalsService.acceptItem(ctx, { id: proposalId, input: { kind: "milestone", input } }),
  );
  if (res.ok) revalidateProject(res.data.item.projectId);
  return res;
}
export async function rejectItemProposalAction(input: z.input<typeof byId>) {
  const res = await runAction(byId, input, (ctx, { id }) => proposalsService.rejectItem(ctx, id));
  if (res.ok) revalidateProject(res.data.projectId);
  return res;
}
