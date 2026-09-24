// The daily retention batch (OPS-02 §4-3, DEV-07 §10). Nothing here is reachable from a browser —
// it runs from a scheduled handler — so every rule lives in this file.
//
// The rules worth breaking a build over: deletions are attributed to nobody, the audit log
// survives what it describes, and a partner with retained orders is not deleted out from under
// them (D-042).
import { env } from "cloudflare:workers";
import { activityLog, adminUsers, applications, cartItems, inquiries, memberSessions, members, memberships, orderItems, orders, organizations, payments, shippingAddresses } from "@app/schema";
import { createDb } from "@app/schema/client";
import { ulid } from "@app/schema/ulid";
import { eq, getTableName } from "drizzle-orm";
import { getTableConfig, type SQLiteTable } from "drizzle-orm/sqlite-core";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@app/schema";
import { ORGANIZATION_REFERENCES, RETENTION_DAYS, purgeExpiredApplications, purgeExpiredMemberSessions, purgeResolvedInquiries, purgeTerminatedOrganizations, runRetentionBatch } from "../../src/lib/server/services/retention";

const db = createDb(env.DB);
const NOW = new Date("2026-09-24T18:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

// Comfortably past and comfortably short of the one-year line, so a boundary rounding question
// never decides a test.
const longAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS).toISOString();
const expired = longAgo(RETENTION_DAYS.rejectedApplication + 30);
const recent = longAgo(30);

let sequence = 0;

async function seedApplication(status: "rejected" | "withdrawn" | "approved", reviewedAt: string | null) {
  const [row] = await db
    .insert(applications)
    .values({
      publicId: ulid(),
      companyName: "A 商店",
      postalCode: "1000001",
      address: "東京都千代田区1-1-1",
      representativeName: "山田 太郎",
      contactName: "佐藤 花子",
      phone: "0312345678",
      email: `${ulid()}@example.test`,
      agreedToTerms: 1,
      agreedTermsVersion: "2026-09-17",
      status,
      appliedAt: reviewedAt ?? recent,
      reviewedAt,
      updatedAt: recent,
    })
    .returning();
  return row!;
}

async function seedOrganization(terminatedAt: string | null) {
  const [row] = await db
    .insert(organizations)
    .values({
      publicId: ulid(),
      orgCode: `ORG-${String(++sequence).padStart(4, "0")}`,
      name: "取引先",
      status: terminatedAt ? "terminated" : "active",
      orderEnabled: terminatedAt ? 0 : 1,
      terminatedAt,
      updatedAt: recent,
    })
    .returning();
  return row!;
}

async function seedMember(organizationId: number) {
  const [member] = await db
    .insert(members)
    .values({ publicId: ulid(), name: "担当者", email: `${ulid()}@example.test`, status: "active", updatedAt: recent })
    .returning();
  await db.insert(memberships).values({ memberId: member!.id, organizationId, role: "client_user", status: "suspended", joinedAt: recent, updatedAt: recent });
  return member!;
}

async function seedOrder(organizationId: number, memberId: number) {
  const [row] = await db
    .insert(orders)
    .values({
      publicId: ulid(),
      organizationId,
      memberId,
      orderNumber: `20260101-${String(++sequence).padStart(3, "0")}`,
      status: "completed",
      paymentStatus: "paid",
      subtotal: 24_000,
      tax: 2_500,
      shippingFee: 1_000,
      total: 27_500,
      shippingAddressSnapshot: "{}",
      paymentMethod: "bank_transfer",
      placedAt: recent,
      updatedAt: recent,
    })
    .returning();
  return row!;
}

async function seedInquiry(status: "resolved" | "in_progress", resolvedAt: string | null) {
  const [row] = await db
    .insert(inquiries)
    .values({ publicId: ulid(), name: "問い合わせ者", email: `${ulid()}@example.test`, content: "本文", status, resolvedAt, updatedAt: recent })
    .returning();
  return row!;
}

beforeEach(async () => {
  await db.delete(orderItems);
  await db.delete(payments);
  await db.delete(orders);
  await db.delete(cartItems);
  await db.delete(shippingAddresses);
  await db.delete(activityLog);
  await db.delete(memberSessions);
  await db.delete(memberships);
  await db.delete(members);
  await db.update(applications).set({ organizationId: null });
  await db.update(organizations).set({ applicationId: null });
  await db.delete(applications);
  await db.delete(organizations);
  await db.delete(inquiries);
  await db.delete(adminUsers);
});

