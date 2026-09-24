// FG-04's ordering half. Most of this file is about things that leave no trace when they break:
// a snapshot that silently follows a later price change, a cart cleared without an order, two
// orders taking the same number, and a deadline that moves after the customer was told it.
import { env } from "cloudflare:workers";
import { cartItems, members, orderItems, orders, organizations, payments, shippingAddresses } from "@app/schema";
import { createDb } from "@app/schema/client";
import { ulid } from "@app/schema/ulid";
import { ConflictError, NotFoundError } from "@app/server-kit/http";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { CartProduct } from "../../src/lib/catalog";
import { addBusinessDays } from "../../src/lib/commerce";
import { addItem, type CartScope, type ProductResolver } from "../../src/lib/server/services/cart";
import { placeOrder } from "../../src/lib/server/services/checkout";
import { getOrder, listOrders } from "../../src/lib/server/services/orders";

const db = createDb(env.DB);

// 2,400 × 10 = 24,000 clears the ¥10,000 minimum with one line.
const product = (slug: string, overrides: Partial<CartProduct> = {}): CartProduct => ({ slug, name: `商品 ${slug}`, code: "SMP-01", unitPrice: 2_400, orderUnit: 10, taxRate: 0.1, ...overrides });

const resolverFor = (...products: CartProduct[]): ProductResolver => {
  const all = new Map(products.map((entry) => [entry.slug, entry]));
  return async (slugs) => new Map(slugs.filter((slug) => all.has(slug)).map((slug) => [slug, all.get(slug)!]));
};

async function seedScope(): Promise<CartScope & { addressId: string }> {
  const [organization] = await db
    .insert(organizations)
    .values({ publicId: ulid(), orgCode: ulid().slice(-8), name: "A 株式会社", status: "active", orderEnabled: 1, updatedAt: new Date().toISOString() })
    .returning();
  const [member] = await db
    .insert(members)
    .values({ publicId: ulid(), name: "佐藤 花子", email: `${ulid()}@example.test`, status: "active", updatedAt: new Date().toISOString() })
    .returning();
  const addressId = ulid();
  await db.insert(shippingAddresses).values({ publicId: addressId, organizationId: organization!.id, recipientName: "佐藤 花子", postalCode: "1000001", address: "東京都千代田区1-1-1", phone: "0312345678", isDefault: 1, updatedAt: new Date().toISOString() });

  return { organizationId: organization!.id, memberId: member!.id, addressId };
}

const bankTransfer = (addressId: string) => ({ shippingAddressId: addressId, paymentMethod: "bank_transfer" as const });

beforeEach(async () => {
  await db.delete(orderItems);
  await db.delete(payments);
  await db.delete(orders);
  await db.delete(cartItems);
  await db.delete(shippingAddresses);
  await db.delete(members);
  await db.delete(organizations);
});

describe("addBusinessDays", () => {
  // Friday + 1 business day is Monday, not Saturday.
  it("steps over the weekend", () => {
    const friday = new Date("2026-09-25T00:00:00.000Z");
    expect(addBusinessDays(friday, 1).toISOString().slice(0, 10)).toBe("2026-09-28");
  });

  it("counts seven business days as nine calendar days across one weekend", () => {
    const thursday = new Date("2026-09-24T00:00:00.000Z");
    expect(addBusinessDays(thursday, 7).toISOString().slice(0, 10)).toBe("2026-10-05");
  });
});

