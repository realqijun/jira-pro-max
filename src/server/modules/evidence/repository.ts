import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import type { DbOrTx } from "@/server/db/client";
import { milestones } from "@/server/modules/milestones/schema";
import { risks } from "@/server/modules/risks/schema";
import { tasks } from "@/server/modules/tasks/schema";
import type { LinkableEntityType } from "@/shared/domain";
import {
  evidence,
  evidenceLabels,
  evidenceLinks,
  evidencePassages,
  type EvidenceLinkRow,
  type EvidencePassageRow,
  type EvidenceRow,
  type NewEvidenceLinkRow,
  type NewEvidencePassageRow,
  type NewEvidenceRow,
} from "./schema";

export const evidenceRepo = {
  listByProject: (db: DbOrTx, projectId: string) =>
    db
      .select()
      .from(evidence)
      .where(eq(evidence.projectId, projectId))
      .orderBy(desc(evidence.sourceDate), desc(evidence.createdAt)),

  /** Evidence whose title, body or extracted text contains any term (literal match), newest first, capped. */
  searchByTerms: (db: DbOrTx, projectId: string, terms: string[], limit: number): Promise<EvidenceRow[]> => {
    if (!terms.length) return Promise.resolve([]);
    const mentions = terms.map((t) => {
      const pattern = `%${t.replace(/[\\%_]/g, "\\$&")}%`;
      return or(ilike(evidence.title, pattern), ilike(evidence.body, pattern), ilike(evidence.extractedText, pattern));
    });
    return db
      .select()
      .from(evidence)
      .where(and(eq(evidence.projectId, projectId), or(...mentions)))
      .orderBy(desc(evidence.sourceDate), desc(evidence.createdAt))
      .limit(limit);
  },

  findById: async (db: DbOrTx, id: string): Promise<EvidenceRow | undefined> => {
    const [row] = await db.select().from(evidence).where(eq(evidence.id, id));
    return row;
  },

  findByIds: (db: DbOrTx, ids: string[]): Promise<EvidenceRow[]> =>
    ids.length ? db.select().from(evidence).where(inArray(evidence.id, ids)) : Promise.resolve([]),

  insert: async (db: DbOrTx, values: NewEvidenceRow) => {
    const [row] = await db.insert(evidence).values(values).returning();
    return row!;
  },

  update: async (db: DbOrTx, id: string, patch: Partial<NewEvidenceRow>) => {
    const [row] = await db.update(evidence).set(patch).where(eq(evidence.id, id)).returning();
    return row!;
  },

  delete: (db: DbOrTx, id: string) => db.delete(evidence).where(eq(evidence.id, id)),
};

/** Passages of transcripts (issue #42); a projection of the Evidence text, replaced whole on each text change. */
export const passagesRepo = {
  listForEvidence: (db: DbOrTx, evidenceId: string): Promise<EvidencePassageRow[]> =>
    db
      .select()
      .from(evidencePassages)
      .where(eq(evidencePassages.evidenceId, evidenceId))
      .orderBy(asc(evidencePassages.ordinal)),

  /** Every Passage in the Project, for the Source picker and the Proposal pass. */
  listForProject: (db: DbOrTx, projectId: string): Promise<EvidencePassageRow[]> =>
    db
      .select({
        id: evidencePassages.id,
        evidenceId: evidencePassages.evidenceId,
        ordinal: evidencePassages.ordinal,
        speaker: evidencePassages.speaker,
        timestamp: evidencePassages.timestamp,
        text: evidencePassages.text,
        createdAt: evidencePassages.createdAt,
      })
      .from(evidencePassages)
      .innerJoin(evidence, eq(evidence.id, evidencePassages.evidenceId))
      .where(eq(evidence.projectId, projectId))
      .orderBy(asc(evidencePassages.evidenceId), asc(evidencePassages.ordinal)),

  findById: async (db: DbOrTx, id: string): Promise<EvidencePassageRow | undefined> => {
    const [row] = await db.select().from(evidencePassages).where(eq(evidencePassages.id, id));
    return row;
  },

  /** Delete then insert: citing Sources lose their `passageId` through the FK, which is the intended degrade. */
  replaceForEvidence: async (db: DbOrTx, evidenceId: string, rows: Omit<NewEvidencePassageRow, "evidenceId">[]) => {
    await db.delete(evidencePassages).where(eq(evidencePassages.evidenceId, evidenceId));
    if (!rows.length) return [];
    return db
      .insert(evidencePassages)
      .values(rows.map((r) => ({ ...r, evidenceId })))
      .returning();
  },
};

