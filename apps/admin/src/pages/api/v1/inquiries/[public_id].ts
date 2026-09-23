// The route parameter is the public_id (a ULID), never the internal integer primary key — that is
// the convention for every route under api/, and the reason the segment is spelled out.
import type { APIContext } from "astro";
import { jsonItem, toErrorResponse } from "@app/server-kit/http";
import { requireAdminUser } from "$lib/server/auth/access";
import { deleteInquiry, getInquiryByPublicId } from "$lib/server/services/inquiries";

export async function GET(context: APIContext): Promise<Response> {
  try {
    await requireAdminUser(context);
    return jsonItem(await getInquiryByPublicId(context.locals.db, context.params.public_id!));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(context: APIContext): Promise<Response> {
  try {
    // AdminUser carries no role (D-014), so the audit entry in deleteInquiry — not a permission
    // check — is what makes this destructive route accountable.
    const admin = await requireAdminUser(context);

    await deleteInquiry(context.locals.db, context.params.public_id!, admin);
    return new Response(null, { status: 204 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
