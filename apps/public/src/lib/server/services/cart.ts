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

// TODO(Phase C): addItem / updateQuantity / removeItem と、明細に単価を載せた getCart。
// - product_slug に外部キーは無い。追加時に catalog.getProduct で存在を確認し、解決できなければ
//   400 で拒否する（DEV-06 §1-1）
// - 数量は商品の orderUnit の倍数に丸めず、倍数でなければ拒否する（BIZ-03 §3-1）
// - 単価は resolveWholesalePrice（取引先別価格 → 標準卸価格）で都度解決する
