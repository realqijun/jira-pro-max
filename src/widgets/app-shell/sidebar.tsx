"use client";

import { CalendarDays, FolderKanban, LayoutDashboard, LogOut, Plus, Search, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ProjectRow } from "@/server/modules/projects/schema";
import { resetAnalyticsIdentity } from "@/shared/analytics/browser";
import { signOut } from "@/shared/lib/auth-client";
import { cn } from "@/shared/lib/cn";
import { Logo } from "@/shared/ui";
import { HealthDot } from "@/entities/project/health";

const nav = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar({
  projects,
  user,
  onOpenPalette,
  onNewProject,
}: {
  projects: ProjectRow[];
  user: { name: string; email: string };
  onOpenPalette: () => void;
  onNewProject: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <aside className="flex h-screen w-60 shrink-0 flex-col border-r border-hairline bg-canvas">
      <div className="flex h-14 items-center gap-2 px-4">
        <Logo className="size-5" />
        <span className="text-body-sm font-medium tracking-[-0.2px]">PrismPM</span>
      </div>

      <button
        onClick={onOpenPalette}
        className="mx-3 mb-3 flex h-8 items-center gap-2 rounded-md border border-hairline bg-surface-1 px-2.5 text-caption text-ink-subtle transition-[transform,background-color,border-color,box-shadow,color] duration-200 hover:-translate-y-px hover:border-primary/50 hover:bg-surface-2 hover:text-ink hover:shadow-[0_0_18px_rgb(94_106_210_/_0.12)]"
      >
        <Search className="size-3.5" />
        <span className="flex-1 text-left">Search or jump to…</span>
        <kbd className="rounded-xs border border-hairline bg-surface-2 px-1 font-mono text-[10px] text-ink-tertiary">
          ⌘K
        </kbd>
      </button>

      <nav className="flex flex-col gap-0.5 px-3">
        {nav.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href) && !pathname.startsWith("/projects/");
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group sidebar-nav-item flex h-9 items-center gap-2.5 rounded-md px-2.5 text-body-sm transition-[transform,background-color,color] duration-200",
                active
                  ? "bg-surface-2 text-ink shadow-[inset_2px_0_0_var(--color-primary)]"
                  : "text-ink-subtle hover:translate-x-0.5",
              )}
            >
              <Icon className="size-4 transition-transform duration-200 group-hover:scale-110" />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-6 flex items-center justify-between px-5">
        <span className="text-eyebrow font-medium tracking-[0.4px] text-ink-tertiary uppercase">Your projects</span>
        <button
          onClick={onNewProject}
          data-tour="new-project"
          className="rounded-xs p-0.5 text-ink-tertiary hover:bg-surface-2 hover:text-ink"
          aria-label="New project"
        >
          <Plus className="size-3.5" />
        </button>
      </div>
      <div data-tour="sidebar-projects" className="mt-1 flex-1 overflow-y-auto px-3">
        {projects.length === 0 && <p className="px-2.5 py-2 text-caption text-ink-tertiary">No projects yet.</p>}
        {projects.map((p) => {
          const active = pathname.startsWith(`/projects/${p.id}`);
          return (
            <Link
              key={p.id}
              href={`/projects/${p.id}`}
              className={cn(
                "group flex h-9 items-center gap-2.5 rounded-md px-2.5 text-body-sm transition-[transform,background-color,color] duration-200",
                active
                  ? "bg-surface-2 text-ink shadow-[inset_2px_0_0_var(--color-primary)]"
                  : "text-ink-subtle hover:translate-x-0.5 hover:bg-surface-1 hover:text-ink",
              )}
            >
              <HealthDot health={p.health} />
              <span className="truncate">{p.name}</span>
              <span className="ml-auto font-mono text-[10px] text-ink-tertiary">{p.key}</span>
            </Link>
          );
        })}
      </div>

      <div className="flex items-center gap-2.5 border-t border-hairline px-4 py-3">
        <div className="flex size-7 items-center justify-center rounded-full bg-surface-3 text-caption font-medium text-ink-muted">
          {user.name.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-caption font-medium text-ink">{user.name}</p>
          <p className="truncate text-[11px] text-ink-tertiary">{user.email}</p>
        </div>
        <button
          onClick={async () => {
            const result = await signOut();
            if (result.error) return;
            resetAnalyticsIdentity();
            router.push("/login");
          }}
          className="rounded-xs p-1 text-ink-tertiary hover:bg-surface-2 hover:text-ink"
          aria-label="Sign out"
        >
          <LogOut className="size-3.5" />
        </button>
      </div>
    </aside>
  );
}
