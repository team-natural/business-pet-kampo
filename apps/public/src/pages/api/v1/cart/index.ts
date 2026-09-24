// Cart contents. Unit prices are resolved per read (the organization's price file, else the list
// price) rather than stored — a stored price would carry a pre-revision figure into checkout
// (DEV-07 §6-0).
import type { APIContext } from "astro";
import { env } from "cloudflare:workers";
import { createDb } from "@app/schema/client";
import { jsonItem, toErrorResponse } from "@app/server-kit/http";
import { cartProductsFor } from "$lib/catalog";
import { requireActiveOrganization, requireSession } from "$lib/server/auth/session";
import { getCart } from "$lib/server/services/cart";

export async function GET({ cookies }: APIContext): Promise<Response> {
  try {
    const db = createDb(env.DB);
    const session = await requireSession(cookies, db);
    // Readable while ordering is switched off: seeing what is in the cart is not placing an
    // order, and requireOrderableOrganization guards the mutations below (DEV-09 §2-2).
    const organization = requireActiveOrganization(session);

    const cart = await getCart(db, { organizationId: organization.id, memberId: session.memberId }, cartProductsFor({ orgCode: organization.orgCode }));
    return jsonItem(cart);
  } catch (error) {
    return toErrorResponse(error);
  }
}
