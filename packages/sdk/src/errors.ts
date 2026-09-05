/**
 * Extrovert error types. Every non-2xx response is surfaced as an {@link ApiError} (or a subclass),
 * so callers can branch on `status` / `code` without inspecting raw responses.
 *
 * The redesigned surface returns RFC-9457 `application/problem+json` with a CLOSED
 * machine {@link ProblemCode} enum. When that body is present, the thrown error
 * carries the parsed {@link Problem} on `.problem` and a typed `.problemCode`; the
 * legacy `{ error, message }` envelope is still parsed for back-compat.
 */

import type { Problem, ProblemCode } from "./problem.js";

/** The machine-readable error envelope the Extrovert API returns on failures. */
export interface ApiErrorBody {
  error: {
    /** Stable, machine-readable code, e.g. `enrollment_token_exhausted`, `not_found`. */
    code: string;
    /** Human-readable message safe to surface to developers. */
    message: string;
    /** Optional per-field validation detail. */
    details?: Record<string, unknown>;
  };
  /** Request id for support correlation, echoed from the `X-Request-Id` header. */
  request_id?: string;
}

/**
 * Base error for any failed Extrovert API call. Carries the HTTP `status`, the stable `code`, the
 * `request_id` for support, and the raw `body` for forward-compatible inspection.
 */
export class ApiError extends Error {
  /** HTTP status code (e.g. 401, 404, 409, 429). 0 when the request never reached the server. */
  readonly status: number;
  /** Stable machine-readable error code from the body, or a synthesized one for transport errors. */
  readonly code: string;
  /** Request id for support correlation, when present. */
  readonly requestId: string | undefined;
  /** The parsed error body, when the server returned one. */
  readonly body: ApiErrorBody | undefined;
  /**
   * The parsed RFC-9457 problem+json body, when the server returned one. Present on
   * the redesigned surface; `undefined` for the legacy `{ error }` envelope.
   */
  readonly problem: Problem | undefined;
  /**
   * The typed closed-enum problem code, when the server returned problem+json. An
   * unknown/legacy code is coerced to `"internal"`; the raw string is always on
   * {@link ApiError.code}.
   */
  readonly problemCode: ProblemCode | undefined;

