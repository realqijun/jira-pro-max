import { count } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Ctx } from "@/server/core/context";
import { ConflictError, ForbiddenError } from "@/server/core/errors";
import { activityRepo } from "@/server/modules/activity/service";
import { conversationsRepo } from "@/server/modules/assistant/repository";
import { commentsService } from "@/server/modules/comments/service";
import { assumptionsRepo, sourcesRepo } from "@/server/modules/decisions/repository";
import { assumptions, decisionEdges, decisionSources, decisions } from "@/server/modules/decisions/schema";
import { decisionsService } from "@/server/modules/decisions/service";
import type { EvidenceRow } from "@/server/modules/evidence/schema";
import { evidenceService } from "@/server/modules/evidence/service";
import { milestonesService } from "@/server/modules/milestones/service";
import { peopleService } from "@/server/modules/people/service";
import { tasksService } from "@/server/modules/tasks/service";
import { closeDb, makeCtx, makeProject } from "@/test/helpers";
import { heuristicExtract, type Extract } from "./extract";
import { heuristicExtractItems } from "./extract-items";
import { itemProposalsRepo, proposalsRepo } from "./repository";
import { proposalsService } from "./service";

let ctx: Ctx;
let projectId: string;
let minutes: EvidenceRow;
let commentId: string;

const SENTENCE = "After the pilot we decided to switch from weekly surveys to fortnightly interviews.";

beforeAll(async () => {
  ctx = await makeCtx();
  projectId = (await makeProject(ctx, "PRP")).id;
  await peopleService.createPerson(ctx, { projectId, name: "Priya Nair" });
  await milestonesService.create(ctx, { projectId, name: "UAT begins", dueDate: "2026-10-05" });
  const task = await tasksService.create(ctx, { projectId, title: "Recruit interviewees", priority: "none" });
  minutes = await evidenceService.create(ctx, {
    projectId,
    title: "Steering call notes",
    kind: "minutes",
    body: `Attendees: Priya, Marcus.\n\n${SENTENCE} The vendor sandbox is still pending.`,
  });
  commentId = (
    await commentsService.create(ctx, {
      projectId,
      entityType: "task",
      entityId: task.id,
      body: "We agreed to recruit through the alumni list instead of a public call.",
    })
  ).id;
});
afterAll(closeDb);

const graphCounts = async () => {
  const [[d], [a], [e], [s]] = await Promise.all([
    ctx.db.select({ n: count() }).from(decisions),
    ctx.db.select({ n: count() }).from(assumptions),
    ctx.db.select({ n: count() }).from(decisionEdges),
    ctx.db.select({ n: count() }).from(decisionSources),
  ]);
  return [d!.n, a!.n, e!.n, s!.n];
};

