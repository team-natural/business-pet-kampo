import cloudflare from "@astrojs/cloudflare";
import svelte from "@astrojs/svelte";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

export default defineConfig({
  output: "server",
  // Member sessions live in D1 (member_sessions), so Astro's own session API is unused. Left
  // unset, the adapter wires a Cloudflare KV driver and provisions a `SESSION` namespace on
  // deploy — a binding nothing reads.
  session: false,
  adapter: cloudflare({
    // Shared with apps/admin, as in production.
    persistState: { path: "../../.wrangler-state" },
    // Distinct per app, or both apps fight over 9229. Explicit ports don't auto-fall back.
    inspectorPort: Number(process.env.APP_INSPECTOR_PORT_PUBLIC ?? 9229),
    // The adapter defaults to `cloudflare-binding`, which provisions an Images binding on deploy.
    // Product images are committed static assets, so nothing is transformed at runtime (D-020).
    imageService: "compile",
  }),
  integrations: [svelte()],
  vite: {
    plugins: [tailwindcss()],
    optimizeDeps: {
      exclude: ["@astrojs/svelte/server.js"],
    },
  },
  server: {
    host: true,
    port: Number(process.env.APP_PORT_DEV_PUBLIC ?? 5173),
  },
});
