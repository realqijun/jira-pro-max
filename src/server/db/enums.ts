import { pgEnum } from "drizzle-orm/pg-core";
import {
  ACTIVITY_ACTIONS,
  ASSUMPTION_STATES,
  ASSUMPTION_SUBTYPES,
  ASSUMPTION_TARGET_TYPES,
  DATE_TARGET_FIELDS,
  DECISION_EDGE_KINDS,
  DECISION_STATUSES,
  DEPENDENCY_ITEM_TYPES,
  DEPENDENCY_TYPES,
  ENTITY_TYPES,
  EVIDENCE_KINDS,
  HEALTH_LEVELS,
  MEMORY_AUTHORS,
  MESSAGE_ROLES,
  PRIORITIES,
  PROJECT_STATUSES,
  PROPOSAL_EXTRACTORS,
  PROPOSAL_STATUSES,
  AI_PROVIDERS,
  RENDER_STATES,
  ROOM_TYPES,
  SCALE_LEVELS,
  SOURCE_KINDS,
  STATUS_CATEGORIES,
  STATUS_SCOPES,
  VIA_ACTORS,
} from "@/shared/domain";

export const statusScopeEnum = pgEnum("status_scope", STATUS_SCOPES);
export const statusCategoryEnum = pgEnum("status_category", STATUS_CATEGORIES);
export const projectStatusEnum = pgEnum("project_status", PROJECT_STATUSES);
export const healthLevelEnum = pgEnum("health_level", HEALTH_LEVELS);
export const priorityEnum = pgEnum("priority", PRIORITIES);
export const scaleLevelEnum = pgEnum("scale_level", SCALE_LEVELS);
export const dependencyItemTypeEnum = pgEnum("dependency_item_type", DEPENDENCY_ITEM_TYPES);
export const dependencyTypeEnum = pgEnum("dependency_type", DEPENDENCY_TYPES);
export const evidenceKindEnum = pgEnum("evidence_kind", EVIDENCE_KINDS);
export const entityTypeEnum = pgEnum("entity_type", ENTITY_TYPES);
export const activityActionEnum = pgEnum("activity_action", ACTIVITY_ACTIONS);
export const viaActorEnum = pgEnum("via_actor", VIA_ACTORS);
export const messageRoleEnum = pgEnum("message_role", MESSAGE_ROLES);
export const memoryAuthorEnum = pgEnum("memory_author", MEMORY_AUTHORS);
export const decisionStatusEnum = pgEnum("decision_status", DECISION_STATUSES);
export const assumptionSubtypeEnum = pgEnum("assumption_subtype", ASSUMPTION_SUBTYPES);
export const assumptionStateEnum = pgEnum("assumption_state", ASSUMPTION_STATES);
export const assumptionTargetTypeEnum = pgEnum("assumption_target_type", ASSUMPTION_TARGET_TYPES);
export const dateTargetFieldEnum = pgEnum("date_target_field", DATE_TARGET_FIELDS);
export const decisionEdgeKindEnum = pgEnum("decision_edge_kind", DECISION_EDGE_KINDS);
export const sourceKindEnum = pgEnum("source_kind", SOURCE_KINDS);
export const proposalStatusEnum = pgEnum("proposal_status", PROPOSAL_STATUSES);
export const proposalExtractorEnum = pgEnum("proposal_extractor", PROPOSAL_EXTRACTORS);
export const roomTypeEnum = pgEnum("room_type", ROOM_TYPES);
export const aiProviderEnum = pgEnum("ai_provider", AI_PROVIDERS);
export const renderStateEnum = pgEnum("render_state", RENDER_STATES);
