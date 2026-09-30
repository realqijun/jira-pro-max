import { expect, test, type Page } from "@playwright/test";

const stamp = Date.now().toString(36).toUpperCase().slice(-4);
const email = `e2e-${Date.now()}@test.local`;
const password = "e2e-password-123";

async function signUp(page: Page) {
  await page.goto("/signup");
  await page.getByLabel("Name").fill("E2E User");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL("/dashboard");
  // Signup starts the product tour, whose overlay takes every click until it is dismissed.
  await page.getByRole("button", { name: "Skip tour" }).click();
}

test.describe.configure({ mode: "serial" });

test("unauthenticated users are redirected to login", async ({ page }) => {
  await page.goto("/projects");
  await expect(page).toHaveURL(/\/login\?next=%2Fprojects/);
});

test("sign up → create project → create task → move it → see it on the timeline", async ({ page }) => {
  await signUp(page);
  // A new account starts with the sample Project (ADR 0013), not an empty workspace.
  await expect(page.getByText("Bedok Community Centre").first()).toBeVisible();

  await page.getByRole("button", { name: "New project" }).first().click();
  await page.getByLabel("Name").fill("E2E Project");
  await page.getByLabel("Key").fill(`E${stamp}`);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "E2E Project" })).toBeVisible();

  // Tasks: create one with dates so it shows on the timeline.
  await page.getByRole("link", { name: "Tasks" }).click();
  await page.getByRole("button", { name: "New task" }).click();
  await page.getByLabel("Title").fill("Implement v2 endpoints");
  await page.getByLabel("Start date").fill("2026-09-10");
  await page.getByLabel("Due date").fill("2026-09-20");
  await page.getByRole("button", { name: "Create task" }).click();
  await expect(page.getByText("Implement v2 endpoints")).toBeVisible();
  await expect(page.getByText(`E${stamp}-1`)).toBeVisible();

  // Open it, change status via the dialog, verify the group header moves.
  await page.getByText("Implement v2 endpoints").click();
  await page.getByLabel("Status").selectOption({ label: "In Progress" });
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  const inProgressHeader = page.locator("section", { hasText: "In Progress" }).first();
  await expect(inProgressHeader.getByText("Implement v2 endpoints")).toBeVisible();

  // Board view renders the same task in its column.
  await page.getByRole("button", { name: "board view" }).click();
  await expect(page.getByText("Implement v2 endpoints")).toBeVisible();

  // Timeline shows a bar for the task and lets us add a milestone.
  await page.getByRole("link", { name: "Timeline" }).click();
  await expect(page.getByText("1 scheduled")).toBeVisible();
  await page.getByRole("button", { name: "New milestone" }).click();
  await page.getByLabel("Name").fill("UAT begins");
  await page.getByLabel("Due date").fill("2026-09-25");
  await page.getByRole("button", { name: "Create milestone" }).click();
  await expect(page.getByText("2 scheduled")).toBeVisible();

  // Overview records the history of what we just did.
  await page.getByRole("link", { name: "Overview" }).click();
  await expect(page.getByText(/changed status on Task "Implement v2 endpoints"/)).toBeVisible();
  await expect(page.getByText(/created Milestone "UAT begins"/)).toBeVisible();
});

test("custom statuses must keep a category and cannot be deleted while in use", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "E2E Project" }).first().click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  await page.getByRole("main").getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}\/settings$/);

  await page.getByRole("button", { name: "Add", exact: true }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill("In QA");
  await dialog.getByLabel("Category").selectOption("in_progress");
  await dialog.getByRole("button", { name: "Add status" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("In QA", { exact: true })).toBeVisible();

  // The "In Progress" status is used by the task from the previous test.
  const row = page.locator("li", { has: page.getByText("In Progress", { exact: true }) }).first();
  await row.hover();
  await row.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("still use this status");
});
