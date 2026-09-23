import "dotenv/config";
import { addDays, formatISO } from "date-fns";
import { eq } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import { auth } from "@/server/auth/auth";
import { user } from "@/server/auth/schema";
import type { Ctx } from "@/server/core/context";
import { db } from "@/server/db/client";
import { dependenciesService } from "@/server/modules/dependencies/service";
import { evidenceService } from "@/server/modules/evidence/service";
import { labelsService } from "@/server/modules/labels/service";
import { messagingService, participantMessagingService } from "@/server/modules/messaging/service";
import { milestonesService } from "@/server/modules/milestones/service";
import { peopleRepo } from "@/server/modules/people/repository";
import { peopleService } from "@/server/modules/people/service";
import { seedSampleProject } from "@/server/modules/onboarding/sample-project";
import { projects } from "@/server/modules/projects/schema";
import { projectsService } from "@/server/modules/projects/service";
import { risksService } from "@/server/modules/risks/service";
import { statusesService } from "@/server/modules/statuses/service";
import { tasksService } from "@/server/modules/tasks/service";

const DEMO_EMAIL = process.env.DEMO_EMAIL ?? "demo@example.com";
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "demo-password-123";
/** The seeded Participant, so the messaging member surface can be opened without an invite. */
const DEMO_MEMBER_EMAIL = process.env.DEMO_MEMBER_EMAIL ?? "jason@example.com";
const DEMO_MEMBER_PASSWORD = process.env.DEMO_MEMBER_PASSWORD ?? "member-password-123";

const today = new Date();
const d = (offset: number) => formatISO(addDays(today, offset), { representation: "date" });

async function ensureDemoUser(): Promise<string> {
  const [existing] = await db.select().from(user).where(eq(user.email, DEMO_EMAIL));
  if (existing) {
    await db.delete(projects).where(eq(projects.ownerId, existing.id));
    console.log(`Reset projects for ${DEMO_EMAIL}`);
    return existing.id;
  }
  const res = await auth.api.signUpEmail({
    body: { email: DEMO_EMAIL, password: DEMO_PASSWORD, name: "Demo PM" },
  });
  // Signing up fires the onboarding hook, which gives every new User the sample Project.
  // The demo account is seeded explicitly below, so clear it and start from nothing.
  await db.delete(projects).where(eq(projects.ownerId, res.user.id));
  console.log(`Created ${DEMO_EMAIL}`);
  return res.user.id;
}

