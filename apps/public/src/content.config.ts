import { brandSchema, manufacturerSchema, newsSchema, priceSchema, productSchema } from "@app/content";
import { glob } from "astro/loaders";
import { defineCollection } from "astro:content";

// Files live in packages/content/, not src/content/ — shared with any other app that needs to
// read (not edit) the same developer-maintained content, the same way D1 is shared. The schemas
// come from @app/content so a second reader validates against the same shape.
//
// Read these through src/lib/catalog.ts rather than getCollection() in a page: the draft /
// discontinued / visibility filtering is what gets forgotten (DEV-06 §1-1). Each collection is
// spelled out rather than built by a helper — a wrapper erases the schema and every entry's
// `data` degrades to unknown.
const products = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "../../packages/content/products" }),
  schema: productSchema,
});

const manufacturers = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "../../packages/content/manufacturers" }),
  schema: manufacturerSchema,
});

const brands = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "../../packages/content/brands" }),
  schema: brandSchema,
});

const prices = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "../../packages/content/prices" }),
  schema: priceSchema,
});

const news = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "../../packages/content/news" }),
  schema: newsSchema,
});

export const collections = { products, manufacturers, brands, prices, news };
