// Account activation: the first password, set after the application was approved.
// TODO(Phase C): verify the activation token, set members.password_hash and issue a session.
// Every way the token can fail answers identically.
import { toErrorResponse } from "@app/server-kit/http";

export async function POST(): Promise<Response> {
  try {
    return new Response("Not implemented", { status: 501 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
