import { bigserial, boolean, index, jsonb, pgTable, primaryKey, text, timestamp, unique } from "drizzle-orm/pg-core";
import { user } from "@/server/auth/schema";
import { id, timestamps } from "@/server/db/columns";
import { messageRoleEnum } from "@/server/db/enums";
import { userAiConfigs } from "@/server/modules/ai-config/schema";
import { projects } from "@/server/modules/projects/schema";

/**
 * One thread between a User and the Assistant about one Project (or none, on the dashboard).
 * A User may keep several per scope and resume any of them; `title` is derived from the first
 * user Message when it is saved.
 */
export const conversations = pgTable(
  "conversations",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
    /** The credential this thread answers with; null falls back to the User default / env. */
    aiConfigId: text("ai_config_id").references(() => userAiConfigs.id, { onDelete: "set null" }),
    title: text("title"),
    pinned: boolean("pinned").notNull().default(false),
    ...timestamps,
  },
  (t) => [index("conversations_scope_idx").on(t.userId, t.projectId, t.updatedAt)],
);

/**
 * One turn, stored in the AI SDK UIMessage shape: text and tool calls/results live in `parts`.
 * `id` is the client-generated UIMessage id, so it is only unique within its Conversation.
 */
export const messages = pgTable(
  "messages",
  {
    id: text("id").notNull(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: messageRoleEnum("role").notNull(),
    parts: jsonb("parts").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * Thread order. A turn saves several Messages in one statement, so they share `createdAt`;
     * `seq` is assigned in insert order and kept when a Message is rewritten.
     */
    seq: bigserial("seq", { mode: "number" }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.conversationId, t.id] }),
    index("messages_conversation_time_idx").on(t.conversationId, t.createdAt),
    index("messages_conversation_seq_idx").on(t.conversationId, t.seq),
  ],
);

/**
 * A standing approval ("always allow") the User granted for one write tool in one scope:
 * a Project, or the dashboard when `projectId` is null (ADR 0011).
 */
export const toolPermissions = pgTable(
  "tool_permissions",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
    toolName: text("tool_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("tool_permissions_user_project_tool_unique").on(t.userId, t.projectId, t.toolName).nullsNotDistinct()],
);

export type ConversationRow = typeof conversations.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type ToolPermissionRow = typeof toolPermissions.$inferSelect;
