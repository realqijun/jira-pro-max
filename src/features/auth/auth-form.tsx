"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { authenticationCompleted } from "@/shared/analytics/browser";
import { signIn, signUp } from "@/shared/lib/auth-client";
import { startTour } from "@/shared/lib/tour";
import { Button, Field, Input } from "@/shared/ui";
import { GoogleIcon } from "./google-icon";
import { clearOAuthPending, markOAuthPending } from "./oauth-pending";
import { safeReturnPath } from "./return-path";

/** Better Auth sends a failed Google sign-in back with `?error=<code>`; these are the ones a User can act on. */
const OAUTH_ERRORS: Record<string, string> = {
  account_not_linked: "An account with this email already exists. Sign in with your password instead.",
  unable_to_link_account: "An account with this email already exists. Sign in with your password instead.",
  access_denied: "Google sign-in was cancelled.",
  state_not_found: "Google sign-in took too long. Try again.",
  state_mismatch: "Google sign-in took too long. Try again.",
};

export function AuthForm({ mode, google }: { mode: "login" | "signup"; google: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const oauthError = params.get("error");
  const [error, setError] = useState<string | null>(
    oauthError ? (OAUTH_ERRORS[oauthError] ?? "Google sign-in failed. Try again.") : null,
  );
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  // Being on this form means any Google sign-in this tab started has ended, including one the
  // User backed out of: the browser can restore this page from its cache with the spinner still
  // on, and without clearing the marker a later visit to `/auth/complete` would still honour it.
  useEffect(() => {
    clearOAuthPending();
    const onPageShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      clearOAuthPending();
      setGoogleLoading(false);
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  async function onGoogle() {
    setError(null);
    setGoogleLoading(true);
    markOAuthPending();
    const next = params.get("next");
    const complete = new URLSearchParams(next ? { next } : {});
    const res = await signIn.social({
      provider: "google",
      callbackURL: `/auth/complete?${complete}`,
      newUserCallbackURL: `/auth/complete?${new URLSearchParams({ ...Object.fromEntries(complete), new: "1" })}`,
      errorCallbackURL: `/${mode}${next ? `?${new URLSearchParams({ next })}` : ""}`,
    });
    // Success navigates away to Google, so only a failure to start comes back here.
    if (res.error) {
      clearOAuthPending();
      setGoogleLoading(false);
      setError(res.error.message ?? "Google sign-in failed. Try again.");
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email"));
    const password = String(fd.get("password"));
    const res =
      mode === "login"
        ? await signIn.email({ email, password })
        : await signUp.email({ email, password, name: String(fd.get("name")) });
    setLoading(false);
    if (res.error) return setError(res.error.message ?? "Something went wrong");
    if (res.data?.user.id) authenticationCompleted(res.data.user.id, mode === "signup");
    // Signing up is the only thing that starts the tour, so signing in to an existing account
    // never does. Switch it back on in Settings to run it again.
    if (mode === "signup") startTour(email);
    router.push(safeReturnPath(params.get("next")));
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div>
        <h1 className="text-card-title font-medium">{mode === "login" ? "Sign in" : "Create your account"}</h1>
        <p className="mt-1 text-caption text-ink-subtle">
          {mode === "login" ? "Welcome back." : "Start managing projects with a memory."}
        </p>
      </div>
      {google && (
        <>
          <Button
            type="button"
            loading={googleLoading}
            disabled={loading}
            onClick={onGoogle}
            className="justify-center"
          >
            {!googleLoading && <GoogleIcon className="size-3.5" />}
            Continue with Google
          </Button>
          <div className="flex items-center gap-3 text-caption text-ink-subtle">
            <span className="h-px flex-1 bg-hairline" />
            or
            <span className="h-px flex-1 bg-hairline" />
          </div>
        </>
      )}
      {mode === "signup" && (
        <Field label="Name">
          <Input name="name" required autoComplete="name" placeholder="Ada Lovelace" />
        </Field>
      )}
      <Field label="Email">
        <Input name="email" type="email" required autoComplete="email" placeholder="you@company.com" />
      </Field>
      <Field label="Password" hint={mode === "signup" ? "At least 8 characters" : undefined}>
        <Input
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete={mode === "login" ? "current-password" : "new-password"}
        />
      </Field>
      {error && <p className="text-caption text-tag-red">{error}</p>}
      <Button
        type="submit"
        variant="primary"
        loading={loading}
        disabled={googleLoading}
        className="mt-1 justify-center"
      >
        {mode === "login" ? "Sign in" : "Create account"}
      </Button>
      <p className="text-center text-caption text-ink-subtle">
        {mode === "login" ? (
          <>
            No account?{" "}
            <Link href="/signup" className="text-ink hover:text-primary-hover">
              Sign up
            </Link>
          </>
        ) : (
          <>
            Have an account?{" "}
            <Link href="/login" className="text-ink hover:text-primary-hover">
              Sign in
            </Link>
          </>
        )}
      </p>
    </form>
  );
}
