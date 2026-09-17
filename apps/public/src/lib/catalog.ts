// The only place the content collections are read (DEV-06 §1-1). Calling getCollection() from a
// page is how a draft, a discontinued product or another organization's price reaches a visitor:
// the filtering is easy to write and easy to forget on one screen out of ten.
import { getCollection, getEntry } from "astro:content";

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
  { id: "appetite", label: "food が進まない" },
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

// Standard wholesale price, overridden by the viewer's own price file when one exists (D-019).
// Anonymous visitors get null — a price must never be produced for someone who cannot see one.
export async function resolveWholesalePrice(product: ProductEntry, viewer: Viewer | null): Promise<number | null> {
  if (!viewer) return null;

  const lists = await getCollection("prices", ({ data }) => data.orgCode === viewer.orgCode);
  const override = lists.flatMap(({ data }) => data.prices).find((entry) => entry.product === product.id);

  return override?.price ?? product.data.wholesalePrice;
}

// Every org_code the price files reference. The service layer checks these against
// organizations.org_code, since no foreign key can (D-019).
export async function referencedOrgCodes(): Promise<string[]> {
  return [...new Set((await getCollection("prices")).map(({ data }) => data.orgCode))];
}

// Public URLs only: drafts, client-only news and discontinued products stay out of the sitemap,
// which is the third place the filtering has to happen (D-018).
export async function sitemapPaths(): Promise<string[]> {
  const [products, news, brands] = await Promise.all([listProducts(), listNews(null), listBrands()]);

  return [...products.map((entry) => `/products/${entry.id}`), ...news.map((entry) => `/news/${entry.id}`), ...brands.map((entry) => `/brands/${entry.id}`)];
}
