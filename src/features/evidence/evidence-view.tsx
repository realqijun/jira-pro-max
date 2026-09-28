"use client";

import { Download, FileText, Plus, Trash2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { createEvidenceAction, deleteEvidenceAction, updateEvidenceAction } from "@/server/modules/evidence/actions";
import type { EvidencePassageRow, EvidenceRow } from "@/server/modules/evidence/schema";
import type { ProjectRefs } from "@/server/modules/projects/refs";
import { EVIDENCE_KINDS, labelFor } from "@/shared/domain";
import { cn } from "@/shared/lib/cn";
import { fmtDate, relative } from "@/shared/lib/dates";
import {
  ActionForm,
  Badge,
  Button,
  Dialog,
  EmptyState,
  Field,
  FormRow,
  Input,
  ScrollToHash,
  SelectField,
  TextField,
  TextareaField,
  enumOptions,
} from "@/shared/ui";
import { useFieldError } from "@/shared/ui/action-form";
import type { LinkTarget } from "@/server/modules/evidence/repository";
import { EVIDENCE_KIND_COLOR, LinkedEvidenceCount } from "@/entities/evidence/evidence-chip";
import { LinkedItemChip, keyTextFor } from "@/entities/evidence/linked-item-chip";
import { LinkedItems } from "@/features/evidence/linked-items";
import { LabelPicker } from "@/features/label/label-picker";

const fmtBytes = (n: number) =>
  n > 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`;

export function EvidenceView({
  refs,
  items,
  targets,
  passages,
  evidenceLabels,
}: {
  refs: ProjectRefs;
  items: EvidenceRow[];
  /** Passages of the selected item (a transcript), in order; empty for other kinds. */
  passages: EvidencePassageRow[];
  /** Every linkable Task/Risk/Milestone in the project, for the "Link item" picker. */
  targets: LinkTarget[];
  /** (evidenceId, labelId) pairs: which Labels each item carries. */
  evidenceLabels: { evidenceId: string; labelId: string }[];
}) {
  const linksFor = (evidenceId: string) => refs.evidenceLinks.filter((l) => l.evidenceId === evidenceId);
  const labelsFor = (evidenceId: string) => {
    const ids = new Set(evidenceLabels.filter((p) => p.evidenceId === evidenceId).map((p) => p.labelId));
    return refs.labels.filter((l) => ids.has(l.id));
  };
  const router = useRouter();
  const params = useSearchParams();
  const base = `/projects/${refs.project.id}/evidence`;
  const selected = items.find((e) => e.id === params.get("item")) ?? items[0] ?? null;
  const [adding, setAdding] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex w-80 shrink-0 flex-col border-r border-hairline">
        <div className="flex items-center justify-between px-4 py-2">
          <p className="text-caption text-ink-subtle">
            {items.length} item{items.length === 1 ? "" : "s"}
          </p>
          <Button size="sm" variant="primary" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" /> Add
          </Button>
        </div>
        <ul className="flex-1 overflow-y-auto border-t border-hairline">
          {items.map((e) => {
            const links = linksFor(e.id);
            return (
              <li key={e.id} id={`evidence-${e.id}`}>
                <button
                  onClick={() => router.replace(`${base}?item=${e.id}`, { scroll: false })}
                  className={cn(
                    "flex w-full flex-col gap-1 border-b border-hairline/60 px-4 py-2.5 text-left transition-colors hover:bg-surface-1",
                    selected?.id === e.id && "bg-surface-2",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="size-1.5 rounded-full" style={{ background: EVIDENCE_KIND_COLOR[e.kind] }} />
                    <span className="truncate text-body-sm text-ink">{e.title}</span>
                  </div>
                  <div className="flex items-center gap-2 pl-3.5 text-caption text-ink-tertiary">
                    <span>{labelFor(e.kind)}</span>
                    <span>·</span>
                    <span>{e.sourceDate ? fmtDate(e.sourceDate, "d MMM yyyy") : relative(e.createdAt)}</span>
                    <span className="ml-auto flex items-center gap-2">
                      <LinkedEvidenceCount count={links.length} />
                      {e.fileName && <FileText className="size-3" />}
                    </span>
                  </div>
                  {links.length > 0 && <LinkedItemStrip projectKey={refs.project.key} links={links} />}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {!selected ? (
          <EmptyState
            icon={<FileText />}
            title="No evidence yet"
            description="Upload plans, minutes, status updates or paste notes. The AI layer will read from here."
            action={
              <Button variant="primary" onClick={() => setAdding(true)}>
                Add evidence
              </Button>
            }
          />
        ) : (
          <>
            <div className="flex items-start justify-between gap-4 border-b border-hairline px-6 py-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Badge color={EVIDENCE_KIND_COLOR[selected.kind]}>{labelFor(selected.kind)}</Badge>
                  {labelsFor(selected.id).map((l) => (
                    <Badge key={l.id} color={l.color}>
                      {l.name}
                    </Badge>
                  ))}
                  {selected.sourceDate && (
                    <span className="text-caption text-ink-subtle">
                      Source date {fmtDate(selected.sourceDate, "d MMM yyyy")}
                    </span>
                  )}
                </div>
                <h2 className="mt-2 truncate text-card-title font-medium text-ink">{selected.title}</h2>
                {selected.notes && <p className="mt-1 text-caption text-ink-subtle">{selected.notes}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {selected.storageKey && (
                  <a
                    href={`/api/evidence/${selected.id}/download`}
                    className="inline-flex h-8 items-center gap-2 rounded-md border border-hairline bg-surface-1 px-3 text-body-sm text-ink hover:bg-surface-2"
                  >
                    <Download className="size-3.5" /> {selected.fileName}{" "}
                    {selected.sizeBytes ? `(${fmtBytes(selected.sizeBytes)})` : ""}
                  </a>
                )}
                <Button size="sm" onClick={() => setEditing(true)}>
                  Edit
                </Button>
                <Button size="icon" variant="ghost" onClick={() => setDeleting(true)} aria-label="Delete">
                  <Trash2 className="size-3.5 text-tag-red" />
                </Button>
              </div>
            </div>
            <div className="border-b border-hairline px-6 py-3">
              <LinkedItems key={selected.id} refs={refs} evidenceId={selected.id} targets={targets} />
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {passages.length > 0 && passages[0]!.evidenceId === selected.id ? (
                <>
                  <ScrollToHash prefix="passage-" />
                  <ol className="flex max-w-3xl flex-col gap-3" data-testid="passages">
                    {passages.map((p) => (
                      <li key={p.id} id={`passage-${p.id}`} data-testid="passage" className="px-2 py-1">
                        {(p.speaker || p.timestamp) && (
                          <p className="mb-0.5 flex items-baseline gap-2 text-caption text-ink-subtle">
                            {p.speaker && <span className="font-medium text-ink-muted">{p.speaker}</span>}
                            {p.timestamp && <span className="font-mono text-ink-tertiary">{p.timestamp}</span>}
                          </p>
                        )}
                        <p className="font-mono text-mono leading-relaxed whitespace-pre-wrap text-ink-muted">
                          {p.text}
                        </p>
                      </li>
                    ))}
                  </ol>
                  <details className="mt-6 max-w-3xl">
                    <summary className="cursor-pointer text-caption text-ink-subtle select-none">Full text</summary>
                    <pre className="mt-3 font-mono text-mono leading-relaxed whitespace-pre-wrap text-ink-muted">
                      {selected.body ?? selected.extractedText}
                    </pre>
                  </details>
                </>
              ) : selected.body ? (
                <pre className="max-w-3xl font-mono text-mono leading-relaxed whitespace-pre-wrap text-ink-muted">
                  {selected.body}
                </pre>
              ) : selected.extractedText ? (
                <details key={selected.id} className="max-w-3xl">
                  <summary className="cursor-pointer text-caption text-ink-subtle select-none">Extracted text</summary>
                  <pre className="mt-3 font-mono text-mono leading-relaxed whitespace-pre-wrap text-ink-muted">
                    {selected.extractedText}
                  </pre>
                </details>
              ) : (
                <p className="text-caption text-ink-tertiary">Stored as a file. No text could be extracted.</p>
              )}
              <p className="mt-8 text-caption text-ink-tertiary">Added {relative(selected.createdAt)}</p>
            </div>
          </>
        )}
      </div>

      <Dialog
        open={adding}
        onClose={() => setAdding(false)}
        title="Add evidence"
        description="Upload a file or paste text. Either is fine; both is better."
        className="max-w-xl"
      >
        <ActionForm
          action={createEvidenceAction}
          hidden={{ projectId: refs.project.id }}
          submitLabel="Add evidence"
          cancel={() => setAdding(false)}
          onSuccess={() => setAdding(false)}
        >
          <TextField name="title" label="Title" required autoFocus placeholder="Weekly sync minutes" />
          <FormRow>
            <SelectField name="kind" label="Kind" defaultValue="other" options={enumOptions(EVIDENCE_KINDS)} />
            <TextField name="sourceDate" label="Source date" type="date" hint="Meeting/report date, not upload date" />
          </FormRow>
          <FileField />
          <TextareaField
            name="body"
            label="Pasted text"
            placeholder="Paste meeting notes, a status update, a CSV export…"
            inputClassName="min-h-32 font-mono text-mono"
          />
          <TextField name="notes" label="Notes" placeholder="Anything the reader should know about this artifact" />
          <LabelPicker labels={refs.labels} selected={[]} />
        </ActionForm>
      </Dialog>

      {selected && (
        <Dialog open={editing} onClose={() => setEditing(false)} title="Edit evidence" className="max-w-xl">
          <ActionForm
            key={selected.id}
            action={updateEvidenceAction}
            hidden={{ id: selected.id }}
            submitLabel="Save changes"
            cancel={() => setEditing(false)}
            onSuccess={() => setEditing(false)}
          >
            <TextField name="title" label="Title" required defaultValue={selected.title} />
            <FormRow>
              <SelectField
                name="kind"
                label="Kind"
                defaultValue={selected.kind}
                options={enumOptions(EVIDENCE_KINDS)}
              />
              <TextField name="sourceDate" label="Source date" type="date" defaultValue={selected.sourceDate ?? ""} />
            </FormRow>
            <TextareaField
              name="body"
              label="Pasted text"
              defaultValue={selected.body ?? ""}
              inputClassName="min-h-32 font-mono text-mono"
            />
            <TextField name="notes" label="Notes" defaultValue={selected.notes ?? ""} />
            <LabelPicker labels={refs.labels} selected={labelsFor(selected.id).map((l) => l.id)} />
          </ActionForm>
        </Dialog>
      )}

      {selected && (
        <Dialog open={deleting} onClose={() => setDeleting(false)} title="Delete evidence">
          <ActionForm
            action={deleteEvidenceAction}
            hidden={{ id: selected.id, projectId: selected.projectId }}
            submitLabel="Delete"
            danger
            cancel={() => setDeleting(false)}
            onSuccess={() => {
              setDeleting(false);
              router.replace(base, { scroll: false });
            }}
          >
            <p className="text-body-sm text-ink-muted">
              Delete <span className="font-medium text-ink">{selected.title}</span>
              {selected.fileName ? " and its file" : ""}? This cannot be undone.
            </p>
          </ActionForm>
        </Dialog>
      )}
    </div>
  );
}

const STRIP_MAX = 2;

/**
 * Compact "linked items as chips" for a list row (user story 13): the first two links as
 * non-interactive chips (the row itself is a button; the detail pane has the real links and
 * unlink controls), then "+N" for the rest.
 */
function LinkedItemStrip({ projectKey, links }: { projectKey: string; links: ProjectRefs["evidenceLinks"] }) {
  const shown = links.slice(0, STRIP_MAX);
  const rest = links.length - shown.length;
  return (
    <div className="flex max-w-full min-w-0 items-center gap-1 pl-3.5">
      {shown.map((l) => (
        <LinkedItemChip
          key={`${l.entityType}:${l.entityId}`}
          entityType={l.entityType}
          label={l.entityLabel || labelFor(l.entityType)}
          keyText={keyTextFor(projectKey, l.entityType, l.entityNumber)}
          className="min-w-0 shrink"
        />
      ))}
      {rest > 0 && <span className="shrink-0 text-caption text-ink-tertiary">+{rest}</span>}
    </div>
  );
}

function FileField() {
  const error = useFieldError("file");
  return (
    <Field label="File" hint="PDF, DOCX, XLSX, CSV, TXT or MD up to 15 MB" error={error}>
      <Input
        type="file"
        name="file"
        accept=".pdf,.docx,.xlsx,.csv,.txt,.md"
        className="h-auto py-1.5 file:mr-3 file:rounded-sm file:border-0 file:bg-surface-3 file:px-2 file:py-1 file:text-caption file:text-ink"
      />
    </Field>
  );
}
