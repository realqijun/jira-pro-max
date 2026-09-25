import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx } from "@/server/core/context";
import { NotFoundError, ValidationError } from "@/server/core/errors";
import { closeDb, makeCtx } from "@/test/helpers";
import { userAiConfigs } from "./schema";
import { aiConfigService } from "./service";

let owner: Ctx;
let stranger: Ctx;
const key = Buffer.alloc(32, 9).toString("base64");
const succeeds = vi.fn(async () => {});

beforeAll(async () => {
  owner = await makeCtx();
  stranger = await makeCtx();
});
beforeEach(async () => {
  vi.stubEnv("AI_CREDENTIALS_ENCRYPTION_KEY", key);
  succeeds.mockClear();
  await owner.db.delete(userAiConfigs);
});
afterAll(closeDb);

describe("aiConfigService", () => {
  it("creates a User-owned configuration, makes the first one default, and returns only safe summaries", async () => {
    await aiConfigService.save(owner, { provider: "openai", model: "gpt-test", apiKey: "sk-plaintext" }, succeeds);
    const [summary] = await aiConfigService.list(owner);
    expect(summary).toMatchObject({ provider: "openai", model: "gpt-test", baseUrl: null, isDefault: true });
    expect(JSON.stringify(await aiConfigService.list(owner))).not.toContain("plaintext");
    expect(await aiConfigService.list(stranger)).toEqual([]);
  });

  it("keeps several configurations and moves the default only on request", async () => {
    await aiConfigService.save(owner, { provider: "openai", model: "gpt-a", apiKey: "key-a" }, succeeds);
    await aiConfigService.save(owner, { provider: "anthropic", model: "claude-b", apiKey: "key-b" }, succeeds);
    const [first, second] = await aiConfigService.list(owner);
    expect(first.isDefault).toBe(true);
    expect(second.isDefault).toBe(false);
    await aiConfigService.setDefault(owner, second.id);
    const [nowDefault] = await aiConfigService.list(owner);
    expect(nowDefault).toMatchObject({ id: second.id, isDefault: true });
    await expect(aiConfigService.setDefault(stranger, second.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("updates a configuration by id, keeping the stored key when the field is blank", async () => {
    await aiConfigService.save(owner, { provider: "openai", model: "gpt-old", apiKey: "sk-old" }, succeeds);
    const [saved] = await aiConfigService.list(owner);
    await aiConfigService.save(owner, { id: saved.id, provider: "openai", model: "gpt-new", apiKey: "" }, succeeds);
    const [updated] = await aiConfigService.list(owner);
    expect(updated).toMatchObject({ id: saved.id, model: "gpt-new", isDefault: true });
    await expect(
      aiConfigService.save(stranger, { id: saved.id, provider: "openai", model: "x", apiKey: "y" }, succeeds),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      aiConfigService.save(owner, { provider: "anthropic", model: "claude-test", apiKey: "" }, succeeds),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("does not write when provider validation fails", async () => {
    await expect(
      aiConfigService.save(owner, { provider: "openai", model: "bad", apiKey: "sk-bad" }, async () => {
        throw new Error("secret provider response");
      }),
    ).rejects.toThrow("provider could not validate");
    expect(await aiConfigService.list(owner)).toEqual([]);
  });

  it("removes one configuration and promotes the most recent survivor to default", async () => {
    await aiConfigService.save(owner, { provider: "openai", model: "gpt-a", apiKey: "key-a" }, succeeds);
    await aiConfigService.save(owner, { provider: "google", model: "gemini-b", apiKey: "key-b" }, succeeds);
    const [defaultConfig, other] = await aiConfigService.list(owner);
    expect(defaultConfig.model).toBe("gpt-a");
    await aiConfigService.remove(owner, defaultConfig.id);
    const [survivor] = await aiConfigService.list(owner);
    expect(survivor).toMatchObject({ id: other.id, isDefault: true });
    await aiConfigService.remove(owner, survivor.id);
    expect(await aiConfigService.list(owner)).toEqual([]);
    await expect(aiConfigService.remove(owner, survivor.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("stores, validates, and removes a Google Gemini configuration through the same public seam", async () => {
    await aiConfigService.save(
      owner,
      { provider: "google", model: "gemini-3.8-flash", apiKey: "google-secret" },
      succeeds,
    );
    expect(succeeds).toHaveBeenCalledOnce();
    const [summary] = await aiConfigService.list(owner);
    expect(summary).toMatchObject({ provider: "google", model: "gemini-3.8-flash", baseUrl: null, isDefault: true });
    expect(JSON.stringify(await aiConfigService.list(owner))).not.toContain("google-secret");
    await aiConfigService.remove(owner, summary.id);
    expect(await aiConfigService.list(owner)).toEqual([]);
  });
});
