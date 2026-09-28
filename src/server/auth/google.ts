/**
 * Google sign-in is on only when both credentials are set, so local development and CI boot
 * without a Google Cloud project. Kept apart from `auth.ts` so the login and signup pages can
 * read it without importing the database. Those pages are prerendered, so the button follows
 * the environment of the build; on Vercel an env change needs a redeploy either way.
 */
export const googleAuthEnabled = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
