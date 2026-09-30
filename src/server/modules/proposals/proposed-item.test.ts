import { describe, expect, it } from "vitest";
import { asProposedItem, itemTitleOf } from "./proposed-item";

const taskFields = {
  title: "Book the usability lab",
  description: null,
  assigneeId: null,
  assigneeName: null,
  milestoneId: null,
  milestoneName: null,
  startDate: null,
  dueDate: null,
};
const milestoneFields = {
  name: "Pilot readout",
  description: null,
  dueDate: "2026-10-20",
  ownerId: null,
  ownerName: null,
};

describe("asProposedItem", () => {
  it("keeps kind and fields together and drops the rest of the row", () => {
    expect(asProposedItem({ kind: "task", fields: taskFields, id: "x" } as never)).toEqual({
      kind: "task",
      fields: taskFields,
    });
  });
});

describe("itemTitleOf", () => {
  it("reads a Task's title and a Milestone's name", () => {
    expect(itemTitleOf(asProposedItem({ kind: "task", fields: taskFields }))).toBe("Book the usability lab");
    expect(itemTitleOf(asProposedItem({ kind: "milestone", fields: milestoneFields }))).toBe("Pilot readout");
  });
});
