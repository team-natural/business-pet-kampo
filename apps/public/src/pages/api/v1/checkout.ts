// TODO(S9): placing the order. This is where the minimum-order and order-unit rules are actually
// decided; what the cart screen shows is display, not a decision (DEV-06 §7).
// - one batch() for the orders + order_items + payments INSERTs and the cart_items DELETE
// - snapshot the resolved name, unit price and tax rate onto order_items (DEV-07 §6-0)
// - never take amounts from the body; build the lines with getCart() and read its `totals`, which
//   already come from orderTotals — recomputing them here is how the two disagree
// - accept only a shipping address belonging to this organization, and snapshot it onto the order
// - mail and the payment API go outside the batch(), through ctx.waitUntil()
import type { APIContext } from "astro";
import { env } from "cloudflare:workers";
import { createDb } from "@app/schema/client";
import { toErrorResponse } from "@app/server-kit/http";
import { requireOrderableOrganization, requireSession } from "$lib/server/auth/session";

export async function POST({ cookies }: APIContext): Promise<Response> {
  try {
    requireOrderableOrganization(await requireSession(cookies, createDb(env.DB)));
    return new Response("Not implemented", { status: 501 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
