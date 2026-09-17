import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

// No account is seeded here: Playwright cannot pass Cloudflare Access, so the dev server signs
// requests in as DEV_ADMIN_EMAIL (wrangler.jsonc) and the ledger row is provisioned on the first
// request (D-022). Only the schema has to exist first.

// Resolved from this file, not the cwd: `playwright test --config apps/admin/...` run from the
// repo root would otherwise point wrangler at paths that do not exist.
const appDir = path.join(import.meta.dirname, "../..");
const migrationsDir = path.join(appDir, "../../packages/schema/migrations");
// The store the dev server opens (astro.config.mjs `persistState`).
const persist = ["--persist-to", path.join(appDir, "../../.wrangler-state")];

export default function globalSetup() {
  if (!existsSync(migrationsDir)) {
    throw new Error("No D1 migrations found. Run `pnpm db:generate` from the repo root first.");
  }

  const result = spawnSync("npx", ["wrangler", "d1", "migrations", "apply", "DB", "--local", ...persist], { stdio: "inherit", cwd: appDir });
  if (result.status !== 0) throw new Error("E2E setup failed: could not apply D1 migrations.");
}
