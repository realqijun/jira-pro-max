import { ctxForCurrentUser } from "@/server/core/action";
import { requireUser } from "@/server/auth/session";
import { aiConfigService } from "@/server/modules/ai-config/service";
import { apiTokensService } from "@/server/modules/api-tokens/service";
import { assistantService } from "@/server/modules/assistant/service";
import { memoryService } from "@/server/modules/memory/service";
import { WORKSPACE_TOOL_GROUPS } from "@/shared/lib/assistant-tools";
import { PageHeader, SectionTitle } from "@/shared/ui";
import { MemoryEditor } from "@/features/memory/memory-editor";
import { ApiTokens } from "@/features/settings/api-tokens";
import { AiProvider } from "@/features/settings/ai-provider";
import { AssistantPermissions } from "@/features/settings/assistant-permissions";
import { ProductTourSetting } from "@/features/settings/product-tour";

export const metadata = { title: "Settings" };

export default async function UserSettingsPage() {
  const [ctx, user] = await Promise.all([ctxForCurrentUser(), requireUser()]);
  const [versions, tokens, permissions, aiConfigs] = await Promise.all([
    memoryService.versions(ctx, null),
    apiTokensService.list(ctx),
    assistantService.permissions(ctx, null),
    aiConfigService.list(ctx),
  ]);
  const endpoint = `${process.env.BETTER_AUTH_URL ?? "http://localhost:3000"}/api/mcp`;
  return (
    <>
      <PageHeader title="Settings" />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-10 p-6">
          <section className="flex flex-col gap-4">
            <SectionTitle>Assistant</SectionTitle>
            <div>
              <h3 className="text-body-sm font-medium text-ink">Provider</h3>
              <p className="mt-1 text-caption text-ink-subtle">
                Save provider credentials for Assistant conversations, Reflection, and Proposal extraction. Keys are
                encrypted and are never sent back to your browser.
              </p>
            </div>
            <AiProvider configs={aiConfigs} />
            <div>
              <h3 className="text-body-sm font-medium text-ink">Profile</h3>
              <p className="mt-1 text-caption text-ink-subtle">
                How you work: tone, cadence, defaults. The Assistant reads this on every turn, in every Project.
                Reflection revises it after your conversations; every version is kept below.
              </p>
            </div>
            <MemoryEditor
              projectId={null}
              versions={versions}
              placeholder="Always assign new tasks to me. Default to two-week milestones. Keep summaries short."
              hint="Markdown. Roughly 2,000 tokens at most."
            />
            <div>
              <h3 className="text-body-sm font-medium text-ink">Dashboard permissions</h3>
              <p className="mt-1 text-caption text-ink-subtle">
                Write tools the Assistant may run on the dashboard without asking. Project tools are switched per
                Project under that Project&apos;s settings.
              </p>
            </div>
            <AssistantPermissions projectId={null} groups={WORKSPACE_TOOL_GROUPS} permissions={permissions} />
          </section>

          <section className="flex flex-col gap-4">
            <SectionTitle>Guided tour</SectionTitle>
            <ProductTourSetting userEmail={user.email} />
          </section>

          <section className="flex flex-col gap-4">
            <SectionTitle>API tokens</SectionTitle>
            <p className="text-caption text-ink-subtle">
              Let an MCP client such as Claude Desktop or Cursor drive your Projects. Each token acts as you; changes
              show in History via Assistant. Destructive tools are not offered over MCP.
            </p>
            <ApiTokens tokens={tokens} endpoint={endpoint} />
          </section>
        </div>
      </div>
    </>
  );
}
