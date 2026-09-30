import { FileText, MessageSquare } from "lucide-react";
import type { ProposedSource } from "@/server/modules/proposals/schema";
import { labelFor } from "@/shared/domain";

/** The cited Sources of a Proposal, each with its verbatim excerpt; shared by every Proposal card. */
export function ProposalSources({
  sources,
  sourceLabels,
}: {
  sources: ProposedSource[];
  /** `kind:entityId` (or `kind:entityId:passageId`) to display label. */
  sourceLabels: Map<string, string>;
}) {
  return (
    <div>
      <p className="mb-1 text-caption font-medium text-ink-subtle">Sources</p>
      <ul className="flex flex-col gap-1.5">
        {sources.map((s, i) => {
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
  );
}
