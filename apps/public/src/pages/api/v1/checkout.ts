// Placing the order. The minimum-order and order-unit rules are decided in the service, not on the
// cart screen — what that screen shows is display (DEV-06 §7).
import type { APIContext } from "astro";
import { env } from "cloudflare:workers";
import { createDb } from "@app/schema/client";
import { NotFoundError, ValidationError, jsonItem, toErrorResponse } from "@app/server-kit/http";
import { ZodError, flattenError } from "zod";
import { cartProductsFor } from "$lib/catalog";
import { requireOrderableOrganization, requireSession } from "$lib/server/auth/session";
import { notifyOrderPlaced } from "$lib/server/mail/orders";
import { getMemberByPublicId } from "$lib/server/services/members";
import { placeOrder } from "$lib/server/services/checkout";
import { checkoutSchema } from "$lib/server/validation/checkout";

export async function POST({ request, cookies, locals }: APIContext): Promise<Response> {
  try {
    const db = createDb(env.DB);
    const session = await requireSession(cookies, db);
    // The stricter of the two checks: a suspended partner can read their cart but cannot order
    // (DEV-09 §2-2).
    const organization = requireOrderableOrganization(session);

    const member = await getMemberByPublicId(db, session.memberPublicId);
    if (!member) throw new NotFoundError("アカウントが見つかりません。");

    const input = checkoutSchema.parse(await request.json());
    const order = await placeOrder(db, { organizationId: organization.id, memberId: session.memberId }, input, cartProductsFor({ orgCode: organization.orgCode }));

    // After the batch committed. The buyer already has their order number, so a failed mail must
    // not turn this into a 500 — notifyOrderPlaced never throws.
    locals.cfContext?.waitUntil(
      notifyOrderPlaced(env, {
        ...order,
        contactName: member.name,
        contactEmail: member.email,
        organizationName: organization.name,
        orgCode: organization.orgCode,
      }),
    );

    return jsonItem({ id: order.publicId, orderNumber: order.orderNumber, total: order.total, paymentDueAt: order.paymentDueAt }, 201);
  } catch (error) {
    if (error instanceof ZodError) return toErrorResponse(new ValidationError(flattenError(error).fieldErrors));
    return toErrorResponse(error);
  }
}
