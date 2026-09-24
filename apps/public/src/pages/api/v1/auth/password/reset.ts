// Performing the password reset (F-01-04). The token is consumed and the password set in one
// batch(); every other outcome answers alike.
import type { APIContext } from "astro";
import { env } from "cloudflare:workers";
import { createDb } from "@app/schema/client";
import { ValidationError, toErrorResponse } from "@app/server-kit/http";
import { ZodError, flattenError } from "zod";
import { MEMBER_SESSION_COOKIE } from "$lib/server/auth/session";
import { resetPassword } from "$lib/server/services/auth";
import { resetPasswordSchema } from "$lib/server/validation/auth";

export async function POST({ request, cookies }: APIContext): Promise<Response> {
  try {
    const { token, password } = resetPasswordSchema.parse(await request.json());
    await resetPassword(createDb(env.DB), token, password);

    // resetPassword drops every session for the member, including this browser's if it had one.
    // Clearing the cookie keeps the client from sending a token that no longer resolves.
    cookies.delete(MEMBER_SESSION_COOKIE, { path: "/" });

    // No session is issued here, unlike activation: a reset is the flow used when an account may
    // be compromised, so the new password gets typed once more at the login screen.
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof ZodError) return toErrorResponse(new ValidationError(flattenError(error).fieldErrors));
    return toErrorResponse(error);
  }
}
