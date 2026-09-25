/**
 * Fixed domain vocabulary. Anything here is system-defined and stable;
 * user-customisable vocabulary (Statuses, Labels) lives in the database
 * and maps onto these values. See CONTEXT.md and docs/adr/0003.
 */

export const TASK_STATUS_CATEGORIES = ["not_started", "in_progress", "blocked", "done", "cancelled"] as const;
export type TaskStatusCategory = (typeof TASK_STATUS_CATEGORIES)[number];

export const MILESTONE_STATUS_CATEGORIES = ["planned", "at_risk", "reached", "missed"] as const;
export type MilestoneStatusCategory = (typeof MILESTONE_STATUS_CATEGORIES)[number];

export const RISK_STATUS_CATEGORIES = ["open", "monitoring", "mitigated", "closed"] as const;
export type RiskStatusCategory = (typeof RISK_STATUS_CATEGORIES)[number];

export const STATUS_CATEGORIES = [
  ...TASK_STATUS_CATEGORIES,
  ...MILESTONE_STATUS_CATEGORIES,
  ...RISK_STATUS_CATEGORIES,
] as const;
export type StatusCategory = (typeof STATUS_CATEGORIES)[number];

/** Items a Decision may lead to (`leads_to` edge targets, ADR 0008). */
export const CONSEQUENCE_TYPES = ["task", "milestone", "risk"] as const;
export type ConsequenceType = (typeof CONSEQUENCE_TYPES)[number];

/** Which kind of item a Status applies to. */
export const STATUS_SCOPES = ["task", "milestone", "risk"] as const;
export type StatusScope = (typeof STATUS_SCOPES)[number];

export const CATEGORIES_BY_SCOPE: Record<StatusScope, readonly StatusCategory[]> = {
  task: TASK_STATUS_CATEGORIES,
  milestone: MILESTONE_STATUS_CATEGORIES,
  risk: RISK_STATUS_CATEGORIES,
};

/** Categories that mean "this item is finished, nothing more will happen". */
export const TERMINAL_CATEGORIES: ReadonlySet<StatusCategory> = new Set([
  "done",
  "cancelled",
  "reached",
  "missed",
  "mitigated",
  "closed",
]);

