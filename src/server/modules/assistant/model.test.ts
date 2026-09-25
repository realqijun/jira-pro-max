import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx } from "@/server/core/context";
import { ForbiddenError } from "@/server/core/errors";
import { aiConfigService } from "@/server/modules/ai-config/service";
import { userAiConfigs } from "@/server/modules/ai-config/schema";
import { closeDb, makeCtx } from "@/test/helpers";
import { getModelForUser } from "./model";

let ctx: Ctx;
let stranger: Ctx;
const encryptionKey = Buffer.alloc(32, 3).toString("base64");
const details = (model: Awaited<ReturnType<typeof getModelForUser>>) => {
  if (!model || typeof model === "string") return model;
  return { provider: model.provider, modelId: model.modelId };
};

beforeAll(async () => {
  ctx = await makeCtx();
  stranger = await makeCtx();
});
beforeEach(async () => {
  vi.unstubAllEnvs();
  vi.stubEnv("AI_CREDENTIALS_ENCRYPTION_KEY", encryptionKey);
  await ctx.db.delete(userAiConfigs);
});
afterAll(closeDb);

describe("getModelForUser", () => {
  it("resolves all environment providers and rejects unsupported or incomplete settings", async () => {
    vi.stubEnv("AI_PROVIDER", "openai");
    vi.stubEnv("OPENAI_API_KEY", "openai-key");
    vi.stubEnv("AI_MODEL", "gpt-env");
    expect(details(await getModelForUser(ctx))).toMatchObject({ provider: "openai.responses", modelId: "gpt-env" });

    vi.stubEnv("AI_PROVIDER", "anthropic");
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-key");
    vi.stubEnv("AI_MODEL", "claude-env");
    expect(details(await getModelForUser(ctx))).toMatchObject({
      provider: "anthropic.messages",
      modelId: "claude-env",
    });

    vi.stubEnv("AI_PROVIDER", "openai_compatible");
    vi.stubEnv("AI_API_KEY", "compatible-key");
    vi.stubEnv("AI_BASE_URL", "https://api.example.test/v1");
    vi.stubEnv("AI_MODEL", "custom-env");
    expect(details(await getModelForUser(ctx))).toMatchObject({
      provider: "user-openai-compatible.chat",
      modelId: "custom-env",
    });

    vi.stubEnv("AI_PROVIDER", "google");
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "google-key");
    vi.stubEnv("AI_MODEL", "gemini-3.8-flash");
    expect(details(await getModelForUser(ctx))).toMatchObject({
      provider: "google.generative-ai",
      modelId: "gemini-3.8-flash",
    });

    vi.stubEnv("AI_PROVIDER", "unsupported");
    expect(await getModelForUser(ctx)).toBeNull();
  });

  it("prefers personal configuration and restores the environment fallback after removal", async () => {
    vi.stubEnv("AI_PROVIDER", "openai");
    vi.stubEnv("OPENAI_API_KEY", "environment-key");
    vi.stubEnv("AI_MODEL", "environment-model");
    await aiConfigService.save(
      ctx,
      { provider: "anthropic", model: "personal-model", apiKey: "personal-key" },
      async () => {},
    );
    expect(details(await getModelForUser(ctx))).toMatchObject({
      provider: "anthropic.messages",
      modelId: "personal-model",
    });
    const [saved] = await aiConfigService.list(ctx);
    await aiConfigService.remove(ctx, saved.id);
    expect(details(await getModelForUser(ctx))).toMatchObject({
      provider: "openai.responses",
      modelId: "environment-model",
    });
  });

  it("honours an explicit configuration id for model switching and rejects strangers' ids", async () => {
    await aiConfigService.save(ctx, { provider: "openai", model: "default-model", apiKey: "key-a" }, async () => {});
    await aiConfigService.save(ctx, { provider: "openai", model: "switched-model", apiKey: "key-b" }, async () => {});
    const [first, second] = await aiConfigService.list(ctx);
    expect(details(await getModelForUser(ctx))).toMatchObject({ modelId: "default-model" });
    expect(details(await getModelForUser(ctx, second.id))).toMatchObject({ modelId: "switched-model" });
    expect(details(await getModelForUser(ctx, first.id))).toMatchObject({ modelId: "default-model" });
    await expect(getModelForUser(stranger, second.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getModelForUser(ctx, "missing-id")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("fails closed when a personal credential is corrupted", async () => {
    await ctx.db.insert(userAiConfigs).values({
      userId: ctx.userId,
      provider: "openai",
      model: "personal-model",
      encryptedApiKey: "v1.corrupt.value.tag",
    });
    vi.stubEnv("OPENAI_API_KEY", "environment-key");
    await expect(getModelForUser(ctx)).rejects.toThrow();
  });
});
