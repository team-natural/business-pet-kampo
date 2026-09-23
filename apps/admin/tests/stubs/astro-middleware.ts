// `astro:middleware` is a virtual module that only exists inside an Astro build, so vitest cannot
// resolve the import in src/middleware.ts. Aliased here (see vitest.config.ts) to keep the tests
// pointed at the real middleware instead of a copy of its logic that could drift from it.
//
// This mirrors Astro's own implementation: defineMiddleware is an identity function whose only
// job is to infer the handler's parameter types.
import type { MiddlewareHandler } from "astro";

export function defineMiddleware(handler: MiddlewareHandler): MiddlewareHandler {
  return handler;
}
