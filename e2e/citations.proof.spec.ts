import { expect, test } from "@playwright/test";

/**
 * Visual proof that an Assistant answer's Evidence citations render as working links
 * (issue #40 follow-up). Needs the seeded demo account and a configured chat model:
 *   npm run db:seed && E2E_PORT=3100 npx playwright test e2e/citations.proof.spec.ts
 */
const email = process.env.DEMO_EMAIL ?? "demo@example.com";
const password = process.env.DEMO_PASSWORD ?? "demo-password-123";

test.use({ viewport: { width: 1440, height: 900 } });

test("the Assistant cites Evidence with links that open the document", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/dashboard");

  await page.goto("/projects");
  await page.getByRole("link", { name: "Payments Platform Relaunch" }).first().click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  const projectUrl = page.url();

  const dock = page.getByRole("complementary", { name: "Assistant", exact: true });
  if (!(await dock.isVisible())) await page.getByRole("button", { name: "Assistant", exact: true }).click();
  await expect(dock).toBeVisible();
  // A fresh Conversation, so the citation asserted below is from this turn and not a stored one.
  await dock.getByRole("button", { name: "New chat" }).click();
  await expect(dock.getByRole("link")).toHaveCount(0);

  // Opening a new chat keeps the previous panel mounted but hidden, so target the visible one.
  const box = dock.locator("textarea[aria-label='Message']:visible");
  await expect(box).toBeEnabled();
  await box.fill("What do the documents say about the delivery blockers? Cite your sources.");
  await box.press("Enter");

  // The answer streams in; an Evidence citation is a link to this Project's Evidence page. The
  // model may also cite a Decision or a Task, so the assertions below target an Evidence one.
  // `:visible` for the same reason as the message box: the previous panel is still in the DOM.
  const citation = dock.locator('a[href*="/evidence?item="]:visible').first();
  await expect(citation).toBeVisible({ timeout: 120_000 });
  await expect(dock.getByRole("status")).toHaveCount(0, { timeout: 120_000 });
  await page.screenshot({ path: "artifacts/after-assistant-citations.png" });

  // It resolves to an Evidence item of this Project, and opens that document.
  const label = (await citation.textContent())!.trim();
  const href = await citation.getAttribute("href");
  expect(href).toMatch(/^\/projects\/[0-9a-f-]{36}\/evidence\?item=[0-9a-f-]{36}/);
  await citation.click();
  await expect(page).toHaveURL(/\/evidence\?item=[0-9a-f-]{36}/);
  expect(page.url()).toContain(new URL(projectUrl).pathname);
  await expect(page.getByRole("main").getByText(label).first()).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: "artifacts/after-assistant-citation-opened.png" });
});
