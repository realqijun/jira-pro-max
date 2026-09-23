import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { addDays, format } from "date-fns";
import fs from "node:fs";
import path from "node:path";

/**
 * End-to-end walkthrough of every user flow. Each `test.describe` is one flow and drops
 * numbered screenshots into docs/<flow>/screenshots so the docs stay in sync with the UI.
 * Runs serially against a single fresh account created in the first flow.
 */

const run = Date.now();
const stamp = run.toString(36).toUpperCase().slice(-4);
const key = `F${stamp}`;
const email = `flows-${run}@test.local`;
const password = "flows-password-123";
const projectName = "Payments Migration";
let sessionCookies: Awaited<ReturnType<BrowserContext["cookies"]>> | undefined;

const shots = (flow: string) => {
  const dir = path.join("docs", flow, "screenshots");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  let n = 0;
  return (page: Page, name: string) =>
    page.screenshot({
      path: path.join(dir, `${String(++n).padStart(2, "0")}-${name}.png`),
      fullPage: true,
      animations: "disabled",
    });
};

async function login(page: Page) {
  // The auth flow exercises sign-in once; subsequent flows reuse its session.
  // Repeated sign-ins from the same browser-test host hit production rate limits.
  if (sessionCookies) {
    await page.context().addCookies(sessionCookies);
    await page.goto("/dashboard");
    await expect(page).toHaveURL("/dashboard");
    return;
  }
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/dashboard");
  sessionCookies = await page.context().cookies();
}

