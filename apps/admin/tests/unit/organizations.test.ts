// ADM-14/15. Keyword search reaches SQL operators rather than plain equality, and the trading
// transitions reach other tables — those two are what this file is about (DEV-09 §2-2).
import { env } from "cloudflare:workers";
import { activityLog, adminUsers, members, memberships, organizations } from "@app/schema";
import { createDb } from "@app/schema/client";
import { ulid } from "@app/schema/ulid";
import { InvalidStateTransitionError } from "@app/server-kit/http";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { AdminUser } from "../../src/lib/server/services/admin-users";
import { allowedTransitions, listActiveMemberContacts, listOrganizations, transitionOrganization, updateOrganization } from "../../src/lib/server/services/organizations";

const db = createDb(env.DB);
let admin: AdminUser;

// A counter, not a slice of a ULID: the leading characters are the timestamp, so two codes minted
// in the same millisecond would collide on org_code's unique index.
let sequence = 0;

async function register(name: string, status: "active" | "suspended" | "terminated" = "active") {
  const [row] = await db
    .insert(organizations)
    .values({ publicId: ulid(), orgCode: `ORG-${String(++sequence).padStart(4, "0")}`, name, status, orderEnabled: status === "active" ? 1 : 0, updatedAt: new Date().toISOString() })
    .returning();
  return row!;
}

async function join(organizationId: number, email: string) {
  const now = new Date().toISOString();
  const [member] = await db.insert(members).values({ publicId: ulid(), name: "担当者", email, status: "active", updatedAt: now }).returning();
  await db.insert(memberships).values({ memberId: member!.id, organizationId, role: "client_user", status: "active", joinedAt: now, updatedAt: now });
  return member!;
}

const names = async (keyword: string) => (await listOrganizations(db, { keyword })).items.map((item) => item.name);

beforeEach(async () => {
  await db.delete(activityLog);
  await db.delete(memberships);
  await db.delete(members);
  await db.delete(organizations);
  await db.delete(adminUsers);

  const [row] = await db
    .insert(adminUsers)
    .values({ publicId: ulid(), name: "Operator", email: `${ulid()}@example.test`, status: "active", updatedAt: new Date().toISOString() })
    .returning();
  admin = row!;
});

describe("listOrganizations keyword", () => {
  it("matches on a substring", async () => {
    await register("ペットショップ甲");
    await register("動物病院乙");

    expect(await names("ショップ")).toEqual(["ペットショップ甲"]);
  });

  // Without an ESCAPE clause this returns both rows, and the operator sees a filter that silently
  // did nothing.
  it("treats % as a literal, not as a wildcard", async () => {
    await register("10%オフ商店");
    await register("動物病院乙");

    expect(await names("%")).toEqual(["10%オフ商店"]);
  });

  it("treats _ as a literal, not as a single-character wildcard", async () => {
    await register("pet_shop");
    await register("petXshop");

    expect(await names("pet_shop")).toEqual(["pet_shop"]);
  });
});

describe("updateOrganization", () => {
  it("saves the details and the memo without touching the status", async () => {
    const organization = await register("ペットショップ甲");
    const updated = await updateOrganization(db, organization.publicId, { name: "ペットショップ甲（本店）", memo: "電話確認済み", orderEnabled: 0 }, admin);

    expect(updated).toMatchObject({ name: "ペットショップ甲（本店）", status: "active", orderEnabled: false });
    const [row] = await db.select().from(organizations).where(eq(organizations.id, organization.id));
    expect(row!.memo).toBe("電話確認済み");
  });

  // org_code is the join key the price files use, with no foreign key behind it (D-019), so it is
  // not in the schema the route parses.
  it("leaves org_code alone even when one is posted", async () => {
    const organization = await register("ペットショップ甲");
    await updateOrganization(db, organization.publicId, { name: "別名" } as never, admin);

    const [row] = await db.select().from(organizations).where(eq(organizations.id, organization.id));
    expect(row!.orgCode).toBe(organization.orgCode);
  });
});

