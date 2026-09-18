// The applicant withdrawing their own application. No login is involved, so the cancel token is
// the only evidence of who is asking.
// TODO(Phase C): verify the token and transition to `withdrawn`. Expired, already used, forged
// and unknown must all answer identically — a difference confirms an application exists.
import { toErrorResponse } from "@app/server-kit/http";

export async function DELETE(): Promise<Response> {
  try {
    return new Response("Not implemented", { status: 501 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
