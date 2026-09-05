/**
 * Key-tier awareness (redesign §3.1).
 *
 * An agent key encodes its CEILING tier in its raw prefix. The SDK never trusts
 * client input for scope - the tier is derived from the key the caller already
 * holds, purely as a client-side hint so an app can branch (e.g. an org-tier key
 * MUST pick a project breadth on a list; a project/inbox key may use the bare
 * sugar). The server remains the source of truth; this is advisory only.
 *
 * Prefix scheme (the secret tail is unchanged across tiers):
 *   - `pk_agent_org_…`   → {@link KeyTier.Org}      (admin/console issuance only)
 *   - `pk_agent_proj_…`  → {@link KeyTier.Project}  (enrollment redeem + console)
 *   - `pk_agent_inbox_…` → {@link KeyTier.Inbox}    (admin/console issuance only)
 *   - legacy `pk_agent_…` (no tier segment) → {@link KeyTier.Project}
 */

/** The ceiling tier encoded in an agent key's prefix. */
export type KeyTier = "org" | "project" | "inbox" | "unknown";

const AGENT_HEAD = "pk_agent_";

/**
 * Derive the {@link KeyTier} from a raw agent key by peeking the segment after the
 * `pk_agent_` head. A legacy bare `pk_agent_…` key (no tier segment) maps to
 * `"project"` - exactly today's behavior. A non-agent credential (enrollment
 * token, Clerk session, empty) returns `"unknown"`.
 */
export function parseKeyTier(apiKey: string | undefined): KeyTier {
  if (!apiKey || !apiKey.startsWith(AGENT_HEAD)) return "unknown";
  const rest = apiKey.slice(AGENT_HEAD.length);
  if (rest.startsWith("org_")) return "org";
  if (rest.startsWith("proj_")) return "project";
  if (rest.startsWith("inbox_")) return "inbox";
  // Bare `pk_agent_<id>_<secret>` (no tier segment) is a legacy project key.
  return "project";
}

/**
 * Whether a key of this tier can address the org-wide wildcard (`/v1/projects/-/…`).
 * Only an org-tier key may; a project/inbox key on the wildcard is a 403. Use this
 * to fail fast client-side before a round-trip.
 */
export function tierAllowsOrgWildcard(tier: KeyTier): boolean {
  return tier === "org";
}

/**
 * Whether a bare (project-less) list is unambiguous for this tier. An org-tier key
 * MUST pick a breadth (a concrete project or the `-` wildcard), so a bare list is a
 * 400 `breadth_required`; project/inbox keys default to their bound project.
 */
export function tierNeedsExplicitBreadth(tier: KeyTier): boolean {
  return tier === "org";
}
