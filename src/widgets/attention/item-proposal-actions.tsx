"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import type { ProjectRefs } from "@/server/modules/projects/refs";
import { acceptItemProposalAction, rejectItemProposalAction } from "@/server/modules/proposals/actions";
import type { ReviewableItem } from "@/server/modules/proposals/service";
import { Button } from "@/shared/ui";
import { MilestoneDialog } from "@/features/milestone/milestone-dialog";
import { TaskDialog } from "@/features/task/task-dialog";
import { useProposalTransition } from "./use-proposal-transition";

/**
 * Accept, Edit and accept, Reject for one item Proposal (#115). Edit and accept opens the Task or
 * Milestone dialog in place, prefilled with what one click would create; saving it accepts.
 */
export function ItemProposalActions({ item, refs }: { item: ReviewableItem; refs: ProjectRefs }) {
  const router = useRouter();
  const { pending, error, run } = useProposalTransition();
  const [editing, setEditing] = React.useState(false);

  // The dialog closes on cancel and on a successful accept alike; a refresh is harmless after either.
  const close = () => {
    setEditing(false);
    router.refresh();
  };
  const accept = item.acceptInput;
  // Prefilled even when the stored payload is invalid, so the PM fixes it in the dialog.
  const defaults = item.draftInput;

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1">
        <Button
          type="button"
          size="sm"
          variant="primary"
          data-testid="accept-item-proposal"
          loading={pending === "accept"}
          disabled={pending !== null || !accept}
          onClick={() => run("accept", () => acceptItemProposalAction({ id: item.id }))}
        >
          Accept
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          data-testid="edit-accept-item-proposal"
          disabled={pending !== null}
          onClick={() => setEditing(true)}
        >
          Edit and accept
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          data-testid="reject-item-proposal"
          loading={pending === "reject"}
          disabled={pending !== null}
          onClick={() => run("reject", () => rejectItemProposalAction({ id: item.id }))}
        >
          Reject
        </Button>
      </div>
      {error && <span className="text-caption text-tag-red">{error}</span>}
      {defaults.kind === "task" ? (
        <TaskDialog open={editing} onClose={close} refs={refs} proposal={{ id: item.id, defaults: defaults.input }} />
      ) : (
        <MilestoneDialog
          open={editing}
          onClose={close}
          refs={refs}
          proposal={{ id: item.id, defaults: defaults.input }}
        />
      )}
    </div>
  );
}
