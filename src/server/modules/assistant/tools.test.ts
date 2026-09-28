import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Ctx } from "@/server/core/context";
import { ForbiddenError } from "@/server/core/errors";
import { activityRepo } from "@/server/modules/activity/service";
import { evidenceService } from "@/server/modules/evidence/service";
import { projectsService } from "@/server/modules/projects/service";
import { closeDb, makeCtx, makeProject } from "@/test/helpers";
import { toAiTools, toolApprovalFor } from "./ai-tools";
import { assistantService } from "./service";
import { ASSISTANT_TOOLS, MCP_TOOLS, PROJECT_TOOLS, WORKSPACE_TOOLS, findTool } from "./tools";

let ctx: Ctx;
let projectId: string;

beforeAll(async () => {
  ctx = { ...(await makeCtx()), via: "assistant" };
  projectId = (await makeProject(ctx, "AST")).id;
});
afterAll(closeDb);

const run = (name: string, input: Record<string, unknown>, c: Ctx = ctx) =>
  findTool(name).handler(c, findTool(name).input.parse(input));

describe("open_project", () => {
  it("resolves a Project by name and attaches the Conversation to it", async () => {
    const conv = await assistantService.createConversation(ctx, null);
    const res = (await run("open_project", { name: "AST", conversationId: conv.id })) as {
      id: string;
      attachedConversation: boolean;
    };
    expect(res).toMatchObject({ id: projectId, attachedConversation: true });
    const dock = await assistantService.dock(ctx, projectId);
    expect(dock.conversations.map((c) => c.id)).toContain(conv.id);
    const ws = await assistantService.dock(ctx, null);
    expect(ws.conversations.map((c) => c.id)).not.toContain(conv.id);
  });

  it("returns matches when the name is ambiguous and errors when there is none", async () => {
    const other = await makeProject(ctx, "AST2");
    const res = (await run("open_project", { name: "ast" })) as { error: string; matches: { id: string }[] };
    expect(res.error).toMatch(/more than one/i);
    expect(res.matches.map((m) => m.id).sort()).toEqual([projectId, other.id].sort());
    await expect(run("open_project", { name: "no such project" })).rejects.toThrow();
    const stranger = await makeCtx();
    await expect(run("open_project", { id: projectId }, stranger)).rejects.toThrow();
    await projectsService.delete(ctx, other.id);
  });
});

