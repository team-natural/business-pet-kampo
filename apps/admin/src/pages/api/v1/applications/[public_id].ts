import type { APIContext } from "astro";
import { ValidationError, jsonItem, toErrorResponse } from "@app/server-kit/http";
import { ZodError, flattenError } from "zod";
import { requireAdminUser } from "$lib/server/auth/access";
import { getApplicationByPublicId, updateReview } from "$lib/server/services/applications";
import { reviewApplicationSchema } from "$lib/server/validation/applications";

export async function GET(context: APIContext): Promise<Response> {
  try {
    await requireAdminUser(context);
    return jsonItem(await getApplicationByPublicId(context.locals.db, context.params.public_id!));
  } catch (error) {
    return toErrorResponse(error);
  }
}

// The review memo only. What the applicant typed is not rewritten here, and `status` never arrives
// in a body — each move has its own route (D-028, DEV-09 §2-1-3).
export async function PATCH(context: APIContext): Promise<Response> {
  try {
    const admin = await requireAdminUser(context);
    const input = reviewApplicationSchema.parse(await context.request.json());

    return jsonItem(await updateReview(context.locals.db, context.params.public_id!, input, admin));
  } catch (error) {
    if (error instanceof ZodError) return toErrorResponse(new ValidationError(flattenError(error).fieldErrors));
    return toErrorResponse(error);
  }
}
