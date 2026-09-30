import type { UIMessage } from "ai";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Ctx } from "@/server/core/context";
import { ForbiddenError, NotFoundError } from "@/server/core/errors";
import { closeDb, makeCtx, makeProject } from "@/test/helpers";
import { conversationsRepo, messagesRepo } from "./repository";
import { conversations } from "./schema";
import { assistantService } from "./service";

let ctx: Ctx;
let projectId: string;

beforeAll(async () => {
  ctx = await makeCtx();
  projectId = (await makeProject(ctx, "CNV")).id;
});
afterAll(closeDb);

const msg = (id: string, role: UIMessage["role"], text: string): UIMessage => ({
  id,
  role,
  parts: [{ type: "text", text }],
});

/** Backdate a Conversation past the prune grace, so an empty one counts as litter. */
const settle = (id: string) =>
  ctx.db
    .update(conversations)
    .set({ createdAt: sql`now() - interval '1 hour'`, updatedAt: sql`now() - interval '1 hour'` })
    .where(sql`${conversations.id} = ${id}`);

describe("assistantService conversations", () => {
  it("returns the latest Conversation in a scope, creating one on first open", async () => {
    const a = await assistantService.conversation(ctx, projectId);
    const b = await assistantService.conversation(ctx, projectId);
    expect(a.conversation.id).toBe(b.conversation.id);
    expect(a.messages).toEqual([]);
  });

  it("saves Messages by id so a re-save updates instead of duplicating", async () => {
    const { conversation } = await assistantService.conversation(ctx, projectId);
    await assistantService.saveMessages(ctx, conversation.id, [msg("m1", "user", "plan a launch")]);
    await assistantService.saveMessages(ctx, conversation.id, [
      msg("m1", "user", "plan a launch"),
      msg("m2", "assistant", "Done: created 3 Tasks"),
    ]);
    const { messages } = await assistantService.conversation(ctx, projectId);
    expect(messages.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(messages[1]?.parts).toEqual([{ type: "text", text: "Done: created 3 Tasks" }]);
  });

  it("keeps thread order for Messages written in the same save, across re-saves", async () => {
    const own = await makeCtx();
    const c = await assistantService.createConversation(own, null);
    const q1 = msg("q1", "user", "create a project");
    const r1 = msg("r1", "assistant", "");
    const q2 = msg("q2", "user", "create it with key UDC");
    const r2 = msg("r2", "assistant", "Created");
    // Each turn saves the whole thread, so earlier rows are re-written while new pairs share a timestamp.
    await assistantService.saveMessages(own, c.id, [q1, r1]);
    await assistantService.saveMessages(own, c.id, [q1, r1, q2, r2]);
    await assistantService.saveMessages(own, c.id, [q1, r1, q2, { ...r2, parts: [{ type: "text", text: "Done" }] }]);
    // Rewriting one row moves its tuple on disk; read with a sequential scan so storage order shows.
    await messagesRepo.upsertMany(own.db, [{ id: "q2", conversationId: c.id, role: "user", parts: q2.parts }]);
    const messages = await own.db.transaction(async (tx) => {
      await tx.execute(sql`set local enable_indexscan = off`);
      await tx.execute(sql`set local enable_bitmapscan = off`);
      return messagesRepo.listByConversation(tx, c.id);
    });
    expect(messages.map((m) => m.id)).toEqual(["q1", "r1", "q2", "r2"]);
  });

  it("tolerates the same Message id twice in one save (last occurrence wins)", async () => {
    const { conversation } = await assistantService.conversation(ctx, projectId);
    await assistantService.saveMessages(ctx, conversation.id, [
      msg("dup", "user", "first"),
      msg("dup", "user", "second"),
      msg("m3", "assistant", "ok"),
    ]);
    const { messages } = await assistantService.conversation(ctx, projectId);
    expect(messages.find((m) => m.id === "dup")?.parts).toEqual([{ type: "text", text: "second" }]);
  });

  it("keeps Message ids scoped to their Conversation", async () => {
    const other = await makeCtx();
    const otherProject = (await makeProject(other, "OTH")).id;
    const { conversation } = await assistantService.conversation(other, otherProject);
    await assistantService.saveMessages(other, conversation.id, [msg("m1", "user", "different thread")]);
    const mine = await assistantService.conversation(ctx, projectId);
    expect(mine.messages[0]?.parts).toEqual([{ type: "text", text: "plan a launch" }]);
  });

  it("counts only this User's turns today", async () => {
    expect(await assistantService.turnsToday(ctx)).toBe(2); // "m1" and "dup" (deduped) user turns
    const other = await makeCtx();
    expect(await assistantService.turnsToday(other)).toBe(0);
  });

  it("keeps a separate dashboard Conversation with no Project", async () => {
    const dash = await assistantService.conversation(ctx, null);
    expect(dash.conversation.projectId).toBeNull();
    expect(dash.conversation.id).not.toBe((await assistantService.conversation(ctx, projectId)).conversation.id);
    expect((await assistantService.conversation(ctx, null)).conversation.id).toBe(dash.conversation.id);
  });

  it("refuses a Project the User does not own", async () => {
    const stranger = await makeCtx();
    await expect(assistantService.conversation(stranger, projectId)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("creates additional Conversations and lists them newest first", async () => {
    const before = await assistantService.dock(ctx, projectId);
    const extra = await assistantService.createConversation(ctx, projectId);
    const dock = await assistantService.dock(ctx, projectId);
    expect(dock.conversations.length).toBe(before.conversations.length + 1);
    expect(dock.conversations[0]?.id).toBe(extra.id);
    expect(dock.thread.conversation.id).toBe(extra.id);
    expect(dock.thread.messages).toEqual([]);
  });

  it("loads a Conversation by id and titles it from the first user message", async () => {
    const c = await assistantService.createConversation(ctx, projectId);
    await assistantService.saveMessages(ctx, c.id, [msg("t1", "user", "summarise the risks")]);
    const thread = await assistantService.thread(ctx, c.id);
    expect(thread.messages.map((m) => m.id)).toEqual(["t1"]);
    const listed = (await assistantService.dock(ctx, projectId)).conversations.find((x) => x.id === c.id);
    expect(listed?.title).toBe("summarise the risks");
    const stranger = await makeCtx();
    await expect(assistantService.thread(stranger, c.id)).rejects.toBeInstanceOf(ForbiddenError);
    // A project Conversation cannot be resumed through the dashboard scope, or vice versa.
    await expect(assistantService.thread(ctx, c.id, null)).rejects.toBeInstanceOf(NotFoundError);
    await expect(assistantService.thread(ctx, c.id, projectId)).resolves.toBeDefined();
  });

  it("opens a fresh Conversation when a concurrent prune deletes the empty one it was about to open", async () => {
    const own = await makeCtx();
    const pid = (await makeProject(own, "RACE")).id;
    // Another request's `library` prune lands between the dock's read and its thread load.
    const latest = vi.spyOn(conversationsRepo, "latest").mockImplementationOnce(async (db, userId, scope) => {
      const row = (await conversationsRepo.listByScope(db, userId, scope))[0]!;
      await settle(row.id);
      await assistantService.library(own);
      return row;
    });
    const dock = await assistantService.dock(own, pid);
    latest.mockRestore();
    expect(dock.thread.messages).toEqual([]);
    expect(dock.conversations.map((c) => c.id)).toEqual([dock.thread.conversation.id]);
    await expect(assistantService.thread(own, dock.thread.conversation.id)).resolves.toBeDefined();
  });

  it("pins Conversations to the top and prunes empty ones", async () => {
    const first = await assistantService.createConversation(ctx, projectId);
    await assistantService.saveMessages(ctx, first.id, [msg("x1", "user", "thread one")]);
    const empty = await assistantService.createConversation(ctx, projectId);
    const pinnedEmpty = await assistantService.createConversation(ctx, projectId);
    await assistantService.pinConversation(ctx, pinnedEmpty.id, true);
    const latest = await assistantService.createConversation(ctx, projectId);
    await assistantService.saveMessages(ctx, latest.id, [msg("x2", "user", "thread two")]);
    await settle(empty.id);
    await settle(pinnedEmpty.id);

    const dock = await assistantService.dock(ctx, projectId);
    expect(dock.conversations[0]?.id).toBe(pinnedEmpty.id); // pinned sorts first
    expect(dock.conversations[0]?.pinned).toBe(true);
    expect(dock.thread.conversation.id).toBe(latest.id); // but the latest still opens
    expect(dock.conversations.map((c) => c.id)).not.toContain(empty.id); // empty pruned

    await assistantService.pinConversation(ctx, pinnedEmpty.id, false);
    const after = await assistantService.dock(ctx, projectId);
    expect(after.conversations.map((c) => c.id)).not.toContain(pinnedEmpty.id); // unpinned + empty -> pruned

    const stranger = await makeCtx();
    await expect(assistantService.pinConversation(stranger, first.id, true)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("never prunes a just-created Conversation another page load is opening", async () => {
    // Two concurrent loads for a new User each create a first Conversation, then prune empty
    // ones: neither may delete the one the other is about to open.
    const fresh = await makeCtx();
    const theirs = await assistantService.createConversation(fresh, null);
    const ours = await assistantService.createConversation(fresh, null);
    const dock = await assistantService.dock(fresh, null);
    expect(dock.thread.conversation.id).toBe(ours.id);
    await assistantService.library(fresh, ours.id);
    await expect(assistantService.thread(fresh, theirs.id)).resolves.toBeDefined();
  });

  it("re-scopes a Conversation between a Project and overall, for the owner only", async () => {
    const c = await assistantService.createConversation(ctx, null);
    const other = (await makeProject(ctx, "SCP")).id;

    await assistantService.setScope(ctx, c.id, projectId);
    expect((await assistantService.getConversation(ctx, c.id)).projectId).toBe(projectId);

    await assistantService.setScope(ctx, c.id, other);
    expect((await assistantService.getConversation(ctx, c.id)).projectId).toBe(other);

    await assistantService.setScope(ctx, c.id, null);
    expect((await assistantService.getConversation(ctx, c.id)).projectId).toBeNull();

    const stranger = await makeCtx();
    const foreign = (await makeProject(stranger, "FRN")).id;
    await expect(assistantService.setScope(ctx, c.id, foreign)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(assistantService.setScope(stranger, c.id, projectId)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("deletes a Conversation with its Messages, only for the owner", async () => {
    const c = await assistantService.createConversation(ctx, projectId);
    await assistantService.saveMessages(ctx, c.id, [msg("d1", "user", "to be deleted")]);
    const stranger = await makeCtx();
    await expect(assistantService.deleteConversation(stranger, c.id)).rejects.toBeInstanceOf(ForbiddenError);
    await assistantService.deleteConversation(ctx, c.id);
    await expect(assistantService.thread(ctx, c.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("assistantService.library", () => {
  it("returns Conversations from every scope with their projectId", async () => {
    const projectConvo = await assistantService.createConversation(ctx, projectId);
    await assistantService.saveMessages(ctx, projectConvo.id, [msg("l1", "user", "project thread")]);
    const dashConvo = await assistantService.createConversation(ctx, null);
    await assistantService.saveMessages(ctx, dashConvo.id, [msg("l2", "user", "dashboard thread")]);

    const byId = new Map((await assistantService.library(ctx)).map((c) => [c.id, c]));
    expect(byId.get(projectConvo.id)?.projectId).toBe(projectId);
    expect(byId.get(dashConvo.id)?.projectId).toBeNull();
  });

  it("prunes empty non-pinned Conversations but keeps keepId", async () => {
    const empty = await assistantService.createConversation(ctx, projectId);
    await settle(empty.id);
    // keepId first: once pruned the row is gone, so it must survive this call.
    const kept = (await assistantService.library(ctx, empty.id)).map((c) => c.id);
    expect(kept).toContain(empty.id);
    const after = (await assistantService.library(ctx)).map((c) => c.id);
    expect(after).not.toContain(empty.id);
  });

  it("backfills a title from the first user Message", async () => {
    const c = await assistantService.createConversation(ctx, null);
    // Insert directly so saveMessages does not set the title first - this exercises the backfill.
    await messagesRepo.upsertMany(ctx.db, [
      { id: "b1", conversationId: c.id, role: "user", parts: [{ type: "text", text: "name me from this" }] },
    ]);
    const listed = (await assistantService.library(ctx)).find((x) => x.id === c.id);
    expect(listed?.title).toBe("name me from this");
  });
});
