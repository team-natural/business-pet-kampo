// The only place the content collections are read (DEV-06 §1-1). Calling getCollection() from a
// page is how a draft, a discontinued product or another organization's price reaches a visitor:
// the filtering is easy to write and easy to forget on one screen out of ten.
import { getCollection, getEntry } from "astro:content";
import { TAX_RATE } from "./commerce";

export type Animal = "dog" | "cat";

// A Member whose organization is active, resolved from the session by the page (PRD-02 §2-3).
// Anonymous visitors pass null and no wholesale price is produced for them.
export interface Viewer {
  orgCode: string;
}

// Category and concern labels are constants rather than Markdown: they are filter labels, not
// prose (D-024). Products reference the `id` from their frontmatter.
export const PRODUCT_CATEGORIES = [
  { id: "joint", label: "関節・足腰" },
  { id: "skin", label: "皮膚・被毛" },
  { id: "digestion", label: "お腹・消化" },
  { id: "urinary", label: "泌尿器" },
  { id: "immune", label: "免疫・体力" },
  { id: "heart", label: "心臓・循環" },
  { id: "mental", label: "ストレス・こころ" },
] as const;

export const CONCERNS = [
  { id: "stiffness", label: "動きが鈍い" },
  { id: "aging", label: "高齢化が気になる" },
  { id: "itch", label: "かゆがる" },
  { id: "hair-loss", label: "毛づやが悪い・抜け毛" },
  { id: "appetite", label: "ごはんが進まない" },
  { id: "diarrhea", label: "お腹がゆるい" },
  { id: "stress", label: "落ち着きがない" },
  { id: "bad-breath", label: "口臭が気になる" },
] as const;

export const ANIMALS = [
  { id: "dog", label: "犬" },
  { id: "cat", label: "猫" },
] as const;

export const categoryLabel = (id: string) => PRODUCT_CATEGORIES.find((category) => category.id === id)?.label ?? id;
export const concernLabel = (id: string) => CONCERNS.find((concern) => concern.id === id)?.label ?? id;

type ProductEntry = Awaited<ReturnType<typeof getCollection<"products">>>[number];
type NewsEntry = Awaited<ReturnType<typeof getCollection<"news">>>[number];

const byOrder = <T extends { id: string; data: { order: number } }>(a: T, b: T) => a.data.order - b.data.order || a.id.localeCompare(b.id);

export interface ProductFilter {
  animal?: Animal;
  category?: string;
  concern?: string;
  keyword?: string;
  // Only the screens that deliberately show withdrawn products (a past order's line) pass this.
  includeDiscontinued?: boolean;
}

export async function listProducts(filter: ProductFilter = {}): Promise<ProductEntry[]> {
  const products = await getCollection("products", ({ data }) => !data.draft && (filter.includeDiscontinued === true || !data.discontinued));
  const keyword = filter.keyword?.trim().toLowerCase();

  return products
    .filter(({ data }) => {
      if (filter.animal && !data.animals.includes(filter.animal)) return false;
      if (filter.category && data.category !== filter.category) return false;
      if (filter.concern && !data.concerns.includes(filter.concern)) return false;
      if (keyword && ![data.name, data.summary, data.code ?? ""].some((field) => field.toLowerCase().includes(keyword))) return false;
      return true;
    })
    .sort(byOrder);
}

// Returns undefined for a draft as well as for a missing file: filtering the listing alone would
// leave the detail URL live (D-018).
export async function getProduct(slug: string, options: { includeDiscontinued?: boolean } = {}): Promise<ProductEntry | undefined> {
  const entry = await getEntry("products", slug);
  if (!entry || entry.data.draft) return undefined;
  if (entry.data.discontinued && options.includeDiscontinued !== true) return undefined;
  return entry;
}

export async function listBrands() {
  return (await getCollection("brands", ({ data }) => !data.draft)).sort(byOrder);
}

export async function getBrand(slug: string) {
  const entry = await getEntry("brands", slug);
  return entry && !entry.data.draft ? entry : undefined;
}

export async function listManufacturers() {
  return (await getCollection("manufacturers", ({ data }) => !data.draft)).sort(byOrder);
}

export async function getManufacturer(slug: string) {
  const entry = await getEntry("manufacturers", slug);
  return entry && !entry.data.draft ? entry : undefined;
}

