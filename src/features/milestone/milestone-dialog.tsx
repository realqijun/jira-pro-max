"use client";

import { Trash2 } from "lucide-react";
import * as React from "react";
import type { DependencyRow } from "@/server/modules/dependencies/schema";
import {
  createMilestoneAction,
  deleteMilestoneAction,
  updateMilestoneAction,
} from "@/server/modules/milestones/actions";
import type { MilestoneRow } from "@/server/modules/milestones/schema";
import type { CreateMilestoneInput } from "@/server/modules/milestones/validation";
import { acceptMilestoneProposalAction } from "@/server/modules/proposals/actions";
import type { ProjectRefs } from "@/server/modules/projects/refs";
import type { TaskListItem } from "@/server/modules/tasks/repository";
import { ActionForm, Button, Dialog, FormRow, SelectField, TextField, TextareaField } from "@/shared/ui";
import { CommentThread } from "@/features/comment/comment-thread";
import { DependencyEditor } from "@/features/dependency/dependency-editor";
import { LinkedEvidence } from "@/features/evidence/linked-evidence";
import { ItemDialogTabs } from "@/features/history/item-dialog-tabs";

export function MilestoneDialog({
  open,
  onClose,
  refs,
  milestone,
  tasks = [],
  dependencies = [],
  proposal,
}: {
  open: boolean;
  onClose: () => void;
  refs: ProjectRefs;
  milestone?: MilestoneRow | null;
  /** Read in edit mode only. */
  tasks?: TaskListItem[];
  dependencies?: DependencyRow[];
  /** A pending Milestone Proposal to confirm (#115): prefills the create form, and saving accepts it. */
  proposal?: { id: string; defaults: CreateMilestoneInput } | null;
}) {
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const m = milestone;
  const draft = m ? undefined : proposal?.defaults;
  const statuses = refs.statuses.filter((s) => s.scope === "milestone");

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={m ? "Milestone" : draft ? "Confirm proposed milestone" : "New milestone"}
      description={
        m
          ? undefined
          : draft
            ? "Saving creates the milestone and accepts the Assistant's proposal."
            : "A dated checkpoint tasks roll up to."
      }
      className="max-w-xl"
    >
      {confirmDelete && m ? (
        <ActionForm
          action={deleteMilestoneAction}
          hidden={{ id: m.id, projectId: m.projectId }}
          submitLabel="Delete milestone"
          danger
          cancel={() => setConfirmDelete(false)}
          onSuccess={onClose}
        >
          <p className="text-body-sm text-ink-muted">
            Delete <span className="font-medium text-ink">{m.name}</span>? Tasks stay but lose their milestone;
            dependencies on it are removed.
          </p>
        </ActionForm>
      ) : (
        <ItemDialogTabs history={m ? { projectId: m.projectId, entityType: "milestone", entityId: m.id } : null}>
          <ActionForm
            key={m?.id ?? proposal?.id ?? "new"}
            action={m ? updateMilestoneAction : draft ? acceptMilestoneProposalAction : createMilestoneAction}
            hidden={m ? { id: m.id } : { projectId: refs.project.id, proposalId: draft ? proposal?.id : undefined }}
            submitLabel={m ? "Save changes" : draft ? "Accept and create milestone" : "Create milestone"}
            cancel={onClose}
            onSuccess={onClose}
            footerStart={
              m && (
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
              name="name"
              label="Name"
              required
              autoFocus
              defaultValue={m?.name ?? draft?.name}
              placeholder="UAT begins"
            />
            <TextareaField
              name="description"
              label="Description"
              defaultValue={m?.description ?? draft?.description ?? ""}
            />
            <FormRow>
              <TextField
                name="dueDate"
                label="Due date"
                type="date"
                required
                defaultValue={m?.dueDate ?? draft?.dueDate}
              />
              <SelectField
                name="statusId"
                label="Status"
                defaultValue={m?.statusId ?? statuses.find((s) => s.isDefault)?.id}
                options={statuses.map((s) => ({ value: s.id, label: s.name }))}
              />
            </FormRow>
            <SelectField
              name="ownerId"
              label="Owner"
              defaultValue={m?.ownerId ?? draft?.ownerId ?? ""}
              placeholder="No owner"
              options={refs.people.map((p) => ({ value: p.id, label: p.name }))}
            />
            {m && (
              <>
                <DependencyEditor
                  projectId={refs.project.id}
                  item={{ type: "milestone", id: m.id }}
                  tasks={tasks}
                  milestones={refs.milestones}
                  dependencies={dependencies}
                />
                <LinkedEvidence refs={refs} item={{ type: "milestone", id: m.id }} />
                <CommentThread
                  projectId={refs.project.id}
                  entityType="milestone"
                  entityId={m.id}
                  people={refs.people}
                />
              </>
            )}
          </ActionForm>
        </ItemDialogTabs>
      )}
    </Dialog>
  );
}
