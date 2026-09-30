import { Diamond, SquareCheck } from "lucide-react";
import type { ProjectRefs } from "@/server/modules/projects/refs";
import { asProposedItem, itemTitleOf } from "@/server/modules/proposals/proposed-item";
import type { ReviewableItem } from "@/server/modules/proposals/service";
import { fmtDate } from "@/shared/lib/dates";
import { Panel } from "@/shared/ui";
import { ItemProposalActions } from "./item-proposal-actions";
import { ProposalSources } from "./proposal-sources";

/** The resolved name for an id, else the name as the extractor wrote it, flagged; null when neither. */
function displayName(rows: Array<{ id: string; name: string }>, id: string | null | undefined, written: string | null) {
  const hit = id ? rows.find((r) => r.id === id) : undefined;
  if (hit) return hit.name;
  return written ? `${written} (not in project)` : null;
}

const fmtDay = (d: string | null | undefined) => (d ? fmtDate(d, "d MMM yyyy") : null);

/**
 * A pending Task or Milestone Proposal (#115) on the Overview: what one click would create, with
 * People and Milestones resolved against the Project as it is now, and the excerpts it rests on.
 */
export function ItemProposalCard({
  item,
  refs,
  sourceLabels,
}: {
  item: ReviewableItem;
  refs: ProjectRefs;
  sourceLabels: Map<string, string>;
}) {
  const accept = item.acceptInput;
  const proposed = asProposedItem(item);
  const isTask = proposed.kind === "task";
  const title = itemTitleOf(proposed);
  const details: Array<[string, string | null]> = [];
  if (proposed.kind === "task") {
    const f = proposed.fields;
    const input = accept?.kind === "task" ? accept.input : null;
    details.push(
      ["Owner", displayName(refs.people, input?.assigneeId, f.assigneeName)],
      ["Milestone", displayName(refs.milestones, input?.milestoneId, f.milestoneName)],
      ["Start", fmtDay(input?.startDate ?? f.startDate)],
      ["Due", fmtDay(input?.dueDate ?? f.dueDate)],
    );
  } else {
    const f = proposed.fields;
    const input = accept?.kind === "milestone" ? accept.input : null;
    details.push(
      ["Owner", displayName(refs.people, input?.ownerId, f.ownerName)],
      ["Due", fmtDay(input?.dueDate ?? f.dueDate)],
    );
  }
  const Icon = isTask ? SquareCheck : Diamond;
  const description = item.fields.description;

  return (
    <Panel className="border-l-2 border-l-tag-blue" data-testid="item-proposal-card">
      <div className="flex items-start gap-3 px-4 py-3">
        <Icon className="mt-0.5 size-4 shrink-0 text-tag-blue" />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-body-sm">
            <span className="font-medium text-ink">{isTask ? "Proposed task" : "Proposed milestone"}</span>
            <span className="text-caption text-ink-tertiary">by the Assistant</span>
          </p>
          <p className="mt-0.5 text-body font-medium text-ink">{title}</p>
          {description && <p className="mt-0.5 text-body-sm text-ink-muted">{description}</p>}
          {!accept && (
            <p className="mt-0.5 text-caption text-tag-orange">Cannot be accepted as it stands; edit it first.</p>
          )}
        </div>
        <ItemProposalActions item={item} refs={refs} />
      </div>
      <div className="grid grid-cols-2 gap-4 border-t border-hairline px-4 py-3 text-body-sm">
        <ProposalSources sources={item.sources} sourceLabels={sourceLabels} />
        <dl className="grid grid-cols-[auto_1fr] content-start items-baseline gap-x-3 gap-y-1">
          {details.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-caption font-medium text-ink-subtle">{label}</dt>
              <dd className={value ? "text-ink-muted" : "text-ink-tertiary"}>{value ?? "None"}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Panel>
  );
}
