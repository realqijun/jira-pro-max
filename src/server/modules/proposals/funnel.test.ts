import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx } from "@/server/core/context";
import { ConflictError } from "@/server/core/errors";
import { commentsService } from "@/server/modules/comments/service";
import { decisionsService } from "@/server/modules/decisions/service";
import { evidenceService } from "@/server/modules/evidence/service";
import { statusesService } from "@/server/modules/statuses/service";
import { tasksService } from "@/server/modules/tasks/service";
import { capture } from "@/shared/analytics/server";
import { closeDb, makeCtx, makeProject } from "@/test/helpers";
import { editedBeforeAccept, itemEditedBeforeAccept, proposalAccepted, today } from "./analytics";
import { heuristicExtract, type Extract } from "./extract";
import type { ProposalRow } from "./schema";
import { proposalsService } from "./service";

vi.mock("@/shared/analytics/server", () => ({ capture: vi.fn(), captureCurrent: vi.fn() }));

/**
 * The funnel events themselves (issue #74): which transitions emit, what they count and how the
 * edit decision is reached. `capture` is the seam; the real services and database do the rest.
 */

const SENTENCE = "After the pilot we decided to switch from weekly surveys to fortnightly interviews.";
const OTHER = "We agreed to run the retro fortnightly instead of weekly.";

let ctx: Ctx;

const events = (name?: string) =>
  vi
    .mocked(capture)
    .mock.calls.filter(([, event]) => !name || event === name)
    .map(([userId, event, properties]) => ({ userId, event, properties: properties ?? {} }));

/** What the review form posts for a Proposal nobody touched: the same fields, resolved the same way. */
const asSubmitted = (p: ProposalRow) => ({
  projectId: p.projectId,
  title: p.title,
  decidedOn: p.decidedOn ?? today(),
  context: p.context,
  chosen: p.chosen,
  alternatives: p.alternatives,
  revisitWhen: p.revisitWhen,
  sources: p.sources,
  assumptions: p.assumptions.map((a) => ({
    statement: a.statement,
    subtype: a.subtype,
    targetType: a.targetType ?? null,
    targetId: a.targetId ?? null,
    targetField: a.targetField ?? null,
    assumedUntil: a.assumedUntil ?? null,
  })),
  proposalId: p.id,
});

async function projectWithOneProposal(key: string, body = SENTENCE) {
  const project = await makeProject(ctx, key);
  await evidenceService.create(ctx, { projectId: project.id, title: "Minutes", kind: "minutes", body });
  await proposalsService.runPass(ctx, project.id, { extract: heuristicExtract, trigger: "automatic" });
  // A pass's Proposals share `createdAt`, so pick the one quoting the first sentence rather than by position.
  const proposal = (await proposalsService.listPending(ctx, project.id)).find((p) =>
    body.startsWith(p.sources[0]!.excerpt),
  );
  return { projectId: project.id, proposal: proposal! };
}

beforeAll(async () => {
  ctx = await makeCtx();
});
afterAll(closeDb);
beforeEach(() => vi.mocked(capture).mockClear());

