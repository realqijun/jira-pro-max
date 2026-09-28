"use client";

import { getToolName, type UIMessage } from "ai";
import { ChevronRight, Loader2 } from "lucide-react";
import * as React from "react";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui";

export const TOOL_LABEL: Record<string, string> = {
  search_decisions: "Searched decisions",
  get_project_summary: "Read the Project",
  list_tasks: "Listed Tasks",
  get_task: "Read a Task",
  create_task: "Created Task",
  update_task: "Updated Task",
  create_milestone: "Created Milestone",
  update_milestone: "Updated Milestone",
  delete_task: "Deleted Task",
  delete_milestone: "Deleted Milestone",
  update_project: "Updated Project",
  create_risk: "Logged Risk",
  update_risk: "Updated Risk",
  add_comment: "Commented",
  add_dependency: "Added dependency",
  remove_dependency: "Removed dependency",
  list_people: "Listed People",
  create_person: "Added Person",
  list_teams: "Listed Teams",
  list_labels: "Listed Labels",
  create_label: "Created Label",
  set_task_labels: "Tagged Task",
  list_evidence: "Listed Evidence",
  search_evidence: "Searched Evidence",
  read_evidence: "Read Evidence",
  set_evidence_labels: "Tagged Evidence",
  link_evidence: "Linked Evidence",
  list_projects: "Listed Projects",
  open_project: "Opened Project",
  create_project: "Created Project",
};

/** Mirrors `requiresConfirmation` in src/server/modules/assistant/tools.ts. */
const DESTRUCTIVE = new Set(["delete_task", "delete_milestone", "update_project"]);

/** Longest string shown per value in the inspector; the full payload stays in the message. */
const MAX_STRING = 1200;

type ToolPart = Extract<UIMessage["parts"][number], { type: `tool-${string}` | "dynamic-tool" }>;

/** Deep-copy `value` with long strings clipped so the inspector stays light (e.g. Evidence text). */
export function clipStrings(value: unknown, max = MAX_STRING): unknown {
  if (typeof value === "string")
    return value.length > max ? `${value.slice(0, max)}… [${value.length - max} more chars]` : value;
  if (Array.isArray(value)) return value.map((v) => clipStrings(v, max));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, clipStrings(v, max)]),
    );
  return value;
}

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  if (value === undefined) return null;
  return (
    <div>
      <p className="text-ink-faint text-caption">{title}</p>
      <pre className="mt-0.5 max-h-40 overflow-auto rounded-sm bg-surface-3 p-2 font-mono text-[11px] leading-relaxed break-all whitespace-pre-wrap text-ink-muted">
        {JSON.stringify(clipStrings(value) ?? null, null, 2)}
      </pre>
    </div>
  );
}

const isErrorResult = (v: unknown): v is { error: string } => typeof v === "object" && v !== null && "error" in v;

function entityLabel(v: unknown) {
  if (typeof v !== "object" || v === null) return null;
  const o = v as { title?: string; name?: string; number?: number };
  const text = o.title ?? o.name;
  return text ? (o.number ? `#${o.number} ${text}` : text) : null;
}

/**
 * One tool call in a turn: a confirm card while it waits on the User, a one-line note when denied,
 * and otherwise a collapsed row that expands to the tool name, its arguments and its result.
 */
export function ToolCall({
  part,
  onAnswer,
  onAlwaysAllow,
}: {
  part: ToolPart;
  onAnswer: (approvalId: string, approved: boolean) => void;
  onAlwaysAllow: (approvalId: string, toolName: string) => Promise<void>;
}) {
  const name = getToolName(part);
  const label = TOOL_LABEL[name] ?? name;
  if (part.state === "approval-requested") {
    return (
      <ConfirmCard
        approvalId={part.approval.id}
        toolName={name}
        input={part.input}
        reason={part.approval.requestReason}
        onAnswer={onAnswer}
        onAlwaysAllow={onAlwaysAllow}
      />
    );
  }
  if (part.state === "output-denied" || (part.state === "approval-responded" && !part.approval.approved)) {
    const reason = "approval" in part ? part.approval.reason : undefined;
    return (
      <p className="my-0.5 text-caption text-ink-subtle">
        Denied: {label.toLowerCase()}
        {reason ? ` - ${reason}` : ""}
      </p>
    );
  }
  return <ToolCallCard part={part} name={name} label={label} />;
}

function ToolCallCard({ part, name, label }: { part: ToolPart; name: string; label: string }) {
  const [open, setOpen] = React.useState(false);
  const done = part.state === "output-available";
  const failed = part.state === "output-error" || (done && isErrorResult(part.output));
  const target = done ? entityLabel(part.output) : null;
  const automatic = Boolean("approval" in part && part.approval?.isAutomatic);
  return (
    <div className="my-0.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 text-left text-caption text-ink-subtle hover:text-ink-muted"
      >
        {done || failed ? (
          <span className={cn("size-1.5 shrink-0 rounded-full", failed ? "bg-tag-red" : "bg-tag-green")} />
        ) : (
          <Loader2 className="size-3 shrink-0 animate-spin" />
        )}
        <span className="shrink-0">{failed ? `${label} failed` : label}</span>
        {target && <span className="truncate text-ink">{target}</span>}
        {automatic && <span className="text-ink-faint shrink-0">· auto-approved</span>}
        <ChevronRight className={cn("ml-auto size-3 shrink-0 transition-transform", open && "rotate-90")} />
      </button>
      {open && (
        <div className="mt-1 space-y-2 rounded-md border border-hairline bg-surface-2 p-2">
          <p className="text-ink-faint font-mono text-[11px]">{name}</p>
          <JsonBlock title="Arguments" value={part.input} />
          {done && <JsonBlock title="Result" value={part.output} />}
          {part.state === "output-error" && <p className="text-caption text-tag-red">{part.errorText}</p>}
        </div>
      )}
    </div>
  );
}

/**
 * A write tool call waiting on the User (ADR 0011). "Allow once" runs it; "Always allow" also saves
 * a standing grant for this scope so later calls of the same tool auto-approve.
 */
function ConfirmCard({
  approvalId,
  toolName,
  input,
  reason,
  onAnswer,
  onAlwaysAllow,
}: {
  approvalId: string;
  toolName: string;
  input: unknown;
  reason?: string;
  onAnswer: (approvalId: string, approved: boolean) => void;
  onAlwaysAllow: (approvalId: string, toolName: string) => Promise<void>;
}) {
  const [busy, setBusy] = React.useState(false);
  const destructive = DESTRUCTIVE.has(toolName);
  const alwaysAllow = async () => {
    setBusy(true);
    try {
      await onAlwaysAllow(approvalId, toolName);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div role="group" aria-label="Confirm" className="my-1 panel border-hairline-strong bg-surface-2 p-3">
      <p className="text-body-sm text-ink">{reason ?? `Allow the Assistant to run ${toolName}?`}</p>
      <p className="text-ink-faint mt-0.5 font-mono text-[11px]">{toolName}</p>
      <div className="mt-2">
        <JsonBlock title="Arguments" value={input} />
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" disabled={busy} onClick={() => onAnswer(approvalId, false)}>
          Deny
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void alwaysAllow()}>
          Always allow
        </Button>
        <Button
          size="sm"
          variant={destructive ? "danger" : "primary"}
          disabled={busy}
          onClick={() => onAnswer(approvalId, true)}
        >
          Allow once
        </Button>
      </div>
    </div>
  );
}
