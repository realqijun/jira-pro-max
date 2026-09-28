"use client";

import * as React from "react";
import type { ProjectRefs } from "@/server/modules/projects/refs";
import { useFieldError } from "@/shared/ui/action-form";

/** Toggleable Label chips that submit `labelIds` hidden inputs; works for Tasks and Evidence. */
export function LabelPicker({ labels, selected }: { labels: ProjectRefs["labels"]; selected: string[] }) {
  const [picked, setPicked] = React.useState<Set<string>>(new Set(selected));
  const error = useFieldError("labelIds");
  if (!labels.length) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-caption font-medium text-ink-subtle">Labels</span>
      <div className="flex flex-wrap gap-1.5">
        {labels.map((l) => {
          const on = picked.has(l.id);
          return (
            <button
              key={l.id}
              type="button"
              onClick={() =>
                setPicked((s) => {
                  const n = new Set(s);
                  if (n.has(l.id)) n.delete(l.id);
                  else n.add(l.id);
                  return n;
                })
              }
              className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-caption transition-colors"
              style={{
                borderColor: on ? l.color : "var(--color-hairline)",
                color: on ? "var(--color-ink)" : "var(--color-ink-subtle)",
                background: on ? `${l.color}22` : "transparent",
              }}
            >
              <span className="size-1.5 rounded-full" style={{ background: l.color }} />
              {l.name}
            </button>
          );
        })}
      </div>
      {/* Always submit the key so clearing all labels works; the schema treats "" as an empty list. */}
      {picked.size === 0 ? (
        <input type="hidden" name="labelIds" value="" />
      ) : (
        [...picked].map((id) => <input key={id} type="hidden" name="labelIds" value={id} />)
      )}
      {error && <span className="text-caption text-tag-red">{error}</span>}
    </div>
  );
}
