"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import type { ActionResult } from "@/server/core/action";

/** One-click Accept and Reject on a Proposal card: which is pending, the error, and a refresh on success. */
export function useProposalTransition() {
  const router = useRouter();
  const [pending, setPending] = React.useState<"accept" | "reject" | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function run(kind: "accept" | "reject", fn: () => Promise<ActionResult<unknown>>) {
    setPending(kind);
    setError(null);
    const res = await fn();
    setPending(null);
    if (!res.ok) setError(res.error);
    else router.refresh();
  }

  return { pending, error, run };
}
