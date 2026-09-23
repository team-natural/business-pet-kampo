import type { APIContext } from "astro";
import { jsonItem, toErrorResponse } from "@app/server-kit/http";
import { requireAdminUser } from "$lib/server/auth/access";
import { getOrderByPublicId } from "$lib/server/services/orders";

export async function GET(context: APIContext): Promise<Response> {
  try {
    await requireAdminUser(context);
    return jsonItem(await getOrderByPublicId(context.locals.db, context.params.public_id!));
  } catch (error) {
    return toErrorResponse(error);
  }
}

// TODO(Phase C): PATCH carries shipment details and the memo only. Status moves through one
// sub-route per transition (/confirm, /prepare, /ship, /complete), and an illegal move answers 409
// (DEV-04 §5-7, DEV-09 §2-5). No amount column is accepted — it would disagree with the line
// snapshots (DEV-07 §6-0).
export async function PATCH(context: APIContext): Promise<Response> {
  try {
    await requireAdminUser(context);
    return new Response("Not implemented", { status: 501 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
