import type { APIContext } from "astro";
import { jsonPageCollection, toErrorResponse } from "@app/server-kit/http";
import { requireAdminUser } from "$lib/server/auth/access";
import { type OrderStatus, listOrders } from "$lib/server/services/orders";

const STATUSES: OrderStatus[] = ["received", "confirming", "preparing", "shipped", "completed", "cancelled"];

export async function GET(context: APIContext): Promise<Response> {
  try {
    await requireAdminUser(context);

    const params = context.url.searchParams;
    const status = params.get("status");
    const { items, page, perPage, total } = await listOrders(context.locals.db, {
      status: STATUSES.includes(status as OrderStatus) ? (status as OrderStatus) : undefined,
      page: Number(params.get("page") ?? 1),
      perPage: params.get("per_page") ? Number(params.get("per_page")) : undefined,
    });

    return jsonPageCollection(items, { url: context.url, currentPage: page, perPage, total });
  } catch (error) {
    return toErrorResponse(error);
  }
}
