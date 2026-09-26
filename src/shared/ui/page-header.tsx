import * as React from "react";
import { cn } from "@/shared/lib/cn";

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-16 shrink-0 items-center justify-between gap-4 hairline-b bg-canvas/90 px-6 backdrop-blur-sm",
        className,
      )}
    >
      <div className="flex min-w-0 items-baseline gap-3">
        <h1 className="truncate text-body font-medium text-ink">{title}</h1>
        {description && <p className="truncate text-caption text-ink-subtle">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center">
      {icon && <div className="text-ink-tertiary [&_svg]:size-8">{icon}</div>}
      <div>
        <p className="text-body-sm font-medium text-ink">{title}</p>
        {description && <p className="mt-1 max-w-sm text-caption text-ink-subtle">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function Panel({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("panel", className)} {...props}>
      {children}
    </div>
  );
}

export function SectionTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <h2 className={cn("text-eyebrow font-medium tracking-[0.4px] text-ink-subtle uppercase", className)}>{children}</h2>
  );
}