describe("generation", () => {
  it("records one event per pass with the Proposals it really created", async () => {
    const project = await makeProject(ctx, "GEN");
    await evidenceService.create(ctx, { projectId: project.id, title: "Minutes", kind: "minutes", body: SENTENCE });
    await proposalsService.runPass(ctx, project.id, { extract: heuristicExtract, trigger: "automatic" });

    expect(events("proposal_generated")).toHaveLength(1);
    expect(events("proposal_generated")[0]).toMatchObject({
      userId: ctx.userId,
      properties: {
        project_id: project.id,
        trigger: "automatic",
        extractor: "heuristic",
        proposal_count: 1,
        source_count: 1,
        evidence_source_count: 1,
        comment_source_count: 0,
        discarded_count: 0,
      },
    });
  });

  it("names the trigger the pass was started by", async () => {
    const project = await makeProject(ctx, "TRG");
    await evidenceService.create(ctx, { projectId: project.id, title: "Minutes", kind: "minutes", body: SENTENCE });
    await proposalsService.runPass(ctx, project.id, { extract: heuristicExtract, trigger: "manual" });

    expect(events("proposal_generated")[0]?.properties).toMatchObject({ trigger: "manual" });
  });

  it("stays silent when a pass finds nothing new", async () => {
    const { projectId } = await projectWithOneProposal("NEW");
    vi.mocked(capture).mockClear();

    expect(await proposalsService.runPass(ctx, projectId, { extract: heuristicExtract, trigger: "automatic" })).toEqual(
      { skipped: "nothing_new", items: { skipped: "nothing_new" } },
    );
    expect(events()).toEqual([]);
  });

  it("stays silent when no extractor is configured", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("PROPOSALS_EXTRACTOR", "model");
    const project = await makeProject(ctx, "CFG");
    await evidenceService.create(ctx, { projectId: project.id, title: "Minutes", kind: "minutes", body: SENTENCE });

    expect(await proposalsService.runPass(ctx, project.id, { trigger: "manual" })).toEqual({
      skipped: "not_configured",
      items: { skipped: "not_configured" },
    });
    expect(events()).toEqual([]);
    vi.unstubAllEnvs();
  });

  it("stays silent when the extractor throws", async () => {
    const project = await makeProject(ctx, "ERR");
    await evidenceService.create(ctx, { projectId: project.id, title: "Minutes", kind: "minutes", body: SENTENCE });
    const failing = async (): Promise<never> => {
      throw new Error("extractor unavailable");
    };

    expect(
      await proposalsService.runPass(ctx, project.id, {
        extract: failing,
        extractItems: failing,
        trigger: "automatic",
      }),
    ).toEqual({ skipped: "failed", items: { skipped: "failed" } });
    expect(events()).toEqual([]);

    // The failed pass wrote no bookkeeping, so the retry reads the same Source and records once.
    await proposalsService.runPass(ctx, project.id, { extract: heuristicExtract, trigger: "automatic" });
    expect(events("proposal_generated")).toHaveLength(1);
  });

  it("records the passes that edited Evidence and a new Comment schedule", async () => {
    const project = await makeProject(ctx, "UPD");
    const task = await tasksService.create(ctx, { projectId: project.id, title: "Recruit", priority: "none" });
    const ev = await evidenceService.create(ctx, {
      projectId: project.id,
      title: "Minutes",
      kind: "minutes",
      body: SENTENCE,
    });
    await proposalsService.runPass(ctx, project.id, { extract: heuristicExtract, trigger: "automatic" });

    vi.mocked(capture).mockClear();
    await evidenceService.update(ctx, { id: ev.id, body: `${SENTENCE}\n\n${OTHER}` });
    await proposalsService.runPass(ctx, project.id, { extract: heuristicExtract, trigger: "automatic" });
    expect(events("proposal_generated")[0]?.properties).toMatchObject({ trigger: "automatic", proposal_count: 1 });

    vi.mocked(capture).mockClear();
    await commentsService.create(ctx, {
      projectId: project.id,
      entityType: "task",
      entityId: task.id,
      body: "We agreed to recruit through the alumni list instead of a public call.",
    });
    await proposalsService.runPass(ctx, project.id, { extract: heuristicExtract, trigger: "automatic" });
    expect(events("proposal_generated")[0]?.properties).toMatchObject({ trigger: "automatic", proposal_count: 1 });
  });

  it("stays silent when nothing the extractor returned was traceable", async () => {
    const project = await makeProject(ctx, "UNT");
    const ev = await evidenceService.create(ctx, {
      projectId: project.id,
      title: "Minutes",
      kind: "minutes",
      body: SENTENCE,
    });
    const fabricating: Extract = async () => ({
      proposals: [
        {
          title: "Invented",
          decidedOn: null,
          context: null,
          chosen: "x",
          alternatives: null,
          revisitWhen: null,
          sources: [{ kind: "evidence", entityId: ev.id, excerpt: "a sentence nobody wrote" }],
          assumptions: [],
        },
      ],
    });

    expect(await proposalsService.runPass(ctx, project.id, { extract: fabricating, trigger: "manual" })).toMatchObject({
      proposed: 0,
      discarded: 1,
    });
    expect(events()).toEqual([]);
  });

  it("never counts a Proposal twice when two passes run over the same Sources", async () => {
    const project = await makeProject(ctx, "RCE");
    await evidenceService.create(ctx, { projectId: project.id, title: "Minutes", kind: "minutes", body: SENTENCE });

    await Promise.all([
      proposalsService.runPass(ctx, project.id, { extract: heuristicExtract, trigger: "automatic" }),
      proposalsService.runPass(ctx, project.id, { extract: heuristicExtract, trigger: "manual" }),
    ]);

    const persisted = await proposalsService.stats(ctx, project.id);
    const counted = events("proposal_generated").reduce((n, e) => n + Number(e.properties.proposal_count), 0);
    expect(counted).toBe(persisted.proposed);
  });
});

