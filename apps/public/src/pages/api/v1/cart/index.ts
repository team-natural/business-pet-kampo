// Cart contents. Unit prices are resolved per read (the organization's price file, else the list
// price) rather than stored — a stored price would carry a pre-revision figure into checkout
// (DEV-07 §6-0).
import type { APIContext } from "astro";
import { env } from "cloudflare:workers";
import { createDb } from "@app/schema/client";
import { jsonItem, toErrorResponse } from "@app/server-kit/http";
import { requireActiveOrganization, requireSession } from "$lib/server/auth/session";
import { listCartItems } from "$lib/server/services/cart";

export async function GET({ cookies }: APIContext): Promise<Response> {
  try {
    const db = createDb(env.DB);
    const session = await requireSession(cookies, db);
    const organization = requireActiveOrganization(session);

    // TODO(Phase C): return unit prices, subtotal, tax, shipping and total (DEV-04 §5-5).
    return jsonItem(await listCartItems(db, organization.id, session.memberId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
