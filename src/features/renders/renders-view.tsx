"use client";

import { AlertTriangle, ImageIcon, Loader2, Plus, RotateCcw, Trash2 } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import * as React from "react";
import { deleteRenderAction, renderStatesAction } from "@/server/modules/renders/actions";
import type { RenderRow } from "@/server/modules/renders/schema";
import { RENDER_EVIDENCE_MAX, RENDER_MAX_PER_PROJECT, RENDER_POLL_GIVE_UP_MS, RENDER_POLL_MS } from "@/shared/domain";
import { relative } from "@/shared/lib/dates";
import { ActionForm, Button, Dialog, EmptyState } from "@/shared/ui";
import { NewRenderForm, type Drafting } from "./new-render-form";

/**
 * Wait for pending Renders the way the message pane waits for Chat Messages (ADR 0011): ask
 * again on a timer rather than holding a connection open. The tick reads four fields per row;
 * only when one actually settles does it pay for a `router.refresh()` of the page.
 *
 * The poll exists at all because generation is a slow third-party call that outlives the
 * server action that started it.
 */
function usePendingRenders(projectId: string, items: RenderRow[]) {
  const router = useRouter();
  const pendingIds = items.filter((r) => r.state === "pending").map((r) => r.id);
  // A string so the effect restarts when the set changes, not on every re-render.
  const pendingKey = pendingIds.join(",");
  // Which pending set we gave up on, rather than a boolean: a new set is waited on afresh
  // without the effect having to reset state as it starts.
  const [gaveUpOn, setGaveUpOn] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!pendingKey) return;
    const waiting = new Set(pendingKey.split(","));
    const startedAt = Date.now();
    let timer: ReturnType<typeof setInterval> | undefined;

    async function tick() {
      if (Date.now() - startedAt > RENDER_POLL_GIVE_UP_MS) {
        setGaveUpOn(pendingKey);
        return stop();
      }
      const res = await renderStatesAction({ projectId });
      // A failed tick is not fatal; the next one may succeed. Give-up is bounded by time above.
      if (!res.ok) return;
      if (res.data.some((r) => waiting.has(r.id) && r.state !== "pending")) {
        stop();
        router.refresh();
      }
    }

    function stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
    }

    function start() {
      if (timer || document.visibilityState !== "visible") return;
      timer = setInterval(tick, RENDER_POLL_MS);
      void tick();
    }

    // A backgrounded tab generates nothing useful, so it stops asking and catches up on return.
    const onVisibility = () => (document.visibilityState === "visible" ? start() : stop());
    document.addEventListener("visibilitychange", onVisibility);
    start();
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, [pendingKey, projectId, router]);

  return { waiting: pendingIds.length, gaveUp: gaveUpOn !== null && gaveUpOn === pendingKey };
}

