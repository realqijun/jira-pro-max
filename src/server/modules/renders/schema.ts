import { index, integer, jsonb, pgTable, text } from "drizzle-orm/pg-core";
import { id, timestamps } from "@/server/db/columns";
import { renderStateEnum } from "@/server/db/enums";
import { projects } from "@/server/modules/projects/schema";

/** One piece of Evidence a Render's description was drafted from, as it was titled then. */
export interface RenderEvidenceRef {
  evidenceId: string;
  title: string;
}

/**
 * A concept render: one generated picture of what the Project delivers.
 *
 * The row keeps everything needed to explain where the image came from - the exact prompt,
 * model and seed - because an image with no provenance is an opinion nobody can check.
 * `prompt` is what the PM approved: typed by hand, or drafted from Evidence and then edited
 * (ADR 0016). It is the only text the image provider receives; see the service.
 */
export const renders = pgTable(
  "renders",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    prompt: text("prompt").notNull(),
    model: text("model").notNull(),
    /** Fixed per render so the same row can be reproduced by re-sending prompt + seed. */
    seed: integer("seed").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    state: renderStateEnum("state").notNull().default("pending"),
    /** Set once the bytes are stored; null while pending and after a failure. */
    storageKey: text("storage_key"),
    mimeType: text("mime_type"),
    sizeBytes: integer("size_bytes"),
    /** Why generation failed, shown to the PM verbatim. Null unless `state` is failed. */
    error: text("error"),
    /**
     * The Evidence the description was drafted from, empty for a hand-typed one. A snapshot
     * with no foreign key, so the card still says where the words came from after the
     * Evidence is deleted.
     */
    evidence: jsonb("evidence").$type<RenderEvidenceRef[]>().notNull().default([]),
    ...timestamps,
  },
  (t) => [index("renders_project_idx").on(t.projectId)],
);

export type RenderRow = typeof renders.$inferSelect;
export type NewRenderRow = typeof renders.$inferInsert;