async function openProject(page: Page, section?: string) {
  await login(page);
  await page.getByRole("link", { name: projectName }).first().click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  if (section) {
    await page.getByRole("main").getByRole("link", { name: section, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/[0-9a-f-]{36}/${section.toLowerCase()}$`));
  }
}

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1440, height: 900 } });

test.describe("auth", () => {
  const shot = shots("auth");

  test("redirects anonymous visitors, signs up, signs out and signs back in", async ({ page }) => {
    await page.goto("/projects");
    await expect(page).toHaveURL(/\/login\?next=%2Fprojects/);
    await shot(page, "login-redirect");

    await page.goto("/signup");
    await page.getByLabel("Name").fill("Flows User");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await shot(page, "signup-filled");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL("/dashboard");
    // A new account is not empty: every User starts with the sample Project (ADR 0013).
    await expect(page.getByText("Bedok Community Centre").first()).toBeVisible();
    await shot(page, "starter-workspace");

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login/);
    await shot(page, "signed-out");

    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("wrong-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await shot(page, "login-wrong-password");

    await login(page);
    await shot(page, "logged-in");
  });
});

test.describe("project", () => {
  const shot = shots("project");

  test("creates a project and lands on its overview", async ({ page }) => {
    await login(page);
    await page.getByRole("button", { name: "New project" }).first().click();
    await page.getByLabel("Name").fill(projectName);
    await page.getByLabel("Key").fill(key);
    await page.getByLabel("Description").fill("Move card processing from the legacy gateway to the new PSP.");
    await shot(page, "create-dialog");
    await page.getByRole("button", { name: "Create project" }).click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: projectName })).toBeVisible();
    await shot(page, "overview-empty");

    await page.getByRole("link", { name: "Projects", exact: true }).click();
    await expect(page).toHaveURL("/projects");
    await expect(page.getByRole("link", { name: projectName }).first()).toBeVisible();
    await shot(page, "projects-list");
  });
});

test.describe("people", () => {
  const shot = shots("people");

  test("adds a team and people, edits and removes them", async ({ page }) => {
    await openProject(page, "People");
    await shot(page, "empty");

    await page.getByRole("button", { name: "Add team" }).click();
    await page.getByLabel("Name").fill("Team B — Backend API");
    await page.getByLabel("Description").fill("Owns the gateway integration");
    await shot(page, "add-team-dialog");
    await page.getByRole("button", { name: "Add team" }).last().click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page.getByText("Team B — Backend API")).toBeVisible();

    for (const [name, role] of [
      ["Priya Nair", "Backend lead"],
      ["Marcus Lee", "QA"],
    ]) {
      await page.getByRole("button", { name: "Add person" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Name").fill(name);
      await dialog.getByLabel("Role").fill(role);
      await dialog.getByLabel("Email").fill(`${name.split(" ")[0].toLowerCase()}@example.com`);
      await dialog.getByLabel("Team").selectOption({ label: "Team B — Backend API" });
      if (name === "Priya Nair") await shot(page, "add-person-dialog");
      await dialog.getByRole("button", { name: "Add person" }).click();
      await expect(dialog).toBeHidden();
      await expect(page.getByText(name)).toBeVisible();
    }
    await expect(page.getByText("2 people")).toBeVisible();
    await shot(page, "people-and-team");

    // Edit a person's role.
    const row = page.locator("div.group", { hasText: "Marcus Lee" }).first();
    await row.hover();
    await row.getByRole("button", { name: "Edit" }).click();
    await page.getByRole("dialog").getByLabel("Role").fill("QA lead");
    await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page.getByText("QA lead")).toBeVisible();

    // Add and remove a throwaway person to cover delete.
    await page.getByRole("button", { name: "Add person" }).click();
    await page.getByRole("dialog").getByLabel("Name").fill("Temp Contractor");
    await page.getByRole("dialog").getByRole("button", { name: "Add person" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    const temp = page.locator("div.group", { hasText: "Temp Contractor" }).first();
    await temp.hover();
    await temp.getByRole("button", { name: "Delete" }).click();
    await shot(page, "remove-person-confirm");
    await page.getByRole("dialog").getByRole("button", { name: "Remove" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page.getByText("Temp Contractor")).toBeHidden();
    await shot(page, "final");
  });
});

test.describe("settings", () => {
  const shot = shots("settings");

  test("edits details, manages statuses and labels", async ({ page }) => {
    await openProject(page, "Settings");
    await shot(page, "overview");

    // Details
    await page.getByLabel("Health").selectOption("amber");
    await page.getByLabel("Start date").fill("2026-09-01");
    await page.getByLabel("Target date").fill("2026-12-15");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();
    await shot(page, "details-saved");

    // Custom task status
    await page.getByRole("button", { name: "Add", exact: true }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill("In QA");
    await dialog.getByLabel("Category").selectOption("in_progress");
    await shot(page, "add-status-dialog");
    await dialog.getByRole("button", { name: "Add status" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("In QA", { exact: true })).toBeVisible();

    // Labels
    for (const name of ["backend", "vendor"]) {
      await page.getByRole("button", { name: "Add label" }).click();
      await page.getByRole("dialog").getByLabel("Name").fill(name);
      await page.getByRole("dialog").getByRole("button", { name: "Add label" }).click();
      await expect(page.getByRole("dialog")).toBeHidden();
      await expect(page.getByText(name, { exact: true })).toBeVisible();
    }
    await shot(page, "statuses-and-labels");

    // Deleting the project needs the key typed; cancel to keep it.
    await page.getByRole("button", { name: "Delete project" }).click();
    await shot(page, "delete-project-confirm");
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
  });
});

test.describe("tasks", () => {
  const shot = shots("tasks");

  test("creates, edits, filters and moves tasks between list and board", async ({ page }) => {
    await openProject(page, "Tasks");
    await shot(page, "empty");

    const tasks = [
      {
        title: "Implement v2 endpoints",
        start: "2026-09-10",
        due: "2026-09-20",
        owner: "Priya Nair",
        priority: "high",
      },
      {
        title: "Load-test the new gateway",
        start: "2026-09-21",
        due: "2026-09-28",
        owner: "Marcus Lee",
        priority: "medium",
      },
      { title: "Write cutover runbook", start: "", due: "2026-10-02", owner: "", priority: "low" },
    ];
    for (const t of tasks) {
      await page.getByRole("button", { name: "New task" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Title").fill(t.title);
      await dialog.getByLabel("Priority").selectOption(t.priority);
      if (t.owner) await dialog.getByLabel("Owner").selectOption({ label: t.owner });
      if (t.start) await dialog.getByLabel("Start date").fill(t.start);
      await dialog.getByLabel("Due date").fill(t.due);
      if (t.title === tasks[0].title) {
        await dialog.getByLabel("Description").fill("Expose /v2/charges and /v2/refunds behind the feature flag.");
        await dialog.getByLabel("Team").selectOption({ label: "Team B — Backend API" });
        await dialog.getByRole("button", { name: "backend" }).click();
        await shot(page, "create-dialog");
      }
      await dialog.getByRole("button", { name: "Create task" }).click();
      await expect(dialog).toBeHidden();
      await expect(page.getByText(t.title)).toBeVisible();
    }
    await expect(page.getByText(`${key}-1`)).toBeVisible();
    await expect(page.getByText(`${key}-3`)).toBeVisible();
    await shot(page, "list");

    // Edit: move the first task to In Progress.
    await page.getByText(tasks[0].title).click();
    await expect(page.getByRole("dialog", { name: `${key}-1` })).toBeVisible();
    await shot(page, "edit-dialog");
    await page.getByLabel("Status").selectOption({ label: "In Progress" });
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    const inProgress = page.locator("section", { hasText: "In Progress" }).first();
    await expect(inProgress.getByText(tasks[0].title)).toBeVisible();
    await shot(page, "list-after-status-change");

    // Board view groups by status.
    await page.getByRole("button", { name: "board view" }).click();
    await expect(page.getByText(tasks[0].title)).toBeVisible();
    await shot(page, "board");

    // Delete the third task from its dialog.
    await page.getByText(tasks[2].title).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
    await shot(page, "delete-confirm");
    await page.getByRole("dialog").getByRole("button", { name: "Delete task" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page.getByText(tasks[2].title)).toBeHidden();
    await page.getByRole("button", { name: "list view" }).click();
    await shot(page, "list-after-delete");
  });
});

test.describe("timeline", () => {
  const shot = shots("timeline");

  test("adds milestones, links dependencies and shows them on the Gantt", async ({ page }) => {
    await openProject(page, "Timeline");
    await expect(page.getByText("2 scheduled")).toBeVisible();
    await shot(page, "tasks-only");

    await page.getByRole("button", { name: "New milestone" }).click();
    await page.getByLabel("Name").fill("UAT begins");
    await page.getByLabel("Due date").fill("2026-10-05");
    await shot(page, "new-milestone-dialog");
    await page.getByRole("button", { name: "Create milestone" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page.getByText("3 scheduled")).toBeVisible();

    // Dependency: load test is blocked by the endpoints task.
    await page.getByRole("link", { name: "Tasks", exact: true }).click();
    await expect(page).toHaveURL(/\/tasks$/);
    await page.getByText("Load-test the new gateway").first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Milestone").selectOption({ label: "UAT begins" });
    await dialog.getByRole("button", { name: "Add predecessor" }).click();
    await dialog.getByRole("combobox").filter({ hasText: "Choose…" }).selectOption({ label: "Implement v2 endpoints" });
    await dialog.getByRole("button", { name: "Add", exact: true }).click();
    await expect(dialog.getByText("Implement v2 endpoints").last()).toBeVisible();
    await shot(page, "dependency-editor");

    // A cycle must be rejected.
    await dialog.getByRole("button", { name: "Add successor" }).click();
    await dialog.getByRole("combobox").filter({ hasText: "Choose…" }).selectOption({ label: "Implement v2 endpoints" });
    await dialog.getByRole("button", { name: "Add", exact: true }).click();
    await expect(dialog.getByText(/cycle|already|circular/i)).toBeVisible();
    await shot(page, "dependency-cycle-rejected");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog).toBeHidden();

    await page.getByRole("link", { name: "Timeline", exact: true }).click();
    await expect(page.getByText("3 scheduled · 1 dependencies")).toBeVisible();
    await shot(page, "gantt-with-dependency");
    await page.getByRole("button", { name: "Zoom out" }).click();
    await shot(page, "gantt-zoomed-out");
  });
});

test.describe("risks", () => {
  const shot = shots("risks");

  test("records risks, changes severity inline and closes one", async ({ page }) => {
    await openProject(page, "Risks");
    await shot(page, "empty");

    await page.getByRole("button", { name: "New risk" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Title").fill("Vendor access delay blocks testing");
    await dialog.getByLabel("Cause").fill("PSP sandbox credentials not yet issued");
    await dialog.getByLabel("Impact", { exact: true }).fill("Load test slips a week");
    await dialog.getByLabel("Probability").selectOption("high");
    await dialog.getByLabel("Impact level").selectOption("high");
    await dialog.getByLabel("Owner").selectOption({ label: "Priya Nair" });
    await dialog.getByLabel("Mitigation").fill("Escalate to vendor PM; use mock server meanwhile");
    await dialog.getByLabel("Review date").fill("2026-09-25");
    await shot(page, "new-risk-dialog");
    await dialog.getByRole("button", { name: "Create risk" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("R-1")).toBeVisible();

    await page.getByRole("button", { name: "New risk" }).click();
    await page.getByRole("dialog").getByLabel("Title").fill("Key engineer on leave during cutover");
    await page.getByRole("dialog").getByLabel("Probability").selectOption("low");
    await page.getByRole("dialog").getByRole("button", { name: "Create risk" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page.getByText("2 risks · sorted by severity")).toBeVisible();
    await shot(page, "register");

    // Open R-2 and close it via the dialog, then toggle Show closed.
    await page.getByText("Key engineer on leave during cutover").click();
    await expect(page.getByRole("dialog", { name: "R-2" })).toBeVisible();
    await shot(page, "edit-dialog");
    const closed = page
      .getByRole("dialog")
      .getByLabel("Status")
      .locator("option", { hasText: /closed|resolved|accepted/i })
      .first();
    await page
      .getByRole("dialog")
      .getByLabel("Status")
      .selectOption({ label: (await closed.textContent()) ?? "" });
    await page.getByRole("dialog").getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page.getByText("1 risk · sorted by severity")).toBeVisible();
    await page.getByLabel("Show closed").check();
    await expect(page.getByText("2 risks · sorted by severity")).toBeVisible();
    await shot(page, "register-with-closed");
  });
});

test.describe("evidence", () => {
  const shot = shots("evidence");

  test("adds pasted notes and an uploaded file, edits and deletes", async ({ page }) => {
    await openProject(page, "Evidence");
    await shot(page, "empty");

    await page.getByRole("button", { name: "Add", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Title").fill("Weekly sync minutes — 12 Sep");
    await dialog.getByLabel("Kind").selectOption("minutes");
    await dialog.getByLabel("Source date").fill("2026-09-12");
    await dialog
      .getByLabel("Pasted text")
      .fill(
        "Attendees: Priya, Marcus\n\n- v2 endpoints on track for 20 Sep\n- Vendor sandbox still pending\n- UAT proposed for 5 Oct",
      );
    await shot(page, "add-dialog");
    await dialog.getByRole("button", { name: "Add evidence" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("heading", { name: "Weekly sync minutes — 12 Sep" })).toBeVisible();
    await shot(page, "pasted-notes");

    await page.getByRole("button", { name: "Add", exact: true }).click();
    await page.getByRole("dialog").getByLabel("Title").fill("Cutover plan v1");
    await page.getByRole("dialog").getByLabel("Kind").selectOption("plan");
    await page
      .getByRole("dialog")
      .getByLabel("File")
      .setInputFiles({
        name: "cutover-plan.md",
        mimeType: "text/markdown",
        buffer: Buffer.from("# Cutover plan\n\n1. Freeze legacy\n2. Flip flag\n3. Monitor 24h\n"),
      });
    await page.getByRole("dialog").getByRole("button", { name: "Add evidence" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await page.getByRole("button", { name: "Cutover plan v1" }).click();
    await expect(page.getByRole("link", { name: /cutover-plan\.md/ })).toBeVisible();
    await expect(page.getByText("2 items")).toBeVisible();
    await shot(page, "uploaded-file");

    await page.getByRole("button", { name: "Edit" }).click();
    await page.getByRole("dialog").getByLabel("Notes").fill("Superseded by v2 after the vendor call");
    await page.getByRole("dialog").getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page.getByText("Superseded by v2 after the vendor call")).toBeVisible();

    await page.getByRole("button", { name: "Delete" }).click();
    await shot(page, "delete-confirm");
    await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page.getByText("1 item", { exact: true })).toBeVisible();
    await shot(page, "after-delete");
  });
});

test.describe("overview", () => {
  const shot = shots("overview");

  test("project overview and workspace home reflect everything recorded", async ({ page }) => {
    await openProject(page);
    await expect(page.getByText(/changed status on Task "Implement v2 endpoints"/)).toBeVisible();
    await expect(page.getByText(/created Milestone "UAT begins"/)).toBeVisible();
    await expect(page.getByText(/created Risk "Vendor access delay blocks testing"/)).toBeVisible();
    await shot(page, "project-overview");

    await page.getByRole("link", { name: "Dashboard", exact: true }).click();
    await expect(page).toHaveURL("/dashboard");
    await expect(page.getByRole("link", { name: projectName }).first()).toBeVisible();
    await shot(page, "workspace-dashboard");
  });
});

test.describe("calendar", () => {
  const shot = shots("calendar");

  test("workspace and project calendars show due dates and milestones", async ({ page }) => {
    await login(page);
    await page.getByRole("link", { name: "Calendar", exact: true }).click();
    await expect(page).toHaveURL("/calendar");
    await expect(page.getByTitle("Implement v2 endpoints")).toBeVisible();
    await shot(page, "workspace-september");
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByTitle("UAT begins")).toBeVisible();
    await shot(page, "workspace-october");

    await page.getByRole("link", { name: projectName }).first().click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
    await page.locator("nav").last().getByRole("link", { name: "Calendar", exact: true }).click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}\/calendar$/);
    await expect(page.getByTitle("Implement v2 endpoints")).toBeVisible();
    await shot(page, "project-calendar");

    // Clicking an event opens the task.
    await page.getByTitle("Implement v2 endpoints").click();
    await expect(page.getByRole("dialog", { name: `${key}-1` })).toBeVisible();
    await shot(page, "event-opens-task");
  });
});

test.describe("command-palette", () => {
  const shot = shots("command-palette");

  test("⌘K jumps between sections and projects", async ({ page }) => {
    await login(page);
    await page.keyboard.press("Meta+k");
    const input = page.getByPlaceholder("Type a command or search…");
    await expect(input).toBeVisible();
    await shot(page, "open");
    await input.fill("Payments");
    await shot(page, "search-project");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);

    await page.keyboard.press("Meta+k");
    await input.fill("Risks");
    await shot(page, "search-section");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/risks$/);
    await shot(page, "navigated-to-risks");
  });
});

test.describe("comments", () => {
  const shot = shots("comments");

  test("posts, lists, counts and deletes a Comment on a Task", async ({ page }) => {
    await openProject(page, "Tasks");
    await page.getByText("Implement v2 endpoints").first().click();
    const dialog = page.getByRole("dialog", { name: `${key}-1` });
    await expect(dialog.getByText("No comments yet.")).toBeVisible();
    await shot(page, "task-dialog-empty-thread");

    const body = "Vendor confirmed 17 Sep in Friday's meeting.\nSee https://example.com/minutes";
    const composer = dialog.getByRole("textbox", { name: "Comment" });
    await composer.fill(body);
    await dialog.getByLabel("Said by").selectOption({ label: "Priya Nair" });
    await dialog.getByLabel("Said on").fill("2026-09-12");
    await shot(page, "composer-filled");
    await composer.press("ControlOrMeta+Enter");
    const thread = dialog.getByRole("listitem").filter({ hasText: "Vendor confirmed 17 Sep" });
    await expect(thread).toBeVisible();
    await expect(thread.getByText("Priya Nair")).toBeVisible();
    await expect(thread.getByText("said 12 Sep 2026")).toBeVisible();
    await expect(thread.getByRole("link", { name: "https://example.com/minutes" })).toBeVisible();
    await expect(composer).toHaveValue("");
    await expect(dialog).toBeVisible(); // posting never submits the parent form
    await shot(page, "comment-posted");

    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTitle("1 comment")).toBeVisible();
    await shot(page, "list-with-count");
    await page.getByRole("button", { name: "board view" }).click();
    await expect(page.getByTitle("1 comment")).toBeVisible();
    await shot(page, "board-with-count");
    await page.getByRole("button", { name: "list view" }).click();

    await page.getByText("Implement v2 endpoints").first().click();
    await dialog.getByRole("button", { name: "Delete comment" }).click();
    await expect(dialog.getByText("Delete this comment?")).toBeVisible();
    await shot(page, "delete-confirm");
    await dialog
      .getByRole("listitem")
      .filter({ hasText: "Delete this comment?" })
      .getByRole("button", { name: "Delete", exact: true })
      .click();
    await expect(dialog.getByText("No comments yet.")).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTitle("1 comment")).toBeHidden();

    await page.getByRole("link", { name: "Overview", exact: true }).click();
    await expect(page.getByText(new RegExp(`created Comment "${key}-1: Vendor confirmed`))).toBeVisible();
    await expect(page.getByText(new RegExp(`deleted Comment "${key}-1: Vendor confirmed`))).toBeVisible();
    await shot(page, "overview-feed");
  });
});

