// Quantity change and removal. `[id]` is the cart_items row id, but every read, update and delete
// still carries organization_id and member_id in its WHERE clause — nobody reaches another
// company's cart, or a colleague's.
import type { APIContext } from "astro";
import { env } from "cloudflare:workers";
import { createDb } from "@app/schema/client";
import { NotFoundError, ValidationError, jsonItem, toErrorResponse } from "@app/server-kit/http";
import { ZodError, flattenError } from "zod";
import { cartProductsFor } from "$lib/catalog";
import { requireOrderableOrganization, requireSession } from "$lib/server/auth/session";
import { removeItem, updateQuantity } from "$lib/server/services/cart";
import { updateCartItemSchema } from "$lib/server/validation/cart";

// The id is an integer primary key, not a ULID: cart rows are never addressed from outside the
// session that owns them (DEV-01 §8).
function rowId(params: APIContext["params"]): number {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) throw new NotFoundError("カートの商品が見つかりません。");
  return id;
}

export async function PATCH({ request, cookies, params }: APIContext): Promise<Response> {
  try {
    const db = createDb(env.DB);
    const session = await requireSession(cookies, db);
    const organization = requireOrderableOrganization(session);

    const { quantity } = updateCartItemSchema.parse(await request.json());
    const item = await updateQuantity(db, { organizationId: organization.id, memberId: session.memberId }, rowId(params), quantity, cartProductsFor({ orgCode: organization.orgCode }));

    return jsonItem(item);
  } catch (error) {
    if (error instanceof ZodError) return toErrorResponse(new ValidationError(flattenError(error).fieldErrors));
    return toErrorResponse(error);
  }
}

export async function DELETE({ cookies, params }: APIContext): Promise<Response> {
  try {
    const db = createDb(env.DB);
    const session = await requireSession(cookies, db);
    const organization = requireOrderableOrganization(session);

    await removeItem(db, { organizationId: organization.id, memberId: session.memberId }, rowId(params));
    return new Response(null, { status: 204 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
