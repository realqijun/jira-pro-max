"use server";

import { z } from "zod";
import { runAction } from "@/server/core/action";
import { revalidateProject } from "@/server/core/revalidate";
import { captureCurrent } from "@/shared/analytics/server";
import { scheduleRender } from "./schedule";
import { rendersService } from "./service";
import { createRenderSchema, draftRenderSchema, listRendersSchema } from "./validation";

export async function createRenderAction(fd: FormData) {
  const res = await runAction(createRenderSchema, fd, async (ctx, i) => {
    const row = await rendersService.request(ctx, i);
    scheduleRender(ctx, row.id);
    return row;
  });
  if (res.ok) {
    revalidateProject(res.data.projectId);
    await captureCurrent("render_requested", { render_id: res.data.id, evidence_count: res.data.evidence.length });
  }
  return res;
}

/**
 * The catch-up poll (ADR 0011). Read-only and deliberately does not revalidate: it runs every
 * few seconds while a Render is pending, and re-rendering the Project layout each tick would
 * cost far more than the four fields it reads.
 */
export async function renderStatesAction(input: z.input<typeof listRendersSchema>) {
  return runAction(listRendersSchema, input, (ctx, i) => rendersService.states(ctx, i.projectId));
}

/**
 * Draft a description from Evidence (ADR 0016). Nothing is written, so nothing is revalidated:
 * the draft goes back into the form for the PM to edit before Generate.
 */
export async function draftRenderPromptAction(input: z.input<typeof draftRenderSchema>) {
  return runAction(draftRenderSchema, input, (ctx, i) => rendersService.draft(ctx, i));
}

export async function deleteRenderAction(fd: FormData) {
  const res = await runAction(z.object({ id: z.string() }), fd, (ctx, { id }) => rendersService.delete(ctx, id));
  if (res.ok) revalidateProject(res.data.projectId);
  return res;
}
