"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { setToolPermissionsAction } from "@/server/modules/assistant/actions";
import type { ToolGroup } from "@/shared/lib/assistant-tools";
import { Panel, Switch } from "@/shared/ui";

/**
 * Every approvable write tool in a scope, grouped by entity type (ADR 0011).
 * Each row has a yes/no switch; the group header switch turns the whole group on or off.
 * A granted tool no longer asks in the Assistant panel - its calls show "auto-approved".
 */
export function AssistantPermissions({
  projectId,
  groups,
  permissions,
}: {
  projectId: string | null;
  groups: ToolGroup[];
  permissions: string[];
}) {
  const router = useRouter();
  const [granted, setGranted] = React.useState(() => new Set(permissions));
  const [pending, setPending] = React.useState(false);
  const [prevPermissions, setPrevPermissions] = React.useState(permissions);
  if (prevPermissions !== permissions) {
    setPrevPermissions(permissions);
    setGranted(new Set(permissions));
  }

  const setMany = async (names: string[], allowed: boolean) => {
    setPending(true);
    setGranted((prev) => {
      const next = new Set(prev);
      for (const n of names) {
        if (allowed) next.add(n);
        else next.delete(n);
      }
      return next;
    });
    const res = await setToolPermissionsAction({ projectId, toolNames: names, allowed });
    if (!res.ok) setGranted(new Set(permissions));
    setPending(false);
    router.refresh();
  };

  const grouped = groups.filter((g) => g.tools.length > 1);
  const singles = groups.filter((g) => g.tools.length === 1).flatMap((g) => g.tools);

  const row = (tool: ToolGroup["tools"][number]) => (
    <li key={tool.name} className="flex items-center justify-between gap-3">
      <span className="min-w-0 text-body-sm text-ink-muted">
        {tool.label} <span className="text-ink-faint font-mono text-[11px]">{tool.name}</span>
      </span>
      <Switch
        checked={granted.has(tool.name)}
        disabled={pending}
        onChange={(v) => void setMany([tool.name], v)}
        label={tool.name}
      />
    </li>
  );

  return (
    <Panel className="divide-y divide-hairline/60">
      {grouped.map((group) => {
        const names = group.tools.map((t) => t.name);
        const allOn = names.every((n) => granted.has(n));
        return (
          <div key={group.name} className="px-4 py-3">
            <div className="flex items-center justify-between">
              <p className="text-body-sm font-medium text-ink">{group.name}</p>
              <Switch
                checked={allOn}
                disabled={pending}
                onChange={(v) => void setMany(names, v)}
                label={`All ${group.name} tools`}
              />
            </div>
            <ul className="mt-2 space-y-1.5">{group.tools.map(row)}</ul>
          </div>
        );
      })}
      {singles.length > 0 && (
        <div className="px-4 py-3">
          <p className="text-body-sm font-medium text-ink">Other</p>
          <ul className="mt-2 space-y-1.5">{singles.map(row)}</ul>
        </div>
      )}
    </Panel>
  );
}
