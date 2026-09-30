import { request, type FullConfig } from "@playwright/test";

/** Every page a spec visits; the dev server compiles each on first hit. */
const PAGES = ["/", "/login", "/signup", "/dashboard", "/projects", "/calendar", "/settings"];
const PROJECT_TABS = [
  "",
  "/tasks",
  "/timeline",
  "/calendar",
  "/risks",
  "/decisions",
  "/evidence",
  "/renders",
  "/people",
  "/messages",
  "/graph",
  "/settings",
];

/**
 * On CI the dev server starts cold and compiles each route on its first request, which can
 * outlast a spec's wait. Visit every page once as the seeded demo User before the suite runs.
 */
export default async function warmup(config: FullConfig) {
  if (!process.env.CI) return;
  const baseURL = config.projects[0]!.use.baseURL!;
  const api = await request.newContext({ baseURL, timeout: 180_000 });
  const signIn = await api.post("/api/auth/sign-in/email", {
    data: {
      email: process.env.DEMO_EMAIL ?? "demo@example.com",
      password: process.env.DEMO_PASSWORD ?? "demo-password-123",
    },
  });
  if (!signIn.ok()) throw new Error(`Warm-up sign-in failed: ${signIn.status()}`);
  for (const path of PAGES) await api.get(path);
  const projectId = (await (await api.get("/projects")).text()).match(/\/projects\/([0-9a-f-]{36})/)?.[1];
  if (!projectId) throw new Error("Warm-up found no seeded Project; run `npm run db:seed`");
  for (const tab of PROJECT_TABS) await api.get(`/projects/${projectId}${tab}`);
  await api.dispose();
}
