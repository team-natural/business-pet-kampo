import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

// Seeded below rather than read from env vars, so `pnpm test:e2e` works unconfigured.
export const E2E_MEMBER = {
  email: "e2e-member@example.test",
  password: "e2e-only-password",
  name: "E2E Member",
};

// The seeded member belongs to `mine`; `other` exists only so a spec can ask for a shipping
// address that is real but someone else's. `org_code` is prefixed `E2E-` rather than `ORG-E2E`,
// which is what the admin suite's teardown matches — the two suites share one D1 and would
// otherwise delete each other's fixtures.
export const E2E_ORGANIZATIONS = {
  mine: { publicId: "01E2EORGMINE00000000000000", orgCode: "E2E-MINE" },
  other: { publicId: "01E2EORGOTHER0000000000000", orgCode: "E2E-OTHR" },
} as const;

// Belongs to `other`. Asking for it as the seeded member must answer 404, not 403 — 403 confirms
// the id exists (DEV-02 §3-1).
export const E2E_OTHER_ADDRESS = "01E2EADDROTHER000000000000";

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
  // Matched by shape, so an organization an earlier run left behind cannot collide with this one.
  const mine = `organization_id IN (SELECT id FROM organizations WHERE org_code LIKE 'E2E-%')`;

  execEach([
    `DELETE FROM member_sessions WHERE ${owned}`,
    `DELETE FROM member_password_reset_tokens WHERE ${owned}`,
    `DELETE FROM social_accounts WHERE ${owned}`,
    // Inwards along the foreign keys: everything pointing at the organizations goes before they do.
    `DELETE FROM cart_items WHERE ${mine}`,
    `DELETE FROM shipping_addresses WHERE ${mine}`,
    `DELETE FROM activity_log WHERE ${mine}`,
    `DELETE FROM memberships WHERE ${owned}`,
    `DELETE FROM memberships WHERE ${mine}`,
    `DELETE FROM members WHERE email = '${email}'`,
    `DELETE FROM organizations WHERE org_code LIKE 'E2E-%'`,
  ]);

  runInAdmin("pnpm", ["seed", "--", "--table=members", `--email=${E2E_MEMBER.email}`, `--password=${E2E_MEMBER.password}`, `--name=${E2E_MEMBER.name}`]);

  execEach([
    ...Object.values(E2E_ORGANIZATIONS).map(
      ({ publicId, orgCode }) => `INSERT INTO organizations (public_id, org_code, name, status, order_enabled, updated_at)
        VALUES ('${publicId}', '${orgCode}', 'E2E 取引先 ${orgCode}', 'active', 1, datetime('now'));`,
    ),
    // The seeder cannot do this: it creates a member, and the membership is what makes the
    // wholesale screens reachable at all.
    `INSERT INTO memberships (member_id, organization_id, role, status, joined_at, updated_at)
      SELECT m.id, o.id, 'client_user', 'active', datetime('now'), datetime('now')
      FROM members m, organizations o
      WHERE m.email = '${email}' AND o.public_id = '${E2E_ORGANIZATIONS.mine.publicId}';`,
    `INSERT INTO shipping_addresses (public_id, organization_id, recipient_name, postal_code, address, phone, is_default, updated_at)
      SELECT '${E2E_OTHER_ADDRESS}', o.id, '他社 宛', '5300001', '大阪府大阪市北区1-1-1', '0612345678', 1, datetime('now')
      FROM organizations o WHERE o.public_id = '${E2E_ORGANIZATIONS.other.publicId}';`,
  ]);
}
