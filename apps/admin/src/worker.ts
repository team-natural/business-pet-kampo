// A custom Worker entrypoint, because Astro's adapter only exports `fetch` and this app also needs
// `scheduled` for the retention batch (OPS-02 §4-3). From @astrojs/cloudflare v13 the entrypoint is
// declared in wrangler.jsonc's `main`, not through an adapter option.
//
// `fetch` delegates straight to the adapter's handler — nothing is added to the request path, and
// nothing here may change it.
import { handle } from "@astrojs/cloudflare/handler";
import { createDb } from "@app/schema/client";
import { runRetentionBatch } from "./lib/server/services/retention";

export default {
  fetch(request, env, ctx) {
    return handle(request, env, ctx);
  },

  // No request, no operator, and nobody to return an error to — so a failure is logged in the
  // shape the integration logs already use and swallowed, rather than left to become an unhandled
  // rejection the platform reports without context (DEV-10 §8-1).
  async scheduled(controller, env, ctx) {
    const startedAt = Date.now();
    ctx.waitUntil(
      (async () => {
        try {
          const result = await runRetentionBatch(createDb(env.DB));
          console.log(JSON.stringify({ level: "info", message: "Retention batch finished", cron: controller.cron, durationMs: Date.now() - startedAt, ...result }));
        } catch (error) {
          console.error(JSON.stringify({ level: "error", message: "Retention batch failed", cron: controller.cron, reason: error instanceof Error ? error.message : String(error) }));
        }
      })(),
    );
  },
} satisfies ExportedHandler<Env>;
