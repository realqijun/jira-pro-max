"use client";

import { Trash2 } from "lucide-react";
import * as React from "react";
import type { ProjectRefs } from "@/server/modules/projects/refs";
import type { DependencyRow } from "@/server/modules/dependencies/schema";
import type { TaskListItem } from "@/server/modules/tasks/repository";
import { acceptTaskProposalAction } from "@/server/modules/proposals/actions";
import { createTaskAction, deleteTaskAction, updateTaskAction } from "@/server/modules/tasks/actions";
import type { CreateTaskInput } from "@/server/modules/tasks/validation";
import { PRIORITIES } from "@/shared/domain";
import { ActionForm, Button, Dialog, FormRow, SelectField, TextField, TextareaField, enumOptions } from "@/shared/ui";
import { CommentThread } from "@/features/comment/comment-thread";
import { DependencyEditor } from "@/features/dependency/dependency-editor";
import { LinkedEvidence } from "@/features/evidence/linked-evidence";
import { ItemDialogTabs } from "@/features/history/item-dialog-tabs";
import { LabelPicker } from "@/features/label/label-picker";

export function TaskDialog({
  open,
  onClose,
  refs,
  task,
  tasks = [],
  dependencies = [],
  defaults,
  proposal,
}: {
  open: boolean;
  onClose: () => void;
  refs: ProjectRefs;
  /** Present when editing. */
  task?: TaskListItem | null;
  /** Read in edit mode only. */
  tasks?: TaskListItem[];
  dependencies?: DependencyRow[];
  /** Pre-fill for create (e.g. status from a board column). */
  defaults?: { statusId?: string; milestoneId?: string };
  /** A pending Task Proposal to confirm (#115): prefills the create form, and saving accepts it. */
  proposal?: { id: string; defaults: CreateTaskInput } | null;
}) {
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const t = task?.task;
  const draft = t ? undefined : proposal?.defaults;
  const taskStatuses = refs.statuses.filter((s) => s.scope === "task");

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t ? `${refs.project.key}-${t.number}` : draft ? "Confirm proposed task" : "New task"}
      description={
        t
          ? undefined
          : draft
            ? "Saving creates the task and accepts the Assistant's proposal."
            : "Tasks are the units of work inside this project."
      }
      className="max-w-2xl"
    >
      {confirmDelete && t ? (
        <ActionForm
          action={deleteTaskAction}
          hidden={{ id: t.id, projectId: t.projectId }}
          submitLabel="Delete task"
          danger
          cancel={() => setConfirmDelete(false)}
          onSuccess={onClose}
        >
          <p className="text-body-sm text-ink-muted">
            Delete <span className="font-medium text-ink">{t.title}</span>? Its dependencies are removed too. This
            cannot be undone.
          </p>
        </ActionForm>
      ) : (
        <ItemDialogTabs history={t ? { projectId: t.projectId, entityType: "task", entityId: t.id } : null}>
          <ActionForm
            key={t?.id ?? proposal?.id ?? "new"}
            action={t ? updateTaskAction : draft ? acceptTaskProposalAction : createTaskAction}
            hidden={t ? { id: t.id } : { projectId: refs.project.id, proposalId: draft ? proposal?.id : undefined }}
            submitLabel={t ? "Save changes" : draft ? "Accept and create task" : "Create task"}
            cancel={onClose}
            onSuccess={onClose}
            footerStart={
              t && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-tag-red hover:text-tag-red"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 className="size-3.5" /> Delete
                </Button>
              )
            }
          >
            <TextField
              name="title"
              label="Title"
              required
              autoFocus
              defaultValue={t?.title ?? draft?.title}
              placeholder="What needs to happen?"
            />
            <TextareaField
              name="description"
              label="Description"
              defaultValue={t?.description ?? draft?.description ?? ""}
              placeholder="Context, acceptance criteria, links…"
            />
            <FormRow>
              <SelectField
                name="statusId"
                label="Status"
                defaultValue={t?.statusId ?? defaults?.statusId ?? taskStatuses.find((s) => s.isDefault)?.id}
                options={taskStatuses.map((s) => ({ value: s.id, label: s.name }))}
              />
              <SelectField
                name="priority"
                label="Priority"
                defaultValue={t?.priority ?? "none"}
                options={enumOptions(PRIORITIES)}
              />
            </FormRow>
            <FormRow>
              <SelectField
                name="assigneeId"
                label="Owner"
                defaultValue={t?.assigneeId ?? draft?.assigneeId ?? ""}
                placeholder="Unassigned"
                options={refs.people.map((p) => ({ value: p.id, label: p.name }))}
              />
              <SelectField
                name="teamId"
                label="Team"
                defaultValue={t?.teamId ?? ""}
                placeholder="No team"
                options={refs.teams.map((x) => ({ value: x.id, label: x.name }))}
              />
            </FormRow>
            <FormRow>
              <SelectField
                name="milestoneId"
                label="Milestone"
                defaultValue={t?.milestoneId ?? draft?.milestoneId ?? defaults?.milestoneId ?? ""}
                placeholder="No milestone"
                options={refs.milestones.map((m) => ({ value: m.id, label: m.name }))}
              />
              <TextField
                name="estimateHours"
                label="Estimate (hours)"
                type="number"
                min={0}
                step={0.5}
                defaultValue={t?.estimateHours ?? ""}
              />
            </FormRow>
            <FormRow>
              <TextField
                name="startDate"
                label="Start date"
                type="date"
                defaultValue={t?.startDate ?? draft?.startDate ?? ""}
              />
              <TextField
                name="dueDate"
                label="Due date"
                type="date"
                defaultValue={t?.dueDate ?? draft?.dueDate ?? ""}
              />
            </FormRow>
            <LabelPicker labels={refs.labels} selected={task?.labels.map((l) => l.id) ?? []} />

            {t && (
              <>
                <DependencyEditor
                  projectId={refs.project.id}
                  item={{ type: "task", id: t.id }}
                  tasks={tasks}
                  milestones={refs.milestones}
                  dependencies={dependencies}
                />
                <LinkedEvidence refs={refs} item={{ type: "task", id: t.id }} />
                <CommentThread projectId={refs.project.id} entityType="task" entityId={t.id} people={refs.people} />
              </>
            )}
          </ActionForm>
        </ItemDialogTabs>
      )}
    </Dialog>
  );
}
