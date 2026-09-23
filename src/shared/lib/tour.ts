/**
 * The guided tour a newly signed up User sees once, and anyone can run again from Settings or
 * the command palette.
 *
 * Every new account is seeded the sample Project (ADR 0013), so the tour explains a workspace
 * that already has something in it rather than walking the User through filling one in. The
 * steps are data, not JSX, so the ordering and the "which step can I show?" rule can be tested
 * without a DOM.
 *
 * Nothing about the tour belongs in the database - it teaches the UI, not the domain, and a
 * User who ran it on one machine losing that fact on another costs them one dismissal.
 */

/**
 * The whole state of the tour: "run" while it is on screen, "done" once it has been finished,
 * skipped or switched off, and absent for anyone who never asked for it.
 *
 * Absent is the important value. Signing up writes "run", and nothing else does, so the tour
 * only ever starts itself for an account created in this browser. An existing User signing in
 * has no key and is left alone.
 */
export const TOUR_KEY = "prismpm.tour";

/** True while the tour should be on screen. Anything other than "run", including null, is off. */
export const tourIsRunning = (stored: string | null) => stored === "run";

export interface TourStep {
  id: string;
  title: string;
  body: string;
  /** `data-tour` value of the element to spotlight. Absent means a centred card. */
  anchor?: string;
  /**
   * Section of the tour Project this step must be viewed on, as a `PROJECT_SECTIONS` slug
   * ("" is the Project overview). Absent means the step works on any page.
   */
  section?: string;
}

export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: "welcome",
    title: "Welcome to PrismPM",
    body: "Your workspace already has a sample Project in it - Bedok Community Centre - so you can see how everything fits together before you add anything of your own.",
  },
  {
    id: "projects",
    title: "Your Projects",
    body: "Every Project you own is listed here. The sample is an ordinary Project: edit it, rename it, or delete it once you have your own.",
    anchor: "sidebar-projects",
  },
  {
    id: "sections",
    title: "One Project, several views",
    body: "Tasks, Timeline, Risks, Decisions, Evidence and Renders are all views of the same Project. Start in Tasks and follow what interests you.",
    anchor: "project-tabs",
    section: "",
  },
  {
    id: "assistant",
    title: "The Assistant",
    body: "Ask the Assistant about a Project and it reads the same data you see. It asks before it writes anything.",
    anchor: "assistant-toggle",
    section: "",
  },
  {
    id: "your-own",
    title: "Start your own Project",
    body: "Create a Project whenever you are ready. You can run this tour again from Settings, or from the command palette with Cmd K.",
    anchor: "new-project",
  },
];

/**
 * The stored flag is also what the overlay renders from, rather than being copied into React
 * state on mount: one source of truth, so the Settings switch, the command palette and the
 * tour's own buttons cannot disagree about whether it is running.
 */
const listeners = new Set<() => void>();
const write = (state: "run" | "done") => {
  localStorage.setItem(TOUR_KEY, state);
  listeners.forEach((l) => l());
};

export const tourStore = {
  read: () => localStorage.getItem(TOUR_KEY),
  subscribe: (l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

/** Run the tour from step one. Called on signup, from Settings and from the command palette. */
export const startTour = () => write("run");
/** Finished, skipped, or switched off in Settings: all the same thing. */
export const endTour = () => write("done");

/**
 * The steps that can actually be shown. A step pinned to a Project section is dropped when the
 * User has no Project to show it on - a User who deleted the sample, or whose seeding failed.
 * Dropping is deliberate: a tour that points at an element that will never render is worse than
 * a shorter tour.
 */
export function tourSteps(projectId: string | null): TourStep[] {
  return TOUR_STEPS.filter((s) => s.section === undefined || projectId !== null);
}

/** Where the tour must navigate for `step`, or null if the step is happy on the current page. */
export function tourHref(step: TourStep, projectId: string | null): string | null {
  if (step.section === undefined || projectId === null) return null;
  return step.section ? `/projects/${projectId}/${step.section}` : `/projects/${projectId}`;
}
