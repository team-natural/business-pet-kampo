// Shipping addresses belong to the Organization, not to the Member who typed them in: a second
// buyer at the same company must see the same list.
import { shippingAddresses } from "@app/schema";
import type { DbClient } from "@app/schema/client";
import { ulid } from "@app/schema/ulid";
import { NotFoundError } from "@app/server-kit/http";
import { and, count, desc, eq, ne } from "drizzle-orm";
import type { AddressInput } from "../validation/addresses";

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

// Clearing the previous default belongs in the same batch() as setting the new one — D1 has no
// interactive transaction, so two awaited statements can leave two rows flagged (DEV-07 §11-2).
function clearDefault(db: DbClient, organizationId: number, exceptId?: number) {
  const scope = exceptId === undefined ? eq(shippingAddresses.organizationId, organizationId) : and(eq(shippingAddresses.organizationId, organizationId), ne(shippingAddresses.id, exceptId));
  return db.update(shippingAddresses).set({ isDefault: 0, updatedAt: new Date().toISOString() }).where(scope);
}

async function countAddresses(db: DbClient, organizationId: number): Promise<number> {
  const [row] = await db.select({ total: count() }).from(shippingAddresses).where(eq(shippingAddresses.organizationId, organizationId));
  return row?.total ?? 0;
}

export async function createAddress(db: DbClient, organizationId: number, input: AddressInput) {
  const now = new Date().toISOString();
  // The first address is the default whether or not the box was ticked: checkout has to preselect
  // something, and an organization with one address and no default is a dead end (F-06-02).
  const isDefault = input.isDefault === 1 || (await countAddresses(db, organizationId)) === 0 ? 1 : 0;
  const publicId = ulid();

  const insert = db.insert(shippingAddresses).values({ publicId, organizationId, recipientName: input.recipientName, postalCode: input.postalCode, address: input.address, phone: input.phone, isDefault, updatedAt: now });

  if (isDefault === 1) await db.batch([clearDefault(db, organizationId), insert]);
  else await insert;

  return getPublicAddress(db, organizationId, publicId);
}

export async function updateAddress(db: DbClient, organizationId: number, publicId: string, input: AddressInput) {
  const existing = await getAddress(db, organizationId, publicId);
  // The flag is only ever set, never cleared here: unticking the box on the current default would
  // leave the organization with none. Another address is promoted by being ticked itself.
  const isDefault = existing.isDefault === 1 ? 1 : (input.isDefault ?? 0);

  const update = db.update(shippingAddresses).set({ recipientName: input.recipientName, postalCode: input.postalCode, address: input.address, phone: input.phone, isDefault, updatedAt: new Date().toISOString() }).where(eq(shippingAddresses.id, existing.id));

  if (isDefault === 1) await db.batch([clearDefault(db, organizationId, existing.id), update]);
  else await update;

  return getPublicAddress(db, organizationId, publicId);
}

// Past orders are untouched: each one snapshots the address it shipped to (DEV-07 §6-2).
export async function deleteAddress(db: DbClient, organizationId: number, publicId: string): Promise<void> {
  const existing = await getAddress(db, organizationId, publicId);
  const remove = db.delete(shippingAddresses).where(eq(shippingAddresses.id, existing.id));

  if (existing.isDefault !== 1) {
    await remove;
    return;
  }

  // Deleting the default would otherwise leave the organization with addresses but nothing
  // preselected at checkout, which reads as data loss.
  const [successor] = await db
    .select({ id: shippingAddresses.id })
    .from(shippingAddresses)
    .where(and(eq(shippingAddresses.organizationId, organizationId), ne(shippingAddresses.id, existing.id)))
    .orderBy(desc(shippingAddresses.id))
    .limit(1);

  if (!successor) {
    await remove;
    return;
  }

  await db.batch([remove, db.update(shippingAddresses).set({ isDefault: 1, updatedAt: new Date().toISOString() }).where(eq(shippingAddresses.id, successor.id))]);
}

async function getPublicAddress(db: DbClient, organizationId: number, publicId: string) {
  return toPublicAddress(await getAddress(db, organizationId, publicId));
}
