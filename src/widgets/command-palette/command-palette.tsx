"use client";

import { Command } from "cmdk";
import {
  AlertTriangle,
  CalendarDays,
  CalendarRange,
  Compass,
  FileText,
  FolderKanban,
  ImageIcon,
  LayoutDashboard,
  ListTodo,
  Loader2,
  MessagesSquare,
  Plus,
  Settings,
  Sparkles,
  Users,
  GitBranch,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";
import { StatusBadge } from "@/entities/status/status-badge";
import type { ProjectRow } from "@/server/modules/projects/schema";
import { searchTasksAction } from "@/server/modules/tasks/actions";
import type { TaskSearchResult } from "@/server/modules/tasks/search";

export const PROJECT_SECTIONS = [
  { slug: "", label: "Overview", icon: LayoutDashboard },
  { slug: "tasks", label: "Tasks", icon: ListTodo },
  { slug: "timeline", label: "Timeline", icon: CalendarRange },
  { slug: "calendar", label: "Calendar", icon: CalendarDays },
  { slug: "risks", label: "Risks", icon: AlertTriangle },
  { slug: "decisions", label: "Decisions", icon: GitBranch },
  { slug: "evidence", label: "Evidence", icon: FileText },
  { slug: "renders", label: "Renders", icon: ImageIcon },
  { slug: "people", label: "People", icon: Users },
  { slug: "messages", label: "Messages", icon: MessagesSquare },
  { slug: "settings", label: "Settings", icon: Settings },
] as const;

const GO_TO = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

/** Task search kicks in at this many trimmed characters and waits this long after the last keystroke. */
const MIN_QUERY = 2;
const DEBOUNCE_MS = 180;

type SearchState = { loading: boolean; results: TaskSearchResult[] };
const IDLE: SearchState = { loading: false, results: [] };

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  projects: ProjectRow[];
  onNewProject: () => void;
  onToggleAssistant: () => void;
  onStartTour: () => void;
}

/**
 * `AppShell` keeps this mounted for the whole session, so the body — which owns `query`, the
 * search state and the debounce/keyboard effects — is a separate component that really unmounts
 * when `open` is false. Reopening therefore always starts from a blank query with no stale rows,
 * without needing a reset effect.
 */
export function CommandPalette({ open, ...props }: CommandPaletteProps) {
  if (!open) return null;
  return <CommandPaletteBody {...props} />;
}

