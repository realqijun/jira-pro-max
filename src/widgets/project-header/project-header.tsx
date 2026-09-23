"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ProjectRow } from "@/server/modules/projects/schema";
import { labelFor } from "@/shared/domain";
import { cn } from "@/shared/lib/cn";
import { AssistantToggle } from "@/widgets/assistant/assistant-toggle";
import { HealthDot } from "@/entities/project/health";
import { PROJECT_SECTIONS } from "@/widgets/command-palette/command-palette";

export function ProjectHeader({ project }: { project: ProjectRow }) {
  const pathname = usePathname();
  const base = `/projects/${project.id}`;
  return (
    <div className="shrink-0 border-b border-hairline">
      <div className="flex h-14 items-center gap-3 px-6">
        <HealthDot health={project.health} className="size-2.5" />
        <h1 className="text-body font-medium text-ink">{project.name}</h1>
        <span className="font-mono text-caption text-ink-tertiary">{project.key}</span>
        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-caption text-ink-subtle">
          {labelFor(project.status)}
        </span>
        <span className="ml-auto">
          <AssistantToggle />
        </span>
      </div>
      <nav data-tour="project-tabs" className="flex gap-1 px-4">
        {PROJECT_SECTIONS.map((s) => {
          const href = s.slug ? `${base}/${s.slug}` : base;
          const active = s.slug ? pathname.startsWith(href) : pathname === base;
          return (
            <Link
              key={s.slug}
              href={href}
              className={cn(
                "-mb-px flex h-9 items-center gap-1.5 border-b-2 px-2 text-body-sm transition-colors",
                active ? "border-ink text-ink" : "border-transparent text-ink-subtle hover:text-ink",
              )}
            >
              <s.icon className="size-3.5" />
              {s.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