/** Every link lookup carries the Project: ownership is asserted on `projectId`, so ids alone must never select a row. */
type LinkKey = Pick<EvidenceLinkRow, "projectId" | "evidenceId" | "entityType" | "entityId">;

const linkKey = (k: LinkKey) =>
  and(
    eq(evidenceLinks.projectId, k.projectId),
    eq(evidenceLinks.evidenceId, k.evidenceId),
    eq(evidenceLinks.entityType, k.entityType),
    eq(evidenceLinks.entityId, k.entityId),
  );

/** `sourceDate` is nullable: sort by the date the artifact refers to, falling back to when it was added. */
const evidenceRecency = desc(sql`coalesce(${evidence.sourceDate}, ${evidence.createdAt}::date)`);
const summaryColumns = { id: evidence.id, title: evidence.title, kind: evidence.kind, sourceDate: evidence.sourceDate };

/** Links with both sides labelled in one query (polymorphic side via three left joins). */
const withLabels = (db: DbOrTx) =>
  db
    .select({
      evidenceId: evidenceLinks.evidenceId,
      entityType: sql<LinkableEntityType>`${evidenceLinks.entityType}`,
      entityId: evidenceLinks.entityId,
      projectId: evidenceLinks.projectId,
      createdAt: evidenceLinks.createdAt,
      evidenceTitle: evidence.title,
      evidenceKind: evidence.kind,
      evidenceSourceDate: evidence.sourceDate,
      /** Empty string when the item vanished mid-request; the UI falls back to the type label. */
      entityLabel: sql<string>`coalesce(${tasks.title}, ${risks.title}, ${milestones.name}, '')`,
      entityNumber: sql<number | null>`coalesce(${tasks.number}, ${risks.number})`,
    })
    .from(evidenceLinks)
    .innerJoin(evidence, eq(evidence.id, evidenceLinks.evidenceId))
    .leftJoin(tasks, and(eq(evidenceLinks.entityType, "task"), eq(tasks.id, evidenceLinks.entityId)))
    .leftJoin(risks, and(eq(evidenceLinks.entityType, "risk"), eq(risks.id, evidenceLinks.entityId)))
    .leftJoin(milestones, and(eq(evidenceLinks.entityType, "milestone"), eq(milestones.id, evidenceLinks.entityId)));

export interface LinkTarget {
  entityType: LinkableEntityType;
  entityId: string;
  label: string;
  number: number | null;
}

