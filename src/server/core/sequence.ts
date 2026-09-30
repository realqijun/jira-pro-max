import { eq, max, type Table } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { Tx } from "@/server/db/client";
import { projects } from "@/server/modules/projects/schema";

/**
 * Locks the project row until `tx` ends, so a count-then-insert inside it cannot race a
 * concurrent one under READ COMMITTED.
 */
export async function lockProject(tx: Tx, projectId: string): Promise<void> {
  await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).for("update");
}

/**
 * Next per-project sequence number for `table.number`.
 * Locks the project row so concurrent inserts can't collide.
 */
export async function nextNumber(
  tx: Tx,
  projectId: string,
  table: Table,
  numberCol: PgColumn,
  projectCol: PgColumn,
): Promise<number> {
  await lockProject(tx, projectId);
  const [row] = await tx
    .select({ max: max(numberCol) })
    .from(table)
    .where(eq(projectCol, projectId));
  return (Number(row?.max) || 0) + 1;
}
