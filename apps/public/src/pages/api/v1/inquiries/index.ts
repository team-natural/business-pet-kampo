// The one unauthenticated write in this template: a contact form is open by definition. Abuse is
// handled at the edge (WAF rate limiting) rather than here, so this route stays a thin parse and
// insert — add an application-level throttle only if the edge rules prove insufficient.
import type { APIContext } from "astro";
import { env } from "cloudflare:workers";
import { createDb } from "@app/schema/client";
import { ValidationError, jsonItem, toErrorResponse } from "@app/server-kit/http";
import { ZodError, flattenError } from "zod";
import { createInquiry } from "$lib/server/services/inquiries";
import { sendMail } from "@app/server-kit/mail";
import { renderInquiryReceived } from "$lib/server/mail/templates/inquiry-received";
import { createInquirySchema } from "$lib/server/validation/inquiries";

export async function POST({ request, locals }: APIContext): Promise<Response> {
  try {
    const input = createInquirySchema.parse(await request.json());
    const created = await createInquiry(createDb(env.DB), input);

    // After the insert and outside it (DEV-10 §3-4): sending first would acknowledge a row that
    // may not exist. waitUntil keeps the visitor's response from waiting on the provider.
    locals.cfContext?.waitUntil(sendMail(env, (context) => renderInquiryReceived({ name: input.name, email: input.email, inquiryType: input.inquiryType ?? null, content: input.content }, context)));

    return jsonItem(created, 201);
  } catch (error) {
    if (error instanceof ZodError) {
      return toErrorResponse(new ValidationError(flattenError(error).fieldErrors));
    }
    return toErrorResponse(error);
  }
}
