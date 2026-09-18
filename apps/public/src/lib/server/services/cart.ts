// The cart lives in D1 rather than in localStorage so the same buyer sees it from another device
// (DEV-06 §2). Prices are not stored here — they are resolved from packages/content on every
// read, and only frozen when the order is placed (DEV-07 §6-0).
import { cartItems } from "@app/schema";
import type { DbClient } from "@app/schema/client";
import { and, eq } from "drizzle-orm";

type CartItemRow = typeof cartItems.$inferSelect;

export function toPublicCartItem(row: CartItemRow) {
  return {
    id: row.id,
    productSlug: row.productSlug,
    quantity: row.quantity,
  };
}

// Scoped by organization and member: two buyers at the same company keep separate carts, and the
// organization_id keeps the query inside the tenant boundary either way.
export async function listCartItems(db: DbClient, organizationId: number, memberId: number) {
  const rows = await db
    .select()
    .from(cartItems)
    .where(and(eq(cartItems.organizationId, organizationId), eq(cartItems.memberId, memberId)))
    .orderBy(cartItems.id);
  return rows.map(toPublicCartItem);
}

// TODO(Phase C): addItem / updateQuantity / removeItem, plus a getCart that carries unit prices.
// - product_slug has no foreign key. Confirm the product resolves through catalog.getProduct on
//   add, and refuse with 400 when it does not (DEV-06 §1-1)
// - do not round a quantity to the product's orderUnit; refuse a quantity that is not a multiple
//   of it (BIZ-03 §3-1)
// - resolve unit prices per read with resolveWholesalePrice (organization price, else list price)
