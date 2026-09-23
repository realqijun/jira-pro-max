import { describe, expect, it } from "vitest";
import { TOUR_STEPS, tourHref, tourIsRunning, tourSteps } from "./tour";

describe("tourIsRunning", () => {
  it("runs only while the stored state says so", () => {
    expect(tourIsRunning("run")).toBe(true);
    expect(tourIsRunning("done")).toBe(false);
  });

  it("stays off for a browser that never stored anything, which is every existing User", () => {
    expect(tourIsRunning(null)).toBe(false);
  });
});

describe("tour steps", () => {
  it("keeps every step when there is a Project to show them on", () => {
    expect(tourSteps("p1")).toHaveLength(TOUR_STEPS.length);
  });

  it("drops the Project-bound steps when the User has no Project", () => {
    const steps = tourSteps(null);
    expect(steps.every((s) => s.section === undefined)).toBe(true);
    expect(steps.length).toBeGreaterThan(0);
  });

  it("gives every step a unique id", () => {
    expect(new Set(TOUR_STEPS.map((s) => s.id)).size).toBe(TOUR_STEPS.length);
  });
});

describe("tourHref", () => {
  const sections = TOUR_STEPS.find((s) => s.section === "")!;
  const free = TOUR_STEPS.find((s) => s.section === undefined)!;

  it("sends a section step to that section of the Project", () => {
    expect(tourHref(sections, "p1")).toBe("/projects/p1");
    expect(tourHref({ ...sections, section: "tasks" }, "p1")).toBe("/projects/p1/tasks");
  });

  it("leaves a step with no section where the User already is", () => {
    expect(tourHref(free, "p1")).toBeNull();
  });

  it("never navigates without a Project", () => {
    expect(tourHref(sections, null)).toBeNull();
  });
});
