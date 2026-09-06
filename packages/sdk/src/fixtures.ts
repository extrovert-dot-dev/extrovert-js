import type { InboxActivation } from "./models.js";
import type { ListWebhooksParams } from "./models.js";
import { AdministrativeFixtures } from "./administration-fixtures.js";
import type { AdministrativeRequest } from "./administration.js";
/**
 * Offline fixtures for the Extrovert SDK.
 *
 * The SDK can run against this in-memory, deterministic mock so examples, the MCP server, and the
 * console are fully navigable offline without contacting the live `/v1` API. Construct a client with
 * `transport: "mock"` (or set `EXTROVERT_API_BASE_URL=mock`) to route requests here instead of fetch.
 *
 * The mock honors the same request/response models as the real API and reproduces the few behaviors
 * the SDK ergonomics depend on (enrollment cap, idempotency on `client_id`, wait_for_email returning
 * an OTP). It is intentionally simple - not a full server - and never reaches the network.
 */

import type {
  AddContactListRequest,
  Agent,
  Attachment,
  AttachmentInput,
  BatchUpdateResult,
  Category,
  CommerceRequest,
  ContactListEntry,
  CreateInboxRequest,
  DeleteResult,
  Domain,
  DomainQuote,
  DomainRecord,
  EnrollRequest,
  EnrollResponse,
  ForwardRequest,
  Inbox,
  InboxCredentials,
  InboxMetadata,
  InboxMetadataPatch,
  IsoTimestamp,
  AckReviewEventRequest,
  AckReviewEventResult,
  Job,
  ListCommerceRequestsParams,
  OnboardDomainRequest,
  QuoteDomainRequest,
  RequestDomainPurchaseRequest,
  RequestPlanChangeRequest,
  ListCategoriesParams,
  ListInboxesParams,
  ProjectInboxListParams,
  ListMessagesParams,
  ListThreadsParams,
  ListReviewEventsParams,
  ListReviewsParams,
  ProposeCategoryRequest,
  ProposeGraduationRequest,
  UpdateCategoryRequest,
  GetRulesParams,
  GetRuleAuditParams,
  GraduationStatus,
  RiskDial,
  Rule,
  RuleSnapshot,
  RuleAuditEntry,
  LearnReviewRuleRequest, LearnedReviewRule,
  SaveRuleRequest,
  Message,
  Page,
  PostReviewChatRequest,
  RegisterWebhookRequest,
  ReplyRequest,
  RestampReviewRequest,
  CategoryPacingState,
  PacingItem,
  Review,
  ReviewDecisionContext,
  ReviewerDecisionRequest,
  ReviewerDecisionResult,
  ReviewEvent,
  ReviewEventsResult,
  ReviewFeedback,
  ReviewTurn,
  ScanBacklogStatus,
  SubmitRevisionRequest,
  SuppressionEntry,
  SuppressionPrecheck,
  ListSuppressionsParams,
  SearchMessagesParams,
  SendOutcome,
  SendRequest,
  SendResult,
  ReviewPolicy,
  ReviewState,
  SignUpRequest,
  SignUpResponse,
  StreamEvent,
  Thread,
  ThreadDetail,
  Submission,
  UpdateInboxRequest,
  UpdateWebhookRequest,
  VerifyRequest,
  VerifyResponse,
  WaitForEmailRequest,
  WaitForEmailResult,
  WaitForReviewEventParams,
  Webhook,
  WhoAmI,
} from "./models.js";
import type { AttachmentDownload } from "./transport.js";
import type { List } from "./pagination.js";
import { extractCredentials } from "./extract.js";
import {
  ApiError,
  ConflictError,
  NotFoundError,
  PermissionError,
  RecipientSuppressedError,
  ValidationError,
  errorForStatus,
} from "./errors.js";
import type { Problem, ProblemCode, ProblemField } from "./problem.js";
import { toArray } from "./recipients.js";

/**
 * Opaque-cursor helpers for the mock's project-prefixed list. The real cursor is
 * server-issued and opaque; the mock encodes a bounded offset behind base64url so
 * the SDK iteration helpers exercise an opaque (non-integer) token end to end.
 */
function encodeMockCursor(offset: number): string {
  const json = JSON.stringify({ o: offset, v: 1 });
  const b64 = typeof btoa === "function" ? btoa(json) : Buffer.from(json, "utf8").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function decodeMockCursor(cursor: string): number {
  try {
    const b64 = cursor.replace(/-/g, "+").replace(/_/g, "/");
    const json = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("utf8");
    const parsed = JSON.parse(json) as { o?: number };
    return typeof parsed.o === "number" && parsed.o >= 0 ? parsed.o : 0;
  } catch {
    return 0;
  }
}

function mailboxQuickstart(address: string): VerifyResponse["mailbox_quickstart"] {
  return {
    inbox: address,
    list_mail: {
      tool: "read_messages",
      arguments: { inbox: address, limit: 20, unread_only: false },
    },
    read_message: {
      tool: "get_message",
      arguments: { id: "<message_id from read_messages>", format: "text", variant: "extracted" },
    },
    wait_for_mail: {
      tool: "wait_for_email",
      arguments: { inbox: address, since_now: true },
    },
  };
}

const PAID_SHARED_DOMAIN = "extrovertmail.com";
const FREE_SHARED_DOMAIN = "free.extrovertmail.com";
const RESERVED_SHARED_LOCAL_PARTS = new Set([
  "postmaster", "admin", "webadmin", "legal", "fraudmark", "fraudmarc", "keith",
  "melissa", "richard", "sydney", "syd", "john", "johnny",
]);

/**
 * The fixed org/project the offline mock binds every key to. The mock has a single
 * org + project (mirroring the FIXED, key-bound org/project the real API resolves
 * from the stored key - there is no mutable selector). A `project_id` assertion on a
 * request must match {@link MOCK_PROJECT_ID} or the mock throws a 403, mirroring the
 * server's assertion-not-selector contract.
 */
const MOCK_ORG_ID = "org_mock";
const MOCK_PROJECT_ID = "prj_mock";
/** Effective per-inbox recipient cap used by the offline API fixture. */
const DEFAULT_DAILY_SEND_LIMIT = 75;

/** Caps for inbox metadata (AgentMail parity): ≤256 keys, ≤256 chars per key/string value. */
const METADATA_MAX_KEYS = 256;
const METADATA_MAX_KEY_LEN = 256;
const METADATA_MAX_VALUE_LEN = 256;

function now(): IsoTimestamp {
  return new Date().toISOString();
}

function rid(prefix: string): string {
  const s = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${s}`;
}

function randomHandle(): string {
  return `agent${Math.floor(1000 + Math.random() * 9000)}`;
}

function validatedSharedLocalPart(value: string): string {
  const normalized = value.toLowerCase().trim().replace(/[^a-z0-9._-]/g, "").replace(/^[._-]+|[._-]+$/g, "").slice(0, 40);
  if (normalized.length < 5 || RESERVED_SHARED_LOCAL_PARTS.has(normalized)) {
    throw new ValidationError({ status: 400, code: "invalid", message: "Shared-domain usernames must normalize to at least 5 characters and cannot use a reserved name." });
  }
  return normalized;
}

/**
 * Enforce the project_id assertion contract (mock): a request `project_id` is an
 * ASSERTION, never a selector. The mock binds every key to {@link MOCK_PROJECT_ID},
 * so a non-matching assertion is a 403, mirroring the server.
 */
function assertProjectMatch(projectId: string | undefined): void {
  if (projectId !== undefined && projectId !== MOCK_PROJECT_ID) {
    throw new PermissionError({
      status: 403,
      code: "project_mismatch",
      message: `project_id "${projectId}" does not match the key's bound project.`,
    });
  }
}

/**
 * Validate an inbox metadata patch against the AgentMail-parity caps and value
 * types (string/number/boolean, or null to delete a key on a PATCH). Throws a 400
 * ValidationError on a violation, mirroring the server.
 */
function validateMetadataPatch(patch: InboxMetadataPatch): void {
  const keys = Object.keys(patch);
  if (keys.length > METADATA_MAX_KEYS) {
    throw new ValidationError({
      status: 400,
      code: "invalid",
      message: `metadata has too many keys (max ${METADATA_MAX_KEYS}).`,
    });
  }
  for (const key of keys) {
    if (key.length > METADATA_MAX_KEY_LEN) {
      throw new ValidationError({
        status: 400,
        code: "invalid",
        message: `metadata key "${key.slice(0, 16)}…" exceeds ${METADATA_MAX_KEY_LEN} chars.`,
      });
    }
    const value = patch[key];
    if (value === null) continue; // null deletes the key (PATCH)
    const t = typeof value;
    if (t !== "string" && t !== "number" && t !== "boolean") {
      throw new ValidationError({
        status: 400,
        code: "invalid",
        message: `metadata value for "${key}" must be a string, number, or boolean.`,
      });
    }
    if (t === "string" && (value as string).length > METADATA_MAX_VALUE_LEN) {
      throw new ValidationError({
        status: 400,
        code: "invalid",
        message: `metadata value for "${key}" exceeds ${METADATA_MAX_VALUE_LEN} chars.`,
      });
    }
  }
}

/**
 * Apply the shallow-merge / null-delete metadata patch semantics (mock):
 * - `undefined` patch leaves `current` unchanged;
 * - `null` patch CLEARS all metadata (returns `{}`);
 * - an object MERGES into `current`, with a per-key `null` value DELETING that key.
 */
function mergeMetadata(
  current: InboxMetadata,
  patch: InboxMetadataPatch | null | undefined,
): InboxMetadata {
  if (patch === undefined) return current;
  if (patch === null) return {};
  validateMetadataPatch(patch);
  const next: InboxMetadata = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete next[key];
    } else {
      next[key] = value;
    }
  }
  return next;
}

/** ruleSnapshotJSON renders a rule's restorable fields for an undo before/after column. */
function ruleSnapshotJSON(r: Rule): string {
  return JSON.stringify({
    id: r.id,
    lineage_id: r.lineage_id,
    rev: r.rev,
    rule_layer: r.rule_layer,
    org_id: r.org_id,
    project_id: r.project_id,
    scope: r.scope,
    category_id: r.category_id,
    rule_text: r.rule_text,
    kind: r.kind,
    priority: r.priority,
    status: r.status,
  });
}

interface MockState {
  agents: Map<string, Agent>;
  /** agent_handle -> agent_id, for idempotent enroll. */
  agentByHandle: Map<string, string>;
  /** client_id -> inbox_id, for idempotent inbox create. */
  inboxByClientId: Map<string, string>;
  /** client_id -> webhook_id, for idempotent webhook registration. */
  webhookByClientId: Map<string, string>;
  inboxes: Map<string, Inbox>;
  messages: Map<string, Message[]>; // keyed by inbox address
  /** message_id -> stored attachments (mock mirror of the real MIME parts). */
  attachments: Map<string, StoredAttachment[]>;
  webhooks: Map<string, Webhook>;
  /** entry id -> contact-list entry (mock mirror of extrovert_contact_lists). */
  contactLists: Map<string, ContactListEntry>;
  /** domain name -> onboarded domain (mock mirror of extrovert_domains). */
  domains: Map<string, Domain>;
  /** job id -> async job status (mock mirror of extrovert_jobs; currently only
   *  the domain-offboard teardown enqueues one). */
  jobs: Map<string, Job>;
  /** request id -> agent-initiated commerce request. */
  commerceRequests: Map<string, CommerceRequest>;
  /** request kind + stable Idempotency-Key -> request id. */
  commerceByIdempotency: Map<string, string>;
  /** suppression id -> recipient opt-out row (mock mirror of extrovert_suppressions). */
  suppressions: Map<string, SuppressionEntry>;
  /**
   * The account-level review policy (mock mirror of
   * extrovert_org_settings.review_policy).
   *
   * It defaults to `require_review` because that is the column default on the
   * REAL server for every org that has never touched it - i.e. every org. The
   * mock used to model no policy at all, so a bare `send()` sailed through
   * offline while the same call against production is refused 422. A mock that
   * cannot reproduce the platform's default posture is a mock that certifies
   * broken agents.
   */
  orgReviewPolicy: ReviewPolicy;
  /** address -> per-inbox override, which BEATS the account default when set. */
  inboxReviewPolicy: Map<string, ReviewPolicy>;
  /** review id -> review request (mock mirror of extrovert_review_requests). */
  reviews: Map<string, Review>;
  /** review id -> append-only thread turns. */
  reviewTurns: Map<string, ReviewTurn[]>;
  /**
   * review id -> the draft's attachments (mock mirror of proposed_attachments).
   * They survive submit -> review row -> approval on the real server now, so the
   * mock has to carry them too or a redraft that replaces them looks like a no-op.
   */
  reviewAttachments: Map<string, AttachmentInput[]>;
  /**
   * review id -> reviewer hand-back count (M8 Slice B circuit breaker (a)). The wire
   * Review shape doesn't carry hop_count, so the mock tracks it here to surface the
   * max_hops breaker on the decision context + reviewerDecide.
   */
  reviewHopCounts: Map<string, number>;
  /**
   * review id -> durable nudges (mock mirror of extrovert_review_nudges), oldest
   * first with a per-review monotonic seq. The authoritative liveness queue.
   */
  reviewEvents: Map<string, ReviewEvent[]>;
  /** review id -> last-acked seq (the per-(agent, review) cursor). */
  reviewEventCursors: Map<string, number>;
  /** idempotency-key -> the review state snapshot returned (chat replay, M5 parity v21). */
  chatByIdempotencyKey: Map<string, Review>;
  /** category id -> category (mock mirror of extrovert_categories, D9/D10). */
  categories: Map<string, Category>;
  /** rule id -> writing rule (mock mirror of extrovert_writing_rules, D2/D11). */
  rules: Map<string, Rule>;
  /** udo id -> change/undo audit row (mock mirror of extrovert_rule_undo_log). */
  ruleAudit: Map<string, RuleAuditEntry>;
  /** human_email -> self-signup state (mock OTP + verification). */
  signupByEmail: Map<string, SignupState>;
  /** Monotonic event journal backing the SSE stream (Slice 2). */
  events: StreamEvent[];
  /** Next event seq (monotonic, mirrors the server's AUTOINCREMENT). */
  eventSeq: number;
  mailboxesUsed: number;
  mailboxesMax: number;
}

/** Mock self-signup bookkeeping (in-memory OTP). */
interface SignupState {
  customerId: string;
  agentId: string;
  address: string;
  otp: string;
  verified: boolean;
}

/** A mock attachment: the wire metadata plus the raw base64 for download. */
interface StoredAttachment {
  meta: Attachment;
  content_base64: string;
}

function freshState(): MockState {
  return {
    agents: new Map(),
    agentByHandle: new Map(),
    inboxByClientId: new Map(),
    webhookByClientId: new Map(),
    inboxes: new Map(),
    messages: new Map(),
    attachments: new Map(),
    webhooks: new Map(),
    contactLists: new Map(),
    domains: new Map(),
    jobs: new Map(),
    commerceRequests: new Map(),
    commerceByIdempotency: new Map(),
    suppressions: seedSuppressions(),
    orgReviewPolicy: "require_review",
    inboxReviewPolicy: new Map(),
    reviews: new Map(),
    reviewTurns: new Map(),
    reviewAttachments: new Map(),
    reviewHopCounts: new Map(),
    reviewEvents: new Map(),
    reviewEventCursors: new Map(),
    chatByIdempotencyKey: new Map(),
    categories: new Map(),
    rules: new Map(),
    ruleAudit: new Map(),
    signupByEmail: new Map(),
    events: [],
    eventSeq: 0,
    mailboxesUsed: 0,
    mailboxesMax: 5,
  };
}

/**
 * The recipient the mock seeds an active org-scope suppression for, so the
 * suppression reads (precheck/list/revoke) and the `recipient_suppressed`
 * send-rejection path have deterministic data offline.
 */
export const SEEDED_SUPPRESSED_RECIPIENT = "unsubscribed@example.com";

/** Seed one active org-scope suppression row (source manual) for the mock. */
function seedSuppressions(): Map<string, SuppressionEntry> {
  const m = new Map<string, SuppressionEntry>();
  const id = rid("sup");
  m.set(id, {
    id,
    recipient: SEEDED_SUPPRESSED_RECIPIENT,
    recipient_raw: SEEDED_SUPPRESSED_RECIPIENT,
    scope: "org",
    source: "manual",
    reactivation_count: 0,
    created_at: now(),
    revoked: false,
  });
  return m;
}

// ---------------------------------------------------------------------------
// Review-policy + review-loop helpers, mirrored from the server so the mock and
// production cannot disagree about who gets refused and why.
// ---------------------------------------------------------------------------

/** A reply's server-derived envelope: recipients, `Re:` subject, thread. */
interface ReplyEnvelope {
  to: string[];
  subject: string;
  threadId: string;
}

