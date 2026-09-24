import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

// No account is seeded here: Playwright cannot pass Cloudflare Access, so the dev server supplies
// the identity from wrangler.jsonc's `access.dev` block and the ledger row is provisioned on the
// first request (D-022, D-029). Only the schema has to exist first.
//
// Applications are, though. They arrive from apps/public, which is a separate Worker that this
// suite does not start — so the rows go in through wrangler rather than over HTTP.

// Resolved from this file, not the cwd: `playwright test --config apps/admin/...` run from the
// repo root would otherwise point wrangler at paths that do not exist.
const appDir = path.join(import.meta.dirname, "../..");
const migrationsDir = path.join(appDir, "../../packages/schema/migrations");
// The store the dev server opens (astro.config.mjs `persistState`).
const persist = ["--persist-to", path.join(appDir, "../../.wrangler-state")];

// Fixed ids, so a spec can address one without a lookup. `E2E-` prefixed so the cleanup below
// cannot reach a row that some other run created.
export const E2E_APPLICATIONS = {
  received: "01E2EAPPRECEIVED0000000000",
  reviewing: "01E2EAPPREVIEWING000000000",
  toApprove: "01E2EAPPTOAPPROVE000000000",
  toReject: "01E2EAPPTOREJECT0000000000",
} as const;

// org_code follows the `ORG-E2E%` shape the teardown matches on, so a run that leaves one behind
// cannot survive into the next.
export const E2E_ORGANIZATIONS = {
  toSuspend: { publicId: "01E2EORGTOSUSPEND000000000", orgCode: "ORG-E2ESUSP", status: "active" },
  toResume: { publicId: "01E2EORGTORESUME0000000000", orgCode: "ORG-E2ERESU", status: "suspended" },
  toTerminate: { publicId: "01E2EORGTOTERMINATE0000000", orgCode: "ORG-E2ETERM", status: "active" },
  // Carries one order that is still in flight, so terminating it must be refused (F-12-02).
  blockedByOrder: { publicId: "01E2EORGBLOCKED0000000000", orgCode: "ORG-E2EBLOK", status: "active" },
} as const;

// The order that does the blocking. Its number is asserted in the 409 message.
export const E2E_BLOCKING_ORDER = "20260924-901";

// One statement per call. wrangler aborts the whole command at the first error, so a multi
// statement teardown that trips a foreign key leaves the rest unrun — and the next run then fails
// on the debris the failed one left behind.
function run(statements: string[], label: string) {
  for (const sql of statements) {
    const result = spawnSync("npx", ["wrangler", "d1", "execute", "DB", "--local", ...persist, "--command", sql], { stdio: "inherit", cwd: appDir });
    if (result.status !== 0) throw new Error(`E2E setup failed: ${label} — ${sql}`);
  }
}

function insertOrganization({ publicId, orgCode, status }: { publicId: string; orgCode: string; status: string }) {
  return `INSERT INTO organizations (public_id, org_code, name, status, order_enabled, updated_at)
    VALUES ('${publicId}', '${orgCode}', 'E2E 取引先 ${orgCode}', '${status}', ${status === "active" ? 1 : 0}, datetime('now'));`;
}

function insert(publicId: string, status: string, email: string) {
  return `INSERT INTO applications (public_id, company_name, postal_code, address, representative_name, contact_name, phone, email, agreed_to_terms, agreed_terms_version, status, applied_at, updated_at)
    VALUES ('${publicId}', 'E2E 商店', '1000001', '東京都千代田区1-1-1', '山田 太郎', '佐藤 花子', '0312345678', '${email}', 1, '2026-09-17', '${status}', datetime('now'), datetime('now'));`;
}

