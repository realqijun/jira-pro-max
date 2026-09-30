"use client";

import * as React from "react";
import type { ActionResult } from "@/server/core/action";
import { cn } from "@/shared/lib/cn";
import { Button } from "./button";

type Action = (fd: FormData) => Promise<ActionResult<unknown> | undefined | void>;

interface Ctx {
  pending: boolean;
  error: string | null;
  fieldErrors: Record<string, string[]>;
}
const FormCtx = React.createContext<Ctx>({ pending: false, error: null, fieldErrors: {} });
export const useActionForm = () => React.useContext(FormCtx);

/**
 * Form wrapper around a server action returning ActionResult. Handles pending state,
 * surfaces field/form errors, and calls onSuccess (e.g. to close a dialog).
 */
export function ActionForm({
  action,
  onSuccess,
  children,
  submitLabel = "Save",
  cancel,
  className,
  hidden = {},
  danger,
  footerStart,
  formRef,
  submitDisabled,
}: {
  action: Action;
  onSuccess?: (data: unknown) => void;
  children: React.ReactNode;
  submitLabel?: string;
  cancel?: () => void;
  className?: string;
  /** Hidden inputs (ids etc). */
  hidden?: Record<string, string | undefined>;
  danger?: boolean;
  /** Rendered at the left of the footer row, opposite Cancel/Submit (e.g. a Delete button). */
  footerStart?: React.ReactNode;
  formRef?: React.Ref<HTMLFormElement>;
  /** Blocks submitting while the caller has other work in flight. */
  submitDisabled?: boolean;
}) {
  const [state, setState] = React.useState<Ctx>({ pending: false, error: null, fieldErrors: {} });

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitDisabled) return;
    const fd = new FormData(e.currentTarget);
    setState({ pending: true, error: null, fieldErrors: {} });
    try {
      const res = await action(fd);
      // A redirecting action resolves without a result; the router already navigated.
      if (!res) {
        setState({ pending: false, error: null, fieldErrors: {} });
        onSuccess?.(undefined);
        return;
      }
      if (!res.ok) return setState({ pending: false, error: res.error, fieldErrors: res.fieldErrors ?? {} });
      setState({ pending: false, error: null, fieldErrors: {} });
      onSuccess?.(res.data);
    } catch (err) {
      // redirect() throws a special error that Next handles; anything else is real.
      if (err instanceof Error && "digest" in err && String(err.digest).startsWith("NEXT_REDIRECT")) throw err;
      setState({ pending: false, error: "Something went wrong. Please try again.", fieldErrors: {} });
    }
  }

  return (
    <FormCtx.Provider value={state}>
      <form ref={formRef} onSubmit={onSubmit} className={cn("flex flex-col gap-4", className)}>
        {Object.entries(hidden).map(([k, v]) => v !== undefined && <input key={k} type="hidden" name={k} value={v} />)}
        {children}
        {state.error && (
          <p
            role="alert"
            className="rounded-md border border-tag-red/30 bg-tag-red/10 px-3 py-2 text-caption text-tag-red"
          >
            {state.error}
          </p>
        )}
        <div className="flex items-center justify-end gap-2 pt-1">
          {footerStart && <div className="mr-auto flex items-center">{footerStart}</div>}
          {cancel && (
            <Button type="button" variant="ghost" onClick={cancel}>
              Cancel
            </Button>
          )}
          <Button
            type="submit"
            variant={danger ? "danger" : "primary"}
            loading={state.pending}
            disabled={submitDisabled}
          >
            {submitLabel}
          </Button>
        </div>
      </form>
    </FormCtx.Provider>
  );
}

/** Reads the first validation error for a field from the enclosing ActionForm. */
export function useFieldError(name: string) {
  return useActionForm().fieldErrors[name]?.[0];
}
