import { AlertTriangle, Diamond } from "lucide-react";
import Link from "next/link";
import { ctxForCurrentUser } from "@/server/core/action";
import { activityService } from "@/server/modules/activity/service";
import { milestonesService } from "@/server/modules/milestones/service";
import { loadProjectRefs } from "@/server/modules/projects/refs";
import { projectsService } from "@/server/modules/projects/service";
import { risksService } from "@/server/modules/risks/service";
import { tasksService } from "@/server/modules/tasks/service";
import { decisionsService } from "@/server/modules/decisions/service";
import { impactService } from "@/server/modules/impact/service";
import { proposalsService } from "@/server/modules/proposals/service";
import { projectAttention } from "@/server/modules/workspace/queries";
import { RISK_MID_SEVERITY, RISK_TOP_SEVERITY, TERMINAL_CATEGORIES, labelFor, riskSeverity } from "@/shared/domain";
import { cn } from "@/shared/lib/cn";
import { dueLabel, fmtDate } from "@/shared/lib/dates";
import { Badge, Panel, SectionTitle } from "@/shared/ui";
import { ActivityRow } from "@/entities/activity/activity-item";
import { HealthBadge } from "@/entities/project/health";
import { Avatar } from "@/entities/person/avatar";
import { AttentionList } from "@/widgets/attention/attention-list";
import { ImpactAlerts } from "@/widgets/attention/impact-alerts";
import { ProposalCards } from "@/widgets/attention/proposal-cards";

export const metadata = { title: "Overview" };

