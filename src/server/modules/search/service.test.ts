import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Ctx } from "@/server/core/context";
import { ForbiddenError, ValidationError } from "@/server/core/errors";
import { activityRepo } from "@/server/modules/activity/service";
import { evidenceLabelsRepo, evidenceRepo } from "@/server/modules/evidence/repository";
import { evidenceService } from "@/server/modules/evidence/service";
import { labelsService } from "@/server/modules/labels/service";
import { milestonesService } from "@/server/modules/milestones/service";
import { closeDb, makeCtx, makeProject } from "@/test/helpers";
import { chunkText } from "./embed";
import { chunksRepo } from "./repository";
import { searchService } from "./service";
import { registerEvidenceIndexer } from "./subscriber";

let ctx: Ctx;
let projectId: string;

beforeAll(async () => {
  // The semantic path needs a live OpenAI key; tests exercise the deterministic fallbacks.
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("LITEPRUNER_API_KEY", "");
  ctx = await makeCtx();
  projectId = (await makeProject(ctx, "SRC")).id;
});
afterAll(closeDb);

const makeLabel = (name: string) => labelsService.create(ctx, { projectId, name, color: "#4ea7fc" });
const makeEvidence = (title: string, labelIds: string[] = []) =>
  evidenceService.create(ctx, { projectId, title, kind: "other", body: `${title} contents`, labelIds });

