import { date, index, integer, pgTable, primaryKey, text, timestamp, unique } from "drizzle-orm/pg-core";
import { id, timestamps } from "@/server/db/columns";
import { entityTypeEnum, evidenceKindEnum } from "@/server/db/enums";
import { labels } from "@/server/modules/labels/schema";
import { projects } from "@/server/modules/projects/schema";

/**
 * A source artifact for a project. Either a stored file (`storageKey`) or pasted
 * text (`body`). `extractedText` is the file's plain text when an extractor exists for its type.
 */
export const evidence = pgTable(
  "evidence",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    kind: evidenceKindEnum("kind").notNull().default("other"),
    /** Date the artifact refers to (meeting date, report date), not the upload date. */
    sourceDate: date("source_date"),
    notes: text("notes"),
    body: text("body"),
    storageKey: text("storage_key"),
    fileName: text("file_name"),
    mimeType: text("mime_type"),
    sizeBytes: integer("size_bytes"),
    extractedText: text("extracted_text"),
    /** LitePruner-compressed copy of the indexable text; what chunks and embeddings derive from. */
    prunedText: text("pruned_text"),
    ...timestamps,
  },
  (t) => [index("evidence_project_idx").on(t.projectId)],
);

export type EvidenceRow = typeof evidence.$inferSelect;
export type NewEvidenceRow = typeof evidence.$inferInsert;

/**
 * One ordered Passage of a transcript (issue #42): the turn's text with its speaker and timestamp
 * when the input had them. A projection of the Evidence text, rewritten whole whenever that text
 * changes, so it carries no Activity Events of its own; `decision_sources.passageId` points here.
 */
export const evidencePassages = pgTable(
  "evidence_passages",
  {
    id: id(),
    evidenceId: text("evidence_id")
      .notNull()
      .references(() => evidence.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    speaker: text("speaker"),
    /** Kept as written in the transcript (`00:12:34`, `12:34`); never parsed into a duration. */
    timestamp: text("timestamp"),
    text: text("text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("evidence_passages_ordinal_uq").on(t.evidenceId, t.ordinal)],
);

export type EvidencePassageRow = typeof evidencePassages.$inferSelect;
export type NewEvidencePassageRow = typeof evidencePassages.$inferInsert;

/**
 * Many-to-many between Evidence and Tasks/Risks/Milestones. The item side is
 * polymorphic, so its cascade is done in the item services (`deleteForEntity`).
 */
export const evidenceLinks = pgTable(
  "evidence_links",
  {
    evidenceId: text("evidence_id")
      .notNull()
      .references(() => evidence.id, { onDelete: "cascade" }),
    entityType: entityTypeEnum("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    /** Denormalised for cheap ownership checks and per-project listing. */
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.evidenceId, t.entityType, t.entityId] }),
    index("evidence_links_entity_idx").on(t.entityType, t.entityId),
    index("evidence_links_project_idx").on(t.projectId),
  ],
);

export type EvidenceLinkRow = typeof evidenceLinks.$inferSelect;
export type NewEvidenceLinkRow = typeof evidenceLinks.$inferInsert;

/** Many-to-many between Evidence and the Project's Labels (same Labels that tag Tasks). */
export const evidenceLabels = pgTable(
  "evidence_labels",
  {
    evidenceId: text("evidence_id")
      .notNull()
      .references(() => evidence.id, { onDelete: "cascade" }),
    labelId: text("label_id")
      .notNull()
      .references(() => labels.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.evidenceId, t.labelId] })],
);

export type EvidenceLabelRow = typeof evidenceLabels.$inferSelect;
export type NewEvidenceLabelRow = typeof evidenceLabels.$inferInsert;
