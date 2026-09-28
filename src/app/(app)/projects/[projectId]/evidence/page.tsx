import { Suspense } from "react";
import { ctxForCurrentUser } from "@/server/core/action";
import { evidenceService } from "@/server/modules/evidence/service";
import { loadProjectRefs } from "@/server/modules/projects/refs";
import { EvidenceView } from "@/features/evidence/evidence-view";

export const metadata = { title: "Evidence" };

export default async function EvidencePage({ params, searchParams }: PageProps<"/projects/[projectId]/evidence">) {
  const { projectId } = await params;
  const { item } = await searchParams;
  const ctx = await ctxForCurrentUser();
  const [refs, items, targets, evidenceLabels] = await Promise.all([
    loadProjectRefs(ctx, projectId),
    evidenceService.list(ctx, projectId),
    evidenceService.listLinkTargets(ctx, projectId),
    evidenceService.labelPairs(ctx, projectId),
  ]);
  // Passages of the selected item only (the view defaults to the first item when `?item` is absent).
  const selectedId = (typeof item === "string" && items.some((e) => e.id === item) ? item : items[0]?.id) ?? null;
  const passages = selectedId ? await evidenceService.passages(ctx, selectedId) : [];
  return (
    <Suspense>
      <EvidenceView refs={refs} items={items} targets={targets} passages={passages} evidenceLabels={evidenceLabels} />
    </Suspense>
  );
}
