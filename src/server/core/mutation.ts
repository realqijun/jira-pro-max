import { randomUUID } from "node:crypto";
import type { Db, Tx } from "@/server/db/client";
import { activityEvents, type NewActivityEventRow } from "@/server/modules/activity/schema";
import { eventBus, type DomainEvent, type DomainEventName } from "@/server/events/bus";
import { ensureSubscribers } from "@/server/events/subscribers";
import type { EntityType, Via } from "@/shared/domain";
import type { Ctx, ParticipantCtx } from "./context";
import type { FieldChange } from "./diff";

/**
 * Collects Activity Events during a transaction, writes them before commit,
 * and publishes the corresponding domain events after commit.
 */
export class Recorder {
  private pending: DomainEvent[] = [];
  private signals: DomainEvent[] = [];

  /**
   * `actorId` is null when the mutation is a Participant's (ADR 0009): a Person has no `user`
   * row, and `activity_events.actor_id` is a foreign key to one. Such a mutation may signal
   * and may not record; `push` refuses the rest.
   */
  constructor(
    private readonly actorId: string | null,
    private readonly via: Via | null = null,
  ) {}

  /** `snapshot`, when given, is stored as the Activity Event's `newValue` (e.g. a Comment body). */
  created(entityType: EntityType, projectId: string, entityId: string, entityLabel: string, snapshot?: unknown) {
    this.push(entityType, projectId, entityId, entityLabel, "created", [], snapshot);
  }

  updated(entityType: EntityType, projectId: string, entityId: string, entityLabel: string, changes: FieldChange[]) {
    if (changes.length) this.push(entityType, projectId, entityId, entityLabel, "updated", changes);
  }

  /** `snapshot`, when given, is stored as the Activity Event's `oldValue` so history keeps the content. */
  deleted(entityType: EntityType, projectId: string, entityId: string, entityLabel: string, snapshot?: unknown) {
    this.push(entityType, projectId, entityId, entityLabel, "deleted", [], snapshot);
  }

  /** Queue a domain event that has no Activity Event of its own (published after commit, not persisted). */
  signal(
    name: DomainEventName,
    e: Pick<DomainEvent, "projectId" | "entityType" | "entityId" | "entityLabel" | "changes"> &
      Partial<Pick<DomainEvent, "action">>,
  ) {
    this.signals.push({
      ...e,
      name,
      action: e.action ?? "updated",
      actorId: this.actorId,
      via: this.via,
      occurredAt: new Date(),
    });
  }

  private push(
    entityType: EntityType,
    projectId: string,
    entityId: string,
    entityLabel: string,
    action: DomainEvent["action"],
    changes: FieldChange[],
    snapshot?: unknown,
  ) {
    // A programmer error, not a domain one: the caller chose an actor-less mutation and then
    // asked it to write history nobody can be named in. Thrown here, inside the transaction
    // and before `flush`, so whatever the service already inserted rolls back with it.
    if (this.actorId === null) {
      throw new Error(`An actor-less mutation cannot record ${entityType}.${action}; use rec.signal`);
    }
    this.pending.push({
      name: `${entityType}.${action}`,
      projectId,
      actorId: this.actorId,
      via: this.via,
      entityType,
      entityId,
      entityLabel,
      action,
      changes,
      snapshot,
      occurredAt: new Date(),
    });
  }

  async flush(tx: Tx) {
    // One row per created/deleted event and one per change of an updated event. Ids are
    // generated here so each event/change knows its row without relying on RETURNING order.
    const rows: NewActivityEventRow[] = this.pending.flatMap((e) => {
      const base = {
        projectId: e.projectId,
        actorId: e.actorId,
        via: e.via,
        entityType: e.entityType,
        entityId: e.entityId,
        entityLabel: e.entityLabel,
        action: e.action,
        occurredAt: e.occurredAt,
      };
      if (e.action !== "updated") {
        e.activityEventId = randomUUID();
        const row = { ...base, id: e.activityEventId };
        if (e.snapshot === undefined) return [row];
        return [{ ...row, ...(e.action === "created" ? { newValue: e.snapshot } : { oldValue: e.snapshot }) }];
      }
      return e.changes.map((c) => {
        c.activityEventId = randomUUID();
        return { ...base, id: c.activityEventId, field: c.field, oldValue: c.oldValue, newValue: c.newValue };
      });
    });
    if (rows.length) await tx.insert(activityEvents).values(rows);
  }

  async publish() {
    await ensureSubscribers();
    const events = [...this.pending, ...this.signals];
    this.pending = [];
    this.signals = [];
    await eventBus.publish(events);
  }
}

/** More writes a caller adds to a service's create, in the same transaction and under the same `Recorder`. */
export type AfterCreate<T> = (tx: Tx, rec: Recorder, created: T) => Promise<void>;

/** Run `fn` in a transaction; activity is persisted with it and events published on commit. */
export function mutate<T>(ctx: Ctx, fn: (tx: Tx, rec: Recorder) => Promise<T>): Promise<T> {
  return run(ctx.db, ctx.userId, ctx.via ?? null, fn);
}

/**
 * The same, for the one audience that is not a User (ADR 0009). A Participant's mutation can
 * only `rec.signal`, which is all a Chat Message needs (ADR 0010); `Recorder` refuses the rest.
 *
 * A separate function rather than a `Ctx | ParticipantCtx` parameter on `mutate`: the two
 * context types are deliberately distinct so a Person id cannot reach a service that expects
 * a `user.id`, and a union here would hand every existing `mutate` caller that possibility.
 *
 * `via` is null because a Participant acts for nobody: `Via` names the Assistant, Reflection
 * and the system acting for the User.
 */
export function mutateAsParticipant<T>(pctx: ParticipantCtx, fn: (tx: Tx, rec: Recorder) => Promise<T>): Promise<T> {
  return run(pctx.db, null, null, fn);
}

async function run<T>(
  db: Db,
  actorId: string | null,
  via: Via | null,
  fn: (tx: Tx, rec: Recorder) => Promise<T>,
): Promise<T> {
  const rec = new Recorder(actorId, via);
  const result = await db.transaction(async (tx) => {
    const r = await fn(tx, rec);
    await rec.flush(tx);
    return r;
  });
  await rec.publish();
  return result;
}
