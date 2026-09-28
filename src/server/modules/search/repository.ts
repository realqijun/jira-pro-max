import { asc, eq, inArray } from "drizzle-orm";
import type { DbOrTx } from "@/server/db/client";
import { evidenceChunks, type EvidenceChunkRow } from "./schema";

export const chunksRepo = {
  listForProject: (db: DbOrTx, projectId: string): Promise<EvidenceChunkRow[]> =>
    db
      .select()
      .from(evidenceChunks)
      .where(eq(evidenceChunks.projectId, projectId))
      .orderBy(asc(evidenceChunks.evidenceId), asc(evidenceChunks.ordinal)),

  /** evidenceId -> chunk presence and the embedder recorded on it, for the lazy backfill. */
  indexState: async (
    db: DbOrTx,
    projectId: string,
  ): Promise<Map<string, { chunked: boolean; model: string | null }>> => {
    const rows = await db
      .select({ evidenceId: evidenceChunks.evidenceId, model: evidenceChunks.model })
      .from(evidenceChunks)
      .where(eq(evidenceChunks.projectId, projectId));
    // Chunks are rewritten whole, so one Evidence carries one model value.
    const state = new Map<string, { chunked: boolean; model: string | null }>();
    for (const r of rows) {
      state.set(r.evidenceId, { chunked: true, model: state.get(r.evidenceId)?.model ?? r.model });
    }
    return state;
  },

  findByIds: (db: DbOrTx, ids: string[]): Promise<EvidenceChunkRow[]> =>
    ids.length ? db.select().from(evidenceChunks).where(inArray(evidenceChunks.id, ids)) : Promise.resolve([]),

  /** Delete then insert: a projection, so callers lose nothing when text is re-chunked. */
  replaceForEvidence: async (
    db: DbOrTx,
    evidenceId: string,
    projectId: string,
    texts: string[],
    embeddings: number[][] | null,
    model: string | null,
  ) => {
    await db.delete(evidenceChunks).where(eq(evidenceChunks.evidenceId, evidenceId));
    if (!texts.length) return [];
    return db
      .insert(evidenceChunks)
      .values(
        texts.map((text, ordinal) => ({
          evidenceId,
          projectId,
          ordinal,
          text,
          embedding: embeddings?.[ordinal] ?? null,
          model,
        })),
      )
      .returning();
  },
};