async function seedPayments(ctx: Ctx) {
  const project = await projectsService.create(ctx, {
    name: "Payments Platform Relaunch",
    key: "PAY",
    description:
      "Replace the legacy payments gateway with the new API, integrate with the merchant portal, and launch to all SG merchants.",
    startDate: d(-42),
    targetDate: d(36),
  });
  await projectsService.update(ctx, { id: project.id, health: "amber" });
  const pid = project.id;

  const s = Object.fromEntries((await statusesService.list(ctx, pid)).map((x) => [`${x.scope}:${x.name}`, x.id]));

  const teamB = await peopleService.createTeam(ctx, { projectId: pid, name: "Team B — Backend API" });
  const teamC = await peopleService.createTeam(ctx, { projectId: pid, name: "Team C — Integration & QA" });
  const teamFE = await peopleService.createTeam(ctx, { projectId: pid, name: "Frontend" });
  const vendor = await peopleService.createTeam(ctx, {
    projectId: pid,
    name: "Vendor — Acme Payments",
    description: "External supplier for the settlement service",
  });

  // Everyone carries an email: it is the identifier the messaging login uses (ADR 0009), so a
  // Person without one cannot be invited.
  const p = async (name: string, role: string, teamId: string | null, email: string) =>
    peopleService.createPerson(ctx, { projectId: pid, name, role, teamId, email });
  const jason = await p("Jason Lim", "Backend lead", teamB.id, DEMO_MEMBER_EMAIL);
  const sarah = await p("Sarah Tan", "QA lead", teamC.id, "sarah@example.com");
  const alice = await p("Alice Wong", "Business analyst", teamC.id, "alice@example.com");
  const ben = await p("Ben Koh", "Security reviewer", null, "ben@example.com");
  const chen = await p("Chen Wei", "Frontend engineer", teamFE.id, "chen@example.com");
  const marcus = await p("Marcus Reyes", "Vendor delivery manager", vendor.id, "marcus@acme.example.com");

  // One Person can sign in straight away, so the member surface is reachable without first
  // generating an invite. Written through the repository on purpose: a password is not a field
  // of `createPersonSchema`, and a credential must not become reachable through an action.
  await peopleRepo.setPassword(db, jason.id, await hashPassword(DEMO_MEMBER_PASSWORD));

  const lbl = async (name: string, color: string) => labelsService.create(ctx, { projectId: pid, name, color });
  const backend = await lbl("backend", "#4ea7fc");
  const security = await lbl("security", "#eb5757");
  const testing = await lbl("testing", "#a68af7");
  const vendorLbl = await lbl("vendor", "#f2994a");

  const m = async (name: string, dueDate: string, statusName: string, ownerId?: string, description?: string) =>
    milestonesService.create(ctx, {
      projectId: pid,
      name,
      dueDate,
      statusId: s[`milestone:${statusName}`],
      ownerId,
      description,
    });
  const mApi = await m("API Complete", d(3), "At Risk", jason.id, "All v2 payment endpoints deployed to staging.");
  const mSec = await m("Security Review Signed Off", d(13), "Planned", ben.id);
  const mUat = await m("UAT Begins", d(9), "Planned", sarah.id, "Merchant pilot group starts acceptance testing.");
  const mLaunch = await m("Launch", d(36), "Planned", undefined, "General availability for all SG merchants.");
  await m("Discovery Complete", d(-28), "Reached", alice.id);

  const t = (input: Parameters<typeof tasksService.create>[1]) => tasksService.create(ctx, input);
  const done = s["task:Done"];
  const inProg = s["task:In Progress"];
  const blocked = s["task:Blocked"];
  const todo = s["task:Todo"];
  const backlog = s["task:Backlog"];

  await t({
    projectId: pid,
    title: "Finalise v2 payments API contract",
    statusId: done,
    priority: "high",
    assigneeId: jason.id,
    teamId: teamB.id,
    startDate: d(-40),
    dueDate: d(-30),
    estimateHours: 24,
    labelIds: [backend.id],
  });
  await t({
    projectId: pid,
    title: "Migrate merchant schema to new ledger model",
    statusId: done,
    priority: "medium",
    assigneeId: jason.id,
    teamId: teamB.id,
    startDate: d(-30),
    dueDate: d(-16),
    estimateHours: 40,
    labelIds: [backend.id],
  });
  const apiTask = await t({
    projectId: pid,
    title: "Implement v2 payment endpoints",
    statusId: inProg,
    priority: "urgent",
    assigneeId: jason.id,
    teamId: teamB.id,
    milestoneId: mApi.id,
    startDate: d(-16),
    dueDate: d(-2),
    estimateHours: 80,
    labelIds: [backend.id],
    description: "Authorize, capture, refund, and webhook endpoints.",
  });
  const iamTask = await t({
    projectId: pid,
    title: "Provision IAM service account for auth testing",
    statusId: blocked,
    priority: "high",
    assigneeId: marcus.id,
    teamId: vendor.id,
    startDate: d(-7),
    dueDate: d(-1),
    estimateHours: 4,
    labelIds: [vendorLbl.id, security.id],
    description: "Frontend cannot begin authentication testing until the IAM service account is provisioned.",
  });
  const authTest = await t({
    projectId: pid,
    title: "Authentication flow integration tests",
    statusId: todo,
    priority: "high",
    assigneeId: chen.id,
    teamId: teamFE.id,
    startDate: d(1),
    dueDate: d(6),
    estimateHours: 16,
    labelIds: [testing.id],
  });
  const integ = await t({
    projectId: pid,
    title: "End-to-end integration test suite",
    statusId: todo,
    priority: "high",
    assigneeId: sarah.id,
    teamId: teamC.id,
    milestoneId: mUat.id,
    startDate: d(3),
    dueDate: d(8),
    estimateHours: 32,
    labelIds: [testing.id],
  });
  const secReview = await t({
    projectId: pid,
    title: "Security architecture review",
    statusId: todo,
    priority: "high",
    assigneeId: ben.id,
    milestoneId: mSec.id,
    startDate: d(6),
    dueDate: d(12),
    estimateHours: 12,
    labelIds: [security.id],
  });
  await t({
    projectId: pid,
    title: "Merchant portal checkout UI",
    statusId: inProg,
    priority: "medium",
    assigneeId: chen.id,
    teamId: teamFE.id,
    startDate: d(-10),
    dueDate: d(5),
    estimateHours: 48,
  });
  const uatTask = await t({
    projectId: pid,
    title: "Run merchant pilot UAT",
    statusId: backlog,
    priority: "medium",
    assigneeId: sarah.id,
    teamId: teamC.id,
    milestoneId: mLaunch.id,
    startDate: d(9),
    dueDate: d(23),
    estimateHours: 60,
    labelIds: [testing.id],
  });
  await t({
    projectId: pid,
    title: "Settlement reconciliation report",
    statusId: backlog,
    priority: "low",
    assigneeId: marcus.id,
    teamId: vendor.id,
    startDate: d(10),
    dueDate: d(20),
    estimateHours: 20,
    labelIds: [vendorLbl.id],
  });
  const runbook = await t({
    projectId: pid,
    title: "Launch runbook & rollback plan",
    statusId: backlog,
    priority: "medium",
    assigneeId: alice.id,
    milestoneId: mLaunch.id,
    startDate: d(24),
    dueDate: d(33),
    estimateHours: 12,
  });
  await t({
    projectId: pid,
    title: "Load test at 3x peak TPS",
    statusId: backlog,
    priority: "medium",
    assigneeId: jason.id,
    teamId: teamB.id,
    startDate: d(14),
    dueDate: d(20),
    estimateHours: 16,
    labelIds: [backend.id, testing.id],
  });

  // The slip from the PDF scenario: Team B moved API completion 18 → 23 Sep.
  await tasksService.update(ctx, { id: apiTask.id, dueDate: d(3) });

  const dep = (
    predecessorType: "task" | "milestone",
    predecessorId: string,
    successorType: "task" | "milestone",
    successorId: string,
    note?: string,
  ) =>
    dependenciesService.create(ctx, {
      projectId: pid,
      predecessorType,
      predecessorId,
      successorType,
      successorId,
      note,
    });
  await dep("task", apiTask.id, "milestone", mApi.id);
  await dep("milestone", mApi.id, "task", integ.id, "Team C needs the API before integration testing");
  await dep("task", iamTask.id, "task", authTest.id, "Auth testing needs the IAM service account");
  await dep("task", authTest.id, "task", integ.id);
  await dep("task", integ.id, "milestone", mUat.id);
  await dep("task", secReview.id, "milestone", mSec.id);
  await dep("milestone", mSec.id, "task", uatTask.id, "Security sign-off required before UAT");
  await dep("milestone", mUat.id, "task", uatTask.id);
  await dep("task", uatTask.id, "milestone", mLaunch.id);
  await dep("task", runbook.id, "milestone", mLaunch.id);

  const r = (input: Omit<Parameters<typeof risksService.create>[1], "projectId">) =>
    risksService.create(ctx, { projectId: pid, ...input });
  await r({
    title: "Vendor access delay blocks testing",
    cause: "Acme has not provisioned the IAM service account after three escalations",
    impactDescription: "Authentication testing cannot start; UAT slips",
    probability: "high",
    impact: "high",
    statusId: s["risk:Open"],
    ownerId: sarah.id,
    mitigation: "Escalate credentials request to Acme account director by " + d(1),
    reviewDate: d(2),
  });
  await r({
    title: "Security reviewer capacity",
    cause: "Ben is 20% allocated and has ~4h before the review window",
    impactDescription: "Security sign-off milestone slips, blocking UAT",
    probability: "medium",
    impact: "high",
    statusId: s["risk:Monitoring"],
    ownerId: ben.id,
    mitigation: "Line up a second reviewer from the security guild",
    reviewDate: d(5),
  });
  await r({
    title: "Vendor commitment dates inconsistent",
    cause: "Acme said settlement service ready by " + d(2) + " in Friday's meeting but their schedule shows " + d(7),
    impactDescription: "Reconciliation report and launch readiness at risk",
    probability: "medium",
    impact: "medium",
    statusId: s["risk:Open"],
    ownerId: marcus.id,
    reviewDate: d(3),
  });
  await r({
    title: "Legacy gateway decommission before cut-over",
    cause: "Infra wanted to reclaim capacity early",
    impactDescription: "No rollback path if launch fails",
    probability: "low",
    impact: "high",
    statusId: s["risk:Mitigated"],
    ownerId: alice.id,
    mitigation: "Agreed 30-day dual-running period",
  });

  const e = (input: Omit<Parameters<typeof evidenceService.create>[1], "projectId">) =>
    evidenceService.create(ctx, { projectId: pid, ...input });
  await e({
    title: "Weekly sync minutes",
    kind: "minutes",
    sourceDate: d(-3),
    body: `Attendees: Jason, Sarah, Alice, Ben, Marcus (Acme)

- Jason: integration should probably land early next week unless infra blocks us. Revised API completion to ${d(3)}.
- Sarah: Team C cannot start integration testing until the API is on staging. UAT still targeted for ${d(9)}.
- Marcus: settlement service will be ready by ${d(2)}. Still waiting on our side for the IAM credentials request — "we've stopped hearing back from the identity team".
- Ben: has roughly 4 hours available before the security review window; asked whether a second reviewer can be found.
- Decision: proceed with Option B (mock settlement endpoint) so frontend work is not blocked.
- Action: Alice to circulate revised estimate by Wednesday.`,
  });
  await e({
    title: "Status update — week 37",
    kind: "status_update",
    sourceDate: d(-1),
    body: `Overall: AMBER
Schedule: API completion moved ${d(-2)} → ${d(3)} (Team B). Downstream: integration testing starts late; UAT start under review.
Scope: unchanged.
Budget: no new data since ${d(-21)}.
Risks: R-1 (vendor access) raised to High. R-2 monitoring.
Asks: sponsor support escalating IAM credentials with Acme.`,
  });
  await e({
    title: "Project plan v4 (export)",
    kind: "plan",
    sourceDate: d(-2),
    body: `id,name,start,finish,owner
1,Implement v2 payment endpoints,${d(-16)},${d(3)},Team B
2,Authentication flow integration tests,${d(1)},${d(6)},Frontend
3,End-to-end integration test suite,${d(3)},${d(8)},Team C
4,Security architecture review,${d(6)},${d(12)},Ben
5,Run merchant pilot UAT,${d(9)},${d(23)},Team C
6,Launch,${d(36)},${d(36)},PMO`,
  });
  await e({
    title: "Acme progress report",
    kind: "other",
    sourceDate: d(-4),
    notes: "Vendor claims 90% complete; internal acceptance evidence supports ~65%.",
    body: `Deliverable A (settlement service): 90% complete.\nPlanned finish ${d(-2)}; new forecast ${d(7)}.\nBlocker: customer credentials.`,
  });

  const launch = await messagingService.createRoom(ctx, {
    projectId: pid,
    type: "group",
    name: "Launch readiness",
    personIds: [jason.id, sarah.id, marcus.id],
  });
  const withBen = await messagingService.createRoom(ctx, {
    projectId: pid,
    type: "one_to_one",
    personIds: [ben.id],
  });

  // Through the Participant's own service, so the seed exercises the seam a real Person goes
  // through: a Person who was never admitted to the Room would fail here rather than seed a
  // conversation nobody could have had. The author name is snapshotted from the Person row.
  const reply = async (roomId: string, person: { id: string }, text: string) =>
    participantMessagingService.postMessage(
      { db: ctx.db, person: { id: person.id, projectId: pid } },
      { projectId: pid, roomId, text },
    );

  const say = (roomId: string, text: string) => messagingService.postMessage(ctx, { projectId: pid, roomId, text });

  await say(launch.id, "Acme still owes us the merchant credentials. Where are we on the pilot?");
  await reply(launch.id, marcus, "Credentials are with our security team. I expect them released this week.");
  await reply(launch.id, sarah, "UAT cannot start without them. Two of the six scenarios are blocked.");
  await say(launch.id, "Noted. I am holding the launch date for now and will review on Friday.");
  await reply(launch.id, jason, "Settlement service is code complete on our side, so we are ready when they are.");

  await say(withBen.id, "Ben, can the security review start before the credentials arrive?");
  await reply(withBen.id, ben, "Partly. I can review the architecture now and the live flows afterwards.");

  console.log(`Seeded ${project.name}`);
  console.log(`Messaging member: ${DEMO_MEMBER_EMAIL} / ${DEMO_MEMBER_PASSWORD} at /m/${pid}/login`);
}

