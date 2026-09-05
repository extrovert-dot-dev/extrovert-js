/**
 * Runtime configuration, resolved from environment variables.
 *
 * The MCP host (Claude Desktop / Claude Code / Cursor) passes these via the
 * server's `env` block. The agent key is a scoped agent key - never an
 * org-wide master key (spec §14: "No org-wide key ever reaches an MCP host").
 */

export interface ExtrovertConfig {
  /** Base URL of the Extrovert REST API, e.g. `https://api.extrovert.dev`. */
  apiBaseUrl: string;
  /**
   * Scoped agent key (`pk_agent_...`) or enrollment key (`pk_enroll_...`).
   * Sent as `Authorization: Bearer <key>`. May be empty when the host intends
   * to call `redeem_enrollment` first to obtain a scoped key at runtime.
   */
  apiKey: string;
  /** Per-request timeout in milliseconds for non-blocking calls. */
  requestTimeoutMs: number;
  /** Upper bound (ms) the server will allow a `wait_for_email` to block. */
  maxWaitMs: number;
  /**
   * When true, the server serves deterministic offline fixtures so every tool is
   * exercisable without the backend. Set `EXTROVERT_MOCK=1` to force.
   */
  mock: boolean;
  /**
   * The review policy the OFFLINE fixture store enforces (`EXTROVERT_MOCK_REVIEW_POLICY`).
   *
   * Defaults to `require_review`, matching what a real account gets, so an offline
   * agent meets the same 422 `intent_required` the live API would raise instead of
   * being taught that a bare send just sends. Set `allow_direct` only when a test
   * or demo genuinely needs a delivered message rather than a queued review.
   */
  mockReviewPolicy: ReviewPolicy;
}

/** Mirrors `ReviewPolicy` in ./types (duplicated to keep config dependency-free). */
type ReviewPolicy = "require_review" | "auto_send_graduated" | "allow_direct";

const REVIEW_POLICIES: readonly ReviewPolicy[] = ["require_review", "auto_send_graduated", "allow_direct"];

function parseReviewPolicy(value: string | undefined): ReviewPolicy {
  const v = (value ?? "").trim().toLowerCase();
  // An unrecognized value resolves to the require_review FLOOR rather than being
  // ignored: a typo must never silently unsupervise a mailbox.
  return (REVIEW_POLICIES as readonly string[]).includes(v) ? (v as ReviewPolicy) : "require_review";
}

const DEFAULT_API_BASE_URL = "https://api.extrovert.dev";
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_WAIT_MS = 300_000; // 5 minutes - OTP windows are 5–10 min.

function parseBool(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function parseIntEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Resolve config from `process.env`. Accepts an override map for testing.
 *
 * Env vars (per task spec):
 *   EXTROVERT_API_BASE_URL  - base URL of the REST API
 *   EXTROVERT_API_KEY       - scoped agent/enrollment key
 *   EXTROVERT_REQUEST_TIMEOUT_MS, EXTROVERT_MAX_WAIT_MS, EXTROVERT_MOCK - tuning
 *   EXTROVERT_MOCK_REVIEW_POLICY - the policy the offline store enforces
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ExtrovertConfig {
  const apiKey = (env.EXTROVERT_API_KEY ?? "").trim();
  const explicitMock = parseBool(env.EXTROVERT_MOCK);
  const apiBaseUrl = (env.EXTROVERT_API_BASE_URL ?? DEFAULT_API_BASE_URL).trim().replace(/\/+$/, "");

  return {
    apiBaseUrl,
    apiKey,
    requestTimeoutMs: parseIntEnv(env.EXTROVERT_REQUEST_TIMEOUT_MS, DEFAULT_REQUEST_TIMEOUT_MS),
    maxWaitMs: parseIntEnv(env.EXTROVERT_MAX_WAIT_MS, DEFAULT_MAX_WAIT_MS),
    mock: explicitMock,
    mockReviewPolicy: parseReviewPolicy(env.EXTROVERT_MOCK_REVIEW_POLICY),
  };
}

export const SERVER_NAME = "extrovert";
export const SERVER_VERSION = "0.1.0-pre.7";