/**
 * Whether the resolved policy turns this asserted mode into a review.
 *
 * `require_review` always does. `allow_direct` keeps `direct` iff the agent
 * ACTUALLY asserted it. `auto_send_graduated` is decided per-message by the
 * gates, so the conservative treatment is "review unless direct under
 * allow_direct" - the intent is still required, because the message may well end
 * up in the human queue and the summary is the reviewer's only context.
 */
function resolvedModeIsReview(policy: ReviewPolicy, mode: "review" | "direct"): boolean {
  if (policy === "allow_direct" && mode === "direct") return false;
  return true;
}

/** The four states nothing will ever move a review out of (`closed` on the read shape). */
const CLOSED_REVIEW_STATES: ReadonlySet<ReviewState> = new Set<ReviewState>([
  "sent",
  "auto_sent",
  "cancelled",
  // `failed` is in the CLOSED set although it is not formally terminal: the
  // console cannot re-approve it and no sweep moves it, so an agent told
  // closed=false there would wait forever.
  "failed",
]);

/**
 * The states that answer 409 `terminal` rather than `wrong_state` - a review that
 * has finished for good, where the answer is STOP, not "try a different verb".
 * `failed` is deliberately NOT here: an agent may still `cancel_review` it, which
 * is its one legal close-out.
 */
const TERMINAL_REVIEW_STATES: ReadonlySet<ReviewState> = new Set<ReviewState>([
  "sent",
  "auto_sent",
  "cancelled",
]);

/**
 * The verbs a COMPOSING agent may legally call against a draft in this state,
 * most actionable first, reads last - the mock's mirror of the server's
 * `AllowedAgentActions`, which is what fills a 409's `allowed_action` hints.
 *
 * The reads are unconditional, which is why the list is never empty: from a
 * terminal state the honest answer is "nothing will mutate this, go look at what
 * happened".
 */
function allowedAgentActions(state: ReviewState): string[] {
  const actions: string[] = [];
  // submit_revision targets needs_review WITH a revision bump - including the
  // needs_review self-edge, which is a legal redraft (a revision bump IS a change).
  if (state === "needs_review" || state === "in_review" || state === "chatting" ||
      state === "stale" || state === "rejected") {
    actions.push("submit_revision");
  }
  // post_review_chat: legal from needs_review for a NON-human actor (an agent may
  // ask a question about a queued draft; it must not fabricate a reviewer, so the
  // state does not change).
  if (state === "needs_review" || state === "in_review" || state === "chatting") {
    actions.push("post_review_chat");
  }
  if (state === "needs_review" || state === "in_review" || state === "chatting" || state === "stale") {
    actions.push("restamp_review");
  }
  if (state === "needs_review" || state === "in_review" || state === "chatting" ||
      state === "stale" || state === "rejected" || state === "failed") {
    actions.push("cancel_review");
  }
  return [...actions, "get_review", "list_review_events"];
}

/** Build an RFC-9457 problem body the mock can hand to the SAME parser the live client uses. */
function mockProblem(
  code: ProblemCode,
  status: number,
  title: string,
  detail: string,
  fields: ProblemField[],
): Problem {
  return {
    type: `https://extrovert.dev/problems/${code}`,
    title,
    status,
    code,
    detail,
    request_id: rid("req"),
    errors: fields.length ? fields : undefined,
  };
}

/**
 * Raise the mock error through {@link errorForStatus}, the SAME factory the HTTP
 * transport uses on a real problem+json body. That is deliberate: it means the
 * offline mock cannot hand back a different error CLASS than production for the
 * same code, which is precisely the divergence that let a wire bug live behind
 * green demos.
 */
function problemError(problem: Problem, message?: string): ApiError {
  return errorForStatus({
    status: problem.status,
    code: problem.code,
    message: message ?? problem.detail ?? problem.title,
    requestId: problem.request_id,
    problem,
  });
}

/**
 * The literal `intent_required` 422, remediation and all.
 *
 * The full recipe lives in `detail` (not only in `errors[]`) for the same reason
 * it does on the server: the MCP tool surface renders only the message, so
 * anything that exists only in `errors[]` is invisible to the model that has to
 * fix the request. `errors[]` carries the machine-readable duplicate - including
 * `retry_with`, the literal JSON to splice into the original body.
 */
function intentRequiredError(policy: ReviewPolicy, inboxOverride: boolean): ApiError {
  const source = inboxOverride
    ? "a per-inbox override on this inbox"
    : "the account default; no per-inbox override";
  const detail =
    `This inbox requires human review before sending (review policy: ${policy}, from ${source}). ` +
    "Nothing was sent and nothing was queued. " +
    "Retry the SAME request with an `intent` object added: " +
    '{"intent":{"summary":"<one sentence: who you are writing to, what you want, and why now>"}}. ' +
    "That summary is the first thing the human reviewer reads; 8-200 characters. " +
    "Optional: intent.meta {goal, recipient, prior_touches, urgency} for reviewer context, " +
    "and category_id (cat_...) from list_categories. " +
    "On success you get 202 queued_for_review with a review id (rr_...); then monitor it with " +
    "wait_for_review_event / list_review_events until you receive a `sent` or `send_failed` event.";
  return problemError(
    mockProblem("intent_required", 422, "Intent Required", detail, [
      { field: "intent.summary", code: "required",
        detail: "One sentence for the human reviewer: who / what / why. 8-200 chars." },
      { field: "intent.meta", code: "optional",
        detail: "{goal, recipient, prior_touches, urgency} - improves the reviewer's decision context." },
      { field: "category_id", code: "optional",
        detail: "cat_... from list_categories. A graduated category can auto-send without a human." },
      { field: "policy", code: "review_policy", detail: `${policy} (source: ${source})` },
      { field: "retry_with", code: "example", detail: INTENT_RETRY_EXAMPLE },
    ]),
  );
}

/** The literal JSON an agent splices into its original request to fix a 422 in one turn. */
export const INTENT_RETRY_EXAMPLE =
  '{"intent":{"summary":"Follow up with vp@acme.com on the Q3 pilot; 2 prior touches"}}';

/**
 * A review-loop 409 carrying the recovery FACTS the agent needs: the live state,
 * the CAS keys a legal retry must quote, and the verbs that ARE legal now. The
 * split between `stale` / `wrong_state` / `terminal` is the whole point - only
 * `stale` and `born_stale` are worth retrying.
 */
function reviewConflict(
  code: "stale" | "wrong_state" | "terminal" | "born_stale",
  review: Review,
  detail: string,
): ApiError {
  const fields: ProblemField[] = [
    { field: "state", code: review.state, detail: "the draft's current state" },
  ];
  if (code === "terminal") {
    if (review.sent_message_id) {
      fields.push({
        field: "sent_message_id",
        code: review.sent_message_id,
        detail: "the message that was actually delivered",
      });
    }
  } else {
    fields.push(
      { field: "revision", code: String(review.revision), detail: "current revision - use as parent_revision" },
      { field: "version", code: String(review.version), detail: "current row version" },
    );
  }
  for (const action of allowedAgentActions(review.state)) {
    fields.push({ field: "allowed_action", code: action, detail: ALLOWED_ACTION_DETAIL[action] ?? "" });
  }
  return problemError(mockProblem(code, 409, "Conflict", detail, fields));
}

/** One-line "why you would call this" per advertised verb, so it reads the same everywhere. */
const ALLOWED_ACTION_DETAIL: Readonly<Record<string, string>> = {
  submit_revision: "post a new draft under parent_revision",
  post_review_chat: "ask the reviewer a clarifying question",
  restamp_review: "assert the draft is current against the rules without redrafting",
  cancel_review: "withdraw this review",
  get_review: "re-read the draft",
  list_review_events: "wait for the delivery outcome",
};

/** Mock 404 helper (mirrors the transport's). */
function notFoundMock(kind: string, id: string): NotFoundError {
  return new NotFoundError({
    status: 404,
    code: "not_found",
    message: `No ${kind} found for "${id}" in the offline mock.`,
  });
}

/** Materialize a forward's quoted body, exactly as the server does at submit time. */
function forwardBodyText(note: string, parent: Message): string {
  return `${note}\n\n---------- Forwarded message ----------\nFrom: ${parent.from.email}\nSubject: ${parent.subject}\n\n${parent.text}`;
}

/**
 * A self-contained, deterministic-enough in-memory backend implementing the subset of behavior the
 * SDK exposes. One instance per mock client so tests/examples don't bleed into each other.
 */
export class MockBackend {
  incomingActivation = false;
  private pendingActivation?: InboxActivation;
  activationStatus(): InboxActivation {
    const activation = this.pendingActivation;
    if (!activation) throw new Error("No incoming-email activation exists");
    if (activation.expires_ms <= Date.now() && activation.state !== "activated") activation.state = "expired";
    return { ...activation };
  }
  correctActivationEmail(email: string, revision: number): InboxActivation {
    const activation = this.activationStatus();
    if (activation.revision !== revision || !["pending", "proven"].includes(activation.state)) throw new Error("Activation changed or expired");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Invalid human email");
    this.pendingActivation = { ...activation, human_email: email, revision: revision + 1, state: "pending" };
    return this.activationStatus();
  }
  /** Test-only trusted delivery; never available through a production client. */
  proveFixtureActivation(sender: string): void {
    const activation = this.activationStatus();
    if (activation.state !== "pending" || sender !== activation.human_email) throw new Error("Activation sender mismatch or expired");
    this.pendingActivation = { ...activation, state: "proven" };
  }
  private administrativeFixtures = new AdministrativeFixtures();
  configureAdministrativeFixture(credential: string): void { this.administrativeFixtures = new AdministrativeFixtures(credential); }
  administrativeRequest(request: AdministrativeRequest): Promise<unknown> { return this.administrativeFixtures.request(request); }

  private state: MockState = freshState();

  reset(): void {
    this.state = freshState();
  }

  enroll(req: EnrollRequest): EnrollResponse {
    const existingId = this.state.agentByHandle.get(req.agent_handle);
    const agentId = existingId ?? rid("agt");
    if (!existingId) {
      const agent: Agent = {
        id: agentId,
        name: req.agent_name ?? null,
        status: "active",
        scopes: ["mailbox:create", "mailbox:read", "mailbox:send", "webhook:write"],
        created_at: now(),
        metadata: {},
      };
      this.state.agents.set(agentId, agent);
      this.state.agentByHandle.set(req.agent_handle, agentId);
    }
    // Mirror the frozen EnrollResult wire shape EXACTLY (agent_id, agent_key, scopes,
    // org_id, project_id) so SDK tests exercise the same fields the live server emits  -
    // no agent_key_prefix/expires_at/mailboxes_* (those are NOT in the contract).
    return {
      agent_id: agentId,
      agent_key: `pk_agent_proj_${agentId.slice(4)}_${rid("sk").slice(3)}`,
      scopes: ["mailbox:create", "mailbox:read", "mailbox:send", "webhook:write"],
      // The issued key is bound to the token's resolved org/project; the agent cannot change it.
      org_id: MOCK_ORG_ID,
      project_id: MOCK_PROJECT_ID,
    };
  }

  /**
   * Self-signup (Slice E). Returns a LIMITED-scope key and a first inbox; the OTP
   * is held in-memory (mock only) so `verify` can elevate to full scope. Idempotent
   * on human_email: a re-call reuses the tenant/agent and rotates the OTP.
   */
  signUp(req: SignUpRequest): SignUpResponse {
    const email = req.human_email.trim().toLowerCase();
    const existing = this.state.signupByEmail.get(email);
    const customerId = existing?.customerId ?? `cus_pn_signup_${rid("c").slice(2)}`;
    const agentId = existing?.agentId ?? rid("agt");
    const address =
      existing?.address ?? `${validatedSharedLocalPart(req.username ?? randomHandle())}@${FREE_SHARED_DOMAIN}`;
    // Stable offline code keeps the full signup → mailbox handoff executable in
    // examples and contract tests without ever weakening the live API's CSPRNG.
    const otp = "492013";
    if (this.incomingActivation) {
      if (existing) throw new Error("Activation already pending; use the existing key");
      this.pendingActivation = { agent_id: agentId, address, human_email: email, created_ms: Date.now(), expires_ms: Date.now() + 86400000, revision: 1, state: "pending" };
    }
    this.state.signupByEmail.set(email, { customerId, agentId, address, otp, verified: false });
    return {
      customer_id: customerId,
      agent_id: agentId,
      agent_key: `pk_agent_${agentId.slice(4)}_${rid("sk").slice(3)}`,
      key_prefix: `pk_agent_${agentId.slice(4, 8)}`,
      scopes: ["signup:verify"],
      address,
      verified: false,
      ...(this.incomingActivation ? {
        activation_method: "incoming_email" as const, human_email: email,
        activation_expires_at: new Date(this.pendingActivation!.expires_ms).toISOString(),
        message: `Your agent’s inbox is almost ready. Send an email from ${email} to ${address} to activate it and link it to your human email.`,
      } : { otp_sent_to: email,
        otp_expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        message: "A verification code was sent to your email. Call verify with it.",
      }),
    };
  }

  /** Confirm a signup OTP and return a full-scope key (mock). */
  verify(req: VerifyRequest): VerifyResponse {
    // The mock matches the OTP against any pending signup (single-tenant fixture).
    for (const [, s] of this.state.signupByEmail) {
      if (!s.verified && (this.incomingActivation ? this.activationStatus().state === "proven" && this.pendingActivation?.agent_id === s.agentId : s.otp === (req.otp ?? "").trim())) {
        s.verified = true;
        if (this.incomingActivation && this.pendingActivation) this.pendingActivation.state = "activated";
        return {
          agent_id: s.agentId,
          agent_key: `pk_agent_${s.agentId.slice(4)}_${rid("sk").slice(3)}`,
          key_prefix: `pk_agent_${s.agentId.slice(4, 8)}`,
          scopes: ["mailbox:create", "mailbox:read", "mailbox:send"],
          address: s.address,
          verified: true,
          message:
            "Verified. The inbox is ready; use read_messages, then get_message with a returned message id.",
          mailbox_quickstart: mailboxQuickstart(s.address),
        };
      }
    }
    throw new Error("verification code invalid or expired");
  }

  /** Introspect the mock principal (GET /v1/auth/me). */
  whoami(): WhoAmI {
    return {
      customer_id: "cus_pn_mock",
      org_id: MOCK_ORG_ID,
      project_id: MOCK_PROJECT_ID,
      agent_id: this.state.agents.keys().next().value ?? "agt_mock",
      key_id: "pkey_mock",
      scopes: ["mailbox:create", "mailbox:read", "mailbox:send", "webhook:write"],
    };
  }

  createInbox(req: CreateInboxRequest): Inbox {
    // project_id is an assertion (never a selector): a mismatch is 403.
    assertProjectMatch(req.project_id);
    if (req.client_id) {
      const existing = this.state.inboxByClientId.get(req.client_id);
      if (existing) {
        // Idempotent replay returns the existing inbox verbatim (incl. its metadata).
        const inbox = this.state.inboxes.get(existing);
        if (inbox) return inbox;
      }
    }
    // Validate (and snapshot) the create-time metadata: no null deletes on create.
    const metadata = req.metadata ? mergeMetadata({}, req.metadata) : {};
    const domain = req.domain ?? PAID_SHARED_DOMAIN;
    const normalizedDomain = domain.trim().toLowerCase();
    const isSharedDomain = normalizedDomain === PAID_SHARED_DOMAIN || normalizedDomain === FREE_SHARED_DOMAIN;
    const username = isSharedDomain ? validatedSharedLocalPart(req.username ?? randomHandle()) : (req.username ?? randomHandle());
    const id = rid("ibx");
    const inbox: Inbox = {
      object: "inbox",
      id,
      org_id: MOCK_ORG_ID,
      project_id: MOCK_PROJECT_ID,
      address: `${username}@${domain}`,
      username,
      domain,
      display_name: req.display_name ?? null,
      status: "live",
      onboarding_mode: req.domain ? "ns_delegated" : "shared",
      agent_id: null,
      daily_send_limit: DEFAULT_DAILY_SEND_LIMIT,
      direct_smtp_enabled: false,
      webhook_url: req.webhook_url ?? null,
      metadata,
      created_at: now(),
      ...(req.return_credentials
        ? {
            credentials: {
              imap_host: "smtp.extrovert.dev",
              imap_port: 993,
              smtp_host: "smtp.extrovert.dev",
              smtp_port: 587,
              username: `${username}@${domain}`,
              password: rid("mbpw").slice(5),
            },
          }
        : {}),
    };
    this.state.inboxes.set(id, inbox);
    this.state.inboxes.set(inbox.address, inbox);
    this.state.messages.set(inbox.address, []);
    if (req.client_id) this.state.inboxByClientId.set(req.client_id, id);
    this.state.mailboxesUsed += 1;
    return inbox;
  }