describe("proposalsService.runPass", () => {
  it("proposes traceable Decisions from Evidence and Comments, never touching the graph, and is idempotent", async () => {
    const before = await graphCounts();
    const out = await proposalsService.runPass(ctx, projectId, { extract: heuristicExtract, trigger: "manual" });
    expect(out).toMatchObject({ sourcesPassed: 2, proposed: 2, discarded: 0 });
    expect(await graphCounts()).toEqual(before);

    const pending = await proposalsService.listPending(ctx, projectId);
    // Review opens on the first Proposal of the list it steps through, not an arbitrary new one.
    expect(out).toMatchObject({ proposalId: pending[0]!.id });
    expect((await proposalsService.listPending(ctx, projectId)).map((p) => p.id)).toEqual(pending.map((p) => p.id));
    expect(pending.map((p) => p.title).sort()).toEqual([
      "Recruit through the alumni list instead of a public call",
      "Switch from weekly surveys to fortnightly interviews",
    ]);
    const fromMinutes = pending.find((p) => p.sources[0]!.entityId === minutes.id)!;
    expect(fromMinutes.sources).toEqual([{ kind: "evidence", entityId: minutes.id, excerpt: SENTENCE }]);
    expect(pending.find((p) => p.sources[0]!.entityId === commentId)?.alternatives).toBe("a public call");

    const retry = await proposalsService.runPass(ctx, projectId, { extract: heuristicExtract, trigger: "manual" });
    expect(retry).toMatchObject({ skipped: "nothing_new", proposalId: pending[0]!.id });
    expect(await proposalsService.listPending(ctx, projectId)).toHaveLength(2);
  });

  it("a manual pass that reads new Sources but raises nothing still points at the pending Proposals", async () => {
    const p = await makeProject(ctx, "MNP");
    await evidenceService.create(ctx, { projectId: p.id, title: "Minutes", kind: "minutes", body: SENTENCE });
    await proposalsService.runPass(ctx, p.id, { extract: heuristicExtract, trigger: "automatic" });
    const [older] = await proposalsService.listPending(ctx, p.id);
    await evidenceService.create(ctx, { projectId: p.id, title: "Call", kind: "minutes", body: "Budget is on track." });

    const out = await proposalsService.runPass(ctx, p.id, { extract: heuristicExtract, trigger: "manual" });
    expect(out).toMatchObject({ sourcesPassed: 1, proposed: 0, proposalId: older!.id });
    expect(await proposalsService.runPass(ctx, p.id, { extract: heuristicExtract, trigger: "automatic" })).toEqual({
      skipped: "nothing_new",
      items: { skipped: "nothing_new" },
    });
  });

  it("discards output whose Source or excerpt is not traceable", async () => {
    const other = await makeProject(ctx, "TRC");
    await evidenceService.create(ctx, { projectId: other.id, title: "Plan", kind: "plan", body: "We chose Postgres." });
    const fabricating: Extract = async ({ sources }) => ({
      proposals: [
        {
          title: "Real",
          decidedOn: null,
          context: null,
          chosen: "Postgres",
          alternatives: null,
          revisitWhen: null,
          sources: [{ kind: "evidence", entityId: sources[0]!.entityId, excerpt: "we chose postgres" }],
          assumptions: [],
        },
        {
          title: "Fake excerpt",
          decidedOn: null,
          context: null,
          chosen: "x",
          alternatives: null,
          revisitWhen: null,
          sources: [{ kind: "evidence", entityId: sources[0]!.entityId, excerpt: "we chose MySQL" }],
          assumptions: [],
        },
        {
          title: "Fake source",
          decidedOn: null,
          context: null,
          chosen: "x",
          alternatives: null,
          revisitWhen: null,
          sources: [{ kind: "evidence", entityId: minutes.id, excerpt: SENTENCE }],
          assumptions: [],
        },
      ],
    });
    const out = await proposalsService.runPass(ctx, other.id, { extract: fabricating, trigger: "manual" });
    expect(out).toMatchObject({ proposed: 1, discarded: 2 });
    expect((await proposalsService.listPending(ctx, other.id)).map((p) => p.title)).toEqual(["Real"]);
  });

  it("re-passes edited Evidence but never resurrects a rejected Proposal", async () => {
    const p = await makeProject(ctx, "REJ");
    const ev = await evidenceService.create(ctx, {
      projectId: p.id,
      title: "Notes",
      kind: "minutes",
      body: "We decided to ship on Friday.",
    });
    await proposalsService.runPass(ctx, p.id, { extract: heuristicExtract, trigger: "manual" });
    const [prop] = await proposalsService.listPending(ctx, p.id);
    await proposalsService.reject(ctx, prop!.id);
    expect(await proposalsService.listPending(ctx, p.id)).toHaveLength(0);
    await evidenceService.update(ctx, { id: ev.id, body: "We decided to ship on Friday. Lunch was late." });
    const out = await proposalsService.runPass(ctx, p.id, { extract: heuristicExtract, trigger: "manual" });
    expect(out).toMatchObject({ sourcesPassed: 1, proposed: 0 });
    expect(await proposalsService.listPending(ctx, p.id)).toHaveLength(0);
    expect(await proposalsService.stats(ctx, p.id)).toMatchObject({ proposed: 1, rejected: 1, accepted: 0, rate: 0 });
  });

  it("falls back to the heuristic without a model and honours PROPOSALS_EXTRACTOR", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("PROPOSALS_EXTRACTOR", "");
    expect(await proposalsService.enabled(ctx)).toBe(true);
    const p = await makeProject(ctx, "ENV");
    await evidenceService.create(ctx, {
      projectId: p.id,
      title: "N",
      kind: "minutes",
      body: "We agreed to pause hiring.",
    });
    expect(await proposalsService.runPass(ctx, p.id, { trigger: "manual" })).toMatchObject({
      extractor: "heuristic",
      proposed: 1,
    });
    vi.stubEnv("PROPOSALS_EXTRACTOR", "model");
    expect(await proposalsService.enabled(ctx)).toBe(false);
    vi.unstubAllEnvs();
  });
});

