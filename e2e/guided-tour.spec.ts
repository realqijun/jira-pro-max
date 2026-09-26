import { expect, test } from "@playwright/test";

test("restarting the guided tour from Settings begins on the dashboard", async ({ page }) => {
  const signIn = await page.request.post("/api/auth/sign-in/email", {
    data: { email: "demo@example.com", password: "demo-password-123" },
  });
  expect(signIn.ok()).toBe(true);

  await page.goto("/dashboard");
  await expect(page).toHaveURL("/dashboard");

  await page.goto("/settings");
  await page.screenshot({ path: "artifacts/before-guided-tour.png" });
  await page.getByRole("switch", { name: "Show the guided tour" }).click();

  await expect(page).toHaveURL("/dashboard");
  await expect(page.getByRole("dialog", { name: "Product tour" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Welcome to PrismPM" })).toBeVisible();
  await page.screenshot({ path: "artifacts/after-guided-tour.png" });
});
