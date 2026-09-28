import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { encryptApiKey } from "../src/server/modules/ai-config/crypto";

/**
 * A failed Assistant turn stays in the thread: the reply records why it failed, and a reload
 * shows the question and the error in order. The failure is a saved OpenAI-compatible config with
 * a key the provider rejects, so no working key is needed. It writes that config straight to the
 * database (the Settings form refuses a key that does not work), so it needs E2E_DATABASE_URL
 * pointing at the same database as the dev server, plus AI_CREDENTIALS_ENCRYPTION_KEY.
 */
const url = process.env.E2E_DATABASE_URL;
const sql = url ? postgres(url, { max: 1 }) : null;
test.afterAll(() => sql?.end());

test("a failed turn keeps its error in the thread across a reload", async ({ page }) => {
  test.skip(
    !sql || !process.env.AI_CREDENTIALS_ENCRYPTION_KEY,
    "needs E2E_DATABASE_URL and AI_CREDENTIALS_ENCRYPTION_KEY",
  );
  test.setTimeout(90_000);
  const email = `turn-error-${Date.now()}@test.local`;
  await page.goto("/signup");
  await page.getByLabel("Name").fill("Turn Error");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("turn-error-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL("/dashboard");
  await page.getByRole("button", { name: "Skip tour" }).click();
  const [{ id: userId }] = await sql!`select id from "user" where email = ${email}`;
  await sql!`
    insert into user_ai_configs (user_id, provider, model, base_url, encrypted_api_key, is_default)
    values (${userId}, 'openai_compatible', 'openai/gpt-4o-mini', 'https://openrouter.ai/api/v1',
      ${encryptApiKey("sk-or-rejected", userId)}, true)`;

  const dock = page.getByRole("complementary", { name: "Assistant" });
  if (!(await dock.isVisible())) await page.getByRole("button", { name: "Assistant" }).first().click();
  await dock.getByLabel("Message").fill("create a project titled underwater data centre");
  await dock.getByLabel("Message").press("Enter");

  const error = dock.getByRole("status").filter({ hasText: "The AI provider rejected the API key" });
  await expect(error).toBeVisible({ timeout: 60_000 });
  // The reply carries the error, so the generic notice does not repeat it.
  await expect(dock.getByText("Something went wrong")).toHaveCount(0);
  await page.screenshot({ path: "artifacts/after-turn-error-live.png" });

  await page.reload();
  const thread = page.getByRole("complementary", { name: "Assistant" }).getByRole("listitem");
  await expect(thread).toHaveCount(2);
  await expect(thread.nth(0)).toHaveText("create a project titled underwater data centre");
  await expect(thread.nth(1)).toContainText("The AI provider rejected the API key");
  await page.screenshot({ path: "artifacts/after-turn-error-reload.png" });
});
