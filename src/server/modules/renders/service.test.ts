import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx } from "@/server/core/context";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/core/errors";
import { eventBus, type DomainEvent } from "@/server/events/bus";
import { activityRepo } from "@/server/modules/activity/service";
import { evidenceRepo } from "@/server/modules/evidence/repository";
import { evidenceService } from "@/server/modules/evidence/service";
import type { ProjectRow } from "@/server/modules/projects/schema";
import { getStorage } from "@/server/storage";
import {
  RENDER_DRAFT_NOTES_MAX,
  RENDER_EVIDENCE_MAX,
  RENDER_MAX_PER_PROJECT,
  RENDER_PROMPT_MAX,
} from "@/shared/domain";
import { closeDb, makeCtx, makeProject } from "@/test/helpers";
import { DRAFT_EVIDENCE_CHARS, type Draft } from "./draft";
import { promptSentFor } from "./provider";
import { rendersRepo } from "./repository";
import { rendersService } from "./service";
import { createRenderSchema, draftRenderSchema } from "./validation";

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

  it("holds the cap when the last requests arrive together", async () => {
    for (let i = 0; i < RENDER_MAX_PER_PROJECT - 1; i++) {
      await rendersService.request(ctx, { projectId, prompt: `Render ${i}` });
    }
    // Widen the gap between counting and inserting, so unlocked requests would all see room.
    const count = rendersRepo.countForProject;
    const slow = vi.spyOn(rendersRepo, "countForProject").mockImplementation(async (db, id) => {
      const n = await count(db, id);
      await new Promise((r) => setTimeout(r, 50));
      return n;
    });
    const results = await Promise.allSettled(
      [1, 2, 3].map((i) => rendersService.request(ctx, { projectId, prompt: `Race ${i}` })),
    );
    slow.mockRestore();
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await rendersService.list(ctx, projectId)).toHaveLength(RENDER_MAX_PER_PROJECT);
  });
});

