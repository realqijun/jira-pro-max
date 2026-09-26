import { Loader2 } from "lucide-react";
import * as React from "react";
import { cn } from "@/shared/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "tertiary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "icon";

const variants: Record<ButtonVariant, string> = {
  primary:
    "bg-primary text-on-primary shadow-[0_6px_18px_rgb(94_106_210_/_0.2)] hover:bg-primary-hover hover:shadow-[0_8px_24px_rgb(94_106_210_/_0.38)] active:bg-primary-focus",
  secondary:
    "bg-surface-1 text-ink border border-hairline hover:bg-surface-2 hover:border-hairline-strong hover:shadow-[0_6px_18px_rgb(0_0_0_/_0.2)]",
  tertiary: "bg-transparent text-ink hover:bg-surface-2",
  ghost: "bg-transparent text-ink-subtle hover:text-ink hover:bg-surface-2",
  danger: "bg-transparent text-tag-red border border-hairline hover:bg-tag-red/10 hover:border-tag-red/40",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-caption gap-1.5",
  md: "h-8 px-3.5 text-body-sm gap-2",
  icon: "h-7 w-7 p-0 justify-center",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "secondary", size = "md", loading, disabled, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center rounded-md leading-none font-medium whitespace-nowrap transition-[transform,background-color,border-color,box-shadow,color] duration-200 select-none hover:-translate-y-px active:translate-y-0 disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {loading && <Loader2 className="size-3.5 animate-spin" />}
      {children}
    </button>
  );
});
