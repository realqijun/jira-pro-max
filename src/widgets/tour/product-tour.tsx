"use client";

import { usePathname, useRouter } from "next/navigation";
import * as React from "react";
import { endTour, type TourStep, tourHref, tourIsRunning, tourStore, tourSteps } from "@/shared/lib/tour";
import { Button } from "@/shared/ui";

/** Gap between the spotlighted element and the card, and the card's fixed width. */
const GAP = 12;
const CARD_W = 340;
/**
 * The anchor for a step may not be in the DOM yet: the step can have just navigated to another
 * route. Re-measuring on a short interval covers arrival, scrolling and resizing with one
 * mechanism, and only runs while the tour is open.
 */
const MEASURE_MS = 120;

/**
 * The body really unmounts when the tour is not running, so running it again always starts at
 * step one without an effect that resets the index. Same shape as `CommandPalette`.
 */
export function ProductTour({ projectId, userEmail }: { projectId: string | null; userEmail: string }) {
  // Off during SSR and the first paint: localStorage cannot be read on the server, and a tour
  // that flashed before hydration would spotlight elements that have not been laid out.
  const running = React.useSyncExternalStore(
    tourStore.subscribe,
    () => tourIsRunning(tourStore.read(userEmail)),
    () => false,
  );
  if (!running) return null;
  return <ProductTourBody projectId={projectId} onClose={() => endTour(userEmail)} />;
}

function ProductTourBody({ projectId, onClose }: { projectId: string | null; onClose: () => void }) {
  const steps = React.useMemo(() => tourSteps(projectId), [projectId]);
  const [index, setIndex] = React.useState(0);
  const step: TourStep | undefined = steps[index];
  const router = useRouter();
  const pathname = usePathname();
  const [rect, setRect] = React.useState<DOMRect | null>(null);

  const href = step ? tourHref(step, projectId) : null;
  React.useEffect(() => {
    if (href && href !== pathname) router.push(href);
  }, [href, pathname, router]);

  React.useEffect(() => {
    const measure = () => {
      const el = step?.anchor ? document.querySelector(`[data-tour="${step.anchor}"]`) : null;
      setRect(el ? el.getBoundingClientRect() : null);
    };
    measure();
    const timer = setInterval(measure, MEASURE_MS);
    return () => clearInterval(timer);
  }, [step]);

  const finish = onClose;

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [finish]);

  if (!step) return null;

  const last = index === steps.length - 1;
  // Below the anchor when it fits, above it otherwise; centred when the step has no anchor.
  const below = rect ? rect.bottom + 200 < window.innerHeight : true;
  const card: React.CSSProperties = rect
    ? {
        top: below ? rect.bottom + GAP : undefined,
        bottom: below ? undefined : window.innerHeight - rect.top + GAP,
        left: Math.min(Math.max(GAP, rect.left), window.innerWidth - CARD_W - GAP),
      }
    : { top: "28vh", left: "50%", transform: "translateX(-50%)" };

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="Product tour">
      {/* One element carries both the dimming and the cut-out: a huge spread shadow darkens
          everything outside the spotlight, so there is no four-panel scrim to keep in sync. */}
      <div
        className="pointer-events-auto absolute rounded-md ring-1 ring-primary transition-all duration-200"
        style={
          rect
            ? {
                top: rect.top - 4,
                left: rect.left - 4,
                width: rect.width + 8,
                height: rect.height + 8,
                boxShadow: "0 0 0 9999px rgb(0 0 0 / 0.66)",
              }
            : { inset: 0, boxShadow: "inset 0 0 0 9999px rgb(0 0 0 / 0.66)" }
        }
        onClick={finish}
      />

      <div
        className="pointer-events-auto absolute flex flex-col gap-3 panel border-hairline-strong bg-surface-2 p-4 shadow-2xl duration-150 animate-in fade-in-0 zoom-in-95"
        style={{ ...card, width: CARD_W }}
      >
        <div>
          <p className="text-eyebrow font-medium tracking-[0.4px] text-ink-tertiary uppercase">
            Step {index + 1} of {steps.length}
          </p>
          <h2 className="mt-1 text-body font-medium text-ink">{step.title}</h2>
          <p className="mt-1.5 text-body-sm text-ink-subtle">{step.body}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={finish}>
            Skip tour
          </Button>
          <span className="flex-1" />
          {index > 0 && (
            <Button variant="tertiary" size="sm" onClick={() => setIndex(index - 1)}>
              Back
            </Button>
          )}
          <Button variant="primary" size="sm" onClick={() => (last ? finish() : setIndex(index + 1))}>
            {last ? "Done" : "Next"}
          </Button>
        </div>
      </div>
    </div>
  );
}