  listInboxes(params: ListInboxesParams = {}): Page<Inbox> {
    let items = [...new Set(this.state.inboxes.values())].filter(
      (ibx) => ibx.id.startsWith("ibx"),
    );
    if (params.domain) items = items.filter((i) => i.domain.toLowerCase() === params.domain!.trim().toLowerCase());
    if (params.status) items = items.filter((i) => i.status === params.status);
    items.sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
    const limit = Math.min(Math.max(params.limit ?? 50, 1), 100);
    const offset = params.cursor ? decodeMockCursor(params.cursor) : 0;
    const slice = items.slice(offset, offset + limit);
    const has_more = offset + limit < items.length;
    return { items: slice, total: items.length, has_more, ...(has_more ? { next_cursor: encodeMockCursor(offset + limit) } : {}) };
  }

  getInbox(address: string): Inbox | undefined {
    const inbox = this.state.inboxes.get(address);
    if (!inbox) return undefined;
    // effective_review_policy rides the SINGLE-inbox read only - the list path
    // omits it on the server (it would be one settings read per row for a value
    // identical across the org), so the mock omits it there too. Reading it once at
    // start-up is how an agent plans its first send instead of discovering the
    // policy by being refused 422.
    return { ...inbox, effective_review_policy: this.reviewPolicyFor(inbox.address) };
  }

  /**
   * Normalize an inbox ref (opaque id OR address alias) to the canonical address the
   * mock keys its message/thread/contact maps on. The SDK now routes inbox ops by the
   * canonical opaque `id` when it holds a full record (matching the contract's
   * canonical-key semantics), so the mock must resolve an id back to its address  -
   * both key `state.inboxes` (same object), `state.messages` keys by address only.
   * Unknown refs pass through unchanged so the existing not-found paths still fire.
   */
  private addrOf(ref: string): string {
    return this.state.inboxes.get(ref)?.address ?? ref;
  }

  updateInbox(address: string, req: UpdateInboxRequest): Inbox | undefined {
    // project_id is an assertion (never a selector): a mismatch is 403.
    assertProjectMatch(req.project_id);
    const inbox = this.state.inboxes.get(address);
    if (!inbox) return undefined;
    if (req.display_name !== undefined) {
      inbox.display_name = req.display_name === "" ? null : req.display_name;
    }
    if (req.webhook_url !== undefined) {
      inbox.webhook_url = req.webhook_url === "" ? null : req.webhook_url;
    }
    if (req.daily_send_limit !== undefined) {
      if (
        !Number.isInteger(req.daily_send_limit) ||
        req.daily_send_limit < 1 ||
        req.daily_send_limit > 10_000
      ) {
        throw new ValidationError({
          status: 400,
          code: "invalid",
          message: "daily_send_limit must be an integer from 1 through 10000.",
        });
      }
      inbox.daily_send_limit = req.daily_send_limit;
    }
    // Metadata: shallow merge, per-key null deletes, top-level null clears all,
    // omitted leaves unchanged (see UpdateInboxRequest.metadata).
    if (req.metadata !== undefined) {
      inbox.metadata = mergeMetadata(inbox.metadata, req.metadata);
    }
    // The record is shared by id + address keys (same object), so both views update.
    return inbox;
  }

  deleteInbox(address: string): void {
    const inbox = this.state.inboxes.get(address);
    if (inbox) {
      this.state.inboxes.delete(inbox.id);
      this.state.inboxes.delete(inbox.address);
      this.state.messages.delete(inbox.address);
    }
  }

  // ---- Canonical project-prefixed inbox chain (x.projects.inboxes.*) ----------
  // The mock binds every key to MOCK_PROJECT_ID; the wildcard "-" (org breadth) is
  // accepted for an org-tier key. A concrete project outside the bound project is a
  // 404 (out-of-ceiling), mirroring the server's fail-closed addressing. An inbox
  // is resolved by its opaque id OR its address alias (both key the same map).

  /** Resolve the project path segment against the mock's bound project (fail-closed). */
  private resolveProjectSegment(projectId: string): void {
    if (projectId === "-" || projectId === MOCK_PROJECT_ID) return;
    // A concrete, out-of-ceiling project id is a 404 (never an existence oracle).
    throw new NotFoundError({
      status: 404,
      code: "not_found",
      message: `project "${projectId}" is outside this key's ceiling.`,
    });
  }

  createInboxInProject(projectId: string, req: CreateInboxRequest): Inbox {
    // A bare org wildcard create needs a concrete project (breadth_required) - the
    // mock has a single project, so "-" still resolves to it for ergonomics.
    this.resolveProjectSegment(projectId);
    return this.createInbox(req);
  }

  listInboxesInProject(projectId: string, params: ProjectInboxListParams = {}): List<Inbox> {
    this.resolveProjectSegment(projectId);
    let items = [...new Set(this.state.inboxes.values())].filter((ibx) => ibx.id.startsWith("ibx"));
    if (params.domain) items = items.filter((i) => i.domain.toLowerCase() === params.domain!.trim().toLowerCase());
    items.sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
    // Opaque-cursor pagination over the offset-based mock store.
    const limit = Math.min(Math.max(params.limit ?? 50, 1), 100);
    const offset = params.cursor ? decodeMockCursor(params.cursor) : 0;
    const slice = items.slice(offset, offset + limit);
    const hasMore = offset + limit < items.length;
    return {
      object: "list",
      data: slice,
      has_more: hasMore,
      next_cursor: hasMore ? encodeMockCursor(offset + limit) : null,
    };
  }

  getInboxInProject(projectId: string, inboxId: string): Inbox | undefined {
    this.resolveProjectSegment(projectId);
    return this.state.inboxes.get(inboxId);
  }

  updateInboxInProject(projectId: string, inboxId: string, req: UpdateInboxRequest): Inbox | undefined {
    this.resolveProjectSegment(projectId);
    const inbox = this.state.inboxes.get(inboxId);
    if (!inbox) return undefined;
    return this.updateInbox(inbox.address, req);
  }

  deleteInboxInProject(projectId: string, inboxId: string): boolean {
    this.resolveProjectSegment(projectId);
    const inbox = this.state.inboxes.get(inboxId);
    if (!inbox) return false;
    this.deleteInbox(inbox.address);
    return true;
  }

  getInboxCredentialsInProject(projectId: string, inboxId: string): InboxCredentials | undefined {
    this.resolveProjectSegment(projectId);
    const inbox = this.state.inboxes.get(inboxId);
    if (!inbox) return undefined;
    return (
      inbox.credentials ?? {
        imap_host: "smtp.extrovert.dev",
        imap_port: 993,
        smtp_host: "smtp.extrovert.dev",
        smtp_port: 587,
        username: inbox.address,
        password: rid("mbpw").slice(5),
      }
    );
  }

  // ---- Outbound: ONE policy-governed path (mock mirror of SubmitForReview) ----
  //
  // send / reply / forward / submitForReview / submitReplyForReview used to be five
  // separate mock implementations, and only the two `submit*` ones knew the review
  // loop existed. That is the same shape as the server bug this change set fixes:
  // policy enforcement living in a code path a caller can route around. On the real
  // server all five are ONE handler calling ONE service entry point, so they are one
  // method here too. If a rule can be bypassed by picking a different SDK method,
  // the mock will happily certify an agent that production refuses.
  //
  // The order below mirrors Service.SubmitForReview exactly, and the order is
  // load-bearing:
  //
  //   1. resolve the policy (inbox override > account default > require_review floor)
  //   2. default the mode from the policy + whether the caller asserted one
  //   3. PRE-FLIGHT: contact lists + suppression, on the FULL recipient set
  //   4. the intent gate (422 intent_required)
  //   5. route: auto-send, or park in needs_review
  //
  // (3) before (4) matters: a blocked or suppressed recipient is a fact no amount of
  // intent will fix, and answering `intent_required` first would send the agent off
  // to add an intent and retry straight into the same wall.

  /** The RESOLVED review policy for an inbox: per-inbox override, else the account default. */
  reviewPolicyFor(address: string): ReviewPolicy {
    return this.state.inboxReviewPolicy.get(this.addrOf(address)) ?? this.state.orgReviewPolicy;
  }

  /**
   * Mock-only: set the ACCOUNT-level review policy (the console/admin plane sets
   * this on the real server; there is no agent-plane write for it). Use it to
   * exercise an org that has been configured for direct sending.
   */
  setReviewPolicy(policy: ReviewPolicy): void {
    this.state.orgReviewPolicy = policy;
  }

  /** Mock-only: set (or clear) the per-inbox override, which beats the account default. */
  setInboxReviewPolicy(address: string, policy: ReviewPolicy | undefined): void {
    const addr = this.addrOf(address);
    if (policy === undefined) this.state.inboxReviewPolicy.delete(addr);
    else this.state.inboxReviewPolicy.set(addr, policy);
  }

  send(address: string, req: SendRequest): SendOutcome {
    address = this.addrOf(address);
    return this.submitOutbound({
      address,
      kind: "send",
      req,
      to: toArray(req.to),
      cc: toArray(req.cc),
      bcc: toArray(req.bcc),
      subject: req.subject ?? "",
      text: req.text ?? "",
      html: req.html,
      deliver: () => this.deliverSend(address, req),
    });
  }

  reply(address: string, req: ReplyRequest): SendOutcome {
    address = this.addrOf(address);
    // Envelope materialization: the reply's recipients and `Re:` subject are derived
    // from the parent HERE, before the pre-flight, so the block/suppression checks
    // screen the addresses that will actually be mailed and the reviewer reads the
    // real subject instead of an empty one.
    const env = this.deriveReplyEnvelope(address, req);
    return this.submitOutbound({
      address,
      kind: "reply",
      req,
      to: env.to,
      cc: toArray(req.cc),
      bcc: toArray(req.bcc),
      subject: env.subject,
      text: req.text ?? "",
      html: req.html,
      deliver: () => this.deliverReply(address, req, env),
    });
  }

  forward(address: string, messageId: string, req: ForwardRequest): SendOutcome {
    address = this.addrOf(address);
    const parent = (this.state.messages.get(address) ?? []).find((m) => m.id === messageId);
    if (!parent) throw notFoundMock("message", messageId);
    // A forward is materialized at submit for the same reason a reply is, plus one
    // that is specific to it: the human must review the ACTUAL quoted thread they
    // are about to release to new recipients, not a note whose quote gets rebuilt
    // from the live parent at approval time.
    const subject = fwdSubject(parent.subject);
    const text = forwardBodyText(req.text ?? "", parent);
    return this.submitOutbound({
      address,
      kind: "forward",
      req,
      to: toArray(req.to),
      cc: toArray(req.cc),
      bcc: toArray(req.bcc),
      subject,
      text,
      deliver: () =>
        this.deliverRaw(address, {
          to: toArray(req.to),
          cc: toArray(req.cc),
          subject,
          text,
          threadId: parent.thread_id,
        }),
    });
  }

  /**
   * Submit a new message for review (mock). Rides the SAME endpoint as `send` on
   * the real server, so it is literally the same call here: the resolved policy  -
   * not which SDK method you picked - decides whether the message is queued
   * (`kind:"queued_for_review"`) or delivered.
   */
  submitForReview(address: string, req: SendRequest): SendOutcome {
    return this.send(address, req);
  }

  /** Submit an in-thread reply for review (mock). Same endpoint, same routing, as `reply`. */
  submitReplyForReview(address: string, req: ReplyRequest): SendOutcome {
    return this.reply(address, req);
  }

  /**
   * The single enforcement point. Everything above funnels here; nothing else in
   * the mock may reach `deliver*` on the agent plane.
   */
  private submitOutbound(params: {
    address: string;
    kind: "send" | "reply" | "forward";
    req: {
      mode?: "review" | "direct";
      intent?: { summary: string; meta?: Record<string, unknown> };
      category_id?: string;
    };
    to: string[];
    cc: string[];
    bcc: string[];
    subject: string;
    text: string;
    html?: string;
    deliver: () => SendResult;
  }): SendOutcome {
    const { address, kind, req } = params;
    const policy = this.reviewPolicyFor(address);

    // A caller "opted in" by mentioning the review loop at all. It decides the
    // RESPONSE SHAPE and the mode default - never whether the policy applies.
    const optedIn =
      req.mode !== undefined || req.intent !== undefined || (req.category_id ?? "") !== "";

    // POLICY-AWARE MODE DEFAULT. Order is load-bearing: an explicit assertion wins
    // (the policy may still refuse it); then a caller that supplied any review field
    // but no mode keeps the historical opt-in meaning ("queue this"); only then does
    // an allow_direct org's bare send stay direct; everything else - require_review,
    // auto_send_graduated, and any policy value we do not recognize - falls to
    // review. Unknown policies MUST land there: a value a newer node wrote must
    // never be read by an older client as permission.
    let mode: "review" | "direct";
    if (req.mode !== undefined) mode = req.mode;
    else if (optedIn) mode = "review";
    else if (policy === "allow_direct") mode = "direct";
    else mode = "review";

    // PRE-FLIGHT on the full recipient set (to + cc + bcc), before the intent gate.
    const recipients = [...params.to, ...params.cc, ...params.bcc];
    this.enforceSendPolicy(address, recipients);
    this.enforceSuppression(recipients);

    // D3 intent gate. NOTHING is written and NOTHING is sent when it fires, which
    // is exactly what makes the amended retry safe.
    if (resolvedModeIsReview(policy, mode) && !req.intent?.summary?.trim()) {
      throw intentRequiredError(policy, this.state.inboxReviewPolicy.has(address));
    }

    const review = this.createReviewRecord(address, {
      kind,
      subject: params.subject,
      text: params.text,
      html: params.html,
      to: params.to,
      cc: params.cc,
      bcc: params.bcc,
      intent: req.intent,
      categoryId: req.category_id,
      mode,
    });

    // ROUTING. Two auto-send paths reach delivery without a human:
    //   - allow_direct + an asserted (or defaulted) `direct` mode
    //   - auto_send_graduated + a category the agent named
    // Everything else - including auto_send_graduated with NO category - is held,
    // and the gate_outcome records why so the agent is not left guessing.
    const directAuto = policy === "allow_direct" && mode === "direct";
    const graduatedAuto = policy === "auto_send_graduated" && (req.category_id ?? "") !== "";
    if (!directAuto && !graduatedAuto) {
      if (policy === "auto_send_graduated") review.gate_outcome = "held:no_category";
      this.state.reviews.set(review.id, review);
      return {
        kind: "queued_for_review",
        review: { id: review.id, state: review.state, effective_mode: review.effective_mode },
      };
    }

    const sent = params.deliver();
    const tracking = { submission_id: sent.submission_id, sent_message_id: sent.sent_message_id,
      sent_copy_status: sent.sent_copy_status, transport: sent.transport };
    this.markReviewAutoSent(review, sent, directAuto ? "agent_direct" : "graduated_auto");

    if (!optedIn) {
      // The LEGACY 202 body, byte-shape-identical to what the server still returns
      // for a caller that never mentioned the review loop - plus the additive
      // `review_id`, which is the only handle a crashed agent has on this path.
      // Note the asymmetry, and that it is the server's, not ours: `send` answers
      // {status, message_id, review_id} with NO thread_id; reply/forward answer
      // {message_id, thread_id, review_id} with no status.
      return kind === "send"
        ? { message_id: sent.message_id, status: "sent", review_id: review.id, ...tracking }
        : { message_id: sent.message_id, thread_id: sent.thread_id, review_id: review.id, ...tracking };
    }
    const message: { id: string; thread_id?: string } = { id: sent.message_id };
    if (sent.thread_id) message.thread_id = sent.thread_id;
    return { kind: "sent", message, review: { id: review.id, state: review.state }, ...tracking };
  }

  /**
   * Move a review to `state` and keep `closed` in lockstep.
   *
   * `closed` is DERIVED, never independently assigned, because the two drifting
   * apart is worse than either being wrong: an agent that polls `closed` on a row
   * whose state says otherwise has no way to tell which one to believe.
   */
  private setReviewState(review: Review, state: ReviewState): void {
    review.state = state;
    review.closed = CLOSED_REVIEW_STATES.has(state);
  }

  /** Mark a review delivered on an auto-send path and emit its terminal `sent` nudge. */
  private markReviewAutoSent(review: Review, sent: SendResult, sendPath: string): void {
    this.setReviewState(review, "auto_sent");
    review.version += 1;
    review.sent_message_id = sent.message_id_header ?? sent.message_id;
    review.send_path = sendPath;
    review.sent_at = now();
    review.updated_at = review.sent_at;
    this.state.reviews.set(review.id, review);
    this.enqueueTerminalNudge(review);
  }

  /** Raw delivery for a send - no policy, only reachable from submitOutbound. */
  private deliverSend(address: string, req: SendRequest): SendResult {
    return this.deliverRaw(address, {
      to: toArray(req.to),
      cc: toArray(req.cc),
      subject: req.subject,
      text: req.text ?? "",
      html: req.html,
      threadId: rid("thr"),
      attachments: req.attachments,
    });
  }

