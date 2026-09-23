"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { authenticationCompleted } from "@/shared/analytics/browser";
import { signIn, signUp } from "@/shared/lib/auth-client";
import { startTour } from "@/shared/lib/tour";
import { Button, Field, Input } from "@/shared/ui";

/** Only same-origin absolute paths; rejects `//host`, `javascript:` and anything else attacker-controlled. */
function safeReturnPath(next: string | null) {
  return next && /^\/(?!\/)/.test(next) ? next : "/dashboard";
}

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
    if (mode === "signup") startTour();
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
      <Button type="submit" variant="primary" loading={loading} className="mt-1 justify-center">
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
