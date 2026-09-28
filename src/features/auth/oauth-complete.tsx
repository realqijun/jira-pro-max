"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { authenticationCompleted } from "@/shared/analytics/browser";
import { useSession } from "@/shared/lib/auth-client";
import { startTour } from "@/shared/lib/tour";
import { takeOAuthPending } from "./oauth-pending";
import { safeReturnPath } from "./return-path";

/**
 * Where Google sends the User back to. An OAuth sign-in leaves the page, so the steps the
 * email form runs after its own request resolves - analytics, and the tour for a new account -
 * run here once the session cookie is readable. `new=1` is set only by Better Auth's
 * `newUserCallbackURL`, so an existing account signing in never starts the tour. Both run only
 * when this tab started the sign-in (`oauth-pending.ts`); anyone else just gets redirected.
 */
export function OAuthComplete() {
  const router = useRouter();
  const params = useSearchParams();
  const { data, isPending } = useSession();
  const done = useRef(false);

  useEffect(() => {
    if (isPending || done.current) return;
    done.current = true;
    const next = safeReturnPath(params.get("next"));
    if (!data) return router.replace("/login");
    if (takeOAuthPending()) {
      const signup = params.get("new") === "1";
      authenticationCompleted(data.user.id, signup);
      if (signup) startTour(data.user.email);
    }
    router.replace(next);
    router.refresh();
  }, [data, isPending, params, router]);

  return <p className="text-center text-caption text-ink-subtle">Signing you in...</p>;
}
