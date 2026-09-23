import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx } from "@/server/core/context";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/core/errors";
import { eventBus, type DomainEvent } from "@/server/events/bus";
import { activityRepo } from "@/server/modules/activity/service";
import type { ProjectRow } from "@/server/modules/projects/schema";
import { getStorage } from "@/server/storage";
import { RENDER_MAX_PER_PROJECT } from "@/shared/domain";
import { closeDb, makeCtx, makeProject } from "@/test/helpers";
import { rendersService } from "./service";

let ctx: Ctx;
let project: ProjectRow;
let projectId: string;

const PNG = Buffer.from("89504e470d0a1a0a", "hex");

/** A provider response without the network. `status` other than 200 exercises the error mapping. */
function stubProvider(status = 200, contentType = "image/png", body: Buffer = PNG) {
  // The signature is declared on the mock, not its implementation, so assertions can read
  // `mock.calls[0][0]` without the body taking parameters it does not use.
  const fetchMock = vi.fn<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>(async () =>
    status === 200
      ? new Response(new Uint8Array(body), { status, headers: { "content-type": contentType } })
      : new Response("nope", { status }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Keys are short and must not repeat for one owner. */
let seq = 0;
const freshProject = () => makeProject(ctx, `R${String(++seq).padStart(2, "0")}`);

beforeAll(async () => {
  ctx = await makeCtx();
});
afterAll(closeDb);

beforeEach(async () => {
  // The real key may be present in .env locally and absent in CI; pin it either way.
  vi.stubEnv("POLLINATIONS_API_KEY", "sk_test_key");
  // A Project per test: the per-Project cap is real, so a shared one would run out.
  project = await freshProject();
  projectId = project.id;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("rendersService.request", () => {
  it("returns a pending Render and records a render.created Activity Event", async () => {
    const received: DomainEvent[] = [];
    const unsub = eventBus.subscribe("render.created", (e) => void received.push(e));
    const row = await rendersService.request(ctx, { projectId, prompt: "A two storey community centre" });
    unsub();

    expect(row).toMatchObject({ state: "pending", storageKey: null, error: null, projectId });
    expect(row.seed).toBeGreaterThan(0);

    const history = await activityRepo.forEntity(ctx.db, row.id);
    expect(history).toHaveLength(1);
    expect(history[0]!.event).toMatchObject({ action: "created", entityType: "render", entityId: row.id });
    expect(received).toHaveLength(1);
  });

  it("does not call the provider: the request only records the intent", async () => {
    const fetchMock = stubProvider();
    await rendersService.request(ctx, { projectId, prompt: "Nothing should be generated yet" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("truncates a long prompt for the Activity Event label but stores it whole", async () => {
    const prompt = "A ".repeat(400).trim();
    const row = await rendersService.request(ctx, { projectId, prompt });
    expect(row.prompt).toBe(prompt);
    const [entry] = await activityRepo.forEntity(ctx.db, row.id);
    expect(entry!.event.entityLabel.length).toBeLessThanOrEqual(60);
    expect(entry!.event.entityLabel.endsWith("...")).toBe(true);
  });

  it("refuses when no image key is configured", async () => {
    vi.stubEnv("POLLINATIONS_API_KEY", "");
    await expect(rendersService.request(ctx, { projectId, prompt: "No key" })).rejects.toBeInstanceOf(ConflictError);
  });

  it("caps the number of Renders per Project", async () => {
    for (let i = 0; i < RENDER_MAX_PER_PROJECT; i++) {
      await rendersService.request(ctx, { projectId, prompt: `Render ${i}` });
    }
    await expect(rendersService.request(ctx, { projectId, prompt: "One too many" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(await rendersService.list(ctx, projectId)).toHaveLength(RENDER_MAX_PER_PROJECT);
  });
});

describe("rendersService.fulfil", () => {
  it("stores the bytes, flips the Render to ready and records the change", async () => {
    stubProvider();
    const row = await rendersService.request(ctx, { projectId, prompt: "A glazed entrance atrium" });
    await rendersService.fulfil(ctx, row.id);

    const after = await rendersService.get(ctx, row.id);
    expect(after).toMatchObject({ state: "ready", mimeType: "image/png", sizeBytes: PNG.length, error: null });
    expect(after.storageKey).toBe(`renders/${projectId}/${row.id}/image`);
    expect(await getStorage().get(after.storageKey!)).toEqual(PNG);

    const updates = (await activityRepo.forEntity(ctx.db, row.id)).filter((h) => h.event.action === "updated");
    expect(updates.map((u) => u.event.field)).toContain("state");
  });

  it("sends the prompt with a sketch style, the stored seed and the privacy filter", async () => {
    const fetchMock = stubProvider();
    const row = await rendersService.request(ctx, { projectId, prompt: "A pitched roof" });
    await rendersService.fulfil(ctx, row.id);

    const url = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(decodeURIComponent(url.pathname)).toContain("A pitched roof");
    expect(decodeURIComponent(url.pathname)).toContain("concept sketch");
    expect(url.searchParams.get("seed")).toBe(String(row.seed));
    expect(url.searchParams.get("safe")).toBe("privacy,secrets");
  });

  it("never sends Project data, only the typed prompt", async () => {
    const fetchMock = stubProvider();
    const row = await rendersService.request(ctx, { projectId, prompt: "Just this sentence" });
    await rendersService.fulfil(ctx, row.id);
    const sent = decodeURIComponent(new URL(String(fetchMock.mock.calls[0]![0])).pathname);
    expect(sent).not.toContain(project.name);
    expect(sent).not.toContain(project.key);
  });

  it("records a rate limit as a failure the PM can read, not an exception", async () => {
    stubProvider(429);
    const row = await rendersService.request(ctx, { projectId, prompt: "Too many requests" });
    await expect(rendersService.fulfil(ctx, row.id)).resolves.toBeUndefined();

    const after = await rendersService.get(ctx, row.id);
    expect(after.state).toBe("failed");
    expect(after.error).toMatch(/rate limiting/i);
    expect(after.storageKey).toBeNull();
  });

  it("fails the Render when the provider returns something that is not an image", async () => {
    stubProvider(200, "application/json", Buffer.from("{}"));
    const row = await rendersService.request(ctx, { projectId, prompt: "Wrong content type" });
    await rendersService.fulfil(ctx, row.id);
    expect((await rendersService.get(ctx, row.id)).state).toBe("failed");
  });

  it("is a no-op once the Render has already settled, so a late generation cannot overwrite it", async () => {
    stubProvider();
    const row = await rendersService.request(ctx, { projectId, prompt: "Settled once" });
    await rendersService.fulfil(ctx, row.id);
    const first = await rendersService.get(ctx, row.id);

    stubProvider(500);
    await rendersService.fulfil(ctx, row.id);
    expect(await rendersService.get(ctx, row.id)).toMatchObject({ state: "ready", updatedAt: first.updatedAt });
  });
});

describe("rendersService", () => {
  it("imports an already-generated image as a ready Render without calling the provider", async () => {
    const fetchMock = stubProvider();
    const row = await rendersService.importReady(ctx, {
      projectId,
      prompt: "Seeded exterior",
      seed: 101,
      bytes: PNG,
      mimeType: "image/jpeg",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(row).toMatchObject({ state: "ready", seed: 101 });
    expect((await rendersService.image(ctx, row.id)).bytes).toEqual(PNG);
  });

  it("lists newest first and reports states for the poll", async () => {
    const older = await rendersService.request(ctx, { projectId, prompt: "Older" });
    const newer = await rendersService.request(ctx, { projectId, prompt: "Newer" });
    expect((await rendersService.list(ctx, projectId)).map((r) => r.id)).toEqual([newer.id, older.id]);
    expect((await rendersService.states(ctx, projectId)).map((r) => r.state)).toEqual(["pending", "pending"]);
  });

  it("delete removes the row and the stored image", async () => {
    stubProvider();
    const row = await rendersService.request(ctx, { projectId, prompt: "Doomed" });
    await rendersService.fulfil(ctx, row.id);
    const { storageKey } = await rendersService.get(ctx, row.id);

    await rendersService.delete(ctx, row.id);
    await expect(rendersService.get(ctx, row.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getStorage().get(storageKey!)).rejects.toThrow();
  });

  it("refuses a foreign User requesting, listing, reading or deleting", async () => {
    const stranger = await makeCtx();
    const mine = await rendersService.request(ctx, { projectId, prompt: "Owner only" });
    await expect(rendersService.request(stranger, { projectId, prompt: "Intruder" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(rendersService.list(stranger, projectId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(rendersService.states(stranger, projectId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(rendersService.image(stranger, mine.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(rendersService.delete(stranger, mine.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("a Render with no image yet has nothing to serve", async () => {
    const row = await rendersService.request(ctx, { projectId, prompt: "Still pending" });
    await expect(rendersService.image(ctx, row.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});
