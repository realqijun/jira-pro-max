import { doublePrecision, index, integer, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { id } from "@/server/db/columns";
import { evidence } from "@/server/modules/evidence/schema";
import { projects } from "@/server/modules/projects/schema";

/**
 * One embedding-ready slice of an Evidence item's text (its `prunedText` when present, else the
 * body/extracted text). A projection rewritten whole whenever that text changes, like Passages:
 * it carries no Activity Events of its own. The per-project FAISS index is rebuilt from this
 * table, which stays the source of truth; `embedding` is null when no model is configured.
 */
export const evidenceChunks = pgTable(
  "evidence_chunks",
  {
    id: id(),
    evidenceId: text("evidence_id")
      .notNull()
      .references(() => evidence.id, { onDelete: "cascade" }),
    /** Denormalised for per-project index rebuilds and scoping. */
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    text: text("text").notNull(),
    /** Embedding vector (1536 dims regardless of provider). */
    embedding: doublePrecision("embedding").array(),
    /** "provider:model" that produced the embedding (e.g. "gemini:gemini-embedding-001"); null
     * means no model was configured. A change in the configured model makes these stale, which
     * the lazy backfill detects and re-embeds. */
    model: text("model"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("evidence_chunks_ordinal_uq").on(t.evidenceId, t.ordinal),
    index("evidence_chunks_project_idx").on(t.projectId),
  ],
);

export type EvidenceChunkRow = typeof evidenceChunks.$inferSelect;
export type NewEvidenceChunkRow = typeof evidenceChunks.$inferInsert;
