import type { Ctx } from "@/server/core/context";
import { compactPatch, diffFields, type FieldChange } from "@/server/core/diff";
import { NotFoundError, ValidationError } from "@/server/core/errors";
import { mutate, type AfterCreate } from "@/server/core/mutation";
import { nextNumber } from "@/server/core/sequence";
import type { DbOrTx } from "@/server/db/client";
import { commentsRepo } from "@/server/modules/comments/repository";
import { dependenciesRepo } from "@/server/modules/dependencies/repository";
import { evidenceLinksRepo } from "@/server/modules/evidence/repository";
import { assertLabelsInProject } from "@/server/modules/labels/service";
import { milestonesRepo } from "@/server/modules/milestones/repository";
import { assertPersonInProject, assertTeamInProject } from "@/server/modules/people/service";
import { assertOwnsProject, projectsService } from "@/server/modules/projects/service";
import { statusesService } from "@/server/modules/statuses/service";
import { tasksRepo } from "./repository";
import { tasks, type TaskRow } from "./schema";
import type { CreateTaskInput, UpdateTaskInput } from "./validation";

async function getOwned(db: DbOrTx, userId: string, id: string): Promise<TaskRow> {
  const t = await tasksRepo.findById(db, id);
  if (!t) throw new NotFoundError("Task");
  await assertOwnsProject(db, userId, t.projectId);
  return t;
}

async function assertMilestoneInProject(db: DbOrTx, projectId: string, milestoneId?: string | null) {
  if (!milestoneId) return;
  const m = await milestonesRepo.findById(db, milestoneId);
  if (!m || m.projectId !== projectId) throw new ValidationError("Invalid milestone", { milestoneId: ["Invalid"] });
}

function assertDateOrder(start?: string | null, due?: string | null) {
  if (start && due && start > due) {
    throw new ValidationError("Start date must be on or before the due date", { dueDate: ["Before start date"] });
  }
}

export const tasksService = {
  list: async (ctx: Ctx, projectId: string) => {
    await assertOwnsProject(ctx.db, ctx.userId, projectId);
    return tasksRepo.listByProject(ctx.db, projectId);
  },

  get: async (ctx: Ctx, id: string) => {
    await getOwned(ctx.db, ctx.userId, id);
    return tasksRepo.findDetailed(ctx.db, id);
  },

  countsByStatusCategory: async (ctx: Ctx, projectId: string) => {
    await assertOwnsProject(ctx.db, ctx.userId, projectId);
    return tasksRepo.countsByStatusCategory(ctx.db, projectId);
  },

  /** Counts for projects the user owns; unknown or foreign ids are silently dropped. */
  countsByStatusCategoryForOwnedProjects: async (ctx: Ctx) => {
    const owned = await projectsService.list(ctx);
    return tasksRepo.countsByStatusCategoryForProjects(
      ctx.db,
      owned.map((p) => p.id),
    );
  },

  /**
   * `afterCreate` runs inside the same transaction, after the Activity Event is recorded, so a
   * caller that confirms something else with the create (an item Proposal, #115) commits or rolls
   * back with it and publishes once.
   */
  create: (ctx: Ctx, { labelIds = [], ...input }: CreateTaskInput, afterCreate?: AfterCreate<TaskRow>) =>
    mutate(ctx, async (tx, rec) => {
      await assertOwnsProject(tx, ctx.userId, input.projectId);
      await Promise.all([
        assertPersonInProject(tx, input.projectId, input.assigneeId),
        assertTeamInProject(tx, input.projectId, input.teamId),
        assertMilestoneInProject(tx, input.projectId, input.milestoneId),
        assertLabelsInProject(tx, input.projectId, labelIds),
      ]);
      assertDateOrder(input.startDate, input.dueDate);
      const status = await statusesService.resolveForNewItem(tx, input.projectId, "task", input.statusId);
      const number = await nextNumber(tx, input.projectId, tasks, tasks.number, tasks.projectId);
      const task = await tasksRepo.insert(tx, {
        ...input,
        statusId: status.id,
        number,
        completedAt: status.category === "done" ? new Date() : null,
      });
      await tasksRepo.setLabels(tx, task.id, labelIds);
      rec.created("task", input.projectId, task.id, task.title);
      await afterCreate?.(tx, rec, task);
      return task;
    }),

  update: (ctx: Ctx, { id, labelIds, ...patch }: UpdateTaskInput) =>
    mutate(ctx, async (tx, rec) => {
      const before = await getOwned(tx, ctx.userId, id);
      const clean = compactPatch(patch);
      await Promise.all([
        assertPersonInProject(tx, before.projectId, clean.assigneeId),
        assertTeamInProject(tx, before.projectId, clean.teamId),
        assertMilestoneInProject(tx, before.projectId, clean.milestoneId),
        labelIds ? assertLabelsInProject(tx, before.projectId, labelIds) : undefined,
      ]);
      assertDateOrder(
        "startDate" in clean ? clean.startDate : before.startDate,
        "dueDate" in clean ? clean.dueDate : before.dueDate,
      );

      let completedAt = before.completedAt;
      if (clean.statusId && clean.statusId !== before.statusId) {
        const status = await statusesService.assertValidTarget(tx, before.projectId, "task", clean.statusId);
        completedAt = status.category === "done" ? new Date() : null;
      }

      const changes: FieldChange[] = diffFields(before, clean);
      if (labelIds) {
        const oldLabels = (await tasksRepo.labelIds(tx, id)).sort();
        const newLabels = [...labelIds].sort();
        if (JSON.stringify(oldLabels) !== JSON.stringify(newLabels)) {
          await tasksRepo.setLabels(tx, id, labelIds);
          changes.push({ field: "labelIds", oldValue: oldLabels, newValue: newLabels });
        }
      }
      if (!changes.length) return before;
      const after = await tasksRepo.update(tx, id, { ...clean, completedAt });
      rec.updated("task", before.projectId, id, after.title, changes);
      return after;
    }),

  /** Board drag: move to a status and position within the column. */
  move: (ctx: Ctx, id: string, statusId: string, sortOrder: number) =>
    mutate(ctx, async (tx, rec) => {
      const before = await getOwned(tx, ctx.userId, id);
      const status = await statusesService.assertValidTarget(tx, before.projectId, "task", statusId);
      const changes = diffFields(before, { statusId, sortOrder });
      if (!changes.length) return before;
      const after = await tasksRepo.update(tx, id, {
        statusId,
        sortOrder,
        completedAt: status.category === "done" ? (before.completedAt ?? new Date()) : null,
      });
      rec.updated(
        "task",
        before.projectId,
        id,
        after.title,
        changes.filter((c) => c.field !== "sortOrder"),
      );
      return after;
    }),

  delete: (ctx: Ctx, id: string) =>
    mutate(ctx, async (tx, rec) => {
      const t = await getOwned(tx, ctx.userId, id);
      await dependenciesRepo.deleteForItem(tx, id);
      await commentsRepo.deleteForEntity(tx, "task", id);
      await evidenceLinksRepo.deleteForEntity(tx, "task", id);
      await tasksRepo.delete(tx, id);
      rec.deleted("task", t.projectId, id, t.title);
    }),
};
