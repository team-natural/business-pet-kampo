// TODO(Phase C): adding to the cart. Validate the shape with addCartItemSchema, then confirm the
// product exists through catalog.ts — product_slug has no foreign key, and that check is the only
// thing standing in for one (D-017). Reject a quantity that is not a multiple of the orderUnit.
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
