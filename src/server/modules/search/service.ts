import { z } from "zod";
import type { Ctx } from "@/server/core/context";
import { ValidationError } from "@/server/core/errors";
import { db, type DbOrTx } from "@/server/db/client";
import { evidenceLabelsRepo, evidenceLinksRepo, evidenceRepo } from "@/server/modules/evidence/repository";
import type { EvidenceRow } from "@/server/modules/evidence/schema";
import { evidenceText } from "@/server/modules/evidence/service";
import { labelsRepo } from "@/server/modules/labels/service";
import { assertOwnsProject } from "@/server/modules/projects/service";
import { LINKABLE_ENTITY_TYPES, labelFor } from "@/shared/domain";
import { citation } from "@/shared/lib/citation";
import { evidenceHref } from "@/shared/lib/hrefs";
import { chunkText, embedTexts, embeddingModelId, getEmbeddingModel } from "./embed";
import { invalidateIndex, searchIndex } from "./index";
import { chunksRepo } from "./repository";

export const searchEvidenceSchema = z.object({
  projectId: z.string(),
  query: z.string().optional(),
  /** Label names or ids; an Evidence item must carry ALL of them to match. */
  labels: z.array(z.string()).optional(),
  /** Restrict to Evidence linked to this Task, Risk or Milestone; `entity` is its id or title/name. */
  linkedTo: z.object({ entityType: z.enum(LINKABLE_ENTITY_TYPES), entity: z.string() }).optional(),
  limit: z.number().int().min(1).max(20).optional(),
});
export type SearchEvidenceInput = z.infer<typeof searchEvidenceSchema>;

const DEFAULT_LIMIT = 8;
const SNIPPET_CHARS = 500;

/**
 * One match as the model sees it. `evidenceId` (not `id`) is what read_evidence takes; `href`
 * and `cite` are the citation, because an id alone does not tell the model the route shape.
 */
const meta = (e: EvidenceRow) => {
  const href = evidenceHref(e.projectId, e.id);
  return {
    evidenceId: e.id,
    title: e.title,
    kind: e.kind,
    sourceDate: e.sourceDate,
    fileName: e.fileName,
    href,
    cite: citation(e.title, href),
  };
};

/** Resolve label names or ids to ids; an unknown term is a validation error the model can read. */
async function resolveLabelIds(projectId: string, terms: string[]): Promise<string[]> {
  const all = await labelsRepo.listByProject(db, projectId);
  const byId = new Set(all.map((l) => l.id));
  const byName = new Map(all.map((l) => [l.name.toLowerCase(), l.id]));
  const ids = new Set<string>();
  for (const t of terms) {
    const id = byId.has(t) ? t : byName.get(t.toLowerCase());
    if (!id) throw new ValidationError(`No Label matches "${t}"`, { labels: ["Unknown label"] });
    ids.add(id);
  }
  return [...ids];
}

/** Ids of Evidence linked to the named Task/Risk/Milestone; id, exact label, then substring. */
async function resolveLinkedScope(
  dbOrTx: DbOrTx,
  projectId: string,
  linkedTo: { entityType: (typeof LINKABLE_ENTITY_TYPES)[number]; entity: string },
): Promise<Set<string>> {
  const targets = (await evidenceLinksRepo.listTargets(dbOrTx, projectId)).filter(
    (t) => t.entityType === linkedTo.entityType,
  );
  const q = linkedTo.entity.toLowerCase();
  const exact = targets.filter((t) => t.label.toLowerCase() === q);
  const hits = targets.some((t) => t.entityId === linkedTo.entity)
    ? targets.filter((t) => t.entityId === linkedTo.entity)
    : exact.length
      ? exact
      : targets.filter((t) => t.label.toLowerCase().includes(q));
  if (!hits.length) {
    throw new ValidationError(`No ${labelFor(linkedTo.entityType)} matches "${linkedTo.entity}"`, {
      linkedTo: ["Unknown item"],
    });
  }
  const links = (
    await Promise.all(hits.map((t) => evidenceLinksRepo.listForEntity(dbOrTx, projectId, t.entityType, t.entityId)))
  ).flat();
  return new Set(links.map((l) => l.evidenceId));
}

/**
 * Evidence that predates the search subscriber has no chunks; index it on the Project's first
 * search so existing Projects self-heal. Bounded per search; an unfinished Project is retried
 * on the next one. Chunks recorded with a different embedder identity (a provider/model
 * switch) are stale - embedding spaces are not comparable - and are re-embedded in the
 * same pass.
 */
const BACKFILL_MAX = 100;
const globalForBackfill = globalThis as unknown as { __searchBackfilled?: Set<string> };
const backfilledProjects = (globalForBackfill.__searchBackfilled ??= new Set());

