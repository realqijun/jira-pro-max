import { Suspense } from "react";
import { AuthForm } from "@/features/auth/auth-form";
import { googleAuthEnabled } from "@/server/auth/google";

export const metadata = { title: "Sign up" };

export default function SignupPage() {
  return (
    <Suspense>
      <AuthForm mode="signup" google={googleAuthEnabled} />
    </Suspense>
  );
}
