// The Renders E2E app process (playwright.renders.config.ts). Both external calls a draft and a
// generation make - the Assistant model and the image provider - go to a stub the spec runs on
// port 3102, and every other outbound service is switched off, so no test text leaves the machine.
import http from "node:http";
import next from "next";

const STUB = "http://localhost:3102";
Object.assign(process.env, {
  NEXT_DIST_DIR: ".next/renders",
  BETTER_AUTH_URL: "http://localhost:3002",
  // Never the database in .env, which may be a shared one.
  DATABASE_URL: process.env.RENDERS_E2E_DATABASE_URL || "postgres://pm:pm@localhost:5433/pm",
  POLLINATIONS_API_KEY: "sk_e2e",
  POLLINATIONS_BASE_URL: `${STUB}/image`,
  AI_PROVIDER: "openai",
  AI_MODEL: "gpt-4o-mini",
  OPENAI_API_KEY: "sk-e2e",
  OPENAI_BASE_URL: `${STUB}/v1`,
  AI_EMBEDDING_PROVIDER: "openai",
  PROPOSALS_EXTRACTOR: "heuristic",
  // Pre-set empty values survive Next's .env loader, so these stay off.
  LITEPRUNER_API_KEY: "",
  GEMINI_API_KEY: "",
  ANTHROPIC_API_KEY: "",
  GOOGLE_GENERATIVE_AI_API_KEY: "",
  AI_API_KEY: "",
  AI_BASE_URL: "",
  NEXT_PUBLIC_POSTHOG_KEY: "",
});
// The disabled picker: no Assistant model at all.
if (process.env.RENDERS_E2E_NO_MODEL) Object.assign(process.env, { OPENAI_API_KEY: "", AI_MODEL: "" });

const app = next({ dev: true, port: 3002, hostname: "localhost" });
await app.prepare();
http.createServer(app.getRequestHandler()).listen(3002, "localhost");
