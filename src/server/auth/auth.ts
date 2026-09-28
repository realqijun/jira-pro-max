import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/server/db/client";
import { seedSampleProject } from "@/server/modules/onboarding/sample-project";
import { googleAuthEnabled } from "./google";
import * as authSchema from "./schema";

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema: authSchema }),
  emailAndPassword: { enabled: true },
  // Google's first sign-in creates the User, which fires the sample Project hook below like
  // an email signup does. A Google login whose email already has a password account is refused
  // rather than linked: those emails are never verified, so linking would let whoever registered
  // the address first keep a way into the owner's account.
  socialProviders: googleAuthEnabled
    ? {
        google: {
          clientId: process.env.GOOGLE_CLIENT_ID!,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
          prompt: "select_account",
        },
      }
    : undefined,
  // An OAuth callback that fails before its own error URL is known (an expired or missing state,
  // say, after ten minutes on Google's account chooser) lands on the login form with `?error=`
  // instead of Better Auth's bare error page.
  onAPIError: { errorURL: "/login" },
  databaseHooks: {
    user: {
      create: {
        /**
         * Give the new User the sample Project (ADR 0013). Awaited rather than deferred to
         * `after()`: signup redirects straight to the dashboard, and a dashboard that is
         * empty on first paint and populated on the next one is worse than the delay.
         *
         * Never rethrows. A sample Project is a nicety; an account that could not be created
         * because of one is not, and the User can always make their own Project.
         */
        after: async (user) => {
          try {
            await seedSampleProject({ db, userId: user.id });
          } catch (e) {
            console.error(`Sample project could not be created for user ${user.id}`, e);
          }
        },
      },
    },
  },
  session: {
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
  plugins: [nextCookies()],
});

export type Session = typeof auth.$Infer.Session;
