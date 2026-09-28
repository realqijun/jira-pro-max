import { and, asc, count, desc, eq, gte, isNull, ne, notInArray, sql } from "drizzle-orm";
import type { DbOrTx } from "@/server/db/client";
import { conversations, messages, toolPermissions, type ConversationRow } from "./schema";

const scopeWhere = (userId: string, projectId: string | null) =>
  and(
    eq(conversations.userId, userId),
    projectId ? eq(conversations.projectId, projectId) : isNull(conversations.projectId),
  );

export const conversationsRepo = {
  /** A User's Conversations in one scope, pinned first then most recently touched. */
  listByScope: (db: DbOrTx, userId: string, projectId: string | null) =>
    db
      .select()
      .from(conversations)
      .where(scopeWhere(userId, projectId))
      .orderBy(desc(conversations.pinned), desc(conversations.updatedAt), desc(conversations.createdAt)),

  /** A User's Conversations across every scope, pinned first then most recently touched. */
  listAll: (db: DbOrTx, userId: string) =>
    db
      .select()
      .from(conversations)
      .where(eq(conversations.userId, userId))
      .orderBy(desc(conversations.pinned), desc(conversations.updatedAt), desc(conversations.createdAt)),

  /** The most recently touched Conversation regardless of pinning. */
  latest: async (db: DbOrTx, userId: string, projectId: string | null): Promise<ConversationRow | undefined> => {
    const [row] = await db
      .select()
      .from(conversations)
      .where(scopeWhere(userId, projectId))
      .orderBy(desc(conversations.updatedAt), desc(conversations.createdAt))
      .limit(1);
    return row;
  },

  create: async (db: DbOrTx, userId: string, projectId: string | null): Promise<ConversationRow> => {
    const [row] = await db.insert(conversations).values({ userId, projectId }).returning();
    return row!;
  },

  findById: async (db: DbOrTx, id: string): Promise<ConversationRow | undefined> => {
    const [row] = await db.select().from(conversations).where(eq(conversations.id, id));
    return row;
  },

  touch: (db: DbOrTx, id: string) =>
    db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, id)),

  // Metadata writes keep `updatedAt` as-is: it tracks activity, not bookkeeping.
  setTitle: (db: DbOrTx, id: string, title: string) =>
    db.update(conversations).set({ title, updatedAt: conversations.updatedAt }).where(eq(conversations.id, id)),

  setPinned: (db: DbOrTx, id: string, pinned: boolean) =>
    db.update(conversations).set({ pinned, updatedAt: conversations.updatedAt }).where(eq(conversations.id, id)),

  setAiConfig: (db: DbOrTx, id: string, aiConfigId: string | null) =>
    db.update(conversations).set({ aiConfigId, updatedAt: conversations.updatedAt }).where(eq(conversations.id, id)),

  /** Re-scope a Conversation onto a Project (or back to the dashboard with null). Bumps updatedAt so it opens first there. */
  setProject: (db: DbOrTx, id: string, projectId: string | null) =>
    db.update(conversations).set({ projectId }).where(eq(conversations.id, id)),

  /** Hard delete; Messages cascade. */
  remove: (db: DbOrTx, id: string) => db.delete(conversations).where(eq(conversations.id, id)),

  /** Deletes empty Conversations in a scope, keeping `keepId` (the active one) and anything pinned. */
  pruneEmpty: (db: DbOrTx, userId: string, projectId: string | null, keepId: string) =>
    db
      .delete(conversations)
      .where(
        and(
          scopeWhere(userId, projectId),
          ne(conversations.id, keepId),
          eq(conversations.pinned, false),
          sql`not exists (select 1 from ${messages} where ${messages.conversationId} = ${conversations.id})`,
        ),
      )
      .returning({ id: conversations.id }),

  /**
   * Deletes empty Conversations across every scope, keeping any id in `keepIds` (the ones a
   * caller currently has open) and anything pinned.
   */
  pruneAllEmpty: (db: DbOrTx, userId: string, keepIds: string[]) =>
    db
      .delete(conversations)
      .where(
        and(
          eq(conversations.userId, userId),
          keepIds.length ? notInArray(conversations.id, keepIds) : undefined,
          eq(conversations.pinned, false),
          sql`not exists (select 1 from ${messages} where ${messages.conversationId} = ${conversations.id})`,
        ),
      )
      .returning({ id: conversations.id }),
};

export const messagesRepo = {
  /** The first user Message's text in a Conversation - the seed for its title. */
  firstUserText: async (db: DbOrTx, conversationId: string): Promise<string | null> => {
    const [row] = await db
      .select({ parts: messages.parts })
      .from(messages)
      .where(and(eq(messages.conversationId, conversationId), eq(messages.role, "user")))
      .orderBy(asc(messages.seq))
      .limit(1);
    const parts = Array.isArray(row?.parts) ? (row.parts as { type?: string; text?: string }[]) : [];
    const text = parts.find((p) => p.type === "text")?.text;
    return text?.trim() || null;
  },

  /** Thread order: `seq`, never `createdAt`, which ties for Messages saved in one statement. */
  listByConversation: (db: DbOrTx, conversationId: string) =>
    db.select().from(messages).where(eq(messages.conversationId, conversationId)).orderBy(asc(messages.seq)),

  upsertMany: async (db: DbOrTx, rows: (typeof messages.$inferInsert)[]) => {
    // A thread can carry the same client id twice (a re-sent turn); Postgres refuses to upsert
    // one row twice in a statement, so the last occurrence's parts win here (first position kept).
    const unique = [...new Map(rows.map((r) => [`${r.conversationId}:${r.id}`, r])).values()];
    if (!unique.length) return;
    await db
      .insert(messages)
      .values(unique)
      .onConflictDoUpdate({ target: [messages.conversationId, messages.id], set: { parts: sql`excluded.parts` } });
  },

  /** User Messages this User sent since `since`, across all their Conversations. */
  countUserMessagesSince: async (db: DbOrTx, userId: string, since: Date) => {
    const [row] = await db
      .select({ n: count() })
      .from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .where(and(eq(conversations.userId, userId), eq(messages.role, "user"), gte(messages.createdAt, since)));
    return row?.n ?? 0;
  },
};

export const toolPermissionsRepo = {
  /** Tool names the User always-allowed in this scope (`projectId` null = dashboard). */
  listToolNames: async (db: DbOrTx, userId: string, projectId: string | null): Promise<string[]> => {
    const rows = await db
      .select({ toolName: toolPermissions.toolName })
      .from(toolPermissions)
      .where(
        and(
          eq(toolPermissions.userId, userId),
          projectId ? eq(toolPermissions.projectId, projectId) : isNull(toolPermissions.projectId),
        ),
      )
      .orderBy(asc(toolPermissions.toolName));
    return rows.map((r) => r.toolName);
  },

  grant: (db: DbOrTx, userId: string, projectId: string | null, toolName: string) =>
    db.insert(toolPermissions).values({ userId, projectId, toolName }).onConflictDoNothing(),

  revoke: (db: DbOrTx, userId: string, projectId: string | null, toolName: string) =>
    db
      .delete(toolPermissions)
      .where(
        and(
          eq(toolPermissions.userId, userId),
          eq(toolPermissions.toolName, toolName),
          projectId ? eq(toolPermissions.projectId, projectId) : isNull(toolPermissions.projectId),
        ),
      ),
};
