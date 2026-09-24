// FG-05's two invariants that leave no visible trace when broken: an organization never sees or
// reaches another's shipping address, and exactly one of its own is flagged as the default.
import { env } from "cloudflare:workers";
import { activityLog, members, organizations, shippingAddresses } from "@app/schema";
import { createDb } from "@app/schema/client";
import { ulid } from "@app/schema/ulid";
import { NotFoundError, ValidationError } from "@app/server-kit/http";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createAddress, deleteAddress, listAddresses, updateAddress } from "../../src/lib/server/services/addresses";
import { requestCompanyChange } from "../../src/lib/server/services/organizations";

const db = createDb(env.DB);

const input = { recipientName: "佐藤 花子", postalCode: "1000001", address: "東京都千代田区…", phone: "0312345678" };

async function seedOrganization(overrides: Partial<typeof organizations.$inferInsert> = {}) {
  const [row] = await db
    .insert(organizations)
    .values({ publicId: ulid(), orgCode: ulid().slice(-8), name: "A 株式会社", status: "active", orderEnabled: 1, updatedAt: new Date().toISOString(), ...overrides })
    .returning();
  return row!;
}

async function seedMember() {
  const [row] = await db
    .insert(members)
    .values({ publicId: ulid(), name: "佐藤 花子", email: `${ulid()}@example.test`, passwordHash: null, status: "active", updatedAt: new Date().toISOString() })
    .returning();
  return row!;
}

const defaultsOf = async (organizationId: number) => (await db.select().from(shippingAddresses).where(eq(shippingAddresses.organizationId, organizationId))).filter((row) => row.isDefault === 1);

beforeEach(async () => {
  await db.delete(activityLog);
  await db.delete(shippingAddresses);
  await db.delete(members);
  await db.delete(organizations);
});

describe("createAddress", () => {
  it("makes the first address the default even when the box was not ticked", async () => {
    const organization = await seedOrganization();
    const created = await createAddress(db, organization.id, input);

    expect(created.isDefault).toBe(true);
  });

  it("leaves a later address alone unless it asks to be the default", async () => {
    const organization = await seedOrganization();
    await createAddress(db, organization.id, input);
    const second = await createAddress(db, organization.id, { ...input, recipientName: "鈴木 一郎" });

    expect(second.isDefault).toBe(false);
  });

  // Two flagged rows is the failure this guards: checkout would preselect whichever came back
  // first, which is not a choice anyone made.
  it("clears the previous default in the same batch as setting the new one", async () => {
    const organization = await seedOrganization();
    const first = await createAddress(db, organization.id, input);
    const second = await createAddress(db, organization.id, { ...input, recipientName: "鈴木 一郎", isDefault: 1 });

    const defaults = await defaultsOf(organization.id);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]!.publicId).toBe(second.id);
    expect(first.id).not.toBe(second.id);
  });

  it("does not touch another organization's default", async () => {
    const [a, b] = [await seedOrganization(), await seedOrganization({ name: "B 株式会社" })];
    const theirs = await createAddress(db, b.id, input);
    await createAddress(db, a.id, { ...input, isDefault: 1 });

    expect((await defaultsOf(b.id))[0]!.publicId).toBe(theirs.id);
  });
});

