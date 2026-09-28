import { expect, test, type Page } from "@playwright/test";

// Every Evidence write already schedules a Proposal pass, so by the time the PM presses
// "Propose from evidence" there is usually nothing left to read. The button must still open
// the pending Proposals for review, one at a time, and closing must accept nothing.

test.use({ viewport: { width: 1440, height: 900 } });

async function addEvidence(page: Page, title: string, body: string) {
  await page.getByRole("main").getByRole("link", { name: "Evidence", exact: true }).click();
  await expect(page).toHaveURL(/\/evidence$/);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Title").fill(title);
  await dialog.getByLabel("Kind").selectOption("minutes");
  await dialog.getByLabel("Pasted text").fill(body);
  await dialog.getByRole("button", { name: "Add evidence" }).click();
  // Ingest prunes the text over the network before the row is written.
  await expect(dialog).toBeHidden({ timeout: 20_000 });
}

test("Propose from evidence reviews the already-read Proposals one at a time", async ({ page }) => {
  test.setTimeout(90_000);
  const signup = await page.request.post("/api/auth/sign-up/email", {
    data: {
      name: "Review",
      email: `propose-review-${crypto.randomUUID()}@test.local`,
      password: "review-password-123",
    },
  });
  expect(signup.ok()).toBeTruthy();
  await page.goto("/dashboard");
  const skip = page.getByRole("button", { name: "Skip tour" });
  if (await skip.isVisible().catch(() => false)) await skip.click();
  await page.getByRole("button", { name: "New project" }).first().click();
  await page.getByLabel("Name", { exact: true }).fill("Review Project");
  await page.getByLabel("Key").fill("REV");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);

  await addEvidence(page, "Kickoff notes", "We decided to use Postgres instead of MySQL because the team knows it.");
  await addEvidence(page, "Vendor call", "We agreed to keep the vendor sandbox rather than self-hosting it.");

  await page.getByRole("main").getByRole("link", { name: "Decisions", exact: true }).click();
  await expect(page).toHaveURL(/\/decisions$/);
  const button = page.getByTestId("propose-from-evidence");
  const dialog = page.getByRole("dialog", { name: "Confirm proposed decision" });
  const position = dialog.getByTestId("proposal-position");
  // The automatic passes may still be running; press until both Proposals are pending.
  await expect(async () => {
    if (await dialog.isVisible()) await dialog.getByRole("button", { name: "Close" }).click();
    await button.click();
    await expect(position).toHaveText("Suggested decision 1 of 2", { timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
  await expect(page.getByText(/already read|proposed from/)).toBeVisible();

  const first = await dialog.getByLabel("Title").inputValue();
  await dialog.getByRole("button", { name: "Next" }).click();
  await expect(position).toHaveText("Suggested decision 2 of 2");
  await expect(dialog.getByLabel("Title")).not.toHaveValue(first);
  const second = await dialog.getByLabel("Title").inputValue();
  await expect(dialog.getByRole("button", { name: "Next" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Previous" }).click();
  await expect(position).toHaveText("Suggested decision 1 of 2");
  await expect(dialog.getByLabel("Title")).toHaveValue(first);

  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("No decisions recorded")).toBeVisible();

  // Reopening shows the same two: closing accepted nothing.
  await button.click();
  await expect(page.getByText("All evidence already read", { exact: true })).toBeVisible();
  await expect(position).toHaveText("Suggested decision 1 of 2");

  // Accepting moves straight on to the next one: the dialog never closes in between.
  await page.evaluate(() => {
    const w = window as unknown as { dialogGone: number };
    w.dialogGone = 0;
    new MutationObserver(() => {
      if (!document.querySelector('[role="dialog"]')) w.dialogGone++;
    }).observe(document.body, { childList: true, subtree: true });
  });
  await dialog.getByLabel("Decided on").fill("2026-09-15");
  await dialog.getByRole("button", { name: "Accept and create decision" }).click();
  await expect(page.getByText("1 decision · newest first")).toBeVisible();
  await expect(dialog.getByLabel("Title")).toHaveValue(second);
  await expect(position).toBeHidden();
  expect(await page.evaluate(() => (window as unknown as { dialogGone: number }).dialogGone)).toBe(0);
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(page.getByText("1 decision · newest first")).toBeVisible();
});
