import { createHash } from "node:crypto";
import { assumptionFieldErrors } from "@/server/modules/decisions/validation";
import { SOURCE_EXCERPT_MAX, type AssumptionTargetType, type ItemProposalKind } from "@/shared/domain";
import type { ExtractSource, RawAssumption, RawProposal } from "./extract";
import type { RawItems, RawTask } from "./extract-items";
import type {
  NewProposalRow,
  ProposedAssumption,
  ProposedMilestoneFields,
  ProposedSource,
  ProposedTaskFields,
} from "./schema";

/**
 * Traceability filter (issue #39): an extractor claim survives only when every cited Source
 * exists in the Project and its excerpt is a verbatim substring of that Source's text.
 * Pure; the pass loads the rows.
 */

export interface TraceRefs {
  people: Array<{ id: string; name: string }>;
  milestones: Array<{ id: string; name: string }>;
  tasks: Array<{ id: string; title: string }>;
}

const LIMITS = { title: 200, chosen: 4000, context: 4000, alternatives: 4000, revisitWhen: 500 } as const;
const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const cap = (v: string | null | undefined, max: number) => {
  const t = v?.trim();
  return t ? (t.length > max ? t.slice(0, max) : t) : null;
};
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Idempotency key: the cited passage only, so a retitled extraction of the same sentence is the same Proposal. */
export const fingerprintOf = (primary: ProposedSource) =>
  createHash("sha1")
    .update(`${primary.kind}:${primary.entityId}|${norm(primary.excerpt)}`)
    .digest("hex");

export function traceSources(raw: RawProposal["sources"], sources: ExtractSource[]): ProposedSource[] | null {
  const out: ProposedSource[] = [];
  for (const s of raw) {
    const src = sources.find((x) => x.kind === s.kind && x.entityId === s.entityId);
    const excerpt = s.excerpt.replace(/\s+/g, " ").trim();
    if (!src || !excerpt || !norm(src.text).includes(norm(excerpt))) return null;
    out.push({ kind: s.kind, entityId: s.entityId, excerpt: excerpt.slice(0, SOURCE_EXCERPT_MAX) });
  }
  return out.length ? out : null;
}

/** Exact normalised match, else a unique containing match; ambiguous names resolve to nothing. */
export const byName = <T extends { id: string }>(rows: T[], name: string | null | undefined, key: (r: T) => string) => {
  if (!name) return undefined;
  const n = norm(name);
  const exact = rows.find((r) => norm(key(r)) === n);
  if (exact) return exact;
  const partial = rows.filter((r) => norm(key(r)).includes(n));
  return partial.length === 1 ? partial[0] : undefined;
};

/** Resolve a proposed Assumption's target by name; null when it cannot be made valid. */
export function traceAssumption(raw: RawAssumption, refs: TraceRefs): ProposedAssumption | null {
  const statement = cap(raw.statement, 500);
  if (!statement) return null;
  let targetType: AssumptionTargetType | null = null;
  let targetId: string | null = null;
  let targetName: string | null = null;
  if (raw.subtype === "person") {
    const p = byName(refs.people, raw.targetName, (r) => r.name);
    if (!p) return null;
    [targetType, targetId, targetName] = ["person", p.id, p.name];
  } else if (raw.subtype === "date") {
    const m = byName(refs.milestones, raw.targetName, (r) => r.name);
    const t = m ? undefined : byName(refs.tasks, raw.targetName, (r) => r.title);
    if (m) [targetType, targetId, targetName] = ["milestone", m.id, m.name];
    else if (t) [targetType, targetId, targetName] = ["task", t.id, t.title];
    else return null;
  } else if (raw.subtype === "dependency") {
    return null;
  }
  const assumedUntil =
    raw.subtype === "date" && raw.assumedUntil && ISO_DATE.test(raw.assumedUntil) ? raw.assumedUntil : null;
  const targetField =
    raw.subtype === "date" ? (targetType === "milestone" ? "dueDate" : (raw.targetField ?? "dueDate")) : null;
  const candidate: ProposedAssumption = {
    statement,
    subtype: raw.subtype,
    targetType,
    targetId,
    targetName,
    targetField,
    assumedUntil,
  };
  const errors = assumptionFieldErrors({ projectId: "", decisionId: "", ...candidate });
  return Object.keys(errors).length ? null : candidate;
}