test.describe("evidence-links", () => {
  const shot = shots("evidence-links");

  test("links evidence to a task from both sides and unlinks it", async ({ page }) => {
    // State from earlier flows: Task `${key}-1 Implement v2 endpoints`, Risk R-1, one Evidence record.
    await openProject(page, "Tasks");
    await page.getByText("Implement v2 endpoints").first().click();
    const dialog = page.getByRole("dialog", { name: `${key}-1` });
    await expect(dialog.getByText("No linked evidence")).toBeVisible();
    await shot(page, "task-dialog-before-link");
    await dialog.getByRole("button", { name: "Add evidence" }).click();
    await dialog.getByPlaceholder("Search evidence…").fill("Weekly");
    await dialog.getByRole("option", { name: /^Weekly sync minutes/ }).click();
    await expect(dialog.getByRole("link", { name: "Weekly sync minutes — 12 Sep" })).toBeVisible();
    await expect(dialog).toBeVisible(); // picking never submits the parent form
    await shot(page, "task-dialog-linked");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page.getByLabel("1 linked evidence")).toBeVisible(); // row count
    await shot(page, "list-row-count");

    await page.getByRole("link", { name: "Evidence", exact: true }).click();
    await expect(page).toHaveURL(/\/evidence$/);
    await expect(page.getByRole("link", { name: `${key}-1 Implement v2 endpoints` })).toBeVisible();
    await shot(page, "evidence-linked-to");

    // Link a Risk from the Evidence side, found by key.
    await page.getByRole("button", { name: "Link item" }).click();
    await page.getByPlaceholder("Search tasks, risks, milestones…").fill("R-1");
    await page.getByRole("option", { name: /Vendor access delay/ }).click();
    await expect(page.getByRole("link", { name: "R-1 Vendor access delay blocks testing" })).toBeVisible();
    await shot(page, "evidence-linked-risk");

    // Unlink the Task from the Evidence side; the Evidence itself stays.
    await page.getByRole("button", { name: `Unlink ${key}-1 Implement v2 endpoints` }).click();
    await expect(page.getByRole("link", { name: `${key}-1 Implement v2 endpoints` })).toBeHidden();
    await expect(page.getByRole("heading", { name: "Weekly sync minutes — 12 Sep" })).toBeVisible();
    await shot(page, "evidence-after-unlink");

    // An item chip opens that item's dialog, which shows the Evidence chip.
    await page.getByRole("link", { name: "R-1 Vendor access delay blocks testing" }).click();
    await expect(page.getByRole("dialog", { name: "R-1" })).toBeVisible();
    await expect(page.getByRole("dialog").getByRole("link", { name: "Weekly sync minutes — 12 Sep" })).toBeVisible();
    await shot(page, "risk-dialog-from-chip");
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();

    await page.getByRole("link", { name: "Tasks", exact: true }).click();
    await expect(page.getByLabel("1 linked evidence")).toBeHidden();
    await page.getByText("Implement v2 endpoints").first().click();
    await expect(page.getByRole("dialog").getByText("No linked evidence")).toBeVisible();
    await shot(page, "task-dialog-unlinked");
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();

    // Link/unlink are recorded against the item, not the Evidence.
    await page.getByRole("link", { name: "Overview", exact: true }).click();
    await expect(
      page.getByText(/changed evidence on Task "Implement v2 endpoints": empty → Weekly sync minutes/),
    ).toBeVisible();
    await expect(
      page.getByText(/changed evidence on Task "Implement v2 endpoints": Weekly sync minutes — 12 Sep → empty/),
    ).toBeVisible();
    await expect(page.getByText(/changed evidence on Risk "Vendor access delay blocks testing"/)).toBeVisible();
    await shot(page, "overview-feed");
  });
});

