// Handing an inquiry back to the unassigned inbox (DEV-09 §2-7-3). Separate from reopen.ts: a
// route whose landing state depends on where it started from is one the caller cannot predict.
import type { APIContext } from "astro";
import { jsonItem, toErrorResponse } from "@app/server-kit/http";
import { requireAdminUser } from "$lib/server/auth/access";
import { transitionInquiry } from "$lib/server/services/inquiries";

export async function POST(context: APIContext): Promise<Response> {
  try {
    const admin = await requireAdminUser(context);
    return jsonItem(await transitionInquiry(context.locals.db, context.params.public_id!, "new", admin));
  } catch (error) {
    return toErrorResponse(error);
  }
}
