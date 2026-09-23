// Cloudflare binding types come from the generated worker-configuration.d.ts (`wrangler types`).
// Declared here is only what the adapter puts on Astro.locals, which no generator produces.
declare namespace App {
  interface Locals {
    // Set by @astrojs/cloudflare. Routes use `cfContext.waitUntil()` to run notification sends
    // after the response (DEV-05 §4).
    cfContext?: ExecutionContext;
  }
}
