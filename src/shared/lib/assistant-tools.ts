/**
 * The approvable (write) tools grouped for permission UIs, by entity type.
 * Kept in sync with `mutates` in src/server/modules/assistant/tools.ts — a test asserts parity.
 */
export interface ApprovableTool {
  name: string;
  label: string;
}

export interface ToolGroup {
  name: string;
  tools: ApprovableTool[];
}

/** Write tools offered inside one Project; the Project Settings matrix lists these. */
export const PROJECT_TOOL_GROUPS: ToolGroup[] = [
  {
    name: "Tasks",
    tools: [
      { name: "create_task", label: "Create Task" },
      { name: "update_task", label: "Update Task" },
      { name: "set_task_labels", label: "Tag Task" },
      { name: "delete_task", label: "Delete Task" },
    ],
  },
  {
    name: "Milestones",
    tools: [
      { name: "create_milestone", label: "Create Milestone" },
      { name: "update_milestone", label: "Update Milestone" },
      { name: "delete_milestone", label: "Delete Milestone" },
    ],
  },
  {
    name: "Risks",
    tools: [
      { name: "create_risk", label: "Log Risk" },
      { name: "update_risk", label: "Update Risk" },
    ],
  },
  { name: "People", tools: [{ name: "create_person", label: "Add Person" }] },
  { name: "Labels", tools: [{ name: "create_label", label: "Create Label" }] },
  { name: "Comments", tools: [{ name: "add_comment", label: "Comment" }] },
  {
    name: "Dependencies",
    tools: [
      { name: "add_dependency", label: "Add dependency" },
      { name: "remove_dependency", label: "Remove dependency" },
    ],
  },
  {
    name: "Evidence",
    tools: [
      { name: "link_evidence", label: "Link Evidence" },
      { name: "set_evidence_labels", label: "Tag Evidence" },
    ],
  },
  { name: "Project", tools: [{ name: "update_project", label: "Update Project" }] },
];

/** Write tools offered on the dashboard dock; the workspace scope grants these. */
export const WORKSPACE_TOOL_GROUPS: ToolGroup[] = [
  { name: "Workspace", tools: [{ name: "create_project", label: "Create Project" }] },
];