test.describe("attention", () => {
  const shot = shots("attention");
  // Attention rules key on the server's calendar date, so the fixtures are dated relative to now.
  const d = (n: number) => format(addDays(new Date(), n), "yyyy-MM-dd");

  test("overview groups attention by rule, dashboard shows per-project counts, items open their dialog", async ({
    page,
  }) => {
    await openProject(page, "Tasks");
    const create = async (title: string, o: { start?: string; due: string }) => {
      await page.getByRole("button", { name: "New task" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Title").fill(title);
      if (o.start) await dialog.getByLabel("Start date").fill(o.start);
      await dialog.getByLabel("Due date").fill(o.due);
      await dialog.getByRole("button", { name: "Create task" }).click();
      await expect(dialog).toBeHidden();
      await expect(page.getByText(title).first()).toBeVisible();
    };
    await create("Reconcile legacy ledger", { due: d(-3) }); // -> task_overdue
    await create("Rotate PSP credentials", { due: d(20) }); // -> task_blocked
    await page.getByText("Rotate PSP credentials").first().click();
    await page.getByRole("dialog").getByLabel("Status").selectOption({ label: "Blocked" });
    await page.getByRole("dialog").getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await create("Vendor delivers sandbox", { due: d(10) }); // upstream
    await create("Run vendor smoke test", { start: d(2), due: d(6) }); // -> dependency_late
    await page.getByText("Run vendor smoke test").first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Add predecessor" }).click();
    await dialog
      .getByRole("combobox")
      .filter({ hasText: "Choose…" })
      .selectOption({ label: "Vendor delivers sandbox" });
    await dialog.getByRole("button", { name: "Add", exact: true }).click();
    await expect(dialog.getByText("Vendor delivers sandbox").last()).toBeVisible();
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog).toBeHidden();
    await shot(page, "tasks-seeded");

    await page.getByRole("link", { name: "Overview", exact: true }).click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
    const list = page.locator("section", { hasText: "Needs attention" }).first();
    await expect(list.getByText("Overdue", { exact: true }).first()).toBeVisible();
    // Tolerant of midnight/clock skew between Playwright and the server: any past-day count.
    await expect(
      list
        .getByTestId("attention-item")
        .filter({ hasText: "Reconcile legacy ledger" })
        .getByText(/Due .*, \d+ days? ago/),
    ).toBeVisible();
    await expect(list.getByText("Blocked", { exact: true }).first()).toBeVisible();
    await expect(list.getByText("Late dependency", { exact: true }).first()).toBeVisible();
    await expect(list.getByText(/Depends on .*, due .*, after start/)).toBeVisible();
    await shot(page, "overview-groups");

    // Collapsing a group keeps its count visible in the summary.
    await list.getByText("Overdue", { exact: true }).first().click();
    await expect(list.getByText("Reconcile legacy ledger")).toBeHidden();
    await expect(list.getByText("Overdue", { exact: true }).first()).toBeVisible();
    await shot(page, "overview-collapsed");

    await page.getByRole("link", { name: "Dashboard", exact: true }).click();
    await expect(page).toHaveURL("/dashboard");
    const row = page.getByRole("link", { name: projectName }).filter({ hasText: /overdue/ });
    await expect(row.getByText(/\d+ overdue/)).toBeVisible();
    await expect(row.getByText(/\d+ blocked/)).toBeVisible();
    await expect(row.getByText(/\d+ late dependenc/)).toBeVisible();
    await expect(page.getByText("Due in 7 days")).toBeVisible();
    await shot(page, "dashboard-counts");

    await page.getByTestId("attention-item").filter({ hasText: "Reconcile legacy ledger" }).first().click();
    await expect(page).toHaveURL(/\/tasks\?task=/);
    await expect(page.getByRole("dialog").getByLabel("Title")).toHaveValue("Reconcile legacy ledger");
    await shot(page, "item-opens-task");
  });
});

test.describe("history", () => {
  const shot = shots("history");

  test("shows an item's field changes, grouped per save, with names and dates", async ({ page }) => {
    await openProject(page, "Tasks");
    await page.getByRole("button", { name: "New task" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("tab")).toHaveCount(0); // create mode: no tabs
    await shot(page, "create-dialog-no-tabs");
    await dialog.getByLabel("Title").fill("Rotate PSP API keys");
    await dialog.getByLabel("Due date").fill("2026-09-18");
    await dialog.getByRole("button", { name: "Create task" }).click();
    await expect(dialog).toBeHidden();

    await page.getByText("Rotate PSP API keys").click();
    await expect(dialog.getByRole("tab", { name: "Details" })).toHaveAttribute("aria-selected", "true");
    await shot(page, "edit-dialog-details-tab");
    await dialog.getByRole("tab", { name: "History" }).click();
    await expect(dialog.getByText("Created", { exact: true })).toBeVisible();
    await shot(page, "history-fresh");

    await dialog.getByRole("tab", { name: "Details" }).click();
    // History groups events by actor and second; make sure the save lands in a later second than the create.
    await page.waitForTimeout(1100);
    await dialog.getByLabel("Status").selectOption({ label: "In Progress" });
    await dialog.getByLabel("Owner").selectOption({ label: "Priya Nair" });
    await dialog.getByLabel("Due date").fill("2026-09-23");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog).toBeHidden();

    await page.getByText("Rotate PSP API keys").click();
    await dialog.getByRole("tab", { name: "History" }).click();
    const panel = dialog.getByRole("tabpanel", { name: "History" });
    for (const t of ["Todo", "In Progress", "Priya Nair", "18 Sep 2026", "23 Sep 2026"]) {
      await expect(panel.getByText(t)).toBeVisible();
    }
    await expect(panel.locator("ol > li")).toHaveCount(2); // one group per save + Created
    await expect(panel.locator("li").last()).toHaveText("Created");
    await shot(page, "history-after-save");

    await dialog.getByRole("tab", { name: "History" }).focus();
    await page.keyboard.press("ArrowLeft");
    await expect(dialog.getByRole("tab", { name: "Details" })).toHaveAttribute("aria-selected", "true");
    await shot(page, "keyboard-back-to-details");

    // A cited change (issue #40) deep-links straight onto the History tab.
    const url = new URL(page.url());
    const taskId = url.searchParams.get("task");
    await page.goto(`${url.pathname}?task=${taskId}&tab=history`);
    await expect(dialog.getByRole("tab", { name: "History" })).toHaveAttribute("aria-selected", "true");
    await expect(dialog.getByRole("tabpanel", { name: "History" }).getByText("Created", { exact: true })).toBeVisible();
    await shot(page, "deep-link-history-tab");
  });
});

// Must stay last: it creates a second Project, which earlier flows' `.first()` locators tolerate but do not expect.
test.describe("task-search", () => {
  const shot = shots("task-search");
  const key2 = `G${stamp}`;
  const project2 = "Vendor Portal";

  test("⌘K finds tasks across projects by key and title and opens the task", async ({ page }) => {
    // Second project with two tasks, created through the UI.
    await login(page);
    await page.getByRole("button", { name: "New project" }).first().click();
    await page.getByLabel("Name").fill(project2);
    await page.getByLabel("Key").fill(key2);
    await page.getByRole("button", { name: "Create project" }).click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
    await page.getByRole("link", { name: "Tasks", exact: true }).click();
    for (const title of ["Sign vendor contract", "Load-test vendor portal"]) {
      await page.getByRole("button", { name: "New task" }).click();
      await page.getByRole("dialog").getByLabel("Title").fill(title);
      await page.getByRole("dialog").getByRole("button", { name: "Create task" }).click();
      await expect(page.getByRole("dialog")).toBeHidden();
      await expect(page.getByText(title)).toBeVisible();
    }
    await shot(page, "second-project-tasks");

    // Key search from the Dashboard → result shows project name → Enter opens the dialog.
    await page.getByRole("link", { name: "Dashboard", exact: true }).click();
    await expect(page).toHaveURL("/dashboard");
    await page.keyboard.press("Meta+k");
    const input = page.getByPlaceholder("Type a command or search…");
    await input.fill(`${key}-1`);
    const hit = page.getByRole("option", { name: new RegExp(`^${key}-1`) });
    await expect(hit).toContainText("Implement v2 endpoints");
    await expect(hit).toContainText(projectName);
    await shot(page, "search-by-key");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}\/tasks\?task=[0-9a-f-]{36}$/);
    await expect(page.getByRole("dialog", { name: `${key}-1` })).toBeVisible();
    await shot(page, "task-dialog-open");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();

    // Key variants: lower-case with a space.
    await page.keyboard.press("Meta+k");
    await input.fill(`${key2.toLowerCase()} 2`);
    await expect(page.getByRole("option", { name: new RegExp(`^${key2}-2`) })).toContainText("Load-test vendor portal");
    await shot(page, "search-key-variant");

    // Title fragment matches both projects.
    await input.fill("load-test");
    await expect(page.getByRole("option", { name: /Load-test the new gateway/ })).toContainText(projectName);
    await expect(page.getByRole("option", { name: /Load-test vendor portal/ })).toContainText(project2);
    await shot(page, "search-by-title");

    await input.fill("zzqx-nothing");
    await expect(page.getByText("No tasks match")).toBeVisible();
    await shot(page, "no-tasks-match");
  });
});