/**
 * Point each Evidence Source at the transcript Passage its excerpt sits in (issue #42): the first
 * Passage whose normalised text contains the normalised excerpt; none when the excerpt spans
 * Passages or the Evidence has no Passages. Pure.
 */
export function attachPassages<T extends { sources: ProposedSource[] }>(
  proposals: T[],
  passagesByEvidence: Map<string, Array<{ id: string; text: string }>>,
): T[] {
  return proposals.map((p) => ({
    ...p,
    sources: p.sources.map((s) => {
      const passages = s.kind === "evidence" ? passagesByEvidence.get(s.entityId) : undefined;
      if (!passages?.length) return s;
      const q = norm(s.excerpt);
      return { ...s, passageId: passages.find((x) => norm(x.text).includes(q))?.id ?? null };
    }),
  }));
}

export interface TracedProposal extends Omit<NewProposalRow, "projectId" | "extractor" | "assumptions"> {
  fingerprint: string;
  sources: ProposedSource[];
  assumptions: ProposedAssumption[];
}

export interface TracedItem {
  kind: ItemProposalKind;
  fingerprint: string;
  fields: ProposedTaskFields | ProposedMilestoneFields;
  sources: ProposedSource[];
}

/** Title of an existing item or pending item Proposal, for the duplicate check. */
export interface KnownItem {
  kind: ItemProposalKind;
  title: string;
}

const ITEM_LIMITS = { title: 200, name: 160, description: 4000 } as const;

/**
 * Accent-folded, punctuation-free words, so "Café launch plan!" and "cafe launch plan" compare
 * equal.
 */
export const titleWords = (s: string) =>
  norm(s.normalize("NFKD").replace(/\p{M}/gu, ""))
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

/**
 * Idempotency key: item kind, primary Source, its excerpt and the title. The title is in the key
 * because one sentence often commits to two pieces of work ("Alice will draft the spec and Bob
 * will review it"); re-raising a restated title is stopped by `isDuplicateTitle` instead.
 */
export const itemFingerprintOf = (kind: ItemProposalKind, primary: ProposedSource, title: string) =>
  createHash("sha1")
    .update(`${kind}|${primary.kind}:${primary.entityId}|${norm(primary.excerpt)}|${titleWords(title).join(" ")}`)
    .digest("hex");

/**
 * Same item: equal words once accents and punctuation are gone, or one title inside the other
 * when the shorter covers at least 80% of the longer. Containment alone is too loose: "Set up CI
 * pipeline" is not "Set up CI pipeline for the mobile app", and "Do not review design doc" is not
 * "Review design doc".
 */
export function isDuplicateTitle(a: string, b: string) {
  const [x, y] = [titleWords(a), titleWords(b)];
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (!short.length) return false;
  if (short.length / long.length < 0.8) return false;
  return ` ${long.join(" ")} `.includes(` ${short.join(" ")} `);
}

