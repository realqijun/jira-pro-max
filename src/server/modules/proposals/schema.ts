import { date, index, jsonb, pgTable, primaryKey, text, timestamp, unique } from "drizzle-orm/pg-core";
import { id, timestamps } from "@/server/db/columns";
import {
  itemProposalKindEnum,
  proposalExtractorEnum,
  proposalPassEnum,
  proposalStatusEnum,
  sourceKindEnum,
} from "@/server/db/enums";
import { decisions } from "@/server/modules/decisions/schema";
import { projects } from "@/server/modules/projects/schema";
import type { AssumptionSubtype, AssumptionTargetType, DateTargetField, SourceKind } from "@/shared/domain";

/** A cited passage: which Source and the verbatim sentence the extractor quoted from it. */
export interface ProposedSource {
  kind: SourceKind;
  entityId: string;
  /** The transcript Passage the excerpt sits in, when the Evidence has Passages (issue #42). Not FK-protected. */
  passageId?: string | null;
  excerpt: string;
}

/** A typed Assumption the extractor suggests; targets are resolved by name when accepted. */
export interface ProposedAssumption {
  statement: string;
  subtype: AssumptionSubtype;
  targetType?: AssumptionTargetType | null;
  /** Resolved id when the pass could match the name; the accept path re-checks it. */
  targetId?: string | null;
  targetName?: string | null;
  targetField?: DateTargetField | null;
  assumedUntil?: string | null;
}

/**
 * The Assistant's candidate Decisions (ADR 0008). Its own document, like a Conversation:
 * written without `mutate`; the Activity Events come from the Decision it becomes.
 */
export const decisionProposals = pgTable(
  "decision_proposals",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** sha1 of primary Source, its excerpt and the title; the idempotency key. */
    fingerprint: text("fingerprint").notNull(),
    status: proposalStatusEnum("status").notNull().default("pending"),
    title: text("title").notNull(),
    decidedOn: date("decided_on"),
    context: text("context"),
    chosen: text("chosen").notNull(),
    alternatives: text("alternatives"),
    revisitWhen: text("revisit_when"),
    sources: jsonb("sources").$type<ProposedSource[]>().notNull(),
    assumptions: jsonb("assumptions").$type<ProposedAssumption[]>().notNull().default([]),
    extractor: proposalExtractorEnum("extractor").notNull(),
    decisionId: text("decision_id").references(() => decisions.id, { onDelete: "set null" }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("decision_proposals_project_idx").on(t.projectId, t.status),
    unique("decision_proposals_fingerprint_uq").on(t.projectId, t.fingerprint),
  ],
);

export type ProposalRow = typeof decisionProposals.$inferSelect;
export type NewProposalRow = typeof decisionProposals.$inferInsert;

/** A proposed Task. Each `*Name` is what the extractor wrote; each `*Id` is what it resolved to at pass time. */
export interface ProposedTaskFields {
  title: string;
  description: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  milestoneId: string | null;
  milestoneName: string | null;
  startDate: string | null;
  dueDate: string | null;
}

/** A proposed Milestone; a Milestone is a dated checkpoint, so `dueDate` is required. */
export interface ProposedMilestoneFields {
  name: string;
  description: string | null;
  dueDate: string;
  ownerId: string | null;
  ownerName: string | null;
}

export type ProposedItem =
  { kind: "task"; fields: ProposedTaskFields } | { kind: "milestone"; fields: ProposedMilestoneFields };

/**
 * The Assistant's candidate Tasks and Milestones (ADR 0015). Same class as `decision_proposals`:
 * the Assistant's own document, written without `mutate`. `itemId` is the Task or Milestone an
 * accepted Proposal became; not a foreign key, so it may point at an item deleted since.
 */
export const itemProposals = pgTable(
  "item_proposals",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: itemProposalKindEnum("kind").notNull(),
    /** sha1 of the item kind, the primary Source, its excerpt and the title; the idempotency key. */
    fingerprint: text("fingerprint").notNull(),
    status: proposalStatusEnum("status").notNull().default("pending"),
    fields: jsonb("fields").$type<ProposedTaskFields | ProposedMilestoneFields>().notNull(),
    sources: jsonb("sources").$type<ProposedSource[]>().notNull(),
    extractor: proposalExtractorEnum("extractor").notNull(),
    itemId: text("item_id"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("item_proposals_project_idx").on(t.projectId, t.status),
    unique("item_proposals_fingerprint_uq").on(t.projectId, t.fingerprint),
  ],
);

export type ItemProposalRow = typeof itemProposals.$inferSelect;
export type NewItemProposalRow = typeof itemProposals.$inferInsert;

/** Which Sources each extractor call has already read, keyed by the hash of the text it saw. */
export const proposalPassSources = pgTable(
  "proposal_pass_sources",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    pass: proposalPassEnum("pass").notNull().default("decision"),
    kind: sourceKindEnum("kind").notNull(),
    entityId: text("entity_id").notNull(),
    textHash: text("text_hash").notNull(),
    passedAt: timestamp("passed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.pass, t.kind, t.entityId] })],
);

export type ProposalPassSourceRow = typeof proposalPassSources.$inferSelect;
