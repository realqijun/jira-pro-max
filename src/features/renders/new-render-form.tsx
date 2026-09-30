"use client";

import { Sparkles } from "lucide-react";
import * as React from "react";
import { createRenderAction, draftRenderPromptAction } from "@/server/modules/renders/actions";
import type { DraftableEvidence } from "@/server/modules/renders/service";
import { RENDER_DRAFT_NOTES_MAX, RENDER_EVIDENCE_MAX, RENDER_PROMPT_MAX, labelFor } from "@/shared/domain";
import { fmtDate } from "@/shared/lib/dates";
import { ActionForm, Button, Input, TextareaField } from "@/shared/ui";

export interface Drafting {
  /** False when the User has no Assistant model; the picker explains itself instead. */
  enabled: boolean;
  sources: DraftableEvidence[];
}

/**
 * The New render form. The PM either types a description, or ticks up to three pieces of
 * Evidence and asks their Assistant model for a draft, then edits it (ADR 0016). Only the
 * description is submitted as the prompt; the Evidence the last draft used goes along as
 * provenance, never as text.
 */
export function NewRenderForm({
  projectId,
  drafting,
  onDone,
}: {
  projectId: string;
  drafting: Drafting;
  onDone: () => void;
}) {
  const [prompt, setPrompt] = React.useState("");
  const [picked, setPicked] = React.useState<string[]>([]);
  const [notes, setNotes] = React.useState("");
  // What the last successful draft read: the provenance sent with Generate, not the current ticks.
  const [draftedFrom, setDraftedFrom] = React.useState<string[]>([]);
  const [draftError, setDraftError] = React.useState<string | null>(null);
  const [isDrafting, startDraft] = React.useTransition();
  const promptId = React.useId();

  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < RENDER_EVIDENCE_MAX ? [...p, id] : p));

  function draft() {
    setDraftError(null);
    const ids = picked;
    startDraft(async () => {
      const res = await draftRenderPromptAction({ projectId, evidenceIds: ids, notes }).catch(() => null);
      if (!res) return setDraftError("Something went wrong. Please try again.");
      if (!res.ok) return setDraftError(res.error);
      setPrompt(res.data.prompt);
      setDraftedFrom(ids);
      document.getElementById(promptId)?.focus();
    });
  }

  return (
    <ActionForm
      action={createRenderAction}
      hidden={{ projectId }}
      submitLabel="Generate"
      // Generate waits for a draft in flight, which would otherwise land after the PM submitted.
      submitDisabled={isDrafting}
      cancel={onDone}
      onSuccess={onDone}
    >
      <EvidencePicker
        drafting={drafting}
        picked={picked}
        toggle={toggle}
        notes={notes}
        setNotes={setNotes}
        onDraft={draft}
        pending={isDrafting}
        error={draftError}
      />
      {draftedFrom.map((id) => (
        <input key={id} type="hidden" name="evidenceIds" value={id} />
      ))}
      <TextareaField
        id={promptId}
        name="prompt"
        label="Description"
        required
        autoFocus={!drafting.enabled || drafting.sources.length === 0}
        maxLength={RENDER_PROMPT_MAX}
        // A draft in flight replaces the description, so typing now would be lost.
        readOnly={isDrafting}
        value={prompt}
        onChange={(e) => {
          setPrompt(e.target.value);
          // A description cleared to nothing is a new one, no longer drafted from anything.
          if (!e.target.value.trim()) setDraftedFrom([]);
        }}
        placeholder="A two storey community centre with a pitched roof, brick facade and a glazed entrance atrium"
        hint="Edit it as you like: only this description is sent. The image takes up to a minute."
        inputClassName="min-h-32"
      />
      {draftedFrom.length > 0 && (
        // Edits keep the attribution; the PM drops it here when the description is no longer from these.
        <p className="-mt-2 flex items-center gap-2 text-caption text-ink-tertiary">
          <span className="truncate">
            Drafted from:{" "}
            {draftedFrom.map((id) => drafting.sources.find((s) => s.id === id)?.title ?? "Evidence").join(", ")}
          </span>
          <button
            type="button"
            aria-label="Remove the Evidence attribution"
            className="shrink-0 text-ink-subtle underline-offset-2 hover:underline"
            onClick={() => setDraftedFrom([])}
          >
            Remove
          </button>
        </p>
      )}
    </ActionForm>
  );
}

function EvidencePicker({
  drafting,
  picked,
  toggle,
  notes,
  setNotes,
  onDraft,
  pending,
  error,
}: {
  drafting: Drafting;
  picked: string[];
  toggle: (id: string) => void;
  notes: string;
  setNotes: (v: string) => void;
  onDraft: () => void;
  pending: boolean;
  error: string | null;
}) {
  const atCap = picked.length >= RENDER_EVIDENCE_MAX;
  const { enabled, sources } = drafting;
  return (
    <fieldset disabled={!enabled} className="flex flex-col gap-2 rounded-md border border-hairline p-3">
      <legend className="px-1 text-caption font-medium text-ink-subtle">Draft from Evidence</legend>
      {!enabled ? (
        <p className="text-caption text-ink-tertiary">Connect an Assistant model in Settings to draft from Evidence.</p>
      ) : sources.length === 0 ? (
        <p className="text-caption text-ink-tertiary">No Evidence with text in this project yet.</p>
      ) : (
        <>
          <ul className="max-h-44 overflow-y-auto rounded-md border border-hairline" aria-label="Evidence">
            {sources.map((e) => {
              const checked = picked.includes(e.id);
              return (
                <li key={e.id} className="border-b border-hairline/60 last:border-0">
                  {/* No `name`: the ticks steer the draft and are never submitted with Generate. */}
                  <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-body-sm text-ink hover:bg-surface-1 has-disabled:cursor-not-allowed has-disabled:opacity-50">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!checked && atCap}
                      onChange={() => toggle(e.id)}
                      className="size-3.5 accent-current"
                    />
                    <span className="truncate">{e.title}</span>
                    <span className="ml-auto shrink-0 text-caption text-ink-tertiary">
                      {labelFor(e.kind)}
                      {e.sourceDate && ` · ${fmtDate(e.sourceDate)}`}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          <div className="flex items-center gap-2">
            <Input
              aria-label="Add words"
              placeholder="Add words (optional)"
              value={notes}
              maxLength={RENDER_DRAFT_NOTES_MAX}
              onChange={(e) => setNotes(e.target.value)}
              // Enter here means "draft", not "Generate" for the form around it.
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                if (picked.length && !pending) onDraft();
              }}
            />
            <Button type="button" size="md" onClick={onDraft} loading={pending} disabled={!picked.length || pending}>
              <Sparkles className="size-3.5" /> Draft from Evidence
            </Button>
          </div>
          <p className="text-caption text-ink-tertiary">
            {picked.length} of {RENDER_EVIDENCE_MAX} selected. Your Assistant model reads them and writes a description
            you can edit.
          </p>
        </>
      )}
      {error && (
        <p role="alert" className="text-caption text-tag-red">
          {error}
        </p>
      )}
    </fieldset>
  );
}