describe("updateAddress", () => {
  it("promotes the edited address and demotes the old default", async () => {
    const organization = await seedOrganization();
    await createAddress(db, organization.id, input);
    const second = await createAddress(db, organization.id, { ...input, recipientName: "鈴木 一郎" });

    await updateAddress(db, organization.id, second.id, { ...input, recipientName: "鈴木 一郎", isDefault: 1 });

    const defaults = await defaultsOf(organization.id);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]!.publicId).toBe(second.id);
  });

  // Unticking the box on the current default would otherwise leave the organization with none.
  it("keeps the default flag when the current default unticks it", async () => {
    const organization = await seedOrganization();
    const only = await createAddress(db, organization.id, input);

    const updated = await updateAddress(db, organization.id, only.id, { ...input, isDefault: 0 });
    expect(updated.isDefault).toBe(true);
  });

  it("answers 404, not 403, for another organization's address", async () => {
    const [a, b] = [await seedOrganization(), await seedOrganization({ name: "B 株式会社" })];
    const theirs = await createAddress(db, b.id, input);

    await expect(updateAddress(db, a.id, theirs.id, input)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("deleteAddress", () => {
  it("promotes the newest remaining address when the default is deleted", async () => {
    const organization = await seedOrganization();
    const first = await createAddress(db, organization.id, input);
    const second = await createAddress(db, organization.id, { ...input, recipientName: "鈴木 一郎" });

    await deleteAddress(db, organization.id, first.id);

    const defaults = await defaultsOf(organization.id);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]!.publicId).toBe(second.id);
  });

  it("leaves the organization with nothing when the last address goes", async () => {
    const organization = await seedOrganization();
    const only = await createAddress(db, organization.id, input);

    await deleteAddress(db, organization.id, only.id);
    expect(await listAddresses(db, organization.id)).toHaveLength(0);
  });

  it("answers 404, not 403, for another organization's address", async () => {
    const [a, b] = [await seedOrganization(), await seedOrganization({ name: "B 株式会社" })];
    const theirs = await createAddress(db, b.id, input);

    await expect(deleteAddress(db, a.id, theirs.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await listAddresses(db, b.id)).toHaveLength(1);
  });
});

describe("listAddresses", () => {
  it("returns only the caller's organization, default first", async () => {
    const [a, b] = [await seedOrganization(), await seedOrganization({ name: "B 株式会社" })];
    await createAddress(db, b.id, { ...input, recipientName: "他社 宛" });
    await createAddress(db, a.id, input);
    const promoted = await createAddress(db, a.id, { ...input, recipientName: "鈴木 一郎", isDefault: 1 });

    const rows = await listAddresses(db, a.id);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.id).toBe(promoted.id);
    expect(rows.map((row) => row.recipientName)).not.toContain("他社 宛");
  });
});

describe("requestCompanyChange", () => {
  it("records the request without moving the organization", async () => {
    const organization = await seedOrganization();
    const member = await seedMember();

    const request = await requestCompanyChange(db, organization.id, member, { name: "A 商事株式会社" });

    expect(request.changes).toEqual([{ label: "会社名", before: "A 株式会社", after: "A 商事株式会社" }]);
    const [row] = await db.select().from(organizations).where(eq(organizations.id, organization.id));
    expect(row!.name).toBe("A 株式会社");
  });

  // The default causer is AdminUser, so a member-initiated entry that forgets to say so is
  // attributed to whoever happens to share that id (DEV-07 §4-2).
  it("attributes the audit entry to the member", async () => {
    const organization = await seedOrganization();
    const member = await seedMember();
    await requestCompanyChange(db, organization.id, member, { name: "A 商事株式会社" });

    const [entry] = await db.select().from(activityLog);
    expect(entry!.causerType).toBe("Member");
    expect(entry!.causerId).toBe(member.id);
    expect(entry!.organizationId).toBe(organization.id);
    expect(entry!.event).toBe("company_change_requested");
  });

  it("ignores fields that match what is already stored", async () => {
    const organization = await seedOrganization({ billingAddress: "東京都千代田区…" });
    const member = await seedMember();

    const request = await requestCompanyChange(db, organization.id, member, { name: organization.name, billingAddress: "東京都千代田区…", message: "担当者が変わりました" });
    expect(request.changes).toHaveLength(0);
    expect(request.message).toBe("担当者が変わりました");
  });

  // An empty request would still mail the operator, which trains them to ignore the notification.
  it("refuses a request with neither a change nor a message", async () => {
    const organization = await seedOrganization();
    const member = await seedMember();

    await expect(requestCompanyChange(db, organization.id, member, { name: organization.name })).rejects.toBeInstanceOf(ValidationError);
    expect(await db.select().from(activityLog)).toHaveLength(0);
  });
});
