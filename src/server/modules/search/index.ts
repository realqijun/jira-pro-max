import { IndexFlatIP } from "faiss-node";
import { db } from "@/server/db/client";
import { EMBEDDING_DIMS, embeddingModelId } from "./embed";
import { chunksRepo } from "./repository";

/**
 * One in-memory FAISS index per Project, built lazily from `evidence_chunks` - the table is the
 * source of truth, so an index is disposable and `invalidateIndex` forces the next search to
 * rebuild it. IndexFlatIP over L2-normalised vectors is cosine similarity.
 */
interface ProjectIndex {
  index: IndexFlatIP;
  /** Row id per FAISS ordinal; `search` labels index into this. */
  chunkIds: string[];
}

const globalForSearch = globalThis as unknown as {
  __searchIndex?: Map<string, ProjectIndex>;
  __searchIndexBuilding?: Map<string, Promise<ProjectIndex>>;
};
const cache = (globalForSearch.__searchIndex ??= new Map());
const building = (globalForSearch.__searchIndexBuilding ??= new Map());

const normalize = (v: number[]) => {
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
};

async function getIndex(projectId: string): Promise<ProjectIndex> {
  const cached = cache.get(projectId);
  if (cached) return cached;
  const pending = building.get(projectId);
  if (pending) return pending;
  const build = (async () => {
    // Only current-model vectors go in: a provider switch leaves stale rows (different
    // embedding space) until the backfill rewrites them, and they must not be ranked.
    const currentModel = embeddingModelId();
    const chunks = (await chunksRepo.listForProject(db, projectId)).filter(
      (c) => c.embedding?.length && c.model === currentModel,
    );
    const index = new IndexFlatIP(EMBEDDING_DIMS);
    if (chunks.length) index.add(chunks.flatMap((c) => normalize(c.embedding!)));
    const entry = { index, chunkIds: chunks.map((c) => c.id) };
    cache.set(projectId, entry);
    return entry;
  })();
  building.set(projectId, build);
  try {
    return await build;
  } finally {
    building.delete(projectId);
  }
}

/** Drop the cached index after Evidence text changed; the next search rebuilds it. */
export function invalidateIndex(projectId: string) {
  cache.delete(projectId);
}

export interface IndexHit {
  chunkId: string;
  score: number;
}

/** Top-k chunk ids by cosine similarity to `vector` (need not be normalised). */
export async function searchIndex(projectId: string, vector: number[], k: number): Promise<IndexHit[]> {
  const { index, chunkIds } = await getIndex(projectId);
  const total = index.ntotal();
  if (!total) return [];
  const { labels, distances } = index.search(normalize(vector), Math.min(k, total));
  return labels.flatMap((ordinal, i) => {
    const chunkId = chunkIds[ordinal];
    return chunkId === undefined ? [] : [{ chunkId, score: distances[i]! }];
  });
}
