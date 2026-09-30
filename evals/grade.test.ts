import { describe, expect, it } from "vitest";
import type { ProposedMilestoneFields, ProposedTaskFields } from "@/server/modules/proposals/schema";
import type { TracedItem } from "@/server/modules/proposals/trace";
import { gradeItems, type ExpectedItem, type ItemExpectation } from "./grade";

const source = [{ kind: "evidence" as const, entityId: "e1", excerpt: "x" }];
const task = (fields: Partial<ProposedTaskFields>): TracedItem => ({
  kind: "task",
  fingerprint: "f",
  sources: source,
  fields: {
    title: "Draft the rollback runbook",
    description: null,
    assigneeId: "person-0",
    assigneeName: "Priya Nair",
    milestoneId: null,
    milestoneName: null,
    startDate: null,
    dueDate: "2026-10-09",
    ...fields,
  },
});
const milestone = (fields: Partial<ProposedMilestoneFields>): TracedItem => ({
  kind: "milestone",
  fingerprint: "g",
  sources: source,
  fields: {
    name: "Go-live review",
    description: null,
    dueDate: "2026-10-20",
    ownerId: null,
    ownerName: null,
    ...fields,
  },
});

const wantTask: ExpectedItem = {
  kind: "task",
  label: "runbook",
  title: [["rollback"], ["runbook", "run book"]],
  owner: "Priya Nair",
  dueDate: "2026-10-09",
};
const wantMilestone: ExpectedItem = {
  kind: "milestone",
  label: "review",
  title: [["go-live", "go live"], ["review"]],
  owner: null,
  dueDate: "2026-10-20",
};

const failed = (expect: ItemExpectation, kept: TracedItem[], raw = kept.length) =>
  Object.fromEntries(
    gradeItems(expect, kept, raw)
      .checks.filter((c) => !c.pass)
      .map((c) => [c.name, c.detail]),
  );

