import { Suspense } from "react";
import { OAuthComplete } from "@/features/auth/oauth-complete";

export const metadata = { title: "Signing in" };

export default function OAuthCompletePage() {
  return (
    <Suspense>
      <OAuthComplete />
    </Suspense>
  );
}
