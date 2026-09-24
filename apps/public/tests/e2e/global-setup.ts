import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

// Seeded below rather than read from env vars, so `pnpm test:e2e` works unconfigured.
export const E2E_MEMBER = {
  email: "e2e-member@example.test",
  password: "e2e-only-password",
  name: "E2E Member",
};

// Resolved from this file, not the cwd: `playwright test --config apps/public/...` run from the
// repo root would otherwise point wrangler at paths that do not exist.
const appDir = path.join(import.meta.dirname, "../..");
const adminDir = path.join(appDir, "../admin");
const migrationsDir = path.join(appDir, "../../packages/schema/migrations");
// The store the dev server opens (astro.config.mjs `persistState`).
const persist = ["--persist-to", path.join(appDir, "../../.wrangler-state")];

// Run from apps/admin: its wrangler.jsonc owns the shared database (migrations_dir), and the
// seeder lives alongside it.
function runInAdmin(command: string, args: string[]) {
  const result = spawnSync(command, args, { stdio: "inherit", cwd: adminDir });
  if (result.status !== 0) throw new Error(`E2E setup failed: ${command} ${args.join(" ")}`);
}

// One statement per call. wrangler aborts the whole command at the first error, so a multi
// statement teardown that trips a foreign key leaves the rest unrun — and the next run then fails
// on the debris the failed one left behind.
function execEach(statements: string[]) {
  for (const sql of statements) {
    runInAdmin("npx", ["wrangler", "d1", "execute", "DB", "--local", ...persist, "--command", sql]);
  }
}

export default function globalSetup() {
  if (!existsSync(migrationsDir)) {
    throw new Error("No D1 migrations found. Run `pnpm db:generate` from the repo root first.");
  }

  runInAdmin("npx", ["wrangler", "d1", "migrations", "apply", "DB", "--local", ...persist]);

  // Drop only this account, so a developer's own data survives a test run. Nothing referencing
  // members has ON DELETE CASCADE, so every child goes first — the reset-token row is the one the
  // password-reset specs leave behind.
  const email = E2E_MEMBER.email.replaceAll("'", "''");
  const owned = `member_id IN (SELECT id FROM members WHERE email = '${email}')`;

  execEach([`DELETE FROM member_sessions WHERE ${owned}`, `DELETE FROM member_password_reset_tokens WHERE ${owned}`, `DELETE FROM memberships WHERE ${owned}`, `DELETE FROM members WHERE email = '${email}'`]);

  runInAdmin("pnpm", ["seed", "--", "--table=members", `--email=${E2E_MEMBER.email}`, `--password=${E2E_MEMBER.password}`, `--name=${E2E_MEMBER.name}`]);
}
