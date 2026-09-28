import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import type { DbOrTx } from "@/server/db/client";
import type { ProposalStatus, SourceKind } from "@/shared/domain";
import { decisionProposals, proposalPassSources, type NewProposalRow, type ProposalRow } from "./schema";

export const proposalsRepo = {
  listByProject: (db: DbOrTx, projectId: string, status?: ProposalStatus) =>
    db
      .select()
      .from(decisionProposals)
      .where(
        status
          ? and(eq(decisionProposals.projectId, projectId), eq(decisionProposals.status, status))
          : eq(decisionProposals.projectId, projectId),
      )
      // One pass inserts its Proposals in one statement, so they share `createdAt`; `id` breaks the tie
      // so review steps through them in a stable order.
      .orderBy(desc(decisionProposals.createdAt), desc(decisionProposals.id)),

  findById: async (db: DbOrTx, id: string): Promise<ProposalRow | undefined> => {
    const [row] = await db.select().from(decisionProposals).where(eq(decisionProposals.id, id));
    return row;
  },

  /** Insert, skipping fingerprints already known to the Project (any status). Returns the new rows. */
  insertMany: (db: DbOrTx, values: NewProposalRow[]) =>
    values.length
      ? db
          .insert(decisionProposals)
          .values(values)
          .onConflictDoNothing({ target: [decisionProposals.projectId, decisionProposals.fingerprint] })
          .returning()
      : Promise.resolve([] as ProposalRow[]),

  update: async (db: DbOrTx, id: string, patch: Partial<NewProposalRow>) => {
    const [row] = await db.update(decisionProposals).set(patch).where(eq(decisionProposals.id, id)).returning();
    return row!;
  },

  /** Called by `decisionsService.create` inside its transaction when a Proposal becomes a Decision. */
  markAccepted: (db: DbOrTx, id: string, decisionId: string) =>
    db
      .update(decisionProposals)
      .set({ status: "accepted", decisionId, resolvedAt: new Date() })
      .where(and(eq(decisionProposals.id, id), eq(decisionProposals.status, "pending")))
      .returning(),

  /** Same atomic guard as `markAccepted`: only a pending Proposal can be rejected. */
  markRejected: (db: DbOrTx, id: string) =>
    db
      .update(decisionProposals)
      .set({ status: "rejected", resolvedAt: new Date() })
      .where(and(eq(decisionProposals.id, id), eq(decisionProposals.status, "pending")))
      .returning(),

  countsByStatus: async (db: DbOrTx, projectId: string) => {
    const rows = await db
      .select({ status: decisionProposals.status, n: count() })
      .from(decisionProposals)
      .where(eq(decisionProposals.projectId, projectId))
      .groupBy(decisionProposals.status);
    const out: Record<ProposalStatus, number> = { pending: 0, accepted: 0, rejected: 0 };
    for (const r of rows) out[r.status] = Number(r.n);
    return out;
  },
};

export const passSourcesRepo = {
  listForProject: (db: DbOrTx, projectId: string) =>
    db.select().from(proposalPassSources).where(eq(proposalPassSources.projectId, projectId)),

  upsertMany: (db: DbOrTx, rows: Array<{ projectId: string; kind: SourceKind; entityId: string; textHash: string }>) =>
    rows.length
      ? db
          .insert(proposalPassSources)
          .values(rows)
          .onConflictDoUpdate({
            target: [proposalPassSources.projectId, proposalPassSources.kind, proposalPassSources.entityId],
            set: { textHash: sql`excluded.text_hash`, passedAt: new Date() },
          })
      : Promise.resolve(),

  deleteFor: (db: DbOrTx, projectId: string, kind: SourceKind, entityIds: string[]) =>
    entityIds.length
      ? db
          .delete(proposalPassSources)
          .where(
            and(
              eq(proposalPassSources.projectId, projectId),
              eq(proposalPassSources.kind, kind),
              inArray(proposalPassSources.entityId, entityIds),
            ),
          )
      : Promise.resolve(),
};
