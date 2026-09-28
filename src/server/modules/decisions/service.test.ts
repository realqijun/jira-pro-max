import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Ctx } from "@/server/core/context";
import { ConflictError, ForbiddenError, ValidationError } from "@/server/core/errors";
import { eventBus, type DomainEvent } from "@/server/events/bus";
import { activityRepo } from "@/server/modules/activity/service";
import { commentsService } from "@/server/modules/comments/service";
import { dependenciesService } from "@/server/modules/dependencies/service";
import type { EvidenceRow } from "@/server/modules/evidence/schema";
import { evidenceService } from "@/server/modules/evidence/service";
import type { MilestoneRow } from "@/server/modules/milestones/schema";
import { milestonesService } from "@/server/modules/milestones/service";
import type { PersonRow } from "@/server/modules/people/schema";
import { peopleService } from "@/server/modules/people/service";
import type { TaskRow } from "@/server/modules/tasks/schema";
import { tasksService } from "@/server/modules/tasks/service";
import { closeDb, makeCtx, makeProject } from "@/test/helpers";
import { assumptionsRepo, edgesRepo, sourcesRepo } from "./repository";
import { firstLine } from "@/shared/lib/text";
import { decisionsService } from "./service";
import type { CreateAssumptionInput, CreateDecisionInput } from "./validation";

let ctx: Ctx;
let projectId: string;
let priya: PersonRow;
let task: TaskRow;
let milestone: MilestoneRow;
let minutes: EvidenceRow;
let commentId: string;

const captured: DomainEvent[] = [];

beforeAll(async () => {
  ctx = await makeCtx();
  projectId = (await makeProject(ctx, "DEC")).id;
  priya = await peopleService.createPerson(ctx, { projectId, name: "Priya Nair" });
  task = await tasksService.create(ctx, {
    projectId,
    title: "Recruit interviewees",
    priority: "none",
    dueDate: "2026-11-01",
  });
  milestone = await milestonesService.create(ctx, { projectId, name: "UAT begins", dueDate: "2026-12-01" });
  minutes = await evidenceService.create(ctx, {
    projectId,
    title: "Kickoff minutes",
    kind: "minutes",
    body: "We agreed to switch from surveys to interviews.\nSecond line.",
  });
  const c = await commentsService.create(ctx, {
    projectId,
    entityType: "task",
    entityId: task.id,
    body: "Priya said the survey response rate was 4%.",
    saidById: priya.id,
  });
  commentId = c.id;
  eventBus.subscribe("*", async (e) => {
    captured.push(e);
  });
});
afterAll(closeDb);

const evidenceSource = () => [{ kind: "evidence" as const, entityId: minutes.id }];

const mk = (over: Partial<CreateDecisionInput> = {}) =>
  decisionsService.create(ctx, {
    projectId,
    title: "Switch from surveys to interviews",
    decidedOn: "2026-09-10",
    chosen: "Semi-structured interviews with 12 participants",
    sources: evidenceSource(),
    ...over,
  });

const mkAssumption = (decisionId: string, over: Partial<CreateAssumptionInput> = {}) =>
  decisionsService.createAssumption(ctx, {
    projectId,
    decisionId,
    statement: "Dataset arrives before UAT",
    subtype: "date",
    targetType: "milestone",
    targetId: milestone.id,
    targetField: "dueDate",
    assumedUntil: "2026-11-15",
    ...over,
  } as CreateAssumptionInput);

describe("firstLine", () => {
  it("takes the first non-empty line and truncates by code point", () => {
    expect(firstLine("\n\n  hello \nworld", 10)).toBe("hello");
    const long = "🚀".repeat(20);
    expect(Array.from(firstLine(long, 5))).toHaveLength(5);
    expect(firstLine("", 5)).toBe("");
  });
});