describe("transitionOrganization", () => {
  it("allows only the moves DEV-09 §2-2-2 declares", async () => {
    expect(allowedTransitions("active")).toEqual(["suspended", "terminated"]);
    expect(allowedTransitions("terminated")).toEqual([]);

    const organization = await register("ペットショップ甲", "terminated");
    await expect(transitionOrganization(db, organization.publicId, "active", admin)).rejects.toBeInstanceOf(InvalidStateTransitionError);
  });

  // An operator who resumed a partner but left the flag off would produce one that can log in and
  // not order, with nothing on screen explaining why.
  it("drives order_enabled from the status rather than leaving it to the operator", async () => {
    const organization = await register("ペットショップ甲");

    await transitionOrganization(db, organization.publicId, "suspended", admin, "未入金のため");
    let [row] = await db.select().from(organizations).where(eq(organizations.id, organization.id));
    expect(row!.orderEnabled).toBe(0);

    await transitionOrganization(db, organization.publicId, "active", admin);
    [row] = await db.select().from(organizations).where(eq(organizations.id, organization.id));
    expect(row!.orderEnabled).toBe(1);
  });

  it("records the reason in the audit entry against the organization", async () => {
    const organization = await register("ペットショップ甲");
    await transitionOrganization(db, organization.publicId, "suspended", admin, "規約違反のため");

    const [entry] = await db.select().from(activityLog);
    expect(entry).toMatchObject({ event: "organization.suspended", causerId: admin.id, organizationId: organization.id });
    expect(JSON.parse(entry!.properties!)).toMatchObject({ from: "active", to: "suspended", reason: "規約違反のため" });
  });

  it("leaves no audit entry when the transition is rejected", async () => {
    const organization = await register("ペットショップ甲", "terminated");
    await transitionOrganization(db, organization.publicId, "suspended", admin).catch(() => {});

    expect(await db.select().from(activityLog)).toHaveLength(0);
  });

  // The membership update rides in the same batch as the status change.
  it("suspends every membership when the partner is terminated", async () => {
    const organization = await register("ペットショップ甲");
    await join(organization.id, "a@example.test");
    await join(organization.id, "b@example.test");

    await transitionOrganization(db, organization.publicId, "terminated", admin, "取引終了のご依頼により");

    const rows = await db.select().from(memberships).where(eq(memberships.organizationId, organization.id));
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.status).toBe("suspended");
      expect(row.leftAt).not.toBeNull();
    }
  });

  // updated_at moves on any later edit, so the deletion batch (DEV-07 §10) needs its own column.
  it("stamps terminated_at once, and only on termination", async () => {
    const organization = await register("ペットショップ甲");

    await transitionOrganization(db, organization.publicId, "suspended", admin, "未入金のため");
    let [row] = await db.select().from(organizations).where(eq(organizations.id, organization.id));
    expect(row!.terminatedAt).toBeNull();

    await transitionOrganization(db, organization.publicId, "terminated", admin, "取引終了");
    [row] = await db.select().from(organizations).where(eq(organizations.id, organization.id));
    const stamped = row!.terminatedAt;
    expect(stamped).not.toBeNull();

    // A later memo edit must not move it.
    await updateOrganization(db, organization.publicId, { memo: "あとから追記" }, admin);
    [row] = await db.select().from(organizations).where(eq(organizations.id, organization.id));
    expect(row!.terminatedAt).toBe(stamped);
  });
});

describe("listActiveMemberContacts", () => {
  it("returns the members who should be told, and skips suspended ones", async () => {
    const organization = await register("ペットショップ甲");
    await join(organization.id, "active@example.test");
    const left = await join(organization.id, "left@example.test");
    await db.update(memberships).set({ status: "suspended" }).where(eq(memberships.memberId, left.id));

    const contacts = await listActiveMemberContacts(db, organization.id);
    expect(contacts.map((contact) => contact.email)).toEqual(["active@example.test"]);
  });

  // Read before the transition, not after — terminating suspends the memberships in the same batch.
  it("is empty once the partner is terminated", async () => {
    const organization = await register("ペットショップ甲");
    await join(organization.id, "active@example.test");

    await transitionOrganization(db, organization.publicId, "terminated", admin, "取引終了");
    expect(await listActiveMemberContacts(db, organization.id)).toHaveLength(0);
  });
});
