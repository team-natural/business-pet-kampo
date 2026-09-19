// The console's sidebar, as data. One entry per listing screen (PRD-04 §3-2) — a detail screen is
// reached from its list, so it is deliberately absent.
//
// No Svelte imports on purpose: console-shell.svelte maps `icon` to a Lucide component, which
// keeps this file loadable from a unit test.
export type ConsoleNavIcon = "dashboard" | "application" | "organization" | "order" | "inquiry" | "auditLog";

export type ConsoleNavItem = { label: string; href: string; icon: ConsoleNavIcon };
export type ConsoleNavGroup = { label: string | null; items: ConsoleNavItem[] };

export const CONSOLE_NAV: ConsoleNavGroup[] = [
  {
    label: null,
    items: [{ label: "ダッシュボード", href: "/", icon: "dashboard" }],
  },
  {
    label: "審査・取引先",
    items: [
      { label: "新規取引申請", href: "/applications", icon: "application" },
      { label: "取引先", href: "/organizations", icon: "organization" },
    ],
  },
  {
    label: "取引・対応",
    items: [
      { label: "受注", href: "/orders", icon: "order" },
      { label: "お問い合わせ", href: "/inquiries", icon: "inquiry" },
    ],
  },
  {
    label: "記録",
    items: [{ label: "管理操作履歴", href: "/audit-logs", icon: "auditLog" }],
  },
];

// Matches on segment boundaries, not on the raw string: a bare startsWith would light up
// /orders while the operator is on /orders-something, and would light up every entry for "/".
export function isCurrentRoute(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