function CommandPaletteBody({
  onClose,
  projects,
  onNewProject,
  onToggleAssistant,
  onStartTour,
}: Omit<CommandPaletteProps, "open">) {
  const router = useRouter();
  const pathname = usePathname();
  const currentProject = projects.find((p) => pathname.startsWith(`/projects/${p.id}`));
  const currentProjectId = currentProject?.id;

  const [query, setQuery] = React.useState("");
  const q = query.trim();
  const showTasks = q.length >= MIN_QUERY;
  const [search, setSearch] = React.useState<SearchState>(IDLE);
  const requestId = React.useRef(0);

  const onQueryChange = (v: string) => {
    setQuery(v);
    // Clear stale rows immediately so Enter can never pick a result from a previous query.
    setSearch({ loading: v.trim().length >= MIN_QUERY, results: [] });
  };

  React.useEffect(() => {
    // Bump before the guard so a response for a previous query is discarded even when the query
    // has since dropped below MIN_QUERY (no new request is issued, but the old one must not land).
    const id = ++requestId.current;
    if (!showTasks) return;
    const timer = setTimeout(async () => {
      const res = await searchTasksAction({ q, currentProjectId });
      if (id !== requestId.current) return; // a newer query is in flight
      setSearch({ loading: false, results: res.ok ? res.data : [] });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q, showTasks, currentProjectId]);

  // Always registered while the body is mounted (i.e. while open); re-subscribes when the shell
  // hands down a new `onClose` so the latest closure is the one invoked.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const go = (href: string) => {
    onClose();
    router.push(href);
  };

  // Static items are filtered here (plain substring) instead of by cmdk, so DOM order is authoritative
  // and the Tasks group can carry its own loading / empty rows without tripping `Command.Empty`.
  const hit = (...labels: string[]) => !q || labels.some((l) => l.toLowerCase().includes(q.toLowerCase()));
  const sectionHits = currentProject ? PROJECT_SECTIONS.filter((s) => hit(s.label)) : [];
  const goToHits = GO_TO.filter((g) => hit(g.label));
  const projectHits = projects.filter((p) => hit(p.name, p.key));
  const actionHits = [
    ...(hit("New project") ? ["new-project"] : []),
    ...(currentProject && hit("Toggle Assistant", "Assistant") ? ["assistant"] : []),
    ...(hit("Take the product tour", "Tour") ? ["tour"] : []),
  ];
  const staticCount = sectionHits.length + goToHits.length + projectHits.length + actionHits.length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-overlay/70 pt-[15vh]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <Command
        label="Command palette"
        shouldFilter={false}
        className="w-full max-w-lg overflow-hidden panel border-hairline-strong bg-surface-2 shadow-2xl duration-150 animate-in fade-in-0 zoom-in-95"
      >
        <Command.Input
          autoFocus
          value={query}
          onValueChange={onQueryChange}
          placeholder="Type a command or search…"
          className="h-12 w-full border-b border-hairline bg-transparent px-4 text-body-sm text-ink placeholder:text-ink-tertiary focus:outline-none"
        />
        <Command.List className="max-h-80 overflow-y-auto p-2 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-eyebrow [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:tracking-[0.4px] [&_[cmdk-group-heading]]:text-ink-tertiary [&_[cmdk-group-heading]]:uppercase">
          {!showTasks && staticCount === 0 && (
            <div role="status" aria-live="polite" className="px-2 py-6 text-center text-caption text-ink-subtle">
              No results.
            </div>
          )}

          {currentProject && sectionHits.length > 0 && (
            <Command.Group heading={currentProject.name}>
              {sectionHits.map((s) => (
                <Item
                  key={s.slug}
                  value={`section:${s.slug}`}
                  icon={s.icon}
                  onSelect={() => go(`/projects/${currentProject.id}${s.slug ? `/${s.slug}` : ""}`)}
                >
                  {s.label}
                </Item>
              ))}
            </Command.Group>
          )}

          {goToHits.length > 0 && (
            <Command.Group heading="Go to">
              {goToHits.map((g) => (
                <Item key={g.href} value={`goto:${g.href}`} icon={g.icon} onSelect={() => go(g.href)}>
                  {g.label}
                </Item>
              ))}
            </Command.Group>
          )}

          {projectHits.length > 0 && (
            <Command.Group heading="Projects">
              {projectHits.map((p) => (
                <Item key={p.id} value={`project:${p.id}`} icon={FolderKanban} onSelect={() => go(`/projects/${p.id}`)}>
                  {p.name}
                  <span className="ml-auto font-mono text-[10px] text-ink-tertiary">{p.key}</span>
                </Item>
              ))}
            </Command.Group>
          )}

          {actionHits.length > 0 && (
            <Command.Group heading="Actions">
              {actionHits.includes("new-project") && (
                <Item
                  value="action:new-project"
                  icon={Plus}
                  onSelect={() => {
                    onClose();
                    onNewProject();
                  }}
                >
                  New project
                </Item>
              )}
              {actionHits.includes("assistant") && (
                <Item
                  value="action:assistant"
                  icon={Sparkles}
                  onSelect={() => {
                    onClose();
                    onToggleAssistant();
                  }}
                >
                  Toggle Assistant
                </Item>
              )}
              {actionHits.includes("tour") && (
                <Item
                  value="action:tour"
                  icon={Compass}
                  onSelect={() => {
                    onClose();
                    onStartTour();
                  }}
                >
                  Take the product tour
                </Item>
              )}
            </Command.Group>
          )}

          {showTasks && (
            <Command.Group heading="Tasks">
              {search.loading ? (
                <div
                  role="status"
                  aria-live="polite"
                  className="flex h-8 items-center gap-2.5 px-2 text-caption text-ink-subtle"
                >
                  <Loader2 className="size-3.5 animate-spin" /> Searching…
                </div>
              ) : search.results.length === 0 ? (
                <div role="status" aria-live="polite" className="px-2 py-3 text-center text-caption text-ink-subtle">
                  No tasks match
                </div>
              ) : (
                search.results.map((r) => (
                  <Item
                    key={r.id}
                    value={`task:${r.id}`}
                    icon={ListTodo}
                    onSelect={() => go(`/projects/${r.projectId}/tasks?task=${r.id}`)}
                  >
                    <span className="shrink-0 font-mono text-[10px] text-ink-tertiary">{`${r.projectKey}-${r.number}`}</span>
                    <span className="truncate">{r.title}</span>
                    <span className="ml-auto flex shrink-0 items-center gap-2">
                      <span className="max-w-32 truncate text-caption text-ink-tertiary">{r.projectName}</span>
                      <StatusBadge status={r.status} />
                    </span>
                  </Item>
                ))
              )}
            </Command.Group>
          )}
        </Command.List>
      </Command>
    </div>
  );
}

function Item({
  value,
  icon: Icon,
  children,
  onSelect,
}: {
  /** Stable unique value; cmdk needs one when an item's text can change between renders. */
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  onSelect: () => void;
}) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="flex h-8 min-w-0 cursor-pointer items-center gap-2.5 rounded-md px-2 text-body-sm text-ink-muted data-[selected=true]:bg-surface-3 data-[selected=true]:text-ink"
    >
      <Icon className="size-4 shrink-0 text-ink-subtle" />
      {children}
    </Command.Item>
  );
}
