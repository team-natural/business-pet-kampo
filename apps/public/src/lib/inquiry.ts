// The inquiry type master (D-024). `id` is what inquiries.inquiry_type stores, so an id is
// immutable once it has been used — reword the label instead, or past rows stop resolving.
export const INQUIRY_TYPES = [
  { id: "new_account", label: "新規取引・お取引条件について" },
  { id: "product", label: "商品について" },
  { id: "order", label: "ご発注・納期について" },
  { id: "billing", label: "請求・お支払いについて" },
  { id: "shipping", label: "配送・返品について" },
  { id: "other", label: "その他" },
] as const;

export type InquiryTypeId = (typeof INQUIRY_TYPES)[number]["id"];

// Tuple-typed so Zod can take it as an enum (z.enum needs a non-empty literal tuple).
export const INQUIRY_TYPE_IDS = INQUIRY_TYPES.map((type) => type.id) as [InquiryTypeId, ...InquiryTypeId[]];

export function inquiryTypeLabel(id: string | null): string | null {
  return INQUIRY_TYPES.find((type) => type.id === id)?.label ?? null;
}