describe("assistant tool registry", () => {
  it("exposes the v1 tools by name", () => {
    expect(WORKSPACE_TOOLS.map((t) => t.name).sort()).toEqual(["create_project", "list_projects", "open_project"]);
    expect(ASSISTANT_TOOLS).toHaveLength(PROJECT_TOOLS.length + WORKSPACE_TOOLS.length);
    expect(PROJECT_TOOLS.map((t) => t.name).sort()).toEqual([
      "add_comment",
      "add_dependency",
      "create_label",
      "create_milestone",
      "create_person",
      "create_risk",
      "create_task",
      "delete_milestone",
      "delete_task",
      "get_project_summary",
      "get_task",
      "link_evidence",
      "list_evidence",
      "list_labels",
      "list_people",
      "list_tasks",
      "list_teams",
      "read_evidence",
      "remove_dependency",
      "search_decisions",
      "search_evidence",
      "set_evidence_labels",
      "set_task_labels",
      "update_milestone",
      "update_project",
      "update_risk",
      "update_task",
    ]);
  });

  it("flags the destructive and Project-level tools as requiring confirmation", () => {
    const flagged = ASSISTANT_TOOLS.filter((t) => t.requiresConfirmation)
      .map((t) => t.name)
      .sort();
    expect(flagged).toEqual(["delete_milestone", "delete_task", "update_project"]);
    expect(MCP_TOOLS.map((t) => t.name)).not.toEqual(expect.arrayContaining(flagged));
    expect(MCP_TOOLS).toHaveLength(ASSISTANT_TOOLS.length - flagged.length);
  });

  it("describes a delete_task call with the Task key and title", async () => {
    const task = (await run("create_task", { projectId, title: "Doomed", dueDate: "2026-10-30" })) as {
      id: string;
      number: number;
    };
    const text = await findTool("delete_task").describe!(ctx, { id: task.id });
    expect(text).toBe(`Delete Task AST-${task.number} “Doomed”?`);
    await run("delete_task", { id: task.id });
    await expect(run("get_task", { id: task.id })).rejects.toThrow("not found");
  });

  it("describes an update_project call with the concrete change and applies it", async () => {
    const text = await findTool("update_project").describe!(ctx, { projectId, name: "Renamed" });
    expect(text).toBe("Update Project AST: name → “Renamed”?");
    const after = (await run("update_project", { projectId, name: "Renamed" })) as { name: string };
    expect(after.name).toBe("Renamed");
  });

  it("summarises the Project with ids and Status categories", async () => {
    const summary = (await run("get_project_summary", { projectId })) as {
      project: { id: string; key: string };
      statuses: { id: string; name: string; category: string; scope: string; isDefault: boolean }[];
      tasks: unknown[];
    };
    expect(summary.project).toMatchObject({ id: projectId, key: "AST" });
    expect(summary.statuses.some((s) => s.scope === "task" && s.isDefault)).toBe(true);
    expect(summary.statuses.every((s) => s.id && s.category)).toBe(true);
  });

  it("creates a Task with the default Status and stamps the Activity Event via Assistant", async () => {
    const task = (await run("create_task", { projectId, title: "Write test plan", dueDate: "2026-10-30" })) as {
      id: string;
      number: number;
      statusId: string;
    };
    const summary = (await run("get_project_summary", { projectId })) as {
      statuses: { id: string; scope: string; isDefault: boolean }[];
    };
    expect(task.statusId).toBe(summary.statuses.find((s) => s.scope === "task" && s.isDefault)!.id);
    const history = await activityRepo.forEntity(ctx.db, task.id);
    expect(history[0]?.event.via).toBe("assistant");
  });

  it("creates and updates a Milestone", async () => {
    const m = (await run("create_milestone", { projectId, name: "UAT begins", dueDate: "2026-11-01" })) as {
      id: string;
    };
    const after = (await run("update_milestone", { id: m.id, dueDate: "2026-11-08" })) as { dueDate: string };
    expect(after.dueDate).toBe("2026-11-08");
  });

  it("refuses a Project the User does not own", async () => {
    const stranger = await makeCtx();
    await expect(run("list_tasks", { projectId }, stranger)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("assistant tools over the rest of the Project", () => {
  it("logs a Risk owned by a Person and comments on a Milestone", async () => {
    const priya = (await run("create_person", { projectId, name: "Priya" })) as { id: string };
    const risk = (await run("create_risk", {
      projectId,
      title: "Vendor may slip",
      ownerId: priya.id,
      impact: "high",
      probability: "medium",
    })) as { id: string; ownerId: string; impact: string };
    expect(risk).toMatchObject({ ownerId: priya.id, impact: "high" });
    const updated = (await run("update_risk", { id: risk.id, mitigation: "Weekly vendor call" })) as {
      mitigation: string;
    };
    expect(updated.mitigation).toBe("Weekly vendor call");

    const m = (await run("create_milestone", { projectId, name: "UAT", dueDate: "2026-11-01" })) as { id: string };
    const comment = (await run("add_comment", {
      projectId,
      entityType: "milestone",
      entityId: m.id,
      body: "Vendor risk noted here",
      saidById: priya.id,
    })) as { body: string; saidByName: string | null };
    expect(comment).toMatchObject({ body: "Vendor risk noted here", saidByName: "Priya" });
  });

  it("adds and removes a Dependency between two Tasks", async () => {
    const a = (await run("create_task", { projectId, title: "Dep A" })) as { id: string };
    const b = (await run("create_task", { projectId, title: "Dep B" })) as { id: string };
    const dep = (await run("add_dependency", {
      projectId,
      predecessorType: "task",
      predecessorId: a.id,
      successorType: "task",
      successorId: b.id,
    })) as { id: string };
    expect(dep.id).toBeTruthy();
    await run("remove_dependency", { id: dep.id });
  });

  it("creates Labels (with a colour when the model gives none) and tags a Task", async () => {
    const backend = (await run("create_label", { projectId, name: "backend" })) as { id: string; color: string };
    const urgent = (await run("create_label", { projectId, name: "urgent", color: "#eb5757" })) as { id: string };
    expect(backend.color).toMatch(/^#[0-9a-f]{6}$/);
    const task = (await run("create_task", { projectId, title: "Tag me" })) as { id: string };
    await run("set_task_labels", { id: task.id, labelIds: [backend.id, urgent.id] });
    const labels = (await run("list_labels", { projectId })) as { id: string }[];
    expect(labels.map((l) => l.id)).toEqual(expect.arrayContaining([backend.id, urgent.id]));
    const detailed = (await run("get_task", { id: task.id })) as { labels: { id: string }[] };
    expect(detailed.labels.map((l) => l.id).sort()).toEqual([backend.id, urgent.id].sort());
  });

  it("lists People and Teams", async () => {
    const people = (await run("list_people", { projectId })) as { name: string }[];
    expect(people.some((p) => p.name === "Priya")).toBe(true);
    expect(Array.isArray(await run("list_teams", { projectId }))).toBe(true);
  });

  it("reads Evidence text when present and says so when not, and links Evidence to a Task", async () => {
    const withText = await evidenceService.create(
      ctx,
      { projectId, title: "Kickoff minutes", kind: "minutes" },
      { name: "m.md", type: "text/markdown", size: 20, bytes: Buffer.from("Scope: two phases.") },
    );
    const noText = await evidenceService.create(
      ctx,
      { projectId, title: "Sheet", kind: "other" },
      {
        name: "s.xlsx",
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        size: 4,
        bytes: Buffer.from("PK"),
      },
    );
    const list = (await run("list_evidence", { projectId })) as { id: string; hasText: boolean }[];
    expect(list.find((e) => e.id === withText.id)?.hasText).toBe(true);
    expect(list.find((e) => e.id === noText.id)?.hasText).toBe(false);
    expect(list.some((e) => "extractedText" in e)).toBe(false);

    const got = (await run("read_evidence", { id: withText.id })) as { extractedText: string };
    expect(got.extractedText).toBe("Scope: two phases.");
    const byTitle = (await run("read_evidence", { projectId, title: "kickoff" })) as { id: string };
    expect(byTitle.id).toBe(withText.id);
    const none = (await run("read_evidence", { id: noText.id })) as { extractedText: null; note: string };
    expect(none.extractedText).toBeNull();
    expect(none.note).toMatch(/unavailable/);

    const label = (await run("create_label", { projectId, name: "contract" })) as { id: string };
    await run("set_evidence_labels", { id: withText.id, labelIds: [label.id] });
    const tagged = (await run("list_evidence", { projectId })) as { id: string; labelIds: string[] }[];
    expect(tagged.find((e) => e.id === withText.id)?.labelIds).toEqual([label.id]);
    const hits = (await run("search_evidence", { projectId, labels: ["contract"] })) as {
      matches: { evidenceId: string }[];
    };
    expect(hits.matches.map((m) => m.evidenceId)).toEqual([withText.id]);

    const task = (await run("create_task", { projectId, title: "Read minutes" })) as { id: string };
    await run("link_evidence", { projectId, evidenceId: withText.id, entityType: "task", entityId: task.id });
    const links = await evidenceService.listForEntity(ctx, projectId, "task", task.id);
    expect(links.map((l) => l.evidenceId)).toEqual([withText.id]);

    const summary = (await run("get_project_summary", { projectId })) as { evidence: { id: string }[] };
    expect(summary.evidence.map((e) => e.id)).toEqual(expect.arrayContaining([withText.id, noText.id]));
  });

  // The model cannot build a Project route from an id alone, so every Evidence surface hands it
  // a link to paste. get_project_summary matters most: its list is in the system prompt each turn.
  it("hands every Evidence surface a pasteable citation", async () => {
    type Meta = { id?: string; evidenceId?: string; title: string; href: string; cite: string };
    const cited = (await makeProject(ctx, "CIT")).id;
    const minutes = await evidenceService.create(ctx, {
      projectId: cited,
      title: "Kickoff notes",
      kind: "minutes",
      body: "Scope agreed in two phases.",
    });
    await evidenceService.create(ctx, {
      projectId: cited,
      title: "Vendor notes",
      kind: "other",
      body: "The vendor confirmed the integration window.",
    });
    const check = (e: Meta) => {
      const id = e.id ?? e.evidenceId;
      expect(e.href).toBe(`/projects/${cited}/evidence?item=${id}#evidence-${id}`);
      expect(e.cite).toBe(`[${e.title}](${e.href})`);
    };

    const list = (await run("list_evidence", { projectId: cited })) as Meta[];
    expect(list).toHaveLength(2);
    list.forEach(check);

    const summary = (await run("get_project_summary", { projectId: cited })) as { evidence: Meta[] };
    expect(summary.evidence).toHaveLength(2);
    summary.evidence.forEach(check);

    const hits = (await run("search_evidence", { projectId: cited })) as { matches: Meta[] };
    expect(hits.matches).toHaveLength(2);
    hits.matches.forEach(check);

    check((await run("read_evidence", { id: minutes.id })) as Meta);
    // Both titles end in "notes", so the title lookup is ambiguous and takes the other branch.
    const ambiguous = (await run("read_evidence", { projectId: cited, title: "notes" })) as {
      error: string;
      matches: Meta[];
    };
    expect(ambiguous.error).toMatch(/more than one/i);
    expect(ambiguous.matches).toHaveLength(2);
    ambiguous.matches.forEach(check);

    // A write tool answers with the same shape, so the model never loses the citation mid-turn.
    const label = (await run("create_label", { projectId: cited, name: "vendor" })) as { id: string };
    const labelled = (await run("set_evidence_labels", { id: minutes.id, labelIds: [label.id] })) as Meta & {
      labelIds: string[];
    };
    check(labelled);
    expect(labelled.labelIds).toEqual([label.id]);
    await projectsService.delete(ctx, cited);
  });

  it("rejects foreign ids on every new tool", async () => {
    const stranger = await makeCtx();
    const foreignProject = (await makeProject(stranger, "FOR")).id;
    const theirTask = (await run("create_task", { projectId: foreignProject, title: "Theirs" }, stranger)) as {
      id: string;
    };
    await expect(run("create_risk", { projectId: foreignProject, title: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(run("list_people", { projectId: foreignProject })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(run("set_task_labels", { id: theirTask.id, labelIds: [] })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(run("list_evidence", { projectId: foreignProject })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(run("search_decisions", { projectId: foreignProject, query: "why anything" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("search_decisions returns confirmed Decisions with an href on every Source and no Proposals", async () => {
    const { decisionsService } = await import("@/server/modules/decisions/service");
    const { proposalsRepo } = await import("@/server/modules/proposals/repository");
    const projectId = (await makeProject(ctx, "WHY")).id;
    const ev = await evidenceService.create(ctx, {
      projectId,
      title: "Minutes",
      kind: "minutes",
      body: "We chose Adyen.",
    });
    const d = await decisionsService.create(ctx, {
      projectId,
      title: "Use Adyen",
      decidedOn: "2026-09-01",
      chosen: "Adyen",
      sources: [{ kind: "evidence", entityId: ev.id }],
    });
    await proposalsRepo.insertMany(ctx.db, [
      {
        projectId,
        fingerprint: "x",
        title: "Use Adyen later",
        chosen: "Adyen",
        sources: [{ kind: "evidence", entityId: ev.id, excerpt: "We chose Adyen." }],
        assumptions: [],
        extractor: "heuristic",
      },
    ]);
    const out = (await run("search_decisions", { projectId, query: "why did we choose adyen" })) as {
      decisions: Array<{ id: string; sources: Array<{ href: string }> }>;
      nearestEvidence: unknown[];
    };
    expect(out.decisions.map((x) => x.id)).toEqual([d.id]);
    expect(out.decisions[0]!.sources.every((s) => s.href.startsWith("/projects/"))).toBe(true);
    const none = (await run("search_decisions", { projectId, query: "why did we pick the minutes format" })) as {
      decisions: unknown[];
      nearestEvidence: Array<{ id: string }>;
    };
    expect(none.decisions).toEqual([]);
    expect(none.nearestEvidence.map((e) => e.id)).toEqual([ev.id]);
  });
});

describe("workspace tools", () => {
  it("lists only the User's Projects with Task counts and creates a Project via Assistant", async () => {
    const created = (await run("create_project", { name: "Website Relaunch", key: "WEB" })) as {
      id: string;
      key: string;
    };
    expect(created.key).toBe("WEB");
    expect((await activityRepo.forEntity(ctx.db, created.id))[0]?.event.via).toBe("assistant");
    const summary = (await run("get_project_summary", { projectId: created.id })) as { statuses: unknown[] };
    expect(summary.statuses.length).toBeGreaterThan(0);

    const stranger = await makeCtx();
    await makeProject(stranger, "STR");
    const mine = (await run("list_projects", {})) as { id: string; key: string; taskCounts: Record<string, number> }[];
    expect(mine.map((p) => p.key)).toEqual(expect.arrayContaining(["AST", "WEB"]));
    expect(mine.some((p) => p.key === "STR")).toBe(false);
    expect(mine.find((p) => p.key === "AST")!.taskCounts).toMatchObject({ not_started: expect.any(Number) });
  });
});

describe("toAiTools", () => {
  const opts = { toolCallId: "t", messages: [], context: undefined };

  it("binds projectId from the scope and hides it from the model-facing schema", async () => {
    const tools = toAiTools(ctx, ASSISTANT_TOOLS, { projectId });
    const listTasks = tools.list_tasks!;
    expect(Object.keys((listTasks.inputSchema as unknown as { shape: object }).shape)).not.toContain("projectId");
    const out = (await listTasks.execute!({}, opts)) as unknown[];
    expect(Array.isArray(out)).toBe(true);
  });

  it("returns domain errors as a result the model can read instead of throwing", async () => {
    const tools = toAiTools(ctx, ASSISTANT_TOOLS, { projectId });
    const out = await tools.update_task!.execute!({ id: "00000000-0000-0000-0000-000000000000", title: "Nope" }, opts);
    expect(out).toMatchObject({ error: expect.stringContaining("not found") });
  });

  type ApprovalMap = Record<string, (input: unknown, o: unknown) => Promise<{ type: string; reason?: string }>>;

  it("asks for User approval on every write tool, never on read tools", async () => {
    const approval = (await toolApprovalFor(ctx, ASSISTANT_TOOLS, { projectId })) as ApprovalMap;
    const writes = ASSISTANT_TOOLS.filter((t) => t.mutates)
      .map((t) => t.name)
      .sort();
    expect(Object.keys(approval).sort()).toEqual(writes);
    expect(writes).not.toContain("list_tasks");
    const status = await approval.update_project!({ key: "NEW", description: null }, {});
    expect(status).toEqual({
      type: "user-approval",
      reason: "Update Project AST: key → “NEW”, description → cleared?",
    });
  });

  it("auto-approves a tool the User always-allowed, scoped to that Project", async () => {
    const other = (await makeProject(ctx, "OTH")).id;
    await assistantService.grantPermission(ctx, projectId, "create_task");
    expect(await assistantService.permissions(ctx, projectId)).toEqual(["create_task"]);

    const approval = (await toolApprovalFor(ctx, PROJECT_TOOLS, { projectId })) as ApprovalMap;
    expect(await approval.create_task!({ title: "x" }, {})).toEqual({
      type: "approved",
      reason: "Always allowed in this scope",
    });
    expect((await approval.update_task!({ id: "x" }, {})).type).toBe("user-approval");

    const elsewhere = (await toolApprovalFor(ctx, PROJECT_TOOLS, { projectId: other })) as ApprovalMap;
    expect((await elsewhere.create_task!({ title: "x" }, {})).type).toBe("user-approval");

    await assistantService.revokePermission(ctx, projectId, "create_task");
    expect(await assistantService.permissions(ctx, projectId)).toEqual([]);
  });

  it("rejects grants for read tools and unknown names", async () => {
    await expect(assistantService.grantPermission(ctx, projectId, "list_tasks")).rejects.toThrow("write tools");
    await expect(assistantService.grantPermission(ctx, projectId, "nonsense")).rejects.toThrow("write tools");
  });

  it("grants and revokes several tools at once", async () => {
    await assistantService.setPermissions(ctx, projectId, ["create_task", "update_task"], true);
    expect(await assistantService.permissions(ctx, projectId)).toEqual(["create_task", "update_task"]);
    await assistantService.setPermissions(ctx, projectId, ["update_task"], false);
    expect(await assistantService.permissions(ctx, projectId)).toEqual(["create_task"]);
    await expect(assistantService.setPermissions(ctx, projectId, ["list_tasks"], true)).rejects.toThrow("write tools");
    await assistantService.setPermissions(ctx, projectId, ["create_task"], false);
  });

  it("lists every write tool in the settings permission groups", async () => {
    const { PROJECT_TOOL_GROUPS, WORKSPACE_TOOL_GROUPS } = await import("@/shared/lib/assistant-tools");
    const grouped = [...PROJECT_TOOL_GROUPS, ...WORKSPACE_TOOL_GROUPS]
      .flatMap((g) => g.tools.map((t) => t.name))
      .sort();
    const writes = ASSISTANT_TOOLS.filter((t) => t.mutates)
      .map((t) => t.name)
      .sort();
    expect(grouped).toEqual(writes);
  });

  it("denies instead of failing the turn when the target of a confirmation no longer exists", async () => {
    const approval = (await toolApprovalFor(ctx, ASSISTANT_TOOLS)) as ApprovalMap;
    const status = await approval.delete_task!({ id: "00000000-0000-0000-0000-000000000000" }, {});
    expect(status).toEqual({ type: "denied", reason: "Task not found" });
  });
});
