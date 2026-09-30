import { expect, test } from "@playwright/test";

// Item Proposal review (#115), under PROPOSALS_EXTRACTOR=heuristic (the config default): one
// Evidence item names an action item and a dated checkpoint, the automatic pass proposes exactly
// one Task and one Milestone, and the PM accepts one with a click and edits-and-accepts the other.

test.use({ viewport: { width: 1440, height: 900 } });

const NOTES = [
  "Kickoff with the pilot team.",
  "Action item: Book the usability lab by 2026-10-10",
  "Milestone: Pilot readout on 2026-10-20.",
].join("\n");

test("the PM accepts a proposed Milestone and edits-and-accepts a proposed Task from the Overview", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const signup = await page.request.post("/api/auth/sign-up/email", {
    data: { name: "Items", email: `item-review-${crypto.randomUUID()}@test.local`, password: "items-password-123" },
  });
  expect(signup.ok()).toBeTruthy();
  await page.goto("/dashboard");
  const skip = page.getByRole("button", { name: "Skip tour" });
  if (await skip.isVisible().catch(() => false)) await skip.click();
  await page.getByRole("button", { name: "New project" }).first().click();
  await page.getByLabel("Name", { exact: true }).fill("Item Review");
  await page.getByLabel("Key").fill("ITR");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  const overview = page.url();

  await page.getByRole("main").getByRole("link", { name: "Evidence", exact: true }).click();
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const add = page.getByRole("dialog");
  await add.getByLabel("Title").fill("Kickoff notes");
  await add.getByLabel("Kind").selectOption("minutes");
  await add.getByLabel("Pasted text").fill(NOTES);
  await add.getByRole("button", { name: "Add evidence" }).click();
  await expect(add).toBeHidden({ timeout: 20_000 });

  // The automatic pass runs after the write; reload until its Proposals are there.
  const cards = page.getByTestId("item-proposal-card");
  await expect(async () => {
    await page.goto(overview);
    await expect(cards).toHaveCount(2, { timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  const taskCard = cards.filter({ hasText: "Proposed task" });
  const milestoneCard = cards.filter({ hasText: "Proposed milestone" });
  await expect(taskCard).toContainText("Book the usability lab");
  await expect(taskCard).toContainText("10 Oct 2026");
  await expect(taskCard).toContainText("Action item: Book the usability lab by 2026-10-10");
  await expect(milestoneCard).toContainText("Pilot readout");
  await expect(milestoneCard).toContainText("20 Oct 2026");
  await expect(page.getByTestId("proposal-card")).toHaveCount(0);

  await milestoneCard.getByTestId("accept-item-proposal").click();
  await expect(milestoneCard).toHaveCount(0);
  await expect(cards).toHaveCount(1);
  await expect(page.getByRole("main").getByRole("link", { name: /Pilot readout/ })).toBeVisible();

  await taskCard.getByTestId("edit-accept-item-proposal").click();
  const dialog = page.getByRole("dialog", { name: "Confirm proposed task" });
  await expect(dialog.getByLabel("Title")).toHaveValue("Book the usability lab");
  await expect(dialog.getByLabel("Due date")).toHaveValue("2026-10-10");
  await dialog.getByLabel("Title").fill("Book usability lab B");
  await dialog.getByRole("button", { name: "Accept and create task" }).click();
  await expect(dialog).toBeHidden();
  await expect(cards).toHaveCount(0);
  await expect(page.getByTestId("proposal-cards")).toHaveCount(0);
  await expect(page.getByText(/created Task "Book usability lab B"/)).toBeVisible();

  await expect(page.getByText(/created Task "Book usability lab B"/)).toContainText("via Assistant");

  await page.getByRole("main").getByRole("link", { name: "Tasks", exact: true }).click();
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(page.getByRole("main").getByText("Book usability lab B", { exact: true })).toBeVisible();

  // Both items cite the Evidence, so both are linked to it.
  await page.getByRole("main").getByRole("link", { name: "Evidence", exact: true }).click();
  await expect(page).toHaveURL(/\/evidence$/);
  await expect(page.getByRole("main").getByText("Book usability lab B", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("main").getByText("Pilot readout", { exact: true }).first()).toBeVisible();

  // Nothing new is raised again: the Proposals are resolved, not pending.
  await page.goto(overview);
  await expect(cards).toHaveCount(0);
});
