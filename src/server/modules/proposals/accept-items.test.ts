import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Ctx } from "@/server/core/context";
import { eq } from "drizzle-orm";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/core/errors";
import { activityRepo } from "@/server/modules/activity/service";
import { commentsService } from "@/server/modules/comments/service";
import { evidenceLinksRepo } from "@/server/modules/evidence/repository";
import { evidenceService } from "@/server/modules/evidence/service";
import { peopleService } from "@/server/modules/people/service";
import { statusesService } from "@/server/modules/statuses/service";
import { tasksService } from "@/server/modules/tasks/service";
import { closeDb, makeCtx, makeProject } from "@/test/helpers";
import { heuristicExtract } from "./extract";
import type { ExtractItems } from "./extract-items";
import { itemProposalsRepo } from "./repository";
import { itemProposals } from "./schema";
import { proposalsService } from "./service";

let ctx: Ctx;
beforeAll(async () => {
  ctx = await makeCtx();
});
afterAll(closeDb);

const LAB = "Action item: Book the usability lab by 2026-10-10";
const READOUT = "Milestone: Pilot readout on 2026-10-20.";

/** A Project with one Evidence item naming a Task and a Milestone, passed once. */
async function setup(key: string, body = `${LAB}\n${READOUT}`) {
  const pid = (await makeProject(ctx, key)).id;
  const ev = await evidenceService.create(ctx, { projectId: pid, title: "Kickoff notes", kind: "minutes", body });
  await proposalsService.runPass(ctx, pid, { extract: heuristicExtract, trigger: "manual" });
  const pending = await proposalsService.listPendingItems(ctx, pid);
  return {
    pid,
    ev,
    task: pending.find((p) => p.kind === "task")!,
    milestone: pending.find((p) => p.kind === "milestone")!,
  };
}

const assistantEvents = async (entityId: string) =>
  (await activityRepo.forEntity(ctx.db, entityId)).map((e) => [e.event.action, e.event.field, e.event.via]);

