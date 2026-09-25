import { after } from "next/server";
import type { Ctx } from "@/server/core/context";
import { proposalsService } from "./service";

/**
 * Schedule a Proposal pass once the current response is sent (same primitive Reflection uses,
 * ADR 0007). Failures are logged and never reach the User. No-op when no extractor can run.
 */
export function scheduleProposalPass(ctx: Ctx, projectId: string) {
  after(async () => {
    if (await proposalsService.enabled(ctx))
      await proposalsService
        .runPass(ctx, projectId, { trigger: "automatic" })
        .catch((e) => console.error("Proposal pass failed", e));
  });
}
