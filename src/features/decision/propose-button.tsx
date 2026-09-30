"use client";

import { FileSearch } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { runProposalPassAction } from "@/server/modules/proposals/actions";
import { Button } from "@/shared/ui";

const SKIPPED_NOTE = {
  not_configured: "Assistant not configured",
  failed: "Pass failed",
} as const;

/**
 * Reads any Evidence and Comments the automatic pass has not read yet, then opens the pending
 * Proposals for review one at a time; reports the outcome inline.
 */
export function ProposeButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [note, setNote] = React.useState<string | null>(null);
  return (
    <span className="flex items-center gap-2">
      {note && <span className="text-caption text-ink-subtle">{note}</span>}
      <Button
        type="button"
        size="sm"
        variant="secondary"
        loading={pending}
        data-testid="propose-from-evidence"
        onClick={async () => {
          setPending(true);
          setNote(null);
          const res = await runProposalPassAction({ projectId });
          setPending(false);
          if (!res.ok) return setNote(res.error);
          const out = res.data;
          // Task and Milestone Proposals are reviewed on the Overview (#115), not here.
          const items = "skipped" in out.items ? 0 : out.items.tasks + out.items.milestones;
          const itemNote = items
            ? `; ${items} task or milestone proposal${items === 1 ? "" : "s"} on the Overview`
            : "";
          setNote(
            ("skipped" in out
              ? out.skipped === "nothing_new"
                ? out.proposalId
                  ? "All evidence already read"
                  : "All evidence already read, no suggested decisions"
                : SKIPPED_NOTE[out.skipped]
              : `${out.proposed} proposed${out.discarded ? `, ${out.discarded} discarded` : ""} from ${out.sourcesPassed} source${out.sourcesPassed === 1 ? "" : "s"}`) +
              itemNote,
          );
          if ("proposalId" in out && out.proposalId) {
            router.replace(`/projects/${projectId}/decisions?proposal=${out.proposalId}`, { scroll: false });
          } else {
            router.refresh();
          }
        }}
      >
        <FileSearch className="size-3.5" /> Propose from evidence
      </Button>
    </span>
  );
}
