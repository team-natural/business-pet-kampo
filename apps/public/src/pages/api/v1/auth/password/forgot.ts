// Requesting a password reset (F-01-04). Unauthenticated, and deliberately uninformative: the
// response is identical whether or not the address belongs to an account, or this endpoint
// becomes a membership oracle (DEV-02 §7).
import type { APIContext } from "astro";
import { env } from "cloudflare:workers";
import { createDb } from "@app/schema/client";
import { assertNotLockedOut, recordAuthFailure } from "@app/server-kit/auth";
import { sendMail } from "@app/server-kit/mail";
import { ValidationError, toErrorResponse } from "@app/server-kit/http";
import { ZodError, flattenError } from "zod";
import { renderPasswordReset } from "$lib/server/mail/templates/password-reset";
import { PASSWORD_RESET_TTL_MINUTES, requestPasswordReset } from "$lib/server/services/auth";
import { forgotPasswordSchema } from "$lib/server/validation/auth";

export async function POST({ request, locals, clientAddress }: APIContext): Promise<Response> {
  try {
    const { email } = forgotPasswordSchema.parse(await request.json());

    const ip = request.headers.get("cf-connecting-ip") ?? clientAddress;
    await assertNotLockedOut(env.KV, ip, email);
    // Counted on every request, not only on failures: from outside there are no failures here, and
    // an uncounted endpoint that sends mail is a way to flood someone's inbox (DEV-02 §7).
    await recordAuthFailure(env.KV, ip, email, { maxAttempts: Number(env.AUTH_LOCKOUT_MAX_ATTEMPTS), lockoutMinutes: Number(env.AUTH_LOCKOUT_MINUTES) });

    const issued = await requestPasswordReset(createDb(env.DB), email);
    if (issued) {
      locals.cfContext?.waitUntil(sendMail(env, (context) => renderPasswordReset({ name: issued.member.name, email: issued.member.email, resetUrl: `${context.appUrl}/login/reset/${issued.token}`, expiresInMinutes: PASSWORD_RESET_TTL_MINUTES }, context)));
    }

    // 204 either way. The branch above changes what is sent, never what is answered.
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof ZodError) return toErrorResponse(new ValidationError(flattenError(error).fieldErrors));
    // A 429 from the lockout does reach the caller — that is a property of the IP, not of the
    // address, so it discloses nothing about who has an account.
    return toErrorResponse(error);
  }
}
