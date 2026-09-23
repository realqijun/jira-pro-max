import { and, count, desc, eq } from "drizzle-orm";
import type { DbOrTx } from "@/server/db/client";
import { renders, type NewRenderRow, type RenderRow } from "./schema";

export const rendersRepo = {
  listByProject: (db: DbOrTx, projectId: string): Promise<RenderRow[]> =>
    db.select().from(renders).where(eq(renders.projectId, projectId)).orderBy(desc(renders.createdAt)),

  /** Just the fields the poll compares, so waiting for one image does not re-read every prompt. */
  listStates: (db: DbOrTx, projectId: string) =>
    db
      .select({ id: renders.id, state: renders.state, error: renders.error, updatedAt: renders.updatedAt })
      .from(renders)
      .where(eq(renders.projectId, projectId))
      .orderBy(desc(renders.createdAt)),

  findById: async (db: DbOrTx, id: string): Promise<RenderRow | undefined> => {
    const [row] = await db.select().from(renders).where(eq(renders.id, id));
    return row;
  },

  countForProject: async (db: DbOrTx, projectId: string): Promise<number> => {
    const [row] = await db.select({ n: count() }).from(renders).where(eq(renders.projectId, projectId));
    return row?.n ?? 0;
  },

  insert: async (db: DbOrTx, values: NewRenderRow) => {
    const [row] = await db.insert(renders).values(values).returning();
    return row!;
  },

  update: async (db: DbOrTx, id: string, patch: Partial<NewRenderRow>) => {
    const [row] = await db.update(renders).set(patch).where(eq(renders.id, id)).returning();
    return row!;
  },

  /**
   * Settle a Render only while it is still pending, so a late generation cannot overwrite a
   * row the PM already deleted and re-created. Returns undefined when it was not pending.
   */
  settleIfPending: async (db: DbOrTx, id: string, patch: Partial<NewRenderRow>): Promise<RenderRow | undefined> => {
    const [row] = await db
      .update(renders)
      .set(patch)
      .where(and(eq(renders.id, id), eq(renders.state, "pending")))
      .returning();
    return row;
  },

  delete: (db: DbOrTx, id: string) => db.delete(renders).where(eq(renders.id, id)),
};

export type RenderStateRow = Awaited<ReturnType<typeof rendersRepo.listStates>>[number];
