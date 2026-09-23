"use client";

import { inView } from "motion";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/shared/lib/cn";

/** How long each screen holds before the next, in milliseconds. */
const HOLD_MS = 5000;

/** Real screens from the seeded demo workspace, captured at 1440 x 900 and 2x. */
const screens = [
  {
    id: "overview",
    label: "Needs attention",
    caption: "The Project opens on what is overdue, late or at risk - not on a list you have to read first.",
    src: "/landing/product/overview.webp",
    alt: "PrismPM Project overview listing an overdue Task, two late Dependencies and two top Risks beside the recent changes feed.",
  },
  {
    id: "tasks",
    label: "Tasks",
    caption: "Every Task grouped by status category, with its Milestone, labels, due date and Person in one row.",
    src: "/landing/product/tasks.webp",
    alt: "PrismPM Tasks list grouped into Backlog, Todo, In Progress, Blocked and Done.",
  },
  {
    id: "timeline",
    label: "Timeline",
    caption: "Tasks roll up to Milestones, and Dependencies draw the line from one to the next.",
    src: "/landing/product/timeline.webp",
    alt: "PrismPM Timeline showing Tasks as bars under their Milestones, joined by Dependency arrows.",
  },
];

/**
 * The product itself, in a window frame, stepping through a few real screens like a
 * short recording. It advances only while on screen and not hovered or focused, and not
 * at all under reduced motion; the tabs choose a screen directly.
 */
export function ProductShowcase() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(0);
  const [visible, setVisible] = useState(false);
  const [held, setHeld] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    return inView(root, () => {
      setVisible(true);
      return () => setVisible(false);
    });
  }, []);

  useEffect(() => {
    if (!visible || held || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setTimeout(() => setCurrent((i) => (i + 1) % screens.length), HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [current, visible, held]);

  return (
    <div
      ref={rootRef}
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      <div role="tablist" aria-label="Product screens" className="flex flex-wrap gap-2">
        {screens.map((screen, i) => (
          <button
            key={screen.id}
            type="button"
            role="tab"
            id={`showcase-tab-${screen.id}`}
            aria-selected={i === current}
            aria-controls="showcase-panel"
            onClick={() => setCurrent(i)}
            className={cn(
              "rounded-full border px-3 py-1 text-caption transition-colors duration-300",
              i === current
                ? "border-hairline-strong bg-surface-2 text-ink"
                : "border-hairline text-ink-subtle hover:border-hairline-strong hover:text-ink",
            )}
          >
            {screen.label}
          </button>
        ))}
      </div>

      <div
        id="showcase-panel"
        role="tabpanel"
        aria-labelledby={`showcase-tab-${screens[current].id}`}
        className="mt-6 overflow-hidden rounded-xl border border-hairline bg-surface-1 shadow-[0_40px_120px_-40px_color-mix(in_srgb,var(--color-primary)_45%,transparent)]"
      >
        {/* Window chrome, so the screens read as the app rather than as pictures of it. */}
        <div aria-hidden className="flex items-center gap-1.5 border-b border-hairline px-4 py-3">
          <span className="size-2.5 rounded-full bg-hairline-strong" />
          <span className="size-2.5 rounded-full bg-hairline-strong" />
          <span className="size-2.5 rounded-full bg-hairline-strong" />
        </div>
        <div className="relative aspect-[16/10]">
          {screens.map((screen, i) => (
            <Image
              key={screen.id}
              src={screen.src}
              alt={screen.alt}
              width={2880}
              height={1800}
              sizes="(min-width: 1280px) 1232px, 100vw"
              aria-hidden={i !== current}
              className={cn(
                "absolute inset-0 h-full w-full object-cover object-top transition-[opacity,transform] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]",
                i === current ? "scale-100 opacity-100" : "scale-[1.015] opacity-0",
              )}
            />
          ))}
        </div>
      </div>

      <p aria-live="polite" className="mt-4 max-w-xl text-body-sm text-ink-subtle">
        {screens[current].caption}
      </p>
    </div>
  );
}
