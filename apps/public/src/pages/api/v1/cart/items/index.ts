// Adding to the cart. product_slug has no foreign key, so the service's resolver lookup is the
// only thing standing in for one (D-017) — a slug that does not resolve is 400, and a quantity
// that is not a multiple of the product's orderUnit is 422 rather than rounded (BIZ-03 §3-1).
import type { APIContext } from "astro";
import { env } from "cloudflare:workers";
import { createDb } from "@app/schema/client";
import { ValidationError, jsonItem, toErrorResponse } from "@app/server-kit/http";
import { ZodError, flattenError } from "zod";
import { cartProductsFor } from "$lib/catalog";
import { requireOrderableOrganization, requireSession } from "$lib/server/auth/session";
import { addItem } from "$lib/server/services/cart";
import { addCartItemSchema } from "$lib/server/validation/cart";

export async function POST({ request, cookies }: APIContext): Promise<Response> {
  try {
    const db = createDb(env.DB);
    const session = await requireSession(cookies, db);
    const organization = requireOrderableOrganization(session);

    const input = addCartItemSchema.parse(await request.json());
    const item = await addItem(db, { organizationId: organization.id, memberId: session.memberId }, input, cartProductsFor({ orgCode: organization.orgCode }));

    return jsonItem(item, 201);
  } catch (error) {
    if (error instanceof ZodError) return toErrorResponse(new ValidationError(flattenError(error).fieldErrors));
    return toErrorResponse(error);
  }
}
