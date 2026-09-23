"use client";

import { cn } from "@/shared/lib/cn";

/** A yes/no switch. `label` names the thing being switched for screen readers. */
export function Switch({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50",
        checked ? "bg-primary" : "border border-hairline bg-surface-3",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 left-0.5 size-4 rounded-full bg-ink transition-transform",
          checked && "translate-x-4",
        )}
      />
    </button>
  );
}
