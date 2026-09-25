import { generateText, type LanguageModel } from "ai";
import { and, desc, eq } from "drizzle-orm";
import type { Ctx } from "@/server/core/context";
import { NotFoundError, ValidationError } from "@/server/core/errors";
import { buildModel } from "@/server/modules/assistant/model";
import type { AiProvider } from "@/shared/domain";
import { decryptApiKey, encryptApiKey } from "./crypto";
import { guardedFetch, normalizePublicHttpsUrl } from "./endpoint";
import { userAiConfigs } from "./schema";

export interface SaveAiConfig {
  /** Present to update an existing configuration; absent to add a new one. */
  id?: string | null;
  provider: AiProvider;
  model: string;
  baseUrl?: string;
  apiKey?: string;
}

export interface AiConfigSummary {
  id: string;
  provider: AiProvider;
  model: string;
  baseUrl: string | null;
  isDefault: boolean;
}

export interface DiscoverAiModels {
  provider: AiProvider;
  baseUrl?: string;
  apiKey?: string;
  /** Reuse the stored key of this saved configuration when `apiKey` is blank. */
  configId?: string | null;
}

const NON_LLM_KEYWORDS = [
  "embedding",
  "embed",
  "whisper",
  "dall-e",
  "tts",
  "speech",
  "audio",
  "moderation",
  "transcribe",
  "realtime",
  "image",
  "babbage",
  "davinci",
];

function isLlmModel(id: string): boolean {
  const lower = id.toLowerCase();
  return !NON_LLM_KEYWORDS.some((keyword) => lower.includes(keyword));
}

type Validate = (model: LanguageModel) => Promise<void>;
const validate: Validate = async (model) => {
  // 16 is the smallest max_output_tokens the OpenAI Responses API accepts.
  await generateText({ model, prompt: "Reply OK.", maxOutputTokens: 16, maxRetries: 0, timeout: 10_000 });
};

const owned = async (ctx: Ctx, id: string) => {
  const [row] = await ctx.db
    .select()
    .from(userAiConfigs)
    .where(and(eq(userAiConfigs.id, id), eq(userAiConfigs.userId, ctx.userId)))
    .limit(1);
  if (!row) throw new NotFoundError("Assistant configuration");
  return row;
};

