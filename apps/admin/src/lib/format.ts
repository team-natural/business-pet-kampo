// Display formatting. Workers run in UTC, so an unqualified timestamp reads nine hours off for
// the operator — the time zone is pinned rather than left to the runtime.
const dateTimeFormatter = new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tokyo" });
const dateFormatter = new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeZone: "Asia/Tokyo" });

export const formatDateTime = (iso: string | null | undefined) => (iso ? dateTimeFormatter.format(new Date(iso)) : "—");

export const formatDate = (iso: string | null | undefined) => (iso ? dateFormatter.format(new Date(iso)) : "—");

export const formatYen = (amount: number) => `${amount.toLocaleString("ja-JP")} 円`;
