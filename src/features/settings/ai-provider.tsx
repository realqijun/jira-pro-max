"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  discoverAiModelsAction,
  removeAiConfigAction,
  saveAiConfigAction,
  setDefaultAiConfigAction,
} from "@/server/modules/ai-config/actions";
import type { AiConfigSummary } from "@/server/modules/ai-config/service";
import { AI_PROVIDER_LABELS, type AiProvider as AiProviderName } from "@/shared/domain";
import { ActionForm, Badge, Button, Panel, SelectField, TextField } from "@/shared/ui";

const providers = Object.entries(AI_PROVIDER_LABELS).map(([value, label]) => ({ value, label }));

export function AiProvider({ configs }: { configs: AiConfigSummary[] }) {
  const router = useRouter();
  const formRef = React.useRef<HTMLFormElement>(null);
  const [editing, setEditing] = React.useState<AiConfigSummary | null>(null);
  const [provider, setProvider] = React.useState<AiProviderName>("openai");
  const [model, setModel] = React.useState("");
  const [availableModels, setAvailableModels] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [discovering, setDiscovering] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const startEdit = (config: AiConfigSummary | null) => {
    setEditing(config);
    setProvider(config?.provider ?? "openai");
    setModel(config?.model ?? "");
    setAvailableModels([]);
    setError(null);
  };

  const run = async (action: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Something went wrong. Please try again.");
      return;
    }
    router.refresh();
  };

  const discover = async () => {
    if (!formRef.current) return;
    setDiscovering(true);
    setError(null);

    const result = await discoverAiModelsAction(new FormData(formRef.current));
    setDiscovering(false);

    if (!result.ok) {
      setAvailableModels([]);
      setError(result.error);
      return;
    }

    const found = result.data;
    setAvailableModels(found);
    setModel((current) => (found.includes(current) ? current : (found[0] ?? "")));

    if (!found.length) {
      setError("The provider returned no text-generation models for this key.");
    }
  };

  const modelOptions = [
    ...(editing && !availableModels.includes(editing.model)
      ? [{ value: editing.model, label: `${editing.model} (saved - check availability)` }]
      : []),
    ...availableModels.map((value) => ({ value, label: value })),
  ];

  return (
    <div className="flex flex-col gap-3">
      {configs.length > 0 && (
        <Panel className="divide-y divide-hairline">
          {configs.map((config) => (
            <div key={config.id} className="flex items-center gap-2 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-body-sm text-ink">
                  {AI_PROVIDER_LABELS[config.provider]} · {config.model}
                </p>
                {config.baseUrl && <p className="truncate text-caption text-ink-subtle">{config.baseUrl}</p>}
              </div>
              {config.isDefault && <Badge>Default</Badge>}
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => startEdit(config)}>
                Edit
              </Button>
              {!config.isDefault && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void run(() => setDefaultAiConfigAction({ id: config.id }))}
                >
                  Make default
                </Button>
              )}
              <Button
                size="sm"
                variant="danger"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const result = await removeAiConfigAction({ id: config.id });
                    if (result.ok && editing?.id === config.id) startEdit(null);
                    return result;
                  })
                }
              >
                Remove
              </Button>
            </div>
          ))}
        </Panel>
      )}
      <Panel className="p-5">
        <ActionForm
          key={editing?.id ?? "new"}
          action={saveAiConfigAction}
          submitLabel="Validate and save"
          onSuccess={() => {
            startEdit(null);
            router.refresh();
          }}
          cancel={editing ? () => startEdit(null) : undefined}
          formRef={formRef}
          hidden={{ id: editing?.id ?? undefined, configId: editing?.id ?? undefined }}
          footerStart={
            <Button type="button" loading={discovering} onClick={() => void discover()}>
              Check available models
            </Button>
          }
        >
          <p className="text-body-sm font-medium text-ink">{editing ? "Edit configuration" : "New configuration"}</p>
          <SelectField
            name="provider"
            label="Provider"
            options={providers}
            value={provider}
            onChange={(event) => {
              setProvider(event.target.value as AiProviderName);
              setModel(editing?.provider === event.target.value ? editing.model : "");
              setAvailableModels([]);
              setError(null);
            }}
          />
          <SelectField
            name="model"
            label="Model"
            required
            value={model}
            onChange={(event) => setModel(event.target.value)}
            options={modelOptions}
            placeholder="Check the provider to load available models"
            hint="Loaded directly from the provider for this API key."
          />
          {provider === "openai_compatible" && (
            <TextField
              name="baseUrl"
              label="Base URL"
              type="url"
              required
              defaultValue={editing?.baseUrl ?? ""}
              placeholder="https://api.example.com/v1"
              hint="Public HTTPS only. Redirects and private network addresses are blocked."
            />
          )}
          <TextField
            name="apiKey"
            label="API key"
            type="password"
            autoComplete="new-password"
            required={!editing}
            placeholder={editing ? "Leave blank to keep the stored key" : "Required"}
            hint={editing ? "A key is stored. Enter a new value only to replace it." : undefined}
          />
          <p className="text-caption text-ink-subtle">
            Checking models reads the provider&apos;s model catalog. Saving then makes a small generation request to
            validate access to the selected model, which may incur a minimal charge.
          </p>
          {error && (
            <p className="text-caption text-tag-red" role="alert">
              {error}
            </p>
          )}
        </ActionForm>
      </Panel>
      <p className="text-caption text-ink-subtle">
        The default configuration runs the Assistant, Reflection, and Proposal extraction unless a conversation picks
        another saved model. With no saved configuration the deployment&apos;s environment settings apply.
      </p>
    </div>
  );
}