export const PROJECT_STATUSES = ["active", "on_hold", "completed", "archived"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const HEALTH_LEVELS = ["green", "amber", "red"] as const;
export type HealthLevel = (typeof HEALTH_LEVELS)[number];

export const PRIORITIES = ["none", "low", "medium", "high", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const SCALE_LEVELS = ["low", "medium", "high"] as const;
export type ScaleLevel = (typeof SCALE_LEVELS)[number];

/** Risk severity is probability x impact on a 1..3 scale, so 1..9. */
export const RISK_SEVERITY_SCORE: Record<ScaleLevel, number> = { low: 1, medium: 2, high: 3 };
export const riskSeverity = (r: { probability: ScaleLevel; impact: ScaleLevel }) =>
  RISK_SEVERITY_SCORE[r.probability] * RISK_SEVERITY_SCORE[r.impact];
/**
 * Severity bands. The top band starts at Medium x High (6) — the threshold the Risk Register and
 * Project Overview already render red; the Attention rule `risk_top` uses the same constant.
 */
export const RISK_TOP_SEVERITY = RISK_SEVERITY_SCORE.medium * RISK_SEVERITY_SCORE.high;
export const RISK_MID_SEVERITY = RISK_SEVERITY_SCORE.low * RISK_SEVERITY_SCORE.high;

/** Endpoints a Dependency may connect. */
export const DEPENDENCY_ITEM_TYPES = ["task", "milestone"] as const;
export type DependencyItemType = (typeof DEPENDENCY_ITEM_TYPES)[number];

/** Only finish-to-start today; column exists so other types are additive. */
export const DEPENDENCY_TYPES = ["finish_to_start"] as const;
export type DependencyType = (typeof DEPENDENCY_TYPES)[number];

export const EVIDENCE_KINDS = [
  "plan",
  "minutes",
  "transcript",
  "status_update",
  "task_export",
  "risk_register",
  "other",
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

/** Entity types that appear in Activity Events and Dependencies. */
export const ENTITY_TYPES = [
  "project",
  "task",
  "milestone",
  "dependency",
  "risk",
  "evidence",
  "person",
  "team",
  "label",
  "status",
  "comment",
  "decision",
  "assumption",
  "room",
  "participant",
  "chat_message",
  "render",
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

/** Entity types a Comment (and, later, an Evidence link) may attach to. */
export const COMMENTABLE_ENTITY_TYPES = ["task", "risk", "milestone"] as const satisfies readonly EntityType[];
export type CommentableEntityType = (typeof COMMENTABLE_ENTITY_TYPES)[number];
export const COMMENT_MAX_LENGTH = 4000;

/**
 * How much of a Room's history is read at a time (issue #60): the newest page the route
 * renders, and each older page the pane pulls in as the reader scrolls back.
 *
 * Here rather than in the messaging service because the pane needs them too, and a client
 * component must not import a server module. The ceiling on what any caller may ask for is
 * `MESSAGE_PAGE_MAX`, which stays on the server - it is a limit, not shared vocabulary.
 */
export const MESSAGE_PAGE_FIRST = 50;
export const MESSAGE_PAGE_MORE = 20;

/**
 * How an open pane learns what the other side said (issue #59, ADR 0011): it asks for the
 * Chat Messages written after the newest one it holds, every `MESSAGE_POLL_MS`.
 *
 * The cursor is moved back by `MESSAGE_POLL_OVERLAP_MS` first, and that is not a safety
 * margin - it is load-bearing. `room_messages.created_at` defaults to `now()`, which is the
 * writing transaction's *start* time, so a transaction that began earlier and committed
 * later leaves a row below a cursor the reader has already passed, where a strict cursor
 * would never see it again. Re-reading the last few seconds costs nothing: the pane unions
 * by id, so a row it already has is dropped on arrival.
 */
export const MESSAGE_POLL_MS = 4000;
export const MESSAGE_POLL_OVERLAP_MS = 10_000;

/** Items an Evidence record can be linked to (same set as Comments). */
export const LINKABLE_ENTITY_TYPES = COMMENTABLE_ENTITY_TYPES;
export type LinkableEntityType = CommentableEntityType;

export const ACTIVITY_ACTIONS = ["created", "updated", "deleted"] as const;
export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];

/** Who acted on the User's behalf (ADR 0007); `system` is deterministic detection (ADR 0008); a normal UI action has no `via`. */
export const VIA_ACTORS = ["assistant", "reflection", "system"] as const;
export type Via = (typeof VIA_ACTORS)[number];

/** Who wrote a Profile or Working Memory version: the User by hand, or Reflection. */
export const MEMORY_AUTHORS = ["user", "reflection"] as const;
export type MemoryAuthor = (typeof MEMORY_AUTHORS)[number];

/** Who wrote a Message in a Conversation. */
export const MESSAGE_ROLES = ["user", "assistant", "system"] as const;
export type MessageRole = (typeof MESSAGE_ROLES)[number];

// ---------------------------------------------------------------------------
// Decision memory (ADR 0008). Two node types, typed edges, sourced records.
// ---------------------------------------------------------------------------
export const DECISION_STATUSES = ["active", "superseded", "revisited"] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

export const ASSUMPTION_SUBTYPES = ["date", "person", "dependency", "external_rule"] as const;
export type AssumptionSubtype = (typeof ASSUMPTION_SUBTYPES)[number];

export const ASSUMPTION_STATES = ["holding", "broken", "retired"] as const;
export type AssumptionState = (typeof ASSUMPTION_STATES)[number];

/** What an Assumption watches; `external_rule` has no target. */
export const ASSUMPTION_TARGET_TYPES = ["task", "milestone", "person", "dependency"] as const;
export type AssumptionTargetType = (typeof ASSUMPTION_TARGET_TYPES)[number];

/** Which date of a Task or Milestone a date Assumption watches; matches Activity Event `field` values. */
export const DATE_TARGET_FIELDS = ["startDate", "dueDate"] as const;
export type DateTargetField = (typeof DATE_TARGET_FIELDS)[number];

/** Edge direction is always cause to consequence. */
export const DECISION_EDGE_KINDS = ["supports", "leads_to", "superseded_by"] as const;
export type DecisionEdgeKind = (typeof DECISION_EDGE_KINDS)[number];

/** Nodes the graph view can be centred on (issue #41); Tasks appear as nodes but only open their record. */
export const GRAPH_CENTRE_TYPES = ["decision", "assumption", "milestone", "risk"] as const;
export type GraphCentreType = (typeof GRAPH_CENTRE_TYPES)[number];

/** What a Source may cite; its own vocabulary because an Activity Event is not an entity type. */
export const SOURCE_KINDS = ["evidence", "comment", "activity_event"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];
export const SOURCE_EXCERPT_MAX = 500;

/** A Proposal is the Assistant's candidate Decision; it enters the graph only when accepted. */
export const PROPOSAL_STATUSES = ["pending", "accepted", "rejected"] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];
export const PROPOSAL_EXTRACTORS = ["model", "heuristic"] as const;
export type ProposalExtractor = (typeof PROPOSAL_EXTRACTORS)[number];

// ---------------------------------------------------------------------------
// Messaging (issue #61, ADR 0009). A Room holds Chat Messages between the PM
// and the People they admit. "Message" is reserved for an Assistant turn.
// ---------------------------------------------------------------------------
/** A group Room has a name and many Participants; a one_to_one Room is the PM and exactly one Person. */
export const ROOM_TYPES = ["group", "one_to_one"] as const;
export type RoomType = (typeof ROOM_TYPES)[number];

/** LLM providers supported by a User's personal Assistant configuration. */
export const AI_PROVIDERS = ["openai", "anthropic", "google", "openai_compatible"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export const AI_PROVIDER_LABELS: Record<AiProvider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google Gemini",
  openai_compatible: "OpenAI-compatible",
};

// ---------------------------------------------------------------------------
// Concept renders. A Render is a generated picture of what a Project delivers,
// so the PM and the people building it argue about one image instead of one
// paragraph each. It is an illustration of intent, never a measured drawing.
// ---------------------------------------------------------------------------
/**
 * Where a Render is in its life. "State" rather than "Status" on purpose: a Status is
 * user-defined and maps to a Status Category (ADR 0003), and a Render has neither.
 */
export const RENDER_STATES = ["pending", "ready", "failed"] as const;
export type RenderState = (typeof RENDER_STATES)[number];

/** Per-Project ceiling. A generated image costs money and nobody needs eleven of them. */
export const RENDER_MAX_PER_PROJECT = 10;
export const RENDER_PROMPT_MAX = 1000;

/**
 * A pending Render is waited on the same way a Chat Message is (ADR 0011): the page asks
 * again rather than holding a connection open. Generation takes roughly 5 to 30 seconds,
 * so the interval is longer than messaging's and the poll stops as soon as nothing is pending.
 */
export const RENDER_POLL_MS = 2500;
/** A Render still pending after this long is presumed dead; the poll gives up and says so. */
export const RENDER_POLL_GIVE_UP_MS = 180_000;

export const labelFor = (value: string) => value.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

// ---------------------------------------------------------------------------
// Attention (issue #7). Order IS severity order; adding a rule is a vocabulary change.
// ---------------------------------------------------------------------------
export const ATTENTION_RULES = [
  "assumption_broken",
  "task_overdue",
  "dependency_late",
  "milestone_past_open",
  "task_blocked",
  "risk_top",
  "task_due_soon",
] as const;
export type AttentionRule = (typeof ATTENTION_RULES)[number];
/** `task_due_soon` window in calendar days, inclusive of today and today + N. */
export const ATTENTION_DUE_SOON_DAYS = 7;

export * from "./history-fields";
