// The cart lives in D1 rather than in localStorage so the same buyer sees it from another device
// (DEV-06 §2). Prices are not stored here — they are resolved from packages/content on every
// read, and only frozen when the order is placed (DEV-07 §6-0).
import { cartItems } from "@app/schema";
import type { DbClient } from "@app/schema/client";
import { BadRequestError, NotFoundError, ValidationError } from "@app/server-kit/http";
import { and, eq, inArray } from "drizzle-orm";
// Type-only, so nothing here pulls in astro:content at runtime: content is read outside the
// service layer and handed in through ProductResolver (DEV-05 §1-4).
import type { CartProduct } from "$lib/catalog";
import { MINIMUM_ORDER_SUBTOTAL, orderTotals } from "$lib/commerce";
import type { AddCartItemInput } from "../validation/cart";

type CartItemRow = typeof cartItems.$inferSelect;

// Who the cart belongs to. Passed as one value because every query needs both halves, and a
// signature that takes them separately is one a caller can transpose.
export interface CartScope {
  organizationId: number;
  memberId: number;
}

// Returns only the slugs that resolve. A slug missing from the map is a product that is drafted,
// withdrawn or gone — product_slug has no foreign key, and this is the only thing standing in for
// one (D-017).
export type ProductResolver = (slugs: string[]) => Promise<Map<string, CartProduct>>;

export function toPublicCartItem(row: CartItemRow) {
  return {
    id: row.id,
    productSlug: row.productSlug,
    quantity: row.quantity,
  };
}

const scopeOf = (scope: CartScope) => and(eq(cartItems.organizationId, scope.organizationId), eq(cartItems.memberId, scope.memberId));

// Scoped by organization and member: two buyers at the same company keep separate carts, and the
// organization_id keeps the query inside the tenant boundary either way.
export async function listCartItems(db: DbClient, organizationId: number, memberId: number) {
  const rows = await db.select().from(cartItems).where(scopeOf({ organizationId, memberId })).orderBy(cartItems.id);
  return rows.map(toPublicCartItem);
}

export interface CartLine extends CartProduct {
  id: number;
  quantity: number;
  subtotal: number;
}

export interface Cart {
  lines: CartLine[];
  // Rows whose product no longer resolves. Surfaced rather than dropped: a line that vanishes
  // silently looks like the cart lost it, and the buyer re-adds a product that is withdrawn.
  unavailable: { id: number; productSlug: string }[];
  totals: ReturnType<typeof orderTotals>;
  meetsMinimum: boolean;
}

export async function getCart(db: DbClient, scope: CartScope, resolveProducts: ProductResolver): Promise<Cart> {
  const rows = await db.select().from(cartItems).where(scopeOf(scope)).orderBy(cartItems.id);
  const products = await resolveProducts(rows.map((row) => row.productSlug));

  const lines: CartLine[] = [];
  const unavailable: Cart["unavailable"] = [];

  for (const row of rows) {
    const product = products.get(row.productSlug);
    if (!product) {
      unavailable.push({ id: row.id, productSlug: row.productSlug });
      continue;
    }
    lines.push({ ...product, id: row.id, quantity: row.quantity, subtotal: product.unitPrice * row.quantity });
  }

  const totals = orderTotals(lines);
  return { lines, unavailable, totals, meetsMinimum: totals.subtotal >= MINIMUM_ORDER_SUBTOTAL };
}

// Not rounded up to the next multiple: silently changing what someone asked for is worse than
// refusing it, because the quantity is what they get invoiced for (BIZ-03 §3-1, D-013).
function requireOrderUnitMultiple(quantity: number, product: CartProduct) {
  if (quantity % product.orderUnit !== 0) {
    throw new ValidationError({ quantity: [`${product.name} は ${product.orderUnit} の倍数でご注文ください。`] });
  }
}

async function requireProduct(slug: string, resolveProducts: ProductResolver): Promise<CartProduct> {
  const product = (await resolveProducts([slug])).get(slug);
  // 400, not 404: the slug arrived in a request body, so this is a bad request rather than a
  // missing page (DEV-04 §4).
  if (!product) throw new BadRequestError("現在お取り扱いのない商品です。");
  return product;
}

// Adding a product already in the cart adds to it rather than replacing it — that is what the
// UNIQUE (organization_id, member_id, product_slug) index is there for.
export async function addItem(db: DbClient, scope: CartScope, input: AddCartItemInput, resolveProducts: ProductResolver) {
  const product = await requireProduct(input.productSlug, resolveProducts);
  requireOrderUnitMultiple(input.quantity, product);

  const now = new Date().toISOString();
  const [existing] = await db
    .select()
    .from(cartItems)
    .where(and(scopeOf(scope), eq(cartItems.productSlug, input.productSlug)))
    .limit(1);

  const [row] = existing
    ? await db
        .update(cartItems)
        .set({ quantity: existing.quantity + input.quantity, updatedAt: now })
        .where(eq(cartItems.id, existing.id))
        .returning()
    : await db.insert(cartItems).values({ organizationId: scope.organizationId, memberId: scope.memberId, productSlug: input.productSlug, quantity: input.quantity, updatedAt: now }).returning();

  return toPublicCartItem(row!);
}

// The row id is in the URL, but the scope stays in the WHERE clause: another company's cart — or
// a colleague's — is "not found", never "forbidden" (DEV-02 §3-1).
async function requireRow(db: DbClient, scope: CartScope, id: number): Promise<CartItemRow> {
  const [row] = await db
    .select()
    .from(cartItems)
    .where(and(scopeOf(scope), eq(cartItems.id, id)))
    .limit(1);

  if (!row) throw new NotFoundError("カートの商品が見つかりません。");
  return row;
}

export async function updateQuantity(db: DbClient, scope: CartScope, id: number, quantity: number, resolveProducts: ProductResolver) {
  const row = await requireRow(db, scope, id);
  const product = await requireProduct(row.productSlug, resolveProducts);
  requireOrderUnitMultiple(quantity, product);

  const [updated] = await db.update(cartItems).set({ quantity, updatedAt: new Date().toISOString() }).where(eq(cartItems.id, row.id)).returning();
  return toPublicCartItem(updated!);
}

// Removal does not check the product: a withdrawn product is exactly what a buyer needs to be
// able to take out of their cart.
export async function removeItem(db: DbClient, scope: CartScope, id: number): Promise<void> {
  const row = await requireRow(db, scope, id);
  await db.delete(cartItems).where(eq(cartItems.id, row.id));
}

// Used by checkout (S9) after the order is written, and by the screens that clear what can no
// longer be ordered.
export async function removeItems(db: DbClient, scope: CartScope, ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await db.delete(cartItems).where(and(scopeOf(scope), inArray(cartItems.id, ids)));
}