export const evidenceLinksRepo = {
  listForProject: (db: DbOrTx, projectId: string) =>
    withLabels(db)
      .where(eq(evidenceLinks.projectId, projectId))
      .orderBy(evidenceRecency, desc(evidence.createdAt), asc(evidenceLinks.createdAt)),

  listForEntity: (db: DbOrTx, projectId: string, entityType: LinkableEntityType, entityId: string) =>
    withLabels(db)
      .where(
        and(
          eq(evidenceLinks.projectId, projectId),
          eq(evidenceLinks.entityType, entityType),
          eq(evidenceLinks.entityId, entityId),
        ),
      )
      .orderBy(evidenceRecency, desc(evidence.createdAt), asc(evidenceLinks.createdAt)),

  listForEvidence: (db: DbOrTx, evidenceId: string) =>
    withLabels(db).where(eq(evidenceLinks.evidenceId, evidenceId)).orderBy(asc(evidenceLinks.createdAt)),

  find: async (db: DbOrTx, key: LinkKey): Promise<EvidenceLinkRow | undefined> => {
    const [row] = await db.select().from(evidenceLinks).where(linkKey(key));
    return row;
  },

  /** Returns undefined when the pair already existed (composite PK conflict). */
  insertIgnore: async (db: DbOrTx, values: NewEvidenceLinkRow): Promise<EvidenceLinkRow | undefined> => {
    const [row] = await db.insert(evidenceLinks).values(values).onConflictDoNothing().returning();
    return row;
  },

  delete: (db: DbOrTx, key: LinkKey) => db.delete(evidenceLinks).where(linkKey(key)).returning(),

  /** Called by the task/risk/milestone services inside their delete transaction. */
  deleteForEntity: (db: DbOrTx, entityType: LinkableEntityType, entityId: string) =>
    db.delete(evidenceLinks).where(and(eq(evidenceLinks.entityType, entityType), eq(evidenceLinks.entityId, entityId))),

  /** Picker data for the Evidence page: every linkable item in the project, three cheap selects. */
  listTargets: async (db: DbOrTx, projectId: string): Promise<LinkTarget[]> => {
    const [t, r, m] = await Promise.all([
      db
        .select({ id: tasks.id, number: tasks.number, title: tasks.title })
        .from(tasks)
        .where(eq(tasks.projectId, projectId))
        .orderBy(asc(tasks.number)),
      db
        .select({ id: risks.id, number: risks.number, title: risks.title })
        .from(risks)
        .where(eq(risks.projectId, projectId))
        .orderBy(asc(risks.number)),
      db
        .select({ id: milestones.id, name: milestones.name })
        .from(milestones)
        .where(eq(milestones.projectId, projectId))
        .orderBy(asc(milestones.dueDate), asc(milestones.name)),
    ]);
    return [
      ...t.map((x) => ({ entityType: "task" as const, entityId: x.id, label: x.title, number: x.number })),
      ...r.map((x) => ({ entityType: "risk" as const, entityId: x.id, label: x.title, number: x.number })),
      ...m.map((x) => ({ entityType: "milestone" as const, entityId: x.id, label: x.name, number: null })),
    ];
  },

  /** Light rows for the item-dialog picker. */
  listSummaries: (db: DbOrTx, projectId: string) =>
    db
      .select(summaryColumns)
      .from(evidence)
      .where(eq(evidence.projectId, projectId))
      .orderBy(evidenceRecency, desc(evidence.createdAt)),

  /**
   * The same light rows, only for Evidence with readable text: what a Render can be drafted
   * from. Mirrors `draftText` in the renders module (pruned, else extracted, else body).
   */
  listSummariesWithText: (db: DbOrTx, projectId: string) =>
    db
      .select(summaryColumns)
      .from(evidence)
      .where(
        and(
          eq(evidence.projectId, projectId),
          sql`btrim(coalesce(${evidence.prunedText}, ${evidence.extractedText}, ${evidence.body}, '')) <> ''`,
        ),
      )
      .orderBy(evidenceRecency, desc(evidence.createdAt)),
};

export type ProjectEvidenceLink = Awaited<ReturnType<typeof evidenceLinksRepo.listForProject>>[number];
export type EvidenceSummary = Awaited<ReturnType<typeof evidenceLinksRepo.listSummaries>>[number];

/** Evidence ↔ Label pairs. Ownership rides on the Evidence row's `projectId`, as with links. */
export const evidenceLabelsRepo = {
  /** Every (evidenceId, labelId) pair in the Project, for the Evidence page and tool summaries. */
  forProject: (db: DbOrTx, projectId: string) =>
    db
      .select({ evidenceId: evidenceLabels.evidenceId, labelId: evidenceLabels.labelId })
      .from(evidenceLabels)
      .innerJoin(evidence, eq(evidence.id, evidenceLabels.evidenceId))
      .where(eq(evidence.projectId, projectId)),

  labelIds: async (db: DbOrTx, evidenceId: string): Promise<string[]> =>
    (
      await db
        .select({ id: evidenceLabels.labelId })
        .from(evidenceLabels)
        .where(eq(evidenceLabels.evidenceId, evidenceId))
    ).map((r) => r.id),

  /** Replace the Evidence item's Label set; caller asserts the ids belong to the Project. */
  setLabels: async (db: DbOrTx, evidenceId: string, labelIds: string[]) => {
    await db.delete(evidenceLabels).where(eq(evidenceLabels.evidenceId, evidenceId));
    if (labelIds.length) await db.insert(evidenceLabels).values(labelIds.map((labelId) => ({ evidenceId, labelId })));
  },

  /** Ids of Evidence carrying ALL of the given Labels; empty input yields an empty set. */
  evidenceIdsWithAllLabels: async (db: DbOrTx, projectId: string, labelIds: string[]): Promise<Set<string>> => {
    if (!labelIds.length) return new Set();
    const rows = await db
      .select({ evidenceId: evidenceLabels.evidenceId })
      .from(evidenceLabels)
      .innerJoin(evidence, eq(evidence.id, evidenceLabels.evidenceId))
      .where(and(eq(evidence.projectId, projectId), inArray(evidenceLabels.labelId, labelIds)))
      .groupBy(evidenceLabels.evidenceId)
      .having(sql`count(distinct ${evidenceLabels.labelId}) = ${labelIds.length}`);
    return new Set(rows.map((r) => r.evidenceId));
  },
};
