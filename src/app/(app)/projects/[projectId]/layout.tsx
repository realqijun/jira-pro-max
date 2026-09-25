import { notFound } from "next/navigation";
import { getViewer } from "@/server/auth/viewer";
import { ctxForCurrentUser } from "@/server/core/action";
import { DomainError } from "@/server/core/errors";
import { aiConfigService } from "@/server/modules/ai-config/service";
import { getModel } from "@/server/modules/assistant/model";
import { assistantService } from "@/server/modules/assistant/service";
import { projectsService } from "@/server/modules/projects/service";
import { AssistantDock } from "@/widgets/assistant/assistant-dock";
import { ProjectHeader } from "@/widgets/project-header/project-header";

export default async function ProjectLayout({ children, params }: LayoutProps<"/projects/[projectId]">) {
  const { projectId } = await params;
  // A Participant gets the bare page (ADR 0009). Everything below this line is the PM's:
  // `projectsService.get` would refuse them, and the Assistant dock is the chrome the ADR
  // forbids a Participant outright.
  const viewer = await getViewer();
  if (viewer?.kind === "participant") return <>{children}</>;
  const ctx = await ctxForCurrentUser();
  const project = await projectsService.get(ctx, projectId).catch((e) => {
    if (e instanceof DomainError) notFound();
    throw e;
  });
  const [dock, projects, aiConfigs] = await Promise.all([
    assistantService.dock(ctx, projectId),
    projectsService.list(ctx),
    aiConfigService.list(ctx),
  ]);
  const conversations = await assistantService.library(ctx, dock.thread.conversation.id);
  return (
    <>
      <ProjectHeader project={project} />
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
        <AssistantDock
          projectId={projectId}
          projects={projects}
          conversations={conversations}
          thread={dock.thread}
          configured={getModel() !== null || aiConfigs.length > 0}
        />
      </div>
    </>
  );
}
