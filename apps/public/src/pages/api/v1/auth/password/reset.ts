// Performing the password reset.
// TODO(Phase C): verify the token, then stamp used_at and update the password in one batch() —
// if only one of them lands, the token can be replayed. On success, drop every existing session.
import { toErrorResponse } from "@app/server-kit/http";

export async function POST(): Promise<Response> {
  try {
    return new Response("Not implemented", { status: 501 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
