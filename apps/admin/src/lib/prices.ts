// The per-organization price list ADM-15 displays (F-07-10). Read-only by design: the source of
// truth is packages/content/prices/*.md and the only way to change one is a commit (D-019).
//
// Not in lib/server/: Content Collections resolve at build time, so this never touches D1 and sits
// outside the service layer's authz boundary (DEV-05 §1-4).
import { getCollection } from "astro:content";

export interface AppliedPrice {
  productSlug: string;
  productName: string;
  price: number;
  // The catalogue's own price, shown alongside so the operator can see what was overridden.
  listPrice: number | null;
  discontinued: boolean;
}

export async function listAppliedPrices(orgCode: string): Promise<AppliedPrice[]> {
  const lists = await getCollection("prices", ({ data }) => data.orgCode === orgCode);
  if (lists.length === 0) return [];

  const products = await getCollection("products");
  const bySlug = new Map(products.map((entry) => [entry.id, entry]));

  return lists
    .flatMap(({ data }) => data.prices)
    .map((entry) => {
      const product = bySlug.get(entry.product);
      return {
        productSlug: entry.product,
        // A price file can outlive the product it names — no foreign key connects them (D-019), so
        // the slug stands in rather than the row disappearing from the screen.
        productName: product?.data.name ?? entry.product,
        price: entry.price,
        listPrice: product?.data.wholesalePrice ?? null,
        discontinued: product?.data.discontinued === true,
      };
    })
    .sort((a, b) => a.productName.localeCompare(b.productName, "ja"));
}
