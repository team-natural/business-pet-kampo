// Taking the application on: received | needs_confirmation -> reviewing. One route per move, so
// the legal transitions are visible in the URL space (D-028).
import type { APIContext } from "astro";
import { jsonItem, toErrorResponse } from "@app/server-kit/http";
import { requireAdminUser } from "$lib/server/auth/access";
import { transitionApplication } from "$lib/server/services/applications";

export async function POST(context: APIContext): Promise<Response> {
  try {
    const admin = await requireAdminUser(context);
    return jsonItem(await transitionApplication(context.locals.db, context.params.public_id!, "reviewing", admin));
  } catch (error) {
    return toErrorResponse(error);
  }
}
