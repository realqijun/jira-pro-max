"use client";

import { Crosshair, GitBranch, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import type { SourceCandidates } from "@/server/modules/decisions/service";
import type { DecisionListItem } from "@/server/modules/decisions/service";
import type { DependencyRow } from "@/server/modules/dependencies/schema";
import type { ProjectRefs } from "@/server/modules/projects/refs";
import type { ProposalRow } from "@/server/modules/proposals/schema";
import type { proposalsService } from "@/server/modules/proposals/service";
import type { RiskListItem } from "@/server/modules/risks/repository";
import type { TaskListItem } from "@/server/modules/tasks/repository";
import { fmtDate } from "@/shared/lib/dates";
import { graphHref } from "@/shared/lib/hrefs";
import { Button, EmptyState } from "@/shared/ui";
import { AssumptionChip } from "@/entities/decision/assumption-chip";
import { DecisionStatusBadge } from "@/entities/decision/decision-status-badge";
import { Avatar } from "@/entities/person/avatar";
import { DecisionDialog } from "./decision-dialog";
import { ProposeButton } from "./propose-button";

export function DecisionsView({
  refs,
  decisions,
  candidates,
  tasks,
  dependencies,
  risks,
  proposals,
  sourceLabels,
  stats,
}: {
  refs: ProjectRefs;
  decisions: DecisionListItem[];
  candidates: SourceCandidates;
  tasks: TaskListItem[];
  dependencies: DependencyRow[];
  risks: RiskListItem[];
  /** Pending Proposals, so `?proposal=` can open the dialog prefilled. */
  proposals: ProposalRow[];
  sourceLabels: Record<string, string>;
  stats: Awaited<ReturnType<typeof proposalsService.stats>>;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const base = `/projects/${refs.project.id}/decisions`;
  const openItem = decisions.find((r) => r.decision.id === params.get("decision")) ?? null;
  // An open Decision wins over a Proposal, so a URL carrying both never mixes edit and review.
  const proposal = openItem ? null : (proposals.find((p) => p.id === params.get("proposal")) ?? null);
  const draft = React.useMemo(
    () => (proposal ? { ...proposal, sourceLabels: new Map(Object.entries(sourceLabels)) } : null),
    [proposal, sourceLabels],
  );
  const [creating, setCreating] = React.useState(false);
  const [showSuperseded, setShowSuperseded] = React.useState(false);
  const close = () => {
    setCreating(false);
    if (openItem || proposal) router.replace(base, { scroll: false });
  };
  // Review steps through the pending Proposals one at a time; closing ends it without accepting anything.
  const at = proposal ? proposals.indexOf(proposal) : -1;
  const show = (id: string) => router.replace(`${base}?proposal=${id}`, { scroll: false });
  const prev = proposals[at - 1];
  const next = proposals[at + 1];
  const review = proposal
    ? {
        index: at,
        total: proposals.length,
        onPrev: prev && (() => show(prev.id)),
        onNext: next && (() => show(next.id)),
      }
    : undefined;
  const afterAccept = () => {
    const following = next ?? prev;
    if (following) show(following.id);
    else close();
  };
  const byId = new Map(decisions.map((r) => [r.decision.id, r.decision]));
  const visible = decisions.filter((r) => showSuperseded || r.decision.status !== "superseded");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-hairline px-6 py-2">
        <p className="text-caption text-ink-subtle">
          {visible.length} decision{visible.length === 1 ? "" : "s"} · newest first
        </p>
        <label className="flex items-center gap-1.5 text-caption text-ink-subtle">
          <input
            type="checkbox"
            checked={showSuperseded}
            onChange={(e) => setShowSuperseded(e.target.checked)}
            className="accent-primary"
          />{" "}
          Show superseded
        </label>
        <span className="ml-auto flex items-center gap-3">
          {stats.proposed > 0 && (
            <span
              className="text-caption text-ink-subtle"
              data-testid="acceptance-rate"
              title="Accepted over everything the Assistant proposed"
            >
              Assistant acceptance: {stats.accepted} of {stats.proposed}
              {stats.rate !== null && ` (${Math.round(stats.rate * 100)}%)`}
            </span>
          )}
          <ProposeButton projectId={refs.project.id} />
        </span>
        <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
          <Plus className="size-3.5" /> New decision
        </Button>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={<GitBranch />}
          title="No decisions recorded"
          description="Record what was chosen, what was rejected and what it rests on, while the reasoning is fresh."
        />
      ) : (
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-body-sm">
            <thead className="sticky top-0 z-10 bg-surface-1/95 text-left text-caption text-ink-tertiary backdrop-blur">
              <tr className="[&>th]:border-b [&>th]:border-hairline [&>th]:px-3 [&>th]:py-2 [&>th]:font-medium">
                <th className="w-16 pl-6!">ID</th>
                <th>Decision</th>
                <th className="w-28">Date</th>
                <th className="w-32">Owner</th>
                <th className="w-32">Status</th>
                <th className="w-[34%]">Assumptions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(({ decision, owner, assumptions, supersededById }) => {
                const by = supersededById ? byId.get(supersededById) : null;
                return (
                  <tr
                    key={decision.id}
                    onClick={() => router.replace(`${base}?decision=${decision.id}`, { scroll: false })}
                    className="cursor-pointer border-b border-hairline/60 transition-colors hover:bg-surface-1 [&>td]:px-3 [&>td]:py-2 [&>td]:align-top"
                  >
                    <td className="pl-6! font-mono text-caption text-ink-tertiary">
                      <span className="flex items-center gap-1.5">
                        D-{decision.number}
                        <Link
                          href={graphHref(refs.project.id, "decision", decision.id)}
                          aria-label={`Show why D-${decision.number}`}
                          title="Show why"
                          onClick={(e) => e.stopPropagation()}
                          className="text-ink-tertiary hover:text-primary"
                        >
                          <Crosshair className="size-3" />
                        </Link>
                      </span>
                    </td>
                    <td>
                      <p className="text-ink">{decision.title}</p>
                      <p className="mt-0.5 line-clamp-1 text-caption text-ink-tertiary">{decision.chosen}</p>
                    </td>
                    <td className="text-caption text-ink-muted">{fmtDate(decision.decidedOn, "d MMM yyyy")}</td>
                    <td>
                      <span className="flex items-center gap-1.5 text-caption text-ink-muted">
                        <Avatar name={owner?.name} size="xs" /> {owner?.name.split(" ")[0] ?? "-"}
                      </span>
                    </td>
                    <td>
                      <DecisionStatusBadge status={decision.status} />
                      {by && <p className="mt-1 text-caption text-ink-tertiary">by D-{by.number}</p>}
                    </td>
                    <td>
                      {assumptions.length === 0 ? (
                        <span className="text-caption text-ink-tertiary">-</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {assumptions.map((a) => (
                            <AssumptionChip key={a.id} assumption={a} className="max-w-[16rem]" />
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <DecisionDialog
        key={openItem?.decision.id ?? proposal?.id ?? (creating ? "new" : "closed")}
        open={Boolean(openItem) || Boolean(proposal) || creating}
        draft={draft}
        review={review}
        onAccepted={afterAccept}
        onClose={close}
        refs={refs}
        item={openItem}
        decisions={decisions}
        candidates={candidates}
        tasks={tasks}
        dependencies={dependencies}
        risks={risks}
      />
    </div>
  );
}
