import { priceSchema, productSchema } from "@app/content";
import { glob } from "astro/loaders";
import { defineCollection } from "astro:content";

// Only the two collections ADM-15 reads. The admin console has no catalogue screens (D-017), so
// manufacturers, brands and news are deliberately absent — declaring them would suggest there is
// somewhere here to manage them.
//
// Per-organization prices are read-only on that screen: packages/content/prices/*.md is the source
// of truth and the only way to change one is a commit (D-019, DEV-04 §5-4).
const prices = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "../../packages/content/prices" }),
  schema: priceSchema,
});

// Joined to the price entries so the screen can name the product rather than print its slug.
const products = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "../../packages/content/products" }),
  schema: productSchema,
});

export const collections = { prices, products };
