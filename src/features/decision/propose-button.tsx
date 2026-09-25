"use client";

import { Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { runProposalPassAction } from "@/server/modules/proposals/actions";
import { Button } from "@/shared/ui";

const SKIPPED_NOTE = {
  nothing_new: "Nothing new to read",
  not_configured: "Assistant not configured",
  failed: "Pass failed",
} as const;

/** Runs the Proposal pass now (it also runs after new Evidence and Comments); reports the outcome inline. */
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
          setNote(
            "skipped" in out
              ? SKIPPED_NOTE[out.skipped]
              : `${out.proposed} proposed${out.discarded ? `, ${out.discarded} discarded` : ""} from ${out.sourcesPassed} source${out.sourcesPassed === 1 ? "" : "s"}`,
          );
          if ("proposalId" in out && out.proposalId) {
            router.push(`/projects/${projectId}/decisions?proposal=${out.proposalId}`);
          } else {
            router.refresh();
          }
        }}
      >
        <Sparkles className="size-3.5" /> Propose from evidence
      </Button>
    </span>
  );
}
