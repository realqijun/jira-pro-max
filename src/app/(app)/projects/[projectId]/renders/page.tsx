import { Suspense } from "react";
import { ctxForCurrentUser } from "@/server/core/action";
import { rendersService } from "@/server/modules/renders/service";
import { RendersView } from "@/features/renders/renders-view";

export const metadata = { title: "Renders" };

export default async function RendersPage({ params }: PageProps<"/projects/[projectId]/renders">) {
  const { projectId } = await params;
  const ctx = await ctxForCurrentUser();
  const [items, sources, canDraft] = await Promise.all([
    rendersService.list(ctx, projectId),
    rendersService.draftSources(ctx, projectId),
    rendersService.canDraft(ctx),
  ]);
  return (
    <Suspense>
      <RendersView
        projectId={projectId}
        items={items}
        configured={rendersService.enabled()}
        drafting={{ enabled: canDraft, sources }}
      />
    </Suspense>
  );
}
