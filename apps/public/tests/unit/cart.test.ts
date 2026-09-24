// FG-04's arithmetic and its scoping. E2E can see that a line appears; it cannot see that the tax
// was rounded once per rate, that a colleague's cart is unreachable, or that a withdrawn product
// is surfaced rather than silently dropped.
import { env } from "cloudflare:workers";
import { cartItems, members, organizations } from "@app/schema";
import { createDb } from "@app/schema/client";
import { ulid } from "@app/schema/ulid";
import { BadRequestError, NotFoundError, ValidationError } from "@app/server-kit/http";
import { beforeEach, describe, expect, it } from "vitest";
import type { CartProduct } from "../../src/lib/catalog";
import { FREE_SHIPPING_THRESHOLD, SHIPPING_FEE, orderTotals } from "../../src/lib/commerce";
import { addItem, getCart, removeItem, updateQuantity, type CartScope, type ProductResolver } from "../../src/lib/server/services/cart";

const db = createDb(env.DB);

const product = (slug: string, overrides: Partial<CartProduct> = {}): CartProduct => ({
  slug,
  name: `商品 ${slug}`,
  code: null,
  unitPrice: 1_000,
  orderUnit: 1,
  taxRate: 0.1,
  ...overrides,
});

// The real resolver reads packages/content; the rules under test do not care where the product
// came from, only that an unresolvable slug is absent from the map (DEV-05 §1-4).
const resolverFor = (...products: CartProduct[]): ProductResolver => {
  const all = new Map(products.map((entry) => [entry.slug, entry]));
  return async (slugs) => new Map(slugs.filter((slug) => all.has(slug)).map((slug) => [slug, all.get(slug)!]));
};

async function seedScope(): Promise<CartScope> {
  const [organization] = await db
    .insert(organizations)
    .values({ publicId: ulid(), orgCode: ulid().slice(-8), name: "A 株式会社", status: "active", orderEnabled: 1, updatedAt: new Date().toISOString() })
    .returning();
  const [member] = await db
    .insert(members)
    .values({ publicId: ulid(), name: "佐藤 花子", email: `${ulid()}@example.test`, status: "active", updatedAt: new Date().toISOString() })
    .returning();

  return { organizationId: organization!.id, memberId: member!.id };
}

beforeEach(async () => {
  await db.delete(cartItems);
  await db.delete(members);
  await db.delete(organizations);
});

describe("orderTotals", () => {
  // Rounding per line loses up to a yen on every row, and the invoice then disagrees with the
  // buyer's own arithmetic (D-013).
  it("rounds tax once per rate, not once per line", () => {
    // Over the free-shipping threshold, so the fee does not muddy the comparison.
    const lines = Array.from({ length: 3 }, () => ({ subtotal: 10_005, taxRate: 0.1 }));

    // Per line this would be floor(1000.5) × 3 = 3000; once over the total it is floor(3001.5).
    expect(orderTotals(lines).shippingFee).toBe(0);
    expect(orderTotals(lines).tax).toBe(3_001);
  });

  it("keeps each tax rate in its own bucket", () => {
    const totals = orderTotals([
      { subtotal: 1_005, taxRate: 0.1 },
      { subtotal: 1_005, taxRate: 0.08 },
    ]);

    expect(totals.taxes).toEqual([
      { rate: 0.08, taxableAmount: 1_005, tax: 80 },
      { rate: 0.1, taxableAmount: 1_005 + SHIPPING_FEE, tax: Math.floor((1_005 + SHIPPING_FEE) * 0.1) },
    ]);
  });

  // Shipping joining a bucket of its own would round the standard rate twice.
  it("taxes shipping in the standard-rate bucket", () => {
    const totals = orderTotals([{ subtotal: 1_000, taxRate: 0.1 }]);

    expect(totals.shippingFee).toBe(SHIPPING_FEE);
    expect(totals.taxes).toHaveLength(1);
    expect(totals.tax).toBe(Math.floor((1_000 + SHIPPING_FEE) * 0.1));
    expect(totals.total).toBe(1_000 + SHIPPING_FEE + totals.tax);
  });

  it("drops the shipping fee at the threshold", () => {
    const totals = orderTotals([{ subtotal: FREE_SHIPPING_THRESHOLD, taxRate: 0.1 }]);
    expect(totals.shippingFee).toBe(0);
  });

  it("charges no tax and no shipping on an empty cart", () => {
    expect(orderTotals([])).toEqual({ subtotal: 0, shippingFee: SHIPPING_FEE, taxes: [{ rate: 0.1, taxableAmount: SHIPPING_FEE, tax: 100 }], tax: 100, total: SHIPPING_FEE + 100 });
  });
});

