import type { ActivityEventRow } from "@/server/modules/activity/schema";
import type { CommentRow } from "@/server/modules/comments/schema";
import { citation } from "@/shared/lib/citation";
import { decisionHref, evidenceHref, passageHref } from "@/shared/lib/hrefs";
import type { DecisionSourceRow } from "./schema";

/** Kept as part of this module's surface; the builder itself is shared with the Evidence tools. */
export { citation };

/**
 * Pure ranking and linking for "why did we" answers (issue #40). No I/O: the service loads
 * the rows. Scores are term hits weighted by field; a Project has tens of Decisions, so
 * in-memory ranking is enough and keeps the rule readable.
 */

const STOP_WORDS = new Set(
  "why did we do the a an is it and or to of in on for that this was were be with what when how about from".split(" "),
);

/** Lowercased, de-punctuated query terms without stop words or single characters. */
export function queryTerms(query: string): string[] {
  return [
    ...new Set(
      query
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s-]/gu, " ")
        .split(/\s+/)
        .filter((t) => t.length > 1 && !STOP_WORDS.has(t)),
    ),
  ];
}

const hits = (text: string | null | undefined, terms: string[]) => {
  if (!text) return 0;
  const t = text.toLowerCase();
  return terms.reduce((n, term) => n + (t.includes(term) ? 1 : 0), 0);
};

export interface RankableDecision {
  decision: {
    title: string;
    chosen: string;
    context: string | null;
    alternatives: string | null;
    revisitWhen: string | null;
    decidedOn: string;
  };
  assumptions: Array<{ statement: string }>;
}

/** Title x3, chosen x2, the rest x1; ties by most recent `decidedOn`. Only positive scores are returned. */
export function rankDecisions<T extends RankableDecision>(items: T[], terms: string[]): T[] {
  if (!terms.length) return [];
  return items
    .map((item) => {
      const d = item.decision;
      const score =
        3 * hits(d.title, terms) +
        2 * hits(d.chosen, terms) +
        hits(d.context, terms) +
        hits(d.alternatives, terms) +
        hits(d.revisitWhen, terms) +
        hits(item.assumptions.map((a) => a.statement).join(" "), terms);
      return { item, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.item.decision.decidedOn.localeCompare(a.item.decision.decidedOn))
    .map((x) => x.item);
}

export interface RankableEvidence {
  id: string;
  title: string;
  body: string | null;
  extractedText: string | null;
}

/** Evidence by the same terms, title x3, body and extracted text x1; used only when no Decision matched. */
export function rankEvidence<T extends RankableEvidence>(rows: T[], terms: string[], limit = 3): T[] {
  if (!terms.length) return [];
  return rows
    .map((e) => ({ e, score: 3 * hits(e.title, terms) + hits(e.body, terms) + hits(e.extractedText, terms) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.e);
}

export interface HrefLookups {
  comments: Map<string, Pick<CommentRow, "entityType" | "entityId">>;
  events: Map<string, Pick<ActivityEventRow, "entityType" | "entityId">>;
}

const ITEM_PATH: Record<string, (p: string, id: string) => string> = {
  task: (p, id) => `/projects/${p}/tasks?task=${id}&tab=history`,
  risk: (p, id) => `/projects/${p}/risks?risk=${id}&tab=history`,
  milestone: (p, id) => `/projects/${p}/timeline?milestone=${id}&tab=history`,
  decision: (p, id) => `/projects/${p}/decisions?decision=${id}&tab=history`,
  evidence: evidenceHref,
};

/**
 * Where a cited Source opens: the Evidence item (or its cited Passage), the parent item of a Comment (History tab), or
 * the changed entity of an Activity Event. Falls back to the citing Decision (Comment gone) or
 * the Project Overview feed (entity without a dialog).
 */
export function sourceHref(
  projectId: string,
  decisionId: string,
  source: Pick<DecisionSourceRow, "kind" | "entityId"> & Partial<Pick<DecisionSourceRow, "passageId">>,
  lookups: HrefLookups,
): string {
  if (source.kind === "evidence") {
    // A cited Passage lands on itself; a Passage that is gone (`passageId` nulled) degrades to the item.
    return source.passageId
      ? passageHref(projectId, source.entityId, source.passageId)
      : evidenceHref(projectId, source.entityId);
  }
  if (source.kind === "comment") {
    const c = lookups.comments.get(source.entityId);
    const path = c && ITEM_PATH[c.entityType];
    return path ? path(projectId, c.entityId) : decisionHref(projectId, decisionId);
  }
  const ev = lookups.events.get(source.entityId);
  const path = ev && ITEM_PATH[ev.entityType];
  return path ? path(projectId, ev.entityId) : `/projects/${projectId}`;
}
