import { expect, test } from "@playwright/test";

/**
 * Visual proof that a new account starts with the sample Project (ADR 0013), that it is an
 * ordinary Project of theirs, and that deleting it is a real delete.
 */
const email = `onboarding-${Date.now()}@test.local`;
const password = "e2e-password-123";
const SAMPLE = "Bedok Community Centre";

test.use({ viewport: { width: 1440, height: 900 } });
test.describe.configure({ mode: "serial" });

test("a new account starts with the sample project, and can make it its own", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel("Name").fill("Onboarding User");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL("/dashboard");

  await expect(page.getByText(SAMPLE).first()).toBeVisible();
  await page.screenshot({ path: "artifacts/after-onboarding-dashboard.png" });

  // It is theirs: the renders came with it, and it can be renamed like any other Project.
  await page.getByRole("link", { name: SAMPLE }).first().click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  await page.getByRole("link", { name: "Renders" }).click();
  await expect(page.locator("img")).toHaveCount(4);
  await expect
    .poll(() => page.locator("img").evaluateAll((els) => els.every((e) => (e as HTMLImageElement).complete)))
    .toBe(true);
  await page.screenshot({ path: "artifacts/after-onboarding-renders.png" });

  await page.getByRole("main").getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByLabel("Name").fill("Our Community Centre");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("heading", { name: "Our Community Centre" })).toBeVisible();
});

test("deleting the sample project really removes it", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/dashboard");

  await page.getByRole("link", { name: "Our Community Centre" }).first().click();
  await page.getByRole("main").getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Delete project" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Project key").fill("BCC");
  await dialog.getByRole("button", { name: "Delete everything" }).click();

  await expect(page).toHaveURL(/\/(projects|dashboard)$/);
  await expect(page.getByText("Our Community Centre")).toHaveCount(0);
  await expect(page.getByText(SAMPLE)).toHaveCount(0);
});