describe("the audit entry a purge writes", () => {
  // The stage's exit condition. Inventing a "system" AdminUser would put a person's name on a
  // machine's action (DEV-05 §9-1).
  it("is attributed to nobody, and says the system did it", async () => {
    await seedApplication("rejected", expired);
    await purgeExpiredApplications(db, NOW);

    const [entry] = await db.select().from(activityLog);
    expect(entry!.causerId).toBeNull();
    expect(entry!.causerType).toBeNull();
    expect(entry!.event).toBe("data.purged");
    expect(JSON.parse(entry!.properties!)).toMatchObject({ source: "system", target: "applications", count: 1 });
  });

  // A daily "purged 0" row buries the days that did delete something.
  it("is not written when nothing was due", async () => {
    await seedApplication("rejected", recent);
    expect(await purgeExpiredApplications(db, NOW)).toBe(0);
    expect(await db.select().from(activityLog)).toHaveLength(0);
  });
});

describe("purgeExpiredApplications", () => {
  it.each(["rejected", "withdrawn"] as const)("deletes a %s application past its year", async (status) => {
    await seedApplication(status, expired);
    expect(await purgeExpiredApplications(db, NOW)).toBe(1);
    expect(await db.select().from(applications)).toHaveLength(0);
  });

  it("keeps one that has not reached the line", async () => {
    await seedApplication("rejected", recent);
    expect(await purgeExpiredApplications(db, NOW)).toBe(0);
    expect(await db.select().from(applications)).toHaveLength(1);
  });

  // An approved application became a trading partner; that partner's retention governs it.
  it("never touches an approved application, however old", async () => {
    await seedApplication("approved", expired);
    expect(await purgeExpiredApplications(db, NOW)).toBe(0);
  });
});

describe("purgeResolvedInquiries", () => {
  it("deletes a resolved inquiry past its year", async () => {
    await seedInquiry("resolved", expired);
    expect(await purgeResolvedInquiries(db, NOW)).toBe(1);
  });

  it("keeps one that is still being handled", async () => {
    await seedInquiry("in_progress", null);
    expect(await purgeResolvedInquiries(db, NOW)).toBe(0);
  });

  // Reopening clears resolved_at (D-030), so a reopened inquiry has no clock running.
  it("keeps one whose resolution was undone", async () => {
    await seedInquiry("in_progress", null);
    expect(await purgeResolvedInquiries(db, NOW)).toBe(0);
    expect(await db.select().from(inquiries)).toHaveLength(1);
  });
});

describe("purgeExpiredMemberSessions", () => {
  it("deletes only the sessions that have expired", async () => {
    const organization = await seedOrganization(null);
    const member = await seedMember(organization.id);
    await db.insert(memberSessions).values({ memberId: member.id, sessionToken: ulid(), expiresAt: longAgo(1) });
    await db.insert(memberSessions).values({ memberId: member.id, sessionToken: ulid(), expiresAt: new Date(NOW.getTime() + DAY_MS).toISOString() });

    expect(await purgeExpiredMemberSessions(db, NOW)).toBe(1);
    expect(await db.select().from(memberSessions)).toHaveLength(1);
  });
});