  constructor(args: {
    status: number;
    code: string;
    message: string;
    requestId?: string | undefined;
    body?: ApiErrorBody | undefined;
    problem?: Problem | undefined;
    cause?: unknown;
  }) {
    super(args.message, args.cause === undefined ? undefined : { cause: args.cause });
    this.name = new.target.name;
    this.status = args.status;
    this.code = args.code;
    this.requestId = args.requestId;
    this.body = args.body;
    this.problem = args.problem;
    this.problemCode = args.problem?.code;
    // Maintain prototype chain across transpile targets.
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /** True for 4xx responses (client errors that retrying won't fix). */
  get isClientError(): boolean {
    return this.status >= 400 && this.status < 500;
  }

  /** True for 5xx responses (server errors that may succeed on retry). */
  get isServerError(): boolean {
    return this.status >= 500;
  }
}

/** 401 - the agent key / enrollment token was missing, malformed, expired, or revoked. */
export class AuthenticationError extends ApiError {}

/** 403 - authenticated, but the key's scopes don't permit this action (capability denied). */
export class PermissionError extends ApiError {}

/**
 * 403 `forbidden_scope` - the call is outside the key's CEILING (e.g. a non-org key
 * on the org-wide wildcard, or an issuance that would escalate). A redesign-specific
 * subclass of {@link PermissionError} so existing `instanceof PermissionError`
 * branches keep working.
 */
export class ForbiddenScopeError extends PermissionError {}

/**
 * 400 `breadth_required` - an org-tier key/operator issued a bare list that needs a
 * breadth pick; the problem `errors`/`detail` name the next call
 * (`/v1/projects/{id}/inboxes` or `/v1/projects/-/inboxes`).
 */
export class BreadthRequiredError extends ApiError {}

/** 404 - the inbox, message, thread, or webhook does not exist (or isn't visible to this tenant). */
export class NotFoundError extends ApiError {}

/** 409 - a conflicting state, e.g. an enrollment token that already created its maximum number of inboxes. */
export class ConflictError extends ApiError {}

/** 422 - the request body failed validation; see `body.error.details`. */
export class ValidationError extends ApiError {}

/**
 * 422 `recipient_suppressed` - a send/reply/forward was rejected because one or
 * more recipients have opted out (list-unsubscribe / suppression). The whole send
 * is rejected (never a silent partial drop). {@link suppressedRecipients} lists the
 * exact addresses to drop; retry the send without them. The scope/origin of the
 * opt-out is deliberately NOT surfaced. A subclass of {@link ValidationError} so
 * existing `instanceof ValidationError` branches keep working.
 */
export class RecipientSuppressedError extends ValidationError {
  /** The recipient addresses that are suppressed - drop these and retry. */
  readonly suppressedRecipients: string[];
  constructor(args: ConstructorParameters<typeof ApiError>[0]) {
    super(args);
    this.suppressedRecipients = suppressedRecipientsFromProblem(args.problem);
  }
}

/**
 * Pull the suppressed recipient addresses out of a problem+json body. The server
 * attaches them as per-field hints (`{field:"recipient", code:"recipient_suppressed",
 * detail:"<address>"}`) so the caller can drop exactly those and retry.
 */
function suppressedRecipientsFromProblem(problem: Problem | undefined): string[] {
  const out: string[] = [];
  for (const field of problem?.errors ?? []) {
    if (field.field === "recipient" && typeof field.detail === "string" && field.detail) {
      out.push(field.detail);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Review Loop taxonomy - the 422 remediation and the split 409.
//
// The server carries an error's recovery FACTS as repeated `{field, code,
// detail}` problem hints (the same triple `breadth_required` and
// `recipient_suppressed` already use), so the classes below read them off
// `.problem.errors` instead of forcing every caller to re-GET the review. Two
// rules the shapes encode:
//
//   1. Every new class extends an EXISTING one (ValidationError / ConflictError),
//      so code already written as `catch (e) { if (e instanceof ConflictError) }`
//      keeps working unchanged and only code that WANTS the distinction has to
//      learn it.
//   2. Only StaleError and BornStaleError are retryable, and each only a bounded
//      number of times. TerminalError and WrongStateError must never be retried
//      with the same verb - that infinite loop is the bug this taxonomy exists to
//      make impossible.
// ---------------------------------------------------------------------------

/** First `detail` whose hint `field` matches, or undefined. */
function hintDetail(problem: Problem | undefined, field: string): string | undefined {
  for (const f of problem?.errors ?? []) {
    if (f.field === field && typeof f.detail === "string" && f.detail) return f.detail;
  }
  return undefined;
}

/** First `code` whose hint `field` matches, or undefined. */
function hintCode(problem: Problem | undefined, field: string): string | undefined {
  for (const f of problem?.errors ?? []) {
    if (f.field === field && typeof f.code === "string" && f.code) return f.code;
  }
  return undefined;
}

/** Every hint `code` under the repeated `field` (e.g. the `allowed_action` list). */
function hintCodes(problem: Problem | undefined, field: string): string[] {
  const out: string[] = [];
  for (const f of problem?.errors ?? []) {
    if (f.field === field && typeof f.code === "string" && f.code) out.push(f.code);
  }
  return out;
}

/** Parse a hint whose `code` carries an integer (revision / version). */
function hintInt(problem: Problem | undefined, field: string): number | undefined {
  const raw = hintCode(problem, field);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isInteger(n) ? n : undefined;
}

/**
 * 422 `intent_required` - the inbox's resolved review policy requires a human to
 * see this message before it goes out, and the request carried no `intent`.
 *
 * **Nothing was sent and nothing was queued.** The server checks this before it
 * writes any row, which is what makes the amended retry safe: add an `intent`
 * and re-POST the SAME request. {@link retryWith} is the literal JSON fragment to
 * splice in, and the human-readable remediation (the full recipe, including how
 * to monitor the resulting review) is on `.message` / `.problem.detail`.
 *
 * Under `require_review` - the default for every account - this is the FIRST
 * thing most agents hit. Read `effective_review_policy` on
 * `GET /v1/inboxes/{id}` once at start-up and compose an intent up front instead
 * of learning the policy by being refused. A subclass of {@link ValidationError}
 * so existing `instanceof ValidationError` branches keep working.
 */
export class IntentRequiredError extends ValidationError {
  /** The resolved review policy, e.g. `require_review`. */
  readonly policy: string | undefined;
  /** Where the policy came from - a per-inbox override or the account default. */
  readonly policySource: string | undefined;
  /** Literal JSON to merge into the original request body, then retry once. */
  readonly retryWith: string | undefined;
  constructor(args: ConstructorParameters<typeof ApiError>[0]) {
    super(args);
    // The server ships `policy` as `<policy> (source: <source>)` so one hint
    // carries both halves; split rather than demand a second field.
    const policyHint = hintDetail(args.problem, "policy");
    const match = policyHint?.match(/^([^\s(]+)\s*(?:\(source:\s*(.*?)\s*\))?$/);
    this.policy = match?.[1];
    this.policySource = match?.[2];
    this.retryWith = hintDetail(args.problem, "retry_with");
  }
}

/**
 * Base for the review-loop 409s. Carries the live state and CAS keys the server
 * attached so a retry (where one is legal at all) needs no extra `get_review`,
 * and the `allowed_action` verbs that ARE legal from the current state so an
 * agent is told what to do instead of guessing.
 *
 * Extends {@link ConflictError}: every one of these used to be a bare 409, and
 * nothing that catches `ConflictError` should have to change.
 */
export class ReviewConflictError extends ConflictError {
  /** The review's CURRENT state (`needs_review`, `approved`, `sent`, …). */
  readonly currentState: string | undefined;
  /** The current revision - pass it as `parent_revision` on a legal retry. */
  readonly currentRevision: number | undefined;
  /** The current row version (the optional belt-and-braces CAS). */
  readonly currentVersion: number | undefined;
  /** The verbs that ARE legal from {@link currentState}, e.g. `submit_revision`. */
  readonly allowedActions: string[];
  constructor(args: ConstructorParameters<typeof ApiError>[0]) {
    super(args);
    this.currentState = hintCode(args.problem, "state");
    this.currentRevision = hintInt(args.problem, "revision");
    this.currentVersion = hintInt(args.problem, "version");
    this.allowedActions = hintCodes(args.problem, "allowed_action");
  }
  /**
   * Whether retrying the same call could ever succeed. False for every subclass
   * except {@link StaleError} and {@link BornStaleError} - and true there only
   * after re-reading and re-applying on top of the other party's change.
   */
  get isRetryable(): boolean {
    return false;
  }
}

/**
 * 409 `stale` - the `(revision[, version])` you named is no longer current
 * because a human or reviewer moved the draft. **Nothing was mutated.**
 *
 * The one genuinely retryable conflict, and bounded (≤3): re-read the draft and
 * the feedback, re-apply your edit on top of theirs, resubmit with
 * {@link ReviewConflictError.currentRevision} as the new `parent_revision`. The
 * current state/revision/version ride along on the error, so the retry costs no
 * extra round trip.
 */
export class StaleError extends ReviewConflictError {
  override get isRetryable(): boolean {
    return true;
  }
}

/**
 * 409 `wrong_state` - this VERB is illegal from the review's current state, but
 * the draft is still live.
 *
 * **Never retry the same verb**; the timing is not the problem, the choice of
 * call is. Read {@link ReviewConflictError.allowedActions} and pick one of those.
 */
export class WrongStateError extends ReviewConflictError {}

/**
 * 409 `terminal` - the review has already finished (sent / auto_sent /
 * cancelled). Nothing will EVER succeed on it.
 *
 * **Stop.** A `front_run_next` review event is waiting on the durable queue with
 * the outcome; drain it, ack it, and compose a NEW message if one is still
 * wanted. {@link sentMessageId} is the message that actually went out, when the
 * review reached a delivery.
 */
export class TerminalError extends ReviewConflictError {
  /** The message that was actually delivered, when this review sent one. */
  readonly sentMessageId: string | undefined;
  constructor(args: ConstructorParameters<typeof ApiError>[0]) {
    super(args);
    this.sentMessageId = hintCode(args.problem, "sent_message_id");
  }
}

/**
 * 409 `born_stale` - the redraft was composed against an OLDER writing-rule
 * high-water than the one now in force. **Nothing was mutated** and the composer
 * has been re-nudged.
 *
 * Retryable at most once per rule high-water: re-read the rules, re-apply them,
 * resubmit - or `restamp_review` when re-reading shows nothing genuinely needed
 * to change. Restamping when the body DID need to change makes the draft lie to
 * the born-stale accounting, so do it only for a true no-op.
 */
export class BornStaleError extends ReviewConflictError {
  override get isRetryable(): boolean {
    return true;
  }
}

/**
 * 409 `send_needs_reconciliation` - a delivery attempt reached (or may have
 * reached) the mail provider and the process died before recording the outcome,
 * so the review is parked for recover-by-Message-ID.
 *
 * **Do not resend.** That is exactly how one message goes out twice. Poll the
 * review (`closed` / `sent_message_id`) until an operator or the recovery path
 * resolves it.
 */
export class SendNeedsReconciliationError extends ReviewConflictError {}

/**
 * 409 `idempotency_conflict` - the same `Idempotency-Key` was replayed with a
 * DIFFERENT request body within the same scope. The replay key is a hash of the
 * raw bytes, so "same message, different spelling" counts as different.
 *
 * A caller bug, not a race: do not retry under that key. Either send the byte-
 * identical body, or use a new key for the genuinely new message.
 */
export class IdempotencyConflictError extends ConflictError {}

/**
 * 503 `unavailable` - a dependency could not be read, so the request was failed
 * CLOSED rather than served on a guess. On the send path this specifically means
 * the account's review policy was unreadable: relaying unsupervised mail for a
 * customer whose stated policy we could not see is the failure that would be
 * worse than the outage.
 *
 * Retryable after {@link retryAfter} seconds. Distinct from `not_configured`,
 * which means the deployment does not have the capability at all.
 */
export class UnavailableError extends ApiError {
  /** Seconds to wait before retrying, from the `Retry-After` header. */
  readonly retryAfter: number | undefined;
  constructor(args: ConstructorParameters<typeof ApiError>[0] & { retryAfter?: number }) {
    super(args);
    this.retryAfter = args.retryAfter;
  }
}

/** 402 - payment required (x402 test-mode). `paymentRequired` holds the raw challenge header. */
export class PaymentRequiredError extends ApiError {
  /** The raw `PAYMENT-REQUIRED` header challenge to sign + retry (EIP-3009, Base Sepolia). */
  readonly paymentRequired: string | undefined;
  constructor(args: ConstructorParameters<typeof ApiError>[0] & { paymentRequired?: string }) {
    super(args);
    this.paymentRequired = args.paymentRequired;
  }
}

/** 429 - rate limited. `retryAfter` is the server's hint in seconds, when provided. */
export class RateLimitError extends ApiError {
  /** Seconds to wait before retrying, parsed from the `Retry-After` header. */
  readonly retryAfter: number | undefined;
  constructor(args: ConstructorParameters<typeof ApiError>[0] & { retryAfter?: number }) {
    super(args);
    this.retryAfter = args.retryAfter;
  }
}

/** The request failed before a response was received (network down, DNS, abort, timeout). */
export class ConnectionError extends ApiError {
  constructor(message: string, cause?: unknown) {
    super({ status: 0, code: "connection_error", message, cause });
  }
}

/** The request was aborted by the caller's `AbortSignal` or the client `timeout`. */
export class TimeoutError extends ApiError {
  constructor(message = "Request timed out", cause?: unknown) {
    super({ status: 0, code: "timeout", message, cause });
  }
}

/** Map an HTTP status (and the typed problem code, when present) to the most specific {@link ApiError} subclass. */
export function errorForStatus(args: {
  status: number;
  code: string;
  message: string;
  requestId?: string | undefined;
  body?: ApiErrorBody | undefined;
  problem?: Problem | undefined;
  retryAfter?: number | undefined;
  paymentRequired?: string | undefined;
}): ApiError {
  // Prefer the closed problem code when the redesigned surface returned problem+json:
  // it distinguishes forbidden_scope / breadth_required from the generic status class.
  switch (args.problem?.code) {
    case "forbidden_scope":
      return new ForbiddenScopeError(args);
    case "breadth_required":
      return new BreadthRequiredError(args);
    case "idempotency_conflict":
      return new IdempotencyConflictError(args);
    case "recipient_suppressed":
      return new RecipientSuppressedError(args);
    // Review Loop taxonomy. These MUST be matched on the code, not the status:
    // five of them share HTTP 409 and the whole point is that an agent takes a
    // different action on each.
    case "intent_required":
      return new IntentRequiredError(args);
    case "stale":
      return new StaleError(args);
    case "wrong_state":
      return new WrongStateError(args);
    case "terminal":
      return new TerminalError(args);
    case "born_stale":
      return new BornStaleError(args);
    case "send_needs_reconciliation":
      return new SendNeedsReconciliationError(args);
    case "graduation_locked":
    case "maturity_gate_unmet":
    case "scope_taken":
      // Still a 409 with the review hints attached, but there is no distinct
      // recovery move: the caller reads the state hints and asks a human.
      return new ReviewConflictError(args);
    case "unavailable":
      return new UnavailableError(args);
    default:
      break;
  }
  switch (args.status) {
    case 401:
      return new AuthenticationError(args);
    case 402:
      return new PaymentRequiredError(args);
    case 403:
      return new PermissionError(args);
    case 404:
      return new NotFoundError(args);
    case 409:
      return new ConflictError(args);
    case 422:
      return new ValidationError(args);
    case 429:
      return new RateLimitError(args);
    default:
      return new ApiError(args);
  }
}
