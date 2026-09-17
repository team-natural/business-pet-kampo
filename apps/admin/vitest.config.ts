import { existsSync } from "node:fs";
import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Bindings are declared inline rather than through `wrangler.configPath`: wrangler.jsonc's
// `main` is the Astro adapter entrypoint, which these tests never build. Keep them in sync.
// No KV and no R2 here — this app has neither (D-020, D-022).
const migrationsPath = path.join(import.meta.dirname, "../../packages/schema/migrations");

export default defineConfig(async () => ({
  plugins: [
    cloudflareTest({
      miniflare: {
        compatibilityDate: "2026-08-01",
        compatibilityFlags: ["nodejs_compat"],
        d1Databases: ["DB"],
        bindings: {
          TEST_MIGRATIONS: existsSync(migrationsPath) ? await readD1Migrations(migrationsPath) : [],
          APP_ENV: "development",
          ACCESS_TEAM_DOMAIN: "example.cloudflareaccess.com",
          ACCESS_AUD: "test-aud-tag",
          DEV_ADMIN_EMAIL: "dev-admin@example.test",
        },
      },
    }),
  ],
  // Mirrors tsconfig's paths: source files import through $lib, and vitest resolves modules
  // itself rather than through astro's config.
  resolve: { alias: { $lib: path.join(import.meta.dirname, "src/lib") } },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    setupFiles: ["./tests/setup.ts"],
  },
}));
