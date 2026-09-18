import type { APIContext } from "astro";
import { jsonItem, toErrorResponse } from "@app/server-kit/http";
import { requireAdminUser } from "$lib/server/auth/access";
import { getOrganizationByPublicId } from "$lib/server/services/organizations";

export async function GET(context: APIContext): Promise<Response> {
  try {
    await requireAdminUser(context);
    return jsonItem(await getOrganizationByPublicId(context.locals.db, context.params.id!));
  } catch (error) {
    return toErrorResponse(error);
  }
}

// TODO(Phase C): PATCH, writing only the columns in updateOrganizationSchema. Neither org_code nor
// status changes here — the price files reference the first, and a transition function owns the
// second.
export async function PATCH(context: APIContext): Promise<Response> {
  try {
    await requireAdminUser(context);
    return new Response("Not implemented", { status: 501 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
