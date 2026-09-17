import { z } from "zod";

// The source of truth for every piece of public content (D-017〜D-019). There is no admin screen
// and no D1 table behind any of this — a change here is a commit and a deploy.
//
// The collection entry's id (its filename) is the slug. Past orders, the diagnosis rules and the
// public URL all reference it, so renaming a file is a breaking change (DEV-06 §1-1).

// Shared by everything that can be held back from the site. `draft` is not "unfinished": it is
// the only thing keeping the entry out of the listing, the detail page and the sitemap.
const publishable = {
  draft: z.boolean().default(false),
  // Lower sorts first; ties fall back to the slug.
  order: z.number().int().default(100),
};

export const manufacturerSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  website: z.url().optional(),
  ...publishable,
});

export const brandSchema = z.object({
  name: z.string().min(1),
  // A manufacturer entry's slug. No foreign key exists, so catalog.ts resolves it and the unit
  // tests assert every brand resolves.
  manufacturer: z.string().min(1),
  description: z.string().optional(),
  ...publishable,
});

const productImageSchema = z.object({
  // Relative to apps/public/src/assets/img so astro:assets can optimize it at build time (D-020).
  src: z.string().min(1),
  alt: z.string().min(1),
});

export const productSchema = z.object({
  name: z.string().min(1),
  // Printed on the order and snapshotted onto order_items, so it stays stable across revisions.
  code: z.string().optional(),
  brand: z.string().min(1),
  manufacturer: z.string().min(1),
  // Ids from apps/public/src/lib/catalog.ts's constants, not free text (D-024).
  category: z.string().min(1),
  concerns: z.array(z.string()).default([]),
  animals: z.array(z.enum(["dog", "cat"])).min(1),
  summary: z.string().min(1),
  ingredients: z.string().optional(),
  usage: z.string().optional(),
  volume: z.string().optional(),
  // Tax-exclusive yen. The standard wholesale price; a per-organization file overrides it (D-019).
  wholesalePrice: z.number().int().nonnegative(),
  suggestedRetailPrice: z.number().int().nonnegative().optional(),
  // How many units one order line is counted in (入数).
  orderUnit: z.number().int().positive().default(1),
  // Only set it where the rate differs from lib/commerce.ts's default.
  taxRate: z.number().optional(),
  images: z.array(productImageSchema).default([]),
  // Withdrawn from sale but still referenced by past orders — delete the file and the history
  // still reads, because order_items snapshots the name and price (DEV-07 §6-0).
  discontinued: z.boolean().default(false),
  ...publishable,
});

// One file per trading partner, named after the org_code it applies to.
export const priceSchema = z.object({
  // organizations.org_code. Nothing in D1 enforces this; the service layer verifies it exists
  // and a unit test pins that every entry resolves (D-019).
  orgCode: z.string().min(1),
  note: z.string().optional(),
  prices: z
    .array(
      z.object({
        product: z.string().min(1),
        price: z.number().int().nonnegative(),
      }),
    )
    .min(1),
});

export const newsSchema = z.object({
  title: z.string().min(1),
  publishedDate: z.coerce.date(),
  // client_only is filtered by the session, which is why the news pages cannot be prerendered
  // (D-021).
  visibility: z.enum(["public", "client_only"]).default("public"),
  summary: z.string().optional(),
  ...publishable,
});

export type Manufacturer = z.infer<typeof manufacturerSchema>;
export type Brand = z.infer<typeof brandSchema>;
export type Product = z.infer<typeof productSchema>;
export type PriceList = z.infer<typeof priceSchema>;
export type News = z.infer<typeof newsSchema>;
