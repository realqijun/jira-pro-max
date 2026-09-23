import { after } from "next/server";
import type { Ctx } from "@/server/core/context";
import { rendersService } from "./service";

/**
 * Generate the image once the current response is sent (the same primitive the Proposal pass
 * uses). The request returns a pending Render immediately and the tab polls it, so nothing
 * here is awaited by the PM. `fulfil` records its own failures; this catch is for the rest.
 */
export function scheduleRender(ctx: Ctx, renderId: string) {
  after(() => rendersService.fulfil(ctx, renderId).catch((e) => console.error("Render fulfilment failed", e)));
}