// Newest first: a news list is read by date, not by the `order` field, which only breaks ties.
const byPublishedDate = (a: NewsEntry, b: NewsEntry) => b.data.publishedDate.getTime() - a.data.publishedDate.getTime() || byOrder(a, b);

const isVisibleTo = (entry: NewsEntry, viewer: Viewer | null) => !entry.data.draft && (entry.data.visibility === "public" || viewer !== null);

export async function listNews(viewer: Viewer | null): Promise<NewsEntry[]> {
  return (await getCollection("news", (entry) => isVisibleTo(entry, viewer))).sort(byPublishedDate);
}

export async function getNewsEntry(slug: string, viewer: Viewer | null): Promise<NewsEntry | undefined> {
  const entry = await getEntry("news", slug);
  return entry && isVisibleTo(entry, viewer) ? entry : undefined;
}

// The viewer's own price file, flattened to slug -> price. Read once per request and passed
// around: resolving per product walks the whole prices collection once per row, which is what
// turns a 60-product listing into 60 scans (DEV-05 §8).
async function overridesFor(viewer: Viewer): Promise<Map<string, number>> {
  const lists = await getCollection("prices", ({ data }) => data.orgCode === viewer.orgCode);
  return new Map(lists.flatMap(({ data }) => data.prices).map((entry) => [entry.product, entry.price]));
}

// Standard wholesale price, overridden by the viewer's own price file when one exists (D-019).
// Anonymous visitors get null — a price must never be produced for someone who cannot see one.
export async function resolveWholesalePrice(product: ProductEntry, viewer: Viewer | null): Promise<number | null> {
  if (!viewer) return null;
  return (await overridesFor(viewer)).get(product.id) ?? product.data.wholesalePrice;
}

// The listing form. Returns prices positionally, so a caller cannot pair a price with the wrong
// product by looking one up under a slug it mistyped.
export async function resolveWholesalePrices(products: ProductEntry[], viewer: Viewer | null): Promise<(number | null)[]> {
  if (!viewer) return products.map(() => null);

  const overrides = await overridesFor(viewer);
  return products.map((product) => overrides.get(product.id) ?? product.data.wholesalePrice);
}

// What the cart and the order need from a product. Narrower than the collection entry on purpose:
// the service layer must not hold a Content Collections type, or it can only be tested with the
// build-time collections present (DEV-05 §1-4).
export interface CartProduct {
  slug: string;
  name: string;
  code: string | null;
  // Already resolved for one organization: its own price file, else the standard one (D-019).
  unitPrice: number;
  orderUnit: number;
  taxRate: number;
}

// The cart's view of a product, for the viewer whose cart it is. Built here because content is
// read outside the service layer (DEV-05 §1-4), and because the price resolution must not be
// repeated anywhere else — a second copy is where the organization override gets forgotten.
//
// A slug that is drafted, withdrawn or gone is simply absent from the map. The cart treats that
// as "no longer orderable" rather than guessing a price for it.
export function cartProductsFor(viewer: Viewer): (slugs: string[]) => Promise<Map<string, CartProduct>> {
  return async (slugs) => {
    const wanted = new Set(slugs);
    if (wanted.size === 0) return new Map();

    const [products, overrides] = await Promise.all([getCollection("products", ({ id, data }) => wanted.has(id) && !data.draft && !data.discontinued), overridesFor(viewer)]);

    return new Map(
      products.map((product) => [
        product.id,
        {
          slug: product.id,
          name: product.data.name,
          code: product.data.code ?? null,
          unitPrice: overrides.get(product.id) ?? product.data.wholesalePrice,
          orderUnit: product.data.orderUnit,
          taxRate: product.data.taxRate ?? TAX_RATE,
        },
      ]),
    );
  };
}

// Every org_code the price files reference. The service layer checks these against
// organizations.org_code, since no foreign key can (D-019).
export async function referencedOrgCodes(): Promise<string[]> {
  return [...new Set((await getCollection("prices")).map(({ data }) => data.orgCode))];
}

// Public URLs only: drafts, client-only news and discontinued products stay out of the sitemap,
// which is the third place the filtering has to happen (D-018).
export async function sitemapPaths(): Promise<string[]> {
  const [products, news] = await Promise.all([listProducts(), listNews(null)]);

  return [...products.map((entry) => `/products/${entry.id}`), ...news.map((entry) => `/news/${entry.id}`)];
}