describe("accept and reject", () => {
  it("accept writes a Decision through the service under via assistant, keeps the excerpt, creates Assumptions, marks the Proposal", async () => {
    const p = await makeProject(ctx, "ACC");
    await peopleService.createPerson(ctx, { projectId: p.id, name: "Priya Nair" });
    const m = await milestonesService.create(ctx, { projectId: p.id, name: "UAT begins", dueDate: "2026-10-05" });
    const ev = await evidenceService.create(ctx, {
      projectId: p.id,
      title: "Minutes",
      kind: "minutes",
      body: `Intro.\n${SENTENCE}`,
    });
    const withAssumptions: Extract = async () => ({
      proposals: [
        {
          title: "Switch to interviews",
          decidedOn: "2026-09-10",
          context: null,
          chosen: "Interviews",
          alternatives: null,
          revisitWhen: null,
          sources: [{ kind: "evidence", entityId: ev.id, excerpt: SENTENCE }],
          assumptions: [
            {
              statement: "Priya stays on the project",
              subtype: "person",
              targetName: "Priya Nair",
              targetField: null,
              assumedUntil: null,
            },
            {
              statement: "Data lands before UAT",
              subtype: "date",
              targetName: "UAT begins",
              targetField: null,
              assumedUntil: "2026-10-01",
            },
            {
              statement: "Nobody",
              subtype: "person",
              targetName: "Ghost",
              targetField: null,
              assumedUntil: null,
            },
          ],
        },
      ],
    });
    await proposalsService.runPass(ctx, p.id, { extract: withAssumptions, trigger: "manual" });
    const [prop] = await proposalsService.listPending(ctx, p.id);
    expect(prop!.assumptions).toHaveLength(2);

    const decision = await proposalsService.accept(ctx, {
      id: prop!.id,
      overrides: { title: "Interviews, not surveys" },
    });
    expect(decision.title).toBe("Interviews, not surveys");
    expect(decision.decidedOn).toBe("2026-09-10");
    const events = await activityRepo.forEntity(ctx.db, decision.id);
    const created = events.find((e) => e.event.action === "created")!;
    expect(created.event.via).toBe("assistant");
    expect(created.event.actorId).toBe(ctx.userId);
    expect((await sourcesRepo.listForDecisions(ctx.db, [decision.id]))[0]).toMatchObject({
      entityId: ev.id,
      excerpt: SENTENCE,
    });
    const list = await decisionsService.list(ctx, p.id);
    const item = list.find((x) => x.decision.id === decision.id)!;
    expect(item.assumptions.map((a) => a.statement).sort()).toEqual([
      "Data lands before UAT",
      "Priya stays on the project",
    ]);
    expect(item.assumptions.find((a) => a.subtype === "date")).toMatchObject({
      targetId: m.id,
      targetField: "dueDate",
      assumedUntil: "2026-10-01",
    });
    const after = (await proposalsRepo.findById(ctx.db, prop!.id))!;
    expect(after).toMatchObject({ status: "accepted", decisionId: decision.id });
    expect(after.resolvedAt).toBeInstanceOf(Date);
    await expect(proposalsService.accept(ctx, { id: prop!.id })).rejects.toBeInstanceOf(ConflictError);
    await expect(proposalsService.reject(ctx, prop!.id)).rejects.toBeInstanceOf(ConflictError);
    expect(await proposalsService.stats(ctx, p.id)).toMatchObject({ proposed: 1, accepted: 1, rate: 1 });
  });

  it("the dialog path (decisionsService.create with proposalId) also marks the Proposal and attributes to the Assistant", async () => {
    const p = await makeProject(ctx, "DLG");
    const ev = await evidenceService.create(ctx, {
      projectId: p.id,
      title: "Minutes",
      kind: "minutes",
      body: SENTENCE,
    });
    await proposalsService.runPass(ctx, p.id, { extract: heuristicExtract, trigger: "manual" });
    const [prop] = await proposalsService.listPending(ctx, p.id);
    const d = await decisionsService.create(
      { ...ctx, via: "assistant" },
      {
        projectId: p.id,
        title: "Edited title",
        decidedOn: "2026-09-12",
        chosen: "Edited chosen",
        sources: prop!.sources,
        proposalId: prop!.id,
        assumptions: [{ statement: "IRB allows recordings", subtype: "external_rule" }],
      },
    );
    expect(await proposalsRepo.findById(ctx.db, prop!.id)).toMatchObject({ status: "accepted", decisionId: d.id });
    expect((await activityRepo.forEntity(ctx.db, d.id)).find((e) => e.event.action === "created")?.event.via).toBe(
      "assistant",
    );
    expect(await assumptionsRepo.listByProject(ctx.db, p.id)).toHaveLength(1);
    await expect(
      decisionsService.create(ctx, {
        projectId: p.id,
        title: "again",
        decidedOn: "2026-09-12",
        chosen: "x",
        sources: prop!.sources,
        proposalId: prop!.id,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    void ev;
  });

  it("refuses every entry point to a stranger", async () => {
    const stranger = await makeCtx();
    const [prop] = await proposalsService.listPending(ctx, projectId);
    await expect(proposalsService.runPass(stranger, projectId, { trigger: "manual" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(proposalsService.listPending(stranger, projectId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(proposalsService.stats(stranger, projectId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(proposalsService.accept(stranger, { id: prop!.id })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(proposalsService.reject(stranger, prop!.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("races and tampering", () => {
  it("a Proposal rejected before the Decision commits rolls the create back", async () => {
    const p = await makeProject(ctx, "RCE");
    const ev = await evidenceService.create(ctx, { projectId: p.id, title: "M", kind: "minutes", body: SENTENCE });
    await proposalsService.runPass(ctx, p.id, { extract: heuristicExtract, trigger: "manual" });
    const [prop] = await proposalsService.listPending(ctx, p.id);
    await proposalsRepo.update(ctx.db, prop!.id, { status: "rejected" });
    await expect(
      decisionsService.create(ctx, {
        projectId: p.id,
        title: "late",
        decidedOn: "2026-09-12",
        chosen: "x",
        sources: [{ kind: "evidence", entityId: ev.id }],
        proposalId: prop!.id,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(await decisionsService.list(ctx, p.id)).toHaveLength(0);
  });

  it("a tampered inline Assumption pointing outside the Project is refused with the Decision", async () => {
    const p = await makeProject(ctx, "TMP");
    const ev = await evidenceService.create(ctx, { projectId: p.id, title: "M", kind: "minutes", body: SENTENCE });
    const other = await makeProject(ctx, "OTP");
    const outsider = await peopleService.createPerson(ctx, { projectId: other.id, name: "Outsider" });
    await expect(
      decisionsService.create(ctx, {
        projectId: p.id,
        title: "t",
        decidedOn: "2026-09-12",
        chosen: "x",
        sources: [{ kind: "evidence", entityId: ev.id }],
        assumptions: [{ statement: "s", subtype: "person", targetType: "person", targetId: outsider.id }],
      }),
    ).rejects.toThrow(/Invalid person|Not in this project/);
    expect(await decisionsService.list(ctx, p.id)).toHaveLength(0);
  });

  it("two passes over the same text in parallel yield one Proposal", async () => {
    const p = await makeProject(ctx, "PAR");
    await evidenceService.create(ctx, {
      projectId: p.id,
      title: "M",
      kind: "minutes",
      body: "We decided to go live in May.",
    });
    await Promise.all([
      proposalsService.runPass(ctx, p.id, { extract: heuristicExtract, trigger: "manual" }),
      proposalsService.runPass(ctx, p.id, { extract: heuristicExtract, trigger: "manual" }),
    ]);
    expect(await proposalsService.listPending(ctx, p.id)).toHaveLength(1);
  });
});

describe("transcripts (#42)", () => {
  const TRANSCRIPT = [
    "[00:01:10] Priya: The merchant dataset slipped again.",
    "[00:03:45] Marcus: We decided to freeze scope after the pilot instead of adding the export.",
    "Priya: Agreed.",
  ].join("\n");

  it("lists transcripts first, hands the extractor label-free text and cites the Passage", async () => {
    const pid = (await makeProject(ctx, "TRP")).id;
    await evidenceService.create(ctx, {
      projectId: pid,
      title: "Plan",
      kind: "plan",
      body: "We agreed to ship in Q4.",
    });
    const transcript = await evidenceService.create(ctx, {
      projectId: pid,
      title: "Steering call",
      kind: "transcript",
      body: TRANSCRIPT,
    });
    const [, marcus] = await evidenceService.passages(ctx, transcript.id);
    let seen: Parameters<Extract>[0] | null = null;
    const spy: Extract = async (input) => {
      seen = input;
      return heuristicExtract(input);
    };
    const out = await proposalsService.runPass(ctx, pid, { extract: spy, trigger: "manual" });
    expect(out).toMatchObject({ proposed: 2 });
    expect(seen!.sources.map((s) => [s.title, s.evidenceKind])).toEqual([
      ["Steering call", "transcript"],
      ["Plan", "plan"],
    ]);
    expect(seen!.sources[0]!.text).toBe(
      "The merchant dataset slipped again.\n\nWe decided to freeze scope after the pilot instead of adding the export.\n\nAgreed.",
    );
    const pending = await proposalsService.listPending(ctx, pid);
    const fromTranscript = pending.find((p) => p.sources[0]!.entityId === transcript.id)!;
    expect(fromTranscript.sources[0]).toMatchObject({
      passageId: marcus!.id,
      excerpt: "We decided to freeze scope after the pilot instead of adding the export.",
    });
    expect(pending.find((p) => p.sources[0]!.entityId !== transcript.id)!.sources[0]).not.toHaveProperty("passageId");

    // Accept carries the Passage into the Decision Source.
    const d = await proposalsService.accept(ctx, { id: fromTranscript.id });
    const [source] = await sourcesRepo.listForDecisions(ctx.db, [d.id]);
    expect(source).toMatchObject({ passageId: marcus!.id, label: "Steering call · Marcus" });
  });

  it("accepting after the transcript was re-segmented still creates the Decision, citing the whole item", async () => {
    const pid = (await makeProject(ctx, "TRQ")).id;
    const transcript = await evidenceService.create(ctx, {
      projectId: pid,
      title: "Late call",
      kind: "transcript",
      body: TRANSCRIPT,
    });
    await proposalsService.runPass(ctx, pid, { extract: heuristicExtract, trigger: "manual" });
    const [proposal] = await proposalsService.listPending(ctx, pid);
    expect(proposal!.sources[0]!.passageId).toBeTruthy();
    await evidenceService.update(ctx, { id: transcript.id, body: `${TRANSCRIPT}\nMarcus: One more thing.` });
    const d = await proposalsService.accept(ctx, { id: proposal!.id });
    const [source] = await sourcesRepo.listForDecisions(ctx.db, [d.id]);
    expect(source).toMatchObject({ passageId: null, label: "Late call", entityId: transcript.id });
  });
});

describe("item pass (#114)", () => {
  const NOTES = [
    "Action item: Book the usability lab by 2026-10-01",
    "Priya will draft the interview guide by 2026-10-02.",
    "Milestone: Pilot readout on 2026-10-20.",
  ].join("\n");
  const itemCounts = async (pid: string) => [
    (await tasksService.list(ctx, pid)).length,
    (await milestonesService.list(ctx, pid)).length,
  ];
  const setup = async (key: string, body = NOTES) => {
    const pid = (await makeProject(ctx, key)).id;
    await peopleService.createPerson(ctx, { projectId: pid, name: "Priya Nair" });
    const ev = await evidenceService.create(ctx, { projectId: pid, title: "Kickoff notes", kind: "minutes", body });
    return { pid, ev };
  };
  const failing = async () => {
    throw new Error("extractor unavailable");
  };

  it("proposes traceable Tasks and Milestones beside Decisions, never writing the items", async () => {
    const { pid, ev } = await setup("ITM");
    const before = [await itemCounts(pid), await graphCounts()];
    const out = await proposalsService.runPass(ctx, pid, { extract: heuristicExtract, trigger: "manual" });
    expect(out.items).toEqual({ extractor: "heuristic", sourcesPassed: 1, tasks: 2, milestones: 1, discarded: 0 });
    expect([await itemCounts(pid), await graphCounts()]).toEqual(before);

    const pending = await proposalsService.listPendingItems(ctx, pid);
    const priya = (await peopleService.list(ctx, pid)).people[0]!;
    const label = (f: object) => ("title" in f ? f.title : "name" in f ? f.name : "") as string;
    const byLabel = (a: [string, object], b: [string, object]) => label(a[1]).localeCompare(label(b[1]));
    expect(pending.map((p): [string, object] => [p.kind, p.fields]).sort(byLabel)).toEqual(
      (
        [
          [
            "milestone",
            { name: "Pilot readout", description: null, dueDate: "2026-10-20", ownerId: null, ownerName: null },
          ],
          [
            "task",
            {
              title: "Book the usability lab",
              description: null,
              assigneeId: null,
              assigneeName: null,
              milestoneId: null,
              milestoneName: null,
              startDate: null,
              dueDate: "2026-10-01",
            },
          ],
          [
            "task",
            {
              title: "Draft the interview guide",
              description: null,
              assigneeId: priya.id,
              assigneeName: "Priya Nair",
              milestoneId: null,
              milestoneName: null,
              startDate: null,
              dueDate: "2026-10-02",
            },
          ],
        ] as Array<[string, object]>
      ).sort(byLabel),
    );
    expect(pending.find((p) => p.kind === "milestone")!.sources).toEqual([
      { kind: "evidence", entityId: ev.id, excerpt: "Milestone: Pilot readout on 2026-10-20." },
    ]);

    const again = await proposalsService.runPass(ctx, pid, { extract: heuristicExtract, trigger: "manual" });
    expect(again.items).toEqual({ skipped: "nothing_new" });
    expect(await proposalsService.listPendingItems(ctx, pid)).toHaveLength(3);
  });

  it("cites the transcript Passage an item's excerpt sits in", async () => {
    const pid = (await makeProject(ctx, "ITR")).id;
    const t = await evidenceService.create(ctx, {
      projectId: pid,
      title: "Standup",
      kind: "transcript",
      body: "[00:00:05] Priya: Morning.\n[00:00:09] Marcus: Action item: book the lab.",
    });
    const [, marcus] = await evidenceService.passages(ctx, t.id);
    await proposalsService.runPass(ctx, pid, { extract: heuristicExtract, trigger: "manual" });
    const [item] = await proposalsService.listPendingItems(ctx, pid);
    expect(item!.sources).toEqual([
      { kind: "evidence", entityId: t.id, passageId: marcus!.id, excerpt: "Action item: book the lab." },
    ]);
  });

  it("a failing item call leaves the Decision side intact and is retried alone", async () => {
    const { pid } = await setup("IFL", `${NOTES}\nWe decided to run the pilot in two cities.`);
    const out = await proposalsService.runPass(ctx, pid, {
      extract: heuristicExtract,
      extractItems: failing,
      trigger: "automatic",
    });
    expect(out).toMatchObject({ proposed: 1, items: { skipped: "failed" } });

    const decisionSpy = vi.fn(heuristicExtract);
    const retry = await proposalsService.runPass(ctx, pid, { extract: decisionSpy, trigger: "automatic" });
    expect(decisionSpy).not.toHaveBeenCalled();
    expect(retry).toMatchObject({ skipped: "nothing_new", items: { sourcesPassed: 1, tasks: 2, milestones: 1 } });
  });

  it("a failing Decision call leaves the item side intact and is retried alone", async () => {
    const { pid } = await setup("DFL");
    const out = await proposalsService.runPass(ctx, pid, { extract: failing, trigger: "automatic" });
    expect(out).toMatchObject({ skipped: "failed", items: { tasks: 2, milestones: 1 } });

    const itemSpy = vi.fn(heuristicExtractItems);
    const retry = await proposalsService.runPass(ctx, pid, {
      extract: heuristicExtract,
      extractItems: itemSpy,
      trigger: "automatic",
    });
    expect(itemSpy).not.toHaveBeenCalled();
    expect(retry).toMatchObject({ sourcesPassed: 1, items: { skipped: "nothing_new" } });
  });

  it("a write failure on one side does not reject the pass", async () => {
    const { pid } = await setup("WFL");
    const insert = vi.spyOn(itemProposalsRepo, "insertMany").mockRejectedValueOnce(new Error("db down"));
    const out = await proposalsService.runPass(ctx, pid, { extract: heuristicExtract, trigger: "automatic" });
    insert.mockRestore();
    expect(out.items).toEqual({ skipped: "failed" });
    const retry = await proposalsService.runPass(ctx, pid, { extract: heuristicExtract, trigger: "automatic" });
    expect(retry.items).toMatchObject({ sourcesPassed: 1, tasks: 2 });
  });

  it("a load only one side needs fails that side alone", async () => {
    const { pid } = await setup("LDF", `${NOTES}\nWe decided to run the pilot in two cities.`);
    const latest = vi.spyOn(conversationsRepo, "latest").mockRejectedValueOnce(new Error("db down"));
    const out = await proposalsService.runPass(ctx, pid, { extract: heuristicExtract, trigger: "automatic" });
    latest.mockRestore();
    expect(out).toMatchObject({ skipped: "failed", items: { tasks: 2, milestones: 1 } });

    const { pid: other } = await setup("LDI", `${NOTES}\nWe decided to run the pilot in two cities.`);
    const list = vi.spyOn(itemProposalsRepo, "listByProject").mockRejectedValueOnce(new Error("db down"));
    const second = await proposalsService.runPass(ctx, other, { extract: heuristicExtract, trigger: "automatic" });
    list.mockRestore();
    expect(second).toMatchObject({ proposed: 1, items: { skipped: "failed" } });
  });

  it("a failed read after commit never loses what the pass created", async () => {
    const { pid } = await setup("PCF", `${NOTES}\nWe decided to run the pilot in two cities.`);
    const list = vi.spyOn(proposalsRepo, "listByProject").mockRejectedValue(new Error("db down"));
    const out = await proposalsService.runPass(ctx, pid, { extract: heuristicExtract, trigger: "manual" });
    list.mockRestore();
    expect(out).toMatchObject({ proposed: 1, items: { tasks: 2, milestones: 1 } });
    expect(out.proposalId).toBeUndefined();
  });

  it("never raises a rejected item again, nor a pending one restated elsewhere", async () => {
    const { pid, ev } = await setup("IRJ");
    await proposalsService.runPass(ctx, pid, { extract: heuristicExtract, trigger: "manual" });
    const lab = (await proposalsService.listPendingItems(ctx, pid)).find(
      (p) => p.kind === "task" && (p.fields as { title: string }).title === "Book the usability lab",
    )!;
    const rejected = await proposalsService.rejectItem(ctx, lab.id);
    expect(rejected).toMatchObject({ status: "rejected" });
    expect(rejected.resolvedAt).toBeInstanceOf(Date);
    await expect(proposalsService.rejectItem(ctx, lab.id)).rejects.toBeInstanceOf(ConflictError);

    await evidenceService.update(ctx, { id: ev.id, body: `${NOTES}\nLunch was late.` });
    await evidenceService.create(ctx, {
      projectId: pid,
      title: "Follow-up",
      kind: "minutes",
      body: "TODO: draft the interview guide.",
    });
    const out = await proposalsService.runPass(ctx, pid, { extract: heuristicExtract, trigger: "manual" });
    // Every item restates a known one: the rejected lab booking, and the two still pending.
    expect(out.items).toMatchObject({ sourcesPassed: 2, tasks: 0, milestones: 0, discarded: 4 });
    expect(await proposalsService.listPendingItems(ctx, pid)).toHaveLength(2);
  });

  it("a manual pass that only finds items reports them under items", async () => {
    const { pid } = await setup("IMN");
    const out = await proposalsService.runPass(ctx, pid, { extract: heuristicExtract, trigger: "manual" });
    expect(out).toMatchObject({ proposed: 0, sourcesPassed: 1, items: { tasks: 2, milestones: 1 } });
    expect(out.proposalId).toBeUndefined();
  });

  it("reports not_configured on both sides when no extractor can run", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("PROPOSALS_EXTRACTOR", "model");
    const { pid } = await setup("INC");
    expect(await proposalsService.runPass(ctx, pid, { trigger: "manual" })).toEqual({
      skipped: "not_configured",
      items: { skipped: "not_configured" },
    });
    vi.unstubAllEnvs();
  });

  it("two passes in parallel yield each item once", async () => {
    const { pid } = await setup("IPR");
    await Promise.all([
      proposalsService.runPass(ctx, pid, { extract: heuristicExtract, trigger: "manual" }),
      proposalsService.runPass(ctx, pid, { extract: heuristicExtract, trigger: "manual" }),
    ]);
    expect(await proposalsService.listPendingItems(ctx, pid)).toHaveLength(3);
  });

  it("refuses a stranger", async () => {
    const { pid } = await setup("IST");
    await proposalsService.runPass(ctx, pid, { extract: heuristicExtract, trigger: "manual" });
    const [item] = await proposalsService.listPendingItems(ctx, pid);
    const stranger = await makeCtx();
    await expect(proposalsService.listPendingItems(stranger, pid)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(proposalsService.rejectItem(stranger, item!.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
