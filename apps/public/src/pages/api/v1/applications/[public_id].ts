// The applicant withdrawing their own application. No login is involved, so the token carried in
// the body is the only evidence of who is asking.
import type { APIContext } from "astro";
import { env } from "cloudflare:workers";
import { createDb } from "@app/schema/client";
import { toErrorResponse } from "@app/server-kit/http";
import { z } from "zod";
import { withdrawApplication } from "$lib/server/services/applications";

// See the note in ./index.ts: Workers Secrets are absent from the generated Cloudflare.Env.
const secrets = env as typeof env & { SESSION_SIGNING_KEY?: string };

const withdrawSchema = z.object({ token: z.string().min(1).max(512) });

export async function DELETE({ request, params }: APIContext): Promise<Response> {
  try {
    // Every failure answers 204: expired, already withdrawn, forged, unknown id, and success are
    // indistinguishable from outside. A 404 here would confirm which public_ids exist, and a 403
    // would confirm that one exists but the token was wrong (DEV-04 §5-3).
    const parsed = withdrawSchema.safeParse(await request.json().catch(() => null));
    if (parsed.success) {
      await withdrawApplication(createDb(env.DB), secrets.SESSION_SIGNING_KEY, params.public_id!, parsed.data.token);
    }

    return new Response(null, { status: 204 });
  } catch (error) {
    // Only an unexpected fault reaches here; the service swallows every rejection by design.
    return toErrorResponse(error);
  }
}
