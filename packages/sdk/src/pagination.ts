/**
 * The ONE list envelope + opaque-cursor iteration (redesign §5.2 / §6.2).
 *
 * Every redesign collection endpoint (the canonical `x.projects.inboxes.*` chain
 * and beyond) returns {@link List}: `{ object: "list", data, has_more, next_cursor }`.
 * `next_cursor` is OPAQUE — treat it as a token and pass it back verbatim as
 * `?cursor` to fetch the next page. {@link ListPage} wraps a raw {@link List} with
 * ergonomic iteration (`for await … of`) and a `nextPage()` cursor walker so callers
 * never thread cursors by hand.
 */

/** The opaque pagination cursor. Pass it back verbatim as `?cursor`; never parse it. */
export type Cursor = string;

/** The one collection envelope for every redesign list response. */
export interface List<T> {
  /** Always the literal `"list"`. */
  object: "list";
  /** The rows on this page. */
  data: T[];
  /** True when another page exists (i.e. `next_cursor` is non-null). */
  has_more: boolean;
  /** Opaque cursor for the next page, or `null` on the last page. */
  next_cursor: Cursor | null;
}

/** Query params shared by every cursor-paginated list. */
export interface ListParams {
  /** Page size (server clamps to 1–100; default 50). */
  limit?: number;
  /** Opaque cursor from a prior page's `next_cursor`. */
  cursor?: Cursor;
}

/** A function that fetches one page given an opaque cursor (or undefined for page 1). */
export type PageFetcher<T> = (cursor: Cursor | undefined, signal?: AbortSignal) => Promise<List<T>>;

/**
 * An ergonomic wrapper over a single {@link List} page that also knows how to fetch
 * the next page and auto-iterate across ALL pages.
 *
 * ```ts
 * const page = await x.projects.inboxes.list("proj_9k");
 * for await (const inbox of page) console.log(inbox.id);   // walks every page
 * // …or page-at-a-time:
 * if (page.hasMore) { const next = await page.nextPage(); }
 * ```
 */
export class ListPage<T> implements AsyncIterable<T> {
  /** The rows on THIS page. */
  readonly data: T[];
  /** True when another page exists. */
  readonly hasMore: boolean;
  /** Opaque cursor for the next page (null on the last page). */
  readonly nextCursor: Cursor | null;
  /** Always `"list"`. */
  readonly object = "list" as const;

  constructor(
    raw: List<T>,
    private readonly fetcher: PageFetcher<T>,
  ) {
    this.data = raw.data;
    this.hasMore = raw.has_more;
    this.nextCursor = raw.next_cursor;
  }

  /**
   * Fetch the next page. Throws if there is none — guard with {@link hasMore}.
   */
  async nextPage(signal?: AbortSignal): Promise<ListPage<T>> {
    if (!this.hasMore || this.nextCursor === null) {
      throw new Error("Extrovert: no more pages (next_cursor is null).");
    }
    const raw = await this.fetcher(this.nextCursor, signal);
    return new ListPage(raw, this.fetcher);
  }

  /**
   * Auto-paginate: yield every row across every page, fetching subsequent pages
   * lazily as the iterator is consumed. The default iteration of a `ListPage`.
   */
  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    let page: ListPage<T> = this;
    for (;;) {
      for (const item of page.data) yield item;
      if (!page.hasMore || page.nextCursor === null) return;
      page = await page.nextPage();
    }
  }

  /** Collect EVERY row across EVERY page into a single array (eager). */
  async collect(signal?: AbortSignal): Promise<T[]> {
    const out: T[] = [...this.data];
    let page: ListPage<T> = this;
    while (page.hasMore && page.nextCursor !== null) {
      page = await page.nextPage(signal);
      out.push(...page.data);
    }
    return out;
  }
}

/** Build a {@link ListPage} from the first raw {@link List} and a page fetcher. */
export function listPage<T>(raw: List<T>, fetcher: PageFetcher<T>): ListPage<T> {
  return new ListPage(raw, fetcher);
}
