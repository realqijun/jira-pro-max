import { FolderKanban } from "lucide-react";
import Link from "next/link";
import { ctxForCurrentUser } from "@/server/core/action";
import { projectsService } from "@/server/modules/projects/service";
import { tasksService } from "@/server/modules/tasks/service";
import { fmtDate } from "@/shared/lib/dates";
import { EmptyState, PageHeader, Panel } from "@/shared/ui";
import { HealthBadge, ProjectStatusBadge } from "@/entities/project/health";
import { NewProjectButton } from "@/features/project/new-project-button";

export const metadata = { title: "Projects" };

export default async function ProjectsPage() {
  const ctx = await ctxForCurrentUser();
  const [projects, counts] = await Promise.all([
    projectsService.list(ctx),
    tasksService.countsByStatusCategoryForOwnedProjects(ctx),
  ]);

  return (
    <>
      <PageHeader
        title="Projects"
        description={`${projects.length} total · health, progress, and target dates at a glance`}
        actions={<NewProjectButton />}
      />
      <div className="flex-1 overflow-y-auto p-6">
        {projects.length === 0 ? (
          <EmptyState
            icon={<FolderKanban />}
            title="No projects"
            description="Projects hold tasks, milestones, risks and evidence."
            action={<NewProjectButton />}
          />
        ) : (
          <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {projects.map((p) => {
              const c = counts[p.id] ?? {};
              const total = Object.values(c).reduce((a, b) => a + b, 0);
              const done = c.done ?? 0;
              const pct = total ? Math.round((done / total) * 100) : 0;
              return (
                <Link key={p.id} href={`/projects/${p.id}`} className="group">
                  <Panel className="project-card interactive-lift flex h-full flex-col gap-3 p-5 transition-colors group-hover:border-primary/35 group-hover:bg-surface-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-mono text-caption text-ink-tertiary">{p.key}</p>
                        <h3 className="truncate text-card-title font-medium text-ink transition-colors group-hover:text-primary-hover">
                          {p.name}
                        </h3>
                      </div>
                      <HealthBadge health={p.health} />
                    </div>
                    {p.description && <p className="line-clamp-2 text-caption text-ink-subtle">{p.description}</p>}
                    <div className="mt-auto flex flex-col gap-2">
                      <div className="flex items-center justify-between text-caption text-ink-subtle">
                        <span>
                          {done}/{total} tasks done
                        </span>
                        <span>{pct}%</span>
                      </div>
                      <div className="h-1 overflow-hidden rounded-full bg-surface-3">
                        <div
                          className="h-full animate-progress-in rounded-full bg-primary"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between pt-1">
                        <ProjectStatusBadge status={p.status} />
                        <span className="text-caption text-ink-tertiary">
                          {p.targetDate ? `Target ${fmtDate(p.targetDate, "d MMM yyyy")}` : "No target date"}
                        </span>
                      </div>
                    </div>
                  </Panel>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
