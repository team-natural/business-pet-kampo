// ADM-16 is read-only: no create, edit, delete or password change for members (PRD-04 §3-2).
import type { APIContext } from "astro";
import { jsonItem, toErrorResponse } from "@app/server-kit/http";
import { requireAdminUser } from "$lib/server/auth/access";
import { findOrganizationRow, listOrganizationMembers } from "$lib/server/services/organizations";

export async function GET(context: APIContext): Promise<Response> {
  try {
    await requireAdminUser(context);

    const organization = await findOrganizationRow(context.locals.db, context.params.id!);
    return jsonItem(await listOrganizationMembers(context.locals.db, organization.id));
  } catch (error) {
    return toErrorResponse(error);
  }
}
