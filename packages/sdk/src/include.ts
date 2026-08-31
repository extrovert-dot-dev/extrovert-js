/**
 * `?include=` relation expansion typing (redesign §5.5 / §6.2).
 *
 * Reads may expand a per-resource allowlist of relations (depth ≤ 2); the server
 * re-applies the same ceiling/ownership filter to every expanded child. The SDK
 * types the allowed relations per resource so a caller cannot ask for a relation the
 * server would reject with 400 `bad_request`, and serializes the list as the
 * comma-separated `?include=` value.
 */

/** Relations the `inbox` resource may expand (`?include=agent,domain`). */
export type InboxInclude = "agent" | "domain";

/** Relations the `review` resource may expand (`?include=category,turns`). */
export type ReviewInclude = "category" | "turns";

/** Serialize an include list into the comma-separated `?include=` query value. */
export function serializeInclude(include?: readonly string[]): string | undefined {
  if (!include || include.length === 0) return undefined;
  return include.join(",");
}
