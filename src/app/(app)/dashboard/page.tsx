import { ArrowRight, Diamond, Inbox } from "lucide-react";
import Link from "next/link";
import { ctxForCurrentUser } from "@/server/core/action";
import { aiConfigService } from "@/server/modules/ai-config/service";
import { getModel } from "@/server/modules/assistant/model";
import { assistantService } from "@/server/modules/assistant/service";
import { workspaceOverview } from "@/server/modules/workspace/queries";
import { labelFor } from "@/shared/domain";
import { dueLabel } from "@/shared/lib/dates";
import { cn } from "@/shared/lib/cn";
import { Badge, EmptyState, PageHeader, Panel, SectionTitle } from "@/shared/ui";
import { ActivityRow } from "@/entities/activity/activity-item";
import { HealthDot } from "@/entities/project/health";
import { NewProjectButton } from "@/features/project/new-project-button";
import { AssistantDock } from "@/widgets/assistant/assistant-dock";
import { AssistantToggle } from "@/widgets/assistant/assistant-toggle";
import { AttentionCountStrip, AttentionList } from "@/widgets/attention/attention-list";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const ctx = await ctxForCurrentUser();
  const [o, assistantDock, aiConfigs] = await Promise.all([
    workspaceOverview(ctx),
    assistantService.dock(ctx, null),
    aiConfigService.list(ctx),
  ]);
  const conversations = await assistantService.library(ctx, assistantDock.thread.conversation.id);
  const dock = (
    <AssistantDock
      projectId={null}
      projects={o.projects}
      conversations={conversations}
      thread={assistantDock.thread}
      configured={getModel() !== null || aiConfigs.length > 0}
    />
  );

  if (o.projects.length === 0) {
    return (
      <>
        <PageHeader title="Dashboard" actions={<AssistantToggle />} />
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            <EmptyState
              icon={<Inbox />}
              title="No projects yet"
              description="Create your first project to start tracking tasks, milestones and risks, or ask the Assistant."
              action={<NewProjectButton />}
            />
          </div>
          {dock}
        </div>
      </>
    );
  }

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          title="Dashboard"
          description={`${o.stats.activeProjects} active project${o.stats.activeProjects === 1 ? "" : "s"}`}
          actions={
            <>
              <AssistantToggle />
              <NewProjectButton />
            </>
          }
        />
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
            <div className="grid grid-cols-4 gap-3">
              <Stat label="Overdue tasks" value={o.stats.overdue} tone={o.stats.overdue ? "danger" : "muted"} />
              <Stat label="Due in 7 days" value={o.stats.dueSoon} />
              <Stat label="Blocked" value={o.stats.blocked} tone={o.stats.blocked ? "warn" : "muted"} />
              <Stat label="Top risks" value={o.stats.topRisks} tone={o.stats.topRisks ? "danger" : "muted"} />
            </div>

            <div className="grid grid-cols-3 gap-6">
              <div className="col-span-2 flex flex-col gap-6">
                <section>
                  <SectionTitle className="mb-2">Needs attention</SectionTitle>
                  <AttentionList
                    flat
                    items={o.attention.items}
                    showProject={(id) => o.projectById(id)?.key}
                    emptyText="Nothing needs attention across your active projects."
                  />
                </section>

                <section>
                  <SectionTitle className="mb-2">Upcoming milestones</SectionTitle>
                  <Panel className="divide-y divide-hairline">
                    {o.upcomingMilestones.length === 0 && (
                      <p className="px-4 py-6 text-center text-caption text-ink-subtle">
                        No milestones due in the next two weeks.
                      </p>
                    )}
                    {o.upcomingMilestones.map(({ milestone, status }) => {
                      const p = o.projectById(milestone.projectId)!;
                      const due = dueLabel(milestone.dueDate);
                      return (
                        <Link
                          key={milestone.id}
                          href={`/projects/${p.id}/timeline`}
                          className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2"
                        >
                          <Diamond className="size-3.5" style={{ color: status.color }} fill={status.color} />
                          <span className="min-w-0 flex-1 truncate text-body-sm text-ink">{milestone.name}</span>
                          <span className="text-caption text-ink-subtle">{p.name}</span>
                          <Badge color={status.color}>{status.name}</Badge>
                          <span
                            className={cn(
                              "w-20 text-right text-caption",
                              due.tone === "danger"
                                ? "text-tag-red"
                                : due.tone === "warn"
                                  ? "text-tag-orange"
                                  : "text-ink-subtle",
                            )}
                          >
                            {due.text}
                          </span>
                        </Link>
                      );
                    })}
                  </Panel>
                </section>
              </div>

              <div className="flex flex-col gap-6">
                <section>
                  <SectionTitle className="mb-2">Projects</SectionTitle>
                  <Panel className="divide-y divide-hairline">
                    {o.activeProjects.length === 0 && (
                      <p className="px-4 py-6 text-center text-caption text-ink-subtle">
                        No active projects. Archived and completed projects are in{" "}
                        <Link href="/projects" className="text-ink underline-offset-2 hover:underline">
                          Projects
                        </Link>
                        .
                      </p>
                    )}
                    {o.activeProjects.map((p) => {
                      const attention = o.attention.byProject.get(p.id);
                      return (
                        <Link
                          key={p.id}
                          href={`/projects/${p.id}`}
                          className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2"
                        >
                          <HealthDot health={p.health} />
                          <span className="min-w-0 flex-1 truncate text-body-sm text-ink">{p.name}</span>
                          {attention ? (
                            <AttentionCountStrip counts={attention.counts} />
                          ) : (
                            <span className="text-caption text-ink-tertiary">{labelFor(p.status)}</span>
                          )}
                          <ArrowRight className="size-3.5 text-ink-tertiary" />
                        </Link>
                      );
                    })}
                  </Panel>
                </section>

                <section>
                  <SectionTitle className="mb-2">This week&apos;s changes</SectionTitle>
                  <Panel className="px-4">
                    {o.activity.length === 0 ? (
                      <p className="py-6 text-center text-caption text-ink-subtle">No changes in the last 7 days.</p>
                    ) : (
                      <ul className="divide-y divide-hairline/60">
                        {o.activity.slice(0, 12).map((a) => (
                          <ActivityRow key={a.event.id} item={a} projectName={o.projectById(a.event.projectId)?.name} />
                        ))}
                      </ul>
                    )}
                  </Panel>
                </section>
              </div>
            </div>
          </div>
        </div>
      </div>
      {dock}
    </div>
  );
}

function Stat({ label, value, tone = "muted" }: { label: string; value: number; tone?: "muted" | "warn" | "danger" }) {
  return (
    <Panel className="px-4 py-3">
      <p className="text-caption text-ink-subtle">{label}</p>
      <p
        className={cn(
          "mt-1 text-headline font-medium tabular-nums",
          tone === "danger" ? "text-tag-red" : tone === "warn" ? "text-tag-orange" : "text-ink",
        )}
      >
        {value}
      </p>
    </Panel>
  );
}
