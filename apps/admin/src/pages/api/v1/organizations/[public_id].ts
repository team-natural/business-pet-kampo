import type { APIContext } from "astro";
import { ValidationError, jsonItem, toErrorResponse } from "@app/server-kit/http";
import { ZodError, flattenError } from "zod";
import { requireAdminUser } from "$lib/server/auth/access";
import { getOrganizationByPublicId, updateOrganization } from "$lib/server/services/organizations";
import { updateOrganizationSchema } from "$lib/server/validation/organizations";

export async function GET(context: APIContext): Promise<Response> {
  try {
    await requireAdminUser(context);
    return jsonItem(await getOrganizationByPublicId(context.locals.db, context.params.public_id!));
  } catch (error) {
    return toErrorResponse(error);
  }
}

// Details and the order-enabled flag. Neither `status` nor `org_code` arrives in a body: the first
// moves only through the transition routes, the second never moves at all (D-019).
export async function PATCH(context: APIContext): Promise<Response> {
  try {
    const admin = await requireAdminUser(context);
    const input = updateOrganizationSchema.parse(await context.request.json());

    return jsonItem(await updateOrganization(context.locals.db, context.params.public_id!, input, admin));
  } catch (error) {
    if (error instanceof ZodError) return toErrorResponse(new ValidationError(flattenError(error).fieldErrors));
    return toErrorResponse(error);
  }
}
