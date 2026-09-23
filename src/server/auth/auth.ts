import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/server/db/client";
import { seedSampleProject } from "@/server/modules/onboarding/sample-project";
import * as authSchema from "./schema";

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema: authSchema }),
  emailAndPassword: { enabled: true },
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
