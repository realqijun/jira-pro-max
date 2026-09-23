import { afterAll, describe, expect, it } from "vitest";
import { ForbiddenError } from "@/server/core/errors";
import { projectsService } from "@/server/modules/projects/service";
import { rendersService } from "@/server/modules/renders/service";
import { tasksService } from "@/server/modules/tasks/service";
import { closeDb, makeCtx } from "@/test/helpers";
import { SAMPLE_RENDERS, seedSampleProject } from "./sample-project";

afterAll(closeDb);

describe("seedSampleProject", () => {
  it("creates a populated Project owned by the User", async () => {
    const ctx = await makeCtx();
    const project = await seedSampleProject(ctx);

    expect(project).toMatchObject({ name: "Bedok Community Centre", key: "BCC", ownerId: ctx.userId });
    expect(await projectsService.list(ctx)).toHaveLength(1);
    expect((await tasksService.list(ctx, project.id)).length).toBeGreaterThan(0);
  });

  it("imports every sample render as ready, with its real seed", async () => {
    const ctx = await makeCtx();
    const project = await seedSampleProject(ctx);

    const renders = await rendersService.list(ctx, project.id);
    expect(renders).toHaveLength(SAMPLE_RENDERS.length);
    expect(renders.every((r) => r.state === "ready")).toBe(true);
    expect(renders.map((r) => r.seed).sort((a, b) => a - b)).toEqual(
      SAMPLE_RENDERS.map((r) => r.seed).sort((a, b) => a - b),
    );
    // The bytes are really in storage, not just referenced.
    for (const r of renders) expect((await rendersService.image(ctx, r.id)).bytes.length).toBeGreaterThan(0);
  });

  /**
   * The point of seeding per User rather than sharing one global Project: two Users get two
   * independent Projects, so editing or deleting one cannot be seen by the other and
   * `assertOwnsProject` needs no exception.
   */
  it("gives each User their own copy, invisible to anyone else", async () => {
    const [alice, bob] = [await makeCtx(), await makeCtx()];
    const hers = await seedSampleProject(alice);
    const his = await seedSampleProject(bob);
    expect(hers.id).not.toBe(his.id);

    await expect(projectsService.get(bob, hers.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(projectsService.get(alice, his.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("an edit by one User does not touch the other's copy", async () => {
    const [alice, bob] = [await makeCtx(), await makeCtx()];
    const hers = await seedSampleProject(alice);
    const his = await seedSampleProject(bob);

    await projectsService.update(alice, { id: hers.id, name: "Renamed by Alice" });
    expect((await projectsService.get(bob, his.id)).name).toBe("Bedok Community Centre");
  });

  it("deleting it is an ordinary delete, leaving the User with nothing", async () => {
    const ctx = await makeCtx();
    const project = await seedSampleProject(ctx);
    await projectsService.delete(ctx, project.id);
    expect(await projectsService.list(ctx)).toEqual([]);
  });
});
