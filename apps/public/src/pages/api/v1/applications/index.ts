// A new trading application. Unauthenticated by definition, like the contact form; abuse is
// handled at the edge (WAF rate limiting) rather than here.
// TODO(Phase C): validate with createApplicationSchema and compare agreedTermsVersion against
// the server's current constant before storing — a stale form must not record consent to wording
// nobody can reconstruct (DEV-04 §6-1). `status` is server-set to `received`. The acknowledgement
// mail goes out through ctx.waitUntil().
import { toErrorResponse } from "@app/server-kit/http";

export async function POST(): Promise<Response> {
  try {
    return new Response("Not implemented", { status: 501 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
