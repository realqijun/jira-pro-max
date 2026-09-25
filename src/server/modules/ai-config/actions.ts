"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ctxForCurrentUser, runAction } from "@/server/core/action";
import { formToObject } from "@/server/core/validation";
import { AI_PROVIDERS, type AiProvider } from "@/shared/domain";
import { aiConfigService } from "@/server/modules/ai-config/service";

const schema = z.object({
  id: z.string().nullish(),
  provider: z.enum(AI_PROVIDERS),
  model: z.string(),
  baseUrl: z.string().optional(),
  apiKey: z.string().optional(),
});

export async function saveAiConfigAction(fd: FormData) {
  const result = await runAction(schema, fd, (ctx, input) => aiConfigService.save(ctx, input));
  if (result.ok) revalidatePath("/settings");
  return result;
}

const idSchema = z.object({ id: z.string() });

export async function removeAiConfigAction(input: unknown) {
  const result = await runAction(idSchema, input, (ctx, { id }) => aiConfigService.remove(ctx, id));
  if (result.ok) revalidatePath("/settings");
  return result;
}

export async function setDefaultAiConfigAction(input: unknown) {
  const result = await runAction(idSchema, input, (ctx, { id }) => aiConfigService.setDefault(ctx, id));
  if (result.ok) revalidatePath("/settings");
  return result;
}

/** Environment credential for a provider, used only when the form and saved rows have no key. */
function environmentKey(provider: AiProvider): string | undefined {
  if (provider === "openai") return process.env.OPENAI_API_KEY;
  if (provider === "anthropic") return process.env.ANTHROPIC_API_KEY;
  if (provider === "google")
    return process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  return process.env.AI_API_KEY;
}

const discoverSchema = z.object({
  provider: z.enum(AI_PROVIDERS),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  configId: z.string().optional(),
});

export async function discoverAiModelsAction(
  formData: FormData,
): Promise<{ ok: true; data: string[] } | { ok: false; error: string }> {
  const parsed = discoverSchema.safeParse(formToObject(formData));
  if (!parsed.success) return { ok: false, error: "Provider is required." };
  try {
    const ctx = await ctxForCurrentUser();
    const input = { ...parsed.data };
    // Environment fallback mirrors the Assistant's own precedence (model.ts).
    if (!input.apiKey?.trim() && !input.configId) {
      input.apiKey = environmentKey(input.provider);
      if (input.provider === "openai_compatible" && !input.baseUrl?.trim()) input.baseUrl = process.env.AI_BASE_URL;
    }
    return { ok: true, data: await aiConfigService.models(ctx, input) };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Failed to discover models.";
    return { ok: false, error: errorMsg };
  }
}
