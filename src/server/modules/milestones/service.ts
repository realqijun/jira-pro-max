import type { Ctx } from "@/server/core/context";
import { compactPatch, diffFields } from "@/server/core/diff";
import { NotFoundError } from "@/server/core/errors";
import { mutate, type AfterCreate } from "@/server/core/mutation";
import type { DbOrTx } from "@/server/db/client";
import { commentsRepo } from "@/server/modules/comments/repository";
import { dependenciesRepo } from "@/server/modules/dependencies/repository";
import { evidenceLinksRepo } from "@/server/modules/evidence/repository";
import { assertPersonInProject } from "@/server/modules/people/service";
import { assertOwnsProject } from "@/server/modules/projects/service";
import { statusesService } from "@/server/modules/statuses/service";
import { milestonesRepo } from "./repository";
import type { MilestoneRow } from "./schema";
import type { CreateMilestoneInput, UpdateMilestoneInput } from "./validation";

async function getOwned(db: DbOrTx, userId: string, id: string): Promise<MilestoneRow> {
  const m = await milestonesRepo.findById(db, id);
  if (!m) throw new NotFoundError("Milestone");
  await assertOwnsProject(db, userId, m.projectId);
  return m;
}

export const milestonesService = {
  list: async (ctx: Ctx, projectId: string) => {
    await assertOwnsProject(ctx.db, ctx.userId, projectId);
    return milestonesRepo.listByProject(ctx.db, projectId);
  },

  get: (ctx: Ctx, id: string) => getOwned(ctx.db, ctx.userId, id),

  /** `afterCreate` runs inside the create's transaction, as for `tasksService.create`. */
  create: (ctx: Ctx, input: CreateMilestoneInput, afterCreate?: AfterCreate<MilestoneRow>) =>
    mutate(ctx, async (tx, rec) => {
      await assertOwnsProject(tx, ctx.userId, input.projectId);
      await assertPersonInProject(tx, input.projectId, input.ownerId);
      const status = await statusesService.resolveForNewItem(tx, input.projectId, "milestone", input.statusId);
      const milestone = await milestonesRepo.insert(tx, { ...input, statusId: status.id });
      rec.created("milestone", input.projectId, milestone.id, milestone.name);
      await afterCreate?.(tx, rec, milestone);
      return milestone;
    }),

  update: (ctx: Ctx, { id, ...patch }: UpdateMilestoneInput) =>
    mutate(ctx, async (tx, rec) => {
      const before = await getOwned(tx, ctx.userId, id);
      const clean = compactPatch(patch);
      await assertPersonInProject(tx, before.projectId, clean.ownerId);
      let reachedAt = before.reachedAt;
      if (clean.statusId && clean.statusId !== before.statusId) {
        const status = await statusesService.assertValidTarget(tx, before.projectId, "milestone", clean.statusId);
        reachedAt = status.category === "reached" ? new Date() : null;
      }
      const changes = diffFields(before, clean);
      if (!changes.length) return before;
      const after = await milestonesRepo.update(tx, id, { ...clean, reachedAt });
      rec.updated("milestone", before.projectId, id, after.name, changes);
      return after;
    }),

  delete: (ctx: Ctx, id: string) =>
    mutate(ctx, async (tx, rec) => {
      const m = await getOwned(tx, ctx.userId, id);
      await dependenciesRepo.deleteForItem(tx, id);
      await commentsRepo.deleteForEntity(tx, "milestone", id);
      await evidenceLinksRepo.deleteForEntity(tx, "milestone", id);
      await milestonesRepo.delete(tx, id);
      rec.deleted("milestone", m.projectId, id, m.name);
    }),
};