describe("acceptance and rejection", () => {
  it("records a one-click accept as unedited", async () => {
    const { projectId, proposal } = await projectWithOneProposal("ONE");
    vi.mocked(capture).mockClear();

    await proposalsService.accept(ctx, { id: proposal.id });

    expect(events("proposal_accepted")).toHaveLength(1);
    expect(events("proposal_accepted")[0]).toMatchObject({
      userId: ctx.userId,
      properties: { project_id: projectId, proposal_id: proposal.id, edited_before_accept: false },
    });
  });

  it("records the review form submitted unchanged as unedited", async () => {
    const { proposal } = await projectWithOneProposal("FRM");
    vi.mocked(capture).mockClear();

    await decisionsService.create({ ...ctx, via: "assistant" }, asSubmitted(proposal));

    expect(events("proposal_accepted")[0]?.properties).toMatchObject({
      proposal_id: proposal.id,
      edited_before_accept: false,
    });
  });

  it("records changed content, dropped Sources and dropped Assumptions as edited", async () => {
    const changed = await projectWithOneProposal("EDT");
    await decisionsService.create(
      { ...ctx, via: "assistant" },
      { ...asSubmitted(changed.proposal), chosen: "Fortnightly interviews, run by the research team" },
    );
    expect(events("proposal_accepted")[0]?.properties).toMatchObject({ edited_before_accept: true });

    vi.mocked(capture).mockClear();
    const overridden = await projectWithOneProposal("OVR");
    await proposalsService.accept(ctx, { id: overridden.proposal.id, overrides: { title: "Interviews, not surveys" } });
    expect(events("proposal_accepted")[0]?.properties).toMatchObject({ edited_before_accept: true });

    vi.mocked(capture).mockClear();
    const resourced = await projectWithOneProposal("SRC", `${SENTENCE}\n\n${OTHER}`);
    const submitted = asSubmitted(resourced.proposal);
    const evidenceId = submitted.sources[0]!.entityId;
    await decisionsService.create(
      { ...ctx, via: "assistant" },
      { ...submitted, sources: [{ kind: "evidence", entityId: evidenceId, excerpt: OTHER }] },
    );
    expect(events("proposal_accepted")[0]?.properties).toMatchObject({ edited_before_accept: true });
  });

  it("records a rejection once and nothing for a repeated transition", async () => {
    const { projectId, proposal } = await projectWithOneProposal("REJ");
    vi.mocked(capture).mockClear();

    await proposalsService.reject(ctx, proposal.id);
    expect(events("proposal_rejected")).toHaveLength(1);
    expect(events("proposal_rejected")[0]).toMatchObject({
      properties: { project_id: projectId, proposal_id: proposal.id },
    });

    vi.mocked(capture).mockClear();
    await expect(proposalsService.reject(ctx, proposal.id)).rejects.toBeInstanceOf(ConflictError);
    await expect(proposalsService.accept(ctx, { id: proposal.id })).rejects.toBeInstanceOf(ConflictError);
    expect(events()).toEqual([]);
  });

  it("keeps Evidence text, excerpts, titles and Assumption statements out of every payload", async () => {
    const { proposal } = await projectWithOneProposal("PII");
    await proposalsService.accept(ctx, { id: proposal.id });

    const payload = JSON.stringify(events());
    for (const secret of [SENTENCE, proposal.title, proposal.chosen, "Minutes"]) {
      expect(payload).not.toContain(secret);
    }
  });
});

