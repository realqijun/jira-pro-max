import { and, desc, eq, isNull } from "drizzle-orm";
import type { Ctx } from "@/server/core/context";
import { ForbiddenError } from "@/server/core/errors";
import { hashToken, randomToken } from "@/server/core/token";
import type { DbOrTx } from "@/server/db/client";
import { apiTokens } from "./schema";

const PREFIX = "prismpm_";

/** Personal access tokens are the User's own credentials, not Project items: no Activity Event, no `mutate`. */
export const apiTokensService = {
  /** Newest first; never includes the hash. */
  list: (ctx: Ctx) =>
    ctx.db
      .select({
        id: apiTokens.id,
        label: apiTokens.label,
        prefix: apiTokens.prefix,
        createdAt: apiTokens.createdAt,
        lastUsedAt: apiTokens.lastUsedAt,
        revokedAt: apiTokens.revokedAt,
      })
      .from(apiTokens)
      .where(eq(apiTokens.userId, ctx.userId))
      .orderBy(desc(apiTokens.createdAt)),

  /** The raw token is returned exactly once, here. */
  create: async (ctx: Ctx, label: string) => {
    const token = PREFIX + randomToken();
    const [row] = await ctx.db
      .insert(apiTokens)
      .values({
        userId: ctx.userId,
        label: label.trim() || "Untitled",
        tokenHash: hashToken(token),
        prefix: token.slice(0, 12),
      })
      .returning();
    return { token, row: row! };
  },

  revoke: async (ctx: Ctx, id: string) => {
    const [row] = await ctx.db
      .update(apiTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiTokens.id, id), eq(apiTokens.userId, ctx.userId), isNull(apiTokens.revokedAt)))
      .returning({ id: apiTokens.id });
    if (!row) throw new ForbiddenError("Token not found");
  },

  /** The User a live `prismpm_` token belongs to, or null. Touches `lastUsedAt`. */
  resolve: async (db: DbOrTx, token: string): Promise<string | null> => {
    if (!token.startsWith(PREFIX)) return null;
    const [row] = await db
      .update(apiTokens)
      .set({ lastUsedAt: new Date() })
      .where(and(eq(apiTokens.tokenHash, hashToken(token)), isNull(apiTokens.revokedAt)))
      .returning({ userId: apiTokens.userId });
    return row?.userId ?? null;
  },
};
