import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx } from "@/server/core/context";
import { closeDb, makeCtx } from "@/test/helpers";
import { userAiConfigs } from "./schema";
import { aiConfigService } from "./service";

let ctx: Ctx;
const encryptionKey = Buffer.alloc(32, 4).toString("base64");

beforeAll(async () => {
  ctx = await makeCtx();
});
beforeEach(async () => {
  vi.stubEnv("AI_CREDENTIALS_ENCRYPTION_KEY", encryptionKey);
  await ctx.db.delete(userAiConfigs);
});
afterAll(closeDb);

describe("aiConfigService.models", () => {
  it.each([
    ["openai", "https://api.openai.com/v1/models", "authorization", "Bearer account-key"],
    ["anthropic", "https://api.anthropic.com/v1/models", "x-api-key", "account-key"],
  ] as const)("returns the %s models available to the supplied account key", async (provider, url, header, value) => {
    const fetcher = vi.fn(async () =>
      Response.json({ data: [{ id: "model-b" }, { id: "model-a" }, { id: "model-a" }] }),
    );
    await expect(aiConfigService.models(ctx, { provider, apiKey: "account-key" }, fetcher)).resolves.toEqual([
      "model-a",
      "model-b",
    ]);
    expect(fetcher).toHaveBeenCalledWith(
      url,
      expect.objectContaining({ headers: expect.objectContaining({ [header]: value }), redirect: "manual" }),
    );
  });

  it("filters Gemini results to models that support content generation", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        models: [
          { name: "models/gemini-live", supportedGenerationMethods: ["bidiGenerateContent"] },
          { name: "models/gemini-flash", supportedGenerationMethods: ["generateContent"] },
        ],
      }),
    );
    await expect(aiConfigService.models(ctx, { provider: "google", apiKey: "google-key" }, fetcher)).resolves.toEqual([
      "gemini-flash",
    ]);
    expect(fetcher).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000",
      expect.objectContaining({ headers: expect.objectContaining({ "x-goog-api-key": "google-key" }) }),
    );
  });

  it("uses the stored key of a named configuration without returning it and sanitizes provider failures", async () => {
    await aiConfigService.save(ctx, { provider: "openai", model: "model-a", apiKey: "stored-secret" }, async () => {});
    const [saved] = await aiConfigService.list(ctx);
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer stored-secret");
      return Response.json({ data: [{ id: "model-a" }] });
    });
    expect(
      JSON.stringify(await aiConfigService.models(ctx, { provider: "openai", configId: saved.id }, fetcher)),
    ).not.toContain("stored-secret");
    await expect(
      aiConfigService.models(ctx, { provider: "openai", apiKey: "bad-key" }, async () =>
        Response.json({ error: { message: "secret upstream body" } }, { status: 401 }),
      ),
    ).rejects.toThrow("Could not load models");
  });
});
