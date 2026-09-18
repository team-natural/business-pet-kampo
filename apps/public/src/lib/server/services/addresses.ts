// Shipping addresses belong to the Organization, not to the Member who typed them in: a second
// buyer at the same company must see the same list.
import { shippingAddresses } from "@app/schema";
import type { DbClient } from "@app/schema/client";
import { NotFoundError } from "@app/server-kit/http";
import { and, desc, eq } from "drizzle-orm";

type ShippingAddressRow = typeof shippingAddresses.$inferSelect;

export function toPublicAddress(row: ShippingAddressRow) {
  return {
    id: row.publicId,
    recipientName: row.recipientName,
    postalCode: row.postalCode,
    address: row.address,
    phone: row.phone,
    isDefault: row.isDefault === 1,
  };
}

// organizationId comes from the session, never from the request — and it is in the WHERE clause
// rather than compared afterwards, so forgetting the comparison cannot widen the result.
export async function listAddresses(db: DbClient, organizationId: number) {
  const rows = await db.select().from(shippingAddresses).where(eq(shippingAddresses.organizationId, organizationId)).orderBy(desc(shippingAddresses.isDefault), desc(shippingAddresses.id));
  return rows.map(toPublicAddress);
}

export async function getAddress(db: DbClient, organizationId: number, publicId: string) {
  const [row] = await db
    .select()
    .from(shippingAddresses)
    .where(and(eq(shippingAddresses.organizationId, organizationId), eq(shippingAddresses.publicId, publicId)))
    .limit(1);

  // Another organization's address is "not found", not "forbidden": the distinction would
  // confirm that the id exists.
  if (!row) throw new NotFoundError("配送先が見つかりません。");
  return row;
}

// TODO(Phase C): createAddress / updateAddress / deleteAddress. Clearing the previous default
// belongs in the same batch() as setting the new one, so only ever one is flagged. Deleting an
// address does not disturb past orders — each order snapshots the address (DEV-07 §6-2).