/** A real calendar date in ISO form; "2026-02-30" has the shape but no day. */
const isoOrNull = (v: string | null | undefined) => {
  if (!v || !ISO_DATE.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v ? v : null;
};

/** A start date after the due date is dropped; either date missing keeps the start as it is. */
export const startOnOrBeforeDue = (start: string | null, due: string | null) =>
  start && due && start > due ? null : start;

/** Resolve a name to `[id, canonical name]`; an unresolved name stays as the extractor wrote it. */
const resolveName = <T extends { id: string }>(rows: T[], name: string | null, key: (r: T) => string) => {
  const snapshot = cap(name, ITEM_LIMITS.name);
  const hit = byName(rows, snapshot, key);
  return hit ? ([hit.id, key(hit)] as const) : ([null, snapshot] as const);
};

/**
 * Keep traceable Task and Milestone Proposals (issue #114). An item is discarded when a Source does
 * not trace, it has no title, a Milestone has no real ISO date, or it duplicates an existing item,
 * an item Proposal already raised or one kept earlier in the same pass. Unresolved names keep their
 * snapshot with a null id.
 */
export function traceItems(raw: RawItems, sources: ExtractSource[], refs: TraceRefs, pending: KnownItem[] = []) {
  const known: KnownItem[] = [
    ...refs.tasks.map((t) => ({ kind: "task" as const, title: t.title })),
    ...refs.milestones.map((m) => ({ kind: "milestone" as const, title: m.name })),
    ...pending,
  ];
  const kept: TracedItem[] = [];
  const seen = new Set<string>();
  let discarded = 0;
  const keep = (
    kind: ItemProposalKind,
    title: string | null,
    rawSources: RawTask["sources"],
    build: () => TracedItem["fields"] | null,
  ) => {
    const traced = traceSources(rawSources, sources);
    const fields = title && traced ? build() : null;
    if (!traced || !fields || known.some((k) => k.kind === kind && isDuplicateTitle(k.title, title!))) {
      discarded++;
      return;
    }
    const fingerprint = itemFingerprintOf(kind, traced[0]!, title!);
    if (seen.has(fingerprint)) {
      discarded++;
      return;
    }
    seen.add(fingerprint);
    known.push({ kind, title: title! });
    kept.push({ kind, fingerprint, fields, sources: traced });
  };

  for (const t of raw.tasks) {
    const title = cap(t.title, ITEM_LIMITS.title);
    keep("task", title, t.sources, () => {
      const [assigneeId, assigneeName] = resolveName(refs.people, t.assigneeName, (r) => r.name);
      const [milestoneId, milestoneName] = resolveName(refs.milestones, t.milestoneName, (r) => r.name);
      const dueDate = isoOrNull(t.dueDate);
      return {
        title: title!,
        description: cap(t.description, ITEM_LIMITS.description),
        assigneeId,
        assigneeName,
        milestoneId,
        milestoneName,
        startDate: startOnOrBeforeDue(isoOrNull(t.startDate), dueDate),
        dueDate,
      };
    });
  }
  for (const m of raw.milestones) {
    const name = cap(m.name, ITEM_LIMITS.name);
    keep("milestone", name, m.sources, () => {
      const dueDate = isoOrNull(m.dueDate);
      if (!dueDate) return null;
      const [ownerId, ownerName] = resolveName(refs.people, m.ownerName, (r) => r.name);
      return { name: name!, description: cap(m.description, ITEM_LIMITS.description), dueDate, ownerId, ownerName };
    });
  }
  return { kept, discarded };
}

/** Keep the traceable Proposals, drop the rest; Assumptions that do not resolve are dropped individually. */
export function traceProposals(raw: RawProposal[], sources: ExtractSource[], refs: TraceRefs) {
  const kept: TracedProposal[] = [];
  let discarded = 0;
  const seen = new Set<string>();
  for (const p of raw) {
    const title = cap(p.title, LIMITS.title);
    const chosen = cap(p.chosen, LIMITS.chosen);
    const traced = traceSources(p.sources, sources);
    if (!title || !chosen || !traced) {
      discarded++;
      continue;
    }
    const fingerprint = fingerprintOf(traced[0]!);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    kept.push({
      fingerprint,
      title,
      chosen,
      decidedOn: p.decidedOn && ISO_DATE.test(p.decidedOn) ? p.decidedOn : null,
      context: cap(p.context, LIMITS.context),
      alternatives: cap(p.alternatives, LIMITS.alternatives),
      revisitWhen: cap(p.revisitWhen, LIMITS.revisitWhen),
      sources: traced,
      assumptions: p.assumptions
        .map((a) => traceAssumption(a, refs))
        .filter((a): a is ProposedAssumption => Boolean(a)),
    });
  }
  return { kept, discarded };
}
