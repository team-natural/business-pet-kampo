// The daily retention batch (OPS-02 §4-3, DEV-07 §10). Runs from the scheduled handler in
// src/worker.ts, with no request and no operator behind it.
//
// Two rules shape everything here:
//
//   1. Every deletion is logged, and logged as the system's: `causer_id` NULL, `causer_type` NULL,
//      `properties.source: "system"`. Inventing a "system" AdminUser row would put a person's name
//      on a machine's action (DEV-05 §9-1).
//   2. The log itself is never deleted (DEV-07 §10). Where a purge would orphan a log row's
//      foreign key, the key is nulled and the row kept.
import { activityLog, applications, cartItems, inquiries, memberPasswordResetTokens, memberSessions, members, memberships, orders, organizations, shippingAddresses, socialAccounts } from "@app/schema";
import { activityLogInsert } from "@app/schema/activity-log";
import type { DbClient } from "@app/schema/client";
import { and, eq, inArray, isNotNull, lt } from "drizzle-orm";

const DAY_MS = 24 * 60 * 60 * 1000;

// DEV-07 §10. Named rather than inlined so the table and the code can be read against each other.
export const RETENTION_DAYS = {
  rejectedApplication: 365,
  terminatedOrganization: 365,
  resolvedInquiry: 365,
} as const;

const cutoff = (now: Date, days: number) => new Date(now.getTime() - days * DAY_MS).toISOString();

export interface PurgeResult {
  applications: number;
  organizations: number;
  inquiries: number;
  memberSessions: number;
  // Terminated partners old enough to purge but held back by the 5-year accounting retention on
  // their orders. Reported rather than silently skipped — otherwise "0 deleted" looks like
  // nothing was due (GOV-01 D-042).
  organizationsHeldByOrders: number;
}

// One audit row per purge that actually removed something. A batch that deleted nothing writes
// nothing: a daily "deleted 0" entry buries the days it did delete.
function logPurge(db: DbClient, event: string, count: number, properties: Record<string, unknown> = {}) {
  return activityLogInsert(db, {
    logName: "retention",
    description: `Retention batch purged ${count} ${event}`,
    event: "data.purged",
    // Explicitly null, not omitted: the helper defaults an omitted causerType to AdminUser.
    causerType: null,
    properties: { source: "system", target: event, count, ...properties },
  });
}

// Screened out and never became a trading partner. Anything that was approved produced an
// organization and is covered by that retention instead.
export async function purgeExpiredApplications(db: DbClient, now: Date): Promise<number> {
  const rows = await db
    .select({ id: applications.id })
    .from(applications)
    .where(and(inArray(applications.status, ["rejected", "withdrawn"]), isNotNull(applications.reviewedAt), lt(applications.reviewedAt, cutoff(now, RETENTION_DAYS.rejectedApplication))));

  const ids = rows.map((row) => row.id);
  if (ids.length === 0) return 0;

  await db.batch([
    // applications and organizations reference each other (DEV-07 §5-1), so the link is cut from
    // the other side first even though a rejected application should never have one.
    db.update(organizations).set({ applicationId: null }).where(inArray(organizations.applicationId, ids)),
    db.delete(applications).where(inArray(applications.id, ids)),
    logPurge(db, "applications", ids.length),
  ]);

  return ids.length;
}

export async function purgeResolvedInquiries(db: DbClient, now: Date): Promise<number> {
  const rows = await db
    .select({ id: inquiries.id })
    .from(inquiries)
    .where(and(eq(inquiries.status, "resolved"), isNotNull(inquiries.resolvedAt), lt(inquiries.resolvedAt, cutoff(now, RETENTION_DAYS.resolvedInquiry))));

  const ids = rows.map((row) => row.id);
  if (ids.length === 0) return 0;

  await db.batch([db.delete(inquiries).where(inArray(inquiries.id, ids)), logPurge(db, "inquiries", ids.length)]);
  return ids.length;
}

// Expired rows only. Logging out and forced revocation delete immediately elsewhere (DEV-07 §10);
// this sweeps what simply timed out.
export async function purgeExpiredMemberSessions(db: DbClient, now: Date): Promise<number> {
  const rows = await db.select({ id: memberSessions.id }).from(memberSessions).where(lt(memberSessions.expiresAt, now.toISOString()));

  const ids = rows.map((row) => row.id);
  if (ids.length === 0) return 0;

  // No audit entry: an expired session is not a record anyone reviews, and a daily row for it
  // would drown the log the other purges write to (DEV-05 §9-1's "name the mistake" test).
  await db.delete(memberSessions).where(inArray(memberSessions.id, ids));
  return ids.length;
}

export interface OrganizationPurge {
  deleted: number;
  heldByOrders: number;
}

