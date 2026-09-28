/**
 * The sections a Project route can address, in tab order. The empty slug is the Project
 * Overview at `/projects/<id>`. `graph` is deliberately absent: it is a page (issue #41) but
 * not a tab, so consumers that need it add it themselves.
 *
 * Lives in `shared` because it is the route vocabulary rather than a widget's data: the
 * Project header and the command palette render it, and the Assistant's render boundary
 * validates a citation's section against it.
 */
export const PROJECT_SECTIONS = [
  { slug: "", label: "Overview" },
  { slug: "tasks", label: "Tasks" },
  { slug: "timeline", label: "Timeline" },
  { slug: "calendar", label: "Calendar" },
  { slug: "risks", label: "Risks" },
  { slug: "decisions", label: "Decisions" },
  { slug: "evidence", label: "Evidence" },
  { slug: "renders", label: "Renders" },
  { slug: "people", label: "People" },
  { slug: "messages", label: "Messages" },
  { slug: "settings", label: "Settings" },
] as const;

export type ProjectSectionSlug = (typeof PROJECT_SECTIONS)[number]["slug"];
