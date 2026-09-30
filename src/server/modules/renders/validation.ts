import { z } from "zod";
import { requiredText } from "@/server/core/validation";
import { RENDER_DRAFT_NOTES_MAX, RENDER_EVIDENCE_MAX, RENDER_PROMPT_MAX } from "@/shared/domain";

/** One id or many (repeated form fields), deduped; the service re-checks the cap. */
const evidenceIds = (min: number) =>
  z.preprocess(
    (v) => (v === undefined || v === null || v === "" ? [] : [...new Set(Array.isArray(v) ? v : [v])]),
    z
      .array(z.string())
      .min(min, "Choose at least one piece of Evidence")
      .max(RENDER_EVIDENCE_MAX, `Choose at most ${RENDER_EVIDENCE_MAX} pieces of Evidence`),
  );

export const createRenderSchema = z.object({
  projectId: z.string(),
  prompt: requiredText("Description", RENDER_PROMPT_MAX),
  /** The Evidence the description was drafted from; empty when it was typed by hand. */
  evidenceIds: evidenceIds(0).optional(),
});

export const draftRenderSchema = z.object({
  projectId: z.string(),
  evidenceIds: evidenceIds(1),
  /** The PM's own words steering the draft; blank means none. */
  notes: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().trim().max(RENDER_DRAFT_NOTES_MAX, "Notes are too long").nullable().optional(),
  ),
});

export const renderIdSchema = z.object({ id: z.string() });

export const listRendersSchema = z.object({ projectId: z.string() });

export type CreateRenderInput = z.infer<typeof createRenderSchema>;
export type DraftRenderInput = z.infer<typeof draftRenderSchema>;