async function ensureIndexed(ctx: Ctx, projectId: string) {
  if (backfilledProjects.has(projectId)) return;
  const currentModel = embeddingModelId();
  const [rows, state] = await Promise.all([
    evidenceRepo.listByProject(ctx.db, projectId),
    chunksRepo.indexState(ctx.db, projectId),
  ]);
  const pending = rows.filter((row) => {
    const s = state.get(row.id);
    return !s?.chunked || s.model !== currentModel;
  });
  for (const row of pending.slice(0, BACKFILL_MAX)) {
    try {
      await searchService.syncEvidence(row);
    } catch (e) {
      console.error("[search] backfill failed for evidence", row.id, e);
    }
  }
  if (pending.length <= BACKFILL_MAX) backfilledProjects.add(projectId);
}

export const searchService = {
  /**
   * Rewrite an Evidence item's chunks from its current indexable text (pruned when LitePruner
   * produced a copy, else the full text) and drop the cached FAISS index so it rebuilds.
   * Runs after the Evidence mutation commits, via the domain-event subscriber.
   */
  syncEvidence: async (row: EvidenceRow) => {
    const chunks = chunkText(row.prunedText ?? evidenceText(row));
    const embeddings = chunks.length ? await embedTexts(chunks, "RETRIEVAL_DOCUMENT") : null;
    // Record the attempted embedder identity even on failure so a transient outage does not
    // re-embed every search; a configured-model change still marks them stale.
    const model = embeddingModelId();
    await db.transaction((tx) => chunksRepo.replaceForEvidence(tx, row.id, row.projectId, chunks, embeddings, model));
    invalidateIndex(row.projectId);
  },

  /** Evidence rows cascade to their chunks; only the cached index needs dropping. */
  dropIndex: (projectId: string) => invalidateIndex(projectId),

  /**
   * Semantic search over Evidence chunks, optionally restricted to items carrying all of the
   * given Labels. With `labels` and no `query` it is a plain labelled listing. Without an
   * embedding model (no OPENAI_API_KEY, or nothing indexed yet) a query falls back to literal
   * matching and says so.
   */
  search: async (ctx: Ctx, input: SearchEvidenceInput) => {
    await assertOwnsProject(ctx.db, ctx.userId, input.projectId);
    const limit = input.limit ?? DEFAULT_LIMIT;
    await ensureIndexed(ctx, input.projectId);

    const scopes: Set<string>[] = [];
    if (input.labels?.length) {
      const labelIds = await resolveLabelIds(input.projectId, input.labels);
      scopes.push(await evidenceLabelsRepo.evidenceIdsWithAllLabels(ctx.db, input.projectId, labelIds));
    }
    if (input.linkedTo) scopes.push(await resolveLinkedScope(ctx.db, input.projectId, input.linkedTo));
    const scoped = scopes.length ? scopes.reduce((a, b) => new Set([...a].filter((x) => b.has(x)))) : null;
    if (scoped && !scoped.size) return { matches: [], note: "No Evidence matches those filters." };

    const query = input.query?.trim();
    if (query) {
      const semantic = await semanticMatches(ctx, input.projectId, query, scoped, limit);
      if (semantic) return { matches: semantic };
      const terms = query.split(/\s+/).filter(Boolean).slice(0, 8);
      let rows = await evidenceRepo.searchByTerms(ctx.db, input.projectId, terms, limit);
      if (scoped) rows = rows.filter((r) => scoped.has(r.id));
      return {
        matches: rows.map(meta),
        note: "Embeddings unavailable; returned literal text matches instead.",
      };
    }

    let rows = await evidenceRepo.listByProject(ctx.db, input.projectId);
    if (scoped) rows = rows.filter((r) => scoped.has(r.id));
    return { matches: rows.slice(0, limit).map(meta) };
  },
};

/** Ranked chunk matches, or null when embeddings can't run and the caller should fall back. */
async function semanticMatches(ctx: Ctx, projectId: string, query: string, scoped: Set<string> | null, limit: number) {
  if (!getEmbeddingModel()) return null;
  const [vector] = (await embedTexts([query], "RETRIEVAL_QUERY")) ?? [];
  if (!vector) return null;
  // Overfetch when a label filter will discard hits.
  const hits = await searchIndex(projectId, vector, scoped ? limit * 4 : limit);
  if (!hits.length) return null;
  const chunks = await chunksRepo.findByIds(
    ctx.db,
    hits.map((h) => h.chunkId),
  );
  const byId = new Map(chunks.map((c) => [c.id, c]));
  const ranked = hits
    .map((h) => ({ score: h.score, chunk: byId.get(h.chunkId) }))
    .filter((x): x is { score: number; chunk: (typeof chunks)[number] } => Boolean(x.chunk))
    .filter((x) => !scoped || scoped.has(x.chunk.evidenceId))
    .slice(0, limit);
  if (!ranked.length) return [];
  const rows = await evidenceRepo.findByIds(ctx.db, [...new Set(ranked.map((x) => x.chunk.evidenceId))]);
  const byEvidence = new Map(rows.map((r) => [r.id, r]));
  return ranked.map(({ score, chunk }) => ({
    ...meta(byEvidence.get(chunk.evidenceId)!),
    score: Math.round(score * 1000) / 1000,
    snippet: chunk.text.slice(0, SNIPPET_CHARS),
  }));
}
