// FG-12's operator half. Termination is terminal — there is no way back to active (DEV-09
// §2-2-2) — so an order stranded by it can never be delivered or collected. That is what the
// outstanding check is for, and it is the one rule this file exists to pin (F-12-02).
import { env } from "cloudflare:workers";
import { activityLog, adminUsers, members, memberships, orderItems, orders, organizations, payments } from "@app/schema";
import { createDb } from "@app/schema/client";
import { ulid } from "@app/schema/ulid";
import { ConflictError } from "@app/server-kit/http";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { AdminUser } from "../../src/lib/server/services/admin-users";
import { listOutstandingOrders } from "../../src/lib/server/services/orders";
import { transitionOrganization } from "../../src/lib/server/services/organizations";

const db = createDb(env.DB);
let admin: AdminUser;
let sequence = 0;

type OrderStatus = "received" | "confirming" | "preparing" | "shipped" | "completed" | "cancelled";
type PaymentStatus = "unpaid" | "awaiting_transfer" | "processing" | "paid" | "failed" | "refunded" | "partially_refunded";

async function register(status: "active" | "suspended" = "active") {
  const [row] = await db
    .insert(organizations)
    .values({ publicId: ulid(), orgCode: `ORG-${String(++sequence).padStart(4, "0")}`, name: "取引先", status, orderEnabled: status === "active" ? 1 : 0, updatedAt: new Date().toISOString() })
    .returning();
  return row!;
}

async function join(organizationId: number) {
  const now = new Date().toISOString();
  const [member] = await db
    .insert(members)
    .values({ publicId: ulid(), name: "担当者", email: `${ulid()}@example.test`, status: "active", updatedAt: now })
    .returning();
  await db.insert(memberships).values({ memberId: member!.id, organizationId, role: "client_user", status: "active", joinedAt: now, updatedAt: now });
  return member!;
}

async function placeOrder(organizationId: number, memberId: number, status: OrderStatus, paymentStatus: PaymentStatus) {
  const now = new Date().toISOString();
  const [row] = await db
    .insert(orders)
    .values({
      publicId: ulid(),
      organizationId,
      memberId,
      orderNumber: `20260924-${String(++sequence).padStart(3, "0")}`,
      status,
      paymentStatus,
      subtotal: 24_000,
      tax: 2_500,
      shippingFee: 1_000,
      total: 27_500,
      shippingAddressSnapshot: "{}",
      paymentMethod: "bank_transfer",
      placedAt: now,
      updatedAt: now,
    })
    .returning();
  return row!;
}

beforeEach(async () => {
  await db.delete(orderItems);
  await db.delete(payments);
  await db.delete(orders);
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

describe("listOutstandingOrders", () => {
  it.each([
    ["received", "awaiting_transfer"],
    ["confirming", "paid"],
    ["preparing", "paid"],
    ["shipped", "paid"],
  ] as const)("reports an order still in flight (%s / %s)", async (status, paymentStatus) => {
    const organization = await register();
    const member = await join(organization.id);
    await placeOrder(organization.id, member.id, status, paymentStatus);

    const outstanding = await listOutstandingOrders(db, organization.id);
    expect(outstanding).toHaveLength(1);
    expect(outstanding[0]!.reason).toBe("in_flight");
  });

  // Delivered but never paid for: the goods are gone and the money is still owed.
  it("reports a completed order whose payment never settled", async () => {
    const organization = await register();
    const member = await join(organization.id);
    await placeOrder(organization.id, member.id, "completed", "awaiting_transfer");

    const outstanding = await listOutstandingOrders(db, organization.id);
    expect(outstanding).toHaveLength(1);
    expect(outstanding[0]!.reason).toBe("unpaid");
  });

  it.each(["paid", "refunded", "partially_refunded"] as const)("ignores a completed order settled as %s", async (paymentStatus) => {
    const organization = await register();
    const member = await join(organization.id);
    await placeOrder(organization.id, member.id, "completed", paymentStatus);

    expect(await listOutstandingOrders(db, organization.id)).toHaveLength(0);
  });

  // An unpaid cancellation is nothing owed; a refund is tracked on the Payment (DEV-09 §2-6).
  it("ignores a cancelled order whatever its payment says", async () => {
    const organization = await register();
    const member = await join(organization.id);
    await placeOrder(organization.id, member.id, "cancelled", "unpaid");
    await placeOrder(organization.id, member.id, "cancelled", "refunded");

    expect(await listOutstandingOrders(db, organization.id)).toHaveLength(0);
  });

  it("never counts another organization's orders", async () => {
    const [a, b] = [await register(), await register()];
    const member = await join(b.id);
    await placeOrder(b.id, member.id, "received", "awaiting_transfer");

    expect(await listOutstandingOrders(db, a.id)).toHaveLength(0);
  });
});

describe("terminating a trading partner", () => {
  // The stage's exit condition.
  it("refuses while an order is still in flight, and names it", async () => {
    const organization = await register();
    const member = await join(organization.id);
    const order = await placeOrder(organization.id, member.id, "preparing", "paid");

    await expect(transitionOrganization(db, organization.publicId, "terminated", admin)).rejects.toThrow(ConflictError);
    await expect(transitionOrganization(db, organization.publicId, "terminated", admin)).rejects.toThrow(order.orderNumber);

    // Nothing moved: not the status, not the memberships.
    const [after] = await db.select().from(organizations).where(eq(organizations.id, organization.id));
    expect(after!.status).toBe("active");
    expect(after!.terminatedAt).toBeNull();
    expect((await db.select().from(memberships))[0]!.status).toBe("active");
  });

  it("refuses while a delivered order is still unpaid", async () => {
    const organization = await register();
    const member = await join(organization.id);
    await placeOrder(organization.id, member.id, "completed", "awaiting_transfer");

    await expect(transitionOrganization(db, organization.publicId, "terminated", admin)).rejects.toThrow(ConflictError);
  });

  it("terminates once every order is settled or cancelled", async () => {
    const organization = await register();
    const member = await join(organization.id);
    await placeOrder(organization.id, member.id, "completed", "paid");
    await placeOrder(organization.id, member.id, "cancelled", "unpaid");

    const terminated = await transitionOrganization(db, organization.publicId, "terminated", admin, "取引先からの申し出");

    expect(terminated.status).toBe("terminated");
    // The retention clock starts here (§10), and every membership ends with the partner.
    const [after] = await db.select().from(organizations).where(eq(organizations.id, organization.id));
    expect(after!.terminatedAt).not.toBeNull();
    expect((await db.select().from(memberships))[0]!.status).toBe("suspended");
  });

  it("terminates a partner that never ordered", async () => {
    const organization = await register();
    await join(organization.id);

    expect((await transitionOrganization(db, organization.publicId, "terminated", admin)).status).toBe("terminated");
  });

  // Suspension is not terminal and is the operator's lever while an order is being chased, so it
  // must stay available exactly when termination is refused.
  it("still allows suspension while orders are outstanding", async () => {
    const organization = await register();
    const member = await join(organization.id);
    await placeOrder(organization.id, member.id, "received", "awaiting_transfer");

    expect((await transitionOrganization(db, organization.publicId, "suspended", admin, "未入金のため")).status).toBe("suspended");
  });
});
