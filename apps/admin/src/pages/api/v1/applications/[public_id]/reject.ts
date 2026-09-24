// Rejection. The reason is required: it is what the applicant is told, and the audit entry is the
// only place it is stored (DEV-09 §2-1).
import type { APIContext } from "astro";
import { env } from "cloudflare:workers";
import { ValidationError, jsonItem, toErrorResponse } from "@app/server-kit/http";
import { ZodError, flattenError } from "zod";
import { requireAdminUser } from "$lib/server/auth/access";
import { notifyApplicationRejected, type ApplicationMailEnv } from "$lib/server/mail/applications";
import { rejectApplication } from "$lib/server/services/applications";
import { rejectApplicationSchema } from "$lib/server/validation/applications";

export async function POST(context: APIContext): Promise<Response> {
  try {
    const admin = await requireAdminUser(context);
    const input = rejectApplicationSchema.parse(await context.request.json());

    const application = await rejectApplication(context.locals.db, context.params.public_id!, input, admin);

    context.locals.cfContext?.waitUntil(
      notifyApplicationRejected(env as ApplicationMailEnv, {
        companyName: application.companyName,
        contactName: application.contactName,
        email: application.email,
        reason: input.reason,
      }),
    );

    return jsonItem(application);
  } catch (error) {
    if (error instanceof ZodError) return toErrorResponse(new ValidationError(flattenError(error).fieldErrors));
    return toErrorResponse(error);
  }
}
