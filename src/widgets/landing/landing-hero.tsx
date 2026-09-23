"use client";

import { animate, splitText, stagger, utils } from "animejs";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { DotGrid } from "./dot-grid";

const stats = [
  { value: 6, suffix: "", label: "record types, one graph" },
  { value: 100, suffix: "%", label: "of field changes kept" },
  { value: 1, suffix: " endpoint", label: "MCP, same tools" },
];

export function LandingHero({ signedIn }: { signedIn: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const heading = headingRef.current;
    if (!root || !heading) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    // anime.js splits the headline into words and clips each one so it can rise into place.
    const split = splitText(heading, { words: { wrap: "clip" }, chars: false, accessible: true });

    const reveal = animate(split.words, {
      y: ["105%", "0%"],
      opacity: [0, 1],
      duration: 900,
      delay: stagger(42),
      ease: "out(3)",
    });

    const fade = animate(root.querySelectorAll("[data-hero-fade]"), {
      opacity: [0, 1],
      y: [12, 0],
      duration: 700,
      delay: stagger(90, { start: 420 }),
      ease: "out(2)",
    });

    const counters = [...root.querySelectorAll<HTMLElement>("[data-hero-count]")].map((el) => {
      const to = Number(el.dataset.heroCount);
      return animate(el, {
        innerHTML: [0, to],
        duration: 1100,
        delay: 700,
        ease: "out(3)",
        modifier: utils.round(0),
      });
    });

    return () => {
      reveal.revert();
      fade.revert();
      counters.forEach((counter) => counter.revert());
      split.revert();
    };
  }, []);

  return (
    <div ref={rootRef} className="relative isolate px-6 pt-24 pb-16 sm:pt-32">
      {/* A dim field of dots, a few blinking at a time, fading out toward the film below. */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 -z-10 h-[120%]"
        style={{
          maskImage: "radial-gradient(ellipse 75% 70% at 50% 38%, black 30%, transparent 78%)",
          WebkitMaskImage: "radial-gradient(ellipse 75% 70% at 50% 38%, black 30%, transparent 78%)",
        }}
      >
        <DotGrid />
      </div>
      <div className="mx-auto max-w-4xl text-center">
        <span
          data-hero-fade
          className="inline-flex items-center gap-2 rounded-full border border-hairline bg-surface-1 px-3 py-1 text-caption text-ink-muted"
        >
          <span className="size-1.5 rounded-full bg-primary" />A clearer view of every project
        </span>

        <h1
          ref={headingRef}
          className="mt-7 text-[40px] leading-[1.08] font-semibold tracking-[-1.4px] text-balance text-ink sm:text-display-lg lg:text-display-xl"
        >
          Stand above the whole project.
        </h1>

        <p data-hero-fade className="mx-auto mt-6 max-w-xl text-body-lg text-ink-subtle">
          PrismPM holds the plan view and the single changed field in one system. Every Task, every Decision, every
          assumption it rests on, and every change anyone made to any of it.
        </p>

        <div data-hero-fade className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <Link
            href={signedIn ? "/dashboard" : "/signup"}
            className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-body-sm font-medium text-on-primary transition-colors hover:bg-primary-hover active:bg-primary-focus"
          >
            {signedIn ? "Open your workspace" : "Create an account"}
            <ArrowRight className="size-4" />
          </Link>
          <a
            href="#how"
            className="inline-flex h-10 items-center rounded-md border border-hairline bg-surface-1 px-4 text-body-sm font-medium text-ink transition-colors hover:border-hairline-strong hover:bg-surface-2"
          >
            See how it works
          </a>
        </div>
      </div>

      <dl
        data-hero-fade
        className="mx-auto mt-16 grid max-w-2xl grid-cols-1 gap-px overflow-hidden rounded-lg border border-hairline bg-hairline sm:grid-cols-3"
      >
        {stats.map((stat) => (
          <div key={stat.label} className="bg-surface-1 px-5 py-5 text-center">
            <dt className="text-headline font-semibold tracking-[-0.6px] text-ink">
              <span data-hero-count={stat.value}>{stat.value}</span>
              {stat.suffix}
            </dt>
            <dd className="mt-1 text-caption text-ink-subtle">{stat.label}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
