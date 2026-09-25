import { boolean, index, pgTable, text } from "drizzle-orm/pg-core";
import { user } from "@/server/auth/schema";
import { id, timestamps } from "@/server/db/columns";
import { aiProviderEnum } from "@/server/db/enums";

/**
 * A User-owned credential, deliberately outside Project Activity Events.
 * A User keeps several configurations and marks one `isDefault`; a Conversation
 * may pin a different one (conversations.ai_config_id) for per-chat model switching.
 */
export const userAiConfigs = pgTable(
  "user_ai_configs",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: aiProviderEnum("provider").notNull(),
    model: text("model").notNull(),
    baseUrl: text("base_url"),
    encryptedApiKey: text("encrypted_api_key").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    ...timestamps,
  },
  (t) => [index("user_ai_configs_user_idx").on(t.userId)],
);

export type UserAiConfigRow = typeof userAiConfigs.$inferSelect;