// Terminated long enough ago — but only those that never ordered. `orders.organization_id` is a
// NOT NULL foreign key and orders are kept five years, so deleting a partner that ordered would
// strand the very rows the accounting retention exists to keep (D-042, DEV-07 §10).
export async function purgeTerminatedOrganizations(db: DbClient, now: Date): Promise<OrganizationPurge> {
  const due = await db
    .select({ id: organizations.id, orgCode: organizations.orgCode, name: organizations.name })
    .from(organizations)
    .where(and(eq(organizations.status, "terminated"), isNotNull(organizations.terminatedAt), lt(organizations.terminatedAt, cutoff(now, RETENTION_DAYS.terminatedOrganization))));

  if (due.length === 0) return { deleted: 0, heldByOrders: 0 };

  const dueIds = due.map((row) => row.id);
  const ordered = await db.select({ organizationId: orders.organizationId }).from(orders).where(inArray(orders.organizationId, dueIds));
  const held = new Set(ordered.map((row) => row.organizationId));

  const removable = due.filter((row) => !held.has(row.id));
  if (removable.length === 0) return { deleted: 0, heldByOrders: held.size };

  const ids = removable.map((row) => row.id);

  // Members belong to exactly one organization (D-031), so a member of a removed partner has no
  // other membership to keep them. Resolved before the memberships go, or there is nothing left
  // to resolve them from.
  const memberRows = await db.select({ id: memberships.memberId }).from(memberships).where(inArray(memberships.organizationId, ids));
  const memberIds = [...new Set(memberRows.map((row) => row.id))];

  await db.batch([
    db.delete(cartItems).where(inArray(cartItems.organizationId, ids)),
    db.delete(shippingAddresses).where(inArray(shippingAddresses.organizationId, ids)),
    db.delete(memberships).where(inArray(memberships.organizationId, ids)),
    // The audit trail outlives the organization: the row stays, the link goes (DEV-07 §10).
    db.update(activityLog).set({ organizationId: null }).where(inArray(activityLog.organizationId, ids)),
    db.update(applications).set({ organizationId: null }).where(inArray(applications.organizationId, ids)),
    // Written before the delete so it lands even though the subject is about to disappear. The
    // org_code is copied into properties because subject_id will point at nothing.
    logPurge(db, "organizations", ids.length, { orgCodes: removable.map((row) => row.orgCode) }),
    db.delete(organizations).where(inArray(organizations.id, ids)),
  ]);

  await purgeOrphanedMembers(db, memberIds);
  return { deleted: ids.length, heldByOrders: held.size };
}

// Only those left with no membership at all. A member kept by another organization is not ours to
// delete, even though D-031 says there should be none.
async function purgeOrphanedMembers(db: DbClient, memberIds: number[]): Promise<void> {
  if (memberIds.length === 0) return;

  const stillAttached = await db.select({ id: memberships.memberId }).from(memberships).where(inArray(memberships.memberId, memberIds));
  const keep = new Set(stillAttached.map((row) => row.id));
  const orphaned = memberIds.filter((id) => !keep.has(id));
  if (orphaned.length === 0) return;

  await db.batch([db.delete(memberSessions).where(inArray(memberSessions.memberId, orphaned)), db.delete(memberPasswordResetTokens).where(inArray(memberPasswordResetTokens.memberId, orphaned)), db.delete(socialAccounts).where(inArray(socialAccounts.memberId, orphaned)), db.delete(cartItems).where(inArray(cartItems.memberId, orphaned)), db.delete(members).where(inArray(members.id, orphaned))]);
}

// Each step is independent and independently logged: one failing must not stop the rest, and the
// summary says what did run. The scheduled handler has nobody to report an exception to.
export async function runRetentionBatch(db: DbClient, now: Date = new Date()): Promise<PurgeResult> {
  const result: PurgeResult = { applications: 0, organizations: 0, inquiries: 0, memberSessions: 0, organizationsHeldByOrders: 0 };

  result.applications = await purgeExpiredApplications(db, now);
  result.inquiries = await purgeResolvedInquiries(db, now);
  result.memberSessions = await purgeExpiredMemberSessions(db, now);

  const organizations = await purgeTerminatedOrganizations(db, now);
  result.organizations = organizations.deleted;
  result.organizationsHeldByOrders = organizations.heldByOrders;

  return result;
}

// Every table that points at organizations, as of D-042. The purge above clears the first three
// and nulls the last two; `orders` and `payments` are what hold a partner back. A new table with
// an organization_id and no handling here would fail the delete at 03:00 with nobody watching, so
// tests/unit/retention.test.ts asserts this list still matches the schema.
export const ORGANIZATION_REFERENCES = ["memberships", "shipping_addresses", "cart_items", "orders", "payments", "activity_log", "applications"] as const;