  /** Raw delivery for a reply - no policy, only reachable from submitOutbound. */
  private deliverReply(address: string, req: ReplyRequest, env: ReplyEnvelope): SendResult {
    return this.deliverRaw(address, {
      to: env.to,
      cc: toArray(req.cc),
      subject: env.subject,
      text: req.text ?? "",
      html: req.html,
      threadId: env.threadId,
      attachments: req.attachments,
    });
  }

  /** Append the outbound message and shape the legacy send result. */
  private deliverRaw(
    address: string,
    opts: {
      to: string[];
      cc?: string[];
      subject: string;
      text: string;
      html?: string;
      threadId: string;
      attachments?: AttachmentInput[];
    },
  ): SendResult {
    const msg = this.appendMessage(address, {
      direction: "outbound",
      from: address,
      to: opts.to,
      cc: opts.cc,
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
      threadId: opts.threadId,
      attachments: opts.attachments,
    });
    return {
      message_id: msg.id,
      thread_id: msg.thread_id,
      submission_id: (msg.submission_id = `sub_${msg.id}`),
      sent_message_id: (msg.sent_message_id = msg.id),
      sent_copy_status: (msg.sent_copy_status = "stored"),
      transport: (msg.transport = { accepted: opts.to.length + (opts.cc?.length ?? 0) }),
      message_id_header: msg.message_id,
      status: "sent",
      created_at: now(),
    };
  }

  /**
   * Derive a reply's recipients / `Re:` subject / thread from the parent, the way
   * the server does before it writes the review row.
   */
  private deriveReplyEnvelope(address: string, req: ReplyRequest): ReplyEnvelope {
    if (Boolean(req.thread_id) === Boolean(req.message_id)) {
      throw new ValidationError({
        status: 400,
        code: "bad_request",
        message: "provide exactly one of thread_id or message_id",
      });
    }
    const all = this.state.messages.get(address) ?? [];
    let parent: Message | undefined;
    let threadId = req.thread_id;
    if (req.message_id) {
      parent = all.find((m) => m.id === req.message_id);
      if (!parent) throw notFoundMock("message", req.message_id);
      threadId = parent.thread_id;
    } else if (req.thread_id) {
      const inThread = all.filter((m) => m.thread_id === req.thread_id);
      parent = inThread[inThread.length - 1];
    } else {
      throw new ValidationError({
        status: 400,
        code: "bad_request",
        message: "thread_id or message_id is required",
      });
    }
    if (req.thread_id && req.expected_last_message_id && parent?.id !== req.expected_last_message_id) {
      throw new ConflictError({
        status: 409,
        code: "conflict",
        message: `thread advanced; latest message is ${parent?.id ?? "unknown"}`,
      });
    }
    const to: string[] = [];
    if (parent) {
      if (parent.from.email.toLowerCase() === address.toLowerCase()) {
        to.push(...parent.to.map(({ email }) => email).filter((email) => email.toLowerCase() !== address.toLowerCase()));
      } else {
        to.push(...(parent.reply_to?.length ? parent.reply_to : [parent.from]).map(({ email }) => email));
      }
      if (req.reply_all) for (const a of parent.to) if (a.email !== address) to.push(a.email);
    }
    return {
      to: to.length ? to : ["reply@example.com"],
      subject: parent ? reSubject(parent.subject) : "Re:",
      threadId: threadId ?? rid("thr"),
    };
  }

  /** List review requests (mock), newest-first, with optional filters. */
  listReviews(params: ListReviewsParams = {}): Page<Review> {
    let items = [...this.state.reviews.values()].sort((a, b) =>
      b.created_at.localeCompare(a.created_at),
    );
    if (params.state !== undefined) {
      const states = Array.isArray(params.state) ? params.state : [params.state];
      items = items.filter((r) => states.includes(r.state));
    }
    if (params.category_id) items = items.filter((r) => r.category_id === params.category_id);
    if (params.inbox) {
      const inbox = params.inbox.toLowerCase();
      items = items.filter((r) => r.from_address.toLowerCase() === inbox);
    }
    return { items, total: items.length };
  }

  /** Get one review request (mock), or undefined when not found. */
  getReview(reviewId: string): Review | undefined {
    return this.state.reviews.get(reviewId);
  }

  /** Get a review's append-only thread turns (mock), or undefined when not found. */
  getReviewTurns(reviewId: string): Page<ReviewTurn> | undefined {
    if (!this.state.reviews.has(reviewId)) return undefined;
    const items = this.state.reviewTurns.get(reviewId) ?? [];
    return { items, total: items.length };
  }

  /**
   * Get the human's assembled feedback (mock; M5): the diff + the human comments /
   * rejection turns + the decision (derived from state). new_rules is empty in the
   * mock (rule provenance lives server-side). Undefined when not found.
   */
  getReviewFeedback(reviewId: string): ReviewFeedback | undefined {
    const review = this.state.reviews.get(reviewId);
    if (!review) return undefined;
    const turns = this.state.reviewTurns.get(reviewId) ?? [];
    const comments = turns
      .filter(
        (t) =>
          (t.turn_type === "human_comment" ||
            t.turn_type === "human_reject" ||
            t.turn_type === "human_question") &&
          (t.body ?? "").trim() !== "",
      )
      .map((t) => ({
        turn_id: t.id,
        actor_kind: t.actor_kind,
        body: t.body ?? "",
        actor_id: t.actor_id,
        created_at: t.created_at,
      }));
    let diffJson: Record<string, unknown> | undefined;
    for (const t of turns) {
      if ((t.turn_type === "human_edit" || t.turn_type === "system_diff") && t.diff_json) {
        diffJson = t.diff_json;
      }
    }
    const edited = !!review.sent_body_text || !!review.sent_subject || !!review.diff_unified;
    let decision: string;
    if (review.state === "sent" || review.state === "auto_sent" || review.state === "approved") {
      decision = edited ? "edited" : "approved";
    } else if (review.state === "rejected") {
      decision = "rejected";
    } else {
      decision = review.state;
    }
    return {
      review_id: reviewId,
      decision,
      diff_unified: review.diff_unified,
      diff_json: diffJson,
      comments,
      new_rules: [],
    };
  }

  /**
   * Post a chat turn on a review's thread (mock; M5). Idempotent on the optional key
   * (parity v21): a replay with the same key returns the same review without doubling
   * the turn. Flips in_review -> chatting on the first turn. Undefined when not found.
   */
  postReviewChat(
    reviewId: string,
    req: PostReviewChatRequest,
    idempotencyKey?: string,
  ): Review | undefined {
    const review = this.state.reviews.get(reviewId);
    if (!review) return undefined;
    const key = idempotencyKey?.trim();
    if (key) {
      const replayed = this.state.chatByIdempotencyKey.get(key);
      if (replayed) return replayed;
    }
    if (TERMINAL_REVIEW_STATES.has(review.state)) {
      this.enqueueFrontRunNudge(review, review.revision);
      throw reviewConflict(
        "terminal",
        review,
        `this review is ${review.state}; nothing will ever succeed on it. A front_run_next event is waiting on your queue.`,
      );
    }
    // needs_review IS a legal source for an AGENT question (D-5). The old guard's
    // rationale was right - an agent must not conjure a reviewer for a queued draft
    // - but its effect was wrong: after a reviewer-reject lands a draft back in
    // needs_review WITH feedback, the skill tells the agent to ask when the feedback
    // is ambiguous, and it could not. So the question is appended and the state is
    // deliberately NOT changed: `in_review` is a soft lock meaning a real human has
    // it open, and an agent may not fabricate that.
    if (
      review.state !== "in_review" &&
      review.state !== "chatting" &&
      review.state !== "needs_review"
    ) {
      throw reviewConflict(
        "wrong_state",
        review,
        `post_review_chat is not legal while the draft is in '${review.state}'.`,
      );
    }
    const turns = this.state.reviewTurns.get(reviewId) ?? [];
    turns.push({
      id: rid("turn"),
      seq: turns.length + 1,
      turn_type: "agent_question",
      actor_kind: "agent",
      body: req.text,
      created_at: now(),
    });
    this.state.reviewTurns.set(reviewId, turns);
    if (review.state === "in_review") {
      this.setReviewState(review, "chatting");
      review.version += 1;
      review.updated_at = now();
      this.state.reviews.set(reviewId, review);
    }
    // No nudge for the agent's OWN question - feedback_added is a HUMAN signal, and
    // waking a composer with its own message is how a drain loop starts spinning.
    if (key) this.state.chatByIdempotencyKey.set(key, review);
    return review;
  }

  /**
   * Post a new agent draft under a parent_revision CAS (mock; M5; D17). A mismatch is
   * a 409 STALE with NO mutation; a clean CAS re-renders the draft in place
   * (revision++), returns to needs_review. Undefined when not found.
   */
  submitRevision(reviewId: string, req: SubmitRevisionRequest): Review | undefined {
    const review = this.state.reviews.get(reviewId);
    if (!review) return undefined;
    // The three-way 409 split, in the order an agent needs it.
    //
    // TERMINAL first: the review is over, nothing will ever succeed, and a
    // front_run_next nudge is left behind so an agent that only drains the queue
    // still learns it lost the race.
    if (TERMINAL_REVIEW_STATES.has(review.state)) {
      this.enqueueFrontRunNudge(review, req.parent_revision);
      throw reviewConflict(
        "terminal",
        review,
        `this review is ${review.state}; a redraft will never succeed. A front_run_next event is waiting on your queue.`,
      );
    }
    // WRONG_STATE: the draft is still live but this VERB is illegal from here.
    // Never retry the same verb - read the allowed_action hints and pick another.
    // needs_review IS legal (D-1): a redraft bumps the revision, which IS a change,
    // so the self-edge that used to be banned is exactly the loop a reviewer-reject
    // hands back to the composer.
    if (
      review.state !== "needs_review" &&
      review.state !== "in_review" &&
      review.state !== "chatting" &&
      review.state !== "rejected" &&
      review.state !== "stale"
    ) {
      throw reviewConflict(
        "wrong_state",
        review,
        `submit_revision is not legal while the draft is in '${review.state}'. Wait for a sent or send_failed review event.`,
      );
    }
    // STALE: the CAS failed. NOTHING is mutated, and the error carries the current
    // revision/version so the bounded retry needs no extra get_review.
    if (review.revision !== req.parent_revision) {
      throw reviewConflict(
        "stale",
        review,
        "parent_revision is stale; re-read the review, re-apply your edit on top, and resubmit with the current revision",
      );
    }
    if (req.version !== undefined && review.version !== req.version) {
      throw reviewConflict(
        "stale",
        review,
        "version is stale; re-read the review, re-apply your edit on top, and resubmit",
      );
    }
    review.revision += 1;
    review.version += 1;
    this.setReviewState(review, "needs_review");
    if (req.subject !== undefined) review.proposed_subject = req.subject;
    // `text` is canonical, `body` a permanent alias - resolved here EXACTLY as the
    // server does, including the conflicting_alias rejection. The mock must not be
    // more permissive than the wire: a fixture that quietly accepts what the server
    // refuses is how a 67-day-old send bug stayed invisible behind green demos.
    if (
      req.text !== undefined &&
      req.body !== undefined &&
      req.text !== req.body
    ) {
      throw new ValidationError({
        status: 400,
        code: "conflicting_alias",
        message: "`body` is a deprecated alias for `text`; send one or the other",
      });
    }
    const revisedText = req.text ?? req.body;
    if (revisedText !== undefined) review.proposed_body_text = revisedText;
    if (req.html !== undefined) review.proposed_body_html = req.html;
    // Attachments REPLACE when present, are untouched when the field is omitted,
    // and are cleared by an explicit empty array. Without this a redraft after
    // reviewer feedback would ship a message the human reviewed WITH a file and the
    // recipient received without one.
    if (req.attachments !== undefined) {
      this.state.reviewAttachments.set(reviewId, req.attachments);
    }
    review.updated_at = now();
    this.state.reviews.set(reviewId, review);
    const turns = this.state.reviewTurns.get(reviewId) ?? [];
    turns.push({
      id: rid("turn"),
      seq: turns.length + 1,
      turn_type: "agent_draft",
      actor_kind: "agent",
      body: revisedText ?? review.proposed_body_text,
      revision: review.revision,
      created_at: now(),
    });
    this.state.reviewTurns.set(reviewId, turns);
    // Deliberately NO nudge: the composer must not be woken by its own redraft.
    // (redraft_requested is what a REVIEWER's reject/escalate/sweep enqueues; see
    // simulateReviewRejected.)
    return review;
  }

  /** Withdraw a pending review (mock; M5) to the terminal cancelled state. */
  cancelReview(reviewId: string): Review | undefined {
    const review = this.state.reviews.get(reviewId);
    if (!review) return undefined;
    if (TERMINAL_REVIEW_STATES.has(review.state)) {
      this.enqueueFrontRunNudge(review, review.revision);
      throw reviewConflict("terminal", review, `this review is already ${review.state}.`);
    }
    this.setReviewState(review, "cancelled");
    review.version += 1;
    review.updated_at = now();
    this.state.reviews.set(reviewId, review);
    this.enqueueTerminalNudge(review);
    return review;
  }

  /**
   * Re-stamp a draft's rules-version WITHOUT redrafting (mock; D19/§8 $0 escape valve).
   * Advances the version the draft is current against; no revision bump, no body change.
   * A terminal/sent draft 409s; against_version above the category's current
   * rules-version is 400. The mock has no per-category rules_version on the Review, so it
   * just bumps the row version and returns it (the body is untouched).
   */
  restampReview(reviewId: string, req: RestampReviewRequest): Review | undefined {
    const review = this.state.reviews.get(reviewId);
    if (!review) return undefined;
    if (TERMINAL_REVIEW_STATES.has(review.state)) {
      this.enqueueFrontRunNudge(review, review.revision);
      throw reviewConflict("terminal", review, `this review is already ${review.state}.`);
    }
    // restamp_review is ONLY the "I re-read the rules and nothing needed to change"
    // escape valve. It applies to a draft still sitting in the human queue; an
    // approved or failed draft has already left it.
    if (
      review.state !== "needs_review" &&
      review.state !== "in_review" &&
      review.state !== "chatting" &&
      review.state !== "stale"
    ) {
      throw reviewConflict(
        "wrong_state",
        review,
        `restamp_review is not legal while the draft is in '${review.state}'.`,
      );
    }
    if (req.against_version < 0) {
      throw new ValidationError({
        status: 400,
        code: "invalid",
        message: "against_version must be >= 0",
      });
    }
    review.version += 1;
    review.updated_at = now();
    this.state.reviews.set(reviewId, review);
    return review;
  }

  // ---- BYO review-agent decision plane (M8 Slice B; D5/§9) ---------------
  //
  // The mock single-agent store acts as BOTH composer and reviewer, surfacing the
  // reviewer decision surface + the two circuit breakers without modeling the link
  // table. hop_count is tracked in a side map; the breakers use the schema defaults
  // (max_hops=3, review_deadline_s=86400). A draft is "reviewer-held" iff in_review/
  // chatting (the queue states a reviewer can decide).

  /**
   * Test helper: create a draft already ASSIGNED to a reviewer (in_review), mirroring
   * how the real server routes a parked draft to a linked review-agent. Returns the
   * review id so a test can drive the reviewer decision plane offline. `createdAtMs`
   * (optional) backdates created_at so a test can trip the hard review_deadline breaker.
   */
  seedReviewerHeldReview(opts: { fromAddress: string; createdAtMs?: number } = { fromAddress: "reviewer@extrovertmail.com" }): string {
    const review = this.createReviewRecord(opts.fromAddress, {
      kind: "send",
      subject: "Pilot proposal",
      text: "Here is the Q3 pilot proposal.",
      to: ["vp@acme.com"],
      intent: { summary: "send pilot proposal", meta: { goal: "book_meeting" } },
    });
    this.setReviewState(review, "in_review");
    if (opts.createdAtMs !== undefined) {
      review.created_at = new Date(opts.createdAtMs).toISOString();
    }
    this.state.reviews.set(review.id, review);
    return review.id;
  }

  /** Get the reviewer's decision context for a review (mock; §9). */
  getReviewDecisionContext(reviewId: string): ReviewDecisionContext | undefined {
    const review = this.state.reviews.get(reviewId);
    if (!review) return undefined;
    const turns = this.state.reviewTurns.get(reviewId) ?? [];
    const hopCount = this.state.reviewHopCounts.get(reviewId) ?? 0;
    const maxHops = 3;
    const deadlineMs = new Date(review.created_at).getTime() + 86400 * 1000;
    const deadline = new Date(deadlineMs).toISOString();
    const deadlinePassed = Date.now() >= deadlineMs;
    const hopsExhausted = hopCount >= maxHops;
    const forceToHuman = hopsExhausted || deadlinePassed;
    return {
      review,
      turns,
      hop_count: hopCount,
      max_hops: maxHops,
      review_deadline: deadline,
      deadline_passed: deadlinePassed,
      hops_exhausted: hopsExhausted,
      force_to_human: forceToHuman,
      force_reason: hopsExhausted
        ? "max_hops_reached"
        : deadlinePassed
          ? "review_deadline_passed"
          : undefined,
    };
  }

