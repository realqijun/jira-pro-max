import { z } from "zod";
import { requiredText } from "@/server/core/validation";
import { RENDER_PROMPT_MAX } from "@/shared/domain";

export const createRenderSchema = z.object({
  projectId: z.string(),
  prompt: requiredText("Description", RENDER_PROMPT_MAX),
});

export const renderIdSchema = z.object({ id: z.string() });

export const listRendersSchema = z.object({ projectId: z.string() });

export type CreateRenderInput = z.infer<typeof createRenderSchema>;