test.describe("decisions", () => {
  const shot = shots("decisions");

  test("records a decision with sources and typed assumptions, retires one and supersedes it", async ({ page }) => {
    await openProject(page, "Decisions");
    await shot(page, "empty");

    // A Decision without a Source is refused with a clear field error.
    await page.getByRole("button", { name: "New decision" }).click();
    const dialog = page.getByRole("dialog", { name: "New decision" });
    await dialog.getByLabel("Title").fill("Switch from surveys to interviews");
    await dialog.getByLabel("Decided on").fill("2026-09-14");
    await dialog.getByLabel("Owner").selectOption({ label: "Priya Nair" });
    await dialog.getByLabel("Context").fill("Survey response rate was 4% after two reminders");
    await dialog.getByLabel("Chosen").fill("Semi-structured interviews with 12 merchants");
    await dialog.getByLabel("Alternatives").fill("Keep the survey open (too slow); incentivised survey (budget)");
    await dialog.getByRole("button", { name: "Create decision" }).click();
    await expect(dialog.getByText("Add at least one source")).toBeVisible();
    await shot(page, "missing-source-error");

    await dialog.getByRole("button", { name: "Add source" }).click();
    await dialog.getByPlaceholder("Search evidence, comments and activity…").fill("Weekly sync");
    await dialog.getByRole("option", { name: /^Weekly sync minutes/ }).click();
    await expect(dialog.getByText(/^Weekly sync minutes/)).toBeVisible();
    await shot(page, "new-decision-dialog");
    await dialog.getByRole("button", { name: "Create decision" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("D-1")).toBeVisible();

    // Typed Assumptions on D-1: a date assumption on the UAT milestone and a person assumption.
    await page.getByText("Switch from surveys to interviews").click();
    const edit = page.getByRole("dialog", { name: "D-1" });
    await expect(edit).toBeVisible();
    await edit.getByRole("button", { name: "New assumption" }).click();
    const assumption = page.getByRole("dialog", { name: "New assumption" });
    await assumption.getByLabel("Statement").fill("Merchant dataset arrives before UAT");
    await assumption.getByLabel("Subtype").selectOption("date");
    await assumption.getByRole("combobox", { name: "Target", exact: true }).selectOption({ label: "UAT begins" });
    await assumption.getByLabel("Assumed until").fill("2026-10-01");
    await shot(page, "new-assumption-dialog");
    await assumption.getByRole("button", { name: "Add assumption" }).click();
    await expect(assumption).toBeHidden();
    await expect(edit.getByText("Merchant dataset arrives before UAT")).toBeVisible();

    await edit.getByRole("button", { name: "New assumption" }).click();
    await assumption.getByLabel("Statement").fill("Priya stays on the project through UAT");
    await assumption.getByLabel("Subtype").selectOption("person");
    await assumption.getByRole("combobox", { name: "Person", exact: true }).selectOption({ label: "Priya Nair" });
    await assumption.getByRole("button", { name: "Add assumption" }).click();
    await expect(assumption).toBeHidden();
    await expect(edit.getByText("Priya stays on the project through UAT")).toBeVisible();
    await shot(page, "assumptions");

    // Retire the person assumption.
    await edit
      .getByRole("listitem")
      .filter({ hasText: "Priya stays on the project" })
      .getByRole("button", { name: "Retire" })
      .click();
    await expect(edit.getByRole("listitem").filter({ hasText: "Priya stays on the project" })).toContainText("Retired");
    await edit.getByRole("button", { name: "Cancel" }).click();
    await expect(edit).toBeHidden();

    // D-2 supersedes D-1.
    await page.getByRole("button", { name: "New decision" }).click();
    await dialog.getByLabel("Title").fill("Interviews plus a short exit survey");
    await dialog.getByLabel("Decided on").fill("2026-09-16");
    await dialog.getByLabel("Chosen").fill("Keep interviews, add a 3-question exit survey");
    await dialog.getByLabel("Supersedes").selectOption({ label: "D-1 Switch from surveys to interviews" });
    await dialog.getByRole("button", { name: "Add source" }).click();
    await dialog.getByPlaceholder("Search evidence, comments and activity…").fill("Weekly sync");
    await dialog.getByRole("option", { name: /^Weekly sync minutes/ }).click();
    await dialog.getByRole("button", { name: "Create decision" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("1 decision · newest first")).toBeVisible();
    await page.getByLabel("Show superseded").check();
    await expect(page.getByText("2 decisions · newest first")).toBeVisible();
    const d1 = page.getByRole("row").filter({ hasText: "D-1" });
    await expect(d1).toContainText("Superseded");
    await expect(d1).toContainText("by D-2");
    await shot(page, "list-with-superseded");
  });
});

test.describe("impact", () => {
  const shot = shots("impact");

  const moveUat = async (page: Page, date: string) => {
    await page.getByRole("main").getByRole("link", { name: "Timeline", exact: true }).click();
    await expect(page).toHaveURL(/\/timeline$/);
    await page.getByRole("link", { name: "UAT begins" }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Name")).toHaveValue("UAT begins");
    await dialog.getByLabel("Due date").fill(date);
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog).toBeHidden();
  };

  test("moving a Milestone date past a date Assumption raises a dismissible impact alert", async ({ page }) => {
    await openProject(page, "Decisions");
    // D-1 (superseded by D-2 in the decisions flow) still rests on the UAT date Assumption.
    await page.getByLabel("Show superseded").check();
    await page.getByText("Switch from surveys to interviews").click();
    const edit = page.getByRole("dialog", { name: "D-1" });
    await edit.getByRole("button", { name: "Add item" }).click();
    await edit.getByPlaceholder("Search tasks, milestones and risks…").fill("Load-test");
    await edit.getByRole("option", { name: /Load-test the new gateway/ }).click();
    await expect(edit.getByText("Load-test the new gateway")).toBeVisible();
    await shot(page, "leads-to");
    await edit.getByRole("button", { name: "Cancel" }).click();

    // First move stays before the assumed date (1 Oct): nothing breaks.
    await moveUat(page, "2026-09-25");
    await page.getByRole("main").getByRole("link", { name: "Overview", exact: true }).click();
    await expect(page.getByText("Needs attention")).toBeVisible();
    await expect(page.getByTestId("impact-alerts")).toHaveCount(0);

    await moveUat(page, "2026-10-20");
    await page.getByRole("main").getByRole("link", { name: "Overview", exact: true }).click();
    const alerts = page.getByTestId("impact-alerts");
    await expect(alerts).toBeVisible();
    await expect(alerts.getByText("Merchant dataset arrives before UAT")).toBeVisible();
    await expect(alerts.getByTestId("impact-reason")).toContainText("20 Oct 2026");
    await expect(alerts.getByTestId("impact-reason")).toContainText("past the assumed 1 Oct 2026");
    await expect(alerts.getByText("Affects 1 decision")).toBeVisible();
    await expect(alerts.getByRole("link", { name: /D-1 Switch from surveys to interviews/ })).toBeVisible();
    await expect(alerts.getByText(/Weekly sync minutes/)).toBeVisible();
    await expect(alerts.getByRole("link", { name: /UAT begins/ })).toBeVisible();
    await expect(alerts.getByRole("link", { name: /Load-test the new gateway/ })).toBeVisible();
    const list = page.locator("section", { hasText: "Needs attention" }).first();
    await expect(list.getByText("Broken assumption", { exact: true }).first()).toBeVisible();
    await shot(page, "alert");

    await alerts.getByRole("button", { name: "Dismiss" }).click();
    await expect(page.getByTestId("impact-alerts")).toHaveCount(0);
    await expect(list.getByText("Broken assumption", { exact: true })).toHaveCount(0);
    await shot(page, "dismissed");

    await page.getByRole("main").getByRole("link", { name: "Decisions", exact: true }).click();
    await page.getByLabel("Show superseded").check();
    await expect(page.getByRole("row").filter({ hasText: "D-1" }).getByText("Broken")).toBeVisible();
    await shot(page, "decision-still-broken");
  });
});

test.describe("proposals", () => {
  const shot = shots("proposals");

  const addEvidence = async (page: Page, title: string, body: string) => {
    await page.getByRole("main").getByRole("link", { name: "Evidence", exact: true }).click();
    await expect(page).toHaveURL(/\/evidence$/);
    await page.getByRole("button", { name: "Add", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Title").fill(title);
    await dialog.getByLabel("Kind").selectOption("minutes");
    await dialog.getByLabel("Pasted text").fill(body);
    await dialog.getByRole("button", { name: "Add evidence" }).click();
    await expect(dialog).toBeHidden();
  };
  const propose = async (page: Page) => {
    await page.getByRole("main").getByRole("link", { name: "Decisions", exact: true }).click();
    await expect(page).toHaveURL(/\/decisions$/);
    await page.getByTestId("propose-from-evidence").click();
    await expect(page.getByText(/proposed from|Nothing new/)).toBeVisible();
  };
  const overview = async (page: Page) => {
    await page.getByRole("main").getByRole("link", { name: "Overview", exact: true }).click();
    await expect(page.getByText("Needs attention")).toBeVisible();
  };

  test("the Assistant proposes decisions from evidence; the PM edits, accepts and rejects them", async ({ page }) => {
    await openProject(page);
    await addEvidence(
      page,
      "Steering call notes",
      "Attendees: Priya, Marcus.\n\nAfter the pilot we decided to switch from weekly surveys to fortnightly interviews because response rates fell to 4%. The vendor sandbox is still pending.",
    );
    await propose(page);
    await overview(page);
    const cards = page.getByTestId("proposal-card");
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText("Switch from weekly surveys to fortnightly interviews");
    await expect(cards.first()).toContainText("After the pilot we decided to switch from weekly surveys");
    await expect(cards.first()).toContainText("Steering call notes");
    await shot(page, "proposal-card");

    // Edit and accept: the Decision dialog opens prefilled; change the title before creating.
    await cards.first().getByTestId("edit-accept-proposal").click();
    const dialog = page.getByRole("dialog", { name: "Confirm proposed decision" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Chosen")).toHaveValue(/decided to switch from weekly surveys/);
    await expect(dialog.getByText("Steering call notes")).toBeVisible();
    await dialog.getByLabel("Title").fill("Interviews replace the weekly survey");
    await dialog.getByLabel("Decided on").fill("2026-09-15");
    await shot(page, "edit-and-accept-dialog");
    await dialog.getByRole("button", { name: "Accept and create decision" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Interviews replace the weekly survey")).toBeVisible();
    await expect(page.getByTestId("acceptance-rate")).toHaveText(/1 of 1/);

    // The Activity Event carries the Assistant attribution.
    await page.getByText("Interviews replace the weekly survey").click();
    const edit = page.getByRole("dialog", { name: /D-\d+/ });
    await edit.getByRole("tab", { name: "History" }).click();
    await expect(edit.getByText("via Assistant").first()).toBeVisible();
    await shot(page, "accepted-history");
    await edit.getByRole("button", { name: "Close" }).click();

    // Two more proposals: accept one with one click, reject the other; a re-run raises nothing.
    await addEvidence(
      page,
      "Sprint review notes",
      "We agreed to freeze the legacy gateway on 1 October instead of running both in parallel. The team chose Playwright over Cypress for the regression suite.",
    );
    await propose(page);
    await overview(page);
    await expect(cards).toHaveCount(2);
    await cards.filter({ hasText: "freeze the legacy gateway" }).getByTestId("accept-proposal").click();
    await expect(cards).toHaveCount(1);
    await shot(page, "one-click-accept");
    await cards.first().getByTestId("reject-proposal").click();
    await expect(cards).toHaveCount(0);

    await propose(page);
    await expect(page.getByText("Nothing new to read")).toBeVisible();
    await expect(page.getByTestId("acceptance-rate")).toHaveText(/2 of 3/);
    await expect(page.getByText(/^Freeze the legacy gateway on 1 October/)).toBeVisible();
    await shot(page, "acceptance-rate");
    await overview(page);
    await expect(cards).toHaveCount(0);
  });
});

// Runs after `decisions` and `impact`: D-1 must exist, be superseded by D-2 and rest on the broken UAT date Assumption.
test.describe("graph", () => {
  const shot = shots("graph");

  test("the graph centres on a Decision, re-centres on its broken Assumption and opens from an alert", async ({
    page,
  }) => {
    await openProject(page, "Decisions");
    await page.getByLabel("Show superseded").check();
    // From the Decision list: D-1 rests on the date Assumption the impact flow broke (alert dismissed, still broken).
    await page.getByRole("link", { name: "Show why D-1" }).click();
    await expect(page).toHaveURL(/\/graph\?node=decision:[0-9a-f-]{36}$/);
    const centre = page.getByTestId("graph-centre");
    const causes = page.getByTestId("graph-causes");
    const consequences = page.getByTestId("graph-consequences");
    await expect(centre).toContainText("D-1");
    await expect(centre).toContainText("Switch from surveys to interviews");
    await expect(page.getByTestId("graph-broken-note")).toBeVisible();
    const broken = causes.getByTestId("graph-node").filter({ hasText: "Merchant dataset arrives before UAT" });
    await expect(broken).toHaveAttribute("data-highlighted", "true");
    await expect(broken.getByTestId("graph-edge")).toHaveAttribute("data-highlighted", "true");
    await expect(broken.getByRole("link", { name: /Weekly sync minutes/ })).toBeVisible();
    await expect(consequences.getByTestId("graph-node").filter({ hasText: "Load-test the new gateway" })).toContainText(
      "leads to this",
    );
    await expect(consequences.getByTestId("graph-node").filter({ hasText: "D-2" })).toContainText("superseded by this");
    await shot(page, "centred-on-decision");

    // Re-centre on the Assumption: nothing leads to it; the watched Milestone and both Decisions follow.
    await broken.getByRole("link", { name: "Centre here" }).click();
    await expect(page).toHaveURL(/\/graph\?node=assumption:[0-9a-f-]{36}$/);
    await expect(centre).toContainText("Merchant dataset arrives before UAT");
    await expect(causes).toContainText("Nothing recorded leads here");
    await expect(consequences.getByTestId("graph-node")).toHaveCount(4);
    await expect(consequences.getByTestId("graph-node").filter({ hasText: "UAT begins" })).toContainText(
      "No source recorded",
    );
    await expect(consequences.getByTestId("graph-node").filter({ hasText: "Load-test the new gateway" })).toContainText(
      "2 steps away",
    );
    await shot(page, "recentred-on-assumption");

    // From an alert: break an external-rule Assumption on D-2 by hand and follow "Show me why".
    await page.getByRole("main").getByRole("link", { name: "Decisions", exact: true }).click();
    await expect(page).toHaveURL(/\/decisions$/);
    await page
      .getByRole("row")
      .filter({ hasText: "Interviews plus a short exit survey" })
      .getByRole("cell")
      .nth(1)
      .click();
    const edit = page.getByRole("dialog", { name: "D-2" });
    await expect(edit).toBeVisible();
    await edit.getByRole("button", { name: "New assumption" }).click();
    const assumption = page.getByRole("dialog", { name: "New assumption" });
    await assumption.getByLabel("Statement").fill("Vendor contract renews in Q4");
    await assumption.getByLabel("Subtype").selectOption("external_rule");
    await assumption.getByRole("button", { name: "Add assumption" }).click();
    await expect(assumption).toBeHidden();
    await edit
      .getByRole("listitem")
      .filter({ hasText: "Vendor contract renews in Q4" })
      .getByRole("button", { name: "Mark broken" })
      .click();
    await expect(edit.getByRole("listitem").filter({ hasText: "Vendor contract renews in Q4" })).toContainText(
      "Broken",
    );
    await edit.getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("main").getByRole("link", { name: "Overview", exact: true }).click();
    const alerts = page.getByTestId("impact-alerts");
    await expect(alerts.getByText("Vendor contract renews in Q4")).toBeVisible();
    await alerts.getByRole("link", { name: "Show me why" }).click();
    await expect(page).toHaveURL(/\/graph\?node=assumption:[0-9a-f-]{36}$/);
    await expect(centre).toContainText("Vendor contract renews in Q4");
    await expect(centre).toContainText("Broken");
    await expect(consequences.getByTestId("graph-node").filter({ hasText: "D-2" })).toBeVisible();
    await shot(page, "opened-from-alert");

    // Re-centre on D-2: the new Assumption is a highlighted cause one step back; D-1 two steps back is
    // highlighted too because the broken UAT Assumption reaches D-2 through it, while the retired
    // person Assumption is not.
    await consequences
      .getByTestId("graph-node")
      .filter({ hasText: "D-2" })
      .getByRole("link", { name: "Centre here" })
      .click();
    await expect(centre).toContainText("Interviews plus a short exit survey");
    await expect(causes.getByTestId("graph-node").filter({ hasText: "Vendor contract renews in Q4" })).toHaveAttribute(
      "data-highlighted",
      "true",
    );
    const d1 = causes.locator('[data-testid="graph-node"][data-node^="decision:"]');
    await expect(d1).toContainText("D-1");
    await expect(d1).toContainText("superseded by D-2");
    await expect(d1).toHaveAttribute("data-highlighted", "true");
    await expect(
      causes.getByTestId("graph-node").filter({ hasText: "Priya stays on the project" }),
    ).not.toHaveAttribute("data-highlighted", "true");
    await shot(page, "broken-path-highlight");
  });
});

// Runs after `proposals` and `graph`: it adds Evidence and a Decision that the earlier flows must not see.
test.describe("transcripts", () => {
  const shot = shots("transcripts");
  const TRANSCRIPT = [
    "[00:01:10] Priya: The merchant dataset slipped again, so the pilot cannot start on the 1st.",
    "[00:02:30] Marcus: Then we cannot ship the export in the same release.",
    "[00:03:45] Marcus: We decided to freeze scope after the pilot instead of adding the export.",
    "[00:04:10] Priya: Agreed, revisit once the dataset lands.",
  ].join("\n");

  test("ingests a transcript as passages, cites one passage, opens it, proposes from it and degrades cleanly", async ({
    page,
  }) => {
    await openProject(page, "Evidence");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    const add = page.getByRole("dialog");
    await add.getByLabel("Title").fill("Steering meeting transcript");
    await add.getByLabel("Kind").selectOption("transcript");
    await add.getByLabel("Source date").fill("2026-09-16");
    await add.getByLabel("Pasted text").fill(TRANSCRIPT);
    await add.getByRole("button", { name: "Add evidence" }).click();
    await expect(add).toBeHidden();
    await page.getByRole("button", { name: "Steering meeting transcript" }).click();
    await expect(page).toHaveURL(/\/evidence\?item=/);
    const passages = page.getByTestId("passage");
    await expect(passages).toHaveCount(4);
    await expect(passages.nth(2)).toContainText("Marcus");
    await expect(passages.nth(2)).toContainText("00:03:45");
    await expect(passages.nth(2)).toContainText("We decided to freeze scope after the pilot");
    await expect(passages.nth(2)).not.toContainText("[00:03:45]");
    await shot(page, "transcript-passages");

    // Cite Marcus's turn from a new Decision.
    await page.getByRole("main").getByRole("link", { name: "Decisions", exact: true }).click();
    await expect(page).toHaveURL(/\/decisions$/);
    await page.getByRole("button", { name: "New decision" }).click();
    const dialog = page.getByRole("dialog", { name: "New decision" });
    await dialog.getByLabel("Title").fill("Freeze scope after the pilot");
    await dialog.getByLabel("Decided on").fill("2026-09-16");
    await dialog.getByLabel("Chosen").fill("Freeze scope; the export waits for the next release");
    await dialog.getByRole("button", { name: "Add source" }).click();
    await dialog.getByPlaceholder("Search evidence, comments and activity…").fill("Steering meeting");
    await dialog.getByRole("option", { name: /^Steering meeting transcript/ }).click();
    await expect(dialog.getByPlaceholder(/Which passage of/)).toBeVisible();
    await dialog.getByPlaceholder(/Which passage of/).fill("freeze scope");
    await dialog.getByRole("option", { name: /We decided to freeze scope/ }).click();
    const chip = dialog.getByTestId("source-chip");
    await expect(chip).toContainText("Steering meeting transcript · Marcus");
    await shot(page, "passage-source-picked");
    await dialog.getByRole("button", { name: "Create decision" }).click();
    await expect(dialog).toBeHidden();

    // Opening the Source lands on the cited Passage.
    await page.getByRole("row").filter({ hasText: "Freeze scope after the pilot" }).getByRole("cell").nth(1).click();
    const edit = page.getByRole("dialog", { name: /D-\d+/ });
    await expect(edit.getByTestId("source-chip")).toContainText("Steering meeting transcript · Marcus");
    await edit.getByRole("link", { name: /Open source Steering meeting transcript · Marcus/ }).click();
    await expect(page).toHaveURL(/\/evidence\?item=[0-9a-f-]{36}#passage-[0-9a-f-]{36}$/);
    const cited = page.locator(`[id="${new URL(page.url()).hash.slice(1)}"]`);
    await expect(cited).toContainText("We decided to freeze scope after the pilot");
    await expect(cited).toBeInViewport();
    await expect(cited).toHaveClass(/ring-1/);
    await shot(page, "citation-opens-passage");

    // The Assistant's pass (already run after the ingest; the button confirms nothing is left) cites the Passage too.
    await page.getByRole("main").getByRole("link", { name: "Decisions", exact: true }).click();
    await expect(page).toHaveURL(/\/decisions$/);
    await page.getByTestId("propose-from-evidence").click();
    await expect(page.getByText(/proposed from|Nothing new/)).toBeVisible();
    await page.getByRole("main").getByRole("link", { name: "Overview", exact: true }).click();
    const card = page.getByTestId("proposal-card").filter({ hasText: "freeze scope after the pilot" });
    await expect(card).toContainText("Steering meeting transcript · Marcus");
    await shot(page, "proposal-cites-passage");
    await card.getByTestId("reject-proposal").click();
    await expect(card).toHaveCount(0);

    // Editing the transcript re-segments it; the citation degrades to the whole item, never an error.
    await page.getByRole("main").getByRole("link", { name: "Evidence", exact: true }).click();
    await page.getByRole("button", { name: "Steering meeting transcript" }).click();
    await expect(page).toHaveURL(/\/evidence\?item=/);
    await expect(page.getByRole("heading", { name: "Steering meeting transcript" })).toBeVisible();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    const editEvidence = page.getByRole("dialog", { name: "Edit evidence" });
    await editEvidence.getByLabel("Pasted text").fill(`${TRANSCRIPT}\n[00:05:00] Marcus: Noted.`);
    await editEvidence.getByRole("button", { name: "Save changes" }).click();
    await expect(editEvidence).toBeHidden();
    await expect(page.getByTestId("passage")).toHaveCount(5);
    await page.getByRole("main").getByRole("link", { name: "Decisions", exact: true }).click();
    await page.getByRole("row").filter({ hasText: "Freeze scope after the pilot" }).getByRole("cell").nth(1).click();
    const degraded = page.getByRole("dialog", { name: /D-\d+/ }).getByTestId("source-chip");
    await expect(degraded).toHaveText(/^Steering meeting transcript\s*Evidence$/);
    await expect(degraded).not.toContainText("Marcus");
    await page
      .getByRole("dialog", { name: /D-\d+/ })
      .getByRole("link", { name: /Open source/ })
      .click();
    await expect(page).toHaveURL(/\/evidence\?item=[0-9a-f-]{36}#evidence-[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: "Steering meeting transcript" })).toBeVisible();
    await shot(page, "degraded-to-whole-document");
  });
});