describe("proposalsService.acceptItem (#115)", () => {
  it("creates the Task with the default Status, links the cited Evidence and marks the Proposal, via the Assistant", async () => {
    const { pid, ev, task } = await setup("IAT");
    expect(task.acceptInput).toMatchObject({ kind: "task", input: { title: "Book the usability lab" } });

    const created = await proposalsService.acceptItem(ctx, { id: task.id });
    expect(created).toMatchObject({ kind: "task" });
    const [row] = (await tasksService.list(ctx, pid)).filter((t) => t.task.id === created.item.id);
    const defaultStatus = await statusesService.resolveForNewItem(ctx.db, pid, "task", undefined);
    expect(row).toMatchObject({ task: { title: "Book the usability lab", dueDate: "2026-10-10" } });
    expect(row!.task.statusId).toBe(defaultStatus.id);
    expect(
      (await evidenceLinksRepo.listForEntity(ctx.db, pid, "task", created.item.id)).map((l) => l.evidenceId),
    ).toEqual([ev.id]);
    expect(await assistantEvents(created.item.id)).toEqual(
      expect.arrayContaining([
        ["created", null, "assistant"],
        ["updated", "evidence", "assistant"],
      ]),
    );
    expect(await itemProposalsRepo.findById(ctx.db, task.id)).toMatchObject({
      status: "accepted",
      itemId: created.item.id,
    });
    await expect(proposalsService.acceptItem(ctx, { id: task.id })).rejects.toBeInstanceOf(ConflictError);
    await expect(proposalsService.rejectItem(ctx, task.id)).rejects.toBeInstanceOf(ConflictError);
  });

  it("creates the Milestone and links it the same way", async () => {
    const { pid, ev, milestone } = await setup("IAM");
    const created = await proposalsService.acceptItem(ctx, { id: milestone.id });
    expect(created).toMatchObject({ kind: "milestone", item: { name: "Pilot readout", dueDate: "2026-10-20" } });
    expect(
      (await evidenceLinksRepo.listForEntity(ctx.db, pid, "milestone", created.item.id)).map((l) => l.evidenceId),
    ).toEqual([ev.id]);
    expect(await assistantEvents(created.item.id)).toContainEqual(["created", null, "assistant"]);
  });

  it("links a Task to a Milestone Proposal accepted before it, by name", async () => {
    const pid = (await makeProject(ctx, "IDF")).id;
    const ev = await evidenceService.create(ctx, { projectId: pid, title: "Plan", kind: "minutes", body: READOUT });
    const extractItems: ExtractItems = async () => ({
      tasks: [
        {
          title: "Prepare the readout deck",
          description: null,
          assigneeName: null,
          milestoneName: "Pilot readout",
          startDate: null,
          dueDate: null,
          sources: [{ kind: "evidence", entityId: ev.id, excerpt: READOUT }],
        },
      ],
      milestones: [
        {
          name: "Pilot readout",
          description: null,
          dueDate: "2026-10-20",
          ownerName: null,
          sources: [{ kind: "evidence", entityId: ev.id, excerpt: READOUT }],
        },
      ],
    });
    await proposalsService.runPass(ctx, pid, { extract: heuristicExtract, extractItems, trigger: "manual" });
    const pending = await proposalsService.listPendingItems(ctx, pid);
    const task = pending.find((p) => p.kind === "task")!;
    expect(task.fields).toMatchObject({ milestoneId: null, milestoneName: "Pilot readout" });

    const m = await proposalsService.acceptItem(ctx, { id: pending.find((p) => p.kind === "milestone")!.id });
    const t = await proposalsService.acceptItem(ctx, { id: task.id });
    expect(t.item).toMatchObject({ milestoneId: m.item.id });
  });

  it("leaves the Milestone empty when the name still matches nothing", async () => {
    const pid = (await makeProject(ctx, "IDN")).id;
    const ev = await evidenceService.create(ctx, { projectId: pid, title: "Plan", kind: "minutes", body: LAB });
    const extractItems: ExtractItems = async () => ({
      tasks: [
        {
          title: "Book the usability lab",
          description: null,
          assigneeName: null,
          milestoneName: "Launch",
          startDate: null,
          dueDate: null,
          sources: [{ kind: "evidence", entityId: ev.id, excerpt: LAB }],
        },
      ],
      milestones: [],
    });
    await proposalsService.runPass(ctx, pid, { extract: heuristicExtract, extractItems, trigger: "manual" });
    const [task] = await proposalsService.listPendingItems(ctx, pid);
    expect((await proposalsService.acceptItem(ctx, { id: task!.id })).item).toMatchObject({ milestoneId: null });
  });

  it("two accepts in parallel create one Task", async () => {
    const { pid, task } = await setup("IPA");
    const results = await Promise.allSettled([
      proposalsService.acceptItem(ctx, { id: task.id }),
      proposalsService.acceptItem(ctx, { id: task.id }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason).toBeInstanceOf(
      ConflictError,
    );
    const tasks = await tasksService.list(ctx, pid);
    expect(tasks).toHaveLength(1);
    expect(await evidenceLinksRepo.listForProject(ctx.db, pid)).toHaveLength(1);
  });

  it("a Proposal rejected before the accept commits rolls the Task and its links back", async () => {
    const { pid, task } = await setup("IRB");
    const original = itemProposalsRepo.markAccepted;
    const spy = vi.spyOn(itemProposalsRepo, "markAccepted").mockImplementation(async (db, id, itemId) => {
      await itemProposalsRepo.markRejected(ctx.db, id);
      return original(db, id, itemId);
    });
    await expect(proposalsService.acceptItem(ctx, { id: task.id })).rejects.toBeInstanceOf(ConflictError);
    spy.mockRestore();
    expect(await tasksService.list(ctx, pid)).toHaveLength(0);
    expect(await evidenceLinksRepo.listForProject(ctx.db, pid)).toHaveLength(0);
  });

  it("accepts what the PM edited, and refuses an input aimed at another Project", async () => {
    const { pid, task } = await setup("IED");
    const priya = await peopleService.createPerson(ctx, { projectId: pid, name: "Priya Nair" });
    const other = (await makeProject(ctx, "IEO")).id;
    const base = task.acceptInput!.input as { title: string };
    await expect(
      proposalsService.acceptItem(ctx, {
        id: task.id,
        input: { kind: "task", input: { ...base, projectId: other, priority: "none" } },
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    const created = await proposalsService.acceptItem(ctx, {
      id: task.id,
      input: {
        kind: "task",
        input: { ...base, projectId: pid, title: "Book lab B", assigneeId: priya.id, priority: "none" },
      },
    });
    expect(created.item).toMatchObject({ title: "Book lab B", assigneeId: priya.id });
    expect(await tasksService.list(ctx, other)).toHaveLength(0);
  });

  it("lists a payload the create schema refuses, refuses it on one click and accepts it once edited", async () => {
    const { pid, task } = await setup("IBD");
    await ctx.db
      .update(itemProposals)
      .set({ fields: { ...task.fields, title: "   " } })
      .where(eq(itemProposals.id, task.id));
    const [broken] = (await proposalsService.listPendingItems(ctx, pid)).filter((p) => p.id === task.id);
    expect(broken!.acceptInput).toBeNull();
    // The dialog still prefills everything else the Proposal had.
    expect(broken!.draftInput).toMatchObject({ kind: "task", input: { title: "   ", dueDate: "2026-10-10" } });
    await expect(proposalsService.acceptItem(ctx, { id: task.id })).rejects.toBeInstanceOf(ValidationError);
    const created = await proposalsService.acceptItem(ctx, {
      id: task.id,
      input: { kind: "task", input: { projectId: pid, title: "Book the lab", priority: "none" } },
    });
    expect(created.item).toMatchObject({ title: "Book the lab" });
  });

  it("refuses an edited input of the other kind", async () => {
    const { pid, milestone } = await setup("IKD");
    await expect(
      proposalsService.acceptItem(ctx, {
        id: milestone.id,
        input: { kind: "task", input: { projectId: pid, title: "Not a milestone", priority: "none" } },
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("links only Evidence that still exists, and never a Comment", async () => {
    const pid = (await makeProject(ctx, "IEV")).id;
    const kept = await evidenceService.create(ctx, { projectId: pid, title: "Kept", kind: "minutes", body: LAB });
    const gone = await evidenceService.create(ctx, { projectId: pid, title: "Gone", kind: "minutes", body: LAB });
    const host = await tasksService.create(ctx, { projectId: pid, title: "Host", priority: "none" });
    const comment = await commentsService.create(ctx, {
      projectId: pid,
      entityType: "task",
      entityId: host.id,
      body: LAB,
    });
    const extractItems: ExtractItems = async () => ({
      tasks: [
        {
          title: "Book the usability lab",
          description: null,
          assigneeName: null,
          milestoneName: null,
          startDate: null,
          dueDate: null,
          sources: [
            { kind: "evidence", entityId: kept.id, excerpt: LAB },
            { kind: "evidence", entityId: gone.id, excerpt: LAB },
            { kind: "comment", entityId: comment.id, excerpt: LAB },
            { kind: "evidence", entityId: kept.id, excerpt: LAB },
          ],
        },
      ],
      milestones: [],
    });
    await proposalsService.runPass(ctx, pid, { extract: heuristicExtract, extractItems, trigger: "manual" });
    const [task] = await proposalsService.listPendingItems(ctx, pid);
    await evidenceService.delete(ctx, gone.id);
    const created = await proposalsService.acceptItem(ctx, { id: task!.id });
    expect(
      (await evidenceLinksRepo.listForEntity(ctx.db, pid, "task", created.item.id)).map((l) => l.evidenceId),
    ).toEqual([kept.id]);
  });

  it("a rejected item stays rejected and is not raised again when its Evidence is read again", async () => {
    const { pid, ev, task } = await setup("IRR");
    await proposalsService.rejectItem(ctx, task.id);
    await evidenceService.update(ctx, { id: ev.id, body: `${LAB}\n${READOUT}\nLunch was late.` });
    const out = await proposalsService.runPass(ctx, pid, { extract: heuristicExtract, trigger: "manual" });
    expect(out.items).toMatchObject({ tasks: 0, milestones: 0 });
    expect(await itemProposalsRepo.findById(ctx.db, task.id)).toMatchObject({ status: "rejected" });
    expect((await proposalsService.listPendingItems(ctx, pid)).map((p) => p.kind)).toEqual(["milestone"]);
  });

  it("refuses a stranger", async () => {
    const { task } = await setup("IAS");
    const stranger = await makeCtx();
    await expect(proposalsService.acceptItem(stranger, { id: task.id })).rejects.toBeInstanceOf(ForbiddenError);
  });
});
