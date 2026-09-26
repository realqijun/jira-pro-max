import { FileText, GitBranch, MessageSquare } from "lucide-react";
import type { ProposalRow } from "@/server/modules/proposals/schema";
import { labelFor } from "@/shared/domain";
import { fmtDate } from "@/shared/lib/dates";
import { Panel } from "@/shared/ui";
import { ASSUMPTION_ICON } from "@/entities/decision/assumption-chip";
import { ProposalActions } from "./proposal-actions";

/**
 * Pending Proposals on the Project Overview (issue #39): what the Assistant thinks was decided,
 * with the verbatim excerpt it rests on and the Assumptions it suggests. Accept is one click;
 * "Edit and accept" opens the Decision dialog prefilled; Reject keeps it out of future passes.
 */
export function ProposalCards({
  proposals,
  projectId,
  sourceLabels,
}: {
  proposals: ProposalRow[];
  projectId: string;
  /** `kind:entityId` to display label (Evidence title / Comment preview). */
  sourceLabels: Map<string, string>;
}) {
  if (!proposals.length) return null;
  return (
    <section className="flex flex-col gap-3" data-testid="proposal-cards">
      {proposals.map((p) => (
        <Panel key={p.id} className="border-l-2 border-l-tag-purple" data-testid="proposal-card">
          <div className="flex items-start gap-3 px-4 py-3">
            <GitBranch className="mt-0.5 size-4 shrink-0 text-tag-purple" />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-body-sm">
                <span className="font-medium text-ink">Proposed decision</span>
                <span className="text-caption text-ink-tertiary">
                  by the Assistant{p.decidedOn ? ` · decided ${fmtDate(p.decidedOn, "d MMM yyyy")}` : ""}
                </span>
              </p>
              <p className="mt-0.5 text-body font-medium text-ink">{p.title}</p>
              <p className="mt-0.5 text-body-sm text-ink-muted">{p.chosen}</p>
              {p.alternatives && <p className="mt-0.5 text-caption text-ink-subtle">Instead of: {p.alternatives}</p>}
            </div>
            <ProposalActions proposalId={p.id} projectId={projectId} />
          </div>
          <div className="grid grid-cols-2 gap-4 border-t border-hairline px-4 py-3 text-body-sm">
            <div>
              <p className="mb-1 text-caption font-medium text-ink-subtle">Sources</p>
              <ul className="flex flex-col gap-1.5">
                {p.sources.map((s, i) => {
                  const Icon = s.kind === "comment" ? MessageSquare : FileText;
                  return (
                    <li key={`${s.kind}:${s.entityId}:${i}`} className="flex flex-col gap-0.5">
                      <span className="flex items-center gap-1.5 text-ink">
                        <Icon className="size-3.5 shrink-0 text-ink-tertiary" />
                        <span className="truncate">
                          {(s.passageId ? sourceLabels.get(`${s.kind}:${s.entityId}:${s.passageId}`) : undefined) ??
                            sourceLabels.get(`${s.kind}:${s.entityId}`) ??
                            labelFor(s.kind)}
                        </span>
                      </span>
                      <blockquote className="border-l-2 border-hairline pl-2 text-caption text-ink-subtle italic">
                        {s.excerpt}
                      </blockquote>
                    </li>
                  );
                })}
              </ul>
            </div>
            <div>
              <p className="mb-1 text-caption font-medium text-ink-subtle">Suggested assumptions</p>
              {p.assumptions.length === 0 && <p className="text-caption text-ink-tertiary">None</p>}
              <ul className="flex flex-col gap-1">
                {p.assumptions.map((a, i) => {
                  const Icon = ASSUMPTION_ICON[a.subtype];
                  return (
                    <li key={i} className="flex items-start gap-1.5 text-ink-muted">
                      <Icon className="mt-0.5 size-3.5 shrink-0 text-ink-tertiary" />
                      <span>
                        {a.statement}
                        <span className="text-caption text-ink-tertiary">
                          {" "}
                          · {labelFor(a.subtype)}
                          {a.targetName ? ` · ${a.targetName}` : ""}
                          {a.assumedUntil ? ` · until ${fmtDate(a.assumedUntil, "d MMM yyyy")}` : ""}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </Panel>
      ))}
    </section>
  );
}
