import { Suspense } from "react";
import { AuthForm } from "@/features/auth/auth-form";
import { googleAuthEnabled } from "@/server/auth/google";

export const metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <Suspense>
      <AuthForm mode="login" google={googleAuthEnabled} />
    </Suspense>
  );
}
