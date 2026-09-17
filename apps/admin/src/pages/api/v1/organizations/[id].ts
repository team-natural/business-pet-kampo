import type { APIContext } from "astro";
import { jsonItem, toErrorResponse } from "@app/server-kit/http";
import { requireAdminUser } from "$lib/server/auth/access";
import { getOrganizationByPublicId } from "$lib/server/services/organizations";

export async function GET(context: APIContext): Promise<Response> {
  try {
    await requireAdminUser(context);
    return jsonItem(await getOrganizationByPublicId(context.locals.db, context.params.id!));
  } catch (error) {
    return toErrorResponse(error);
  }
}

// TODO(Phase C): PATCH。updateOrganizationSchema の列だけを書く。org_code と status はここから
// 変更しない（前者は価格ファイルの参照キー、後者は遷移関数の管轄）。
export async function PATCH(context: APIContext): Promise<Response> {
  try {
    await requireAdminUser(context);
    return new Response("Not implemented", { status: 501 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