export const aiConfigService = {
  /** Every saved configuration, default first then most recently touched. */
  list: async (ctx: Ctx): Promise<AiConfigSummary[]> =>
    ctx.db
      .select({
        id: userAiConfigs.id,
        provider: userAiConfigs.provider,
        model: userAiConfigs.model,
        baseUrl: userAiConfigs.baseUrl,
        isDefault: userAiConfigs.isDefault,
      })
      .from(userAiConfigs)
      .where(eq(userAiConfigs.userId, ctx.userId))
      .orderBy(desc(userAiConfigs.isDefault), desc(userAiConfigs.updatedAt)),

  models: async (ctx: Ctx, input: DiscoverAiModels, fetchImpl: typeof fetch = fetch): Promise<string[]> => {
    const suppliedKey = input.apiKey?.trim();
    const stored = input.configId ? await owned(ctx, input.configId) : undefined;
    const apiKey = suppliedKey || (stored ? decryptApiKey(stored.encryptedApiKey, ctx.userId) : null);
    if (!apiKey)
      throw new ValidationError("Enter an API key before checking available models", {
        apiKey: ["API key is required"],
      });
    let url: string;
    let headers: Record<string, string>;
    let providerFetch = fetchImpl;
    if (input.provider === "openai") {
      url = "https://api.openai.com/v1/models";
      headers = { authorization: `Bearer ${apiKey}` };
    } else if (input.provider === "anthropic") {
      url = "https://api.anthropic.com/v1/models";
      headers = { "x-api-key": apiKey, "anthropic-version": "2023-06-01" };
    } else if (input.provider === "google") {
      url = "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000";
      headers = { "x-goog-api-key": apiKey };
    } else {
      const baseUrl = await normalizePublicHttpsUrl((input.baseUrl ?? stored?.baseUrl ?? "").trim());
      url = `${baseUrl}/models`;
      headers = { authorization: `Bearer ${apiKey}` };
      providerFetch = guardedFetch(undefined, fetchImpl, new URL(baseUrl).origin);
    }
    try {
      const response = await providerFetch(url, {
        method: "GET",
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok || (response.status >= 300 && response.status < 400))
        throw new Error("Provider rejected request");
      const body = (await response.json()) as
        | Array<{ id?: unknown; name?: unknown; architecture?: { modality?: string } }>
        | {
            data?: Array<{ id?: unknown; name?: unknown; architecture?: { modality?: string } }>;
            models?: Array<{ name?: unknown; supportedGenerationMethods?: unknown }>;
          };
      const values =
        input.provider === "google"
          ? ((body as { models?: Array<{ name?: unknown; supportedGenerationMethods?: unknown }> }).models ?? [])
              .filter(
                (item) =>
                  Array.isArray(item.supportedGenerationMethods) &&
                  item.supportedGenerationMethods.includes("generateContent"),
              )
              .map((item) => (typeof item.name === "string" ? item.name.replace(/^models\//, "") : ""))
          : (Array.isArray(body) ? body : (body.data ?? []))
              .filter((item) =>
                item.architecture?.modality
                  ? item.architecture.modality.includes("text")
                  : isLlmModel(`${item.id ?? item.name ?? ""}`),
              )
              .map((item) => (typeof item.id === "string" ? item.id : typeof item.name === "string" ? item.name : ""));
      return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
    } catch (error) {
      if (error instanceof ValidationError) throw error;
      throw new ValidationError("Could not load models. Check the provider, endpoint, and API key.");
    }
  },

  save: async (ctx: Ctx, input: SaveAiConfig, validateModel: Validate = validate): Promise<void> => {
    const existing = input.id ? await owned(ctx, input.id) : undefined;
    const model = input.model.trim();
    if (!model) throw new ValidationError("Please fix the highlighted fields", { model: ["Model is required"] });
    const suppliedKey = input.apiKey?.trim();
    if (!suppliedKey && !existing)
      throw new ValidationError("An API key is required for a new configuration", {
        apiKey: ["API key is required"],
      });
    const apiKey = suppliedKey || decryptApiKey(existing!.encryptedApiKey, ctx.userId);
    const baseUrl =
      input.provider === "openai_compatible" ? await normalizePublicHttpsUrl(input.baseUrl?.trim() ?? "") : null;
    const candidate = buildModel({ provider: input.provider, model, baseUrl, apiKey });
    try {
      await validateModel(candidate);
    } catch {
      throw new ValidationError(
        "The provider could not validate this configuration. Check the endpoint, key, and model.",
      );
    }
    const encryptedApiKey = suppliedKey ? encryptApiKey(apiKey, ctx.userId) : existing!.encryptedApiKey;
    if (existing) {
      await ctx.db
        .update(userAiConfigs)
        .set({ provider: input.provider, model, baseUrl, encryptedApiKey, updatedAt: new Date() })
        .where(eq(userAiConfigs.id, existing.id));
      return;
    }
    const [any] = await ctx.db
      .select({ id: userAiConfigs.id })
      .from(userAiConfigs)
      .where(eq(userAiConfigs.userId, ctx.userId))
      .limit(1);
    await ctx.db
      .insert(userAiConfigs)
      .values({ userId: ctx.userId, provider: input.provider, model, baseUrl, encryptedApiKey, isDefault: !any });
  },

  /** Deletes one configuration; when it was the default the most recently updated survivor takes over. */
  remove: async (ctx: Ctx, id: string): Promise<void> => {
    await ctx.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(userAiConfigs)
        .where(and(eq(userAiConfigs.id, id), eq(userAiConfigs.userId, ctx.userId)))
        .limit(1);
      if (!row) throw new NotFoundError("Assistant configuration");
      await tx.delete(userAiConfigs).where(eq(userAiConfigs.id, row.id));
      if (!row.isDefault) return;
      const [next] = await tx
        .select({ id: userAiConfigs.id })
        .from(userAiConfigs)
        .where(eq(userAiConfigs.userId, ctx.userId))
        .orderBy(desc(userAiConfigs.updatedAt))
        .limit(1);
      if (next) await tx.update(userAiConfigs).set({ isDefault: true }).where(eq(userAiConfigs.id, next.id));
    });
  },

  setDefault: async (ctx: Ctx, id: string): Promise<void> => {
    const row = await owned(ctx, id);
    await ctx.db.transaction(async (tx) => {
      await tx.update(userAiConfigs).set({ isDefault: false }).where(eq(userAiConfigs.userId, ctx.userId));
      await tx.update(userAiConfigs).set({ isDefault: true }).where(eq(userAiConfigs.id, row.id));
    });
  },

  /** The stored plaintext key, for same-configuration reuse (never leaves the server). */
  storedKey: async (ctx: Ctx, id: string): Promise<string> => {
    const row = await owned(ctx, id);
    return decryptApiKey(row.encryptedApiKey, ctx.userId);
  },
};
