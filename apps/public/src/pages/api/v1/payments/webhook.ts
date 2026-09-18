// The payment provider's callback. There is no session here: the signature is the whole of the
// authentication (DEV-10 §2).
// TODO(Phase C):
// - verify the signature before interpreting the body; never trust the JSON first
// - treat a UNIQUE violation on payment_event_logs.provider_event_id as "already handled" and
//   answer 200. That constraint is the idempotency, and it is what stops a redelivery from
//   applying the payment twice (DEV-07 §6-5)
// - answer 200 to unknown event types as well, so the provider stops retrying them
import { toErrorResponse } from "@app/server-kit/http";

export async function POST(): Promise<Response> {
  try {
    return new Response("Not implemented", { status: 501 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