describe("evidence labels", () => {
  it("tags Evidence on create and replaces the set on update, recording labelIds in history", async () => {
    const legal = await makeLabel("legal");
    const vendor = await makeLabel("vendor");
    const ev = await makeEvidence("MSA", [legal.id]);
    expect(await evidenceLabelsRepo.labelIds(ctx.db, ev.id)).toEqual([legal.id]);

    await evidenceService.update(ctx, { id: ev.id, labelIds: [legal.id, vendor.id] });
    expect((await evidenceLabelsRepo.labelIds(ctx.db, ev.id)).sort()).toEqual([legal.id, vendor.id].sort());
    const history = await activityRepo.forEntity(ctx.db, ev.id);
    expect(history.some((h) => h.event.field === "labelIds")).toBe(true);

    await evidenceService.update(ctx, { id: ev.id, labelIds: [] });
    expect(await evidenceLabelsRepo.labelIds(ctx.db, ev.id)).toEqual([]);
  });

  it("stores the original text as prunedText when LitePruner is unavailable", async () => {
    const ev = await makeEvidence("No pruner");
    expect(ev.prunedText).toBe("No pruner contents");
  });

  it("rejects labels from another project", async () => {
    const stranger = await makeCtx();
    const foreign = (await makeProject(stranger, "FRN")).id;
    const theirs = await labelsService.create(stranger, { projectId: foreign, name: "theirs", color: "#4ea7fc" });
    await expect(makeEvidence("Nope", [theirs.id])).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("search_evidence", () => {
  it("lists Evidence carrying all of the given Labels, by name or id", async () => {
    const minutes = await makeLabel("minutes");
    const tagged = await makeEvidence("Sprint minutes", [minutes.id]);
    await makeEvidence("Untagged");
    const res = await searchService.search(ctx, { projectId, labels: ["minutes"] });
    expect(res.matches.map((m) => m.evidenceId)).toEqual([tagged.id]);
    const byId = await searchService.search(ctx, { projectId, labels: [minutes.id] });
    expect(byId.matches.map((m) => m.evidenceId)).toEqual([tagged.id]);
  });

  it("requires every listed label on one Evidence item", async () => {
    const a = await makeLabel("a-tag");
    const b = await makeLabel("b-tag");
    const both = await makeEvidence("Has both", [a.id, b.id]);
    await makeEvidence("Has one", [a.id]);
    const res = await searchService.search(ctx, { projectId, labels: [a.id, b.id] });
    expect(res.matches.map((m) => m.evidenceId)).toEqual([both.id]);
  });

  it("falls back to literal matching when no embedding model is configured", async () => {
    const ev = await makeEvidence("Vendor consolidation plan");
    const res = await searchService.search(ctx, { projectId, query: "consolidation" });
    expect(res.matches.map((m) => m.evidenceId)).toContain(ev.id);
    expect(res.note).toMatch(/literal/i);
  });

  it("scopes the literal fallback to labelled Evidence", async () => {
    const keep = await makeLabel("keep");
    const tagged = await evidenceService.create(ctx, {
      projectId,
      title: "Tagged plan",
      kind: "other",
      body: "migration notes",
      labelIds: [keep.id],
    });
    const res = await searchService.search(ctx, { projectId, query: "migration", labels: ["keep"] });
    expect(res.matches.map((m) => m.evidenceId)).toEqual([tagged.id]);
  });

  it("scopes to Evidence linked to a Milestone, resolved by name", async () => {
    const milestone = await milestonesService.create(ctx, { projectId, name: "UAT begins", dueDate: "2026-10-01" });
    const linked = await makeEvidence("UAT contract");
    await makeEvidence("Unrelated notes");
    await evidenceService.link(ctx, {
      projectId,
      evidenceId: linked.id,
      entityType: "milestone",
      entityId: milestone.id,
    });

    const res = await searchService.search(ctx, { projectId, linkedTo: { entityType: "milestone", entity: "uat" } });
    expect(res.matches.map((m) => m.evidenceId)).toEqual([linked.id]);

    const byId = await searchService.search(ctx, {
      projectId,
      linkedTo: { entityType: "milestone", entity: milestone.id },
    });
    expect(byId.matches.map((m) => m.evidenceId)).toEqual([linked.id]);
  });

  it("intersects the linkedTo and label scopes", async () => {
    const milestone = await milestonesService.create(ctx, { projectId, name: "Go live", dueDate: "2026-12-01" });
    const tag = await makeLabel("release");
    const both = await makeEvidence("Release checklist", [tag.id]);
    await makeEvidence("Tagged but unlinked", [tag.id]);
    const linkedOnly = await makeEvidence("Linked but untagged");
    for (const ev of [both, linkedOnly]) {
      await evidenceService.link(ctx, {
        projectId,
        evidenceId: ev.id,
        entityType: "milestone",
        entityId: milestone.id,
      });
    }

    const res = await searchService.search(ctx, {
      projectId,
      labels: ["release"],
      linkedTo: { entityType: "milestone", entity: "Go live" },
    });
    expect(res.matches.map((m) => m.evidenceId)).toEqual([both.id]);
  });

  it("rejects an unknown linkedTo target", async () => {
    await expect(
      searchService.search(ctx, { projectId, linkedTo: { entityType: "milestone", entity: "no-such-milestone" } }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects unknown labels and foreign projects", async () => {
    await expect(searchService.search(ctx, { projectId, labels: ["no-such-label"] })).rejects.toBeInstanceOf(
      ValidationError,
    );
    const stranger = await makeCtx();
    await expect(searchService.search(stranger, { projectId })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("chunking and the indexing subscriber", () => {
  it("splits long text into bounded overlapping chunks", () => {
    const chunks = chunkText("word ".repeat(2000));
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 1600)).toBe(true);
  });

  it("re-chunks Evidence on evidence.created and drops them on delete", async () => {
    registerEvidenceIndexer();
    const ev = await makeEvidence("Indexed");
    const chunks = (await chunksRepo.listForProject(ctx.db, projectId)).filter((c) => c.evidenceId === ev.id);
    expect(chunks.map((c) => c.text)).toEqual(["Indexed contents"]);
    // No embedding model in tests: the row exists but carries no vector.
    expect(chunks.every((c) => c.embedding === null)).toBe(true);
    await evidenceService.delete(ctx, ev.id);
    expect((await chunksRepo.listForProject(ctx.db, projectId)).some((c) => c.evidenceId === ev.id)).toBe(false);
  });

  it("backfills chunks for Evidence that predates the subscriber, once per Project", async () => {
    // Inserted through the repo so no evidence.created event fires - the shape pre-feature rows have.
    // Fresh Projects: the shared one was already marked backfilled by earlier searches.
    const staleProject = (await makeProject(ctx, "BF1")).id;
    const stale = await evidenceRepo.insert(ctx.db, {
      projectId: staleProject,
      title: "Legacy doc",
      kind: "other",
      body: "legacy contents",
    });
    const freshProject = (await makeProject(ctx, "BF2")).id;
    const staleInOther = await evidenceRepo.insert(ctx.db, {
      projectId: freshProject,
      title: "Other legacy",
      kind: "other",
      body: "other contents",
    });

    await searchService.search(ctx, { projectId: staleProject });
    const chunks = await chunksRepo.listForProject(ctx.db, staleProject);
    expect(chunks.some((c) => c.evidenceId === stale.id && c.text === "legacy contents")).toBe(true);

    // The other project is untouched until it is searched.
    expect((await chunksRepo.listForProject(ctx.db, freshProject)).some((c) => c.evidenceId === staleInOther.id)).toBe(
      false,
    );
  });

  it("re-embeds chunks recorded under a different embedder identity on the next search", async () => {
    // Chunks carry "provider:model" of the embedder that wrote them; a configured-model switch
    // makes every vector stale, so the backfill rewrites them with the current identity
    // (null here - tests configure no provider).
    const switchedProject = (await makeProject(ctx, "SW")).id;
    const ev = await evidenceRepo.insert(ctx.db, {
      projectId: switchedProject,
      title: "Old vectors",
      kind: "other",
      body: "embedded before the switch",
    });
    await chunksRepo.replaceForEvidence(
      ctx.db,
      ev.id,
      switchedProject,
      ["embedded before the switch"],
      [new Array(1536).fill(0.01)],
      "openai:text-embedding-3-small",
    );

    await searchService.search(ctx, { projectId: switchedProject });
    const chunks = await chunksRepo.listForProject(ctx.db, switchedProject);
    expect(chunks.some((c) => c.evidenceId === ev.id && c.model === null && c.embedding === null)).toBe(true);
  });
});
