// Resuming trade (F-07-07). order_enabled goes back to 1 inside the transition, so nothing here
// has to remember to flip it.
import type { APIContext } from "astro";
import { env } from "cloudflare:workers";
import { jsonItem, toErrorResponse } from "@app/server-kit/http";
import type { MailEnv } from "@app/server-kit/mail";
import { requireAdminUser } from "$lib/server/auth/access";
import { changeTradingStatus } from "$lib/server/services/organization-transition";

export async function POST(context: APIContext): Promise<Response> {
  try {
    const admin = await requireAdminUser(context);

    const organization = await changeTradingStatus(context.locals.db, context.params.public_id!, "active", {
      admin,
      env: env as MailEnv,
      defer: (task) => context.locals.cfContext?.waitUntil(task),
    });

    return jsonItem(organization);
  } catch (error) {
    return toErrorResponse(error);
  }
}
