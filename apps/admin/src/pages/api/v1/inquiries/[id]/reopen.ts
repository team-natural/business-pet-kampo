import type { APIContext } from "astro";
import { jsonItem, toErrorResponse } from "@app/server-kit/http";
import { requireAdminUser } from "$lib/server/auth/access";
import { transitionInquiry } from "$lib/server/services/inquiries";

export async function POST(context: APIContext): Promise<Response> {
  try {
    const admin = await requireAdminUser(context);
    return jsonItem(await transitionInquiry(context.locals.db, context.params.id!, "new", admin));
  } catch (error) {
    return toErrorResponse(error);
  }
}