async function seedWarehouse(ctx: Ctx) {
  const project = await projectsService.create(ctx, {
    name: "Data Warehouse Migration",
    key: "DWH",
    description: "Move reporting workloads from the on-prem warehouse to the cloud lakehouse.",
    startDate: d(-60),
    targetDate: d(75),
  });
  const pid = project.id;
  const s = Object.fromEntries((await statusesService.list(ctx, pid)).map((x) => [`${x.scope}:${x.name}`, x.id]));
  const data = await peopleService.createTeam(ctx, { projectId: pid, name: "Data Platform" });
  const priya = await peopleService.createPerson(ctx, {
    projectId: pid,
    name: "Priya Nair",
    role: "Data engineer",
    teamId: data.id,
  });
  const dev = await peopleService.createPerson(ctx, {
    projectId: pid,
    name: "Dev Patel",
    role: "Analytics lead",
    teamId: data.id,
  });
  const cutover = await milestonesService.create(ctx, {
    projectId: pid,
    name: "Reporting cut-over",
    dueDate: d(45),
    ownerId: dev.id,
  });
  await milestonesService.create(ctx, {
    projectId: pid,
    name: "Pipelines migrated",
    dueDate: d(20),
    ownerId: priya.id,
  });
  const a = await tasksService.create(ctx, {
    projectId: pid,
    title: "Inventory legacy ETL jobs",
    statusId: s["task:Done"],
    priority: "medium",
    assigneeId: priya.id,
    startDate: d(-50),
    dueDate: d(-35),
  });
  const b = await tasksService.create(ctx, {
    projectId: pid,
    title: "Rewrite top-20 pipelines in dbt",
    statusId: s["task:In Progress"],
    priority: "high",
    assigneeId: priya.id,
    startDate: d(-30),
    dueDate: d(18),
  });
  const c = await tasksService.create(ctx, {
    projectId: pid,
    title: "Parallel-run validation dashboards",
    statusId: s["task:Todo"],
    priority: "medium",
    assigneeId: dev.id,
    milestoneId: cutover.id,
    startDate: d(20),
    dueDate: d(40),
  });
  await tasksService.create(ctx, {
    projectId: pid,
    title: "Decommission on-prem cluster",
    statusId: s["task:Backlog"],
    priority: "low",
    startDate: d(50),
    dueDate: d(70),
  });
  await dependenciesService.create(ctx, {
    projectId: pid,
    predecessorType: "task",
    predecessorId: a.id,
    successorType: "task",
    successorId: b.id,
  });
  await dependenciesService.create(ctx, {
    projectId: pid,
    predecessorType: "task",
    predecessorId: b.id,
    successorType: "task",
    successorId: c.id,
  });
  await risksService.create(ctx, {
    projectId: pid,
    title: "Finance close overlaps cut-over window",
    probability: "medium",
    impact: "high",
    ownerId: dev.id,
    mitigation: "Shift cut-over to the second week of the month",
  });
  console.log(`Seeded ${project.name}`);
}

async function main() {
  const userId = await ensureDemoUser();
  const ctx: Ctx = { db, userId };
  await seedPayments(ctx);
  await seedWarehouse(ctx);
  const sample = await seedSampleProject(ctx);
  console.log(`Seeded ${sample.name}`);
  console.log(`\nDemo login: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
