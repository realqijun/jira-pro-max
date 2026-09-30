import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "renders-draft.spec.ts",
  workers: 1,
  timeout: 120_000,
  use: {
    baseURL: "http://localhost:3002",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node e2e/renders-server.mjs",
    url: "http://localhost:3002/login",
    // The server's environment decides which tests run, so it is never one left over.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
