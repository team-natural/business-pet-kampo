// FAQ content (D-024). Structured data filtered by category rather than prose, which is why it is
// a constant and not Markdown. Amounts are never written out here — /faq renders them from
// commerce.ts so the answer cannot drift from the cart.
export const FAQ_CATEGORIES = [
  { id: "account", label: "お取引・アカウント" },
  { id: "order", label: "ご発注・お支払い" },
  { id: "shipping", label: "配送について" },
  { id: "product", label: "商品について" },
] as const;

export type FaqCategoryId = (typeof FAQ_CATEGORIES)[number]["id"];

export interface FaqItem {
  category: FaqCategoryId;
  question: string;
  answer: string;
}

// TODO(TBD-11 / 運用確定後): 文面を運用の実態に合わせて確定する。
export const FAQ_ITEMS: readonly FaqItem[] = [
  { category: "account", question: "取引を始めるにはどうすればよいですか。", answer: "新規取引申請フォームからお申し込みください。審査のうえ、結果をメールでご連絡します。" },
  { category: "account", question: "審査にはどのくらいかかりますか。", answer: "お申し込みの内容を確認のうえ、数営業日以内にご連絡します。" },
  { category: "account", question: "同じ会社で複数の担当者アカウントを作れますか。", answer: "可能です。担当までお問い合わせください。" },
  { category: "order", question: "卸価格はどこで確認できますか。", answer: "承認済みの取引先アカウントでログインすると、商品ページに卸価格が表示されます。" },
  { category: "order", question: "支払方法を教えてください。", answer: "クレジットカード決済と銀行振込をご利用いただけます。" },
  { category: "shipping", question: "送料はいくらですか。", answer: "全国一律です。一定額以上のご発注で送料無料となります。金額は /law の表示をご確認ください。" },
  { category: "product", question: "取扱いが終了した商品は購入できますか。", answer: "取扱終了後はご発注いただけません。過去のご発注履歴は引き続きご確認いただけます。" },
];

export const faqItemsByCategory = (category: FaqCategoryId) => FAQ_ITEMS.filter((item) => item.category === category);