describe("what counts as an edit", () => {
  const proposed = {
    id: "proposal-1",
    projectId: "project-1",
    extractor: "heuristic",
    title: "Switch to interviews",
    decidedOn: null,
    context: null,
    chosen: "Fortnightly interviews",
    alternatives: "Weekly surveys",
    revisitWhen: null,
    sources: [{ kind: "evidence", entityId: "evidence-1", excerpt: SENTENCE }],
    assumptions: [
      { statement: "Priya stays on the project", subtype: "person", targetType: "person", targetId: "person-1" },
    ],
  } as unknown as ProposalRow;
  const baseline = asSubmitted(proposed);

  it("is false for the Proposal as it stands, stamped with the date a one-click accept would use", () => {
    expect(editedBeforeAccept(proposed, baseline)).toBe(false);
    expect(editedBeforeAccept(proposed, { ...baseline, decidedOn: "2026-09-22" }, "2026-09-22")).toBe(false);
  });

  it("is true when the PM changes or adds what the Proposal did not state", () => {
    expect(editedBeforeAccept(proposed, { ...baseline, ownerId: "person-2" })).toBe(true);
    expect(editedBeforeAccept(proposed, { ...baseline, supersedesId: "decision-1" })).toBe(true);
    // A date the PM chose, rather than the one the accept path would have stamped.
    expect(editedBeforeAccept(proposed, { ...baseline, decidedOn: "2025-01-05" }, "2026-09-22")).toBe(true);
    const dated = { ...proposed, decidedOn: "2026-09-10" } as ProposalRow;
    expect(editedBeforeAccept(dated, { ...baseline, decidedOn: "2026-09-11" })).toBe(true);
    expect(editedBeforeAccept(dated, { ...baseline, decidedOn: "2026-09-10" })).toBe(false);
    expect(editedBeforeAccept(proposed, { ...baseline, context: "Response rates fell to 4%" })).toBe(true);
    expect(editedBeforeAccept(proposed, { ...baseline, alternatives: null })).toBe(true);
    expect(editedBeforeAccept(proposed, { ...baseline, assumptions: [] })).toBe(true);
    expect(
      editedBeforeAccept(proposed, {
        ...baseline,
        assumptions: [{ ...baseline.assumptions[0]!, statement: "Priya stays until UAT" }],
      }),
    ).toBe(true);
    expect(
      editedBeforeAccept(proposed, {
        ...baseline,
        sources: [{ kind: "evidence", entityId: "evidence-2", excerpt: SENTENCE }],
      }),
    ).toBe(true);
    // One Source whose excerpt spells out another entry must not read as two Sources.
    expect(
      editedBeforeAccept({ ...proposed, sources: [...proposed.sources, { ...proposed.sources[0]!, excerpt: OTHER }] }, {
        ...baseline,
        sources: [{ ...proposed.sources[0]!, excerpt: `${SENTENCE}\nevidence|evidence-1||${OTHER}` }],
      } as never),
    ).toBe(true);
  });

  it("does not fail a committed acceptance when the stored Proposal is malformed", async () => {
    const broken = { ...proposed, sources: null } as unknown as ProposalRow;
    await expect(proposalAccepted(ctx, broken, baseline)).resolves.toBeUndefined();
    expect(() => editedBeforeAccept(broken, baseline)).toThrow();
  });
});

describe("item Proposals (#114)", () => {
  const NOTES = "Action item: Book the usability lab\nMilestone: Pilot readout on 2026-10-20.";

  it("records created Tasks and Milestones with counts only, and stays silent when nothing is new", async () => {
    const project = await makeProject(ctx, "IGN");
    await evidenceService.create(ctx, { projectId: project.id, title: "Minutes", kind: "minutes", body: NOTES });
    await proposalsService.runPass(ctx, project.id, { extract: heuristicExtract, trigger: "manual" });

    expect(events("item_proposal_generated")).toEqual([
      {
        userId: ctx.userId,
        event: "item_proposal_generated",
        properties: {
          project_id: project.id,
          trigger: "manual",
          extractor: "heuristic",
          task_count: 1,
          milestone_count: 1,
          source_count: 1,
          discarded_count: 0,
        },
      },
    ]);
    // Nothing decided in the notes, so the Decision side stays silent too.
    expect(events("proposal_generated")).toEqual([]);

    vi.mocked(capture).mockClear();
    await proposalsService.runPass(ctx, project.id, { extract: heuristicExtract, trigger: "manual" });
    expect(events()).toEqual([]);
  });

  it("records a rejection once, with the kind and no content", async () => {
    const project = await makeProject(ctx, "IRE");
    await evidenceService.create(ctx, { projectId: project.id, title: "Minutes", kind: "minutes", body: NOTES });
    await proposalsService.runPass(ctx, project.id, { extract: heuristicExtract, trigger: "manual" });
    const milestone = (await proposalsService.listPendingItems(ctx, project.id)).find((p) => p.kind === "milestone")!;
    vi.mocked(capture).mockClear();

    await proposalsService.rejectItem(ctx, milestone.id);
    await expect(proposalsService.rejectItem(ctx, milestone.id)).rejects.toBeInstanceOf(ConflictError);
    expect(events()).toEqual([
      {
        userId: ctx.userId,
        event: "item_proposal_rejected",
        properties: { project_id: project.id, proposal_id: milestone.id, kind: "milestone", extractor: "heuristic" },
      },
    ]);
  });
});

