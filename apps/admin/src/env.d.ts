// Cloudflare binding types come from the generated worker-configuration.d.ts (`wrangler types`).
// Only Astro.locals is declared here: middleware.ts fills it, handlers read it instead of the
// Cf-Access-Jwt-Assertion header (D-022).
declare namespace App {
  interface Locals {
    accessEmail: string | null;
    db: import("@app/schema/client").DbClient;
  }
}
