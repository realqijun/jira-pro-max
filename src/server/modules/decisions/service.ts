import type { Ctx } from "@/server/core/context";
import { compactPatch, diffFields, type FieldChange } from "@/server/core/diff";
import { ConflictError, NotFoundError, ValidationError } from "@/server/core/errors";
import { mutate, type Recorder } from "@/server/core/mutation";
import { nextNumber } from "@/server/core/sequence";
import type { DbOrTx, Tx } from "@/server/db/client";
import { activityRepo } from "@/server/modules/activity/service";
import { proposalAccepted } from "@/server/modules/proposals/analytics";
import { proposalsRepo } from "@/server/modules/proposals/repository";
import { risksRepo } from "@/server/modules/risks/repository";
import { commentsRepo } from "@/server/modules/comments/repository";
import { wouldCreateCycle } from "@/server/modules/dependencies/graph";
import { dependenciesRepo } from "@/server/modules/dependencies/repository";
import { evidenceRepo, passagesRepo } from "@/server/modules/evidence/repository";
import { milestonesRepo } from "@/server/modules/milestones/repository";
import { assertPersonInProject } from "@/server/modules/people/service";
import { assertOwnsProject } from "@/server/modules/projects/service";
import { tasksRepo } from "@/server/modules/tasks/repository";
import { SOURCE_EXCERPT_MAX, labelFor } from "@/shared/domain";
import { firstLine, passageWhere } from "@/shared/lib/text";
import { decisionHref, evidenceHref } from "@/shared/lib/hrefs";
import { citation, queryTerms, rankDecisions, rankEvidence, sourceHref } from "./answers";
import { assumptionsRepo, decisionsRepo, edgesRepo, sourceCandidatesRepo, sourcesRepo } from "./repository";
import {
  decisions,
  type AssumptionRow,
  type DecisionRow,
  type DecisionSourceRow,
  type NewDecisionSourceRow,
} from "./schema";
import {
  assumptionFieldErrors,
  type AttachAssumptionInput,
  type BreakAssumptionInput,
  type ConsequenceInput,
  type SearchDecisionsInput,
  type CreateAssumptionInput,
  type CreateDecisionInput,
  type SourceInput,
  type SupersedeDecisionInput,
  type UpdateDecisionInput,
} from "./validation";

const LABEL_MAX = 120;

async function getOwned(db: DbOrTx, userId: string, id: string): Promise<DecisionRow> {
  const d = await decisionsRepo.findById(db, id);
  if (!d) throw new NotFoundError("Decision");
  await assertOwnsProject(db, userId, d.projectId);
  return d;
}

async function getOwnedAssumption(db: DbOrTx, userId: string, id: string): Promise<AssumptionRow> {
  const a = await assumptionsRepo.findById(db, id);
  if (!a) throw new NotFoundError("Assumption");
  await assertOwnsProject(db, userId, a.projectId);
  return a;
}

/**
 * Turn Source inputs into rows: each must live in this Project, and `label` / `excerpt` are
 * snapshots computed here, never trusted from the caller (ADR 0008).
 */
