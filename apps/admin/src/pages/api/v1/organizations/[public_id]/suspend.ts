// Suspending trade (F-07-07). Live sessions are deliberately left alone — the members keep their
// login and lose only the ability to order, which requireActiveOrganization enforces per request
// in apps/public (DEV-09 §2-2-4).
import type { APIContext } from "astro";
import { env } from "cloudflare:workers";
import { ValidationError, jsonItem, toErrorResponse } from "@app/server-kit/http";
import type { MailEnv } from "@app/server-kit/mail";
import { ZodError, flattenError, z } from "zod";
import { requireAdminUser } from "$lib/server/auth/access";
import { changeTradingStatus } from "$lib/server/services/organization-transition";

const suspendSchema = z.object({ reason: z.string().min(1).max(2000) });

export async function POST(context: APIContext): Promise<Response> {
  try {
    const admin = await requireAdminUser(context);
    // Required: the reason is the only record of why trade stopped, and it lands in the audit log.
    const { reason } = suspendSchema.parse(await context.request.json());

    const organization = await changeTradingStatus(context.locals.db, context.params.public_id!, "suspended", {
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