describe("decisionsService.create", () => {
  it("creates with one Evidence Source, numbers per Project and emits decision.created", async () => {
    captured.length = 0;
    const d1 = await mk();
    const d2 = await mk({ title: "Second" });
    expect(d1.number).toBe(1);
    expect(d2.number).toBe(2);
    expect(d1.status).toBe("active");
    const sources = await sourcesRepo.listForDecisions(ctx.db, [d1.id]);
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ kind: "evidence", entityId: minutes.id, label: "Kickoff minutes" });
    expect(sources[0]!.excerpt).toBe("We agreed to switch from surveys to interviews.");
    expect(captured.some((e) => e.name === "decision.created" && e.entityId === d1.id)).toBe(true);
    const events = await activityRepo.forEntity(ctx.db, d1.id);
    expect(events.map((e) => e.event.action)).toContain("created");
  });

  it("rejects a Decision with no Source and one whose Source is in another Project", async () => {
    await expect(mk({ sources: [] })).rejects.toBeInstanceOf(ValidationError);
    const other = await makeCtx();
    const otherProject = await makeProject(other, "OTH");
    const foreign = await evidenceService.create(other, {
      projectId: otherProject.id,
      title: "Foreign",
      kind: "other",
      body: "x",
    });
    await expect(mk({ sources: [{ kind: "evidence", entityId: foreign.id }] })).rejects.toBeInstanceOf(ValidationError);
    await expect(mk({ sources: [{ kind: "comment", entityId: "nope" }] })).rejects.toBeInstanceOf(ValidationError);
  });

  it("snapshots label and excerpt from a Comment and an Activity Event Source", async () => {
    const [taskEvent] = await activityRepo.forEntity(ctx.db, task.id);
    const d = await mk({
      sources: [
        { kind: "comment", entityId: commentId },
        { kind: "activity_event", entityId: taskEvent!.event.id },
      ],
    });
    const sources = await sourcesRepo.listForDecisions(ctx.db, [d.id]);
    expect(sources.map((s) => s.kind).sort()).toEqual(["activity_event", "comment"]);
    const c = sources.find((s) => s.kind === "comment")!;
    expect(c.label).toBe("Priya Nair: Priya said the survey response rate was 4%.");
    expect(c.excerpt).toBe("Priya said the survey response rate was 4%.");
    const a = sources.find((s) => s.kind === "activity_event")!;
    expect(a.label).toContain("Recruit interviewees");
  });

  it("rejects a Source that is a decision Activity Event", async () => {
    const d = await mk();
    const [ev] = await activityRepo.forEntity(ctx.db, d.id);
    await expect(mk({ sources: [{ kind: "activity_event", entityId: ev!.event.id }] })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("rejects an owner from another Project", async () => {
    const other = await makeCtx();
    const otherProject = await makeProject(other, "OWN");
    const stranger = await peopleService.createPerson(other, { projectId: otherProject.id, name: "X" });
    await expect(mk({ ownerId: stranger.id })).rejects.toBeInstanceOf(ValidationError);
    const ok = await mk({ ownerId: priya.id });
    expect(ok.ownerId).toBe(priya.id);
  });
});

describe("decisionsService.update", () => {
  it("records only real changes and can replace Sources", async () => {
    const d = await mk();
    captured.length = 0;
    const same = await decisionsService.update(ctx, { id: d.id, title: d.title, sources: evidenceSource() });
    expect(same.updatedAt.getTime()).toBe(d.updatedAt.getTime());
    expect(captured.filter((e) => e.entityId === d.id)).toHaveLength(0);

    await decisionsService.update(ctx, {
      id: d.id,
      chosen: "Interviews with 20 participants",
      sources: [{ kind: "comment", entityId: commentId }],
    });
    const ev = captured.find((e) => e.entityId === d.id && e.action === "updated");
    expect(ev?.changes.map((c) => c.field).sort()).toEqual(["chosen", "sources"]);
    const sources = await sourcesRepo.listForDecisions(ctx.db, [d.id]);
    expect(sources.map((s) => s.kind)).toEqual(["comment"]);
  });

  it("refuses an empty Source list on update", async () => {
    const d = await mk();
    await expect(decisionsService.update(ctx, { id: d.id, sources: [] })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("assumptions", () => {
  it("enforces the subtype matrix", async () => {
    const d = await mk();
    await expect(mkAssumption(d.id, { assumedUntil: null })).rejects.toBeInstanceOf(ValidationError);
    await expect(mkAssumption(d.id, { targetId: null })).rejects.toBeInstanceOf(ValidationError);
    await expect(mkAssumption(d.id, { targetField: "startDate" })).rejects.toBeInstanceOf(ValidationError);
    await expect(
      mkAssumption(d.id, { subtype: "external_rule", targetType: "person", targetId: priya.id }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(mkAssumption(d.id, { subtype: "person", targetType: null, targetId: null })).rejects.toBeInstanceOf(
      ValidationError,
    );
    const other = await makeCtx();
    const otherProject = await makeProject(other, "PPL");
    const stranger = await peopleService.createPerson(other, { projectId: otherProject.id, name: "X" });
    await expect(
      mkAssumption(d.id, { subtype: "person", targetType: "person", targetId: stranger.id, targetField: null }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      mkAssumption(d.id, { targetType: "task", targetId: milestone.id, targetField: "dueDate" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      mkAssumption(d.id, { subtype: "person", targetType: "person", targetId: priya.id, targetField: "dueDate" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("creates a date Assumption, attaches it with copied Sources and records both events", async () => {
    const d = await mk();
    captured.length = 0;
    const a = await mkAssumption(d.id);
    expect(a).toMatchObject({ subtype: "date", state: "holding", targetType: "milestone", targetField: "dueDate" });
    const edge = await edgesRepo.find(ctx.db, "supports", a.id, d.id);
    expect(edge).toBeDefined();
    const edgeSources = await sourcesRepo.listForEdges(ctx.db, [edge!.id]);
    expect(edgeSources).toHaveLength(1);
    expect(edgeSources[0]!.label).toBe("Kickoff minutes");
    expect(captured.some((e) => e.name === "assumption.created" && e.entityId === a.id)).toBe(true);
    const upd = captured.find((e) => e.name === "decision.updated" && e.entityId === d.id);
    expect(upd?.changes[0]).toMatchObject({ field: "assumptions", newValue: ["Dataset arrives before UAT"] });

    const [item] = (await decisionsService.list(ctx, projectId)).filter((r) => r.decision.id === d.id);
    expect(item!.assumptions.map((x) => x.id)).toEqual([a.id]);
    expect(item!.sources).toHaveLength(1);
  });

  it("creates person, dependency and external-rule Assumptions", async () => {
    const d = await mk();
    const dep = await dependenciesService.create(ctx, {
      projectId,
      predecessorType: "task",
      predecessorId: task.id,
      successorType: "milestone",
      successorId: milestone.id,
    });
    const p = await mkAssumption(d.id, {
      statement: "Priya stays on the project",
      subtype: "person",
      targetType: "person",
      targetId: priya.id,
      targetField: null,
      assumedUntil: null,
    });
    const dp = await mkAssumption(d.id, {
      statement: "Recruitment finishes before UAT",
      subtype: "dependency",
      targetType: "dependency",
      targetId: dep.id,
      targetField: null,
      assumedUntil: null,
    });
    const x = await mkAssumption(d.id, {
      statement: "IRB rules allow recorded interviews",
      subtype: "external_rule",
      targetType: null,
      targetId: null,
      targetField: null,
      assumedUntil: null,
    });
    expect([p.subtype, dp.subtype, x.subtype]).toEqual(["person", "dependency", "external_rule"]);
    expect(x.targetId).toBeNull();
  });

  it("detach deletes an orphaned Assumption but keeps one still attached elsewhere", async () => {
    const d1 = await mk();
    const d2 = await mk({ title: "Second" });
    const a = await mkAssumption(d1.id);
    await decisionsService.attachAssumption(ctx, { decisionId: d2.id, assumptionId: a.id });
    await decisionsService.attachAssumption(ctx, { decisionId: d2.id, assumptionId: a.id });
    expect(await edgesRepo.listFrom(ctx.db, "supports", a.id)).toHaveLength(2);

    await decisionsService.detachAssumption(ctx, { decisionId: d1.id, assumptionId: a.id });
    expect(await assumptionsRepo.findById(ctx.db, a.id)).toBeDefined();

    captured.length = 0;
    await decisionsService.detachAssumption(ctx, { decisionId: d2.id, assumptionId: a.id });
    expect(await assumptionsRepo.findById(ctx.db, a.id)).toBeUndefined();
    expect(captured.some((e) => e.name === "assumption.deleted" && e.entityId === a.id)).toBe(true);
  });

  it("retire is idempotent and recorded with field state", async () => {
    const d = await mk();
    const a = await mkAssumption(d.id);
    captured.length = 0;
    const r = await decisionsService.retireAssumption(ctx, a.id);
    expect(r.state).toBe("retired");
    await decisionsService.retireAssumption(ctx, a.id);
    const evs = captured.filter((e) => e.entityId === a.id && e.action === "updated");
    expect(evs).toHaveLength(1);
    expect(evs[0]!.changes[0]).toMatchObject({ field: "state", oldValue: "holding", newValue: "retired" });
  });
});

describe("supersede", () => {
  it("sets the older Decision to superseded, records the edge and the status event", async () => {
    const older = await mk({ title: "Surveys" });
    captured.length = 0;
    const newer = await mk({ title: "Interviews", supersedesId: older.id });
    expect((await decisionsService.get(ctx, older.id)).status).toBe("superseded");
    const edge = await edgesRepo.find(ctx.db, "superseded_by", older.id, newer.id);
    expect(edge).toBeDefined();
    expect(await sourcesRepo.listForEdges(ctx.db, [edge!.id])).toHaveLength(1);
    const statusEv = captured.find((e) => e.entityId === older.id && e.action === "updated");
    expect(statusEv?.changes).toMatchObject([{ field: "status", oldValue: "active", newValue: "superseded" }]);
    expect(statusEv?.changes[0]?.activityEventId).toMatch(/[0-9a-f-]{36}/);
    const list = await decisionsService.list(ctx, projectId);
    expect(list.find((r) => r.decision.id === older.id)?.supersededById).toBe(newer.id);
    expect(list.find((r) => r.decision.id === newer.id)?.supersedesId).toBe(older.id);
  });

  it("rejects self, cycles and a second supersession of the same Decision", async () => {
    const a = await mk({ title: "A" });
    const b = await mk({ title: "B", supersedesId: a.id });
    const c = await mk({ title: "C" });
    await expect(decisionsService.supersede(ctx, { id: a.id, supersedesId: a.id })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(decisionsService.supersede(ctx, { id: a.id, supersedesId: b.id })).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(decisionsService.supersede(ctx, { id: c.id, supersedesId: a.id })).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it("clearing the link restores the older Decision to active", async () => {
    const older = await mk({ title: "Old" });
    const newer = await mk({ title: "New", supersedesId: older.id });
    await decisionsService.supersede(ctx, { id: newer.id, supersedesId: null });
    expect((await decisionsService.get(ctx, older.id)).status).toBe("active");
    expect(await edgesRepo.find(ctx.db, "superseded_by", older.id, newer.id)).toBeUndefined();
  });

  it("a superseded Decision cannot change its status by hand", async () => {
    const older = await mk({ title: "Old2" });
    await mk({ title: "New2", supersedesId: older.id });
    await expect(decisionsService.update(ctx, { id: older.id, status: "revisited" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

describe("delete", () => {
  it("removes edges and Sources, deletes orphaned Assumptions and restores a superseded Decision", async () => {
    const older = await mk({ title: "Old3" });
    const d = await mk({ title: "Doomed", supersedesId: older.id });
    const a = await mkAssumption(d.id);
    captured.length = 0;
    await decisionsService.delete(ctx, d.id);
    expect(await assumptionsRepo.findById(ctx.db, a.id)).toBeUndefined();
    expect(await sourcesRepo.listForDecisions(ctx.db, [d.id])).toHaveLength(0);
    expect(await edgesRepo.listFrom(ctx.db, "supports", a.id)).toHaveLength(0);
    expect((await decisionsService.get(ctx, older.id)).status).toBe("active");
    expect(captured.map((e) => e.name)).toEqual(
      expect.arrayContaining(["decision.deleted", "assumption.deleted", "decision.updated"]),
    );
  });
});

describe("ownership", () => {
  it("refuses every entry point to a stranger", async () => {
    const d = await mk();
    const a = await mkAssumption(d.id);
    const stranger = await makeCtx();
    await expect(decisionsService.list(stranger, projectId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(decisionsService.get(stranger, d.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(decisionsService.sourceCandidates(stranger, projectId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(decisionsService.update(stranger, { id: d.id, title: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(decisionsService.delete(stranger, d.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(decisionsService.supersede(stranger, { id: d.id, supersedesId: null })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      mk({ projectId }).then((x) =>
        decisionsService.createAssumption(stranger, {
          projectId,
          decisionId: x.id,
          statement: "s",
          subtype: "external_rule",
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      decisionsService.attachAssumption(stranger, { decisionId: d.id, assumptionId: a.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      decisionsService.detachAssumption(stranger, { decisionId: d.id, assumptionId: a.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(decisionsService.retireAssumption(stranger, a.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses to attach an Assumption from another Project", async () => {
    const d = await mk();
    const other = await makeCtx();
    const otherProject = await makeProject(other, "ATT");
    const foreignEvidence = await evidenceService.create(other, {
      projectId: otherProject.id,
      title: "Foreign minutes",
      kind: "minutes",
      body: "x",
    });
    const foreignDecision = await decisionsService.create(other, {
      projectId: otherProject.id,
      title: "Foreign",
      decidedOn: "2026-09-01",
      chosen: "y",
      sources: [{ kind: "evidence", entityId: foreignEvidence.id }],
    });
    const foreignAssumption = await decisionsService.createAssumption(other, {
      projectId: otherProject.id,
      decisionId: foreignDecision.id,
      statement: "theirs",
      subtype: "external_rule",
    });
    await expect(
      decisionsService.attachAssumption(ctx, { decisionId: d.id, assumptionId: foreignAssumption.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await edgesRepo.find(ctx.db, "supports", foreignAssumption.id, d.id)).toBeUndefined();
  });
});

describe("break, dismiss and consequences (#38)", () => {
  it("breakAssumption records state, trigger and reason; idempotent; retired cannot break", async () => {
    const d = await mk();
    const a = await mkAssumption(d.id);
    captured.length = 0;
    const [ev] = await activityRepo.forEntity(ctx.db, milestone.id);
    const broken = await decisionsService.breakAssumption(
      { ...ctx, via: "system" },
      { id: a.id, brokenByEventId: ev!.event.id, reason: "UAT moved" },
    );
    expect(broken).toMatchObject({ state: "broken", brokenByEventId: ev!.event.id, brokenReason: "UAT moved" });
    const upd = captured.find((e) => e.entityId === a.id && e.action === "updated");
    expect(upd?.via).toBe("system");
    expect(upd?.changes.map((c) => c.field)).toEqual(["state", "brokenByEventId", "brokenReason"]);
    captured.length = 0;
    await decisionsService.breakAssumption(ctx, { id: a.id, reason: "again" });
    expect(captured.filter((e) => e.entityId === a.id)).toHaveLength(0);
    const r = await mkAssumption(d.id, { statement: "retire me" });
    await decisionsService.retireAssumption(ctx, r.id);
    await expect(decisionsService.breakAssumption(ctx, { id: r.id })).rejects.toBeInstanceOf(ValidationError);
  });

  it("manual break omits the trigger change", async () => {
    const d = await mk();
    const a = await mkAssumption(d.id, {
      subtype: "external_rule",
      targetType: null,
      targetId: null,
      targetField: null,
      assumedUntil: null,
    });
    captured.length = 0;
    await decisionsService.breakAssumption(ctx, { id: a.id });
    const upd = captured.find((e) => e.entityId === a.id && e.action === "updated");
    expect(upd?.changes.map((c) => c.field)).toEqual(["state"]);
  });

  it("dismissAlert hides the alert and leaves the Assumption broken", async () => {
    const d = await mk();
    const a = await mkAssumption(d.id);
    await expect(decisionsService.dismissAlert(ctx, a.id)).rejects.toBeInstanceOf(ValidationError);
    await decisionsService.breakAssumption(ctx, { id: a.id, reason: "x" });
    expect(await assumptionsRepo.listAlertsByProjects(ctx.db, [projectId])).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: a.id })]),
    );
    const dismissed = await decisionsService.dismissAlert(ctx, a.id);
    expect(dismissed.state).toBe("broken");
    expect(dismissed.alertDismissedAt).toBeInstanceOf(Date);
    expect((await assumptionsRepo.listAlertsByProjects(ctx.db, [projectId])).some((x) => x.id === a.id)).toBe(false);
  });

  it("addConsequence records a leads_to edge with copied Sources; remove drops it", async () => {
    const d = await mk();
    captured.length = 0;
    await decisionsService.addConsequence(ctx, { decisionId: d.id, targetType: "milestone", targetId: milestone.id });
    const edge = await edgesRepo.find(ctx.db, "leads_to", d.id, milestone.id);
    expect(edge?.toType).toBe("milestone");
    expect(await sourcesRepo.listForEdges(ctx.db, [edge!.id])).toHaveLength(1);
    const upd = captured.find((e) => e.entityId === d.id && e.action === "updated");
    expect(upd?.changes[0]).toMatchObject({ field: "leadsTo", newValue: ["UAT begins"] });
    const item = (await decisionsService.list(ctx, projectId)).find((r) => r.decision.id === d.id);
    expect(item?.consequences).toEqual([{ type: "milestone", id: milestone.id }]);
    await expect(
      decisionsService.addConsequence(ctx, { decisionId: d.id, targetType: "task", targetId: milestone.id }),
    ).rejects.toBeInstanceOf(ValidationError);
    await decisionsService.removeConsequence(ctx, {
      decisionId: d.id,
      targetType: "milestone",
      targetId: milestone.id,
    });
    expect(await edgesRepo.find(ctx.db, "leads_to", d.id, milestone.id)).toBeUndefined();
  });

  it("refuses break, dismiss and consequences to a stranger", async () => {
    const d = await mk();
    const a = await mkAssumption(d.id);
    const stranger = await makeCtx();
    await expect(decisionsService.breakAssumption(stranger, { id: a.id })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(decisionsService.dismissAlert(stranger, a.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      decisionsService.addConsequence(stranger, { decisionId: d.id, targetType: "task", targetId: task.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      decisionsService.removeConsequence(stranger, { decisionId: d.id, targetType: "task", targetId: task.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("search (#40)", () => {
  it("answers from confirmed Decisions with linked Sources, never from pending Proposals", async () => {
    const { proposalsRepo } = await import("@/server/modules/proposals/repository");
    const p = await makeProject(ctx, "WHY");
    const ev = await evidenceService.create(ctx, {
      projectId: p.id,
      title: "Kickoff minutes",
      kind: "minutes",
      body: "We decided to switch from surveys to interviews.",
    });
    const t = await tasksService.create(ctx, { projectId: p.id, title: "Recruit", priority: "none" });
    const c = await commentsService.create(ctx, {
      projectId: p.id,
      entityType: "task",
      entityId: t.id,
      body: "Response rate was 4%.",
    });
    const [taskEvent] = await activityRepo.forEntity(ctx.db, t.id);
    const d = await decisionsService.create(ctx, {
      projectId: p.id,
      title: "Switch from surveys to interviews",
      decidedOn: "2026-09-10",
      chosen: "Semi-structured interviews",
      alternatives: "Keep the survey open",
      sources: [
        { kind: "evidence", entityId: ev.id },
        { kind: "comment", entityId: c.id },
        { kind: "activity_event", entityId: taskEvent!.event.id },
      ],
    });
    await proposalsRepo.insertMany(ctx.db, [
      {
        projectId: p.id,
        fingerprint: "f",
        title: "Switch from surveys to interviews (pending)",
        chosen: "interviews",
        sources: [{ kind: "evidence", entityId: ev.id, excerpt: "x" }],
        assumptions: [],
        extractor: "heuristic",
      },
    ]);

    const out = await decisionsService.search(ctx, {
      projectId: p.id,
      query: "why did we switch from surveys to interviews?",
      limit: 5,
    });
    expect(out.decisions.map((x) => x.id)).toEqual([d.id]);
    expect(out.nearestEvidence).toEqual([]);
    const a = out.decisions[0]!;
    expect(a.href).toBe(`/projects/${p.id}/decisions?decision=${d.id}`);
    expect(a.sources.map((s) => s.href)).toEqual([
      `/projects/${p.id}/evidence?item=${ev.id}#evidence-${ev.id}`,
      `/projects/${p.id}/tasks?task=${t.id}&tab=history`,
      `/projects/${p.id}/tasks?task=${t.id}&tab=history`,
    ]);
    expect(a.sources.every((s) => s.href.startsWith("/"))).toBe(true);
    expect(a.supersededBy).toBeNull();
    // The model is told to copy `cite` rather than build a link, so every citable row carries one.
    expect(a.cite).toBe(`[D-${a.number} ${a.title}](${a.href})`);
    expect(a.sources.map((s) => s.cite)).toEqual(a.sources.map((s) => `[${s.label}](${s.href})`));
  });

  it("names the superseding Decision and returns nearest Evidence when nothing matches", async () => {
    const p = await makeProject(ctx, "SUP");
    const ev = await evidenceService.create(ctx, {
      projectId: p.id,
      title: "Vendor evaluation",
      kind: "plan",
      body: "Compared Stripe and Adyen.",
    });
    const older = await decisionsService.create(ctx, {
      projectId: p.id,
      title: "Use Stripe",
      decidedOn: "2026-08-01",
      chosen: "Stripe",
      sources: [{ kind: "evidence", entityId: ev.id }],
    });
    const newer = await decisionsService.create(ctx, {
      projectId: p.id,
      title: "Use Adyen",
      decidedOn: "2026-09-01",
      chosen: "Adyen",
      sources: [{ kind: "evidence", entityId: ev.id }],
      supersedesId: older.id,
    });
    const out = await decisionsService.search(ctx, { projectId: p.id, query: "why stripe", limit: 5 });
    expect(out.decisions[0]).toMatchObject({
      id: older.id,
      status: "superseded",
      supersededBy: { id: newer.id, number: newer.number, title: "Use Adyen" },
    });
    expect(out.decisions[0]!.supersededBy!.href).toBe(`/projects/${p.id}/decisions?decision=${newer.id}`);
    expect(out.decisions[0]!.supersededBy!.cite).toBe(
      `[D-${newer.number} Use Adyen](/projects/${p.id}/decisions?decision=${newer.id})`,
    );

    const none = await decisionsService.search(ctx, {
      projectId: p.id,
      query: "why did we pick the vendor evaluation date",
      limit: 5,
    });
    expect(none.decisions).toEqual([]);
    expect(none.nearestEvidence).toMatchObject([
      {
        id: ev.id,
        title: "Vendor evaluation",
        kind: "plan",
        href: `/projects/${p.id}/evidence?item=${ev.id}#evidence-${ev.id}`,
        cite: `[Vendor evaluation](/projects/${p.id}/evidence?item=${ev.id}#evidence-${ev.id})`,
      },
    ]);
    expect(
      (await decisionsService.search(ctx, { projectId: p.id, query: "quantum", limit: 5 })).nearestEvidence,
    ).toEqual([]);
  });

  it("refuses a stranger", async () => {
    const stranger = await makeCtx();
    await expect(
      decisionsService.search(stranger, { projectId, query: "why interviews", limit: 5 }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("passage-level Sources (#42)", () => {
  const TRANSCRIPT = [
    "[00:01:10] Priya: The merchant dataset slipped again.",
    "[00:03:45] Marcus: We decided to freeze scope after the pilot instead of adding the export.",
  ].join("\n");

  it("snapshots the Passage text and names the speaker, and links to the Passage", async () => {
    const p = await makeProject(ctx, "PAS");
    const ev = await evidenceService.create(ctx, {
      projectId: p.id,
      title: "Steering call",
      kind: "transcript",
      body: TRANSCRIPT,
    });
    const [, marcus] = await evidenceService.passages(ctx, ev.id);
    const d = await decisionsService.create(ctx, {
      projectId: p.id,
      title: "Freeze scope",
      decidedOn: "2026-09-10",
      chosen: "Freeze",
      sources: [{ kind: "evidence", entityId: ev.id, passageId: marcus!.id }],
    });
    const [source] = await sourcesRepo.listForDecisions(ctx.db, [d.id]);
    expect(source).toMatchObject({
      passageId: marcus!.id,
      label: "Steering call · Marcus",
      excerpt: "We decided to freeze scope after the pilot instead of adding the export.",
    });
    const out = await decisionsService.search(ctx, { projectId: p.id, query: "why freeze scope", limit: 5 });
    expect(out.decisions[0]!.sources[0]!.href).toBe(`/projects/${p.id}/evidence?item=${ev.id}#passage-${marcus!.id}`);
    const labels = await decisionsService.sourceLabels(ctx, p.id);
    expect(labels.get(`evidence:${ev.id}:${marcus!.id}`)).toBe("Steering call · Marcus");
    expect(labels.get(`evidence:${ev.id}`)).toBe("Steering call");

    // Re-segmenting the transcript nulls the citation's passageId; the Source degrades to the whole item.
    await evidenceService.update(ctx, { id: ev.id, body: `${TRANSCRIPT}\nPriya: Agreed.` });
    const [after] = await sourcesRepo.listForDecisions(ctx.db, [d.id]);
    expect(after!.passageId).toBeNull();
    expect(after!.label).toBe("Steering call · Marcus");
    const degraded = await decisionsService.search(ctx, { projectId: p.id, query: "why freeze scope", limit: 5 });
    expect(degraded.decisions[0]!.sources[0]!.href).toBe(`/projects/${p.id}/evidence?item=${ev.id}#evidence-${ev.id}`);
  });

  it("rejects a Passage of another Evidence and degrades a Passage that no longer exists", async () => {
    const p = await makeProject(ctx, "PAX");
    const a = await evidenceService.create(ctx, {
      projectId: p.id,
      title: "Call A",
      kind: "transcript",
      body: TRANSCRIPT,
    });
    const b = await evidenceService.create(ctx, {
      projectId: p.id,
      title: "Call B",
      kind: "transcript",
      body: TRANSCRIPT,
    });
    const [aFirst] = await evidenceService.passages(ctx, a.id);
    const base = { projectId: p.id, title: "X", decidedOn: "2026-09-10", chosen: "X" };
    await expect(
      decisionsService.create(ctx, { ...base, sources: [{ kind: "evidence", entityId: b.id, passageId: aFirst!.id }] }),
    ).rejects.toBeInstanceOf(ValidationError);
    const d = await decisionsService.create(ctx, {
      ...base,
      sources: [{ kind: "evidence", entityId: a.id, passageId: "00000000-0000-0000-0000-000000000000" }],
    });
    const [source] = await sourcesRepo.listForDecisions(ctx.db, [d.id]);
    expect(source).toMatchObject({ passageId: null, label: "Call A" });
  });
});
