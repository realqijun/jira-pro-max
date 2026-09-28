import { createHash } from "node:crypto";
import { getToolName, isToolUIPart, type UIMessage } from "ai";
import type { Ctx } from "@/server/core/context";
import { ConflictError, NotFoundError } from "@/server/core/errors";
import { conversationsRepo, messagesRepo } from "@/server/modules/assistant/repository";
import { commentsRepo } from "@/server/modules/comments/repository";
import { decisionsService } from "@/server/modules/decisions/service";
import type { CreateDecisionInput } from "@/server/modules/decisions/validation";
import { transcriptText } from "@/server/modules/evidence/passages";
import { evidenceRepo, passagesRepo } from "@/server/modules/evidence/repository";
import { evidenceText } from "@/server/modules/evidence/service";
import { milestonesRepo } from "@/server/modules/milestones/repository";
import { peopleRepo } from "@/server/modules/people/repository";
import { assertOwnsProject } from "@/server/modules/projects/service";
import { tasksRepo } from "@/server/modules/tasks/repository";
import type { ProposalExtractor } from "@/shared/domain";
import { proposalGenerated, proposalRejected, today, type PassTrigger } from "./analytics";
import { pickExtractor, type Extract, type ExtractSource } from "./extract";
import { passSourcesRepo, proposalsRepo } from "./repository";
import type { ProposalRow } from "./schema";
import { attachPassages, traceProposals, type TraceRefs } from "./trace";

export type PassOutcome =
  | { skipped: "not_configured" | "nothing_new" | "failed"; proposalId?: string }
  | {
      extractor: ProposalExtractor;
      sourcesPassed: number;
      proposed: number;
      discarded: number;
      proposalId?: string;
    };

const hashOf = (text: string) => createHash("sha1").update(text).digest("hex");

const transcriptOf = (messages: UIMessage[]) =>
  messages
    .map((m) => {
      const text = m.parts
        .map((p) => (p.type === "text" ? p.text : isToolUIPart(p) ? `[${getToolName(p)}]` : ""))
        .filter(Boolean)
        .join(" ");
      return `${m.role}: ${text}`;
    })
    .join("\n");

/** Overrides the PM may apply on a one-click accept (the dialog path posts a full form instead). */
export type AcceptOverrides = Partial<
  Pick<CreateDecisionInput, "title" | "decidedOn" | "ownerId" | "context" | "chosen" | "alternatives" | "revisitWhen">
>;

/**
 * The Proposal pass (issue #39, ADR 0008): reads Evidence and Comments not yet passed, asks
 * an extractor for Decision candidates, keeps only traceable ones and stores them pending.
 * Never writes to the graph; `accept` does, through `decisionsService` under `via: "assistant"`.
 */
