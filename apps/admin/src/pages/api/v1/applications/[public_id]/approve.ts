// Approval: the heaviest transition here, since one request creates the organization, the first
// member and the membership — all in one batch() (DEV-05 §3).
import type { APIContext } from "astro";
import { env } from "cloudflare:workers";
import { ValidationError, jsonItem, toErrorResponse } from "@app/server-kit/http";
import { ZodError, flattenError } from "zod";
import { requireAdminUser } from "$lib/server/auth/access";
import { notifyApplicationApproved, type ApplicationMailEnv } from "$lib/server/mail/applications";
import { approveApplication } from "$lib/server/services/applications";
import { approveApplicationSchema } from "$lib/server/validation/applications";

export async function POST(context: APIContext): Promise<Response> {
  try {
    const admin = await requireAdminUser(context);
    const input = approveApplicationSchema.parse(await context.request.json());

    const result = await approveApplication(context.locals.db, context.params.public_id!, input, admin);

    // Outside the batch and after it (DEV-10 §3-4). The partner exists either way; the mail only
    // decides whether they are told today.
    // Outside the batch and after it (DEV-10 §3-4). The partner exists either way; the mail only
    // decides whether they are told today.
    context.locals.cfContext?.waitUntil(
      notifyApplicationApproved(env as ApplicationMailEnv, {
        companyName: result.application.companyName,
        contactName: result.application.contactName,
        email: result.memberEmail,
        orgCode: result.orgCode,
        memberPublicId: result.memberPublicId,
      }),
    );

    return jsonItem(result.application);
  } catch (error) {
    if (error instanceof ZodError) return toErrorResponse(new ValidationError(flattenError(error).fieldErrors));
    return toErrorResponse(error);
  }
}
