// Requesting a password reset.
// TODO(Phase C): issue into member_password_reset_tokens (60 minute expiry — DEV-07 §5-3).
// An unknown address must answer with the same body and in the same time as a known one, or the
// endpoint becomes a membership oracle — the same reason login burns a password verification.
import { toErrorResponse } from "@app/server-kit/http";

export async function POST(): Promise<Response> {
  try {
    return new Response("Not implemented", { status: 501 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
