"use client";

import { ChevronLeft, ChevronRight, Crosshair, Trash2 } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import {
  createDecisionAction,
  deleteDecisionAction,
  supersedeDecisionAction,
  updateDecisionAction,
} from "@/server/modules/decisions/actions";
import type { SourceCandidates } from "@/server/modules/decisions/service";
import type { DecisionListItem } from "@/server/modules/decisions/service";
import type { ProposalRow } from "@/server/modules/proposals/schema";
import type { DependencyRow } from "@/server/modules/dependencies/schema";
import type { ProjectRefs } from "@/server/modules/projects/refs";
import type { RiskListItem } from "@/server/modules/risks/repository";
import type { TaskListItem } from "@/server/modules/tasks/repository";
import { labelFor } from "@/shared/domain";
import { graphHref } from "@/shared/lib/hrefs";
import { ActionForm, Button, Dialog, FormRow, SelectField, TextField, TextareaField, enumOptions } from "@/shared/ui";
import { Field, Select } from "@/shared/ui/input";
import { ItemDialogTabs } from "@/features/history/item-dialog-tabs";
import { AssumptionsPanel } from "./assumptions-panel";
import { ConsequencesPanel } from "./consequences-panel";
import { SourcePicker, type PickedSource } from "./source-picker";

export function DecisionDialog({
  open,
  onClose,
  refs,
  item,
  decisions,
  candidates,
  tasks,
  dependencies,
  risks,
  draft,
  review,
  onAccepted,
}: {
  open: boolean;
  onClose: () => void;
  refs: ProjectRefs;
  item?: DecisionListItem | null;
  decisions: DecisionListItem[];
  candidates: SourceCandidates;
  tasks: TaskListItem[];
  dependencies: DependencyRow[];
  risks: RiskListItem[];
  /** A pending Proposal to confirm: prefills the create form and is marked accepted on save (issue #39). */
  draft?: (ProposalRow & { sourceLabels: Map<string, string> }) | null;
  /** Position of `draft` among the pending Proposals, so the PM can step through them one at a time. */
  review?: { index: number; total: number; onPrev?: () => void; onNext?: () => void };
  /** Called after a `draft` is accepted instead of `onClose`, so review can move on to the next Proposal. */
  onAccepted?: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const d = item?.decision;
  const [sources, setSources] = React.useState<PickedSource[]>(() =>
    item
      ? item.sources.map((s) => ({ kind: s.kind, entityId: s.entityId, passageId: s.passageId, label: s.label }))
      : (draft?.sources ?? []).map((s) => ({
          kind: s.kind,
          entityId: s.entityId,
          passageId: s.passageId ?? null,
          excerpt: s.excerpt,
          label:
            (s.passageId ? draft?.sourceLabels.get(`${s.kind}:${s.entityId}:${s.passageId}`) : undefined) ??
            draft?.sourceLabels.get(`${s.kind}:${s.entityId}`) ??
            s.excerpt,
        })),
  );
  // Field defaults come from the Decision being edited or, on the confirm path, the Proposal.
  const base = d ?? draft ?? null;
  const [supersedeError, setSupersedeError] = React.useState<string | null>(null);
  // Confirm path: the PM can leave out any proposed Assumption before the write.
  const [keepAssumption, setKeepAssumption] = React.useState<boolean[]>(() =>
    (draft?.assumptions ?? []).map(() => true),
  );
  const draftAssumptions = (draft?.assumptions ?? []).filter((_, i) => keepAssumption[i]);
  const allAssumptions = React.useMemo(() => {
    const seen = new Map<string, DecisionListItem["assumptions"][number]>();
    for (const x of decisions) for (const a of x.assumptions) seen.set(a.id, a);
    return [...seen.values()];
  }, [decisions]);
  // Candidates for "supersedes": other Decisions not already superseded (except the one this already supersedes).
  const supersedable = decisions.filter(
    (x) => x.decision.id !== d?.id && (x.decision.status !== "superseded" || x.decision.id === item?.supersedesId),
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={d ? `D-${d.number}` : draft ? "Confirm proposed decision" : "New decision"}
      description={
        d
          ? undefined
          : draft
            ? "The Assistant extracted this from the sources below. Edit anything, then create it as a confirmed decision."
            : "What was chosen, what was rejected and why, and the source it rests on."
      }
      className="max-w-2xl"
    >
      {confirmDelete && d ? (
        <ActionForm
          action={deleteDecisionAction}
          hidden={{ id: d.id }}
          submitLabel="Delete decision"
          danger
          cancel={() => setConfirmDelete(false)}
          onSuccess={onClose}
        >
          <p className="text-body-sm text-ink-muted">
            Delete <span className="font-medium text-ink">{d.title}</span>? Assumptions that support nothing else are
            removed with it. This cannot be undone.
          </p>
        </ActionForm>
      ) : (
        <>
          {d && (
            <div className="mb-3 flex items-center justify-end text-caption">
              <Link
                href={graphHref(d.projectId, "decision", d.id)}
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                <Crosshair className="size-3" /> Show why
              </Link>
            </div>
          )}
          {draft && review && review.total > 1 && (
            <div className="mb-3 flex items-center justify-between rounded-md border border-hairline bg-surface-1 px-3 py-1.5">
              <span className="text-caption text-ink-subtle" data-testid="proposal-position">
                Suggested decision {review.index + 1} of {review.total}
              </span>
              <span className="flex items-center gap-1">
                <Button type="button" variant="ghost" size="sm" disabled={!review.onPrev} onClick={review.onPrev}>
                  <ChevronLeft className="size-3.5" /> Previous
                </Button>
                <Button type="button" variant="ghost" size="sm" disabled={!review.onNext} onClick={review.onNext}>
                  Next <ChevronRight className="size-3.5" />
                </Button>
              </span>
            </div>
          )}
          <ItemDialogTabs history={d ? { projectId: d.projectId, entityType: "decision", entityId: d.id } : null}>
            <ActionForm
              key={d?.id ?? "new"}
              action={d ? updateDecisionAction : createDecisionAction}
              hidden={
                d
                  ? { id: d.id }
                  : {
                      projectId: refs.project.id,
                      proposalId: draft?.id,
                      assumptions: draft ? JSON.stringify(draftAssumptions) : undefined,
                    }
              }
              submitLabel={d ? "Save changes" : draft ? "Accept and create decision" : "Create decision"}
              cancel={onClose}
              onSuccess={draft && onAccepted ? onAccepted : onClose}
              footerStart={
                d && (
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
                defaultValue={base?.title}
                placeholder="Switch from surveys to interviews"
              />
              <FormRow>
                <TextField
                  name="decidedOn"
                  label="Decided on"
                  type="date"
                  required
                  defaultValue={base?.decidedOn ?? ""}
                />
                <SelectField
                  name="ownerId"
                  label="Owner"
                  defaultValue={d?.ownerId ?? ""}
                  placeholder="No owner"
                  options={refs.people.map((p) => ({ value: p.id, label: p.name }))}
                />
              </FormRow>
              {d && (
                <FormRow>
                  {d.status === "superseded" ? (
                    <Field label="Status" hint={`Superseded by ${supersededByLabel(item, decisions)}`}>
                      <Select disabled value="superseded">
                        <option value="superseded">Superseded</option>
                      </Select>
                    </Field>
                  ) : (
                    <SelectField
                      name="status"
                      label="Status"
                      defaultValue={d.status}
                      options={enumOptions(["active", "revisited"])}
                    />
                  )}
                  <Field label="Supersedes" error={supersedeError ?? undefined}>
                    <Select
                      value={item?.supersedesId ?? ""}
                      onChange={async (e) => {
                        setSupersedeError(null);
                        const res = await supersedeDecisionAction({ id: d.id, supersedesId: e.target.value || null });
                        if (!res.ok) setSupersedeError(res.error);
                      }}
                    >
                      <option value="">Nothing</option>
                      {supersedable.map((x) => (
                        <option key={x.decision.id} value={x.decision.id}>
                          D-{x.decision.number} {x.decision.title}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </FormRow>
              )}
              <TextareaField
                name="context"
                label="Context"
                defaultValue={base?.context ?? ""}
                placeholder="What was true at the time?"
                inputClassName="min-h-16"
              />
              <TextareaField
                name="chosen"
                label="Chosen"
                required
                defaultValue={base?.chosen ?? ""}
                placeholder="What we decided to do"
                inputClassName="min-h-16"
              />
              <TextareaField
                name="alternatives"
                label="Alternatives"
                hint="What was rejected, and why"
                defaultValue={base?.alternatives ?? ""}
                inputClassName="min-h-16"
              />
              <FormRow>
                <TextField
                  name="revisitWhen"
                  label="Revisit when"
                  defaultValue={base?.revisitWhen ?? ""}
                  placeholder="Response rate drops below 10%"
                />
                {!d && (
                  <SelectField
                    name="supersedesId"
                    label="Supersedes"
                    defaultValue=""
                    placeholder="Nothing"
                    options={supersedable.map((x) => ({
                      value: x.decision.id,
                      label: `D-${x.decision.number} ${x.decision.title}`,
                    }))}
                  />
                )}
              </FormRow>
              <SourcePicker projectId={refs.project.id} candidates={candidates} value={sources} onChange={setSources} />
              {draft && draft.assumptions.length > 0 && (
                <div className="flex flex-col gap-1.5 rounded-md border border-hairline bg-surface-1 p-3">
                  <span className="text-caption font-medium text-ink-subtle">
                    Proposed assumptions <span className="font-normal text-ink-tertiary">· untick to leave out</span>
                  </span>
                  <ul className="flex flex-col gap-1">
                    {draft.assumptions.map((a, i) => (
                      <li key={i}>
                        <label className="flex items-start gap-2 text-body-sm text-ink-muted">
                          <input
                            type="checkbox"
                            className="mt-1 accent-primary"
                            checked={keepAssumption[i] ?? true}
                            onChange={(e) =>
                              setKeepAssumption((prev) => prev.map((k, j) => (j === i ? e.target.checked : k)))
                            }
                          />
                          <span>
                            {a.statement}
                            <span className="text-caption text-ink-tertiary">
                              {" "}
                              · {labelFor(a.subtype)}
                              {a.targetName ? ` · ${a.targetName}` : ""}
                              {a.assumedUntil ? ` · until ${a.assumedUntil}` : ""}
                            </span>
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {d && (
                <AssumptionsPanel
                  refs={refs}
                  decisionId={d.id}
                  attached={item?.assumptions ?? []}
                  all={allAssumptions}
                  tasks={tasks}
                  dependencies={dependencies}
                />
              )}
              {d && (
                <ConsequencesPanel
                  refs={refs}
                  decisionId={d.id}
                  consequences={item?.consequences ?? []}
                  tasks={tasks}
                  risks={risks}
                />
              )}
            </ActionForm>
          </ItemDialogTabs>
        </>
      )}
    </Dialog>
  );
}

function supersededByLabel(item: DecisionListItem | null | undefined, decisions: DecisionListItem[]) {
  const by = decisions.find((x) => x.decision.id === item?.supersededById)?.decision;
  return by ? `D-${by.number} ${by.title}` : "a later decision";
}
