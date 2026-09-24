// Every value in these templates was typed by an unauthenticated visitor, so the HTML body escapes
// all of it. The text body needs no escaping, which is why the two are built separately rather
// than one being stripped from the other.
export function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