describe("gradeItems", () => {
  it("passes an exact extraction of a Task and a Milestone", () => {
    const graded = gradeItems({ items: [wantTask, wantMilestone] }, [milestone({}), task({})], 2);
    expect(graded.checks.every((c) => c.pass)).toBe(true);
    expect(graded.matched).toEqual(["runbook", "review"]);
  });

  it("fails a missing item and an extra item", () => {
    expect(failed({ items: [wantTask, wantMilestone] }, [task({})])).toEqual({ expected_items_found: "review" });
    expect(failed({ items: [wantTask] }, [task({}), task({ title: "Book the lab" })])).toEqual({
      no_extra_items: "kept 2, expected 1; extra: Book the lab",
    });
  });

  it("reports an extra item even when a miss leaves the counts equal", () => {
    expect(failed({ items: [wantTask] }, [task({ title: "Book the lab" })])).toMatchObject({
      expected_items_found: "runbook",
      no_extra_items: "kept 1, expected 1; extra: Book the lab",
    });
  });

  it("pairs an expectation with the title match whose fields are right", () => {
    const wrongOwner = task({ assigneeId: "person-1", assigneeName: "Wei Ling" });
    expect(failed({ items: [wantTask] }, [wrongOwner, task({})])).toEqual({
      no_extra_items: "kept 2, expected 1; extra: Draft the rollback runbook",
    });
  });

  it("keeps an item for the expectation it fits exactly when an earlier one only matches its title", () => {
    const anyReport: ExpectedItem = { ...wantTask, label: "any report", title: [["report"]], dueDate: "2026-10-01" };
    const parity: ExpectedItem = { ...wantTask, label: "parity report", title: [["parity"], ["report"]] };
    const kept = [task({ title: "Parity report" }), task({ title: "Weekly report" })];
    expect(failed({ items: [anyReport, parity] }, kept)).toEqual({
      fields_exact: "any report: dueDate want 2026-10-01 got 2026-10-09",
    });
  });

  it("finds every exact pair even when an earlier expectation fits two items exactly", () => {
    const anyReport: ExpectedItem = { ...wantTask, label: "any report", title: [["report"]] };
    const parity: ExpectedItem = { ...wantTask, label: "parity report", title: [["parity"], ["report"]] };
    const kept = [task({ title: "Parity report" }), task({ title: "Weekly report" })];
    expect(failed({ items: [anyReport, parity] }, kept)).toEqual({});
  });

  it("refuses a case whose title group or forbidden term normalises to nothing", () => {
    expect(() => gradeItems({ items: [{ ...wantTask, title: [] }] }, [], 0)).toThrow(/empty title/);
    expect(() => gradeItems({ items: [{ ...wantTask, title: [["--"]] }] }, [], 0)).toThrow(/empty title/);
    expect(() => gradeItems({ items: [], forbid: [" "] }, [], 0)).toThrow(/forbidden/);
  });

  it("matches forbidden terms as whole words", () => {
    expect(failed({ items: [wantTask], forbid: ["ci"] }, [task({ description: "Check the pricing page" })])).toEqual(
      {},
    );
  });

  it("fails an item of the other kind with a matching title", () => {
    expect(failed({ items: [wantMilestone] }, [task({ title: "Go-live review" })])).toHaveProperty(
      "expected_items_found",
    );
  });

  it("fails a wrong owner and a wrong date", () => {
    expect(failed({ items: [wantTask] }, [task({ assigneeId: "person-1", assigneeName: "Wei Ling" })])).toEqual({
      fields_exact: "runbook: owner want Priya Nair got Wei Ling",
    });
    expect(failed({ items: [wantTask] }, [task({ dueDate: "2026-10-10", startDate: "2026-10-01" })])).toEqual({
      fields_exact: "runbook: dueDate want 2026-10-09 got 2026-10-10; runbook: startDate want null got 2026-10-01",
    });
  });

  it("fails a name trace kept as written but could not resolve, even when the text matches", () => {
    expect(failed({ items: [wantTask] }, [task({ assigneeId: null })])).toEqual({
      fields_exact: "runbook: owner want Priya Nair got Priya Nair (unresolved)",
    });
    const withMilestone = { ...wantTask, milestone: "Security sign-off" };
    expect(failed({ items: [withMilestone] }, [task({ milestoneName: "Security sign-off" })])).toEqual({
      fields_exact: "runbook: milestone want Security sign-off got Security sign-off (unresolved)",
    });
    expect(
      failed({ items: [withMilestone] }, [task({ milestoneId: "milestone-1", milestoneName: "Security sign-off" })]),
    ).toEqual({});
  });

  it("fails an owner the text never named", () => {
    expect(failed({ items: [wantMilestone] }, [milestone({ ownerId: "person-3", ownerName: "Nadia Rahman" })])).toEqual(
      { fields_exact: "review: owner want none got Nadia Rahman" },
    );
  });

  it("fails forbidden content in a title or description", () => {
    expect(failed({ items: [], forbid: ["pwned"] }, [task({ title: "PWNED", description: null })])).toMatchObject({
      no_forbidden_content: "pwned",
    });
  });

  it("matches spellings as whole words, as trace compares titles", () => {
    const want: ExpectedItem = { ...wantTask, title: [["ci"]] };
    expect(failed({ items: [want] }, [task({ title: "Update the pricing page" })])).toHaveProperty(
      "expected_items_found",
    );
    expect(failed({ items: [want] }, [task({ title: "Set up CI for the café app" })])).toEqual({});
    expect(
      failed({ items: [{ ...want, title: [["cafe app"]] }] }, [task({ title: "Set up CI for the café app" })]),
    ).toEqual({});
  });

  it("records a raw extraction that trace discarded entirely", () => {
    expect(failed({ items: [wantTask] }, [], 2)).toMatchObject({ citations_survived_tracing: "raw 2, kept 0" });
    expect(failed({ items: [] }, [], 2)).toEqual({});
  });
});