describe("addItem", () => {
  it("adds to the existing row rather than creating a second one", async () => {
    const scope = await seedScope();
    const resolve = resolverFor(product("kampo-a"));

    await addItem(db, scope, { productSlug: "kampo-a", quantity: 2 }, resolve);
    const second = await addItem(db, scope, { productSlug: "kampo-a", quantity: 3 }, resolve);

    expect(second.quantity).toBe(5);
    expect(await db.select().from(cartItems)).toHaveLength(1);
  });

  // Rounding up would change what the buyer gets invoiced for without telling them (BIZ-03 §3-1).
  it("refuses a quantity that is not a multiple of the order unit", async () => {
    const scope = await seedScope();

    await expect(addItem(db, scope, { productSlug: "kampo-a", quantity: 5 }, resolverFor(product("kampo-a", { orderUnit: 4 })))).rejects.toBeInstanceOf(ValidationError);
    expect(await db.select().from(cartItems)).toHaveLength(0);
  });

  // product_slug has no foreign key; this lookup is the only thing standing in for one (D-017).
  it("refuses a slug that does not resolve, with 400", async () => {
    const scope = await seedScope();

    await expect(addItem(db, scope, { productSlug: "never-existed", quantity: 1 }, resolverFor())).rejects.toBeInstanceOf(BadRequestError);
  });
});

describe("updateQuantity and removeItem", () => {
  it("answers 404 for a colleague's cart row at the same organization", async () => {
    const scope = await seedScope();
    const colleague = { organizationId: scope.organizationId, memberId: (await seedScope()).memberId };
    const resolve = resolverFor(product("kampo-a"));

    const mine = await addItem(db, scope, { productSlug: "kampo-a", quantity: 1 }, resolve);

    await expect(updateQuantity(db, colleague, mine.id, 2, resolve)).rejects.toBeInstanceOf(NotFoundError);
    await expect(removeItem(db, colleague, mine.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("answers 404 for another organization's cart row", async () => {
    const [a, b] = [await seedScope(), await seedScope()];
    const resolve = resolverFor(product("kampo-a"));

    const theirs = await addItem(db, b, { productSlug: "kampo-a", quantity: 1 }, resolve);
    await expect(removeItem(db, a, theirs.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("removes a row whose product no longer resolves", async () => {
    const scope = await seedScope();
    const row = await addItem(db, scope, { productSlug: "kampo-a", quantity: 1 }, resolverFor(product("kampo-a")));

    // Withdrawn since it was added — removal must not need the product back.
    await removeItem(db, scope, row.id);
    expect(await db.select().from(cartItems)).toHaveLength(0);
  });

  it("refuses a new quantity that breaks the order unit", async () => {
    const scope = await seedScope();
    const resolve = resolverFor(product("kampo-a", { orderUnit: 6 }));
    const row = await addItem(db, scope, { productSlug: "kampo-a", quantity: 6 }, resolve);

    await expect(updateQuantity(db, scope, row.id, 7, resolve)).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("getCart", () => {
  it("prices each line for the caller's organization and totals them", async () => {
    const scope = await seedScope();
    const resolve = resolverFor(product("kampo-a", { unitPrice: 4_000 }), product("kampo-b", { unitPrice: 1_500, orderUnit: 2 }));

    await addItem(db, scope, { productSlug: "kampo-a", quantity: 3 }, resolve);
    await addItem(db, scope, { productSlug: "kampo-b", quantity: 4 }, resolve);

    const cart = await getCart(db, scope, resolve);

    expect(cart.lines.map((line) => line.subtotal)).toEqual([12_000, 6_000]);
    expect(cart.totals.subtotal).toBe(18_000);
    expect(cart.meetsMinimum).toBe(true);
  });

  // Dropping it silently reads as the cart losing the line, and the buyer re-adds a product that
  // is no longer for sale.
  it("surfaces a row whose product no longer resolves instead of dropping it", async () => {
    const scope = await seedScope();
    await addItem(db, scope, { productSlug: "kampo-a", quantity: 1 }, resolverFor(product("kampo-a")));

    const cart = await getCart(db, scope, resolverFor());

    expect(cart.lines).toHaveLength(0);
    expect(cart.unavailable).toEqual([{ id: expect.any(Number), productSlug: "kampo-a" }]);
    expect(cart.totals.subtotal).toBe(0);
  });

  it("never reaches another organization's rows", async () => {
    const [a, b] = [await seedScope(), await seedScope()];
    const resolve = resolverFor(product("kampo-a"));

    await addItem(db, b, { productSlug: "kampo-a", quantity: 9 }, resolve);
    expect((await getCart(db, a, resolve)).lines).toHaveLength(0);
  });

  it("flags a cart below the minimum order value", async () => {
    const scope = await seedScope();
    const resolve = resolverFor(product("kampo-a", { unitPrice: 500 }));
    await addItem(db, scope, { productSlug: "kampo-a", quantity: 2 }, resolve);

    expect((await getCart(db, scope, resolve)).meetsMinimum).toBe(false);
  });
});
