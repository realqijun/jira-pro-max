import { z } from "zod";
import { optionalDate, optionalText, requiredText } from "@/server/core/validation";
import { EVIDENCE_KINDS, LINKABLE_ENTITY_TYPES } from "@/shared/domain";

/** Absent = leave unchanged; "" = clear all; string | string[] = set. Same contract as Task labels. */
const labelIds = z.preprocess(
  (v) => (v === undefined || v === null ? undefined : v === "" ? [] : Array.isArray(v) ? v : [v]),
  z.array(z.string()).optional(),
);

export const createEvidenceSchema = z.object({
  projectId: z.string(),
  title: requiredText("Title", 200),
  kind: z.enum(EVIDENCE_KINDS).default("other"),
  sourceDate: optionalDate,
  notes: optionalText,
  body: optionalText,
  labelIds,
});

export const updateEvidenceSchema = z.object({
  id: z.string(),
  title: requiredText("Title", 200).optional(),
  kind: z.enum(EVIDENCE_KINDS).optional(),
  sourceDate: optionalDate,
  notes: optionalText,
  body: optionalText,
  labelIds,
});

export const evidenceLinkSchema = z.object({
  projectId: z.string(),
  evidenceId: z.string(),
  entityType: z.enum(LINKABLE_ENTITY_TYPES),
  entityId: z.string(),
});

export type CreateEvidenceInput = z.infer<typeof createEvidenceSchema>;
export type UpdateEvidenceInput = z.infer<typeof updateEvidenceSchema>;
export type EvidenceLinkInput = z.infer<typeof evidenceLinkSchema>;
