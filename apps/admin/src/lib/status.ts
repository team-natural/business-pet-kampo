// Display labels for the state machines, copied from DEV-09 — that document is the source, so
// reword there first and follow here.
//
// Keyed per entity, never merged into one table: the same key means different things across
// machines. `received` reads differently under Application and Order.
export type StatusTone = "neutral" | "info" | "positive" | "warning" | "danger";

export type StatusMeta = { label: string; tone: StatusTone };

type StatusMap = Record<string, StatusMeta>;

const APPLICATION: StatusMap = {
  received: { label: "申請受付", tone: "info" },
  reviewing: { label: "審査中", tone: "warning" },
  needs_confirmation: { label: "確認・差し戻し", tone: "warning" },
  approved: { label: "承認", tone: "positive" },
  rejected: { label: "否認", tone: "danger" },
  withdrawn: { label: "申請取消", tone: "neutral" },
};

const ORGANIZATION: StatusMap = {
  active: { label: "稼働中", tone: "positive" },
  suspended: { label: "取引停止中", tone: "danger" },
  terminated: { label: "取引終了", tone: "neutral" },
};

const MEMBER: StatusMap = {
  active: { label: "有効", tone: "positive" },
  suspended: { label: "停止中", tone: "danger" },
  deactivated: { label: "無効化", tone: "neutral" },
};

const MEMBERSHIP: StatusMap = {
  active: { label: "所属中", tone: "positive" },
  suspended: { label: "停止中", tone: "danger" },
};

const ORDER: StatusMap = {
  received: { label: "受付済み", tone: "info" },
  confirming: { label: "確認中", tone: "warning" },
  preparing: { label: "出荷準備中", tone: "info" },
  shipped: { label: "出荷済み", tone: "info" },
  completed: { label: "完了", tone: "positive" },
  cancelled: { label: "キャンセル", tone: "danger" },
};

const PAYMENT: StatusMap = {
  unpaid: { label: "未決済", tone: "warning" },
  awaiting_transfer: { label: "入金待ち", tone: "warning" },
  processing: { label: "決済処理中", tone: "info" },
  paid: { label: "決済済み", tone: "positive" },
  failed: { label: "決済失敗", tone: "danger" },
  refunded: { label: "返金済み", tone: "neutral" },
  partially_refunded: { label: "一部返金", tone: "neutral" },
};

const INQUIRY: StatusMap = {
  new: { label: "未対応", tone: "warning" },
  in_progress: { label: "対応中", tone: "info" },
  resolved: { label: "対応完了", tone: "positive" },
};

export const STATUS_MAPS = {
  application: APPLICATION,
  organization: ORGANIZATION,
  member: MEMBER,
  membership: MEMBERSHIP,
  order: ORDER,
  payment: PAYMENT,
  inquiry: INQUIRY,
} satisfies Record<string, StatusMap>;

export type StatusDomain = keyof typeof STATUS_MAPS;

// Falls back to the raw value rather than throwing: a state added in the schema before it reaches
// this table must still render, or the whole screen 500s over one unmapped row.
export function statusMeta(domain: StatusDomain, value: string): StatusMeta {
  return STATUS_MAPS[domain][value] ?? { label: value, tone: "neutral" };
}

// Enum-ish columns that are not state machines. The inquiry type ids are duplicated from
// apps/public/src/lib/inquiry.ts — admin cannot import across apps, so reword there first.
const PLAIN_LABELS = {
  paymentMethod: { credit_card: "クレジットカード", bank_transfer: "銀行振込" },
  inquiryType: {
    new_account: "新規取引・お取引条件について",
    product: "商品について",
    order: "ご発注・納期について",
    billing: "請求・お支払いについて",
    shipping: "配送・返品について",
    other: "その他",
  },
} satisfies Record<string, Record<string, string>>;

export type LabelDomain = keyof typeof PLAIN_LABELS;

export function label(domain: LabelDomain, value: string | null): string {
  if (value === null) return "—";
  return (PLAIN_LABELS[domain] as Record<string, string>)[value] ?? value;
}
