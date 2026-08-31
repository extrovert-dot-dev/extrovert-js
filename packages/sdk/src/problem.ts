/**
 * RFC-9457 problem+json errors (redesign §5.1 / §6.2).
 *
 * The redesigned surface returns `application/problem+json` with a CLOSED machine
 * `code` enum clients switch on. The SDK parses it into {@link Problem} and raises a
 * {@link ProblemError} whose `code` is the typed {@link ProblemCode} union, so callers
 * branch exhaustively without inspecting raw bodies. The legacy `{ error, message }`
 * envelope is still parsed by the transport (back-compat); when present it is mapped
 * onto the closest {@link ProblemCode}.
 */

/**
 * The CLOSED problem code enum (mirrors `components.schemas.Problem.code` in the
 * frozen OpenAPI). Adding a member is a contract change — keep it in lockstep with
 * the Go `ProblemCode` enum.
 */
export type ProblemCode =
  | "bad_request"
  | "unauthorized"
  | "forbidden_scope"
  | "not_found"
  | "conflict"
  | "idempotency_conflict"
  | "breadth_required"
  | "quota_exceeded"
  | "rate_limited"
  | "domain_not_allowed"
  | "recipient_blocked"
  | "recipient_suppressed"
  | "not_configured"
  | "domain_unavailable"
  | "internal"
  // --- Review Loop taxonomy -------------------------------------------------
  //
  // Before these members every review-loop failure answered a bare `409
  // "conflict"` (or, on the send path, no machine code at all), so a stale CAS,
  // an illegal verb and a review a human had already closed were
  // indistinguishable — and a retry loop written against `status === 409`
  // retried all three, including the one that can never succeed. Each member
  // below exists because the agent must take a DIFFERENT action on it; see
  // {@link REVIEW_PROBLEM_RETRYABLE} for which are worth retrying at all.
  | "intent_required"
  | "wrong_state"
  | "terminal"
  | "stale"
  | "born_stale"
  | "send_needs_reconciliation"
  | "graduation_locked"
  | "maturity_gate_unmet"
  | "scope_taken"
  | "unavailable";

/** The full set of {@link ProblemCode} values (for runtime validation / exhaustive UIs). */
export const PROBLEM_CODES: readonly ProblemCode[] = [
  "bad_request",
  "unauthorized",
  "forbidden_scope",
  "not_found",
  "conflict",
  "idempotency_conflict",
  "breadth_required",
  "quota_exceeded",
  "rate_limited",
  "domain_not_allowed",
  "recipient_blocked",
  "recipient_suppressed",
  "not_configured",
  "domain_unavailable",
  "internal",
  "intent_required",
  "wrong_state",
  "terminal",
  "stale",
  "born_stale",
  "send_needs_reconciliation",
  "graduation_locked",
  "maturity_gate_unmet",
  "scope_taken",
  "unavailable",
] as const;

/**
 * Which review-loop problem codes are worth retrying, and which are a dead end.
 *
 * This table is the whole point of splitting the 409: only a failed
 * compare-and-set (`stale`) and a redraft built against an older rule high-water
 * (`born_stale`) describe a situation a retry can fix, and each only a bounded
 * number of times (re-read, re-apply on top of the other party's change,
 * resubmit). `wrong_state` means the verb is wrong, not the timing — read the
 * `allowed_action` hints and pick another one. `terminal` means the review is
 * finished forever; a `front_run_next` nudge is already waiting on the queue
 * with the outcome. `send_needs_reconciliation` means a delivery attempt is
 * unconfirmed — resending is precisely how a message goes out twice.
 *
 * `intent_required` is listed false because retrying the SAME bytes fails
 * identically: the fix is to ADD an `intent` and send a different request. The
 * server states in its `detail` that nothing was sent and nothing was queued, so
 * that amended retry is safe.
 */
export const REVIEW_PROBLEM_RETRYABLE: Readonly<Record<string, boolean>> = {
  stale: true,
  born_stale: true,
  wrong_state: false,
  terminal: false,
  send_needs_reconciliation: false,
  intent_required: false,
  idempotency_conflict: false,
} as const;

/** One per-field validation detail in a {@link Problem}. */
export interface ProblemField {
  field?: string;
  code?: string;
  detail?: string;
}

/** The RFC-9457 problem+json body. */
export interface Problem {
  /** Dereferenceable URI under `https://extrovert.dev/problems/{code}`. */
  type: string;
  /** Short, human-readable summary of the problem type. */
  title: string;
  /** HTTP status code, duplicated in the body. */
  status: number;
  /** Human-readable, instance-specific detail. */
  detail?: string;
  /** The closed machine code clients switch on. */
  code: ProblemCode;
  /** Per-request id for support correlation. */
  request_id?: string;
  /** Optional machine hints (e.g. `breadth_required` may name the next calls). */
  errors?: ProblemField[];
}

/** True when `value` is a member of the closed {@link ProblemCode} enum. */
export function isProblemCode(value: unknown): value is ProblemCode {
  return typeof value === "string" && (PROBLEM_CODES as readonly string[]).includes(value);
}

/**
 * Parse an unknown JSON body into a {@link Problem} when it carries the required
 * problem+json shape (`code` in the closed enum), else `undefined`. Unknown codes
 * are coerced to `"internal"` so the typed union holds while the raw value is still
 * available via {@link ProblemError.rawCode}.
 */
export function parseProblem(body: unknown): { problem: Problem; rawCode: string } | undefined {
  if (!body || typeof body !== "object") return undefined;
  const b = body as Record<string, unknown>;
  // problem+json must have a string `code`; the legacy envelope uses `error` instead.
  if (typeof b.code !== "string") return undefined;
  const rawCode = b.code;
  const code: ProblemCode = isProblemCode(rawCode) ? rawCode : "internal";
  const problem: Problem = {
    type: typeof b.type === "string" ? b.type : `https://extrovert.dev/problems/${rawCode}`,
    title: typeof b.title === "string" ? b.title : rawCode,
    status: typeof b.status === "number" ? b.status : 0,
    code,
    detail: typeof b.detail === "string" ? b.detail : undefined,
    request_id: typeof b.request_id === "string" ? b.request_id : undefined,
    errors: Array.isArray(b.errors) ? (b.errors as ProblemField[]) : undefined,
  };
  return { problem, rawCode };
}
