import { defineConfig } from "@playwright/test";

const baseURL = `http://localhost:${process.env.APP_PORT_DEV_ADMIN ?? "5174"}`;

export default defineConfig({
  testDir: "tests/e2e",
  // A setup project is Playwright's recommendation, but it only pays off once the setup needs
  // a browser — this one shells out to wrangler.
  globalSetup: "./tests/e2e/global-setup.ts",
  // A stray test.only would otherwise let CI pass on a subset.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Serial, for the same reason as apps/public: one dev server over one local D1 (see that file).
  workers: 1,
  use: { baseURL, trace: "on-first-retry" },
  webServer: {
    // Migrate before the server boots, not in globalSetup: Playwright starts webServer first, and
    // every admin route queries D1 (D-022), so an unmigrated store answers 500 until the timeout.
    command: "pnpm db:migrate && pnpm dev",
    // Astro 7 detaches `astro dev` for AI coding agents; Playwright then reports
    // "webServer exited early".
    env: { ASTRO_DEV_BACKGROUND: "0" },
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    // Vite re-optimizes dependencies after a branch switch, which exceeds the 60s default
    // (00_DEV_GUIDE §6). The 2.5s startup delay in astro.config.mjs also counts against this.
    timeout: 180_000,
  },
});
