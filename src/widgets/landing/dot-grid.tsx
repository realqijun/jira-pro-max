"use client";

import { inView } from "motion";
import { useEffect, useRef } from "react";
import { cn } from "@/shared/lib/cn";

/** Distance between dots, in CSS pixels. */
const GAP = 28;
/** Dot radius at rest and at the peak of a blink. */
const RADIUS = 1.1;
const PEAK_RADIUS = 2;
/** Resting brightness of every dot, as alpha over the canvas. */
const REST = 0.3;
/** Average blinks started per second, per thousand dots. */
const BLINK_RATE = 14;
/** How long one blink lasts, in milliseconds. */
const BLINK_MS = 1400;

type Blink = { index: number; start: number; accent: boolean };

/**
 * A field of dim dots behind the hero, with a few at a time brightening and fading at
 * random - a quiet sign of a system that is always recording. Drawn on one canvas so the
 * cost stays flat however many dots fit the screen; it stops drawing while off-screen,
 * and under reduced motion it is a still grid.
 */
export function DotGrid({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const styles = getComputedStyle(canvas);
    const ink = styles.getPropertyValue("--color-ink").trim() || "#f7f8f8";
    const accent = styles.getPropertyValue("--color-primary-hover").trim() || "#828fff";
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let cols = 0;
    let rows = 0;
    let offsetX = 0;
    let offsetY = 0;
    let blinks: Blink[] = [];
    let frame = 0;
    let last = 0;
    /** The resting grid, painted once per size so a frame only draws the dots that are blinking. */
    const base = document.createElement("canvas");
    const baseCtx = base.getContext("2d");

    const size = () => {
      const { width, height } = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.floor(width / GAP) + 1;
      rows = Math.floor(height / GAP) + 1;
      // Centre the lattice so the margins match on both sides.
      offsetX = (width - (cols - 1) * GAP) / 2;
      offsetY = (height - (rows - 1) * GAP) / 2;
      blinks = [];
      paintBase(dpr);
    };

    const dot = (target: CanvasRenderingContext2D, index: number, radius: number, color: string, alpha: number) => {
      target.globalAlpha = alpha;
      target.fillStyle = color;
      target.beginPath();
      target.arc(offsetX + (index % cols) * GAP, offsetY + Math.floor(index / cols) * GAP, radius, 0, Math.PI * 2);
      target.fill();
    };

    const paintBase = (dpr: number) => {
      if (!baseCtx) return;
      base.width = canvas.width;
      base.height = canvas.height;
      baseCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      for (let i = 0; i < cols * rows; i++) dot(baseCtx, i, RADIUS, ink, REST);
      baseCtx.globalAlpha = 1;
    };

    const draw = (now: number) => {
      const { width, height } = canvas.getBoundingClientRect();
      ctx.clearRect(0, 0, width, height);
      // Before layout (or while hidden) the canvas is 0x0, and drawImage throws on an empty source.
      if (!base.width || !base.height) return;
      ctx.drawImage(base, 0, 0, width, height);

      blinks = blinks.filter((b) => now - b.start < BLINK_MS);
      for (const b of blinks) {
        // Rise quickly over the first quarter, then fade slowly.
        const t = (now - b.start) / BLINK_MS;
        const glow = t < 0.25 ? Math.sin((t / 0.25) * (Math.PI / 2)) : (1 - (t - 0.25) / 0.75) ** 2;
        dot(ctx, b.index, RADIUS + (PEAK_RADIUS - RADIUS) * glow, b.accent ? accent : ink, REST + (0.95 - REST) * glow);
      }
      ctx.globalAlpha = 1;
    };

    const tick = (now: number) => {
      const delta = last ? Math.min(now - last, 100) : 16;
      last = now;
      const expected = (cols * rows * BLINK_RATE * delta) / 1_000_000;
      let spawn = Math.floor(expected) + (Math.random() < expected % 1 ? 1 : 0);
      while (spawn-- > 0) {
        blinks.push({ index: Math.floor(Math.random() * cols * rows), start: now, accent: Math.random() < 0.3 });
      }
      draw(now);
      frame = requestAnimationFrame(tick);
    };

    const stop = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      last = 0;
    };

    size();
    draw(performance.now());
    const observer = new ResizeObserver(() => {
      size();
      draw(performance.now());
    });
    observer.observe(canvas);

    const unwatch = still
      ? () => {}
      : inView(canvas, () => {
          if (!frame) frame = requestAnimationFrame(tick);
          return stop;
        });

    return () => {
      unwatch();
      stop();
      observer.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden className={cn("block h-full w-full", className)} />;
}
