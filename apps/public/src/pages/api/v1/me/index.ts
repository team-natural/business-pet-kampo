// The member's own account. /api/v1/auth/me answers "is this session valid"; this one also edits.
import type { APIContext } from "astro";
import { env } from "cloudflare:workers";
import { createDb } from "@app/schema/client";
import { sendMail } from "@app/server-kit/mail";
import { NotFoundError, ValidationError, jsonItem, toErrorResponse } from "@app/server-kit/http";
import { ZodError, flattenError } from "zod";
import { requireSession } from "$lib/server/auth/session";
import { renderEmailChange } from "$lib/server/mail/templates/email-change";
import { getMemberByPublicId, requestEmailChange, toPublicMember, updateProfile } from "$lib/server/services/members";
import { updateMemberSchema } from "$lib/server/validation/me";

// A Workers Secret, so it is absent from the generated Cloudflare.Env (DEV-10 §1-3).
const secrets = env as typeof env & { SESSION_SIGNING_KEY?: string };

export async function GET({ cookies }: APIContext): Promise<Response> {
  try {
    const db = createDb(env.DB);
    const session = await requireSession(cookies, db);

    const member = await getMemberByPublicId(db, session.memberPublicId);
    if (!member) throw new NotFoundError("アカウントが見つかりません。");

    return jsonItem(toPublicMember(member));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH({ request, cookies, locals }: APIContext): Promise<Response> {
  try {
    const db = createDb(env.DB);
    const session = await requireSession(cookies, db);

    const member = await getMemberByPublicId(db, session.memberPublicId);
    if (!member) throw new NotFoundError("アカウントが見つかりません。");

    const input = updateMemberSchema.parse(await request.json());
    const updated = await updateProfile(db, member.id, input);

    // The address is not written here. An unconfirmed change would redirect every future notice —
    // password resets included — to whoever typed it, so it is applied only once the new address
    // has answered its own confirmation link (F-01-06).
    const emailChangeRequested = input.email !== member.email;
    if (emailChangeRequested) {
      const token = await requestEmailChange(db, secrets.SESSION_SIGNING_KEY, member, input.email);
      locals.cfContext?.waitUntil(sendMail(env, (context) => renderEmailChange({ name: updated.name, newEmail: input.email, confirmUrl: `${context.appUrl}/mypage/email/${token}` }, context)));
    }

    // `pendingEmail` tells the screen to say "confirmation sent" rather than silently showing the
    // old address back.
    return jsonItem({ ...updated, pendingEmail: emailChangeRequested ? input.email : null });
  } catch (error) {
    if (error instanceof ZodError) return toErrorResponse(new ValidationError(flattenError(error).fieldErrors));
    return toErrorResponse(error);
  }
}
