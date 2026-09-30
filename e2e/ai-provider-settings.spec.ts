import { expect, test } from "@playwright/test";

test("Assistant provider settings switch fields and protect saved-key semantics", async ({ page }) => {
  const provider = page.locator('select[name="provider"]');
  const model = page.locator('select[name="model"]');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo@example.com");
  await page.getByLabel("Password").fill("demo-password-123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/dashboard");
  await page.goto("/settings");

  await expect(page.getByRole("heading", { name: "Provider" })).toBeVisible();
  await expect(page.getByLabel("API key", { exact: true })).toHaveAttribute("type", "password");
  await expect(page.getByLabel("API key", { exact: true })).toHaveAttribute("required", "");
  await expect(page.getByLabel("Base URL")).toHaveCount(0);

  await provider.selectOption("google");
  await expect(model).toHaveValue("");
  await expect(model.locator("option")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Check available models" })).toBeVisible();
  await expect(page.getByLabel("API key", { exact: true })).toHaveAttribute("required", "");
  await page.getByRole("button", { name: "Check available models" }).click();
  await expect(page.getByText("Enter an API key before checking available models")).toBeVisible();

  await provider.selectOption("openai_compatible");
  await expect(page.getByLabel("Base URL")).toBeVisible();
  await expect(page.getByLabel("Base URL")).toHaveAttribute("required", "");
  await expect(page.getByText(/Saving then makes a small generation request/)).toBeVisible();

  await provider.selectOption("google");
  await page.locator("main .overflow-y-auto").evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.screenshot({ path: "artifacts/after-live-model-discovery.png", fullPage: true });
});