  /**
   * Submit a reviewer decision (mock; §9). approve/edit → the platform "sends" with the
   * composer's creds (kind=sent, send_path=reviewer_approved); reject → back to the
   * composer (needs_review, hop_count++) UNLESS a breaker forces the human; escalate →
   * the human queue. revision/version are the CAS (409 STALE on mismatch, NO mutation).
   */
  reviewerDecide(reviewId: string, req: ReviewerDecisionRequest): ReviewerDecisionResult | undefined {
    const review = this.state.reviews.get(reviewId);
    if (!review) return undefined;
    if (TERMINAL_REVIEW_STATES.has(review.state)) {
      throw reviewConflict("terminal", review, `this review is already ${review.state}.`);
    }
    if (review.state !== "in_review" && review.state !== "chatting") {
      throw reviewConflict(
        "wrong_state",
        review,
        `a reviewer can only decide a review it holds (got '${review.state}').`,
      );
    }
    if (review.revision !== req.revision) {
      throw reviewConflict(
        "stale",
        review,
        "revision is stale; re-read the decision context and retry",
      );
    }
    if (req.version !== undefined && review.version !== req.version) {
      throw reviewConflict(
        "stale",
        review,
        "version is stale; re-read the decision context and retry",
      );
    }

    const hopCount = this.state.reviewHopCounts.get(reviewId) ?? 0;
    const deadlineMs = new Date(review.created_at).getTime() + 86400 * 1000;
    const breakerTripped = hopCount >= 3 || Date.now() >= deadlineMs;

    if (req.action === "approve" || req.action === "edit") {
      if (req.action === "edit") {
        if (req.subject !== undefined) review.sent_subject = req.subject;
        if (req.body !== undefined) review.sent_body_text = req.body;
      }
      this.setReviewState(review, "sent");
      review.version += 1;
      review.sent_message_id = `<${rid("mid")}@acme.test>`;
      // A BYO reviewer approve is still a delivery the COMPOSER has to learn about  -
      // send_path is what tells the two release paths apart on the terminal nudge.
      review.send_path = "reviewer_approved";
        review.sent_at = now();
      review.updated_at = review.sent_at;
      this.state.reviews.set(reviewId, review);
      this.enqueueTerminalNudge(review);
      return { kind: "sent", review, sent: true, message_id: review.sent_message_id, sent_to_human: false };
    }

    // reject / escalate → the human queue (needs_review). A reject within budget bumps
    // hop_count and goes back to the composer; a tripped breaker FORCES the human.
    this.setReviewState(review, "needs_review");
    review.version += 1;
    if (req.feedback !== undefined) review.decision_feedback = req.feedback;
    review.updated_at = now();
    this.state.reviews.set(reviewId, review);

    let forcedByBreaker: string | undefined;
    if (req.action === "reject" && !breakerTripped) {
      this.state.reviewHopCounts.set(reviewId, hopCount + 1);
    } else if (req.action === "reject" && breakerTripped) {
      forcedByBreaker = hopCount >= 3 ? "max_hops_reached" : "review_deadline_passed";
    }
    return { kind: "sent_to_human", review, sent: false, sent_to_human: true, forced_by_breaker: forcedByBreaker };
  }

  // ---- Category registry (Review Loop, D9/D10) --------------------------

  /**
   * Browse the registry (mock), newest-first, excluding merged/soft-deleted. `match`
   * is a pure lexical filter (every token must appear in name+description) - NO LLM,
   * mirroring the server.
   */
  private categoryUsage(category: Category): Category {
    const now = Date.now();
    const rows = [...this.state.reviews.values()].filter(r => r.category_id === category.id && Date.parse(r.created_at) <= now);
    const count = (days: number) => rows.filter(r => Date.parse(r.created_at) >= now - days * 86_400_000).length;
    return { ...category, message_count_7d: count(7), message_count_30d: count(30), message_count_90d: count(90),
      last_used_at: rows.map(r => r.created_at).sort().slice(-1)[0],
      pending_review_count: rows.filter(r => ["needs_review","in_review","chatting","rejected","stale","approved"].includes(r.state)).length };
  }

  listCategories(params: ListCategoriesParams = {}): Page<Category> {
    let items = [...this.state.categories.values()]
      .filter((c) => !c.merged_into)
      .map(c => this.categoryUsage(c))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    const tokens = (params.match ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length) {
      items = items.filter((c) => {
        const hay = `${c.name} ${c.description}`.toLowerCase();
        return tokens.every((t) => hay.includes(t));
      });
    }
    const field = ({ messages_7d: "message_count_7d", messages_90d: "message_count_90d", pending_reviews: "pending_review_count" } as const)[params.sort as "messages_7d"] ?? "message_count_30d";
    items.sort((a, b) => (params.sort === "name" ? a.name.toLowerCase().localeCompare(b.name.toLowerCase()) : params.sort === "last_used" ? 0 : (b[field] ?? 0) - (a[field] ?? 0)) || (b.last_used_at ?? "").localeCompare(a.last_used_at ?? "") || a.id.localeCompare(b.id));
    const offset = params.page ? JSON.parse(Buffer.from(params.page, "base64url").toString()).o : 0;
    const total = items.length, limit = params.limit ?? 100;
    const next = offset + limit < total ? Buffer.from(JSON.stringify({ o: offset + limit, v: 1 })).toString("base64url") : undefined;
    return { items: items.slice(offset, offset + limit), total, next_cursor: next };
  }

  /** Get one category (mock), or undefined when not found. */
  getCategory(categoryId: string): Category | undefined {
    const category = this.state.categories.get(categoryId);
    return category ? this.categoryUsage(category) : undefined;
  }

  /** Propose a category (mock): stands immediately, author_kind=agent (D9). */
  proposeCategory(req: ProposeCategoryRequest): Category {
    const name = req.name.trim();
    if ([...this.state.categories.values()].some(c => !c.merged_into && c.name.toLowerCase() === name.toLowerCase())) throw new ConflictError({ status: 409, code: "conflict", message: "Category name already exists; browse and reuse it." });
    if (!name) {
      throw new ValidationError({ status: 400, code: "invalid", message: "name is required" });
    }
    const ts = now();
    const cat: Category = {
      id: rid("cat"),
      name,
      description: (req.description ?? "").trim(),
      scope: req.scope ?? "org_shared",
      state: "supervised",
      created_by_agent_id: "agt_mock",
      author_kind: "agent",
      rule_high_water: 0,
      rules_version: 0,
      created_at: ts,
      updated_at: ts,
    };
    this.state.categories.set(cat.id, cat);
    return cat;
  }

  /** Rename / re-describe a category (mock) - metadata only (D10). */
  updateCategory(categoryId: string, req: UpdateCategoryRequest): Category | undefined {
    const cat = this.state.categories.get(categoryId);
    if (!cat) return undefined;
    if (req.name !== undefined) cat.name = req.name.trim();
    if (req.description !== undefined) cat.description = req.description.trim();
    cat.updated_at = now();
    this.state.categories.set(cat.id, cat);
    return cat;
  }

  // ---- Graduation + risk dial (Review Loop, D16/D6/D17) - agent READ + PROPOSE --

  /** The mock account-default risk dial (mirrors the server defaults). */
  private accountDial(): RiskDial["account"] {
    return {
      min_confidence: 0.7,
      first_contact_gate: true,
      drift_demote_after: 3,
      canary_rate: 0.05,
      graduate_min_approvals: 20,
      graduate_min_age_hours: 24,
      auto_send_cap_per_day: 50,
    };
  }

  /**
   * Read the effective risk dial (mock): the account default + every category with an
   * inherited (null override) effective dial. The mock category carries no overrides,
   * so every category inherits - effective == account.
   */
  getRiskDial(): RiskDial {
    const account = this.accountDial();
    const categories = [...this.state.categories.values()]
      .filter((c) => !c.merged_into)
      .map((c) => ({
        category_id: c.id,
        min_confidence: null,
        first_contact_gate: null,
        drift_demote_after: null,
        canary_rate: null,
        graduate_min_approvals: null,
        graduate_min_age_hours: null,
        effective: { ...account },
      }));
    return { account, categories };
  }

  private nextGraduationState(state: Category["state"]): string {
    if (state === "supervised") return "auto_notify";
    if (state === "auto_notify") return "auto_silent";
    return "";
  }

  /**
   * Read a category's graduation gate status (mock). The mock category has no
   * counters, so it reports zero clean approvals / zero drift against the account
   * defaults; can_graduate is true for supervised→auto_notify (no maturity gate).
   */
  getGraduationStatus(categoryId: string): GraduationStatus | undefined {
    const cat = this.state.categories.get(categoryId);
    if (!cat) return undefined;
    const dial = this.accountDial();
    const next = this.nextGraduationState(cat.state);
    const approvalsMet = 0 >= dial.graduate_min_approvals;
    const ageMet = false;
    const maturityMet = approvalsMet && ageMet;
    const canGraduate =
      next === "auto_notify" ? true : next === "auto_silent" ? maturityMet : false;
    return {
      category_id: cat.id,
      state: cat.state,
      next_state: next,
      never_graduate: false,
      clean_approval_count: 0,
      graduate_min_approvals: dial.graduate_min_approvals,
      approvals_met: approvalsMet,
      age_hours: 0,
      graduate_min_age_hours: dial.graduate_min_age_hours,
      age_met: ageMet,
      maturity_gate_met: maturityMet,
      drift_count: 0,
      drift_demote_after: dial.drift_demote_after,
      can_graduate: canGraduate,
    };
  }

  /**
   * Propose graduating a category (mock): returns the current gate status without
   * changing the category state (D16 - an agent can never flip the bit).
   */
  proposeGraduation(categoryId: string, _req: ProposeGraduationRequest): GraduationStatus | undefined {
    return this.getGraduationStatus(categoryId);
  }

  /**
   * Read the D19/§8 backlog-reconciliation status (mock): counts the QUEUED drafts in a
   * category that are stale vs current-enough against the current rules-version. The
   * mock has no per-draft composed_* stamps on its Review fixtures, so every queued
   * draft reads as current-enough (composed 0 vs current 0) - the contract shape is
   * exercised; the integer-compare logic is covered by the Go tests.
   */
  getScanBacklogStatus(categoryId: string): ScanBacklogStatus | undefined {
    const cat = this.state.categories.get(categoryId);
    if (!cat) return undefined;
    let queued = 0;
    for (const review of this.state.reviews.values()) {
      if (
        review.category_id === categoryId &&
        (review.state === "needs_review" ||
          review.state === "in_review" ||
          review.state === "chatting")
      ) {
        queued += 1;
      }
    }
    return {
      category_id: cat.id,
      state: cat.state,
      queued,
      current_enough: queued,
      stale: 0,
      current_category_rules_version: cat.rules_version,
      current_house_style_version: 0,
      staleness_tolerance: 0,
    };
  }

  /**
   * Read the demand-driven pacing state (mock - M7 Slice B/§8): the cursor + effective
   * window/ceiling/interval + each queued draft's classification. The mock has no cursor
   * (nothing reviewed) and no composed_* stamps, so every queued draft reads in-window-
   * fresh until the window fills, then ahead; the contract shape is exercised (the
   * cursor/staleness mechanics are covered by the Go tests).
   */
  getCategoryPacingState(categoryId: string): CategoryPacingState | undefined {
    const cat = this.state.categories.get(categoryId);
    if (!cat) return undefined;
    const lookaheadWindow = 3;
    const queuedIds: string[] = [];
    for (const review of this.state.reviews.values()) {
      if (
        review.category_id === categoryId &&
        (review.state === "needs_review" ||
          review.state === "in_review" ||
          review.state === "chatting")
      ) {
        queuedIds.push(review.id);
      }
    }
    const items: PacingItem[] = queuedIds.map((id, i) => ({
      review_id: id,
      state: i < lookaheadWindow ? "in_window_fresh" : "ahead",
    }));
    return {
      category_id: cat.id,
      cursor_advanced_count: 0,
      lookahead_window: lookaheadWindow,
      rework_batch_max: 10,
      nudge_min_interval_ms: 5000,
      queued: queuedIds.length,
      in_window: Math.min(queuedIds.length, lookaheadWindow),
      redrafting: 0,
      items,
    };
  }

  // ---- Writing rules + house-style + precedence ladder + audit/undo ------

  /** rank a rule for the §7 ladder (mock mirror of the server's deterministic order). */
  private ruleRank(r: Rule): number[] {
    const hard = r.kind === "hard" ? 1 : 0;
    const spec = r.scope_agent_id ? 2 : r.scope === "category" ? 1 : 0;
    const human = r.author_kind === "human" ? 1 : 0;
    return [hard, spec, human, r.rev, r.priority];
  }

  /** Get the ORDERED active rule set (mock) - §7 ladder + category-before-general. */
  getRules(params: GetRulesParams = {}): RuleSnapshot {
    const active = [...this.state.rules.values()].filter((r) => r.status === "active");
    const byRank = (a: Rule, b: Rule): number => {
      const ra = this.ruleRank(a);
      const rb = this.ruleRank(b);
      for (let i = 0; i < ra.length; i += 1) {
        const da = ra[i] ?? 0;
        const db = rb[i] ?? 0;
        if (da !== db) return db - da;
      }
      return a.id < b.id ? -1 : 1;
    };
    let general: Rule[] = [];
    let category: Rule[] = [];
    if (!params.scope || params.scope === "general") {
      general = active.filter((r) => r.scope === "general").sort(byRank);
    }
    if (params.category_id && (!params.scope || params.scope === "category")) {
      category = active.filter((r) => r.scope === "category" && r.category_id === params.category_id).sort(byRank);
    }
    const items = [...category, ...general];
    return {
      items,
      total: items.length,
      house_style_version: 1,
      category_rules_version: params.category_id ? 1 : 0,
      rule_high_water: params.category_id ? 1 : 0,
      composition_token: params.scope ? undefined : `cmp_fixture_${params.category_id ?? "general"}`,
      composition_token_expires_at: params.scope ? undefined : new Date(Date.now() + 600_000).toISOString(),
    };
  }

  /** Save / edit a rule (mock) - append-only by supersession (D11). */
  private learnedRules = new Map<string, {fingerprint: string; result: LearnedReviewRule}>();
  learnReviewRule(reviewId: string, req: LearnReviewRuleRequest): LearnedReviewRule {
    const fingerprint = JSON.stringify({reviewId, req});
    const prior = this.learnedRules.get(req.client_id);
    if (prior) { if (prior.fingerprint !== fingerprint) throw new ValidationError({status:409,code:"conflict",message:"learning retry identity changed"}); return structuredClone(prior.result); }
    const turn = (this.state.reviewTurns.get(reviewId) ?? []).find(t => t.id === req.source_turn_id);
    if (!turn || turn.actor_kind !== "human" || !turn.actor_id) throw new ValidationError({status:403,code:"forbidden_scope",message:"learning requires authenticated human feedback"});
    const rule = this.saveRule({...req, scope:req.target === "category" ? "category" : "general", source_review_id:reviewId,source_turn_id:turn.id});
    rule.source_turn_id = turn.id;
    rule.rule_layer = req.target === "org_house" ? "org" : "project";
    if (req.target === "org_house") delete rule.project_id;
    rule.source_review_id = reviewId;
    rule.source_turn_id = turn.id;
    const audit = [...this.state.ruleAudit.values()].find(entry => entry.entity_id === rule.id)!;
    audit.after_json = ruleSnapshotJSON(rule);
    const result: LearnedReviewRule = {rule, source_review_id:reviewId, source_turn_id:turn.id, human_id:turn.actor_id, audit_id:audit.id, propagation:"queued"};
    this.learnedRules.set(req.client_id,{fingerprint,result:structuredClone(result)});
    return result;
  }

