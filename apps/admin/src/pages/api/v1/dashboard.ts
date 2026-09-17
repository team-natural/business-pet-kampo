import type { APIContext } from "astro";
import { jsonItem, toErrorResponse } from "@app/server-kit/http";
import { requireAdminUser } from "$lib/server/auth/access";
import { getDashboardCounts } from "$lib/server/services/dashboard";

export async function GET(context: APIContext): Promise<Response> {
  try {
    await requireAdminUser(context);
    return jsonItem(await getDashboardCounts(context.locals.db));
  } catch (error) {
    return toErrorResponse(error);
  }
}
