// Ending the trading relationship (F-07-08). Terminal: trading again starts from a new application
// (DEV-09 §2-2-2). The transition suspends every membership and stamps the retention clock in the
// same batch.
import type { APIContext } from "astro";
import { env } from "cloudflare:workers";
import { ValidationError, jsonItem, toErrorResponse } from "@app/server-kit/http";
import type { MailEnv } from "@app/server-kit/mail";
import { ZodError, flattenError } from "zod";
import { requireAdminUser } from "$lib/server/auth/access";
import { changeTradingStatus } from "$lib/server/services/organization-transition";
import { terminateOrganizationSchema } from "$lib/server/validation/organizations";

export async function POST(context: APIContext): Promise<Response> {
  try {
    const admin = await requireAdminUser(context);
    const { reason } = terminateOrganizationSchema.parse(await context.request.json());

    const organization = await changeTradingStatus(context.locals.db, context.params.public_id!, "terminated", {
      admin,
      reason,
      env: env as MailEnv,
      defer: (task) => context.locals.cfContext?.waitUntil(task),
    });

    return jsonItem(organization);
  } catch (error) {
    if (error instanceof ZodError) return toErrorResponse(new ValidationError(flattenError(error).fieldErrors));
    return toErrorResponse(error);
  }
}
