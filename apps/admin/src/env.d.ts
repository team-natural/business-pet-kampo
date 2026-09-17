// Cloudflare binding types come from the generated worker-configuration.d.ts (`wrangler types`).
// Declared here is what the adapter and middleware.ts put on Astro.locals, which no generator
// produces: handlers read the identity from here rather than from the request headers (D-022).
declare namespace App {
  interface Locals {
    // Set by @astrojs/cloudflare. `cfContext.access` is present only when Access authenticated
    // the request *and* the Worker is not behind the static-asset router (D-029).
    cfContext?: ExecutionContext;
    accessEmail: string | null;
    db: import("@app/schema/client").DbClient;
  }
}