export default async function ProjectOverviewPage({ params }: PageProps<"/projects/[projectId]">) {
  const { projectId } = await params;
  const ctx = await ctxForCurrentUser();
  const [project, tasks, milestones, risks, activity, counts, alerts, proposals, items] = await Promise.all([
    projectsService.get(ctx, projectId),
    tasksService.list(ctx, projectId),
    milestonesService.list(ctx, projectId),
    risksService.list(ctx, projectId),
    activityService.recentForProject(ctx, projectId, 20),
    tasksService.countsByStatusCategory(ctx, projectId),
    impactService.listAlerts(ctx, projectId),
    proposalsService.listPending(ctx, projectId),
    proposalsService.listPendingItems(ctx, projectId),
  ]);
  const [sourceLabels, refs] = await Promise.all([
    proposals.length || items.length ? decisionsService.sourceLabels(ctx, projectId) : new Map<string, string>(),
    // The item dialogs need the Project's reference data; only loaded when there is something to review.
    items.length ? loadProjectRefs(ctx, projectId) : null,
  ]);
  // Reuse the collections above; only the dependency edges are fetched inside.
  const attention = await projectAttention(ctx, projectId, { rows: { tasks, milestones, risks } });
  const base = `/projects/${projectId}`;
  const total = tasks.length;
  const done = counts.done ?? 0;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const openRisks = risks.filter((r) => !TERMINAL_CATEGORIES.has(r.status.category));

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
        <Panel className="flex items-start justify-between gap-6 p-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <HealthBadge health={project.health} />
              <Badge>{labelFor(project.status)}</Badge>
            </div>
            <p className="mt-3 max-w-2xl text-body-sm text-ink-muted">{project.description ?? "No description yet."}</p>
          </div>
          <dl className="grid shrink-0 grid-cols-3 gap-6 text-caption">
            <div>
              <dt className="text-ink-tertiary">Start</dt>
              <dd className="text-ink">{project.startDate ? fmtDate(project.startDate, "d MMM yyyy") : "—"}</dd>
            </div>
            <div>
              <dt className="text-ink-tertiary">Target</dt>
              <dd className="text-ink">{project.targetDate ? fmtDate(project.targetDate, "d MMM yyyy") : "—"}</dd>
            </div>
            <div>
              <dt className="text-ink-tertiary">Progress</dt>
              <dd className="text-ink">
                {done}/{total} · {pct}%
              </dd>
            </div>
          </dl>
        </Panel>

        <div className="grid grid-cols-4 gap-3">
          <Stat
            label="Overdue"
            value={attention.counts.task_overdue}
            tone={attention.counts.task_overdue ? "danger" : "muted"}
          />
          <Stat
            label="Late dependencies"
            value={attention.counts.dependency_late}
            tone={attention.counts.dependency_late ? "warn" : "muted"}
          />
          <Stat
            label="Blocked"
            value={attention.counts.task_blocked}
            tone={attention.counts.task_blocked ? "warn" : "muted"}
          />
          <Stat
            label="Top risks"
            value={attention.counts.risk_top}
            tone={attention.counts.risk_top ? "danger" : "muted"}
          />
        </div>

        <div className="grid grid-cols-3 gap-6">
          <div className="col-span-2 flex flex-col gap-6">
            <section className="flex flex-col gap-3">
              <SectionTitle>Needs attention</SectionTitle>
              <ImpactAlerts alerts={alerts} projectId={projectId} />
              <ProposalCards
                proposals={proposals}
                items={refs && { list: items, refs }}
                projectId={projectId}
                sourceLabels={sourceLabels}
              />
              {/* "Nothing needs attention" would contradict the alerts and Proposals just above it. */}
              {(attention.groups.length > 0 || !(alerts.length || proposals.length || items.length)) && (
                <AttentionList result={attention} />
              )}
            </section>

            <section>
              <SectionTitle className="mb-2">Milestones</SectionTitle>
              <Panel className="divide-y divide-hairline">
                {milestones.length === 0 && (
                  <p className="px-4 py-6 text-center text-caption text-ink-subtle">
                    No milestones yet. Add them from the Timeline.
                  </p>
                )}
                {milestones.map(({ milestone, status }) => {
                  const mTasks = tasks.filter((x) => x.task.milestoneId === milestone.id);
                  const mDone = mTasks.filter((x) => x.status.category === "done").length;
                  const due = dueLabel(milestone.dueDate, TERMINAL_CATEGORIES.has(status.category));
                  return (
                    <Link
                      key={milestone.id}
                      href={`${base}/timeline?milestone=${milestone.id}`}
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2"
                    >
                      <Diamond className="size-3.5" style={{ color: status.color }} fill={status.color} />
                      <span className="min-w-0 flex-1 truncate text-body-sm text-ink">{milestone.name}</span>
                      <span className="text-caption text-ink-tertiary">
                        {mDone}/{mTasks.length} tasks
                      </span>
                      <Badge color={status.color}>{status.name}</Badge>
                      <span
                        className={cn(
                          "w-24 text-right text-caption",
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

            <section>
              <SectionTitle className="mb-2">Open risks</SectionTitle>
              <Panel className="divide-y divide-hairline">
                {openRisks.length === 0 && (
                  <p className="px-4 py-6 text-center text-caption text-ink-subtle">No open risks.</p>
                )}
                {openRisks
                  .sort((a, b) => riskSeverity(b.risk) - riskSeverity(a.risk))
                  .slice(0, 5)
                  .map(({ risk, status, owner }) => {
                    const sev = riskSeverity(risk);
                    return (
                      <Link
                        key={risk.id}
                        href={`${base}/risks?risk=${risk.id}`}
                        className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2"
                      >
                        <AlertTriangle
                          className={cn(
                            "size-3.5",
                            sev >= RISK_TOP_SEVERITY
                              ? "text-tag-red"
                              : sev >= RISK_MID_SEVERITY
                                ? "text-tag-orange"
                                : "text-ink-subtle",
                          )}
                        />
                        <span className="font-mono text-caption text-ink-tertiary">R-{risk.number}</span>
                        <span className="min-w-0 flex-1 truncate text-body-sm text-ink">{risk.title}</span>
                        <Avatar name={owner?.name} size="xs" />
                        <Badge>
                          {labelFor(risk.probability)} / {labelFor(risk.impact)}
                        </Badge>
                        <Badge color={status.color}>{status.name}</Badge>
                      </Link>
                    );
                  })}
              </Panel>
            </section>
          </div>

          <section>
            <SectionTitle className="mb-2">Recent changes</SectionTitle>
            <Panel className="px-4">
              {activity.length === 0 ? (
                <p className="py-6 text-center text-caption text-ink-subtle">No activity yet.</p>
              ) : (
                <ul className="divide-y divide-hairline/60">
                  {activity.map((a) => (
                    <ActivityRow key={a.event.id} item={a} />
                  ))}
                </ul>
              )}
            </Panel>
          </section>
        </div>
      </div>
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