describe("item Proposal acceptance (#115)", () => {
  const NOTES = "Action item: Book the usability lab\nMilestone: Pilot readout on 2026-10-20.";
  const setup = async (key: string) => {
    const project = await makeProject(ctx, key);
    await evidenceService.create(ctx, { projectId: project.id, title: "Minutes", kind: "minutes", body: NOTES });
    await proposalsService.runPass(ctx, project.id, { extract: heuristicExtract, trigger: "manual" });
    const pending = await proposalsService.listPendingItems(ctx, project.id);
    vi.mocked(capture).mockClear();
    return {
      projectId: project.id,
      task: pending.find((p) => p.kind === "task")!,
      milestone: pending.find((p) => p.kind === "milestone")!,
    };
  };
  const accepted = (projectId: string, proposalId: string, kind: string, edited: boolean) => ({
    userId: ctx.userId,
    event: "item_proposal_accepted",
    properties: {
      project_id: projectId,
      proposal_id: proposalId,
      kind,
      extractor: "heuristic",
      edited_before_accept: edited,
    },
  });

  it("records a one-click accept and an untouched dialog save as unedited, with the kind and no content", async () => {
    const { projectId, task, milestone } = await setup("IAC");
    await proposalsService.acceptItem(ctx, { id: task.id });
    const defaultStatus = await statusesService.resolveForNewItem(ctx.db, projectId, "milestone", undefined);
    // The dialog always posts the default Status.
    const dialog = milestone.acceptInput!;
    await proposalsService.acceptItem(ctx, {
      id: milestone.id,
      input: { ...dialog, input: { ...dialog.input, statusId: defaultStatus.id } } as typeof dialog,
    });
    expect(events()).toEqual([
      accepted(projectId, task.id, "task", false),
      accepted(projectId, milestone.id, "milestone", false),
    ]);
  });

  it("records a changed title as edited", async () => {
    const { projectId, task } = await setup("IAE");
    const base = task.acceptInput!;
    await proposalsService.acceptItem(ctx, {
      id: task.id,
      input: { ...base, input: { ...base.input, title: "Book lab B" } } as typeof base,
    });
    expect(events()).toEqual([accepted(projectId, task.id, "task", true)]);
  });
});

describe("what counts as an item edit", () => {
  const base = {
    kind: "task" as const,
    input: {
      projectId: "p",
      title: "Book the lab",
      description: null,
      priority: "none" as const,
      assigneeId: null,
      milestoneId: null,
      startDate: null,
      dueDate: "2026-10-10",
    },
  };
  const edit = (patch: object) =>
    itemEditedBeforeAccept(base, { ...base, input: { ...base.input, ...patch } }, "s-default");

  it("is false for the input as it stands, whitespace and empty strings included", () => {
    expect(edit({})).toBe(false);
    expect(edit({ title: " Book the lab ", description: "", statusId: "s-default", labelIds: [] })).toBe(false);
  });

  it("is true for a changed field or one the Proposal never stated", () => {
    expect(edit({ dueDate: "2026-10-11" })).toBe(true);
    expect(edit({ assigneeId: "person" })).toBe(true);
    expect(edit({ priority: "high" })).toBe(true);
    expect(edit({ teamId: "team" })).toBe(true);
    expect(edit({ estimateHours: 2 })).toBe(true);
    expect(edit({ labelIds: ["l"] })).toBe(true);
    expect(edit({ statusId: "s-started" })).toBe(true);
  });
});
