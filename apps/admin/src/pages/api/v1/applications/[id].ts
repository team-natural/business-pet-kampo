// `[id]` is the application's public_id (a ULID).
import type { APIContext } from "astro";
import { jsonItem, toErrorResponse } from "@app/server-kit/http";
import { requireAdminUser } from "$lib/server/auth/access";
import { getApplicationByPublicId } from "$lib/server/services/applications";

export async function GET(context: APIContext): Promise<Response> {
  try {
    await requireAdminUser(context);
    return jsonItem(await getApplicationByPublicId(context.locals.db, context.params.id!));
  } catch (error) {
    return toErrorResponse(error);
  }
}

// TODO(Phase C): PATCH, covering the reviewer, the review memo and sending an application back.
// What the applicant typed is not rewritten here, and `status` is never assigned directly — it
// moves through the transition function (or approve / reject).
export async function PATCH(context: APIContext): Promise<Response> {
  try {
    await requireAdminUser(context);
    return new Response("Not implemented", { status: 501 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
