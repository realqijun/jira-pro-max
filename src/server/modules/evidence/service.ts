import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Ctx } from "@/server/core/context";
import { compactPatch, diffFields } from "@/server/core/diff";
import { NotFoundError, ValidationError } from "@/server/core/errors";
import { mutate } from "@/server/core/mutation";
import type { DbOrTx } from "@/server/db/client";
import { milestonesRepo } from "@/server/modules/milestones/repository";
import { assertOwnsProject } from "@/server/modules/projects/service";
import { risksRepo } from "@/server/modules/risks/repository";
import { tasksRepo } from "@/server/modules/tasks/repository";
import { getStorage } from "@/server/storage";
import { labelFor, type LinkableEntityType } from "@/shared/domain";
import { assertLabelsInProject } from "@/server/modules/labels/service";
import { pruneText } from "@/server/modules/search/prune";
import { fileToMarkdown } from "./markitdown";
import { fileToTextViaModel } from "./transcribe";
import { segmentTranscript } from "./passages";
import { evidenceLabelsRepo, evidenceLinksRepo, evidenceRepo, passagesRepo } from "./repository";
import type { EvidenceRow } from "./schema";
import type { CreateEvidenceInput, EvidenceLinkInput, UpdateEvidenceInput } from "./validation";

export const MAX_EVIDENCE_BYTES = 15 * 1024 * 1024;
export const ACCEPTED_MIME = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "text/plain",
  "text/markdown",
]);

export interface UploadedFile {
  name: string;
  type: string;
  size: number;
  bytes: Buffer;
}

/** A text file's own bytes are the text; reading them needs no converter and no model call. */
const textFile = (file: UploadedFile) => {
  if (!file.type.startsWith("text/")) return null;
  const text = file.bytes.toString("utf-8").trim();
  if (!text) return null;
  return text.slice(0, Number(process.env.EVIDENCE_EXTRACT_MAX_CHARS) || 100_000);
};

/** Object name is derived from the row id; only the original extension is kept from the client name. */
function storageKeyFor(projectId: string, evidenceId: string, fileName: string) {
  const ext = path
    .extname(fileName)
    .replace(/[^.\w]/g, "")
    .slice(0, 16);
  return `evidence/${projectId}/${evidenceId}/file${ext}`;
}

async function getOwned(db: DbOrTx, userId: string, id: string) {
  const e = await evidenceRepo.findById(db, id);
  if (!e) throw new NotFoundError("Evidence");
  await assertOwnsProject(db, userId, e.projectId);
  return e;
}

/** The linked item must exist in `projectId`; returns its display label (title/name). */
async function linkedItemLabel(db: DbOrTx, projectId: string, entityType: LinkableEntityType, entityId: string) {
  const row =
    entityType === "task"
      ? await tasksRepo.findById(db, entityId)
      : entityType === "risk"
        ? await risksRepo.findById(db, entityId)
        : await milestonesRepo.findById(db, entityId);
  if (!row || row.projectId !== projectId) {
    throw new ValidationError(`${labelFor(entityType)} not in this project`, { entityId: ["Invalid"] });
  }
  return "name" in row ? row.name : row.title;
}

async function ownedEvidenceInProject(db: DbOrTx, projectId: string, evidenceId: string) {
  const e = await evidenceRepo.findById(db, evidenceId);
  if (!e || e.projectId !== projectId) {
    throw new ValidationError("Evidence not in this project", { evidenceId: ["Invalid"] });
  }
  return e;
}

/** The text a transcript is segmented from: the paste, else the file's extracted text. */
export const evidenceText = (e: Pick<EvidenceRow, "body" | "extractedText">) => e.body ?? e.extractedText ?? "";

/**
 * Rewrite a transcript's Passages from its current text; anything else has none. Segmentation is
 * pure and guarded: a segmenter failure logs and leaves the Evidence with its text and no Passages,
 * so ingest never fails because of it (issue #42).
 */
async function syncPassages(tx: DbOrTx, row: EvidenceRow) {
  let passages: ReturnType<typeof segmentTranscript> = [];
  if (row.kind === "transcript") {
    try {
      passages = segmentTranscript(evidenceText(row));
    } catch (e) {
      console.error(`Transcript segmentation failed for evidence ${row.id}`, e);
    }
  }
  await passagesRepo.replaceForEvidence(tx, row.id, passages);
}

