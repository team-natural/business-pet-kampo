// 表示用の整形。Worker は UTC で動くので、タイムゾーンを明示しないと運営の手元と 9 時間ずれる。
const dateTimeFormatter = new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tokyo" });
const dateFormatter = new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeZone: "Asia/Tokyo" });

export const formatDateTime = (iso: string | null | undefined) => (iso ? dateTimeFormatter.format(new Date(iso)) : "—");

export const formatDate = (iso: string | null | undefined) => (iso ? dateFormatter.format(new Date(iso)) : "—");

export const formatYen = (amount: number) => `${amount.toLocaleString("ja-JP")} 円`;