describe("purgeTerminatedOrganizations", () => {
  it("deletes a terminated partner that never ordered, and its members with it", async () => {
    const organization = await seedOrganization(expired);
    const member = await seedMember(organization.id);
    await db.insert(shippingAddresses).values({ publicId: ulid(), organizationId: organization.id, recipientName: "宛名", postalCode: "1000001", address: "住所", phone: "0312345678", updatedAt: recent });

    const result = await purgeTerminatedOrganizations(db, NOW);

    expect(result).toEqual({ deleted: 1, heldByOrders: 0 });
    expect(await db.select().from(organizations)).toHaveLength(0);
    expect(await db.select().from(memberships)).toHaveLength(0);
    expect(await db.select().from(shippingAddresses)).toHaveLength(0);
    expect(await db.select().from(members).where(eq(members.id, member.id))).toHaveLength(0);
  });

  // The rule D-042 exists for: orders are kept five years and their organization_id is a NOT NULL
  // foreign key, so deleting the partner at one year would strand them.
  it("holds back a partner whose orders are still retained", async () => {
    const organization = await seedOrganization(expired);
    const member = await seedMember(organization.id);
    await seedOrder(organization.id, member.id);

    const result = await purgeTerminatedOrganizations(db, NOW);

    expect(result).toEqual({ deleted: 0, heldByOrders: 1 });
    expect(await db.select().from(organizations)).toHaveLength(1);
    expect(await db.select().from(orders)).toHaveLength(1);
  });

  it("deletes the partners it can while holding back the ones it cannot", async () => {
    const clean = await seedOrganization(expired);
    await seedMember(clean.id);

    const ordered = await seedOrganization(expired);
    const member = await seedMember(ordered.id);
    await seedOrder(ordered.id, member.id);

    expect(await purgeTerminatedOrganizations(db, NOW)).toEqual({ deleted: 1, heldByOrders: 1 });
    expect((await db.select().from(organizations))[0]!.id).toBe(ordered.id);
  });

  it("keeps a partner that is still active or recently terminated", async () => {
    await seedOrganization(null);
    await seedOrganization(recent);

    expect(await purgeTerminatedOrganizations(db, NOW)).toEqual({ deleted: 0, heldByOrders: 0 });
    expect(await db.select().from(organizations)).toHaveLength(2);
  });

  // The log outlives what it describes (DEV-07 §10): the row stays, the foreign key goes.
  it("keeps the audit trail and nulls its link to the deleted partner", async () => {
    const organization = await seedOrganization(expired);
    await db.insert(activityLog).values({ description: "取引を終了しました", organizationId: organization.id, causerType: "AdminUser" });

    await purgeTerminatedOrganizations(db, NOW);

    const rows = await db.select().from(activityLog);
    // The historical entry plus the purge's own.
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.organizationId === null)).toBe(true);
    // The org_code is copied into the purge entry, because subject_id now points at nothing.
    const purge = rows.find((row) => row.event === "data.purged")!;
    expect(JSON.parse(purge.properties!).orgCodes).toEqual([organization.orgCode]);
  });

  it("cuts the applications link before deleting, so the mutual reference cannot block it", async () => {
    const organization = await seedOrganization(expired);
    const application = await seedApplication("approved", recent);
    await db.update(applications).set({ organizationId: organization.id }).where(eq(applications.id, application.id));

    expect((await purgeTerminatedOrganizations(db, NOW)).deleted).toBe(1);
    expect((await db.select().from(applications))[0]!.organizationId).toBeNull();
  });
});

describe("runRetentionBatch", () => {
  it("reports what it removed and what it held back", async () => {
    await seedApplication("rejected", expired);
    await seedInquiry("resolved", expired);

    const held = await seedOrganization(expired);
    const member = await seedMember(held.id);
    await seedOrder(held.id, member.id);
    await db.insert(memberSessions).values({ memberId: member.id, sessionToken: ulid(), expiresAt: longAgo(1) });

    expect(await runRetentionBatch(db, NOW)).toEqual({ applications: 1, organizations: 0, inquiries: 1, memberSessions: 1, organizationsHeldByOrders: 1 });
  });
});

describe("the schema this batch assumes", () => {
  // A new table with an organization_id and no handling in the purge would fail the delete at
  // 03:00 with nobody watching, so the list in retention.ts is checked against the real schema.
  //
  // Read from drizzle's own table metadata rather than sqlite_master: D1 refuses introspection
  // queries with SQLITE_AUTH.
  it("has no table referencing organizations that the purge does not account for", () => {
    const configs = Object.values(schema as Record<string, unknown>)
      .filter((value): value is SQLiteTable => {
        try {
          getTableConfig(value as SQLiteTable);
          return true;
        } catch {
          return false;
        }
      })
      .map((table) => getTableConfig(table));

    // Guards the filter: without this the assertion below could pass on an empty list.
    expect(configs.length).toBeGreaterThan(10);

    const referencing = configs.filter((table) => table.foreignKeys.some((key) => getTableName(key.reference().foreignTable) === "organizations")).map((table) => table.name);

    expect(referencing.sort()).toEqual([...ORGANIZATION_REFERENCES].sort());
  });
});