  saveRule(req: SaveRuleRequest): Rule {
    const text = req.rule_text.trim();
    if (!text) {
      throw new ValidationError({ status: 400, code: "invalid", message: "rule_text is required" });
    }
    const categoryId = (req.category_id ?? "").trim();
    const scope = req.scope ?? (categoryId ? "category" : "general");
    if (scope === "general" && categoryId) {
      throw new ValidationError({ status: 400, code: "invalid", message: "scope=general forbids a category_id" });
    }
    if (scope === "category" && !categoryId) {
      throw new ValidationError({ status: 400, code: "invalid", message: "scope=category requires a category_id" });
    }
    const ts = now();
    if (req.supersedes_id) {
      const prior = this.state.rules.get(req.supersedes_id);
      if (!prior) throw new NotFoundError({ status: 404, code: "not_found", message: "rule not found" });
      prior.status = "superseded";
      this.state.rules.set(prior.id, prior);
      const next: Rule = {
        ...prior,
        id: rid("rule"),
        rev: prior.rev + 1,
        rule_text: text,
        kind: req.kind ?? prior.kind,
        priority: req.priority ?? prior.priority,
        status: "active",
        supersedes_id: prior.id,
        author_kind: "agent",
        created_at: ts,
        updated_at: ts,
      };
      this.state.rules.set(next.id, next);
      this.recordRuleAudit("supersede", next.id, ruleSnapshotJSON(prior), ruleSnapshotJSON(next));
      return next;
    }
    const rule: Rule = {
      id: rid("rule"),
      lineage_id: rid("rln"),
      rev: 1,
      // Agent-plane saves are ALWAYS project-layer, bound to the key's project (an
      // agent cannot author org-layer / house-style rules in v1).
      rule_layer: "project",
      org_id: MOCK_ORG_ID,
      project_id: MOCK_PROJECT_ID,
      scope,
      category_id: scope === "category" ? categoryId : undefined,
      scope_agent_id: req.scope_agent_id || undefined,
      rule_text: text,
      kind: req.kind ?? "soft",
      priority: req.priority ?? 0,
      status: "active",
      author_kind: "agent",
      created_at: ts,
      updated_at: ts,
    };
    this.state.rules.set(rule.id, rule);
    this.recordRuleAudit("create", rule.id, "{}", ruleSnapshotJSON(rule));
    return rule;
  }

  /** Promote a rule between layers (mock, via supersession), or undefined when unknown. */
  promoteRule(ruleId: string, toScope: "general" | "category"): Rule | undefined {
    const prior = this.state.rules.get(ruleId);
    if (!prior) return undefined;
    if (prior.scope === toScope) return prior;
    if (toScope === "category" && !prior.category_id) {
      throw new ValidationError({ status: 400, code: "invalid", message: "promote to category needs a category" });
    }
    prior.status = "superseded";
    this.state.rules.set(prior.id, prior);
    const ts = now();
    const next: Rule = {
      ...prior,
      id: rid("rule"),
      lineage_id: rid("rln"),
      rev: 1,
      scope: toScope,
      category_id: toScope === "category" ? prior.category_id : undefined,
      status: "active",
      supersedes_id: prior.id,
      author_kind: "agent",
      created_at: ts,
      updated_at: ts,
    };
    this.state.rules.set(next.id, next);
    this.recordRuleAudit("supersede", next.id, ruleSnapshotJSON(prior), ruleSnapshotJSON(next));
    return next;
  }

  /** Retire a rule (mock) - soft delete, or undefined when unknown. */
  retireRule(ruleId: string): Rule | undefined {
    const rule = this.state.rules.get(ruleId);
    if (!rule) return undefined;
    if (rule.status === "retired") return rule;
    rule.status = "retired";
    rule.updated_at = now();
    this.state.rules.set(rule.id, rule);
    this.recordRuleAudit("retire", rule.id, ruleSnapshotJSON(rule), ruleSnapshotJSON(rule));
    return rule;
  }

