import { describe, expect, it } from "vitest";
import { ValidationError } from "@/server/core/errors";
import { acceptInputOf } from "./accept";
import type { ProposedMilestoneFields, ProposedTaskFields } from "./schema";

const refs = {
  people: [{ id: "p1", name: "Priya Nair" }],
  milestones: [{ id: "m1", name: "Pilot readout" }],
};

const task = (fields: Partial<ProposedTaskFields>) => ({
  kind: "task" as const,
  fields: {
    title: "Book the usability lab",
    description: null,
    assigneeId: null,
    assigneeName: null,
    milestoneId: null,
    milestoneName: null,
    startDate: null,
    dueDate: null,
    ...fields,
  },
});

const milestone = (fields: Partial<ProposedMilestoneFields>) => ({
  kind: "milestone" as const,
  fields: {
    name: "Pilot readout",
    description: null,
    dueDate: "2026-10-20",
    ownerId: null,
    ownerName: null,
    ...fields,
  },
});

describe("acceptInputOf", () => {
  it("copies a Task's fields into the create input a one-click accept submits", () => {
    expect(
      acceptInputOf(
        "prj",
        task({ description: "Room B", assigneeId: "p1", assigneeName: "Priya", dueDate: "2026-10-10" }),
        refs,
      ),
    ).toEqual({
      kind: "task",
      input: {
        projectId: "prj",
        title: "Book the usability lab",
        description: "Room B",
        priority: "none",
        assigneeId: "p1",
        milestoneId: null,
        startDate: null,
        dueDate: "2026-10-10",
      },
    });
  });

  it("resolves a Milestone named by a Task once that Milestone exists, and leaves it null otherwise", () => {
    expect(acceptInputOf("prj", task({ milestoneName: "pilot readout" }), refs).input).toMatchObject({
      milestoneId: "m1",
    });
    expect(acceptInputOf("prj", task({ milestoneName: "Launch" }), refs).input).toMatchObject({ milestoneId: null });
  });

  it("drops an id that no longer exists in the Project, falling back to the name", () => {
    expect(
      acceptInputOf("prj", task({ assigneeId: "gone", assigneeName: "Priya", milestoneId: "gone" }), refs).input,
    ).toMatchObject({ assigneeId: "p1", milestoneId: null });
    expect(acceptInputOf("prj", milestone({ ownerId: "gone", ownerName: "Marcus" }), refs).input).toMatchObject({
      ownerId: null,
    });
  });

  it("drops a start date after the due date", () => {
    expect(acceptInputOf("prj", task({ startDate: "2026-10-12", dueDate: "2026-10-10" }), refs).input).toMatchObject({
      startDate: null,
      dueDate: "2026-10-10",
    });
  });

  it("copies a Milestone's fields and resolves its owner", () => {
    expect(acceptInputOf("prj", milestone({ ownerName: "Priya Nair" }), refs)).toEqual({
      kind: "milestone",
      input: {
        projectId: "prj",
        name: "Pilot readout",
        description: null,
        dueDate: "2026-10-20",
        ownerId: "p1",
      },
    });
  });

  it("refuses a payload the create schema would refuse", () => {
    expect(() => acceptInputOf("prj", task({ title: "  " }), refs)).toThrow(ValidationError);
    expect(() => acceptInputOf("prj", milestone({ dueDate: "soon" }), refs)).toThrow(ValidationError);
  });
});