export default function globalSetup() {
  if (!existsSync(migrationsDir)) {
    throw new Error("No D1 migrations found. Run `pnpm db:generate` from the repo root first.");
  }

  const result = spawnSync("npx", ["wrangler", "d1", "migrations", "apply", "DB", "--local", ...persist], { stdio: "inherit", cwd: appDir });
  if (result.status !== 0) throw new Error("E2E setup failed: could not apply D1 migrations.");

  const ids = Object.values(E2E_APPLICATIONS)
    .map((id) => `'${id}'`)
    .join(",");

  // Torn down and rebuilt each run, so a suite that approved one last time starts from received
  // again.
  //
  // Everything this suite has ever created is matched by shape (`ORG-E2E%`, `e2e-applicant%`), not
  // just by the fixed ids above — earlier runs seeded applications with random ULIDs, and their
  // organizations would otherwise linger and collide. Order follows the foreign keys inwards:
  // activity_log points at organizations, memberships at both, and applications and organizations
  // point at each other (DEV-07 §5-1).
  const mine = `org_code LIKE 'ORG-E2E%'`;
  const seeded = `public_id IN (${ids}) OR email LIKE 'e2e-applicant%@example.test'`;

  run(
    [
      // Orders hang off both the organization and the member, and order_items off the order, so
      // the three go before the memberships and members deletes below.
      `DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE organization_id IN (SELECT id FROM organizations WHERE ${mine}))`,
      `DELETE FROM payments WHERE organization_id IN (SELECT id FROM organizations WHERE ${mine})`,
      `DELETE FROM orders WHERE organization_id IN (SELECT id FROM organizations WHERE ${mine})`,
      `DELETE FROM activity_log WHERE organization_id IN (SELECT id FROM organizations WHERE ${mine})`,
      `DELETE FROM activity_log WHERE subject_type = 'Application' AND subject_id IN (SELECT id FROM applications WHERE ${seeded})`,
      `DELETE FROM memberships WHERE organization_id IN (SELECT id FROM organizations WHERE ${mine})`,
      `DELETE FROM members WHERE email LIKE 'e2e-applicant%@example.test'`,
      // Both directions of the applications <-> organizations cycle have to be cut before either
      // side can go.
      `UPDATE applications SET organization_id = NULL WHERE organization_id IN (SELECT id FROM organizations WHERE ${mine})`,
      `UPDATE organizations SET application_id = NULL WHERE application_id IN (SELECT id FROM applications WHERE ${seeded})`,
      `DELETE FROM organizations WHERE ${mine}`,
      `DELETE FROM applications WHERE ${seeded}`,
    ],
    "could not clear the seeded applications",
  );

  run([insert(E2E_APPLICATIONS.received, "received", "e2e-applicant-received@example.test"), insert(E2E_APPLICATIONS.reviewing, "reviewing", "e2e-applicant-reviewing@example.test"), insert(E2E_APPLICATIONS.toApprove, "reviewing", "e2e-applicant-approve@example.test"), insert(E2E_APPLICATIONS.toReject, "reviewing", "e2e-applicant-reject@example.test")], "could not seed the applications");

  run(Object.values(E2E_ORGANIZATIONS).map(insertOrganization), "could not seed the organizations");

  // One member on the organization the termination spec uses, so it can check that terminating
  // suspends the membership along with the partner (DEV-09 §2-2-4).
  run(
    [
      `INSERT INTO members (public_id, name, email, status, updated_at)
        VALUES ('01E2EMEMBERTERMINATE000000', 'E2E 担当者', 'e2e-applicant-terminate@example.test', 'active', datetime('now'));`,
      `INSERT INTO memberships (member_id, organization_id, role, status, joined_at, updated_at)
        SELECT m.id, o.id, 'client_user', 'active', datetime('now'), datetime('now')
        FROM members m, organizations o
        WHERE m.public_id = '01E2EMEMBERTERMINATE000000' AND o.public_id = '${E2E_ORGANIZATIONS.toTerminate.publicId}';`,
    ],
    "could not seed the terminating organization's member",
  );

  // The order that blocks termination (F-12-02): still in flight, so the partner cannot be closed
  // while it exists. It needs a member of its own to hang off.
  run(
    [
      `INSERT INTO members (public_id, name, email, status, updated_at)
        VALUES ('01E2EMEMBERBLOCKED00000000', 'E2E 担当者', 'e2e-applicant-blocked@example.test', 'active', datetime('now'));`,
      `INSERT INTO memberships (member_id, organization_id, role, status, joined_at, updated_at)
        SELECT m.id, o.id, 'client_user', 'active', datetime('now'), datetime('now')
        FROM members m, organizations o
        WHERE m.public_id = '01E2EMEMBERBLOCKED00000000' AND o.public_id = '${E2E_ORGANIZATIONS.blockedByOrder.publicId}';`,
      `INSERT INTO orders (public_id, organization_id, member_id, order_number, status, payment_status, subtotal, tax, shipping_fee, total, shipping_address_snapshot, payment_method, placed_at, updated_at)
        SELECT '01E2EORDERBLOCKING00000000', o.id, m.id, '${E2E_BLOCKING_ORDER}', 'received', 'awaiting_transfer', 24000, 2500, 1000, 27500, '{}', 'bank_transfer', datetime('now'), datetime('now')
        FROM members m, organizations o
        WHERE m.public_id = '01E2EMEMBERBLOCKED00000000' AND o.public_id = '${E2E_ORGANIZATIONS.blockedByOrder.publicId}';`,
    ],
    "could not seed the blocking order",
  );
}
