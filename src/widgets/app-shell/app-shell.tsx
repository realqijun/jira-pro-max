"use client";

import * as React from "react";
import type { ProjectRow } from "@/server/modules/projects/schema";
import { ShellContext, type ShellCtx } from "@/shared/lib/shell-context";
import { startTour } from "@/shared/lib/tour";
import { CreateProjectDialog } from "@/features/project/create-project-dialog";
import { CommandPalette } from "@/widgets/command-palette/command-palette";
import { ProductTour } from "@/widgets/tour/product-tour";
import { Sidebar } from "./sidebar";

export { useShell } from "@/shared/lib/shell-context";

/** Dock open state lives in localStorage so a refresh mid-Conversation keeps the dock open. */
const ASSISTANT_OPEN_KEY = "prismpm.assistant-open";
// Kept only to migrate preferences saved before the PrismPM rename.
const LEGACY_ASSISTANT_OPEN_KEY = "vantage.assistant-open";
const listeners = new Set<() => void>();
const assistantOpenStore = {
  get: () => (localStorage.getItem(ASSISTANT_OPEN_KEY) ?? localStorage.getItem(LEGACY_ASSISTANT_OPEN_KEY)) === "1",
  set: (open: boolean) => {
    localStorage.setItem(ASSISTANT_OPEN_KEY, open ? "1" : "0");
    listeners.forEach((l) => l());
  },
  subscribe: (l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export function AppShell({
  projects,
  user,
  children,
}: {
  projects: ProjectRow[];
  user: { name: string; email: string };
  children: React.ReactNode;
}) {
  const [palette, setPalette] = React.useState(false);
  const [newProject, setNewProject] = React.useState(false);
  const assistantOpen = React.useSyncExternalStore(assistantOpenStore.subscribe, assistantOpenStore.get, () => false);
  const toggleAssistant = React.useCallback(() => assistantOpenStore.set(!assistantOpenStore.get()), []);

  React.useEffect(() => {
    const legacy = localStorage.getItem(LEGACY_ASSISTANT_OPEN_KEY);
    if (legacy !== null) {
      if (localStorage.getItem(ASSISTANT_OPEN_KEY) === null) {
        localStorage.setItem(ASSISTANT_OPEN_KEY, legacy);
      }
      localStorage.removeItem(LEGACY_ASSISTANT_OPEN_KEY);
    }
  }, []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((v) => !v);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const ctx = React.useMemo<ShellCtx>(
    () => ({
      openPalette: () => setPalette(true),
      openNewProject: () => setNewProject(true),
      assistantOpen,
      toggleAssistant,
    }),
    [assistantOpen, toggleAssistant],
  );

  return (
    <ShellContext.Provider value={ctx}>
      <div className="flex h-screen overflow-hidden">
        <Sidebar projects={projects} user={user} onOpenPalette={ctx.openPalette} onNewProject={ctx.openNewProject} />
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
      </div>
      <CommandPalette
        open={palette}
        onClose={() => setPalette(false)}
        projects={projects}
        onNewProject={ctx.openNewProject}
        onToggleAssistant={ctx.toggleAssistant}
        onStartTour={startTour}
      />
      <CreateProjectDialog open={newProject} onClose={() => setNewProject(false)} />
      {/* The tour runs over the whole shell, so it is mounted here rather than on a page: its
          steps walk from the sidebar into a Project and must survive the navigation between. */}
      <ProductTour projectId={projects[0]?.id ?? null} />
    </ShellContext.Provider>
  );
}
