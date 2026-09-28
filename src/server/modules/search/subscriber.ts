import { db } from "@/server/db/client";
import { eventBus, type DomainEvent } from "@/server/events/bus";
import { evidenceRepo } from "@/server/modules/evidence/repository";
import { searchService } from "./service";

/** Fields whose change means the indexable text changed; label/notes edits skip re-embedding. */
const TEXT_FIELDS = new Set(["body", "extractedText", "prunedText"]);

const resync = (event: DomainEvent) =>
  (async () => {
    const row = await evidenceRepo.findById(db, event.entityId);
    if (row) await searchService.syncEvidence(row);
    else searchService.dropIndex(event.projectId);
  })().catch((e) => console.error("[search] indexing failed", event.name, event.entityId, e));

const globalForSearch = globalThis as unknown as { __searchRegistered?: boolean };

/** Idempotent: safe to call from `ensureSubscribers` and from tests. */
export function registerEvidenceIndexer() {
  if (globalForSearch.__searchRegistered) return;
  globalForSearch.__searchRegistered = true;
  eventBus.subscribe("evidence.created", resync);
  eventBus.subscribe("evidence.updated", (e) => {
    if (e.changes.some((c) => TEXT_FIELDS.has(c.field))) resync(e);
  });
  // Rows and chunks are gone by cascade; only the cached index needs dropping.
  eventBus.subscribe("evidence.deleted", (e) => searchService.dropIndex(e.projectId));
  eventBus.subscribe("project.deleted", (e) => searchService.dropIndex(e.projectId));
}