  /** Read the rule/category change audit log (mock). */
  getRuleAudit(params: GetRuleAuditParams = {}): Page<RuleAuditEntry> {
    let items = [...this.state.ruleAudit.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (params.entity_kind) items = items.filter((e) => e.entity_kind === params.entity_kind);
    if (params.entity_id) items = items.filter((e) => e.entity_id === params.entity_id);
    return { items, total: items.length };
  }

  /** Undo a rule change (mock) - restore the prior version; idempotent (re-undo 409). */
  undoRuleChange(udoId: string): Rule {
    const entry = this.state.ruleAudit.get(udoId);
    if (!entry) throw new NotFoundError({ status: 404, code: "not_found", message: "audit row not found" });
    if (entry.entity_kind !== "rule") {
      throw new ValidationError({ status: 400, code: "invalid", message: "only rule entities are restorable here" });
    }
    if (entry.undone) throw new ConflictError({ status: 409, code: "conflict", message: "already undone" });
    const head = this.state.rules.get(entry.entity_id);
    if (!head) throw new NotFoundError({ status: 404, code: "not_found", message: "rule head not found" });
    entry.undone = true;
    this.state.ruleAudit.set(entry.id, entry);
    const before = JSON.parse(entry.before_json ?? "{}") as Partial<Rule>;
    head.status = "superseded";
    this.state.rules.set(head.id, head);
    const ts = now();
    const restored: Rule = {
      ...head,
      id: rid("rule"),
      rev: head.rev + 1,
      rule_text: before.rule_text ?? head.rule_text,
      status: before.rule_text ? "active" : "retired",
      supersedes_id: head.id,
      created_at: ts,
      updated_at: ts,
    };
    this.state.rules.set(restored.id, restored);
    this.recordRuleAudit("restore", restored.id, ruleSnapshotJSON(head), ruleSnapshotJSON(restored));
    return restored;
  }

  /** recordRuleAudit appends one change/undo audit row (mock). */
  private recordRuleAudit(action: RuleAuditEntry["action"], entityId: string, before: string, after: string): void {
    const entry: RuleAuditEntry = {
      id: rid("udo"),
      entity_kind: "rule",
      entity_id: entityId,
      action,
      actor_kind: "agent",
      actor_id: "agent:agt_mock",
      before_json: before,
      after_json: after,
      undone: false,
      created_at: now(),
    };
    this.state.ruleAudit.set(entry.id, entry);
  }

  /**
   * enqueueReviewEvent appends a durable nudge for a review with the next per-review
   * monotonic seq (mock mirror of the server's enqueue-on-transition).
   */
  private enqueueReviewEvent(
    reviewId: string,
    reason: ReviewEvent["reason"],
    payload?: Record<string, unknown>,
  ): ReviewEvent {
    const list = this.state.reviewEvents.get(reviewId) ?? [];
    const last = list[list.length - 1];
    const review = this.state.reviews.get(reviewId);
    const ev: ReviewEvent = {
      seq: last ? last.seq + 1 : 1,
      id: rid("ndg"),
      reason,
      review_id: reviewId,
      category_id: review?.category_id,
      payload,
      created_at: now(),
    };
    list.push(ev);
    this.state.reviewEvents.set(reviewId, list);
    return ev;
  }

  /**
   * Emit the terminal-class nudge for the review's current state. `sent` and
   * `cancelled` close the row. `failed` emits `send_failed`, and a later explicit
   * cancel emits `cancelled`; this helper deliberately does not claim the first is
   * the last event the review can produce.
   */
  private enqueueTerminalNudge(review: Review): ReviewEvent | undefined {
    switch (review.state) {
      case "sent":
      case "auto_sent": {
        const payload: Record<string, unknown> = {
          state: review.state,
          message_id: review.sent_message_id ?? "",
          send_path: review.send_path ?? "",
          sent_at: review.sent_at ?? now(),
        };
        if (review.state === "sent") {
          // `decision` is derived the same way the chat surface derives it, so an
          // agent reading the nudge and an agent reading the thread never disagree
          // about whether the reviewer edited its draft.
          payload.decision =
            review.sent_body_text || review.sent_subject || review.diff_unified
              ? "edited"
              : "approved";
        } else {
          payload.gate_outcome = review.gate_outcome ?? "";
        }
        return this.enqueueReviewEvent(review.id, "sent", payload);
      }
      case "failed":
        // agent_retryable is FALSE and next_action says compose a NEW message: the
        // only live edge out of failed is cancel, so telling an agent to retry a row
        // nobody can move is how a drain loop spins forever.
        return this.enqueueReviewEvent(review.id, "send_failed", {
          state: "failed",
          error: review.send_error ?? "",
          agent_retryable: false,
          next_action: "compose_and_submit_a_new_message",
        });
      case "cancelled":
        return this.enqueueReviewEvent(review.id, "cancelled", { state: "cancelled" });
      default:
        return undefined;
    }
  }

  /**
   * Enqueue `front_run_next` - the signal that the review reached a terminal state
   * while the agent was still trying to act on it.
   *
   * Deduped on (review, terminal state, parent revision) so a retry loop hitting
   * the same 409 collapses to ONE row rather than one per attempt. Best-effort by
   * design: it must never turn a 409 into a failure.
   */
  private enqueueFrontRunNudge(review: Review, parentRevision: number): void {
    const key = `frontrun:${review.id}:${review.state}:${parentRevision}`;
    const list = this.state.reviewEvents.get(review.id) ?? [];
    if (list.some((e) => e.reason === "front_run_next" && e.payload?.dedupe_key === key)) return;
    this.enqueueReviewEvent(review.id, "front_run_next", {
      dedupe_key: key,
      state: review.state,
      sent_message_id: review.sent_message_id,
      your_parent_revision: parentRevision,
      current_revision: review.revision,
      diff_available: (review.diff_unified ?? "").trim() !== "",
    });
  }

  /**
   * Mock-only: mirror a console/human approve that delivers the draft. The live
   * server does this on the console plane (never an SDK call); the hook exists so a
   * drain loop can be driven to its terminal `sent` event offline.
   */
  simulateReviewApproved(reviewId: string, opts: { edited?: boolean } = {}): Review | undefined {
    const review = this.state.reviews.get(reviewId);
    if (!review) return undefined;
    if (opts.edited) review.sent_body_text = review.proposed_body_text;
    this.setReviewState(review, "sent");
    review.version += 1;
    review.sent_message_id = `<${rid("mid")}@acme.test>`;
    review.send_path = "human_reviewed";
    review.sent_at = now();
    review.updated_at = review.sent_at;
    this.state.reviews.set(reviewId, review);
    this.enqueueTerminalNudge(review);
    return review;
  }

  /**
   * Mock-only: mirror an approved draft whose delivery then FAILED at the provider.
   * This is the case the composing agent was previously never told about - the
   * console showed the error and the agent's queue stayed silent - so the loop test
   * that matters most drives this path.
   */
  simulateSendFailed(reviewId: string, error = "provider rejected the message"): Review | undefined {
    const review = this.state.reviews.get(reviewId);
    if (!review) return undefined;
    this.setReviewState(review, "failed");
    review.version += 1;
    review.send_error = error;
    review.updated_at = now();
    this.state.reviews.set(reviewId, review);
    this.enqueueTerminalNudge(review);
    return review;
  }

  /**
   * simulateReviewRejected is a mock-only test hook that mirrors a console reject:
   * it enqueues a `rejected` durable nudge to the composer so the realtime
   * drain/ack surface has a deterministic event to exercise offline. The live
   * server enqueues this on the reject TRANSITION (console-only, never an SDK call).
   */
  simulateReviewRejected(reviewId: string, comment = "soften the tone"): ReviewEvent {
    return this.enqueueReviewEvent(reviewId, "rejected", { decision: "rejected", comment });
  }

  /**
   * simulateReviewOpened is a mock-only test hook that mirrors a reviewer opening a
   * draft (needs_review -> in_review). There is no agent-plane "open for review"
   * call (a reviewer/human opens it), so tests of the M5 chat surface use this to get
   * a chattable draft offline.
   */
  simulateReviewOpened(reviewId: string): Review | undefined {
    const review = this.state.reviews.get(reviewId);
    if (!review) return undefined;
    this.setReviewState(review, "in_review");
    review.version += 1;
    review.updated_at = now();
    this.state.reviews.set(reviewId, review);
    return review;
  }

  /**
   * simulateHumanComment is a mock-only test hook that mirrors the console chat side-
   * panel: it appends a human_comment turn so get_review_feedback has a comment to
   * assemble. The live server writes this on the console plane (never an SDK call).
   */
  simulateHumanComment(reviewId: string, body: string): ReviewTurn | undefined {
    const review = this.state.reviews.get(reviewId);
    if (!review) return undefined;
    const turns = this.state.reviewTurns.get(reviewId) ?? [];
    const turn: ReviewTurn = {
      id: rid("turn"),
      seq: turns.length + 1,
      turn_type: "human_comment",
      actor_kind: "human",
      actor_id: "user_demo",
      body,
      created_at: now(),
    };
    turns.push(turn);
    this.state.reviewTurns.set(reviewId, turns);
    return turn;
  }

  /** Drain the next un-acked review events (mock), FIFO per review + cursors. */
  listReviewEvents(params: ListReviewEventsParams = {}): ReviewEventsResult {
    const want = params.review_id?.trim();
    const events: ReviewEvent[] = [];
    const touched = new Set<string>();
    for (const [reviewId, list] of this.state.reviewEvents) {
      if (want && reviewId !== want) continue;
      const acked = this.state.reviewEventCursors.get(reviewId) ?? 0;
      for (const ev of list) {
        if (ev.seq > acked) {
          events.push(ev);
          touched.add(reviewId);
        }
      }
    }
    events.sort((a, b) => (a.review_id ?? "").localeCompare(b.review_id ?? "") || a.seq - b.seq);
    const limited = params.limit && params.limit > 0 ? events.slice(0, params.limit) : events;
    const cursors = [...touched].map((reviewId) => ({
      review_id: reviewId,
      last_acked_seq: this.state.reviewEventCursors.get(reviewId) ?? 0,
    }));
    return { events: limited, cursors };
  }

  /**
   * Long-poll for a review event (mock). Offline there is nothing to wait FOR, so it
   * returns the immediate drain (empty when caught up) - the server's "empty on
   * timeout" contract.
   */
  waitForReviewEvent(params: WaitForReviewEventParams = {}): ReviewEventsResult {
    return this.listReviewEvents({ review_id: params.review_id, limit: params.limit });
  }

  /** Ack review events (mock): advance per-review cursors monotonically. */
  ackReviewEvent(req: AckReviewEventRequest): AckReviewEventResult {
    const cursors: { review_id: string; last_acked_seq: number }[] = [];
    for (const a of req.acks ?? []) {
      const reviewId = a.review_id?.trim();
      if (!reviewId) continue;
      const prev = this.state.reviewEventCursors.get(reviewId) ?? 0;
      const next = Math.max(prev, a.through_seq); // monotonic (exactly-once effect)
      this.state.reviewEventCursors.set(reviewId, next);
      cursors.push({ review_id: reviewId, last_acked_seq: next });
    }
    return { cursors };
  }

  /** Mint a needs_review record + its intent (agent_note) and initial-draft turns. */
  private createReviewRecord(
    address: string,
    opts: {
      kind: "send" | "reply" | "forward";
      subject: string;
      text: string;
      html?: string;
      to: string[];
      cc?: string[];
      bcc?: string[];
      intent?: { summary: string; meta?: Record<string, unknown> };
      categoryId?: string;
      /** The mode the policy resolved. Every agent-plane send writes a row, direct included. */
      mode?: "review" | "direct";
    },
  ): Review {
    const id = rid("rr");
    const created = now();
    const mode = opts.mode ?? "review";
    const review: Review = {
      id,
      state: "needs_review",
      mode,
      effective_mode: mode,
      closed: false,
      kind: opts.kind,
      from_address: address,
      agent_id: rid("agt"),
      category_id: opts.categoryId,
      intent_summary: opts.intent?.summary ?? "",
      intent_meta: opts.intent?.meta,
      revision: 0,
      version: 0,
      proposed_subject: opts.subject,
      proposed_body_text: opts.text,
      proposed_body_html: opts.html,
      proposed_to: opts.to,
      proposed_cc: opts.cc,
      proposed_bcc: opts.bcc,
      created_at: created,
      updated_at: created,
    };
    this.state.reviews.set(id, review);
    const turns: ReviewTurn[] = [];
    if (opts.intent?.summary?.trim()) {
      turns.push({
        id: rid("turn"),
        seq: turns.length + 1,
        turn_type: "agent_note",
        actor_kind: "agent",
        body: opts.intent.summary,
        metadata: { kind: "intent" },
        created_at: created,
      });
    }
    turns.push({
      id: rid("turn"),
      seq: turns.length + 1,
      turn_type: "agent_draft",
      actor_kind: "agent",
      body: opts.text,
      revision: 0,
      created_at: created,
    });
    this.state.reviewTurns.set(id, turns);
    return review;
  }

  /** Append a message to an inbox's store and return it (mock helper). */
  private appendMessage(
    address: string,
    opts: {
      direction: Message["direction"];
      from: string;
      to: string[];
      cc?: string[];
      subject: string;
      text: string;
      html?: string;
      threadId: string;
      attachments?: AttachmentInput[];
    },
  ): Message {
    const id = rid("msg");
    const inbox = this.state.inboxes.get(address);
    const msg: Message = {
      id,
      thread_id: opts.threadId,
      inbox: inbox?.address ?? address,
      direction: opts.direction,
      from: inbox?.display_name
        ? { email: opts.from, name: inbox.display_name }
        : { email: opts.from },
      to: opts.to.map((email) => ({ email })),
      cc: (opts.cc ?? []).map((email) => ({ email })),
      subject: opts.subject,
      text: opts.text,
      html: opts.html ?? null,
      extracted_text: opts.text.trim() || null,
      extracted_html: opts.html?.trim() || null,
      message_id: `<${id}@${address.split("@")[1] ?? PAID_SHARED_DOMAIN}>`,
      folder: opts.direction === "inbound" ? "INBOX" : "Sent",
      seen: opts.direction === "outbound",
      date: now(),
    };
    const arr = this.state.messages.get(address) ?? [];
    arr.push(msg);
    this.state.messages.set(address, arr);
    if (opts.direction === "inbound") this.emitEvent("message.received", msg);
    if (opts.attachments && opts.attachments.length > 0) {
      const stored: StoredAttachment[] = opts.attachments.map((a, i) => ({
        meta: {
          id: `att_${i + 1}_${id}`,
          filename: a.filename,
          content_type: a.content_type || "application/octet-stream",
          size: base64ByteLength(a.content_base64),
        },
        content_base64: a.content_base64,
      }));
      this.state.attachments.set(id, stored);
    }
    return msg;
  }

  /** List a message's attachment metadata (mirrors the list endpoint). */
  listAttachments(messageId: string): Page<Attachment> {
    this.getMessage(messageId); // throws if the message does not exist
    const items = (this.state.attachments.get(messageId) ?? []).map((a) => a.meta);
    return { items, total: items.length };
  }

  /** Fetch one attachment's bytes + metadata (mirrors the download endpoint). */
  getAttachment(messageId: string, attachmentId: string): AttachmentDownload {
    const stored = (this.state.attachments.get(messageId) ?? []).find(
      (a) => a.meta.id === attachmentId,
    );
    if (!stored) throw new Error(`attachment not found: ${attachmentId}`);
    return {
      filename: stored.meta.filename,
      content_type: stored.meta.content_type,
      content_base64: stored.content_base64,
    };
  }

  listMessages(address: string, params: ListMessagesParams = {}): Page<Message> {
    address = this.addrOf(address);
    let items = [...(this.state.messages.get(address) ?? [])].sort((a, b) =>
      b.date.localeCompare(a.date),
    );
    if (params.unread) items = items.filter((m) => !m.seen);
    if (params.from) {
      const q = params.from.toLowerCase();
      items = items.filter((m) => m.from.email.toLowerCase().includes(q));
    }
    if (params.to) {
      const q = params.to.toLowerCase();
      items = items.filter((m) => m.to.some((a) => a.email.toLowerCase().includes(q)));
    }
    if (params.subject) {
      const q = params.subject.toLowerCase();
      items = items.filter((m) => m.subject.toLowerCase().includes(q));
    }
    const total = items.length;
    const offset = params.offset ?? (params.cursor ? Number(params.cursor) : 0);
    const limit = params.limit ?? 25;
    const page = items.slice(offset, offset + limit);
    const result: Page<Message> = { items: page, total };
    if (offset + page.length < total) result.next_cursor = String(offset + page.length);
    return result;
  }

  /** Fetch a single message by id across all inboxes. */
  getMessage(messageId: string): Message {
    for (const msgs of this.state.messages.values()) {
      const found = msgs.find((m) => m.id === messageId);
      if (found) return found;
    }
    throw new Error(`message not found: ${messageId}`);
  }

  /** Toggle the \Seen flag for a message by id. */
  markRead(messageId: string, read: boolean): Message {
    const msg = this.getMessage(messageId);
    msg.seen = read;
    return msg;
  }

  /** Render a minimal RFC822 .eml for a message by id (mirrors the raw endpoint). */
  getMessageRaw(messageId: string): string {
    const m = this.getMessage(messageId);
    const to = m.to.map((a) => a.email).join(", ");
    const from = m.from.name ? `${m.from.name} <${m.from.email}>` : m.from.email;
    const body = m.text ?? m.html ?? "";
    const contentType = m.text !== null ? "text/plain" : "text/html";
    return [
      `From: ${from}`,
      `To: ${to}`,
      `Subject: ${m.subject}`,
      `Message-ID: ${m.message_id}`,
      `Date: ${m.date}`,
      "MIME-Version: 1.0",
      `Content-Type: ${contentType}; charset=utf-8`,
      "",
      body,
      "",
    ].join("\r\n");
  }

  /** Full-text search scoped to one inbox. */
  searchMessages(address: string, params: SearchMessagesParams): Page<Message> {
    address = this.addrOf(address);
    const q = params.q.toLowerCase();
    const items = [...(this.state.messages.get(address) ?? [])]
      .filter(
        (m) =>
          m.subject.toLowerCase().includes(q) ||
          [m.text, m.html]
            .filter((part): part is string => typeof part === "string" && part.length > 0)
            .join("\n")
            .toLowerCase()
            .includes(q) ||
          m.from.email.toLowerCase().includes(q),
      )
      .sort((a, b) => b.date.localeCompare(a.date));
    const total = items.length;
    const offset = params.offset ?? (params.cursor ? Number(params.cursor) : 0);
    const limit = params.limit ?? 25;
    const page = items.slice(offset, offset + limit);
    const result: Page<Message> = { items: page, total };
    if (offset + page.length < total) result.next_cursor = String(offset + page.length);
    return result;
  }

  listThreads(address: string, params: ListThreadsParams = {}): Page<Thread> {
    address = this.addrOf(address);
    const items = this.threadsFor(address);
    return this.paginateThreads(items, params);
  }

  /** Thread-level search (subject / snippet / participant substring). */
  searchThreads(address: string, params: SearchMessagesParams): Page<Thread> {
    address = this.addrOf(address);
    const q = params.q.toLowerCase();
    const items = this.threadsFor(address).filter(
      (t) =>
        t.subject.toLowerCase().includes(q) ||
        t.snippet.toLowerCase().includes(q) ||
        t.participants.join(" ").toLowerCase().includes(q),
    );
    return this.paginateThreads(items, params);
  }

  private paginateThreads(
    items: Thread[],
    params: Pick<ListThreadsParams, "limit" | "offset" | "cursor">,
  ): Page<Thread> {
    const total = items.length;
    const cursorOffset = params.cursor === undefined ? undefined : Number(params.cursor);
    const offset = params.offset ?? (Number.isFinite(cursorOffset) ? cursorOffset! : 0);
    const limit = params.limit ?? 25;
    const page = items.slice(offset, offset + limit);
    const result: Page<Thread> = { items: page, total };
    if (offset + page.length < total) result.next_cursor = String(offset + page.length);
    return result;
  }

  /** Fetch one thread (with messages, oldest-first) by id under an inbox. */
  getThread(address: string, threadId: string): ThreadDetail {
    address = this.addrOf(address);
    const messages = (this.state.messages.get(address) ?? [])
      .filter((m) => m.thread_id === threadId)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (messages.length === 0) throw new Error(`thread not found: ${threadId}`);
    return { ...this.buildThread(address, threadId, messages), messages };
  }

  getSubmission(address: string, submissionId: string): Submission | undefined {
    address = this.addrOf(address);
    const message = (this.state.messages.get(address) ?? []).find((item) => item.submission_id === submissionId);
    if (!message) return undefined;
    return { submission_id: submissionId, inbox: address, sent_message_id: message.id, sent_copy_status: "stored",
      transport: message.transport ?? {}, recipients: [...message.to, ...(message.cc ?? [])].map(({ email }) => ({ recipient: email, state: "accepted" })),
      created_at: message.date, updated_at: message.date };
  }

  /**
   * Delete a message by id: move it to Trash (soft) or remove it (expunge / it
   * already lives in Trash). Returns undefined when the inbox/message is unknown
   * so the transport can surface a 404.
   */
  deleteMessage(address: string, messageId: string, expunge: boolean): DeleteResult | undefined {
    address = this.addrOf(address);
    if (!this.getInbox(address)) return undefined;
    const msgs = this.state.messages.get(address) ?? [];
    const msg = msgs.find((m) => m.id === messageId);
    if (!msg) return undefined;
    const hard = expunge || msg.folder === "Trash";
    if (hard) {
      this.state.messages.set(address, msgs.filter((m) => m.id !== messageId));
    } else {
      msg.folder = "Trash";
    }
    return { id: messageId, deleted: true, expunged: hard, count: 1 };
  }

  /** Delete every message in a thread by id (move to Trash or expunge). */
  deleteThread(address: string, threadId: string, expunge: boolean): DeleteResult | undefined {
    address = this.addrOf(address);
    if (!this.getInbox(address)) return undefined;
    const msgs = this.state.messages.get(address) ?? [];
    const inThread = msgs.filter((m) => m.thread_id === threadId);
    if (inThread.length === 0) return undefined;
    if (expunge) {
      this.state.messages.set(address, msgs.filter((m) => m.thread_id !== threadId));
    } else {
      for (const m of inThread) m.folder = "Trash";
    }
    return { id: threadId, deleted: true, expunged: expunge, count: inThread.length };
  }

  /**
   * Batch mark read/unread and/or move folder for a list of ids under one inbox.
   * Unknown ids go in `failed`. Returns undefined when the inbox is unknown.
   */
  batchUpdateMessages(
    address: string,
    ids: string[],
    read: boolean | undefined,
    folder: string | undefined,
  ): BatchUpdateResult | undefined {
    address = this.addrOf(address);
    if (!this.getInbox(address)) return undefined;
    const byId = new Map((this.state.messages.get(address) ?? []).map((m) => [m.id, m]));
    const updated: string[] = [];
    const failed: string[] = [];
    for (const id of ids) {
      const m = byId.get(id);
      if (!m) {
        failed.push(id);
        continue;
      }
      if (read !== undefined) m.seen = read;
      if (folder) m.folder = folder;
      updated.push(id);
    }
    return { updated, failed };
  }

  /** Build all threads for an inbox, newest-active first. */
  private threadsFor(address: string): Thread[] {
    const byThread = new Map<string, Message[]>();
    for (const m of this.state.messages.get(address) ?? []) {
      const arr = byThread.get(m.thread_id) ?? [];
      arr.push(m);
      byThread.set(m.thread_id, arr);
    }
    const items = [...byThread.entries()].map(([id, ms]) => this.buildThread(address, id, ms, true));
    items.sort((a, b) => b.last_message_at.localeCompare(a.last_message_at));
    return items;
  }

  private buildThread(address: string, id: string, ms: Message[], summary = false): Thread {
    const sorted = [...ms].sort((a, b) => a.date.localeCompare(b.date));
    const last = sorted[sorted.length - 1]!;
    const seen = new Set<string>();
    const participants: string[] = [];
    const participantMessages = summary ? [last] : sorted;
    for (const m of participantMessages) {
      for (const a of [m.from, ...m.to, ...(m.cc ?? []), ...(m.reply_to ?? [])]) {
        const key = a.email.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        participants.push(a.name ? `${a.name} <${a.email}>` : a.email);
      }
    }
    return {
      id,
      inbox_id: this.state.inboxes.get(address)?.address ?? address,
      subject: normalizeThreadSubject(sorted[0]?.subject ?? "(no subject)"),
      participants,
      message_count: sorted.length,
      last_message_at: last.date,
      snippet: (last.text ?? last.html ?? "").slice(0, 120),
      unread: !last.seen,
      last_message_has_attachments: (this.state.attachments.get(last.id)?.length ?? 0) > 0,
      last_message_id: last.id,
    };
  }

  /**
   * Mock wait_for_email: synthesizes a plausible OTP email after a short delay so the OTP example
   * runs end-to-end offline. The live implementation waits through the platform receive path.
   */
  async waitForEmail(address: string, req: WaitForEmailRequest): Promise<WaitForEmailResult> {
    address = this.addrOf(address);
    const inbox = this.state.inboxes.get(address);
    const match = req.match ? compileWaitRegex(req.match) : undefined;
    const delayMs = Math.min(400, (req.timeout_seconds ?? 300) * 1000);
    await new Promise((r) => setTimeout(r, delayMs));
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const from = req.from ?? "no-reply@acme.test";
    const text = `Your Acme verification code is ${code}. It expires in 10 minutes.\n\nOr verify here: https://acme.test/verify?token=${rid("vt")}`;
    const subject = req.subject ?? "Your verification code";
    if (match && !match.test(`${subject}\n${text}`)) {
      return { timed_out: true, message: null, extracted: { otp: null, link: null } };
    }
    const message: Message = {
      id: rid("msg"),
      thread_id: rid("thr"),
      inbox: inbox?.address ?? address,
      direction: "inbound",
      from: { email: from, name: "Acme" },
      to: [{ email: address }],
      cc: [],
      subject,
      text,
      html: `<p>${text.replace(/\n/g, "<br/>")}</p>`,
      extracted_text: text,
      extracted_html: `<p>${text.replace(/\n/g, "<br/>")}</p>`,
      message_id: `<${rid("mid")}@acme.test>`,
      folder: "INBOX",
      seen: false,
      date: now(),
    };
    const existing = this.state.messages.get(address) ?? [];
    existing.push(message);
    this.state.messages.set(address, existing);
    this.emitEvent("message.received", message);
    return { timed_out: false, message, extracted: extractCredentials(message) };
  }

  /**
   * Append one event to the in-memory journal that backs the SSE stream. Mirrors
   * the server: a monotonic seq is the resume token and the payload is the same
   * envelope a webhook delivers.
   */
  private emitEvent(event: string, message: Message): void {
    const seq = ++this.state.eventSeq;
    this.state.events.push({
      event,
      seq,
      id: rid("evt"),
      created_at: now(),
      inbox: message.inbox,
      message,
    });
  }

  /**
   * Replay journal events after `lastEventId`, scoped to one inbox (or all when
   * `address` is null). The offline mock yields the backlog and returns; the live
   * transport tails an open connection. Both honor the same resume contract.
   */
  async *streamEvents(
    address: string | null,
    lastEventId?: number,
  ): AsyncGenerator<StreamEvent, void, unknown> {
    const after = lastEventId ?? 0;
    // Events are keyed by the canonical address; normalize an id ref to it so a
    // handle that streams by its opaque id still matches its own events.
    const scope = address === null ? null : this.addrOf(address);
    for (const ev of this.state.events) {
      if (ev.seq <= after) continue;
      if (scope !== null && ev.inbox !== scope) continue;
      yield ev;
    }
  }

  registerWebhook(req: RegisterWebhookRequest): Webhook {
    // Idempotency replay: a repeat with the same client_id returns the first row.
    if (req.client_id) {
      const existingId = this.state.webhookByClientId.get(req.client_id);
      const existing = existingId ? this.state.webhooks.get(existingId) : undefined;
      if (existing) return { ...existing };
    }
    const id = rid("wh");
    const webhook: Webhook = {
      id,
      url: req.url,
      events: req.events ?? ["message.received"],
      inbox: req.inbox ?? null,
      agent_id: this.state.agents.keys().next().value ?? "agt_mock",
      secret: `whsec_${rid("s").slice(2)}${rid("s").slice(2)}`,
      secret_prefix: `whsec_${rid("s").slice(2, 6)}`,
      active: true,
      created_at: now(),
    };
    this.state.webhooks.set(id, webhook);
    if (req.client_id) this.state.webhookByClientId.set(req.client_id, id);
    // Return the create shape (with secret); stored copy keeps it for parity.
    return { ...webhook };
  }

  /** List registered webhooks (secret redacted, mirroring the server). */
  listWebhooks(params: ListWebhooksParams = {}): Page<Webhook> {
    const items = [...this.state.webhooks.values()].map((w) => redactSecret(w));
    const limit = params.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Invalid webhook page limit");
    if (params.cursor && !/^webhooks:\d+$/.test(params.cursor)) throw new Error("Invalid webhook cursor");
    const offset = params.cursor ? Number(params.cursor.slice(9)) : 0;
    const next = offset + limit < items.length ? `webhooks:${offset + limit}` : undefined;
    return { items: items.slice(offset, offset + limit), total: items.length, has_more: !!next, next_cursor: next };
  }

  /** Get one webhook by id (secret redacted), or undefined when missing. */
  getWebhook(webhookId: string): Webhook | undefined {
    const w = this.state.webhooks.get(webhookId);
    return w ? redactSecret(w) : undefined;
  }

  /**
   * Update a webhook in place (secret redacted), or undefined when missing.
   * Every field is optional; an unset field leaves the stored value untouched
   * (PATCH semantics). An empty-string `inbox` clears the filter.
   */
  updateWebhook(webhookId: string, req: UpdateWebhookRequest): Webhook | undefined {
    const w = this.state.webhooks.get(webhookId);
    if (!w) return undefined;
    if (req.url !== undefined) w.url = req.url;
    if (req.events !== undefined) {
      w.events = req.events.length ? req.events : ["message.received"];
    }
    if (req.inbox !== undefined) w.inbox = req.inbox === "" ? null : req.inbox;
    if (req.active !== undefined) w.active = req.active;
    this.state.webhooks.set(webhookId, w);
    return redactSecret(w);
  }

  /** Delete a webhook by id; returns false when it was not found. */
  deleteWebhook(webhookId: string): boolean {
    return this.state.webhooks.delete(webhookId);
  }

  // ---- contact allow/block lists (Slice 3) ------------------------------

  /** Add one allow/block entry scoped to an inbox, or undefined when the inbox is unknown. */
  addContactListEntry(address: string, req: AddContactListRequest): ContactListEntry | undefined {
    address = this.addrOf(address);
    if (!this.state.inboxes.has(address)) return undefined;
    const entry: ContactListEntry = {
      id: rid("lst"),
      inbox: address,
      kind: req.kind,
      direction: req.direction ?? "send",
      pattern: normalizeContactPattern(req.pattern),
      created_at: now(),
    };
    this.state.contactLists.set(entry.id, entry);
    return { ...entry };
  }

  /** List the entries governing an inbox (inbox-specific + account-wide), or undefined when unknown. */
  listContactLists(address: string): Page<ContactListEntry> | undefined {
    address = this.addrOf(address);
    if (!this.state.inboxes.has(address)) return undefined;
    const items = [...this.state.contactLists.values()].filter(
      (e) => e.inbox === null || e.inbox === address,
    );
    return { items, total: items.length };
  }

  /** Delete a contact-list entry by id; returns false when it was not found. */
  deleteContactListEntry(_address: string, entryId: string): boolean {
    return this.state.contactLists.delete(entryId);
  }

  // ---- domains (Slice 5) ------------------------------------------------

  /** Add a delegated domain and return only the customer-published nameservers. */
  onboardDomain(req: OnboardDomainRequest): Domain {
    // project_id is an assertion (never a selector): a mismatch is 403. The domain's
    // project binding is always derived from the key, not from client input.
    assertProjectMatch(req.project_id);
    const name = req.domain.trim().toLowerCase();
    const existing = this.state.domains.get(name);
    if (existing) return { ...existing };
    const mode = "ns_delegated";
    const domain: Domain = {
      id: rid("dom"),
      domain: name,
      mode,
      verification_status: "verifying",
      dkim_status: "configured",
      shared: false,
      created_at: now(),
      delegation_ns: domainDelegationNS(name),
      instruction: "Add the nameserver entries at your domain provider. We check automatically; use Recheck DNS for an immediate check.",
      readiness: {
        status: "waiting_for_dns", label: "Waiting for DNS", summary: "We have not confirmed your nameserver entries yet. Add them at your domain provider; we will finish setup automatically.",
        reason: "dns_entries_unconfirmed", action_required_by: "customer", next_action: "check_dns_entries",
        ready_for_inboxes: false, poll_after_seconds: 30,
        inboxes: { scope: "agent", total: 0, ready: 0, setting_up: 0, needs_attention: 0 },
      },
    };
    this.state.domains.set(name, domain);
    return { ...domain };
  }

  /** List onboarded domains (records omitted on the summary, mirroring the server). */
  listDomains(): Page<Domain> {
    const items = [...this.state.domains.values()].map((d) => domainSummary(d));
    return { items, total: items.length };
  }

  /** Get one domain's detail + the records to set, inline; undefined when absent. */
  getDomain(domain: string): Domain | undefined {
    const d = this.state.domains.get(domain.trim().toLowerCase());
    return d ? { ...d } : undefined;
  }

  /** Trigger/refresh verification; returns the (re-read) detail, or undefined when absent. */
  verifyDomain(domain: string): Domain | undefined {
    const d = this.state.domains.get(domain.trim().toLowerCase());
    return d ? { ...d } : undefined;
  }

  /**
   * Offboard (remove) a domain; returns false when it was not found. Also
   * records a synthetic succeeded teardown job under `job-offboard-<domain>`
   * (there is no job runner in the mock) so a subsequent {@link getJob} poll
   * resolves the same way the live transport's async contract would.
   */
  offboardDomain(domain: string): boolean {
    const name = domain.trim().toLowerCase();
    const found = this.state.domains.delete(name);
    if (found) {
      const ts = now();
      this.state.jobs.set(`job-offboard-${name}`, {
        object: "job",
        id: `job-offboard-${name}`,
        type: "domain_offboard",
        status: "succeeded",
        created_at: ts,
        updated_at: ts,
        finished_at: ts,
      });
    }
    return found;
  }

  /** Get one async job's poll status; undefined when the id is unknown. */
  getJob(jobId: string): Job | undefined {
    const job = this.state.jobs.get(jobId);
    return job ? { ...job } : undefined;
  }

  // ---- commerce (quote/request/status; no human approval mutation) ------

  quoteDomain(req: QuoteDomainRequest): DomainQuote {
    const domain = req.domain.trim().toLowerCase();
    return {
      object: "domain_quote",
      domain,
      available: !domain.startsWith("unavailable."),
      currency: "usd",
      quote_cents: 2500,
      renewal_cents: 2500,
      premium: false,
      quote_expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      blockers: [],
    };
  }

  requestDomainPurchase(req: RequestDomainPurchaseRequest): CommerceRequest {
    const idem = `domain_purchase:${req.idempotency_key.trim()}`;
    const replayId = this.state.commerceByIdempotency.get(idem);
    if (replayId) return { ...this.state.commerceRequests.get(replayId)! };
    const quote = this.quoteDomain({ domain: req.domain });
    const timestamp = now();
    const id = rid("creq");
    const approvalUrl = `https://app.extrovert.dev/commerce/requests/${id}`;
    const request: CommerceRequest = {
      object: "commerce_request",
      id,
      kind: "domain_purchase",
      state: "awaiting_human_approval",
      domain: quote.domain,
      domain_scope: req.scope ?? "org",
      rationale: req.rationale,
      currency: quote.currency,
      quote_cents: quote.quote_cents,
      renewal_cents: quote.renewal_cents,
      quote_expires_at: quote.quote_expires_at,
      auto_renew: req.auto_renew ?? true,
      blocker_code: "human_approval_required",
      blockers: [
        {
          code: "human_approval_required",
          message: "A human billing administrator must approve this domain purchase.",
          manage_url: approvalUrl,
        },
      ],
      approval_url: approvalUrl,
      agent_next_action: "Share approval_url with the human, then poll this request after approval.",
      retry_safe: true,
      poll_after_seconds: 10,
      version: 1,
      created_at: timestamp,
      updated_at: timestamp,
    };
    this.state.commerceRequests.set(id, request);
    this.state.commerceByIdempotency.set(idem, id);
    return { ...request };
  }

  requestPlanChange(req: RequestPlanChangeRequest): CommerceRequest {
    const idem = `plan_change:${req.idempotency_key.trim()}`;
    const replayId = this.state.commerceByIdempotency.get(idem);
    if (replayId) return { ...this.state.commerceRequests.get(replayId)! };
    const timestamp = now();
    const id = rid("creq");
    const approvalUrl = `https://app.extrovert.dev/commerce/requests/${id}`;
    const request: CommerceRequest = {
      object: "commerce_request",
      id,
      kind: "plan_change",
      state: "awaiting_human_approval",
      target_plan: req.target_plan,
      current_plan: "developer",
      rationale: req.rationale,
      currency: "usd",
      quote_cents: 0,
      renewal_cents: 0,
      auto_renew: true,
      blocker_code: "human_approval_required",
      blockers: [
        {
          code: "human_approval_required",
          message: "A human billing administrator must approve this plan change.",
          manage_url: approvalUrl,
        },
      ],
      approval_url: approvalUrl,
      agent_next_action: "Share approval_url with the human, then poll this request after approval.",
      retry_safe: true,
      poll_after_seconds: 10,
      version: 1,
      created_at: timestamp,
      updated_at: timestamp,
    };
    this.state.commerceRequests.set(id, request);
    this.state.commerceByIdempotency.set(idem, id);
    return { ...request };
  }

  getCommerceRequest(requestId: string): CommerceRequest | undefined {
    const request = this.state.commerceRequests.get(requestId);
    return request ? { ...request } : undefined;
  }

  cancelCommerceRequest(requestId: string): CommerceRequest | undefined {
    const request = this.state.commerceRequests.get(requestId);
    if (!request) return undefined;
    if (!["awaiting_human_approval", "blocked", "approved", "payment_action_required", "payment_failed"].includes(request.state)) {
      throw new ValidationError({ status: 409, code: "conflict", message: "this request can no longer be cancelled" });
    }
    request.state = "cancelled";
    request.blocker_code = undefined;
    request.blockers = [];
    request.agent_next_action = "The request is cancelled. Create a new request only if the purchase is still needed.";
    request.version += 1;
    request.updated_at = now();
    return { ...request };
  }

  listCommerceRequests(params: ListCommerceRequestsParams = {}): Page<CommerceRequest> {
    let items = [...this.state.commerceRequests.values()];
    items.sort((a, b) => b.created_at.localeCompare(a.created_at));
    const total = items.length;
    const offset = params.page ? Math.max(0, Number.parseInt(params.page, 10) || 0) : 0;
    const limit = Math.max(1, Math.min(params.limit ?? 50, 100));
    const page = items.slice(offset, offset + limit).map((request) => ({ ...request }));
    const next = offset + page.length;
    return { items: page, total, next_cursor: next < total ? String(next) : undefined };
  }

  // ---- suppressions (recipient opt-outs / list-unsubscribe) --------------

  /**
   * Pre-check whether the caller's org suppresses a recipient (mirrors
   * `GET /v1/suppressions?recipient=…`). Returns `{recipient, suppressed, rows}`
   * over the active (non-revoked) org rows for that canonicalized recipient.
   */
  precheckSuppression(recipient: string): SuppressionPrecheck {
    const canonical = canonicalRecipient(recipient);
    const rows = [...this.state.suppressions.values()]
      .filter((s) => !s.revoked && s.recipient === canonical)
      .map((s) => ({ ...s }));
    return { recipient: canonical, suppressed: rows.length > 0, rows };
  }

  /** List the caller's own org suppression rows (mirrors the paged `GET /v1/suppressions`). */
  listSuppressions(params: ListSuppressionsParams): Page<SuppressionEntry> {
    let rows = [...this.state.suppressions.values()];
    if (params.scope) rows = rows.filter((s) => s.scope === params.scope);
    if (!params.include_revoked) rows = rows.filter((s) => !s.revoked);
    rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
    const total = rows.length;
    const offset = params.cursor ? Math.max(0, Number.parseInt(params.cursor, 10) || 0) : 0;
    const limit = params.limit ?? 50;
    const items = rows.slice(offset, offset + limit).map((s) => ({ ...s }));
    const page: Page<SuppressionEntry> = { items, total };
    if (offset + items.length < total) page.next_cursor = String(offset + items.length);
    return page;
  }

  /**
   * Revoke one org-scope suppression row (mirrors `POST /v1/suppressions/{id}/revoke`).
   * A reason is required (the caller validates too). Returns the updated row, or
   * undefined when the id is unknown / not the caller's own org row.
   */
  revokeSuppression(id: string, reason: string): SuppressionEntry | undefined {
    const row = this.state.suppressions.get(id);
    // Only a non-revoked org row is revocable by the agent plane (global/shared rows
    // are platform-operator only and appear as an indistinguishable 404 here).
    if (!row || row.scope !== "org" || row.revoked) return undefined;
    row.revoked = true;
    row.revoked_at = now();
    row.revoked_by = "agent:agt_mock";
    row.revoke_reason = reason;
    this.state.suppressions.set(id, row);
    return { ...row };
  }

  /**
   * Reject the WHOLE send if ANY recipient has an active org-scope suppression,
   * naming exactly the suppressed addresses (never the scope/origin) so the caller
   * can drop them and retry - mirroring the live `recipient_suppressed` (422) path.
   */
  private enforceSuppression(recipients: string[]): void {
    const active = new Set(
      [...this.state.suppressions.values()].filter((s) => !s.revoked).map((s) => s.recipient),
    );
    if (active.size === 0) return;
    const hit: string[] = [];
    for (const rcpt of recipients) {
      const canonical = canonicalRecipient(rcpt);
      if (canonical && active.has(canonical) && !hit.includes(canonical)) hit.push(canonical);
    }
    if (hit.length === 0) return;
    throw new RecipientSuppressedError({
      status: 422,
      code: "recipient_suppressed",
      message: `${hit.length} recipient(s) have opted out (recipient_suppressed)`,
      problem: {
        type: "https://extrovert.dev/problems/recipient_suppressed",
        title: "Recipient Suppressed",
        status: 422,
        code: "recipient_suppressed",
        detail: "One or more recipients have opted out; remove them and retry.",
        errors: hit.map((r) => ({ field: "recipient", code: "recipient_suppressed", detail: r })),
      },
    });
  }

  /**
   * Enforce the send-direction contact lists for an inbox: reject a block-listed
   * recipient, or any recipient outside the allowlist when allowlist mode is on.
   * Throws a {@link PermissionError} (403) to mirror the real API.
   */
  private enforceSendPolicy(from: string, recipients: string[]): void {
    const entries = [...this.state.contactLists.values()].filter(
      (e) => e.direction === "send" && (e.inbox === null || e.inbox === from),
    );
    if (entries.length === 0) return;
    const blocks = entries.filter((e) => e.kind === "block");
    const allows = entries.filter((e) => e.kind === "allow");
    for (const rcpt of recipients) {
      const addr = normalizeContactPattern(rcpt);
      if (!addr) continue;
      if (blocks.some((b) => contactEntryMatches(b.pattern, addr))) {
        throw new PermissionError({
          status: 403,
          code: "recipient_blocked",
          message: `${rcpt} is block-listed`,
        });
      }
      if (allows.length > 0 && !allows.some((a) => contactEntryMatches(a.pattern, addr))) {
        throw new PermissionError({
          status: 403,
          code: "recipient_blocked",
          message: `${rcpt} is not on the allow list`,
        });
      }
    }
  }
}

/**
 * Canonicalize a recipient address for suppression matching: pull the address out
 * of a "Name <addr>" form, NFC-normalize, trim, and lower-case (mirrors the Go
 * canonicalization closely enough for the offline mock).
 */
function canonicalRecipient(raw: string): string {
  let value = raw.trim();
  const m = value.match(/<([^>]+)>/);
  if (m && m[1]) value = m[1];
  return value.normalize("NFC").trim().toLowerCase();
}

/**
 * Normalize a contact pattern or recipient: lower-case/trim, pull the address out
 * of a "Name <addr>" form, and strip a leading "@" from a domain pattern.
 */
function normalizeContactPattern(raw: string): string {
  let value = raw.trim();
  const m = value.match(/<([^>]+)>/);
  if (m && m[1]) value = m[1];
  value = value.trim().toLowerCase();
  return value.startsWith("@") ? value.slice(1) : value;
}

/**
 * Match a normalized pattern against a normalized recipient address. A pattern
 * with an "@" is a full-address match; a bare domain matches any address in it.
 */
function contactEntryMatches(pattern: string, addr: string): boolean {
  if (!pattern || !addr) return false;
  if (pattern.includes("@")) return pattern === addr;
  const at = addr.lastIndexOf("@");
  const domain = at >= 0 ? addr.slice(at + 1) : addr;
  return domain === pattern;
}

/** Drop the one-time signing secret from a stored webhook for read responses. */
function redactSecret(w: Webhook): Webhook {
  const { secret: _omit, ...rest } = w;
  return rest;
}

/** The nameserver records for delegated setup. */
function domainDelegationNS(domain: string): DomainRecord[] {
  return [
    { name: domain, type: "NS", value: "ns1.extrovert.dev", ttl: 300 },
    { name: domain, type: "NS", value: "ns2.extrovert.dev", ttl: 300 },
  ];
}

/** The list-view summary: status fields without the inline record set. */
function domainSummary(d: Domain): Domain {
  const { records: _r, delegation_ns: _d, instruction: _i, ...rest } = d;
  return rest;
}

function reSubject(subject: string): string {
  return /^re:/i.test(subject) ? subject : `Re: ${normalizeThreadSubject(subject)}`;
}

function fwdSubject(subject: string): string {
  return /^fwd?:/i.test(subject) ? subject : `Fwd: ${normalizeThreadSubject(subject)}`;
}

/** Strip leading Re:/Fwd: prefixes for a thread's display subject. */
function normalizeThreadSubject(subject: string): string {
  let s = subject.trim();
  for (;;) {
    const next = s.replace(/^(re|fwd|fw)\s*:\s*/i, "");
    if (next === s) break;
    s = next;
  }
  return s.trim();
}

function compileWaitRegex(pattern: string): RegExp {
  const explicitInsensitive = pattern.startsWith("(?i)");
  const source = explicitInsensitive ? pattern.slice(4) : pattern;
  return new RegExp(source, explicitInsensitive ? "i" : undefined);
}

/** Decoded byte length of a base64 string (mirrors the Go-reported size). */
function base64ByteLength(b64: string): number {
  const clean = b64.replace(/[\r\n\s]/g, "");
  if (clean.length === 0) return 0;
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  return Math.floor((clean.length * 3) / 4) - padding;
}
