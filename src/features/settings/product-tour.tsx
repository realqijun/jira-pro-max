"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { endTour, startTour, tourIsRunning, tourStore } from "@/shared/lib/tour";
import { Panel, Switch } from "@/shared/ui";

/**
 * The switch that runs the guided tour, and the only way back to it once it has been skipped
 * apart from the command palette. It reads the same account-scoped flag the tour renders from, so
 * switching it on starts the tour from the dashboard and switching it off ends it.
 */
export function ProductTourSetting({ userEmail }: { userEmail: string }) {
  const router = useRouter();
  const running = React.useSyncExternalStore(
    tourStore.subscribe,
    () => tourIsRunning(tourStore.read(userEmail)),
    () => false,
  );
  const handleChange = React.useCallback(
    (on: boolean) => {
      if (on) {
        router.push("/dashboard");
        startTour(userEmail);
      } else {
        endTour(userEmail);
      }
    },
    [router, userEmail],
  );

  return (
    <Panel className="flex items-center justify-between gap-4 px-4 py-3">
      <div>
        <p className="text-body-sm font-medium text-ink">Show the guided tour</p>
        <p className="mt-1 text-caption text-ink-subtle">
          New accounts get the tour once. Switch it on to run it again from the first step, or off to dismiss it.
        </p>
      </div>
      <Switch checked={running} onChange={handleChange} label="Show the guided tour" />
    </Panel>
  );
}
