"use client";

import * as React from "react";
import { endTour, startTour, tourIsRunning, tourStore } from "@/shared/lib/tour";
import { Panel, Switch } from "@/shared/ui";

/**
 * The switch that runs the guided tour, and the only way back to it once it has been skipped
 * apart from the command palette. It reads the same stored flag the tour renders from, so
 * switching it on starts the tour on the page behind Settings and switching it off ends it.
 */
export function ProductTourSetting() {
  const running = React.useSyncExternalStore(
    tourStore.subscribe,
    () => tourIsRunning(tourStore.read()),
    () => false,
  );

  return (
    <Panel className="flex items-center justify-between gap-4 px-4 py-3">
      <div>
        <p className="text-body-sm font-medium text-ink">Show the guided tour</p>
        <p className="mt-1 text-caption text-ink-subtle">
          New accounts get the tour once. Switch it on to run it again from the first step, or off to dismiss it.
        </p>
      </div>
      <Switch checked={running} onChange={(on) => (on ? startTour() : endTour())} label="Show the guided tour" />
    </Panel>
  );
}
