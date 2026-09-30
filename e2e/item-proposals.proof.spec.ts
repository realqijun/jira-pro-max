import { expect, test, type Page } from "@playwright/test";

/**
 * Visual proof for item Proposal review (#115): the Overview queue with a proposed Task and a
 * proposed Milestone, and both dialogs "Edit and accept" opens prefilled. `PROOF_PHASE=before`
 * captures the Overview only, for the baseline before the review surface existed.
 */
const phase = process.env.PROOF_PHASE === "before" ? "before" : "after";
const NOTES = [
  "Kickoff with the pilot team.",
  "Action item: Book the usability lab by 2026-10-10",
  "Milestone: Pilot readout on 2026-10-20.",
].join("\n");

test.use({ viewport: { width: 1440, height: 900 } });

async function projectWithItemProposals(page: Page) {
  const signup = await page.request.post("/api/auth/sign-up/email", {
    data: { name: "Proof", email: `item-proof-${crypto.randomUUID()}@test.local`, password: "proof-password-123" },
  });
  expect(signup.ok()).toBeTruthy();
  await page.goto("/dashboard");
  const skip = page.getByRole("button", { name: "Skip tour" });
  if (await skip.isVisible().catch(() => false)) await skip.click();
  await page.getByRole("button", { name: "New project" }).first().click();
  await page.getByLabel("Name", { exact: true }).fill("Pilot Study");
  await page.getByLabel("Key").fill("PIL");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  const overview = page.url();

  await page.getByRole("main").getByRole("link", { name: "Evidence", exact: true }).click();
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Title").fill("Kickoff notes");
  await dialog.getByLabel("Kind").selectOption("minutes");
  await dialog.getByLabel("Pasted text").fill(NOTES);
  await dialog.getByRole("button", { name: "Add evidence" }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  return overview;
}

test(`item Proposal review (${phase})`, async ({ page }) => {
  test.setTimeout(90_000);
  const overview = await projectWithItemProposals(page);
  if (phase === "before") {
    // The automatic pass runs after the Evidence write; give it time so the baseline is honest.
    await page.waitForTimeout(3_000);
    await page.goto(overview);
    await page.screenshot({ path: "artifacts/before-item-proposal-review.png", fullPage: true });
    return;
  }
  const cards = page.getByTestId("item-proposal-card");
  await expect(async () => {
    await page.goto(overview);
    await expect(cards).toHaveCount(2, { timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await page.screenshot({ path: "artifacts/after-item-proposal-cards.png", fullPage: true, animations: "disabled" });

  await cards.filter({ hasText: "Proposed task" }).getByTestId("edit-accept-item-proposal").click();
  const taskDialog = page.getByRole("dialog", { name: "Confirm proposed task" });
  await expect(taskDialog.getByLabel("Title")).toHaveValue("Book the usability lab");
  await page.screenshot({ path: "artifacts/after-item-proposal-task-dialog.png", animations: "disabled" });
  await taskDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(taskDialog).toBeHidden();

  await cards.filter({ hasText: "Proposed milestone" }).getByTestId("edit-accept-item-proposal").click();
  const milestoneDialog = page.getByRole("dialog", { name: "Confirm proposed milestone" });
  await expect(milestoneDialog.getByLabel("Name")).toHaveValue("Pilot readout");
  await page.screenshot({ path: "artifacts/after-item-proposal-milestone-dialog.png", animations: "disabled" });
});