export const proposalsService = {
  /** True when a pass can run at all (a model is configured or the heuristic is selected). */
  enabled: async (ctx: Ctx) => (await pickExtractor(ctx)) !== null,

  /** `trigger` is required: an unnamed trigger is the mis-attribution this funnel exists to end. */
  runPass: async (
    ctx: Ctx,
    projectId: string,
    opts: { trigger: PassTrigger; extract?: Extract },
  ): Promise<PassOutcome> => {
    await assertOwnsProject(ctx.db, ctx.userId, projectId);
    const picked = await pickExtractor(ctx);
    const extract = opts.extract ?? picked?.extract;
    const extractorName: ProposalExtractor = opts.extract ? "heuristic" : (picked?.name ?? "heuristic");
    if (!extract) return { skipped: "not_configured" };

    const [evidence, comments, passed, passages] = await Promise.all([
      evidenceRepo.listByProject(ctx.db, projectId),
      commentsRepo.listByProject(ctx.db, projectId),
      passSourcesRepo.listForProject(ctx.db, projectId),
      passagesRepo.listForProject(ctx.db, projectId),
    ]);
    const passagesByEvidence = new Map<string, typeof passages>();
    for (const p of passages)
      passagesByEvidence.set(p.evidenceId, [...(passagesByEvidence.get(p.evidenceId) ?? []), p]);
    const seen = new Map(passed.map((p) => [`${p.kind}:${p.entityId}`, p.textHash]));
    const candidates: Array<ExtractSource & { textHash: string }> = [];
    // Transcripts first: they carry the stated reasoning (issue #42). The hash stays on the raw text so
    // "already read" is independent of segmentation; the extractor reads label-free Passage text so its
    // excerpts sit inside one Passage.
    const ordered = [...evidence].sort((a, b) => Number(b.kind === "transcript") - Number(a.kind === "transcript"));
    for (const e of ordered) {
      const raw = evidenceText(e).trim();
      if (!raw) continue;
      const textHash = hashOf(raw);
      if (seen.get(`evidence:${e.id}`) === textHash) continue;
      const own = passagesByEvidence.get(e.id);
      const text = own?.length ? transcriptText(own) : raw;
      candidates.push({ kind: "evidence", entityId: e.id, title: e.title, evidenceKind: e.kind, text, textHash });
    }
    for (const c of comments) {
      const text = c.body.trim();
      if (!text) continue;
      const textHash = hashOf(text);
      if (seen.get(`comment:${c.id}`) === textHash) continue;
      candidates.push({
        kind: "comment",
        entityId: c.id,
        title: `Comment${c.saidByName ? ` by ${c.saidByName}` : ""}`,
        text,
        textHash,
      });
    }
    // A manual pass ends in review: it points at the newest pending Proposal, whichever pass raised it.
    const firstPending = async () =>
      opts.trigger === "manual" ? (await proposalsRepo.listByProject(ctx.db, projectId, "pending"))[0]?.id : undefined;
    if (!candidates.length) {
      const proposalId = await firstPending();
      return proposalId ? { skipped: "nothing_new", proposalId } : { skipped: "nothing_new" };
    }

    const [people, milestones, tasks, conversation] = await Promise.all([
      peopleRepo.listByProject(ctx.db, projectId),
      milestonesRepo.listByProject(ctx.db, projectId),
      tasksRepo.listByProject(ctx.db, projectId),
      conversationsRepo
        .latest(ctx.db, ctx.userId, projectId)
        .then((c) => c ?? conversationsRepo.create(ctx.db, ctx.userId, projectId)),
    ]);
    const recent = (await messagesRepo.listByConversation(ctx.db, conversation.id)).slice(-12);
    const refs: TraceRefs = {
      people: people.map((p) => ({ id: p.id, name: p.name })),
      milestones: milestones.map((m) => ({ id: m.milestone.id, name: m.milestone.name })),
      tasks: tasks.map((t) => ({ id: t.task.id, title: t.task.title })),
    };

    let raw: Awaited<ReturnType<Extract>>;
    try {
      raw = await extract({
        sources: candidates.map(({ kind, entityId, title, evidenceKind, text }) => ({
          kind,
          entityId,
          title,
          evidenceKind,
          text,
        })),
        context: {
          people: refs.people.map((p) => p.name),
          milestones: refs.milestones.map((m) => m.name),
          tasks: refs.tasks.map((t) => t.title),
          conversation: transcriptOf(recent.map((r) => ({ id: r.id, role: r.role, parts: r.parts }) as UIMessage)),
        },
        telemetry: {
          userId: ctx.userId,
          properties: { project_id: projectId, trigger: opts.trigger, source_count: candidates.length },
        },
      });
    } catch (e) {
      console.error("Proposal pass failed", e);
      return { skipped: "failed" };
    }
    const traced = traceProposals(raw.proposals, candidates, refs);
    const kept = attachPassages(traced.kept, passagesByEvidence);
    const { discarded } = traced;

    // Pass bookkeeping and the new Proposals land together, after the extractor returned. Two
    // passes racing on one Project (two quick saves) are safe: the unique keys absorb the loser.
    const inserted = await ctx.db.transaction(async (tx) => {
      await passSourcesRepo.upsertMany(
        tx,
        candidates.map((c) => ({ projectId, kind: c.kind, entityId: c.entityId, textHash: c.textHash })),
      );
      return proposalsRepo.insertMany(
        tx,
        kept.map((k) => ({ ...k, projectId, extractor: extractorName })),
      );
    });
    const outcome = {
      extractor: extractorName,
      sourcesPassed: candidates.length,
      proposed: inserted.length,
      discarded,
    };
    await proposalGenerated(ctx, {
      ...outcome,
      projectId,
      trigger: opts.trigger,
      sourceKinds: {
        evidence: candidates.filter((c) => c.kind === "evidence").length,
        comment: candidates.filter((c) => c.kind === "comment").length,
      },
    });
    const proposalId = opts.trigger === "manual" ? await firstPending() : inserted[0]?.id;
    return proposalId ? { ...outcome, proposalId } : outcome;
  },

  listPending: async (ctx: Ctx, projectId: string) => {
    await assertOwnsProject(ctx.db, ctx.userId, projectId);
    return proposalsRepo.listByProject(ctx.db, projectId, "pending");
  },

  get: async (ctx: Ctx, id: string): Promise<ProposalRow> => {
    const p = await proposalsRepo.findById(ctx.db, id);
    if (!p) throw new NotFoundError("Proposal");
    await assertOwnsProject(ctx.db, ctx.userId, p.projectId);
    return p;
  },

  /** One-click accept: the Proposal becomes a Decision through the normal service, attributed to the Assistant. */
  accept: async (ctx: Ctx, { id, overrides = {} }: { id: string; overrides?: AcceptOverrides }) => {
    const p = await proposalsService.get(ctx, id);
    if (p.status !== "pending") throw new ConflictError("That proposal was already resolved");
    return decisionsService.create(
      { ...ctx, via: "assistant" },
      {
        projectId: p.projectId,
        title: p.title,
        decidedOn: p.decidedOn ?? today(),
        context: p.context,
        chosen: p.chosen,
        alternatives: p.alternatives,
        revisitWhen: p.revisitWhen,
        ...overrides,
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
      },
    );
  },

  reject: async (ctx: Ctx, id: string) => {
    const p = await proposalsService.get(ctx, id);
    const [row] = await proposalsRepo.markRejected(ctx.db, p.id);
    if (!row) throw new ConflictError("That proposal was already resolved");
    await proposalRejected(ctx, row);
    return row;
  },

  /**
   * Extraction-quality metric per Project: `proposed` is everything ever raised; `rate` is
   * accepted over the Proposals the PM has acted on, so pending ones do not drag it down.
   */
  stats: async (ctx: Ctx, projectId: string) => {
    await assertOwnsProject(ctx.db, ctx.userId, projectId);
    const counts = await proposalsRepo.countsByStatus(ctx.db, projectId);
    const proposed = counts.pending + counts.accepted + counts.rejected;
    const decided = counts.accepted + counts.rejected;
    return { ...counts, proposed, decided, rate: decided ? counts.accepted / decided : null };
  },
};
