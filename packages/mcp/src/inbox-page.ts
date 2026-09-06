/** Validate supported inbox list responses. A schema mismatch is never an empty inventory. */
export function normalizeInboxPage<T>(raw: unknown, resource = "inbox"): {
  items: T[]; has_more: boolean; next_cursor?: string; total?: number;
} {
  const invalid = () => { throw new Error(`Invalid ${resource} list response; inventory is unavailable, not empty.`); };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return invalid();
  const value = raw as Record<string, unknown>;
  const canonical = "object" in value || "data" in value;
  const items = canonical ? value.data : value.inboxes ?? value.items;
  if (!Array.isArray(items)) return invalid();
  const cursor = value.next_cursor ?? value.next_page;
  if (cursor != null && (typeof cursor !== "string" || (canonical && !cursor))) return invalid();
  if (canonical && (! ("next_cursor" in value) || value.object !== "list" || typeof value.has_more !== "boolean" ||
      value.has_more !== Boolean(cursor))) return invalid();
  if (value.total !== undefined &&
      (typeof value.total !== "number" || !Number.isSafeInteger(value.total) || value.total < items.length)) return invalid();
  const page: { items: T[]; has_more: boolean; next_cursor?: string; total?: number } = {
    items: items as T[], has_more: Boolean(cursor),
  };
  if (typeof cursor === "string" && cursor) page.next_cursor = cursor;
  if (typeof value.total === "number") page.total = value.total;
  return page;
}
