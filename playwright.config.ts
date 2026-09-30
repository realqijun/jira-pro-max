import { defineConfig } from "@playwright/test";

const port = process.env.E2E_PORT ?? "3000";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/warmup.ts",
  // CI's dev server compiles lazily. The warm-up covers pages; route handlers and server actions
  // still compile on first use, which alone can outlast the defaults.
  timeout: process.env.CI ? 60_000 : 30_000,
  expect: { timeout: process.env.CI ? 15_000 : 5_000 },
  retries: 0,
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  // Assumes `npm run dev` (or `npm start`) is already serving on E2E_PORT.
  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : {
        command: "npm run dev",
        url: `http://localhost:${port}/login`,
        reuseExistingServer: true,
        timeout: 60_000,
        // The proposal flows assert exact Proposals; the heuristic extractor is the deterministic one.
        env: { PROPOSALS_EXTRACTOR: process.env.PROPOSALS_EXTRACTOR ?? "heuristic" },
      },
});