describe("rendersService.request with Evidence", () => {
  const addEvidence = (pid: string, title: string, body = `${title} notes`) =>
    evidenceService.create(ctx, { projectId: pid, title, kind: "other", body });

  it("snapshots the Evidence it was drafted from, in the order given and deduped", async () => {
    const a = await addEvidence(projectId, "Site walk");
    const b = await addEvidence(projectId, "Client brief");
    const row = await rendersService.request(ctx, {
      projectId,
      prompt: "A timber pavilion",
      evidenceIds: [b.id, a.id, b.id],
    });
    expect(row.evidence).toEqual([
      { evidenceId: b.id, title: "Client brief" },
      { evidenceId: a.id, title: "Site walk" },
    ]);
  });

  it("a hand-typed Render cites no Evidence", async () => {
    const row = await rendersService.request(ctx, { projectId, prompt: "Typed by hand" });
    expect(row.evidence).toEqual([]);
  });

  it(`refuses more than ${RENDER_EVIDENCE_MAX} pieces of Evidence in the schema and the service`, async () => {
    const ids: string[] = [];
    for (let i = 0; i <= RENDER_EVIDENCE_MAX; i++) ids.push((await addEvidence(projectId, `Note ${i}`)).id);
    expect(createRenderSchema.safeParse({ projectId, prompt: "Too many", evidenceIds: ids }).success).toBe(false);
    await expect(
      rendersService.request(ctx, { projectId, prompt: "Too many", evidenceIds: ids }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await rendersService.list(ctx, projectId)).toHaveLength(0);
  });

  it("refuses Evidence from another Project, the owner's or a stranger's, and writes nothing", async () => {
    const other = await freshProject();
    const mineElsewhere = await addEvidence(other.id, "Other project note");
    const stranger = await makeCtx();
    const strangerProject = await makeProject(stranger, "SX");
    const theirs = await evidenceService.create(stranger, {
      projectId: strangerProject.id,
      title: "Not yours",
      kind: "other",
      body: "Secret",
    });
    for (const id of [mineElsewhere.id, theirs.id, "missing-id"]) {
      await expect(
        rendersService.request(ctx, { projectId, prompt: "Borrowed", evidenceIds: [id] }),
      ).rejects.toBeInstanceOf(NotFoundError);
    }
    expect(await rendersService.list(ctx, projectId)).toHaveLength(0);
  });

  it("keeps the snapshot after the Evidence is deleted", async () => {
    const e = await addEvidence(projectId, "Deleted later");
    const row = await rendersService.request(ctx, { projectId, prompt: "Outlives it", evidenceIds: [e.id] });
    await evidenceService.delete(ctx, e.id);
    expect((await rendersService.get(ctx, row.id)).evidence).toEqual([{ evidenceId: e.id, title: "Deleted later" }]);
  });
});

describe("rendersService.draft", () => {
  const addEvidence = (title: string, body: string) =>
    evidenceService.create(ctx, { projectId, title, kind: "other", body });
  const fake = (reply = "A brick hall") => vi.fn<Draft>(async () => reply);

  it("hands the drafter each text cut to 6,000 characters, plus the PM's words", async () => {
    const long = await addEvidence("Long brief", "x".repeat(DRAFT_EVIDENCE_CHARS + 500));
    const short = await addEvidence("Site walk", "Faces the park.");
    const drafter = fake();
    await rendersService.draft(ctx, { projectId, evidenceIds: [long.id, short.id], notes: "Show the roof" }, drafter);
    const [input] = drafter.mock.calls[0]!;
    expect(input.notes).toBe("Show the roof");
    expect(input.sources.map((s) => [s.title, s.text.length])).toEqual([
      ["Long brief", DRAFT_EVIDENCE_CHARS],
      ["Site walk", "Faces the park.".length],
    ]);
  });

  it("returns one paragraph within the prompt cap", async () => {
    const e = await addEvidence("Brief", "A hall.");
    const { prompt } = await rendersService.draft(
      ctx,
      { projectId, evidenceIds: [e.id] },
      fake(`A hall.\n\n${"with brick ".repeat(200)}`),
    );
    expect(prompt.length).toBeLessThanOrEqual(RENDER_PROMPT_MAX);
    expect(prompt).not.toContain("\n");
  });

  it("refuses notes over the cap even from a caller that skipped the schema", async () => {
    const e = await addEvidence("Brief", "A hall.");
    const drafter = fake();
    await expect(
      rendersService.draft(
        ctx,
        { projectId, evidenceIds: [e.id], notes: "x".repeat(RENDER_DRAFT_NOTES_MAX + 1) },
        drafter,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(drafter).not.toHaveBeenCalled();
  });

  it("refuses too many, foreign and textless Evidence, and a stranger", async () => {
    const ids: string[] = [];
    for (let i = 0; i <= RENDER_EVIDENCE_MAX; i++) ids.push((await addEvidence(`Note ${i}`, "Text")).id);
    await expect(rendersService.draft(ctx, { projectId, evidenceIds: ids }, fake())).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(draftRenderSchema.safeParse({ projectId, evidenceIds: ids }).success).toBe(false);
    expect(draftRenderSchema.safeParse({ projectId, evidenceIds: [] }).success).toBe(false);

    const other = await freshProject();
    const elsewhere = await evidenceService.create(ctx, { projectId: other.id, title: "X", kind: "other", body: "Y" });
    await expect(rendersService.draft(ctx, { projectId, evidenceIds: [elsewhere.id] }, fake())).rejects.toBeInstanceOf(
      NotFoundError,
    );

    const blank = await addEvidence("Scanned drawing", "placeholder");
    await evidenceRepo.update(ctx.db, blank.id, { body: null, extractedText: null, prunedText: null });
    await expect(rendersService.draft(ctx, { projectId, evidenceIds: [blank.id] }, fake())).rejects.toBeInstanceOf(
      ValidationError,
    );

    const stranger = await makeCtx();
    await expect(rendersService.draft(stranger, { projectId, evidenceIds: [ids[0]!] }, fake())).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(rendersService.draftSources(stranger, projectId)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("writes no Render and no Activity Event", async () => {
    const e = await addEvidence("Brief", "A hall.");
    const received: DomainEvent[] = [];
    const unsub = eventBus.subscribe("*", (ev) => void received.push(ev));
    await rendersService.draft(ctx, { projectId, evidenceIds: [e.id] }, fake());
    unsub();
    expect(received).toEqual([]);
    expect(await rendersService.list(ctx, projectId)).toEqual([]);
  });

  it("maps a drafter failure to a message the PM can read", async () => {
    const e = await addEvidence("Brief", "A hall.");
    const failing = vi.fn<Draft>(async () => {
      throw new Error("provider said: secret prompt echo");
    });
    const err = await rendersService.draft(ctx, { projectId, evidenceIds: [e.id] }, failing).catch((x) => x);
    expect(err).toBeInstanceOf(ConflictError);
    expect(err.message).not.toContain("secret");
  });

  it("refuses without an Assistant model, and says so through canDraft", async () => {
    for (const k of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "AI_API_KEY"])
      vi.stubEnv(k, "");
    vi.stubEnv("AI_PROVIDER", "openai");
    const e = await addEvidence("Brief", "A hall.");
    expect(await rendersService.canDraft(ctx)).toBe(false);
    await expect(rendersService.draft(ctx, { projectId, evidenceIds: [e.id] })).rejects.toBeInstanceOf(ConflictError);
  });

  it("lists only Evidence with text, and only its id, title, kind and date", async () => {
    const withText = await addEvidence("Has text", "Something");
    const blank = await addEvidence("No text", "placeholder");
    await evidenceRepo.update(ctx.db, blank.id, { body: null, extractedText: null, prunedText: null });
    const listed = await rendersService.draftSources(ctx, projectId);
    expect(listed).toEqual([{ id: withText.id, title: "Has text", kind: "other", sourceDate: null }]);
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

  it("sends only the approved prompt and the style suffix, never the Evidence it was drafted from", async () => {
    const secret = "Quote from Jane Tan: budget capped at 4.2M, contact jane@example.com.";
    const e = await evidenceService.create(ctx, {
      projectId,
      title: "Confidential client call",
      kind: "minutes",
      body: `${secret} The hall is a single storey with a timber roof.`,
    });
    const { prompt: drafted } = await rendersService.draft(
      ctx,
      { projectId, evidenceIds: [e.id] },
      async () => "A single storey hall with a timber roof",
    );
    const approved = `${drafted}, beside a park`;
    const fetchMock = stubProvider();
    const row = await rendersService.request(ctx, { projectId, prompt: approved, evidenceIds: [e.id] });
    await rendersService.fulfil(ctx, row.id);

    const sent = decodeURIComponent(new URL(String(fetchMock.mock.calls[0]![0])).pathname);
    expect(sent).toBe(`/image/${promptSentFor(approved)}`);
    for (const leak of [secret, "Confidential client call", project.name, project.key])
      expect(sent).not.toContain(leak);
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