export const evidenceService = {
  list: async (ctx: Ctx, projectId: string) => {
    await assertOwnsProject(ctx.db, ctx.userId, projectId);
    return evidenceRepo.listByProject(ctx.db, projectId);
  },

  get: (ctx: Ctx, id: string) => getOwned(ctx.db, ctx.userId, id),

  /** Ordered Passages of one Evidence item (empty unless it is a transcript). */
  passages: async (ctx: Ctx, id: string) => {
    await getOwned(ctx.db, ctx.userId, id);
    return passagesRepo.listForEvidence(ctx.db, id);
  },

  /**
   * Either `file` or `input.body` must be present. Bytes are written to storage before the
   * transaction so a failed commit leaves at most an orphan blob, never a row pointing at nothing.
   * Markitdown is the converter: its Markdown is the display text and, being text, is the only
   * file output sent to LitePruner for `prunedText`. A file markitdown cannot read goes to the
   * model as-is, and that transcription is what the index embeds.
   */
  create: async (ctx: Ctx, { labelIds = [], ...input }: CreateEvidenceInput, file?: UploadedFile | null) => {
    await assertOwnsProject(ctx.db, ctx.userId, input.projectId);
    if (!file && !input.body) throw new ValidationError("Attach a file or paste some text", { body: ["Required"] });
    if (file) {
      if (file.size > MAX_EVIDENCE_BYTES)
        throw new ValidationError("File is larger than 15 MB", { file: ["Too large"] });
      if (!ACCEPTED_MIME.has(file.type)) throw new ValidationError("Unsupported file type", { file: ["Unsupported"] });
    }
    const id = randomUUID();
    const storageKey = file ? storageKeyFor(input.projectId, id, file.name) : null;
    if (file && storageKey) await getStorage().put(storageKey, file.bytes, file.type);
    const markdown = file ? await fileToMarkdown(file) : null;
    // markitdown is the converter; a file it cannot read is used directly - text bytes as
    // themselves, anything else (scans, image-only PDFs) to the model as-is.
    const extractedText = markdown ?? (file ? (textFile(file) ?? (await fileToTextViaModel(file))) : null);
    // LitePruner takes text, not files: only markitdown output or a pasted body is sent. The
    // index stores what it will embed - the pruned copy, else the original text on any failure.
    const toPrune = input.body ?? markdown ?? "";
    const prunedText = (await pruneText(toPrune))?.text ?? (toPrune || extractedText);
    try {
      return await mutate(ctx, async (tx, rec) => {
        await assertOwnsProject(tx, ctx.userId, input.projectId);
        await assertLabelsInProject(tx, input.projectId, labelIds);
        const row = await evidenceRepo.insert(tx, {
          ...input,
          id,
          storageKey,
          fileName: file?.name,
          mimeType: file?.type,
          sizeBytes: file?.size,
          extractedText,
          prunedText,
        });
        await syncPassages(tx, row);
        await evidenceLabelsRepo.setLabels(tx, row.id, labelIds);
        rec.created("evidence", input.projectId, row.id, row.title);
        return row;
      });
    } catch (e) {
      if (storageKey)
        await getStorage()
          .delete(storageKey)
          .catch(() => undefined);
      throw e;
    }
  },

  update: async (ctx: Ctx, { id, labelIds, ...patch }: UpdateEvidenceInput) => {
    // Pruning is a network call and must happen outside the transaction, like extraction.
    let prunedText: string | null | undefined;
    if ("body" in patch) {
      const before = await getOwned(ctx.db, ctx.userId, id);
      const nextText = patch.body === undefined ? evidenceText(before) : (patch.body ?? before.extractedText ?? "");
      prunedText = (await pruneText(nextText))?.text ?? (nextText || null);
    }
    return mutate(ctx, async (tx, rec) => {
      const before = await getOwned(tx, ctx.userId, id);
      const clean = compactPatch(patch);
      const changes = diffFields(before, clean);
      if (labelIds) {
        await assertLabelsInProject(tx, before.projectId, labelIds);
        const oldLabels = (await evidenceLabelsRepo.labelIds(tx, id)).sort();
        const newLabels = [...labelIds].sort();
        if (JSON.stringify(oldLabels) !== JSON.stringify(newLabels)) {
          await evidenceLabelsRepo.setLabels(tx, id, labelIds);
          changes.push({ field: "labelIds", oldValue: oldLabels, newValue: newLabels });
        }
      }
      const sets = { ...clean, ...(prunedText !== undefined ? { prunedText } : {}) };
      if (!changes.length && !Object.keys(sets).length) return before;
      const after = Object.keys(sets).length ? await evidenceRepo.update(tx, id, sets) : before;
      if (changes.some((c) => c.field === "kind" || c.field === "body")) await syncPassages(tx, after);
      if (changes.length) rec.updated("evidence", before.projectId, id, after.title, changes);
      return after;
    });
  },

  /** Row goes first; the blob is removed only once the delete has committed. */
  delete: async (ctx: Ctx, id: string) => {
    const e = await mutate(ctx, async (tx, rec) => {
      const e = await getOwned(tx, ctx.userId, id);
      await evidenceRepo.delete(tx, id);
      rec.deleted("evidence", e.projectId, id, e.title);
      return e;
    });
    if (e.storageKey) await getStorage().delete(e.storageKey);
  },

  /** Raw bytes for download; ownership enforced. */
  download: async (ctx: Ctx, id: string) => {
    const e = await getOwned(ctx.db, ctx.userId, id);
    if (!e.storageKey) throw new NotFoundError("File");
    return { evidence: e, bytes: await getStorage().get(e.storageKey) };
  },

  /**
   * Idempotent: linking an existing pair returns the existing row with no Activity Event.
   * The Activity Event is recorded against the item (field `evidence`), never the Evidence,
   * so the Overview feed shows one entry.
   */
  link: (ctx: Ctx, input: EvidenceLinkInput) =>
    mutate(ctx, async (tx, rec) => {
      await assertOwnsProject(tx, ctx.userId, input.projectId);
      const ev = await ownedEvidenceInProject(tx, input.projectId, input.evidenceId);
      const itemLabel = await linkedItemLabel(tx, input.projectId, input.entityType, input.entityId);
      const inserted = await evidenceLinksRepo.insertIgnore(tx, input);
      if (!inserted) return (await evidenceLinksRepo.find(tx, input))!;
      rec.updated(input.entityType, input.projectId, input.entityId, itemLabel, [
        { field: "evidence", oldValue: null, newValue: ev.title },
      ]);
      rec.signal("evidence.linked", {
        projectId: input.projectId,
        entityType: "evidence",
        entityId: ev.id,
        entityLabel: ev.title,
        changes: [
          { field: "link", oldValue: null, newValue: { entityType: input.entityType, entityId: input.entityId } },
        ],
      });
      return inserted;
    }),

  /** Removing a link that does not exist is a no-op success. */
  unlink: (ctx: Ctx, input: EvidenceLinkInput) =>
    mutate(ctx, async (tx, rec) => {
      await assertOwnsProject(tx, ctx.userId, input.projectId);
      const ev = await ownedEvidenceInProject(tx, input.projectId, input.evidenceId);
      const itemLabel = await linkedItemLabel(tx, input.projectId, input.entityType, input.entityId);
      const removed = await evidenceLinksRepo.delete(tx, input);
      if (!removed.length) return;
      rec.updated(input.entityType, input.projectId, input.entityId, itemLabel, [
        { field: "evidence", oldValue: ev.title, newValue: null },
      ]);
      rec.signal("evidence.unlinked", {
        projectId: input.projectId,
        entityType: "evidence",
        entityId: ev.id,
        entityLabel: ev.title,
        changes: [
          { field: "link", oldValue: { entityType: input.entityType, entityId: input.entityId }, newValue: null },
        ],
      });
    }),

  listForEntity: async (ctx: Ctx, projectId: string, entityType: LinkableEntityType, entityId: string) => {
    await assertOwnsProject(ctx.db, ctx.userId, projectId);
    return evidenceLinksRepo.listForEntity(ctx.db, projectId, entityType, entityId);
  },

  listForEvidence: async (ctx: Ctx, evidenceId: string) => {
    const e = await getOwned(ctx.db, ctx.userId, evidenceId);
    return evidenceLinksRepo.listForEvidence(ctx.db, e.id);
  },

  /** Every linkable item in the project, for the Evidence page picker. */
  listLinkTargets: async (ctx: Ctx, projectId: string) => {
    await assertOwnsProject(ctx.db, ctx.userId, projectId);
    return evidenceLinksRepo.listTargets(ctx.db, projectId);
  },

  /** (evidenceId, labelId) pairs across the Project, for the Evidence page's Label display. */
  labelPairs: async (ctx: Ctx, projectId: string) => {
    await assertOwnsProject(ctx.db, ctx.userId, projectId);
    return evidenceLabelsRepo.forProject(ctx.db, projectId);
  },
};