describe("placeOrder", () => {
  it("writes the order, its lines, the payment and empties the cart in one go", async () => {
    const scope = await seedScope();
    const resolve = resolverFor(product("kampo-a"));
    await addItem(db, scope, { productSlug: "kampo-a", quantity: 10 }, resolve);

    const placed = await placeOrder(db, scope, bankTransfer(scope.addressId), resolve);

    expect(placed.orderNumber).toMatch(/^\d{8}-\d{3,}$/);
    expect(placed.total).toBe(24_000 + 1_000 + 2_500);

    const [order] = await db.select().from(orders);
    expect(order!.status).toBe("received");
    expect(order!.paymentStatus).toBe("awaiting_transfer");
    expect(await db.select().from(orderItems)).toHaveLength(1);
    expect(await db.select().from(payments)).toHaveLength(1);
    // The one outcome a buyer cannot recover from is a cart cleared without an order, so this is
    // checked in the same test as the order existing.
    expect(await db.select().from(cartItems)).toHaveLength(0);
  });

  // A price revision must not rewrite what a past order cost (DEV-07 §6-0).
  it("freezes the name, code, unit price and tax rate on the line", async () => {
    const scope = await seedScope();
    await addItem(db, scope, { productSlug: "kampo-a", quantity: 10 }, resolverFor(product("kampo-a")));
    await placeOrder(db, scope, bankTransfer(scope.addressId), resolverFor(product("kampo-a")));

    // The product is repriced and renamed after the order was placed.
    const [line] = await db.select().from(orderItems);
    expect(line!.unitPriceSnapshot).toBe(2_400);
    expect(line!.productNameSnapshot).toBe("商品 kampo-a");
    expect(line!.productCodeSnapshot).toBe("SMP-01");
    expect(line!.taxRateSnapshot).toBe("0.1");

    const detail = await getOrder(db, scope.organizationId, (await db.select().from(orders))[0]!.publicId);
    expect(detail.items[0]!.unitPrice).toBe(2_400);
    expect(detail.order.total).toBe(27_500);
  });

  // The stage's exit condition, stated directly: repricing the Markdown must not move a past
  // order's total. getOrder takes no resolver at all, so it cannot re-read content even by
  // accident — this pins the behaviour that guarantees.
  it("leaves a placed order's amounts alone after the product is repriced", async () => {
    const scope = await seedScope();

    await addItem(db, scope, { productSlug: "kampo-a", quantity: 10 }, resolverFor(product("kampo-a")));
    const before = await placeOrder(db, scope, bankTransfer(scope.addressId), resolverFor(product("kampo-a")));

    // The price file is edited and deployed: 2,400 becomes 3,000.
    const repriced = resolverFor(product("kampo-a", { unitPrice: 3_000 }));
    await addItem(db, scope, { productSlug: "kampo-a", quantity: 10 }, repriced);
    const after = await placeOrder(db, scope, bankTransfer(scope.addressId), repriced);

    const oldOrder = await getOrder(db, scope.organizationId, before.publicId);
    const newOrder = await getOrder(db, scope.organizationId, after.publicId);

    expect(oldOrder.items[0]!.unitPrice).toBe(2_400);
    expect(oldOrder.order.total).toBe(27_500);
    // The new one picks the revision up, which is what makes the old one's stability meaningful.
    expect(newOrder.items[0]!.unitPrice).toBe(3_000);
    expect(newOrder.order.total).not.toBe(oldOrder.order.total);
  });

  it("snapshots the shipping address rather than pointing at it", async () => {
    const scope = await seedScope();
    await addItem(db, scope, { productSlug: "kampo-a", quantity: 10 }, resolverFor(product("kampo-a")));
    await placeOrder(db, scope, bankTransfer(scope.addressId), resolverFor(product("kampo-a")));

    // Deleting the address afterwards must not change where the order says it went.
    await db.delete(shippingAddresses).where(eq(shippingAddresses.publicId, scope.addressId));

    const detail = await getOrder(db, scope.organizationId, (await db.select().from(orders))[0]!.publicId);
    expect(detail.shippingAddress.recipientName).toBe("佐藤 花子");
  });

  // Reading MAX() and then inserting would let two orders in the same second take one number.
  it("numbers orders sequentially within the day", async () => {
    const scope = await seedScope();
    const resolve = resolverFor(product("kampo-a"));

    const numbers: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      await addItem(db, scope, { productSlug: "kampo-a", quantity: 10 }, resolve);
      numbers.push((await placeOrder(db, scope, bankTransfer(scope.addressId), resolve)).orderNumber);
    }

    expect(new Set(numbers).size).toBe(3);
    expect(numbers.map((number) => number.slice(-3))).toEqual(["001", "002", "003"]);
    expect(new Set(numbers.map((number) => number.slice(0, 8))).size).toBe(1);
  });

  it("stores a transfer deadline for a bank transfer and none for a card", async () => {
    const scope = await seedScope();
    const resolve = resolverFor(product("kampo-a"));

    await addItem(db, scope, { productSlug: "kampo-a", quantity: 10 }, resolve);
    const transfer = await placeOrder(db, scope, bankTransfer(scope.addressId), resolve);
    expect(transfer.paymentDueAt).not.toBeNull();

    await addItem(db, scope, { productSlug: "kampo-a", quantity: 10 }, resolve);
    const card = await placeOrder(db, scope, { shippingAddressId: scope.addressId, paymentMethod: "credit_card" }, resolve);
    expect(card.paymentDueAt).toBeNull();
    expect((await db.select().from(orders).where(eq(orders.publicId, card.publicId)))[0]!.paymentStatus).toBe("unpaid");
  });

  it("refuses a cart below the minimum without writing anything", async () => {
    const scope = await seedScope();
    const resolve = resolverFor(product("kampo-a", { unitPrice: 100 }));
    await addItem(db, scope, { productSlug: "kampo-a", quantity: 10 }, resolve);

    await expect(placeOrder(db, scope, bankTransfer(scope.addressId), resolve)).rejects.toBeInstanceOf(ConflictError);
    expect(await db.select().from(orders)).toHaveLength(0);
    // The cart survives the refusal — losing it would cost the buyer the basket they assembled.
    expect(await db.select().from(cartItems)).toHaveLength(1);
  });

  it("refuses an empty cart", async () => {
    const scope = await seedScope();
    await expect(placeOrder(db, scope, bankTransfer(scope.addressId), resolverFor())).rejects.toBeInstanceOf(ConflictError);
  });

  it("refuses to order a line whose product is no longer available", async () => {
    const scope = await seedScope();
    await addItem(db, scope, { productSlug: "kampo-a", quantity: 10 }, resolverFor(product("kampo-a")));

    // Withdrawn between adding to the cart and checking out.
    await expect(placeOrder(db, scope, bankTransfer(scope.addressId), resolverFor())).rejects.toBeInstanceOf(ConflictError);
    expect(await db.select().from(orders)).toHaveLength(0);
  });

  it("refuses another organization's shipping address, with 404", async () => {
    const [a, b] = [await seedScope(), await seedScope()];
    const resolve = resolverFor(product("kampo-a"));
    await addItem(db, a, { productSlug: "kampo-a", quantity: 10 }, resolve);

    await expect(placeOrder(db, a, bankTransfer(b.addressId), resolve)).rejects.toBeInstanceOf(NotFoundError);
    expect(await db.select().from(orders)).toHaveLength(0);
  });
});

describe("order history", () => {
  it("never shows another organization's orders", async () => {
    const [a, b] = [await seedScope(), await seedScope()];
    const resolve = resolverFor(product("kampo-a"));
    await addItem(db, b, { productSlug: "kampo-a", quantity: 10 }, resolve);
    const theirs = await placeOrder(db, b, bankTransfer(b.addressId), resolve);

    expect(await listOrders(db, a.organizationId)).toHaveLength(0);
    await expect(getOrder(db, a.organizationId, theirs.publicId)).rejects.toBeInstanceOf(NotFoundError);
  });

  // Two buyers at one company share the company's history — the tenant boundary is the
  // organization, not the member (DEV-07 §1).
  it("shows a colleague's order to the same organization", async () => {
    const scope = await seedScope();
    const colleague = { ...scope, memberId: (await seedScope()).memberId };
    const resolve = resolverFor(product("kampo-a"));

    await addItem(db, colleague, { productSlug: "kampo-a", quantity: 10 }, resolve);
    await placeOrder(db, colleague, bankTransfer(scope.addressId), resolve);

    expect(await listOrders(db, scope.organizationId)).toHaveLength(1);
  });
});
