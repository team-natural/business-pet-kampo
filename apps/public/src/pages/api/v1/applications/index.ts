// A new trading application. Unauthenticated by definition, like the contact form; abuse is
// handled at the edge (WAF rate limiting) rather than here.
import type { APIContext } from "astro";
import { env } from "cloudflare:workers";
import { createDb } from "@app/schema/client";
import { ValidationError, jsonItem, toErrorResponse } from "@app/server-kit/http";
import { ZodError, flattenError } from "zod";
import { notifyApplicationSubmitted, type ApplicationNotificationEnv } from "$lib/server/mail/applications";
import { createApplication, toPublicApplication } from "$lib/server/services/applications";
import { createApplicationSchema } from "$lib/server/validation/applications";

export async function POST({ request, locals }: APIContext): Promise<Response> {
  try {
    const input = createApplicationSchema.parse(await request.json());
    // Throws ConflictError (409) when the posted terms version is not the server's current one
    // (DEV-04 §6-1).
    const application = await createApplication(createDb(env.DB), input);

    // After the write and outside it (DEV-10 §3-4). notifyApplicationSubmitted never throws:
    // the row is already committed, so a missing signing key or an unreachable mail provider
    // must not turn this 201 into a 500.
    locals.cfContext?.waitUntil(notifyApplicationSubmitted(env as ApplicationNotificationEnv, application));

    return jsonItem(toPublicApplication(application), 201);
  } catch (error) {
    if (error instanceof ZodError) {
      return toErrorResponse(new ValidationError(flattenError(error).fieldErrors));
    }
    return toErrorResponse(error);
  }
}
