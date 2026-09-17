import { AppError, ValidationError } from "./errors";

export function jsonItem(data: unknown, status = 200): Response {
  return Response.json({ data }, { status });
}

// Keyset pagination, not offset: an admin list is append-heavy, and OFFSET re-scans the rows it
// skips. `next_cursor` is null on the last page.
export function jsonCursorCollection(data: unknown[], meta: { perPage: number; nextCursor: string | null }): Response {
  return Response.json({ data, meta: { per_page: meta.perPage, next_cursor: meta.nextCursor } });
}

// Page-number pagination, for lists that stay small and stable (DEV-04 §3-2). Reach for the
// cursor form instead when the list grows without bound — counting it every request is the cost.
export function jsonPageCollection(data: unknown[], meta: { url: URL; currentPage: number; perPage: number; total: number }): Response {
  const lastPage = Math.max(1, Math.ceil(meta.total / meta.perPage));
  // Built here rather than by each route: hand-assembled links drop the caller's filters, and
  // then page 2 of a filtered list quietly shows page 2 of everything.
  const pageUrl = (page: number) => {
    const url = new URL(meta.url);
    url.searchParams.set("page", String(page));
    return url.pathname + url.search;
  };

  return Response.json({
    data,
    meta: { current_page: meta.currentPage, per_page: meta.perPage, total: meta.total, last_page: lastPage },
    links: {
      first: pageUrl(1),
      last: pageUrl(lastPage),
      prev: meta.currentPage > 1 ? pageUrl(meta.currentPage - 1) : null,
      next: meta.currentPage < lastPage ? pageUrl(meta.currentPage + 1) : null,
    },
  });
}

export function toErrorResponse(error: unknown): Response {
  if (error instanceof ValidationError) {
    return Response.json({ message: error.message, errors: error.errors, error_code: error.code }, { status: error.status });
  }
  if (error instanceof AppError) {
    return Response.json({ message: error.message, error_code: error.code }, { status: error.status });
  }
  console.error(error);
  return Response.json({ message: "サーバー内部エラーが発生しました。", error_code: "INTERNAL_ERROR" }, { status: 500 });
}
