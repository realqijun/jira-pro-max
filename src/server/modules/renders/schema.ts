import { index, integer, pgTable, text } from "drizzle-orm/pg-core";
import { id, timestamps } from "@/server/db/columns";
import { renderStateEnum } from "@/server/db/enums";
import { projects } from "@/server/modules/projects/schema";

/**
 * A concept render: one generated picture of what the Project delivers.
 *
 * The row keeps everything needed to explain where the image came from - the exact prompt,
 * model and seed - because an image with no provenance is an opinion nobody can check.
 * `prompt` is what the PM typed and is never derived from Project data; see the service.
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
    ...timestamps,
  },
  (t) => [index("renders_project_idx").on(t.projectId)],
);

export type RenderRow = typeof renders.$inferSelect;
export type NewRenderRow = typeof renders.$inferInsert;
