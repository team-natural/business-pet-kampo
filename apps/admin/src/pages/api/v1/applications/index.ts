import type { APIContext } from "astro";
import { jsonPageCollection, toErrorResponse } from "@app/server-kit/http";
import { requireAdminUser } from "$lib/server/auth/access";
import { type ApplicationStatus, listApplications } from "$lib/server/services/applications";

const STATUSES: ApplicationStatus[] = ["received", "reviewing", "needs_confirmation", "approved", "rejected", "withdrawn"];

export async function GET(context: APIContext): Promise<Response> {
  try {
    await requireAdminUser(context);

    const params = context.url.searchParams;
    const status = params.get("status");
    const { items, page, perPage, total } = await listApplications(context.locals.db, {
      status: STATUSES.includes(status as ApplicationStatus) ? (status as ApplicationStatus) : undefined,
      keyword: params.get("q") ?? undefined,
      page: Number(params.get("page") ?? 1),
      perPage: params.get("per_page") ? Number(params.get("per_page")) : undefined,
    });

    return jsonPageCollection(items, { url: context.url, currentPage: page, perPage, total });
  } catch (error) {
    return toErrorResponse(error);
  }
}
