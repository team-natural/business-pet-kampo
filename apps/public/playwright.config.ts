import { defineConfig } from "@playwright/test";

const baseURL = `http://localhost:${process.env.APP_PORT_DEV_PUBLIC ?? "5173"}`;

export default defineConfig({
  testDir: "tests/e2e",
  // A setup project is Playwright's recommendation, but it only pays off once the setup needs
  // a browser — this one shells out to wrangler.
  globalSetup: "./tests/e2e/global-setup.ts",
  // A stray test.only would otherwise let CI pass on a subset.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Serial. Every worker would share one dev server, one local D1 and the single member that
  // globalSetup seeds — so a logout test deletes the session a login test is still using, and the
  // failure lands on whichever ran second. Parallelism here buys seconds and costs a flake that
  // CI's retries would paper over.
  workers: 1,
  use: { baseURL, trace: "on-first-retry" },
  webServer: {
    command: "pnpm dev",
    // Astro 7 detaches `astro dev` for AI coding agents; Playwright then reports
    // "webServer exited early".
    env: { ASTRO_DEV_BACKGROUND: "0" },
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    // Switching branches changes the lockfile or astro.config, and Vite then re-optimizes
    // dependencies on the next boot — which exceeds the 60s default (00_DEV_GUIDE §6).
    timeout: 180_000,
  },
});
