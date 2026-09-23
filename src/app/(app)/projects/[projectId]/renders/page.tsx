import { Suspense } from "react";
import { ctxForCurrentUser } from "@/server/core/action";
import { rendersService } from "@/server/modules/renders/service";
import { RendersView } from "@/features/renders/renders-view";

export const metadata = { title: "Renders" };

export default async function RendersPage({ params }: PageProps<"/projects/[projectId]/renders">) {
  const { projectId } = await params;
  const ctx = await ctxForCurrentUser();
  const items = await rendersService.list(ctx, projectId);
  return (
    <Suspense>
      <RendersView projectId={projectId} items={items} configured={rendersService.enabled()} />
    </Suspense>
  );
}