export function RendersView({
  projectId,
  items,
  configured,
  drafting,
}: {
  projectId: string;
  items: RenderRow[];
  /** False when no image key is set; the tab explains itself instead of offering a dead button. */
  configured: boolean;
  drafting: Drafting;
}) {
  const [adding, setAdding] = React.useState(false);
  const { waiting, gaveUp } = usePendingRenders(projectId, items);
  const atLimit = items.length >= RENDER_MAX_PER_PROJECT;

  const newRenderButton = (
    <Button variant="primary" size="sm" onClick={() => setAdding(true)} disabled={!configured || atLimit}>
      <Plus className="size-3.5" /> New render
    </Button>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-hairline px-6 py-3">
        <div className="min-w-0">
          <p className="text-body-sm text-ink">
            {items.length} render{items.length === 1 ? "" : "s"}
            {waiting > 0 && <span className="ml-2 text-ink-subtle">{waiting} generating</span>}
          </p>
          <p className="mt-0.5 text-caption text-ink-tertiary">
            Concept renders illustrate intent. They are not drawings and are not to scale.
          </p>
        </div>
        {newRenderButton}
      </div>

      {gaveUp && (
        <p role="alert" className="border-b border-hairline bg-surface-1 px-6 py-2 text-caption text-ink-subtle">
          Still waiting on the image service. Reload the page to check again.
        </p>
      )}

      {!configured && (
        <p className="border-b border-hairline bg-surface-1 px-6 py-2 text-caption text-ink-subtle">
          Image previews are not configured. Set POLLINATIONS_API_KEY to generate new renders.
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {items.length === 0 ? (
          <EmptyState
            icon={<ImageIcon />}
            title="No renders yet"
            description="Describe what this project delivers and get a concept image everyone can react to."
            action={configured ? newRenderButton : undefined}
          />
        ) : (
          <ul className="grid grid-cols-1 gap-5 lg:grid-cols-2 xl:grid-cols-3">
            {items.map((r) => (
              <RenderCard key={r.id} render={r} />
            ))}
          </ul>
        )}
      </div>

      <Dialog
        open={adding}
        onClose={() => setAdding(false)}
        title="New concept render"
        description={`Describe the deliverable, or draft a description from up to ${RENDER_EVIDENCE_MAX} pieces of Evidence. Only the description below is sent to the image service.`}
        className="max-w-xl"
      >
        {/* Mounted per opening, so a cancelled draft does not come back next time. */}
        {adding && <NewRenderForm projectId={projectId} drafting={drafting} onDone={() => setAdding(false)} />}
      </Dialog>
    </div>
  );
}

function RenderCard({ render }: { render: RenderRow }) {
  const [deleting, setDeleting] = React.useState(false);
  // A snapshot of the titles at request time, so it still reads after the Evidence is deleted.
  const draftedFrom = render.evidence.map((e) => e.title).join(", ");
  return (
    <li className="flex flex-col overflow-hidden panel">
      <div className="flex aspect-4/3 items-center justify-center bg-surface-2">
        {render.state === "ready" ? (
          <Image
            src={`/api/renders/${render.id}/image`}
            alt={render.prompt}
            width={render.width}
            height={render.height}
            // The route is session-authenticated, so the image optimizer (which fetches
            // without the user's cookies) cannot read it.
            unoptimized
            className="size-full object-cover"
          />
        ) : render.state === "pending" ? (
          <span className="flex items-center gap-2 text-caption text-ink-subtle">
            <Loader2 className="size-4 animate-spin" /> Generating
          </span>
        ) : (
          <span className="flex max-w-xs items-start gap-2 px-4 text-center text-caption text-tag-red">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            {render.error ?? "Generation failed."}
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <p className="line-clamp-3 text-body-sm text-ink">{render.prompt}</p>
        {draftedFrom && <p className="line-clamp-2 text-caption text-ink-subtle">Drafted from: {draftedFrom}</p>}
        <div className="mt-auto flex items-center gap-2 text-caption text-ink-tertiary">
          <span>{relative(render.createdAt)}</span>
          {render.state === "failed" && (
            <span className="flex items-center gap-1 text-ink-subtle">
              <RotateCcw className="size-3" /> Describe it again to retry
            </span>
          )}
          <span className="ml-auto">
            <Button size="icon" variant="ghost" onClick={() => setDeleting(true)} aria-label="Delete render">
              <Trash2 className="size-3.5 text-tag-red" />
            </Button>
          </span>
        </div>
        {/* Provenance: an image nobody can trace back to a request is an opinion. */}
        <details className="text-caption text-ink-tertiary">
          <summary className="cursor-pointer select-none">How this was made</summary>
          <dl className="mt-1.5 flex flex-col gap-0.5">
            <div className="flex gap-2">
              <dt className="text-ink-subtle">Model</dt>
              <dd className="font-mono">{render.model}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-ink-subtle">Seed</dt>
              <dd className="font-mono">{render.seed}</dd>
            </div>
            {draftedFrom && (
              <div className="flex gap-2">
                <dt className="text-ink-subtle">Evidence</dt>
                <dd>{draftedFrom}</dd>
              </div>
            )}
          </dl>
        </details>
      </div>

      <Dialog
        open={deleting}
        onClose={() => setDeleting(false)}
        title="Delete render"
        description="The image is removed for good."
      >
        <ActionForm
          action={deleteRenderAction}
          hidden={{ id: render.id }}
          submitLabel="Delete"
          danger
          cancel={() => setDeleting(false)}
          onSuccess={() => setDeleting(false)}
        >
          <p className="text-body-sm text-ink-subtle">{render.prompt}</p>
        </ActionForm>
      </Dialog>
    </li>
  );
}