async function resolveSources(
  tx: Tx,
  projectId: string,
  inputs: SourceInput[],
): Promise<Omit<NewDecisionSourceRow, "decisionId" | "edgeId">[]> {
  if (!inputs.length) throw new ValidationError("Add at least one source", { sources: ["Add at least one source"] });
  const bad = () =>
    new ValidationError("Source is not in this project", { sources: ["Source is not in this project"] });
  const seen = new Set<string>();
  const out: Omit<NewDecisionSourceRow, "decisionId" | "edgeId">[] = [];
  for (const s of inputs) {
    const key = `${s.kind}:${s.entityId}:${s.passageId ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // `passageId` is valid only for Evidence (ADR 0008); other kinds never store one.
    const base = { projectId, kind: s.kind, entityId: s.entityId, passageId: null };
    // A caller-supplied excerpt is kept only when it really occurs in the Source text.
    const quoted = (text: string) => {
      const q = s.excerpt?.replace(/\s+/g, " ").trim();
      return q && text.replace(/\s+/g, " ").toLowerCase().includes(q.toLowerCase())
        ? q.slice(0, SOURCE_EXCERPT_MAX)
        : firstLine(text, SOURCE_EXCERPT_MAX);
    };
    if (s.kind === "evidence") {
      const e = await evidenceRepo.findById(tx, s.entityId);
      if (!e || e.projectId !== projectId) throw bad();
      // A Passage of another Evidence is a bad request; one that no longer exists (re-segmented since the
      // caller saw it) degrades to the whole Evidence, so a Proposal accept never fails on it (issue #42).
      const passage = s.passageId ? await passagesRepo.findById(tx, s.passageId) : undefined;
      if (passage && passage.evidenceId !== e.id) {
        throw new ValidationError("Passage is not in this source", { sources: ["Passage is not in this source"] });
      }
      if (passage) {
        out.push({
          ...base,
          passageId: passage.id,
          label: `${e.title} · ${passageWhere(passage)}`,
          excerpt: quoted(passage.text),
        });
      } else {
        const text = e.body ?? e.extractedText ?? e.notes ?? "";
        out.push({ ...base, passageId: null, label: e.title, excerpt: quoted(text) });
      }
    } else if (s.kind === "comment") {
      const c = await commentsRepo.findById(tx, s.entityId);
      if (!c || c.projectId !== projectId) throw bad();
      const who = c.saidByName ? `${c.saidByName}: ` : "";
      out.push({ ...base, label: firstLine(`${who}${c.body}`, LABEL_MAX), excerpt: quoted(c.body) });
    } else {
      const ev = await activityRepo.findById(tx, s.entityId);
      if (!ev || ev.projectId !== projectId) throw bad();
      if (ev.entityType === "decision") {
        throw new ValidationError("A decision cannot cite another decision", {
          sources: ["Decision events cannot be cited"],
        });
      }
      const what = ev.field ? `${labelFor(ev.field)} changed` : ev.action;
      const label = `${labelFor(ev.entityType)} "${ev.entityLabel}" ${what}`;
      const excerpt = ev.field ? `${JSON.stringify(ev.oldValue)} → ${JSON.stringify(ev.newValue)}` : label;
      out.push({ ...base, label: firstLine(label, LABEL_MAX), excerpt: firstLine(excerpt, SOURCE_EXCERPT_MAX) });
    }
  }
  return out;
}

const copyToEdge = (sources: DecisionSourceRow[], edgeId: string): NewDecisionSourceRow[] =>
  sources.map(({ projectId, kind, entityId, passageId, excerpt, label }) => ({
    projectId,
    edgeId,
    kind,
    entityId,
    passageId,
    excerpt,
    label,
  }));

/** Validate the typed target of an Assumption lives in the Project; returns a display label. */
async function assertTargetInProject(tx: Tx, input: CreateAssumptionInput) {
  const { projectId, subtype, targetType, targetId } = input;
  const shapeErrors = assumptionFieldErrors(input);
  if (Object.keys(shapeErrors).length) throw new ValidationError("Check the assumption target", shapeErrors);
  const invalid = () => new ValidationError("Invalid target", { targetId: ["Not in this project"] });
  if (subtype === "external_rule") return;
  if (targetType === "person") return assertPersonInProject(tx, projectId, targetId, "targetId");
  if (targetType === "task") {
    const t = await tasksRepo.findById(tx, targetId!);
    if (!t || t.projectId !== projectId) throw invalid();
    return;
  }
  if (targetType === "milestone") {
    const m = await milestonesRepo.findById(tx, targetId!);
    if (!m || m.projectId !== projectId) throw invalid();
    return;
  }
  const dep = await dependenciesRepo.findById(tx, targetId!);
  if (!dep || dep.projectId !== projectId) throw invalid();
}

async function supportedStatements(tx: Tx, decisionId: string) {
  const edges = await edgesRepo.listToKind(tx, "supports", decisionId);
  if (!edges.length) return [] as string[];
  const rows = await assumptionsRepo.listByIds(
    tx,
    edges.map((e) => e.fromId),
  );
  return rows.map((a) => a.statement);
}

async function attach(tx: Tx, rec: Recorder, decision: DecisionRow, assumption: AssumptionRow) {
  const before = await supportedStatements(tx, decision.id);
  const edge = await edgesRepo.insertIgnore(tx, {
    projectId: decision.projectId,
    kind: "supports",
    fromType: "assumption",
    fromId: assumption.id,
    toType: "decision",
    toId: decision.id,
  });
  // A concurrent attach already won; the edge exists, nothing to record.
  if (!edge) return edgesRepo.find(tx, "supports", assumption.id, decision.id);
  const sources = await sourcesRepo.listForDecisions(tx, [decision.id]);
  await sourcesRepo.insertMany(tx, copyToEdge(sources, edge.id));
  rec.updated("decision", decision.projectId, decision.id, decision.title, [
    { field: "assumptions", oldValue: before, newValue: [...before, assumption.statement] },
  ]);
  return edge;
}

/** Validate, insert and attach one Assumption to a Decision (shared by the create paths). */
async function createAndAttach(tx: Tx, rec: Recorder, decision: DecisionRow, input: CreateAssumptionInput) {
  await assertTargetInProject(tx, input);
  const { decisionId: _decisionId, ...values } = input;
  void _decisionId;
  const assumption = await assumptionsRepo.insert(tx, {
    ...values,
    targetType: values.targetType ?? null,
    targetId: values.targetId ?? null,
    targetField: values.targetField ?? null,
    assumedUntil: values.assumedUntil ?? null,
  });
  rec.created("assumption", input.projectId, assumption.id, firstLine(assumption.statement, LABEL_MAX));
  await attach(tx, rec, decision, assumption);
  return assumption;
}

/** Delete an Assumption that no longer supports any Decision. */
async function deleteIfOrphan(tx: Tx, rec: Recorder, assumption: AssumptionRow) {
  const remaining = await edgesRepo.listFrom(tx, "supports", assumption.id);
  if (remaining.length) return false;
  await edgesRepo.deleteForNode(tx, assumption.id);
  await assumptionsRepo.delete(tx, assumption.id);
  rec.deleted("assumption", assumption.projectId, assumption.id, firstLine(assumption.statement, LABEL_MAX));
  return true;
}

/** Display label of a `leads_to` target, verifying it lives in the Project. */
async function consequenceLabel(tx: Tx, projectId: string, type: ConsequenceInput["targetType"], id: string) {
  const invalid = () => new ValidationError("Item not in this project", { targetId: ["Not in this project"] });
  if (type === "task") {
    const t = await tasksRepo.findById(tx, id);
    if (!t || t.projectId !== projectId) throw invalid();
    return t.title;
  }
  if (type === "milestone") {
    const m = await milestonesRepo.findById(tx, id);
    if (!m || m.projectId !== projectId) throw invalid();
    return m.name;
  }
  const r = await risksRepo.findById(tx, id);
  if (!r || r.projectId !== projectId) throw invalid();
  return r.title;
}

async function consequenceLabels(tx: Tx, decision: DecisionRow) {
  const edges = await edgesRepo.listFrom(tx, "leads_to", decision.id);
  const labels: string[] = [];
  for (const e of edges) {
    labels.push(
      await consequenceLabel(tx, decision.projectId, e.toType as ConsequenceInput["targetType"], e.toId).catch(
        () => `${labelFor(e.toType)} (deleted)`,
      ),
    );
  }
  return labels;
}

const statusChange = (from: DecisionRow["status"], to: DecisionRow["status"]): FieldChange[] => [
  { field: "status", oldValue: from, newValue: to },
];

/** Link `older` as superseded by `newer`; both already ownership-checked and in the same Project. */
async function linkSupersedes(tx: Tx, rec: Recorder, newer: DecisionRow, olderId: string | null) {
  const current = (await edgesRepo.listToKind(tx, "superseded_by", newer.id))[0];
  if (current?.fromId === olderId) return;
  if (current) {
    const older = await decisionsRepo.findById(tx, current.fromId);
    await edgesRepo.delete(tx, current.id);
    if (older && older.status === "superseded") {
      await decisionsRepo.update(tx, older.id, { status: "active" });
      rec.updated("decision", older.projectId, older.id, older.title, statusChange("superseded", "active"));
    }
    rec.updated("decision", newer.projectId, newer.id, newer.title, [
      { field: "supersedes", oldValue: older?.title ?? null, newValue: null },
    ]);
  }
  if (!olderId) return;
  if (olderId === newer.id)
    throw new ValidationError("A decision cannot supersede itself", { supersedesId: ["Invalid"] });
  const older = await decisionsRepo.findById(tx, olderId);
  if (!older || older.projectId !== newer.projectId) {
    throw new ValidationError("Decision not in this project", { supersedesId: ["Invalid"] });
  }
  const existing = await edgesRepo.listFrom(tx, "superseded_by", older.id);
  if (existing.length) throw new ConflictError(`"${older.title}" is already superseded by another decision`);
  const all = await edgesRepo.listByKind(tx, newer.projectId, "superseded_by");
  const edges = all.map((e) => ({ predecessorId: e.fromId, successorId: e.toId }));
  if (wouldCreateCycle(edges, older.id, newer.id)) {
    throw new ConflictError(`"${older.title}" already comes after "${newer.title}" - that would be a cycle`);
  }
  const edge = await edgesRepo.insertIgnore(tx, {
    projectId: newer.projectId,
    kind: "superseded_by",
    fromType: "decision",
    fromId: older.id,
    toType: "decision",
    toId: newer.id,
  });
  if (!edge) throw new ConflictError(`"${older.title}" is already superseded by another decision`);
  const sources = await sourcesRepo.listForDecisions(tx, [newer.id]);
  await sourcesRepo.insertMany(tx, copyToEdge(sources, edge.id));
  await decisionsRepo.update(tx, older.id, { status: "superseded" });
  rec.updated("decision", older.projectId, older.id, older.title, statusChange(older.status, "superseded"));
  rec.updated("decision", newer.projectId, newer.id, newer.title, [
    { field: "supersedes", oldValue: null, newValue: older.title },
  ]);
}

/** Upper bound on Evidence rows loaded for the "nearest Evidence" fallback of `search`. */
const EVIDENCE_CANDIDATES = 50;

/** Sources plus the joined citation the model appends after each claim about the Decision. */
const cited = <S extends { cite: string }>(sources: S[]) => ({
  sources,
  sourceCitations: sources.map((s) => s.cite).join(" "),
});

export const decisionsService = {
  /** Decisions with owner, their Assumptions, Sources and supersede links, newest first. */
  list: async (ctx: Ctx, projectId: string) => {
    await assertOwnsProject(ctx.db, ctx.userId, projectId);
    const [rows, assumptions, edges] = await Promise.all([
      decisionsRepo.listByProject(ctx.db, projectId),
      assumptionsRepo.listByProject(ctx.db, projectId),
      edgesRepo.listByProject(ctx.db, projectId),
    ]);
    const decisionSources = await sourcesRepo.listForDecisions(
      ctx.db,
      rows.map((r) => r.decision.id),
    );
    const byId = new Map(assumptions.map((a) => [a.id, a]));
    return rows.map(({ decision, owner }) => ({
      decision,
      owner,
      assumptions: edges
        .filter((e) => e.kind === "supports" && e.toId === decision.id)
        .map((e) => byId.get(e.fromId))
        .filter((a): a is AssumptionRow => Boolean(a)),
      sources: decisionSources.filter((s) => s.decisionId === decision.id),
      supersededById: edges.find((e) => e.kind === "superseded_by" && e.fromId === decision.id)?.toId ?? null,
      supersedesId: edges.find((e) => e.kind === "superseded_by" && e.toId === decision.id)?.fromId ?? null,
      consequences: edges
        .filter((e) => e.kind === "leads_to" && e.fromId === decision.id)
        .map((e) => ({ type: e.toType as ConsequenceInput["targetType"], id: e.toId })),
    }));
  },

  get: (ctx: Ctx, id: string) => getOwned(ctx.db, ctx.userId, id),

  /**
   * "Why did we" read model (issue #40): confirmed Decisions matching the question, each with
   * its Sources linked, or the nearest Evidence when nothing matches. Pending Proposals live in
   * their own table and are never read here.
   */
  search: async (ctx: Ctx, { projectId, query, limit }: SearchDecisionsInput) => {
    await assertOwnsProject(ctx.db, ctx.userId, projectId);
    const items = await decisionsService.list(ctx, projectId);
    const terms = queryTerms(query);
    const ranked = rankDecisions(items, terms).slice(0, limit);
    const sources = ranked.flatMap((r) => r.sources);
    const [comments, events] = await Promise.all([
      commentsRepo.findByIds(
        ctx.db,
        sources.filter((s) => s.kind === "comment").map((s) => s.entityId),
      ),
      activityRepo.findByIds(
        ctx.db,
        sources.filter((s) => s.kind === "activity_event").map((s) => s.entityId),
      ),
    ]);
    const lookups = {
      comments: new Map(comments.map((c) => [c.id, c])),
      events: new Map(events.map((e) => [e.id, e])),
    };
    const byId = new Map(items.map((r) => [r.decision.id, r]));
    const ref = (id: string | null) => {
      const r = id ? byId.get(id) : undefined;
      return r
        ? {
            id: r.decision.id,
            number: r.decision.number,
            title: r.decision.title,
            href: decisionHref(projectId, r.decision.id),
            cite: citation(`D-${r.decision.number} ${r.decision.title}`, decisionHref(projectId, r.decision.id)),
          }
        : null;
    };
    const decisions = ranked.map((r) => ({
      id: r.decision.id,
      number: r.decision.number,
      title: r.decision.title,
      href: decisionHref(projectId, r.decision.id),
      cite: citation(`D-${r.decision.number} ${r.decision.title}`, decisionHref(projectId, r.decision.id)),
      status: r.decision.status,
      decidedOn: r.decision.decidedOn,
      owner: r.owner?.name ?? null,
      context: r.decision.context,
      chosen: r.decision.chosen,
      alternatives: r.decision.alternatives,
      revisitWhen: r.decision.revisitWhen,
      supersededBy: ref(r.supersededById),
      supersedes: ref(r.supersedesId),
      assumptions: r.assumptions.map((a) => ({ statement: a.statement, subtype: a.subtype, state: a.state })),
      ...cited(
        r.sources.map((s) => {
          const href = sourceHref(projectId, r.decision.id, s, lookups);
          return { kind: s.kind, label: s.label, excerpt: s.excerpt, href, cite: citation(s.label, href) };
        }),
      ),
    }));
    // Only Evidence that mentions a term is loaded, capped, then ranked in memory.
    const nearestEvidence = decisions.length
      ? []
      : rankEvidence(await evidenceRepo.searchByTerms(ctx.db, projectId, terms, EVIDENCE_CANDIDATES), terms).map(
          (e) => ({
            id: e.id,
            title: e.title,
            kind: e.kind,
            href: evidenceHref(projectId, e.id),
            cite: citation(e.title, evidenceHref(projectId, e.id)),
          }),
        );
    return { decisions, nearestEvidence };
  },

  /** Every Assumption in the Project, for the "attach existing" picker. */
  listAssumptions: async (ctx: Ctx, projectId: string) => {
    await assertOwnsProject(ctx.db, ctx.userId, projectId);
    return assumptionsRepo.listByProject(ctx.db, projectId);
  },

  /** `kind:entityId` (and `evidence:id:passageId` for a cited Passage) to display label for every citable Source. */
  sourceLabels: async (ctx: Ctx, projectId: string) => {
    await assertOwnsProject(ctx.db, ctx.userId, projectId);
    const c = await decisionsService.sourceCandidates(ctx, projectId);
    const out = new Map<string, string>();
    for (const e of c.evidence) {
      out.set(`evidence:${e.id}`, e.title);
      for (const p of e.passages) out.set(`evidence:${e.id}:${p.id}`, `${e.title} · ${passageWhere(p)}`);
    }
    for (const m of c.comments)
      out.set(`comment:${m.id}`, firstLine(`${m.saidByName ? `${m.saidByName}: ` : ""}${m.body}`, LABEL_MAX));
    return out;
  },

  /** What the Source picker can cite; a transcript carries its Passages so a citation can be narrowed (issue #42). */
  sourceCandidates: async (ctx: Ctx, projectId: string) => {
    await assertOwnsProject(ctx.db, ctx.userId, projectId);
    const [base, passages] = await Promise.all([
      sourceCandidatesRepo.list(ctx.db, projectId),
      passagesRepo.listForProject(ctx.db, projectId),
    ]);
    return {
      ...base,
      evidence: base.evidence.map((e) => ({
        ...e,
        passages: passages
          .filter((p) => p.evidenceId === e.id)
          .map(({ id, ordinal, speaker, timestamp, text }) => ({ id, ordinal, speaker, timestamp, text })),
      })),
    };
  },

  /**
   * Create a Decision with its Sources, optionally its typed Assumptions and, when it confirms
   * a Proposal (issue #39), mark that Proposal accepted - all in one transaction.
   */
  create: async (ctx: Ctx, accepted: CreateDecisionInput) => {
    const { sources, supersedesId, proposalId, assumptions = [], ...input } = accepted;
    const { decision, proposal } = await mutate(ctx, async (tx, rec) => {
      await assertOwnsProject(tx, ctx.userId, input.projectId);
      await assertPersonInProject(tx, input.projectId, input.ownerId, "ownerId");
      const resolved = await resolveSources(tx, input.projectId, sources);
      const proposal = proposalId ? await proposalsRepo.findById(tx, proposalId) : null;
      if (proposalId) {
        if (!proposal || proposal.projectId !== input.projectId) throw new NotFoundError("Proposal");
        if (proposal.status !== "pending") throw new ConflictError("That proposal was already resolved");
      }
      const number = await nextNumber(tx, input.projectId, decisions, decisions.number, decisions.projectId);
      const decision = await decisionsRepo.insert(tx, { ...input, number });
      await sourcesRepo.insertMany(
        tx,
        resolved.map((s) => ({ ...s, decisionId: decision.id })),
      );
      rec.created("decision", input.projectId, decision.id, decision.title);
      if (supersedesId) await linkSupersedes(tx, rec, decision, supersedesId);
      for (const a of assumptions) {
        await createAndAttach(tx, rec, decision, { ...a, projectId: input.projectId, decisionId: decision.id });
      }
      if (proposalId) {
        const marked = await proposalsRepo.markAccepted(tx, proposalId, decision.id);
        if (!marked.length) throw new ConflictError("That proposal was already resolved");
      }
      return { decision, proposal };
    });
    // Both accept paths converge here, so the funnel records the acceptance once, after it committed.
    if (proposal) await proposalAccepted(ctx, proposal, accepted);
    return decision;
  },

  update: (ctx: Ctx, { id, sources, ...patch }: UpdateDecisionInput) =>
    mutate(ctx, async (tx, rec) => {
      const before = await getOwned(tx, ctx.userId, id);
      const clean = compactPatch(patch);
      await assertPersonInProject(tx, before.projectId, clean.ownerId, "ownerId");
      if (clean.status && before.status === "superseded") {
        throw new ValidationError("A superseded decision keeps its status until the link is removed", {
          status: ["Superseded"],
        });
      }
      const changes = diffFields(before, clean);
      if (sources) {
        const resolved = await resolveSources(tx, before.projectId, sources);
        const current = await sourcesRepo.listForDecisions(tx, [id]);
        const oldLabels = current.map((s) => s.label);
        const newLabels = resolved.map((s) => s.label);
        if (JSON.stringify(oldLabels) !== JSON.stringify(newLabels)) {
          await sourcesRepo.deleteForDecision(tx, id);
          await sourcesRepo.insertMany(
            tx,
            resolved.map((s) => ({ ...s, decisionId: id })),
          );
          changes.push({ field: "sources", oldValue: oldLabels, newValue: newLabels });
        }
      }
      if (!changes.length) return before;
      const after = Object.keys(clean).length ? await decisionsRepo.update(tx, id, clean) : before;
      rec.updated("decision", before.projectId, id, after.title, changes);
      return after;
    }),

  delete: (ctx: Ctx, id: string) =>
    mutate(ctx, async (tx, rec) => {
      const d = await getOwned(tx, ctx.userId, id);
      const supports = await edgesRepo.listToKind(tx, "supports", id);
      const supersededBy = await edgesRepo.listToKind(tx, "superseded_by", id);
      await edgesRepo.deleteForNode(tx, id);
      await decisionsRepo.delete(tx, id);
      rec.deleted("decision", d.projectId, id, d.title);
      const removed = d;
      for (const e of supersededBy) {
        const older = await decisionsRepo.findById(tx, e.fromId);
        if (older?.status === "superseded") {
          await decisionsRepo.update(tx, older.id, { status: "active" });
          rec.updated("decision", older.projectId, older.id, older.title, statusChange("superseded", "active"));
        }
      }
      for (const e of supports) {
        const a = await assumptionsRepo.findById(tx, e.fromId);
        if (a) await deleteIfOrphan(tx, rec, a);
      }
      return removed;
    }),

  supersede: (ctx: Ctx, { id, supersedesId }: SupersedeDecisionInput) =>
    mutate(ctx, async (tx, rec) => {
      const newer = await getOwned(tx, ctx.userId, id);
      await linkSupersedes(tx, rec, newer, supersedesId);
      return newer;
    }),

  createAssumption: (ctx: Ctx, input: CreateAssumptionInput) =>
    mutate(ctx, async (tx, rec) => {
      const decision = await getOwned(tx, ctx.userId, input.decisionId);
      if (decision.projectId !== input.projectId) throw new NotFoundError("Decision");
      return createAndAttach(tx, rec, decision, input);
    }),

  attachAssumption: (ctx: Ctx, { decisionId, assumptionId }: AttachAssumptionInput) =>
    mutate(ctx, async (tx, rec) => {
      const decision = await getOwned(tx, ctx.userId, decisionId);
      const assumption = await getOwnedAssumption(tx, ctx.userId, assumptionId);
      if (assumption.projectId !== decision.projectId) throw new NotFoundError("Assumption");
      if (await edgesRepo.find(tx, "supports", assumption.id, decision.id)) return assumption;
      await attach(tx, rec, decision, assumption);
      return assumption;
    }),

  detachAssumption: (ctx: Ctx, { decisionId, assumptionId }: AttachAssumptionInput) =>
    mutate(ctx, async (tx, rec) => {
      const decision = await getOwned(tx, ctx.userId, decisionId);
      const assumption = await getOwnedAssumption(tx, ctx.userId, assumptionId);
      const edge = await edgesRepo.find(tx, "supports", assumption.id, decision.id);
      if (!edge) return assumption;
      const before = await supportedStatements(tx, decision.id);
      await edgesRepo.delete(tx, edge.id);
      rec.updated("decision", decision.projectId, decision.id, decision.title, [
        { field: "assumptions", oldValue: before, newValue: before.filter((s) => s !== assumption.statement) },
      ]);
      await deleteIfOrphan(tx, rec, assumption);
      return assumption;
    }),

  /**
   * Mark an Assumption broken. The detector passes the contradicting Activity Event and a
   * reason under `via: "system"`; the PM breaks an external-rule Assumption by hand.
   */
  breakAssumption: (ctx: Ctx, { id, brokenByEventId, reason }: BreakAssumptionInput) =>
    mutate(ctx, async (tx, rec) => {
      const a = await getOwnedAssumption(tx, ctx.userId, id);
      if (a.state === "broken") return a;
      if (a.state === "retired") {
        throw new ValidationError("A retired assumption cannot break", { state: ["Retired"] });
      }
      const patch = compactPatch({
        state: "broken" as const,
        brokenByEventId: brokenByEventId ?? undefined,
        brokenReason: reason ?? undefined,
      });
      const after = await assumptionsRepo.update(tx, id, patch);
      rec.updated("assumption", a.projectId, id, firstLine(a.statement, LABEL_MAX), diffFields(a, patch));
      return after;
    }),

  /** Hide the impact alert. Never touches `state`: a dismissed Assumption stays broken. */
  dismissAlert: (ctx: Ctx, id: string) =>
    mutate(ctx, async (tx, rec) => {
      const a = await getOwnedAssumption(tx, ctx.userId, id);
      if (a.state !== "broken")
        throw new ValidationError("Only a broken assumption has an alert", { state: ["Not broken"] });
      if (a.alertDismissedAt) return a;
      const patch = { alertDismissedAt: new Date() };
      const after = await assumptionsRepo.update(tx, id, patch);
      rec.updated("assumption", a.projectId, id, firstLine(a.statement, LABEL_MAX), diffFields(a, patch));
      return after;
    }),

  /** Record that a Decision leads to a Task, Milestone or Risk (`leads_to` edge with copied Sources). */
  addConsequence: (ctx: Ctx, { decisionId, targetType, targetId }: ConsequenceInput) =>
    mutate(ctx, async (tx, rec) => {
      const decision = await getOwned(tx, ctx.userId, decisionId);
      const label = await consequenceLabel(tx, decision.projectId, targetType, targetId);
      const before = await consequenceLabels(tx, decision);
      const edge = await edgesRepo.insertIgnore(tx, {
        projectId: decision.projectId,
        kind: "leads_to",
        fromType: "decision",
        fromId: decision.id,
        toType: targetType,
        toId: targetId,
      });
      if (!edge) return decision;
      const sources = await sourcesRepo.listForDecisions(tx, [decision.id]);
      await sourcesRepo.insertMany(tx, copyToEdge(sources, edge.id));
      rec.updated("decision", decision.projectId, decision.id, decision.title, [
        { field: "leadsTo", oldValue: before, newValue: [...before, label] },
      ]);
      return decision;
    }),

  removeConsequence: (ctx: Ctx, { decisionId, targetType, targetId }: ConsequenceInput) =>
    mutate(ctx, async (tx, rec) => {
      const decision = await getOwned(tx, ctx.userId, decisionId);
      const edge = await edgesRepo.find(tx, "leads_to", decision.id, targetId);
      if (!edge || edge.toType !== targetType) return decision;
      const before = await consequenceLabels(tx, decision);
      const label = await consequenceLabel(tx, decision.projectId, targetType, targetId).catch(() => targetId);
      await edgesRepo.delete(tx, edge.id);
      rec.updated("decision", decision.projectId, decision.id, decision.title, [
        { field: "leadsTo", oldValue: before, newValue: before.filter((l) => l !== label) },
      ]);
      return decision;
    }),

  retireAssumption: (ctx: Ctx, id: string) =>
    mutate(ctx, async (tx, rec) => {
      const a = await getOwnedAssumption(tx, ctx.userId, id);
      if (a.state === "retired") return a;
      const after = await assumptionsRepo.update(tx, id, { state: "retired" });
      rec.updated("assumption", a.projectId, id, firstLine(a.statement, LABEL_MAX), [
        { field: "state", oldValue: a.state, newValue: "retired" },
      ]);
      return after;
    }),
};

export type DecisionListItem = Awaited<ReturnType<typeof decisionsService.list>>[number];

export type SourceCandidates = Awaited<ReturnType<typeof decisionsService.sourceCandidates>>;
