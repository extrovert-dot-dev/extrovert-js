import type { InboxActivation } from "./types.js";
import type { ListWebhooksParams } from "./types.js";
import { AdministrativeFixtures } from "./administration-fixtures.js";
import type { AdministrativeRequest } from "./administration.js";
import type { ListCategoriesParams } from "./types.js";
import type { LearnReviewRuleRequest, LearnedReviewRule } from "./types.js";
/**
 * Offline fixture store.
 *
 * Every method here maps 1:1 onto a REST call in `client.ts`. Live MCP sessions
 * use the Go REST API by default; this store is used for tests and offline demos
 * when `EXTROVERT_MOCK=1`.
 *
 * The store is intentionally stateful within a process: creating an inbox,
 * sending mail, and waiting for a reply all mutate the same in-memory data, so
 * the example agent flow (redeem -> create_inbox -> send -> wait_for_email)
 * produces coherent results offline.
 */

import { extractSignals } from "./extract.js";
import { ExtrovertApiError } from "./client.js";

const PAID_SHARED_DOMAIN = "extrovertmail.com";
const FREE_SHARED_DOMAIN = "free.extrovertmail.com";
const RESERVED_SHARED_LOCAL_PARTS = new Set([
  "postmaster", "admin", "webadmin", "legal", "fraudmark", "fraudmarc", "keith",
  "melissa", "richard", "sydney", "syd", "john", "johnny",
]);

function validatedSharedLocalPart(value: string): string {
  const normalized = value.toLowerCase().trim().replace(/[^a-z0-9._-]/g, "").replace(/^[._-]+|[._-]+$/g, "").slice(0, 40);
  if (normalized.length < 5 || RESERVED_SHARED_LOCAL_PARTS.has(normalized)) {
    throw new ExtrovertApiError("Shared-domain usernames must normalize to at least 5 characters and cannot use a reserved name.", 400, "invalid");
  }
  return normalized;
}
import type {
  Attachment,
  AttachmentDownload,
  AttachmentInput,
  BatchUpdateResult,
  Category,
  CommerceRequest,
  ContactListDirection,
  ContactListEntry,
  ContactListKind,
  DeleteResult,
  Domain,
  DomainQuote,
  DomainOffboard,
  DomainRecord,
  EnrollmentResult,
  GraduationStatus,
  Inbox,
  InboxMetadata,
  Job,
  KeyTier,
  MailboxCredentials,
  Message,
  Page,
  Review,
  ReviewDecisionContext,
  ReviewerDecisionResult,
  ReviewEvent,
  ReviewPolicy,
  ReviewState,
  RiskDial,
  CategoryPacingState,
  PacingItem,
  ReviewEventsResult,
  ReviewFeedback,
  ReviewTurn,
  Rule,
  RuleSnapshot,
  RuleAuditEntry,
  ProblemField,
  ScanBacklogStatus,
  SendEmailResult,
  SendResult,
  SubmitForReviewResult,
  SuppressionEntry,
  SuppressionPrecheck,
  ReputationRollup,
  ReputationFinding,
  ListDeliverabilityFindingsInput,
  Thread,
  ThreadDetail,
  Submission,
  SubmissionTracking,
  SignUpResult,
  VerifyResult,
  WaitForEmailResult,
  Webhook,
  WebhookEvent,
  WhoAmI,
} from "./types.js";
import type {
  AckReviewEventInput,
  GetRuleAuditInput,
  GetRulesInput,
  InboxMetadataPatch,
  ListReviewEventsInput,
  ListReviewsInput,
  ListCommerceRequestsInput,
  PostReviewChatInput,
  ProposeCategoryInput,
  RequestDomainPurchaseInput,
  RequestPlanChangeInput,
  RestampReviewInput,
  ReviewerDecideInput,
  SaveRuleInput,
  SubmitForReviewInput,
  SubmitForwardForReviewInput,
  SubmitRevisionInput,
  SubmitReplyForReviewInput,
  UpdateCategoryInput,
  WaitForReviewEventInput,
} from "./client.js";

let seq = 1000;
function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}_${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * The FIXED org/project the mock agent key is bound to. There is no mutable
 * project selector - these are the offline mirror of the values the live key
 * resolves from its stored binding (surfaced by whoami / enroll, stamped onto
 * project-layer rules).
 */
const MOCK_ORG_ID = "org_mock";
// Matches the SDK fixture + docs convention ("prj_…"); a shared cross-tool test
// can hardcode the same expected mock project id for both MCP and SDK output.
const MOCK_PROJECT_ID = "prj_mock";
/** Effective per-inbox recipient cap returned by the offline API fixture. */
const DEFAULT_DAILY_SEND_LIMIT = 75;

function mailboxQuickstart(address: string): VerifyResult["mailbox_quickstart"] {
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

/**
 * The recipient the mock seeds an active org-scope suppression for, so the
 * suppression reads (check/list/revoke) and the `recipient_suppressed`
 * send-rejection path have deterministic data offline.
 */
export const SEEDED_SUPPRESSED_RECIPIENT = "unsubscribed@example.com";

/**
 * The recipient whose delivery ALWAYS fails at the mock's outbound-provider boundary, so the
 * `approved -> failed` edge and its terminal `send_failed` nudge are drivable
 * offline. Without it the mock could only ever demonstrate the happy path, and a
 * drain loop that never sees `send_failed` is a drain loop nobody proved
 * terminates on failure - which is exactly how the missing terminal nudges
 * survived unnoticed.
 */
export const SEEDED_SEND_FAILURE_RECIPIENT = "bounce@example.com";

/** The scrubbed error the mock reports for {@link SEEDED_SEND_FAILURE_RECIPIENT}. */
const MOCK_SEND_FAILURE_ERROR = "delivery rejected by the recipient's mail server (550 mailbox unavailable)";

/**
 * The mock mirror of `reviewloop.AllowedAgentActions` - the verbs that ARE legal
 * from a given state. A `wrong_state` / `terminal` 409 carries these so the agent
 * is told what to do instead of being left to guess; from a terminal state the
 * reads are the only honest answer.
 */
function allowedAgentActions(state: ReviewState): string[] {
  const actions: string[] = [];
  // submit_revision targets needs_review WITH a revision bump - including the
  // needs_review self-edge, which is legal precisely because a redraft bumps the
  // revision and rewrites the draft.
  if (["needs_review", "in_review", "chatting", "rejected", "stale", "stalled"].includes(state)) {
    actions.push("submit_revision");
  }
  // post_review_chat from an AGENT actor: in_review/chatting always, and
  // needs_review because an agent question does not open the draft.
  if (["needs_review", "in_review", "chatting"].includes(state)) actions.push("post_review_chat");
  if (["needs_review", "in_review", "chatting", "stale"].includes(state)) actions.push("restamp_review");
  if (["needs_review", "in_review", "chatting", "stale", "stalled", "rejected", "failed"].includes(state)) {
    actions.push("cancel_review");
  }
  return [...actions, "get_review", "list_review_events"];
}

/** Terminal states: nothing will ever move these rows (409 `terminal`). */
const TERMINAL_REVIEW_STATES: readonly ReviewState[] = ["sent", "auto_sent", "cancelled"];

/**
 * `closed` - the DEFINITIVE "am I done?" answer. `failed` is included even though
 * it is not formally terminal: the console cannot re-approve it, so an agent told
 * `closed:false` would wait forever on a row nobody is going to move.
 */
function reviewClosed(state: ReviewState): boolean {
  return TERMINAL_REVIEW_STATES.includes(state) || state === "failed";
}

/**
 * Enforce the project_id assertion contract (mock): a request `project_id` is an
 * ASSERTION, never a selector. The mock binds every key to {@link MOCK_PROJECT_ID},
 * so a non-matching assertion is a 403 - mirroring the SDK MockBackend and the
 * real server (assertProjectMatch). Offline parity prevents the bug from only
 * surfacing in production.
 */
function assertProjectMatch(projectId: string | undefined): void {
  if (projectId !== undefined && projectId !== MOCK_PROJECT_ID) {
    throw new ForbiddenError(
      `project_id "${projectId}" does not match the key's bound project.`,
    );
  }
}

/**
 * Apply a metadata patch with merge-null-clear semantics (mirrors the server):
 * a top-level `null` clears ALL metadata; otherwise the patch merges into the
 * current object and a key whose value is `null` deletes that key.
 */
function applyMetadataPatch(
  current: InboxMetadata,
  patch: InboxMetadataPatch | null | undefined,
): InboxMetadata {
  if (patch === undefined) return current;
  if (patch === null) return {};
  const next: InboxMetadata = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key];
    else next[key] = value;
  }
  return next;
}

function shortLabel(): string {
  return Math.random().toString(36).slice(2, 5);
}

/** ruleSnapshotJSON renders a rule's restorable fields for an undo before/after column. */
function ruleSnapshotJSON(r: Rule): string {
  return JSON.stringify({
    id: r.id,
    lineage_id: r.lineage_id,
    rev: r.rev,
    scope: r.scope,
    category_id: r.category_id,
    rule_text: r.rule_text,
    kind: r.kind,
    priority: r.priority,
    status: r.status,
  });
}

interface SeedMessage {
  fromName: string;
  fromEmail: string;
  subject: string;
  text: string | null;
  html?: string;
  ageMinutes: number;
}

/** Join the source MIME alternatives without turning a missing part into "null". */
function sourceMessageBody(message: Message): string {
  return [message.text, message.html]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join("\n");
}

/** A mock attachment: wire metadata plus the raw base64 for download. */
interface StoredAttachment {
  meta: Attachment;
  content_base64: string;
}

export class FixtureStore {
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

  private administrativeFixtures: AdministrativeFixtures;
  administrativeRequest(request: AdministrativeRequest): Promise<unknown> { return this.administrativeFixtures.request(request); }
  private inboxes = new Map<string, Inbox>();
  private messages = new Map<string, Message[]>(); // inbox_id -> messages
  /** message id -> stored attachments (mock mirror of the real MIME parts). */
  private attachments = new Map<string, StoredAttachment[]>();
  /** webhook id -> registered webhook (mock mirror of extrovert_webhooks). */
  private webhooks = new Map<string, Webhook>();
  /** entry id -> contact-list entry (mock mirror of extrovert_contact_lists). */
  private contactLists = new Map<string, ContactListEntry>();
  /** domain name -> onboarded domain (mock mirror of extrovert_domains). */
  private domains = new Map<string, Domain>();
  /** job id -> async job status (mock mirror of extrovert_jobs; currently only
   *  the domain-offboard teardown enqueues one). */
  private jobs = new Map<string, Job>();
  /** request id -> agent-initiated commerce request. Human approval is never mocked as an agent action. */
  private commerceRequests = new Map<string, CommerceRequest>();
  /** create kind + Idempotency-Key -> request id. */
  private commerceIdempotency = new Map<string, string>();
  /** suppression id -> recipient opt-out row (mock mirror of extrovert_suppressions). */
  private suppressions = new Map<string, SuppressionEntry>();
  /** review id -> review request (mock mirror of extrovert_review_requests). */
  private reviews = new Map<string, Review>();
  /** review id -> append-only thread turns (mock mirror of the turn log). */
  private reviewTurns = new Map<string, ReviewTurn[]>();
  /**
   * review id -> reviewer hand-back count (M8 Slice B circuit breaker (a)). The wire
   * Review shape doesn't carry hop_count, so the mock tracks it here to surface the
   * max_hops breaker on the decision context + reviewer_decide.
   */
  private reviewHopCounts = new Map<string, number>();
  /**
   * review id -> durable nudges for that review (mock mirror of
   * extrovert_review_nudges), oldest-first with a per-review monotonic seq. The
   * authoritative liveness queue (spec §4.5) the agent drains/acks.
   */
  private reviewEvents = new Map<string, ReviewEvent[]>();
  /** review id -> the agent's last-acked seq (the per-(agent, review) cursor). */
  private reviewEventCursors = new Map<string, number>();
  /** review id -> the thread a queued reply/forward delivers into (materialized at submit). */
  private reviewThreads = new Map<string, string>();
  /** review id -> the opaque parent message id a queued reply threads to. */
  private reviewParents = new Map<string, string>();
  /** category id -> category (mock mirror of extrovert_categories, D9/D10). */
  private categories = new Map<string, Category>();
  /** rule id -> writing rule (mock mirror of extrovert_writing_rules, D2/D11). */
  private rules = new Map<string, Rule>();
  /** udo id -> change/undo audit row (mock mirror of extrovert_rule_undo_log). */
  private ruleAudit = new Map<string, RuleAuditEntry>();
  /** human_email -> mock self-signup state (in-memory OTP). */
  private signups = new Map<string, { customerId: string; agentId: string; address: string; otp: string; verified: boolean }>();
  /** "<scope>:<client_id>" -> the created resource id, mirroring the server's
   *  idempotency replay (a repeat with the same key returns the first result). */
  private idempotency = new Map<string, string>();
  private readonly agentId = "agt_demo7";
  /**
   * The ceiling tier of the session's key (redesign §3.1). Default `project`
   * (legacy bare `pk_agent_` behavior). Drives the bare-vs-wildcard list ceiling:
   * an `org` key must pick a breadth (`breadth_required`); a non-org key cannot use
   * the org wildcard (`forbidden_scope`). Mirrors the live choke-point so the
   * isolation contract is exercised offline.
   */
  private readonly keyTier: KeyTier;
  /**
   * The org's review policy, mirrored offline so the mock enforces the SAME tree
   * the server does.
   *
   * The default is `require_review` - deliberately, and matching the column
   * default every real account gets. A mock that defaulted to `allow_direct` would
   * teach every offline agent that a bare send just sends, which is precisely the
   * lie that let the wire bug live for months: the mock passed while the real API
   * refused. Override it with `EXTROVERT_MOCK_REVIEW_POLICY=allow_direct` when a
   * test needs a delivered message rather than a queued review.
   */
  private readonly reviewPolicy: ReviewPolicy;
  /**
   * The `front_run_next` nudge keys already enqueued, so N identical retries
   * against a terminal review collapse to ONE row (the server dedupes on a
   * deterministic key over reason + review + terminal state + parent revision).
   */
  private frontRunKeys = new Set<string>();

  constructor(opts: { keyTier?: KeyTier; reviewPolicy?: ReviewPolicy; administrativeCredential?: string } = {}) {
    this.administrativeFixtures = new AdministrativeFixtures(opts.administrativeCredential);
    this.keyTier = opts.keyTier ?? "project";
    this.reviewPolicy = opts.reviewPolicy ?? "require_review";
    this.seed();
  }

  /** The resolved review policy for this account (mock mirror of the inbox read). */
  effectiveReviewPolicy(): ReviewPolicy {
    return this.reviewPolicy;
  }

  /**
   * Persist a review and recompute the derived `closed` flag from its state. Every
   * mutation goes through here so `closed` can never drift from `state` - an agent
   * polling `closed` after a crash is trusting exactly this.
   */
  private commitReview(review: Review): Review {
    review.closed = reviewClosed(review.state);
    this.reviews.set(review.id, review);
    return review;
  }

  /**
   * The mock mirror of the submit-time D3 gate. A resolved-review send REQUIRES an
   * intent; a bare send/reply/forward has none by construction, so under anything
   * but an explicitly-asserted direct mode on an `allow_direct` account it is
   * refused - nothing sent, nothing queued.
   */
  private resolvedModeIsReview(mode: "review" | "direct"): boolean {
    return !(this.reviewPolicy === "allow_direct" && mode === "direct");
  }

  /**
   * The SUBMIT-TIME pre-flight: contact lists and list-unsubscribe suppression,
   * run against the resolved recipient set BEFORE the intent gate.
   *
   * The order matters and mirrors the server exactly. A blocked or suppressed
   * recipient is a fact about the message that no amount of intent will fix, so
   * answering `intent_required` first would send the agent off to add an intent
   * and retry straight into the same wall. Running it before the review is created
   * also means no human is ever handed a draft that could never have been sent.
   */
  private preflight(fromAddress: string, recipients: string[]): void {
    this.enforceSendPolicy(fromAddress, recipients);
    this.enforceSuppression(recipients);
  }

  /**
   * Reject a BARE send/reply/forward under a policy that requires review. The
   * error mirrors the server's 422 `intent_required` remediation, including the
   * `retry_with` example, so an offline agent recovers exactly the way it would
   * against the live API.
   */
  private requireDirectSendAllowed(verb: "send" | "reply" | "forward"): void {
    if (this.reviewPolicy === "allow_direct") return;
    throw new IntentRequiredError(
      `This inbox requires human review before sending (review policy: ${this.reviewPolicy}, from the account default; ` +
        "no per-inbox override). Nothing was sent and nothing was queued. Retry the SAME request with an `intent` " +
        'object added: {"intent":{"summary":"<one sentence: who you are writing to, what you want, and why now>"}}. ' +
        "That summary is the first thing the human reviewer reads; 8-200 characters. On success you get a queued " +
        "review id (rr_…); then monitor it with wait_for_review_event / list_review_events until you receive a `sent` " +
        "or `send_failed` event.",
      [
        {
          field: "intent.summary",
          code: "required",
          detail: "One sentence for the human reviewer: who / what / why. 8-200 chars.",
        },
        {
          field: "policy",
          code: "review_policy",
          detail: `${this.reviewPolicy} (source: account default; inbox override: none)`,
        },
        {
          field: "retry_with",
          code: "example",
          detail: '{"intent":{"summary":"Follow up with vp@acme.com on the Q3 pilot; 2 prior touches"}}',
        },
        { field: "verb", code: verb, detail: "the request that was refused" },
      ],
    );
  }

  // ---- self-signup + auth (Slice E) -------------------------------------

  signUp(input: { human_email: string; username?: string }): SignUpResult {
    const email = input.human_email.trim().toLowerCase();
    const existing = this.signups.get(email);
    const customerId = existing?.customerId ?? nextId("cus");
    const agentId = existing?.agentId ?? nextId("agt");
    const address = existing?.address ?? `${validatedSharedLocalPart(input.username ?? "agent" + shortLabel())}@${FREE_SHARED_DOMAIN}`;
    // Stable offline code keeps the full signup → mailbox handoff executable in
    // examples and contract tests without ever weakening the live API's CSPRNG.
    const otp = "492013";
    if (this.incomingActivation) {
      if (existing) throw new Error("Activation already pending; use the existing key");
      this.pendingActivation = { agent_id: agentId, address, human_email: email, created_ms: Date.now(), expires_ms: Date.now() + 86400000, revision: 1, state: "pending" };
    }
    this.signups.set(email, { customerId, agentId, address, otp, verified: false });
    const keyPrefix = "pk_agent_" + nextId("").split("_")[1];
    return {
      customer_id: customerId,
      agent_id: agentId,
      agent_key: `${keyPrefix}_${Math.random().toString(36).slice(2)}`,
      key_prefix: keyPrefix,
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

  verify(otp: string): VerifyResult {
    for (const [, s] of this.signups) {
      if (!s.verified && (this.incomingActivation ? this.activationStatus().state === "proven" && this.pendingActivation?.agent_id === s.agentId : s.otp === otp.trim())) {
        s.verified = true;
        if (this.incomingActivation && this.pendingActivation) this.pendingActivation.state = "activated";
        const keyPrefix = "pk_agent_" + nextId("").split("_")[1];
        return {
          agent_id: s.agentId,
          agent_key: `${keyPrefix}_${Math.random().toString(36).slice(2)}`,
          key_prefix: keyPrefix,
          scopes: ["mailbox:create", "mailbox:read", "mailbox:send"],
          address: s.address,
          verified: true,
          message:
            "Verified. The inbox is ready; use read_messages, then get_message with a returned message id.",
          mailbox_quickstart: mailboxQuickstart(s.address),
        };
      }
    }
    throw new NotFoundError("verification code invalid or expired");
  }

  whoami(): WhoAmI {
    return {
      customer_id: "cus_pn_mock",
      org_id: MOCK_ORG_ID,
      project_id: MOCK_PROJECT_ID,
      agent_id: this.agentId,
      key_id: "pkey_mock",
      auth_method: "agent_key",
      key_tier: this.keyTier,
      inbox_scope: this.keyTier === "org" ? "organization_subtree" : this.keyTier === "inbox" ? "single_inbox" : "agent_owned",
      scopes: ["mailbox:create", "mailbox:read", "mailbox:send"],
    };
  }

  // ---- enrollment -------------------------------------------------------

  redeemEnrollment(token: string, agentHandle?: string): EnrollmentResult {
    const keyPrefix = "pk_agent_" + nextId("").split("_")[1];
    const result: EnrollmentResult = {
      agent_id: this.agentId,
      agent_key: `${keyPrefix}_${Math.random().toString(36).slice(2)}${Math.random()
        .toString(36)
        .slice(2)}`,
      scopes: ["mailbox:create", "mailbox:read", "mailbox:send"],
      org_id: MOCK_ORG_ID,
      project_id: MOCK_PROJECT_ID,
    };
    // token is validated server-side in production; offline we accept any.
    void token;
    void agentHandle;
    return result;
  }

  // ---- inboxes ----------------------------------------------------------

  createInbox(opts: {
    username?: string;
    domain?: string;
    displayName?: string;
    inboundWebhookUrl?: string;
    metadata?: InboxMetadataPatch;
    projectId?: string;
    clientId?: string;
  }): Inbox {
    // A project_id assertion must match the key's bound project (403 on mismatch),
    // mirroring the SDK mock + the real server.
    assertProjectMatch(opts.projectId);
    // Idempotency replay: a repeat with the same client id returns the first inbox.
    const idemKey = opts.clientId?.trim() ? `inbox.create:${opts.clientId.trim()}` : "";
    if (idemKey) {
      const existingId = this.idempotency.get(idemKey);
      const existing = existingId ? this.inboxes.get(existingId) : undefined;
      if (existing) return existing;
    }
    const domain = opts.domain ?? PAID_SHARED_DOMAIN;
    const normalizedDomain = domain.trim().toLowerCase();
    const isSharedDomain = normalizedDomain === PAID_SHARED_DOMAIN || normalizedDomain === FREE_SHARED_DOMAIN;
    const username = isSharedDomain
      ? validatedSharedLocalPart(opts.username ?? `agent${this.inboxes.size + 1}`)
      : (opts.username ?? `agent${this.inboxes.size + 1}`).toLowerCase();
    const inbox: Inbox = {
      object: "inbox",
      // Mint the canonical opaque inbox id with the LIVE prefix (`pmbx_…`,
      // Appendix A); the public contract is "treat it as opaque."
      id: nextId("pmbx"),
      org_id: MOCK_ORG_ID,
      project_id: MOCK_PROJECT_ID,
      address: `${username}@${domain}`,
      domain,
      onboarding_mode: "shared",
      status: "live",
      agent_id: this.agentId,
      created_at: new Date().toISOString(),
      sender_verified: true,
      daily_send_limit: DEFAULT_DAILY_SEND_LIMIT,
      direct_smtp_enabled: false,
      // Metadata is always an object on a read (`{}` when none is set); a create
      // patch drops any `null` values per the merge-null-clear semantics.
      metadata: applyMetadataPatch({}, opts.metadata),
    };
    if (opts.displayName) inbox.display_name = opts.displayName;
    if (opts.inboundWebhookUrl) inbox.webhook_url = opts.inboundWebhookUrl;
    this.inboxes.set(inbox.id, inbox);
    this.messages.set(inbox.id, []);
    if (idemKey) this.idempotency.set(idemKey, inbox.id);
    return inbox;
  }

  listInboxes(
    opts: { limit?: number; project?: string; wildcard?: boolean; domain?: string; cursor?: string } | number = {},
  ): Page<Inbox> {
    const o = typeof opts === "number" ? { limit: opts } : opts;
    const limit = o.limit ?? 20;
    // Enforce the same bare-vs-wildcard ceiling the live choke-point applies
    // (redesign §4.1), so the isolation contract is exercised offline.
    const projectSegment = o.wildcard ? "-" : o.project;
    if (projectSegment === undefined) {
      // Bare list. An org key must pick a breadth; project/inbox keys default to
      // their (implicit) project - exactly today's behavior.
      if (this.keyTier === "org") {
        throw new BreadthRequiredError(
          "An org-tier key must pick a list breadth: pass a project id or wildcard=true (the org subtree).",
        );
      }
    } else if (projectSegment === "-") {
      // The org wildcard is reserved for org keys (a non-org key is 403).
      if (this.keyTier !== "org") {
        throw new ForbiddenError(
          "Only an org-tier key may list the org subtree (/v1/projects/-/inboxes).",
        );
      }
    } else if (projectSegment !== MOCK_PROJECT_ID) {
      // A concrete project outside the key's ceiling is a 404 (no existence leak).
      throw new NotFoundError(`project "${projectSegment}" is outside this key's ceiling.`);
    }
    const matching = [...this.inboxes.values()]
      .filter((inbox) => !o.domain || inbox.address.split("@")[1]?.toLowerCase() === o.domain.trim().toLowerCase())
      .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
    const offset = o.cursor ? matching.findIndex((inbox) => inbox.id === o.cursor) + 1 : 0;
    if (o.cursor && offset === 0) throw new Error("Invalid inbox cursor");
    const items = matching.slice(offset, offset + limit);
    const has_more = offset + items.length < matching.length;
    return { items, total: matching.length, has_more, ...(has_more ? { next_cursor: items.at(-1)!.id } : {}) };
  }

  getInbox(idOrAddress: string): Inbox | undefined {
    const inbox = this.resolveInbox(idOrAddress);
    if (!inbox) return undefined;
    // Only the SINGLE-inbox read carries the policy - the list path omits it
    // because the value is identical for every inbox in the org.
    return { ...inbox, effective_review_policy: this.reviewPolicy };
  }

  /** Update an inbox's settings in place (mirrors PATCH /v1/inboxes/{inbox_id}). */
  updateInbox(
    idOrAddress: string,
    opts: {
      displayName?: string;
      inboundWebhookUrl?: string;
      dailySendLimit?: number;
      metadata?: InboxMetadataPatch | null;
      projectId?: string;
    },
  ): Inbox | undefined {
    // A project_id assertion must match the key's bound project (403 on mismatch),
    // mirroring the SDK mock + the real server.
    assertProjectMatch(opts.projectId);
    const inbox = this.resolveInbox(idOrAddress);
    if (!inbox) return undefined;
    if (opts.displayName !== undefined) {
      inbox.display_name = opts.displayName || undefined;
    }
    if (opts.inboundWebhookUrl !== undefined) {
      inbox.webhook_url = opts.inboundWebhookUrl || undefined;
    }
    if (opts.dailySendLimit !== undefined) {
      if (
        !Number.isInteger(opts.dailySendLimit) ||
        opts.dailySendLimit < 1 ||
        opts.dailySendLimit > 10_000
      ) {
        throw new Error("daily_send_limit must be an integer from 1 through 10000");
      }
      inbox.daily_send_limit = opts.dailySendLimit;
    }
    if (opts.metadata !== undefined) {
      // Shallow merge: object merges (null value deletes a key); top-level null
      // clears all. Omitting `metadata` (handled above) leaves it unchanged.
      inbox.metadata = applyMetadataPatch(inbox.metadata ?? {}, opts.metadata);
    }
    return inbox;
  }

  getCredentials(idOrAddress: string): MailboxCredentials {
    const inbox = this.resolveInbox(idOrAddress);
    if (!inbox) throw new NotFoundError(`Inbox not found: ${idOrAddress}`);
    return {
      address: inbox.address,
      username: inbox.address,
      // Deterministic offline stand-in; the live API returns the real password.
      password: `fixture-pw-${inbox.id}`,
      imap: { host: "smtp.extrovert.dev", port: 993, security: "tls" },
      smtp: { host: "smtp.extrovert.dev", port: 587, security: "starttls" },
    };
  }

  deleteInbox(idOrAddress: string): { id: string; deleted: true } | undefined {
    const inbox = this.resolveInbox(idOrAddress);
    if (!inbox) return undefined;
    this.inboxes.delete(inbox.id);
    this.messages.delete(inbox.id);
    return { id: inbox.id, deleted: true };
  }

  // ---- messages ---------------------------------------------------------

  /**
   * A BARE send - no mode/intent/category_id. Policy-gated exactly like the live
   * endpoint: only an `allow_direct` account delivers here; under `require_review`
   * (the default) this is 422 `intent_required` with the remediation attached, and
   * nothing is sent or queued.
   */
  sendEmail(opts: {
    inbox: string;
    to: string[];
    subject: string;
    text: string;
    html?: string;
    cc?: string[];
    bcc?: string[];
    reply_to?: string;
    headers?: Record<string, string>;
    attachments?: AttachmentInput[];
  }): SendEmailResult {
    const inbox = this.requireInbox(opts.inbox);
    this.preflight(inbox.address, [...opts.to, ...(opts.cc ?? []), ...(opts.bcc ?? [])]);
    this.requireDirectSendAllowed("send");
    const msg = this.deliverSend(opts);
    return { status: "sent", message_id: msg.id, ...this.trackSubmission(msg), review_id: this.recordDirectReview("send", msg, opts.subject, opts.to) };
  }

  /**
   * The actual mock delivery, shared by the bare direct path and the review
   * loop's approve/auto-send dispatch. Policy is enforced by the CALLERS, never
   * here: an approved review has already passed the human and must deliver.
   */
  private deliverSend(opts: {
    inbox: string;
    to: string[];
    subject: string;
    text: string;
    html?: string;
    cc?: string[];
    bcc?: string[];
    reply_to?: string;
    headers?: Record<string, string>;
    attachments?: AttachmentInput[];
  }): Message {
    const inbox = this.requireInbox(opts.inbox);
    const recipients = [...opts.to, ...(opts.cc ?? []), ...(opts.bcc ?? [])];
    // Contact lists (Slice 3): reject a block-listed recipient, or any recipient
    // outside the allowlist when allowlist mode is active.
    this.enforceSendPolicy(inbox.address, recipients);
    // Suppression (list-unsubscribe): reject the WHOLE send if any recipient has an
    // active org-scope opt-out, naming exactly the suppressed addresses to drop.
    this.enforceSuppression(recipients);
    const msg = this.appendMessage(inbox.id, {
      direction: "outbound",
      fromName: inbox.display_name,
      fromEmail: inbox.address,
      to: opts.to,
      cc: opts.cc,
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
      threadId: nextId("thr"),
      ageMinutes: 0,
      attachments: opts.attachments,
    });
    // Offline affordance: queue a believable inbound reply so wait_for_email
    // and read_messages return something coherent in the demo flow.
    this.queueAutoReply(inbox, msg);
    return msg;
  }

  /**
   * Thread-aware reply (mock). Resolves the parent by message_id or the latest
   * message in thread_id, derives recipients/subject server-side, and returns the
   * canonical `{message_id, thread_id}` - matching the real API contract.
   */
  replyEmail(opts: {
    inbox: string;
    threadId?: string;
    messageId?: string;
    expectedLastMessageId?: string;
    text?: string;
    html?: string;
    cc?: string[];
    bcc?: string[];
    replyTo?: string;
    replyAll?: boolean;
    attachments?: AttachmentInput[];
  }): SendResult {
    this.requireInbox(opts.inbox);
    this.requireDirectSendAllowed("reply");
    return this.deliverReply(opts);
  }

  /** The mock reply delivery, shared by the direct path and approval dispatch. */
  private deliverReply(opts: {
    inbox: string;
    threadId?: string;
    messageId?: string;
    expectedLastMessageId?: string;
    text?: string;
    html?: string;
    cc?: string[];
    bcc?: string[];
    replyTo?: string;
    replyAll?: boolean;
    attachments?: AttachmentInput[];
  }): SendResult {
    const inbox = this.requireInbox(opts.inbox);
    if (Boolean(opts.threadId) === Boolean(opts.messageId)) {
      throw new ExtrovertApiError("provide exactly one of thread_id or message_id", 400, "invalid_argument");
    }
    const all = this.messages.get(inbox.id) ?? [];
    let parent: Message | undefined;
    let threadId = opts.threadId;
    if (opts.messageId) {
      parent = all.find((m) => m.id === opts.messageId);
      if (!parent) throw new NotFoundError(`Message not found: ${opts.messageId}`);
      threadId = parent.thread_id;
    } else if (opts.threadId) {
      parent = all.filter((m) => m.thread_id === opts.threadId).at(-1);
    } else {
      throw new NotFoundError("reply requires thread_id or message_id");
    }
    if (opts.threadId && opts.expectedLastMessageId && parent?.id !== opts.expectedLastMessageId) {
      throw new ExtrovertApiError(
        `thread advanced; latest message is ${parent?.id ?? "unknown"}`,
        409,
        "conflict",
      );
    }
    const to: string[] = [];
    if (parent) {
      if (parent.from.email.toLowerCase() === inbox.address.toLowerCase()) {
        to.push(...parent.to.map(({ email }) => email).filter((email) => email.toLowerCase() !== inbox.address.toLowerCase()));
      } else {
        to.push(...(parent.reply_to?.length ? parent.reply_to : [parent.from]).map(({ email }) => email));
      }
      if (opts.replyAll) for (const a of parent.to) if (a.email !== inbox.address) to.push(a.email);
    }
    const msg = this.appendMessage(inbox.id, {
      direction: "outbound",
      fromName: inbox.display_name,
      fromEmail: inbox.address,
      to: to.length ? to : ["reply@example.com"],
      cc: opts.cc,
      subject: parent ? reSubject(parent.subject) : "Re:",
      text: opts.text ?? "",
      html: opts.html,
      threadId: threadId ?? nextId("thr"),
      ageMinutes: 0,
      attachments: opts.attachments,
    });
    return { message_id: msg.id, thread_id: msg.thread_id, ...this.trackSubmission(msg) };
  }

  /**
   * Forward an existing message to new recipients (mock). Policy-gated like send
   * and reply: a forward quotes an entire received thread to arbitrary NEW
   * recipients, so leaving it ungated would make it the documented bypass.
   */
  forwardEmail(opts: {
    inbox: string;
    messageId: string;
    to: string[];
    cc?: string[];
    bcc?: string[];
    text?: string;
    html?: string;
  }): SendResult {
    const inbox = this.requireInbox(opts.inbox);
    this.preflight(inbox.address, [...opts.to, ...(opts.cc ?? []), ...(opts.bcc ?? [])]);
    this.requireDirectSendAllowed("forward");
    return this.deliverForward(opts);
  }

  /** The mock forward delivery, shared by the direct path and approval dispatch. */
  private deliverForward(opts: {
    inbox: string;
    messageId: string;
    to: string[];
    cc?: string[];
    bcc?: string[];
    text?: string;
    html?: string;
  }): SendResult {
    const inbox = this.requireInbox(opts.inbox);
    const parent = (this.messages.get(inbox.id) ?? []).find((m) => m.id === opts.messageId);
    if (!parent) throw new NotFoundError(`Message not found: ${opts.messageId}`);
    const msg = this.appendMessage(inbox.id, {
      direction: "outbound",
      fromName: inbox.display_name,
      fromEmail: inbox.address,
      to: opts.to,
      cc: opts.cc,
      subject: fwdSubject(parent.subject),
      text: forwardBody(opts.text, parent),
      threadId: parent.thread_id,
      ageMinutes: 0,
    });
    return { message_id: msg.id, thread_id: msg.thread_id, ...this.trackSubmission(msg) };
  }

  // ---- Review Loop (HITL) -----------------------------------------------

  /**
   * Submit a new message for review (mock). Mirrors the server's deterministic
   * routing: a `direct` mode is sent immediately (`kind:"sent"`); otherwise the
   * message is parked in `needs_review` (`kind:"queued_for_review"`). Intent is
   * required when the resolved mode is review (D3).
   */
  submitForReview(input: SubmitForReviewInput): SubmitForReviewResult {
    const inbox = this.requireInbox(input.inbox);
    // The POLICY resolves the mode, not the caller: an asserted `direct` under
    // require_review is downgraded to review, which is what makes the policy
    // binding rather than advisory.
    const asserted = input.mode === "direct" ? "direct" : "review";
    // Pre-flight BEFORE the intent gate - see preflight()'s note on the ordering.
    this.preflight(inbox.address, [...input.to, ...(input.cc ?? []), ...(input.bcc ?? [])]);
    const isReview = this.resolvedModeIsReview(asserted);
    if (isReview && !input.intent?.summary?.trim()) {
      throw new IntentRequiredError("intent summary is required when the resolved mode is review", [
        {
          field: "intent.summary",
          code: "required",
          detail: "One sentence for the human reviewer: who / what / why. 8-200 chars.",
        },
        {
          field: "policy",
          code: "review_policy",
          detail: `${this.reviewPolicy} (source: account default; inbox override: none)`,
        },
      ]);
    }
    if (!isReview) {
      const sent = this.deliverSend({
        inbox: input.inbox,
        to: input.to,
        subject: input.subject ?? "",
        text: input.text,
        html: input.html,
        cc: input.cc,
        bcc: input.bcc,
        reply_to: input.reply_to,
        headers: input.headers,
        attachments: input.attachments,
      });
      const reviewId = this.recordDirectReview("send", sent, input.subject ?? "", input.to);
      return { kind: "sent", message: { id: sent.id, thread_id: sent.thread_id }, review: { id: reviewId }, ...this.trackSubmission(sent) };
    }
    const review = this.createReviewRecord({
      kind: "send",
      fromAddress: inbox.address,
      subject: input.subject ?? "",
      text: input.text,
      html: input.html,
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      intent: input.intent,
      categoryId: input.category_id,
    });
    return { kind: "queued_for_review", review: { id: review.id, state: review.state, effective_mode: review.effective_mode } };
  }

  /** Submit an in-thread reply for review (mock). Same routing as submitForReview. */
  submitReplyForReview(input: SubmitReplyForReviewInput): SubmitForReviewResult {
    const inbox = this.requireInbox(input.inbox);
    const asserted = input.mode === "direct" ? "direct" : "review";
    const isReview = this.resolvedModeIsReview(asserted);
    if (isReview && !input.intent?.summary?.trim()) {
      throw new IntentRequiredError("intent summary is required when the resolved mode is review");
    }
    if (!isReview) {
      const res = this.deliverReply({
        inbox: input.inbox,
        threadId: input.thread_id,
        messageId: input.message_id,
        expectedLastMessageId: input.expected_last_message_id,
        text: input.text,
        html: input.html,
        cc: input.cc,
        bcc: input.bcc,
        replyTo: input.reply_to,
        replyAll: input.reply_all,
        attachments: input.attachments,
      });
      return { kind: "sent", message: { id: res.message_id, thread_id: res.thread_id }, submission_id: res.submission_id, sent_message_id: res.sent_message_id, sent_copy_status: res.sent_copy_status, transport: res.transport };
    }
    // The reply's envelope is materialized AT SUBMIT - subject and recipients are
    // derived here, not at approval - so the human reviews a message that actually
    // has a subject line and recipients. A queued reply used to store neither.
    const parent = this.resolveReplyParent(inbox.id, input.thread_id, input.message_id);
    if (input.thread_id && input.expected_last_message_id && parent?.id !== input.expected_last_message_id) {
      throw new ExtrovertApiError(
        `thread advanced; latest message is ${parent?.id ?? "unknown"}`,
        409,
        "conflict",
      );
    }
    const to = parent ? [parent.from.email] : [];
    if (parent && input.reply_all) {
      for (const participant of parent.to) {
        if (participant.email !== inbox.address && !to.includes(participant.email)) to.push(participant.email);
      }
    }
    const review = this.createReviewRecord({
      kind: "reply",
      fromAddress: inbox.address,
      subject: parent ? reSubject(parent.subject) : "Re:",
      text: input.text,
      html: input.html,
      to,
      cc: input.cc,
      intent: input.intent,
      categoryId: input.category_id,
      replyThreadId: parent?.thread_id ?? input.thread_id,
      replyParentId: parent?.id ?? input.message_id,
    });
    return { kind: "queued_for_review", review: { id: review.id, state: review.state, effective_mode: review.effective_mode } };
  }

  /**
   * Submit a forward for review (mock). Same routing as submitForReview, with the
   * forward's subject + quoted body MATERIALIZED here so the human reviews the
   * exact bytes that go out rather than a body re-derived from the live parent at
   * approval time (which would silently discard the reviewer's edit).
   */
  submitForwardForReview(input: SubmitForwardForReviewInput): SubmitForReviewResult {
    const inbox = this.requireInbox(input.inbox);
    this.preflight(inbox.address, [...input.to, ...(input.cc ?? []), ...(input.bcc ?? [])]);
    const asserted = input.mode === "direct" ? "direct" : "review";
    const isReview = this.resolvedModeIsReview(asserted);
    if (isReview && !input.intent?.summary?.trim()) {
      throw new IntentRequiredError("intent summary is required when the resolved mode is review");
    }
    if (!isReview) {
      const res = this.deliverForward({
        inbox: input.inbox,
        messageId: input.message_id,
        to: input.to,
        cc: input.cc,
        bcc: input.bcc,
        text: input.text,
        html: input.html,
      });
      return { kind: "sent", message: { id: res.message_id, thread_id: res.thread_id }, submission_id: res.submission_id, sent_message_id: res.sent_message_id, sent_copy_status: res.sent_copy_status, transport: res.transport };
    }
    const parent = (this.messages.get(inbox.id) ?? []).find((m) => m.id === input.message_id);
    if (!parent) throw new NotFoundError(`Message not found: ${input.message_id}`);
    const review = this.createReviewRecord({
      kind: "forward",
      fromAddress: inbox.address,
      subject: fwdSubject(parent.subject),
      text: forwardBody(input.text, parent),
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      intent: input.intent,
      categoryId: input.category_id,
      // A forward is NOT threaded to its parent - the new recipients were never in
      // that conversation - but the delivered forward still answers with the
      // parent's thread id, matching the direct forward path.
      replyThreadId: parent.thread_id,
    });
    return { kind: "queued_for_review", review: { id: review.id, state: review.state, effective_mode: review.effective_mode } };
  }

  /** Resolve a reply's parent by message id, else the latest message in a thread. */
  private resolveReplyParent(inboxId: string, threadId?: string, messageId?: string): Message | undefined {
    if (Boolean(threadId) === Boolean(messageId)) {
      throw new ExtrovertApiError("provide exactly one of thread_id or message_id", 400, "invalid_argument");
    }
    const all = this.messages.get(inboxId) ?? [];
    if (messageId) {
      const parent = all.find((m) => m.id === messageId);
      if (!parent) throw new NotFoundError(`Message not found: ${messageId}`);
      return parent;
    }
    if (threadId) return all.filter((m) => m.thread_id === threadId).at(-1);
    throw new NotFoundError("reply requires thread_id or message_id");
  }

  /**
   * Record the review row that governed a DIRECT (policy-permitted) send, park it
   * in the terminal `auto_sent` state with `send_path: agent_direct`, and emit its
   * one terminal `sent` nudge.
   *
   * The direct path used to hand back no handle at all, which meant an agent that
   * crashed between the request and the response could never ask what became of
   * the message. Leaving the dominant path handle-less would have entrenched
   * exactly the crash-recovery hole the review loop exists to close.
   */
  private recordDirectReview(
    kind: "send" | "reply" | "forward",
    msg: Message,
    subject: string,
    to: string[],
  ): string {
    const review = this.createReviewRecord({
      kind,
      fromAddress: msg.from.email,
      subject,
      text: msg.text ?? "",
      to,
      mode: "direct",
    });
    review.state = "auto_sent";
    review.version += 1;
    review.sent_message_id = msg.id;
    review.send_path = "agent_direct";
    review.sent_at = new Date().toISOString();
    review.updated_at = review.sent_at;
    this.commitReview(review);
    this.enqueueTerminalNudge(review, "sent");
    return review.id;
  }

  /**
   * Enqueue the ONE terminal nudge a finished review is allowed to produce.
   *
   * The invariant a drain loop is written against: every review that reaches
   * `sent`, `auto_sent`, `failed` or `cancelled` emits exactly one terminal nudge,
   * and it is the last and highest-`seq` nudge that review will ever produce. The
   * payload carries everything the agent needs to stop - including WHY a send
   * failed, which was previously stored and exposed on no surface at all.
   */
  private enqueueTerminalNudge(review: Review, reason: "sent" | "send_failed" | "cancelled"): void {
    if (reason === "cancelled") {
      this.enqueueReviewEvent(review.id, "cancelled", { state: "cancelled" });
      return;
    }
    if (reason === "send_failed") {
      this.enqueueReviewEvent(review.id, "send_failed", {
        state: "failed",
        error: review.send_error ?? "",
        from_state: "approved",
        // A failed review is NOT retryable: the row is absorbing. The only close-out
        // is cancel_review; the message itself must be composed and submitted anew.
        agent_retryable: false,
        next_action: "compose_and_submit_a_new_message",
      });
      return;
    }
    // ONE `sent` reason covers both delivery flavors: `payload.state` distinguishes
    // a human-reviewed `sent` from a `auto_sent`, and the agent's action - record
    // the message id, ack, stop polling - is identical either way.
    this.enqueueReviewEvent(review.id, "sent", {
      state: review.state,
      message_id: review.sent_message_id ?? "",
      send_path: review.send_path ?? "",
      decision: review.sent_body_text || review.sent_subject || review.diff_unified ? "edited" : "approved",
      sent_at: review.sent_at ?? "",
    });
  }

  /**
   * Best-effort `front_run_next` nudge for an agent that tried to mutate a review
   * somebody else already finished. It is enqueued OUTSIDE any transition (there
   * is none) and deduped on a deterministic key, so a retry loop hitting the same
   * 409 with the same parent_revision collapses N identical nudges to ONE row.
   */
  private enqueueFrontRunNudge(review: Review, parentRevision: number): void {
    const key = `front_run_next:${review.id}:${review.state}:${parentRevision}`;
    if (this.frontRunKeys.has(key)) return;
    this.frontRunKeys.add(key);
    this.enqueueReviewEvent(review.id, "front_run_next", {
      state: review.state,
      sent_message_id: review.sent_message_id ?? "",
      your_parent_revision: parentRevision,
      current_revision: review.revision,
      diff_available: !!review.diff_unified,
    });
  }

  /**
   * The mock mirror of the 409 taxonomy for a review-mutating verb. A terminal row
   * and a wrong-phase row are DIFFERENT errors on purpose: one must never be
   * retried, the other needs a different verb. Collapsing them to a single
   * "conflict" is what made a skill's one 409 handler retry a sent message forever.
   */
  private assertMutable(review: Review, verb: string, parentRevision: number): void {
    if (TERMINAL_REVIEW_STATES.includes(review.state)) {
      this.enqueueFrontRunNudge(review, parentRevision);
      throw new TerminalError(
        `${verb} is not legal on a ${review.state} review: it is terminal and nothing will ever succeed. ` +
          "STOP retrying - a front_run_next nudge is waiting for you.",
        review,
      );
    }
  }

  /** List review requests (mock), newest-first, with optional state/category/inbox filters. */
  listReviews(input: ListReviewsInput = {}): Page<Review> {
    let items = [...this.reviews.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (input.state !== undefined) {
      const states = Array.isArray(input.state) ? input.state : [input.state];
      items = items.filter((r) => states.includes(r.state));
    }
    if (input.category_id) items = items.filter((r) => r.category_id === input.category_id);
    if (input.inbox) {
      const inbox = input.inbox.toLowerCase();
      items = items.filter((r) => r.from_address.toLowerCase() === inbox);
    }
    return { items, total: items.length };
  }

  /** Get one review request (mock). */
  getReview(id: string): Review {
    const review = this.reviews.get(id);
    if (!review) throw new NotFoundError(`Review not found: ${id}`);
    return review;
  }

  /** Get a review's append-only thread turns (mock). */
  getReviewTurns(id: string): Page<ReviewTurn> {
    if (!this.reviews.has(id)) throw new NotFoundError(`Review not found: ${id}`);
    const items = this.reviewTurns.get(id) ?? [];
    return { items, total: items.length };
  }

  /**
   * Get the human's assembled feedback for a review (mock; M5): the diff + the
   * human comments/rejection turns + the decision (derived from state) + the rules
   * born from this review. Mirrors the server's $0-LLM assembly.
   */
  getReviewFeedback(id: string): ReviewFeedback {
    const review = this.reviews.get(id);
    if (!review) throw new NotFoundError(`Review not found: ${id}`);
    const turns = this.reviewTurns.get(id) ?? [];
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
    const newRules = [...this.rules.values()]
      .filter((r) => (r as Rule & { source_review_id?: string }).source_review_id === id)
      .map((r) => r.id);
    return {
      review_id: id,
      decision,
      diff_unified: review.diff_unified,
      diff_json: diffJson,
      comments,
      new_rules: newRules,
    };
  }

  /**
   * Post a chat turn on a review's thread (mock; M5): append an agent_question turn,
   * flip in_review -> chatting on the first turn, enqueue a feedback_added event.
   * Idempotent-key dedup is the transport's concern (replayed there); the mock just
   * appends one turn per call.
   */
  postReviewChat(input: PostReviewChatInput): Review {
    const review = this.reviews.get(input.id);
    if (!review) throw new NotFoundError(`Review not found: ${input.id}`);
    this.assertMutable(review, "post_review_chat", review.revision);
    // needs_review is legal for an AGENT actor: an agent asking a question does not
    // open the draft or assign a reviewer, so it stays in the queue. (A HUMAN
    // comment on a needs_review draft DOES open it - that asymmetry is the point.)
    if (!["needs_review", "in_review", "chatting"].includes(review.state)) {
      throw new WrongStateError(
        `post_review_chat is not legal while the draft is in '${review.state}'.`,
        review,
      );
    }
    const turns = this.reviewTurns.get(input.id) ?? [];
    turns.push({
      id: nextId("turn"),
      seq: turns.length + 1,
      turn_type: "agent_question",
      actor_kind: "agent",
      actor_id: this.agentId,
      body: input.text,
      created_at: new Date().toISOString(),
    });
    this.reviewTurns.set(input.id, turns);
    // in_review -> chatting only. A question posted on a needs_review draft leaves
    // it in needs_review: an agent must not be able to pull a draft out of the
    // human queue (or claim a reviewer) just by asking a question.
    if (review.state === "in_review") {
      review.state = "chatting";
      review.version += 1;
      review.updated_at = new Date().toISOString();
      this.commitReview(review);
    }
    this.enqueueReviewEvent(input.id, "feedback_added", { actor: "agent" });
    return review;
  }

  /**
   * Post a new agent draft under a parent_revision CAS (mock; M5). A mismatch is a
   * 409 STALE with NO mutation (D17); a clean CAS re-renders the draft in place
   * (revision++), returns to needs_review, and enqueues a redraft_requested event.
   */
  submitRevision(input: SubmitRevisionInput): Review {
    const review = this.reviews.get(input.id);
    if (!review) throw new NotFoundError(`Review not found: ${input.id}`);
    // TERMINAL first: nothing will ever move this row, so this must never be
    // retried - a distinct code from the stale CAS below, which MUST be.
    this.assertMutable(review, "submit_revision", input.parent_revision);
    // needs_review is a LEGAL source: the reviewer-reject, born-stale and
    // recheck_category paths all hand the composer a needs_review draft and nudge
    // it to redraft. A blanket self-edge ban used to deadlock exactly those loops.
    if (!["needs_review", "in_review", "chatting", "rejected", "stale", "stalled"].includes(review.state)) {
      throw new WrongStateError(
        `submit_revision is not legal while the draft is in '${review.state}'. Read the allowed_action hints and ` +
          "pick a legal verb - do NOT retry this one.",
        review,
      );
    }
    if (review.revision !== input.parent_revision) {
      // STALE, not wrong_state: the draft is still live and the retry IS the fix  -
      // re-read, re-apply your edit on top of theirs, resubmit with the new
      // parent_revision. Bounded (<=3): the human always wins (D17).
      throw new StaleError("parent_revision is stale; re-read the review and retry", review);
    }
    if (input.version !== undefined && review.version !== input.version) {
      throw new StaleError("version is stale; re-read the review and retry", review);
    }
    review.revision += 1;
    review.version += 1;
    review.state = "needs_review";
    if (input.subject !== undefined) review.proposed_subject = input.subject;
    // `text` is canonical; `body` is the deprecated alias. Both-but-different is a
    // caller bug the server rejects rather than guessing which bytes to relay.
    if (input.text !== undefined && input.body !== undefined && input.text !== input.body) {
      throw new ConflictingAliasError("`body` is a deprecated alias for `text`; send one or the other");
    }
    const newText = input.text ?? input.body;
    if (newText !== undefined) review.proposed_body_text = newText;
    if (input.html !== undefined) review.proposed_body_html = input.html;
    review.updated_at = new Date().toISOString();
    this.commitReview(review);
    const turns = this.reviewTurns.get(input.id) ?? [];
    turns.push({
      id: nextId("turn"),
      seq: turns.length + 1,
      turn_type: "agent_draft",
      actor_kind: "agent",
      actor_id: this.agentId,
      body: newText ?? review.proposed_body_text,
      revision: review.revision,
      created_at: new Date().toISOString(),
    });
    this.reviewTurns.set(input.id, turns);
    // Do not wake a composer for its own successful revision.
    return review;
  }

  /** Withdraw a pending review (mock; M5) to the terminal cancelled state. */
  cancelReview(id: string): Review {
    const review = this.reviews.get(id);
    if (!review) throw new NotFoundError(`Review not found: ${id}`);
    this.assertMutable(review, "cancel_review", review.revision);
    if (review.state === "approved") {
      throw new WrongStateError(
        "cancel_review is not legal while the draft is in 'approved': it has been approved and is being delivered. " +
          "Wait for a `sent` or `send_failed` review event.",
        review,
      );
    }
    review.state = "cancelled";
    review.version += 1;
    review.updated_at = new Date().toISOString();
    this.commitReview(review);
    this.enqueueTerminalNudge(review, "cancelled");
    return review;
  }

  /**
   * Re-stamp a draft's rules-version WITHOUT redrafting (mock; D19/§8 $0 escape valve).
   * Advances the version the draft is current against; no revision bump, no body change.
   * A terminal/approved draft 409s; against_version < 0 is invalid.
   */
  restampReview(input: RestampReviewInput): Review {
    const review = this.reviews.get(input.id);
    if (!review) throw new NotFoundError(`Review not found: ${input.id}`);
    this.assertMutable(review, "restamp_review", review.revision);
    if (!["needs_review", "in_review", "chatting", "stale"].includes(review.state)) {
      throw new WrongStateError(
        `restamp_review applies only to a draft still sitting in the human queue (got '${review.state}').`,
        review,
      );
    }
    if (input.against_version < 0) {
      throw new ConflictError("against_version must be >= 0");
    }
    review.version += 1;
    review.updated_at = new Date().toISOString();
    this.commitReview(review);
    return review;
  }

  // ---- BYO review-agent decision plane (M8 Slice B; D5/§9) ---------------
  //
  // The mock single-agent store acts as BOTH composer and reviewer, so it surfaces
  // the reviewer decision surface + the two circuit breakers without modeling the link
  // table. hop_count is tracked in a side map (the wire Review shape doesn't carry it);
  // the breakers use the schema defaults (max_hops=3, review_deadline_s=86400). A draft
  // is "reviewer-held" iff in_review/chatting (the queue states a reviewer can decide).

  /** Get the reviewer's decision context for a review (mock; §9). */
  getReviewDecisionContext(id: string): ReviewDecisionContext {
    const review = this.reviews.get(id);
    if (!review) throw new NotFoundError(`Review not found: ${id}`);
    const turns = this.reviewTurns.get(id) ?? [];
    const hopCount = this.reviewHopCounts.get(id) ?? 0;
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
  reviewerDecide(input: ReviewerDecideInput): ReviewerDecisionResult {
    const review = this.reviews.get(input.id);
    if (!review) throw new NotFoundError(`Review not found: ${input.id}`);
    if (review.state === "sent" || review.state === "auto_sent" || review.state === "cancelled") {
      throw new ConflictError(`cannot decide a terminal review (${review.state})`);
    }
    // needs_review is a legal source: a reviewer (or a human on the console) may
    // approve/reject straight from the QUEUE without opening the draft first  -
    // needs_review -> approved and needs_review -> rejected are both real edges.
    if (!["needs_review", "in_review", "chatting"].includes(review.state)) {
      throw new WrongStateError(
        `reviewer_decide is not legal while the draft is in '${review.state}'.`,
        review,
      );
    }
    if (review.revision !== input.revision) {
      throw new ConflictError("revision is stale; re-read the decision context and retry");
    }
    if (input.version !== undefined && review.version !== input.version) {
      throw new ConflictError("version is stale; re-read the decision context and retry");
    }

    const hopCount = this.reviewHopCounts.get(input.id) ?? 0;
    const deadlineMs = new Date(review.created_at).getTime() + 86400 * 1000;
    const breakerTripped = hopCount >= 3 || Date.now() >= deadlineMs;

    if (input.action === "approve" || input.action === "edit") {
      if (input.action === "edit") {
        if (input.subject !== undefined) review.sent_subject = input.subject;
        if (input.body !== undefined) review.sent_body_text = input.body;
      }
      review.version += 1;
      review.updated_at = new Date().toISOString();
      // The approval DISPATCH can fail at the mail boundary, and that failure is
      // the case a real agent most needs to hear about: before the terminal nudges
      // existed the composer was never told, because the delivery happened on the
      // REVIEWER's call, not its own.
      if (review.proposed_to.some((r) => r.toLowerCase() === SEEDED_SEND_FAILURE_RECIPIENT)) {
        review.state = "failed";
        review.send_error = MOCK_SEND_FAILURE_ERROR;
        this.commitReview(review);
        this.enqueueTerminalNudge(review, "send_failed");
        return { kind: "sent_to_human", review, sent: false, sent_to_human: false };
      }
      review.state = "sent";
      review.sent_message_id = nextId("msg");
      review.send_path = "reviewer_approved";
      review.sent_at = review.updated_at;
      this.commitReview(review);
      // The nudge targets the COMPOSER, not the reviewer: the reviewer already
      // knows what it decided; the composing agent is the one still waiting.
      this.enqueueTerminalNudge(review, "sent");
      return { kind: "sent", review, sent: true, message_id: review.sent_message_id, sent_to_human: false };
    }

    // reject / escalate → the human queue (needs_review). A reject within budget bumps
    // hop_count and goes back to the composer; a tripped breaker FORCES the human.
    review.state = "needs_review";
    review.version += 1;
    if (input.feedback !== undefined) review.decision_feedback = input.feedback;
    review.updated_at = new Date().toISOString();
    this.commitReview(review);

    let forcedByBreaker: string | undefined;
    if (input.action === "reject" && !breakerTripped) {
      this.reviewHopCounts.set(input.id, hopCount + 1);
    } else if (input.action === "reject" && breakerTripped) {
      forcedByBreaker = hopCount >= 3 ? "max_hops_reached" : "review_deadline_passed";
    }
    return { kind: "sent_to_human", review, sent: false, sent_to_human: true, forced_by_breaker: forcedByBreaker };
  }

  // ---- Category registry (Review Loop, D9/D10) --------------------------

  /**
   * Browse the registry (mock), newest-first, excluding merged/soft-deleted
   * (merged_into set). `match` is a pure lexical filter (every token must appear in
   * name+description) - NO LLM, mirroring the server.
   */
  private categoryUsage(category: Category): Category {
    const now = Date.now();
    const rows = [...this.reviews.values()].filter(r => r.category_id === category.id && Date.parse(r.created_at) <= now);
    const count = (days: number) => rows.filter(r => Date.parse(r.created_at) >= now - days * 86_400_000).length;
    return { ...category, message_count_7d: count(7), message_count_30d: count(30), message_count_90d: count(90),
      last_used_at: rows.map(r => r.created_at).sort().at(-1),
      pending_review_count: rows.filter(r => ["needs_review","in_review","chatting","rejected","stale","approved"].includes(r.state)).length };
  }

  listCategories(input?: string | ListCategoriesParams): Page<Category> {
    const params = typeof input === "string" ? { match: input } : input ?? {};
    let items = [...this.categories.values()]
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

  /** Get one category (mock); throws NotFound on an unknown id. */
  getCategory(id: string): Category {
    const cat = this.categories.get(id);
    if (!cat) throw new NotFoundError(`Category not found: ${id}`);
    return this.categoryUsage(cat);
  }

  /** Propose a category (mock): stands immediately, author_kind=agent. */
  proposeCategory(input: ProposeCategoryInput): Category {
    const name = input.name.trim();
    if ([...this.categories.values()].some(c => !c.merged_into && c.name.toLowerCase() === name.toLowerCase())) throw new ExtrovertApiError("Category name already exists; browse and reuse it.", 409, "conflict");
    if (!name) throw new IntentRequiredError("name is required");
    const now = new Date().toISOString();
    const cat: Category = {
      id: nextId("cat"),
      name,
      description: (input.description ?? "").trim(),
      scope: input.scope ?? "org_shared",
      state: "supervised",
      created_by_agent_id: this.agentId,
      author_kind: "agent",
      rule_high_water: 0,
      rules_version: 0,
      created_at: now,
      updated_at: now,
    };
    this.categories.set(cat.id, cat);
    return cat;
  }

  /** Rename / re-describe a category (mock) - metadata only (D10). */
  updateCategory(input: UpdateCategoryInput): Category {
    const cat = this.categories.get(input.id);
    if (!cat) throw new NotFoundError(`Category not found: ${input.id}`);
    if (input.name !== undefined) cat.name = input.name.trim();
    if (input.description !== undefined) cat.description = input.description.trim();
    cat.updated_at = new Date().toISOString();
    this.categories.set(cat.id, cat);
    return cat;
  }

  // ---- Graduation + risk dial (Review Loop, D16/D6/D17) - agent READ + PROPOSE --

  /** The mock account-default risk dial (mirrors the server defaults). */
  private accountDial() {
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
   * Read the effective risk dial (mock): the account default + every category with
   * an inherited (null override) effective dial. The mock category carries no risk-
   * dial overrides, so every category inherits - effective == account.
   */
  getRiskDial(): RiskDial {
    const account = this.accountDial();
    const categories = [...this.categories.values()]
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

  /** The next rung up the graduation ladder ("" if none). */
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
  getGraduationStatus(categoryId: string): GraduationStatus {
    const cat = this.categories.get(categoryId);
    if (!cat) throw new NotFoundError(`Category not found: ${categoryId}`);
    const dial = this.accountDial();
    const next = this.nextGraduationState(cat.state);
    const cleanApprovals = 0;
    const driftCount = 0;
    const approvalsMet = cleanApprovals >= dial.graduate_min_approvals;
    const ageMet = false; // a fresh mock category is younger than min_age_hours.
    const maturityMet = approvalsMet && ageMet;
    const canGraduate =
      next === "auto_notify" ? true : next === "auto_silent" ? maturityMet : false;
    return {
      category_id: cat.id,
      state: cat.state,
      next_state: next,
      never_graduate: false,
      clean_approval_count: cleanApprovals,
      graduate_min_approvals: dial.graduate_min_approvals,
      approvals_met: approvalsMet,
      age_hours: 0,
      graduate_min_age_hours: dial.graduate_min_age_hours,
      age_met: ageMet,
      maturity_gate_met: maturityMet,
      drift_count: driftCount,
      drift_demote_after: dial.drift_demote_after,
      can_graduate: canGraduate,
    };
  }

  /**
   * Propose graduating a category (mock): records nothing mutating and returns the
   * current gate status. It does NOT flip the bit (D16) - the category state is
   * unchanged.
   */
  proposeGraduation(categoryId: string, _evidence?: Record<string, unknown>): GraduationStatus {
    return this.getGraduationStatus(categoryId);
  }

  /**
   * Read the D19/§8 backlog-reconciliation status (mock): counts the QUEUED drafts in a
   * category that are stale vs current-enough against the current rules-version. The
   * mock has no per-draft composed_* stamps, so every queued draft reads current-enough;
   * the contract shape is exercised (the integer-compare is covered by the Go tests).
   */
  getBacklogStatus(categoryId: string): ScanBacklogStatus {
    const cat = this.categories.get(categoryId);
    if (!cat) throw new NotFoundError(`Category not found: ${categoryId}`);
    let queued = 0;
    for (const review of this.reviews.values()) {
      if (
        review.category_id === categoryId &&
        (review.state === "needs_review" || review.state === "in_review" || review.state === "chatting")
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
  getPacingState(categoryId: string): CategoryPacingState {
    const cat = this.categories.get(categoryId);
    if (!cat) throw new NotFoundError(`Category not found: ${categoryId}`);
    const lookaheadWindow = 3;
    const queuedReviews: { id: string }[] = [];
    for (const review of this.reviews.values()) {
      if (
        review.category_id === categoryId &&
        (review.state === "needs_review" || review.state === "in_review" || review.state === "chatting")
      ) {
        queuedReviews.push({ id: review.id });
      }
    }
    const items: PacingItem[] = queuedReviews.map((r, i) => ({
      review_id: r.id,
      state: i < lookaheadWindow ? "in_window_fresh" : "ahead",
    }));
    return {
      category_id: cat.id,
      cursor_advanced_count: 0,
      lookahead_window: lookaheadWindow,
      rework_batch_max: 10,
      nudge_min_interval_ms: 5000,
      queued: queuedReviews.length,
      in_window: Math.min(queuedReviews.length, lookaheadWindow),
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

  /**
   * Get the ORDERED active rule set (mock). Applies the §7 precedence ladder and the
   * category-before-general concatenation, mirroring the server (NO LLM).
   */
  getRules(input: GetRulesInput = {}): RuleSnapshot {
    const active = [...this.rules.values()].filter((r) => r.status === "active");
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
    if (!input.scope || input.scope === "general") {
      general = active.filter((r) => r.scope === "general").sort(byRank);
    }
    if (input.category_id && (!input.scope || input.scope === "category")) {
      category = active.filter((r) => r.scope === "category" && r.category_id === input.category_id).sort(byRank);
    }
    const items = [...category, ...general];
    return {
      items,
      total: items.length,
      house_style_version: 1,
      category_rules_version: input.category_id ? 1 : 0,
      rule_high_water: input.category_id ? 1 : 0,
      composition_token: input.scope ? undefined : `cmp_fixture_${input.category_id ?? "general"}`,
      composition_token_expires_at: input.scope ? undefined : new Date(Date.now() + 600_000).toISOString(),
    };
  }

  /** Save / edit a rule (mock) - append-only by supersession (D11). */
  private learnedRules = new Map<string, { fingerprint: string; result: LearnedReviewRule }>();
  learnReviewRule(id: string, input: LearnReviewRuleRequest): LearnedReviewRule {
    this.getReview(id);
    const fingerprint = JSON.stringify({ id, input });
    const prior = this.learnedRules.get(input.client_id);
    if (prior) { if (prior.fingerprint !== fingerprint) throw new ConflictError("learning retry identity changed"); return structuredClone(prior.result); }
    const turn = this.getReviewTurns(id).items.find(t => t.id === input.source_turn_id);
    if (!turn || turn.actor_kind !== "human" || !turn.actor_id) throw new ForbiddenError("learning requires authenticated human feedback");
    const rule = this.saveRule({ ...input, scope: input.target === "category" ? "category" : "general", source_review_id: id, source_turn_id: turn.id });
    rule.rule_layer = input.target === "org_house" ? "org" : "project";
    if (input.target === "org_house") delete rule.project_id;
    rule.source_review_id = id;
    rule.source_turn_id = turn.id;
    const audit = [...this.ruleAudit.values()].find(entry => entry.entity_id === rule.id)!;
    audit.after_json = ruleSnapshotJSON(rule);
    const result: LearnedReviewRule = { rule, source_review_id: id, source_turn_id: turn.id, human_id: turn.actor_id, audit_id: audit.id, propagation: "queued" };
    this.learnedRules.set(input.client_id, { fingerprint, result: structuredClone(result) });
    return result;
  }

  saveRule(input: SaveRuleInput): Rule {
    const text = input.rule_text.trim();
    if (!text) throw new IntentRequiredError("rule_text is required");
    const categoryId = (input.category_id ?? "").trim();
    const scope = input.scope ?? (categoryId ? "category" : "general");
    if (scope === "general" && categoryId) throw new ConflictError("scope=general forbids a category_id");
    if (scope === "category" && !categoryId) throw new ConflictError("scope=category requires a category_id");
    const now = new Date().toISOString();

    if (input.supersedes_id) {
      const prior = this.rules.get(input.supersedes_id);
      if (!prior) throw new NotFoundError(`Rule not found: ${input.supersedes_id}`);
      prior.status = "superseded";
      this.rules.set(prior.id, prior);
      const next: Rule = {
        ...prior,
        id: nextId("rule"),
        rev: prior.rev + 1,
        rule_text: text,
        kind: input.kind ?? prior.kind,
        priority: input.priority ?? prior.priority,
        status: "active",
        supersedes_id: prior.id,
        author_kind: "agent",
        created_at: now,
        updated_at: now,
      };
      this.rules.set(next.id, next);
      this.recordRuleAudit("supersede", next.id, ruleSnapshotJSON(prior), ruleSnapshotJSON(next));
      return next;
    }

    const rule: Rule = {
      id: nextId("rule"),
      // Agent-plane saves are ALWAYS project-layer, bound to the key's project;
      // creating org-layer/house-style rules is console/admin-only in v1.
      rule_layer: "project",
      org_id: MOCK_ORG_ID,
      project_id: MOCK_PROJECT_ID,
      lineage_id: nextId("rln"),
      rev: 1,
      scope,
      category_id: scope === "category" ? categoryId : undefined,
      scope_agent_id: input.scope_agent_id || undefined,
      rule_text: text,
      kind: input.kind ?? "soft",
      priority: input.priority ?? 0,
      status: "active",
      author_kind: "agent",
      created_at: now,
      updated_at: now,
    };
    this.rules.set(rule.id, rule);
    this.recordRuleAudit("create", rule.id, "{}", ruleSnapshotJSON(rule));
    return rule;
  }

  /** Promote a rule between the category and general layers (mock, via supersession). */
  promoteRule(id: string, toScope: "general" | "category"): Rule {
    const prior = this.rules.get(id);
    if (!prior) throw new NotFoundError(`Rule not found: ${id}`);
    if (prior.scope === toScope) return prior;
    if (toScope === "category" && !prior.category_id) throw new ConflictError("promote to category needs a category");
    prior.status = "superseded";
    this.rules.set(prior.id, prior);
    const now = new Date().toISOString();
    const next: Rule = {
      ...prior,
      id: nextId("rule"),
      lineage_id: nextId("rln"),
      rev: 1,
      scope: toScope,
      category_id: toScope === "category" ? prior.category_id : undefined,
      status: "active",
      supersedes_id: prior.id,
      author_kind: "agent",
      created_at: now,
      updated_at: now,
    };
    this.rules.set(next.id, next);
    this.recordRuleAudit("supersede", next.id, ruleSnapshotJSON(prior), ruleSnapshotJSON(next));
    return next;
  }

  /** Retire a rule (mock) - soft delete; history survives. */
  retireRule(id: string): Rule {
    const rule = this.rules.get(id);
    if (!rule) throw new NotFoundError(`Rule not found: ${id}`);
    if (rule.status === "retired") return rule;
    rule.status = "retired";
    rule.updated_at = new Date().toISOString();
    this.rules.set(rule.id, rule);
    this.recordRuleAudit("retire", rule.id, ruleSnapshotJSON(rule), ruleSnapshotJSON(rule));
    return rule;
  }

  /** Read the rule/category change audit log (mock). */
  getRuleAudit(input: GetRuleAuditInput = {}): Page<RuleAuditEntry> {
    let items = [...this.ruleAudit.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (input.entity_kind) items = items.filter((e) => e.entity_kind === input.entity_kind);
    if (input.entity_id) items = items.filter((e) => e.entity_id === input.entity_id);
    return { items, total: items.length };
  }

  /** Undo a rule change (mock) - restore the prior version; idempotent (re-undo 409). */
  undoRuleChange(udoId: string): Rule {
    const entry = this.ruleAudit.get(udoId);
    if (!entry) throw new NotFoundError(`Audit row not found: ${udoId}`);
    if (entry.entity_kind !== "rule") throw new ConflictError("only rule entities are restorable here");
    if (entry.undone) throw new ConflictError("already undone");
    const head = this.rules.get(entry.entity_id);
    if (!head) throw new NotFoundError(`Rule head not found: ${entry.entity_id}`);
    entry.undone = true;
    this.ruleAudit.set(entry.id, entry);
    const before = JSON.parse(entry.before_json ?? "{}") as Partial<Rule>;
    head.status = "superseded";
    this.rules.set(head.id, head);
    const now = new Date().toISOString();
    const restored: Rule = {
      ...head,
      id: nextId("rule"),
      rev: head.rev + 1,
      rule_text: before.rule_text ?? head.rule_text,
      status: before.rule_text ? "active" : "retired",
      supersedes_id: head.id,
      created_at: now,
      updated_at: now,
    };
    this.rules.set(restored.id, restored);
    this.recordRuleAudit("restore", restored.id, ruleSnapshotJSON(head), ruleSnapshotJSON(restored));
    return restored;
  }

  /** recordRuleAudit appends one change/undo audit row (mock). */
  private recordRuleAudit(action: RuleAuditEntry["action"], entityId: string, before: string, after: string): void {
    const entry: RuleAuditEntry = {
      id: nextId("udo"),
      entity_kind: "rule",
      entity_id: entityId,
      action,
      actor_kind: "agent",
      actor_id: `agent:${this.agentId}`,
      before_json: before,
      after_json: after,
      undone: false,
      created_at: new Date().toISOString(),
    };
    this.ruleAudit.set(entry.id, entry);
  }

  /**
   * enqueueReviewEvent appends a durable nudge for a review with the next
   * per-review monotonic seq (mock mirror of the server's enqueue-on-transition).
   * Used by the seed + (in a fuller mock) by transition handlers.
   */
  private enqueueReviewEvent(reviewId: string, reason: ReviewEvent["reason"], payload?: Record<string, unknown>): ReviewEvent {
    const list = this.reviewEvents.get(reviewId) ?? [];
    const last = list[list.length - 1];
    const seqNo = last ? last.seq + 1 : 1;
    const review = this.reviews.get(reviewId);
    const ev: ReviewEvent = {
      seq: seqNo,
      id: nextId("ndg"),
      reason,
      review_id: reviewId,
      category_id: review?.category_id,
      payload,
      created_at: new Date().toISOString(),
    };
    list.push(ev);
    this.reviewEvents.set(reviewId, list);
    return ev;
  }

  /** Drain the next un-acked review events (mock), FIFO per review + cursors. */
  listReviewEvents(input: ListReviewEventsInput = {}): ReviewEventsResult {
    const want = input.review_id?.trim();
    const events: ReviewEvent[] = [];
    const cursors: { review_id: string; last_acked_seq: number }[] = [];
    const touched = new Set<string>();
    for (const [reviewId, list] of this.reviewEvents) {
      if (want && reviewId !== want) continue;
      const acked = this.reviewEventCursors.get(reviewId) ?? 0;
      for (const ev of list) {
        if (ev.seq > acked) events.push(ev);
      }
      if (list.some((ev) => ev.seq > acked)) touched.add(reviewId);
    }
    // Stable FIFO order: by review id, then seq (best-effort across reviews).
    events.sort((a, b) => (a.review_id ?? "").localeCompare(b.review_id ?? "") || a.seq - b.seq);
    const limited = input.limit && input.limit > 0 ? events.slice(0, input.limit) : events;
    for (const reviewId of touched) {
      cursors.push({ review_id: reviewId, last_acked_seq: this.reviewEventCursors.get(reviewId) ?? 0 });
    }
    return { events: limited, cursors };
  }

  /**
   * Long-poll for a review event (mock). Offline there is nothing to wait FOR, so
   * it returns the immediate drain (empty when caught up) - matching the server's
   * "empty on timeout" contract.
   */
  waitForReviewEvent(input: WaitForReviewEventInput = {}): ReviewEventsResult {
    return this.listReviewEvents({ review_id: input.review_id, limit: input.limit });
  }

  /** Ack review events (mock): advance per-review cursors monotonically. */
  ackReviewEvent(input: AckReviewEventInput): { cursors: ReviewEventsResult["cursors"] } {
    const cursors: { review_id: string; last_acked_seq: number }[] = [];
    for (const a of input.acks ?? []) {
      const reviewId = a.review_id?.trim();
      if (!reviewId) continue;
      const prev = this.reviewEventCursors.get(reviewId) ?? 0;
      const next = Math.max(prev, a.through_seq); // monotonic (exactly-once effect)
      this.reviewEventCursors.set(reviewId, next);
      cursors.push({ review_id: reviewId, last_acked_seq: next });
    }
    return { cursors };
  }

  /**
   * createReviewRecord creates a needs_review row + the intent (agent_note) and
   * initial-draft (agent_draft) turns, mirroring the server's submit-time writes.
   */
  private createReviewRecord(opts: {
    kind: "send" | "reply" | "forward";
    fromAddress: string;
    subject: string;
    text: string;
    html?: string;
    to: string[];
    cc?: string[];
    bcc?: string[];
    intent?: { summary: string; meta?: Record<string, unknown> };
    categoryId?: string;
    /** The mode as RESOLVED by the policy (not as asserted by the caller). */
    mode?: "review" | "direct";
    /** Thread the delivered message should answer with (reply/forward). */
    replyThreadId?: string;
    /** Opaque parent id an approved reply threads to. */
    replyParentId?: string;
  }): Review {
    const id = nextId("rr");
    const now = new Date().toISOString();
    const review: Review = {
      id,
      state: "needs_review",
      mode: opts.mode ?? "review",
      effective_mode: opts.mode ?? "review",
      kind: opts.kind,
      from_address: opts.fromAddress,
      agent_id: this.agentId,
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
      created_at: now,
      updated_at: now,
    };
    if (opts.replyThreadId) this.reviewThreads.set(id, opts.replyThreadId);
    if (opts.replyParentId) this.reviewParents.set(id, opts.replyParentId);
    this.commitReview(review);
    const turns: ReviewTurn[] = [];
    if (opts.intent?.summary?.trim()) {
      turns.push({
        id: nextId("turn"),
        seq: turns.length + 1,
        turn_type: "agent_note",
        actor_kind: "agent",
        actor_id: this.agentId,
        body: opts.intent.summary,
        metadata: { kind: "intent" },
        created_at: now,
      });
    }
    turns.push({
      id: nextId("turn"),
      seq: turns.length + 1,
      turn_type: "agent_draft",
      actor_kind: "agent",
      actor_id: this.agentId,
      body: opts.text,
      revision: 0,
      created_at: now,
    });
    this.reviewTurns.set(id, turns);
    return review;
  }

  listMessages(opts: {
    inbox: string;
    limit?: number;
    offset?: number;
    unreadOnly?: boolean;
    from?: string;
    to?: string;
    subject?: string;
  }): Page<Message> {
    const inbox = this.requireInbox(opts.inbox);
    let items = [...(this.messages.get(inbox.id) ?? [])].sort((a, b) =>
      b.date.localeCompare(a.date),
    );
    if (opts.unreadOnly) items = items.filter((m) => !m.seen);
    if (opts.from) {
      const q = opts.from.toLowerCase();
      items = items.filter((m) => m.from.email.toLowerCase().includes(q));
    }
    if (opts.to) {
      const q = opts.to.toLowerCase();
      items = items.filter((m) => m.to.some((a) => a.email.toLowerCase().includes(q)));
    }
    if (opts.subject) {
      const q = opts.subject.toLowerCase();
      items = items.filter((m) => m.subject.toLowerCase().includes(q));
    }
    const total = items.length;
    const offset = opts.offset ?? 0;
    const page = items.slice(offset, offset + (opts.limit ?? 20));
    const result: Page<Message> = { items: page, total };
    if (offset + page.length < total) result.next_cursor = String(offset + page.length);
    return result;
  }

  /** Fetch a single message by id across all inboxes (mirrors GET /v1/messages/{id}). */
  getMessage(id: string): Message {
    for (const msgs of this.messages.values()) {
      const found = msgs.find((m) => m.id === id);
      if (found) return found;
    }
    throw new NotFoundError(`Message not found: ${id}`);
  }

  /** Toggle the \Seen flag for a message by id (mirrors PATCH .../messages/{id}). */
  markRead(id: string, read: boolean): Message {
    const msg = this.getMessage(id);
    msg.seen = read;
    return msg;
  }

  listThreads(opts: { inbox: string; limit?: number; cursor?: string }): Page<Thread> {
    const inbox = this.requireInbox(opts.inbox);
    const byThread = new Map<string, Message[]>();
    for (const m of this.messages.get(inbox.id) ?? []) {
      const arr = byThread.get(m.thread_id) ?? [];
      arr.push(m);
      byThread.set(m.thread_id, arr);
    }
    const threads: Thread[] = [...byThread.entries()].map(([id, msgs]) =>
      this.toThread(inbox.address, id, msgs, true),
    );
    threads.sort((a, b) => b.last_message_at.localeCompare(a.last_message_at));
    return this.paginateThreads(threads, opts);
  }

  searchThreads(opts: { inbox: string; query: string; limit?: number; cursor?: string }): Page<Thread> {
    const query = opts.query.trim().toLowerCase();
    const matches = this.listThreads({ inbox: opts.inbox, limit: Number.MAX_SAFE_INTEGER }).items.filter(
      (thread) =>
        thread.subject.toLowerCase().includes(query) ||
        thread.snippet.toLowerCase().includes(query) ||
        thread.participants.join(" ").toLowerCase().includes(query),
    );
    return this.paginateThreads(matches, opts);
  }

  private paginateThreads(
    threads: Thread[],
    opts: { limit?: number; cursor?: string },
  ): Page<Thread> {
    const parsed = opts.cursor === undefined ? 0 : Number(opts.cursor);
    const offset = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
    const page = threads.slice(offset, offset + (opts.limit ?? 20));
    const result: Page<Thread> = { items: page, total: threads.length };
    if (offset + page.length < threads.length) result.next_cursor = String(offset + page.length);
    return result;
  }

  /** Fetch one thread (with its messages, oldest-first) by id under an inbox. */
  getThread(idOrAddress: string, threadId: string): ThreadDetail {
    const inbox = this.requireInbox(idOrAddress);
    const msgs = (this.messages.get(inbox.id) ?? [])
      .filter((m) => m.thread_id === threadId)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (msgs.length === 0) throw new NotFoundError(`Thread not found: ${threadId}`);
    return { ...this.toThread(inbox.address, threadId, msgs), messages: msgs };
  }

  private trackSubmission(message: Message): SubmissionTracking {
    const tracking: SubmissionTracking = { submission_id: `sub_${message.id}`, sent_message_id: message.id,
      sent_copy_status: "stored", transport: { accepted: message.to.length + (message.cc?.length ?? 0) } };
    Object.assign(message, tracking);
    return tracking;
  }

  getSubmission(idOrAddress: string, submissionId: string): Submission {
    const inbox = this.requireInbox(idOrAddress);
    const message = (this.messages.get(inbox.id) ?? []).find((item) => item.submission_id === submissionId);
    if (!message) throw new NotFoundError(`Submission not found: ${submissionId}`);
    return { submission_id: submissionId, inbox: inbox.address, sent_message_id: message.id, sent_copy_status: "stored",
      transport: message.transport ?? {}, recipients: [...message.to, ...(message.cc ?? [])].map(({ email }) => ({ recipient: email, state: "accepted" })),
      created_at: message.date, updated_at: message.date };
  }

  /**
   * Delete a message by id (mirrors DELETE .../messages/{id}). The mock moves the
   * message to a Trash folder (soft delete) or removes it outright when expunge is
   * set or it already lives in Trash. Throws NotFoundError when absent.
   */
  deleteMessage(idOrAddress: string, id: string, expunge: boolean): DeleteResult {
    const inbox = this.requireInbox(idOrAddress);
    const msgs = this.messages.get(inbox.id) ?? [];
    const msg = msgs.find((m) => m.id === id);
    if (!msg) throw new NotFoundError(`Message not found: ${id}`);
    const hard = expunge || msg.folder === "Trash";
    if (hard) {
      this.messages.set(inbox.id, msgs.filter((m) => m.id !== id));
    } else {
      msg.folder = "Trash";
    }
    return { id, deleted: true, expunged: hard, count: 1 };
  }

  /**
   * Delete every message in a thread by id (mirrors DELETE .../threads/{id}).
   * Moves them to Trash (soft) or removes them (expunge / already in Trash).
   */
  deleteThread(idOrAddress: string, threadId: string, expunge: boolean): DeleteResult {
    const inbox = this.requireInbox(idOrAddress);
    const msgs = this.messages.get(inbox.id) ?? [];
    const inThread = msgs.filter((m) => m.thread_id === threadId);
    if (inThread.length === 0) throw new NotFoundError(`Thread not found: ${threadId}`);
    const hard = expunge;
    if (hard) {
      this.messages.set(inbox.id, msgs.filter((m) => m.thread_id !== threadId));
    } else {
      for (const m of inThread) m.folder = "Trash";
    }
    return { id: threadId, deleted: true, expunged: hard, count: inThread.length };
  }

  /**
   * Batch mark read/unread and/or move folder for a list of message ids under one
   * inbox (mirrors PATCH .../messages/batch). Ids not present in the inbox are
   * reported in `failed`; the rest in `updated`.
   */
  batchUpdateMessages(
    idOrAddress: string,
    ids: string[],
    read: boolean | undefined,
    folder: string | undefined,
  ): BatchUpdateResult {
    const inbox = this.requireInbox(idOrAddress);
    const msgs = this.messages.get(inbox.id) ?? [];
    const byId = new Map(msgs.map((m) => [m.id, m]));
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

  /** Build the canonical Thread wire shape (snippet, participant strings). */
  private toThread(inboxAddr: string, id: string, msgs: Message[], summary = false): Thread {
    const sorted = [...msgs].sort((a, b) => a.date.localeCompare(b.date));
    const last = sorted.at(-1)!;
    const participantMessages = summary ? [last] : sorted;
    const participants = dedupeAddresses(
      participantMessages.flatMap((m) => [m.from, ...m.to, ...(m.cc ?? []), ...(m.reply_to ?? [])]),
    ).map((a) =>
      a.name ? `${a.name} <${a.email}>` : a.email,
    );
    return {
      id,
      inbox_id: inboxAddr,
      subject: normalizeThreadSubject(sorted[0]?.subject ?? "(no subject)"),
      message_count: sorted.length,
      participants,
      last_message_at: last.date,
      snippet: (last.text ?? last.html ?? "").slice(0, 140),
      unread: !last.seen,
      last_message_has_attachments: (this.attachments.get(last.id)?.length ?? 0) > 0,
      last_message_id: last.id,
    };
  }

  search(opts: { query: string; inbox?: string; limit?: number }): Page<Message> {
    const q = opts.query.toLowerCase();
    const scope = opts.inbox ? [this.requireInbox(opts.inbox).id] : [...this.inboxes.keys()];
    const hits: Message[] = [];
    for (const inboxId of scope) {
      for (const m of this.messages.get(inboxId) ?? []) {
        if (
          m.subject.toLowerCase().includes(q) ||
          sourceMessageBody(m).toLowerCase().includes(q) ||
          m.from.email.toLowerCase().includes(q)
        ) {
          hits.push(m);
        }
      }
    }
    hits.sort((a, b) => b.date.localeCompare(a.date));
    return { items: hits.slice(0, opts.limit ?? 20), total: hits.length };
  }

  /**
   * Offline `wait_for_email`. Resolves as soon as a matching inbound message is
   * present. Because `sendEmail` queues an auto-reply ~1.2s out, the demo flow
   * resolves quickly; otherwise it resolves against an already-seeded OTP mail.
   */
  async waitForEmail(opts: {
    inbox: string;
    from?: string;
    subject?: string;
    regex?: string;
    linkHint?: string;
    timeoutMs: number;
    pollMs?: number;
  }): Promise<WaitForEmailResult> {
    const started = Date.now();
    const inbox = this.requireInbox(opts.inbox);
    const pollMs = opts.pollMs ?? 250;
    // Go regexp matching is case-sensitive. Support the documented leading
    // inline flag for the common explicit-insensitive case in offline fixtures.
    const re = opts.regex ? compileFixtureRegex(opts.regex) : undefined;

    const matches = (m: Message): boolean => {
      if (m.direction !== "inbound") return false;
      if (m.seen) return false;
      if (opts.from && !m.from.email.toLowerCase().includes(opts.from.toLowerCase())) return false;
      if (opts.subject && !m.subject.toLowerCase().includes(opts.subject.toLowerCase()))
        return false;
      if (re && !re.test(`${m.subject}\n${sourceMessageBody(m)}`)) return false;
      return true;
    };

    for (;;) {
      const candidate = (this.messages.get(inbox.id) ?? []).find(matches);
      if (candidate) {
        candidate.seen = true;
        const signals = extractSignals(sourceMessageBody(candidate), opts.linkHint);
        const result: WaitForEmailResult = {
          matched: true,
          message: candidate,
          waited_ms: Date.now() - started,
        };
        if (signals.otp_code) result.otp_code = signals.otp_code;
        if (signals.verification_link) result.verification_link = signals.verification_link;
        return result;
      }
      if (Date.now() - started >= opts.timeoutMs) {
        return { matched: false, waited_ms: Date.now() - started };
      }
      await delay(pollMs);
    }
  }

  // ---- internals --------------------------------------------------------

  private resolveInbox(idOrAddress: string): Inbox | undefined {
    if (this.inboxes.has(idOrAddress)) return this.inboxes.get(idOrAddress);
    const key = idOrAddress.toLowerCase();
    return [...this.inboxes.values()].find((i) => i.address.toLowerCase() === key);
  }

  private requireInbox(idOrAddress: string): Inbox {
    const inbox = this.resolveInbox(idOrAddress);
    if (!inbox) {
      throw new NotFoundError(`No inbox matches "${idOrAddress}". Create one with create_inbox.`);
    }
    return inbox;
  }

  private appendMessage(
    inboxId: string,
    opts: {
      direction: Message["direction"];
      fromName?: string;
      fromEmail: string;
      to: string[];
      cc?: string[];
      subject: string;
      text: string | null;
      html?: string | null;
      threadId: string;
      ageMinutes: number;
      attachments?: AttachmentInput[];
    },
  ): Message {
    const date = new Date(Date.now() - opts.ageMinutes * 60_000).toISOString();
    const inboxAddr = this.inboxes.get(inboxId)?.address ?? inboxId;
    const msg: Message = {
      id: nextId("msg"),
      thread_id: opts.threadId,
      inbox: inboxAddr,
      direction: opts.direction,
      from: opts.fromName ? { name: opts.fromName, email: opts.fromEmail } : { email: opts.fromEmail },
      to: opts.to.map((email) => ({ email })),
      subject: opts.subject,
      text: opts.text,
      html: opts.html ?? null,
      extracted_text: opts.text?.trim() || null,
      extracted_html: opts.html?.trim() || null,
      date,
      message_id: `<${nextId("mid")}@extrovertmail.com>`,
      seen: opts.direction === "outbound",
      folder: opts.direction === "inbound" ? "INBOX" : "Sent",
    };
    if (opts.cc) msg.cc = opts.cc.map((email) => ({ email }));
    const arr = this.messages.get(inboxId) ?? [];
    arr.push(msg);
    this.messages.set(inboxId, arr);
    if (opts.attachments && opts.attachments.length > 0) {
      this.attachments.set(
        msg.id,
        opts.attachments.map((a, i) => ({
          meta: {
            id: `att_${i + 1}_${msg.id}`,
            filename: a.filename,
            content_type: a.content_type || "application/octet-stream",
            size: base64ByteLength(a.content_base64),
          },
          content_base64: a.content_base64,
        })),
      );
    }
    return msg;
  }

  /** List a message's attachment metadata (mirrors the list endpoint). */
  listAttachments(messageId: string): Page<Attachment> {
    this.getMessage(messageId); // throws NotFoundError if absent
    const items = (this.attachments.get(messageId) ?? []).map((a) => a.meta);
    return { items, total: items.length };
  }

  /** Fetch one attachment's bytes + metadata (mirrors the download endpoint). */
  getAttachment(messageId: string, attachmentId: string): AttachmentDownload {
    const stored = (this.attachments.get(messageId) ?? []).find(
      (a) => a.meta.id === attachmentId,
    );
    if (!stored) throw new NotFoundError(`Attachment not found: ${attachmentId}`);
    return {
      filename: stored.meta.filename,
      content_type: stored.meta.content_type,
      content_base64: stored.content_base64,
    };
  }

  // ---- webhooks ---------------------------------------------------------

  /** Register a webhook; returns the row WITH the one-time signing secret. */
  registerWebhook(input: { url: string; events?: WebhookEvent[]; inbox?: string; clientId?: string }): Webhook {
    // Idempotency replay: a repeat with the same client id returns the first row.
    const idemKey = input.clientId?.trim() ? `webhook.create:${input.clientId.trim()}` : "";
    if (idemKey) {
      const existingId = this.idempotency.get(idemKey);
      const existing = existingId ? this.webhooks.get(existingId) : undefined;
      if (existing) return { ...existing };
    }
    const id = nextId("whk");
    const secret = `whsec_${shortLabel()}${Math.random().toString(36).slice(2, 14)}`;
    const webhook: Webhook = {
      id,
      url: input.url,
      events: input.events && input.events.length ? input.events : ["message.received"],
      inbox: input.inbox ?? null,
      agent_id: this.agentId,
      secret,
      secret_prefix: secret.slice(0, "whsec_".length + 6),
      active: true,
      created_at: new Date().toISOString(),
    };
    this.webhooks.set(id, webhook);
    if (idemKey) this.idempotency.set(idemKey, id);
    return { ...webhook };
  }

  /** List webhooks (secret redacted). */
  listWebhooks(params: ListWebhooksParams = {}): Page<Webhook> {
    const items = [...this.webhooks.values()].map((w) => redactWebhookSecret(w));
    const limit = params.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Invalid webhook page limit");
    if (params.cursor && !/^webhooks:\d+$/.test(params.cursor)) throw new Error("Invalid webhook cursor");
    const offset = params.cursor ? Number(params.cursor.slice(9)) : 0;
    const next = offset + limit < items.length ? `webhooks:${offset + limit}` : undefined;
    return { items: items.slice(offset, offset + limit), total: items.length, has_more: !!next, next_cursor: next };
  }

  /** Get one webhook (secret redacted). Throws NotFoundError when absent. */
  getWebhook(id: string): Webhook {
    const w = this.webhooks.get(id);
    if (!w) throw new NotFoundError(`Webhook not found: ${id}`);
    return redactWebhookSecret(w);
  }

  /**
   * Update a webhook in place (secret redacted in the response). Every field is
   * optional; an unset field leaves the stored value untouched (PATCH semantics).
   * Throws NotFoundError when absent.
   */
  updateWebhook(
    id: string,
    input: { url?: string; events?: WebhookEvent[]; inbox?: string; active?: boolean },
  ): Webhook {
    const w = this.webhooks.get(id);
    if (!w) throw new NotFoundError(`Webhook not found: ${id}`);
    if (input.url !== undefined) w.url = input.url;
    if (input.events !== undefined) {
      w.events = input.events.length ? input.events : ["message.received"];
    }
    if (input.inbox !== undefined) w.inbox = input.inbox === "" ? null : input.inbox;
    if (input.active !== undefined) w.active = input.active;
    this.webhooks.set(id, w);
    return redactWebhookSecret(w);
  }

  /** Delete a webhook. Throws NotFoundError when absent. */
  deleteWebhook(id: string): { id: string; deleted: true } {
    if (!this.webhooks.delete(id)) throw new NotFoundError(`Webhook not found: ${id}`);
    return { id, deleted: true };
  }

  // ---- contact allow/block lists (Slice 3) ------------------------------

  /** Add one allow/block entry scoped to an inbox. */
  addContactListEntry(
    inbox: string,
    input: { kind: ContactListKind; direction?: ContactListDirection; pattern?: string },
  ): ContactListEntry {
    this.requireInbox(inbox);
    const pattern = normalizeContactPattern(input.pattern ?? "");
    if (!pattern) throw new NotFoundError("pattern is required (address or domain)");
    const entry: ContactListEntry = {
      id: nextId("lst"),
      inbox: this.requireInbox(inbox).address,
      kind: input.kind,
      direction: input.direction ?? "send",
      pattern,
      created_at: new Date().toISOString(),
    };
    this.contactLists.set(entry.id, entry);
    return { ...entry };
  }

  /** List the entries governing an inbox (inbox-specific + account-wide). */
  listContactListEntries(inbox: string): Page<ContactListEntry> {
    const address = this.requireInbox(inbox).address;
    const items = [...this.contactLists.values()].filter(
      (e) => e.inbox === null || e.inbox === address,
    );
    return { items, total: items.length };
  }

  /** Delete a contact-list entry by id. Throws NotFoundError when absent. */
  deleteContactListEntry(_inbox: string, id: string): { id: string; deleted: true } {
    if (!this.contactLists.delete(id)) throw new NotFoundError(`Contact list entry not found: ${id}`);
    return { id, deleted: true };
  }

  // ---- domains (Slice 5) ------------------------------------------------

  /** Add a delegated domain and return only the customer-published nameservers. */
  onboardDomain(input: {
    domain: string;
    mode?: "ns_delegated";
    scope?: "org" | "project";
    project_id?: string;
  }): Domain {
    const name = input.domain.trim().toLowerCase();
    const mode = "ns_delegated";
    // A project_id assertion must match the key's bound project (403 on mismatch),
    // mirroring the SDK mock + the real server. `scope` is accepted offline (the
    // live API binds visibility to the key's project); the mock does not otherwise
    // model cross-project isolation.
    void input.scope;
    assertProjectMatch(input.project_id);
    const existing = this.domains.get(name);
    if (existing) return { ...existing };
    const domain: Domain = {
      id: nextId("dom"),
      domain: name,
      mode,
      verification_status: "verifying",
      dkim_status: "configured",
      shared: false,
      created_at: new Date().toISOString(),
      delegation_ns: domainDelegationNS(name),
      instruction: "Add the nameserver entries at your domain provider. We check automatically; use Recheck DNS for an immediate check.",
      readiness: {
        status: "waiting_for_dns", label: "Waiting for DNS", summary: "We have not confirmed your nameserver entries yet. Add them at your domain provider; we will finish setup automatically.",
        reason: "dns_entries_unconfirmed", action_required_by: "customer", next_action: "check_dns_entries",
        ready_for_inboxes: false, poll_after_seconds: 30,
        inboxes: { scope: "agent", total: 0, ready: 0, setting_up: 0, needs_attention: 0 },
      },
    };
    this.domains.set(name, domain);
    return { ...domain };
  }

  /** List onboarded domains (records omitted on the summary, mirroring the server). */
  listDomains(): Page<Domain> {
    const items = [...this.domains.values()].map((d) => domainSummary(d));
    return { items, total: items.length };
  }

  /** Get one domain's detail + the records to set, inline. Throws NotFoundError when absent. */
  getDomain(domain: string): Domain {
    const d = this.domains.get(domain.trim().toLowerCase());
    if (!d) throw new NotFoundError(`Domain not found: ${domain}`);
    return { ...d };
  }

  /** Trigger/refresh verification; returns the (re-read) detail. Throws when absent. */
  verifyDomain(domain: string): Domain {
    const d = this.domains.get(domain.trim().toLowerCase());
    if (!d) throw new NotFoundError(`Domain not found: ${domain}`);
    return { ...d };
  }

  /**
   * Offboard (remove) a domain. Throws NotFoundError when absent. Mirrors the live
   * API's async contract: it returns an accepted teardown job (there is no job
   * runner in-fixture, so the row is removed synchronously and a synthetic
   * succeeded job is reported).
   */
  offboardDomain(domain: string): DomainOffboard {
    const name = domain.trim().toLowerCase();
    if (!this.domains.delete(name)) throw new NotFoundError(`Domain not found: ${domain}`);
    const jobId = `job-offboard-${name}`;
    const ts = new Date().toISOString();
    this.jobs.set(jobId, {
      object: "job",
      id: jobId,
      type: "domain_offboard",
      status: "succeeded",
      created_at: ts,
      updated_at: ts,
      finished_at: ts,
    });
    return { domain: name, job_id: jobId, status: "succeeded", status_url: `/v1/jobs/${jobId}` };
  }

  /** Get one async job's poll status (mirrors `GET /v1/jobs/{job_id}`). Throws NotFoundError when absent. */
  getJob(jobId: string): Job {
    const job = this.jobs.get(jobId);
    if (!job) throw new NotFoundError(`Job not found: ${jobId}`);
    return { ...job };
  }

  // ---- commerce (quote/request/status; no approval mutation) ------------

  quoteDomain(domain: string): DomainQuote {
    const name = domain.trim().toLowerCase();
    return {
      object: "domain_quote",
      domain: name,
      available: !name.startsWith("unavailable."),
      currency: "usd",
      quote_cents: 2500,
      renewal_cents: 2500,
      premium: false,
      quote_expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      blockers: [],
    };
  }

  requestDomainPurchase(input: RequestDomainPurchaseInput): CommerceRequest {
    const idem = `domain_purchase:${input.idempotency_key.trim()}`;
    const replayId = this.commerceIdempotency.get(idem);
    if (replayId) return { ...this.requireCommerceRequest(replayId) };
    const quote = this.quoteDomain(input.domain);
    const ts = new Date().toISOString();
    const id = nextId("creq");
    const approvalUrl = `https://app.extrovert.dev/commerce/requests/${id}`;
    const request: CommerceRequest = {
      object: "commerce_request",
      id,
      kind: "domain_purchase",
      state: "awaiting_human_approval",
      domain: quote.domain,
      domain_scope: input.scope ?? "org",
      rationale: input.rationale,
      currency: quote.currency,
      quote_cents: quote.quote_cents,
      renewal_cents: quote.renewal_cents,
      quote_expires_at: quote.quote_expires_at,
      auto_renew: input.auto_renew ?? true,
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
      created_at: ts,
      updated_at: ts,
    };
    this.commerceRequests.set(id, request);
    this.commerceIdempotency.set(idem, id);
    return { ...request };
  }

  requestPlanChange(input: RequestPlanChangeInput): CommerceRequest {
    const idem = `plan_change:${input.idempotency_key.trim()}`;
    const replayId = this.commerceIdempotency.get(idem);
    if (replayId) return { ...this.requireCommerceRequest(replayId) };
    const ts = new Date().toISOString();
    const id = nextId("creq");
    const approvalUrl = `https://app.extrovert.dev/commerce/requests/${id}`;
    const request: CommerceRequest = {
      object: "commerce_request",
      id,
      kind: "plan_change",
      state: "awaiting_human_approval",
      target_plan: input.target_plan,
      current_plan: "developer",
      rationale: input.rationale,
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
      created_at: ts,
      updated_at: ts,
    };
    this.commerceRequests.set(id, request);
    this.commerceIdempotency.set(idem, id);
    return { ...request };
  }

  getCommerceRequest(requestId: string): CommerceRequest {
    return { ...this.requireCommerceRequest(requestId) };
  }

  cancelCommerceRequest(requestId: string): CommerceRequest {
    const request = this.requireCommerceRequest(requestId);
    if (!["awaiting_human_approval", "blocked", "approved", "payment_action_required", "payment_failed"].includes(request.state)) {
      throw new Error("This commerce request can no longer be cancelled.");
    }
    request.state = "cancelled";
    request.blocker_code = undefined;
    request.blockers = [];
    request.agent_next_action = "The request is cancelled. Create a new request only if the purchase is still needed.";
    request.version += 1;
    request.updated_at = new Date().toISOString();
    return { ...request };
  }

  listCommerceRequests(input: ListCommerceRequestsInput = {}): Page<CommerceRequest> {
    let items = [...this.commerceRequests.values()];
    items.sort((a, b) => b.created_at.localeCompare(a.created_at));
    const total = items.length;
    const offset = input.page ? Math.max(0, Number.parseInt(input.page, 10) || 0) : 0;
    const limit = Math.max(1, Math.min(input.limit ?? 50, 100));
    const page = items.slice(offset, offset + limit).map((request) => ({ ...request }));
    const next = offset + page.length;
    return { items: page, total, next_cursor: next < total ? String(next) : undefined };
  }

  private requireCommerceRequest(requestId: string): CommerceRequest {
    const request = this.commerceRequests.get(requestId);
    if (!request) throw new NotFoundError(`Commerce request not found: ${requestId}`);
    return request;
  }

  // ---- suppressions (recipient opt-outs / list-unsubscribe) --------------

  /**
   * Pre-check whether the caller's org suppresses a recipient (mirrors
   * `GET /v1/suppressions?recipient=…`): `{recipient, suppressed, rows}` over the
   * active (non-revoked) org rows for that canonicalized recipient.
   */
  precheckSuppression(recipient: string): SuppressionPrecheck {
    const canonical = canonicalRecipient(recipient);
    const rows = [...this.suppressions.values()]
      .filter((s) => !s.revoked && s.recipient === canonical)
      .map((s) => ({ ...s }));
    return { recipient: canonical, suppressed: rows.length > 0, rows };
  }

  /** Offline deliverability rollup (mirrors `GET /v1/reputation`): healthy, no data. */
  getReputation(): ReputationRollup {
    return {
      object: "reputation",
      org_id: MOCK_ORG_ID,
      status: "unknown",
      sending_status: "unknown",
      configured: false,
      metrics: { sends: 0, bounces: 0, complaints: 0, bounce_rate: 0, complaint_rate: 0 },
      open_findings: 0,
    };
  }

  /** Offline findings list (mirrors `GET /v1/reputation/findings`): empty. */
  listDeliverabilityFindings(_input: ListDeliverabilityFindingsInput = {}): Page<ReputationFinding> {
    return { items: [], total: 0 };
  }

  /** List the caller's own org suppression rows (mirrors the paged `GET /v1/suppressions`). */
  listSuppressions(input: {
    scope?: "org" | "shared_domain" | "global";
    include_revoked?: boolean;
    limit?: number;
    cursor?: string;
  }): Page<SuppressionEntry> {
    let rows = [...this.suppressions.values()];
    if (input.scope) rows = rows.filter((s) => s.scope === input.scope);
    if (!input.include_revoked) rows = rows.filter((s) => !s.revoked);
    rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
    const total = rows.length;
    const offset = input.cursor ? Math.max(0, Number.parseInt(input.cursor, 10) || 0) : 0;
    const limit = input.limit ?? 50;
    const items = rows.slice(offset, offset + limit).map((s) => ({ ...s }));
    const page: Page<SuppressionEntry> = { items, total };
    if (offset + items.length < total) page.next_cursor = String(offset + items.length);
    return page;
  }

  /**
   * Revoke one org-scope suppression row (mirrors `POST /v1/suppressions/{id}/revoke`);
   * a reason is required. Throws NotFoundError when the id is unknown or not the
   * caller's own org row (global/shared rows are platform-operator only → 404).
   */
  revokeSuppression(id: string, reason: string): SuppressionEntry {
    const row = this.suppressions.get(id);
    if (!row || row.scope !== "org" || row.revoked) {
      throw new NotFoundError(`Suppression not found: ${id}`);
    }
    row.revoked = true;
    row.revoked_at = new Date().toISOString();
    row.revoked_by = "agent:" + this.agentId;
    row.revoke_reason = reason;
    this.suppressions.set(id, row);
    return { ...row };
  }

  /**
   * Reject the WHOLE send if ANY recipient has an active org-scope suppression,
   * naming exactly the suppressed addresses (never the scope/origin) so the caller
   * can drop them and retry - mirroring the live `recipient_suppressed` (422) path.
   */
  private enforceSuppression(recipients: string[]): void {
    const active = new Set(
      [...this.suppressions.values()].filter((s) => !s.revoked).map((s) => s.recipient),
    );
    if (active.size === 0) return;
    const hit: string[] = [];
    for (const rcpt of recipients) {
      const canonical = canonicalRecipient(rcpt);
      if (canonical && active.has(canonical) && !hit.includes(canonical)) hit.push(canonical);
    }
    if (hit.length > 0) throw new SuppressedError(hit);
  }

  /**
   * Enforce the send-direction contact lists for an inbox: reject a block-listed
   * recipient, or any recipient outside the allowlist when allowlist mode is on.
   */
  private enforceSendPolicy(from: string, recipients: string[]): void {
    const entries = [...this.contactLists.values()].filter(
      (e) => e.direction === "send" && (e.inbox === null || e.inbox === from),
    );
    if (entries.length === 0) return;
    const blocks = entries.filter((e) => e.kind === "block");
    const allows = entries.filter((e) => e.kind === "allow");
    for (const rcpt of recipients) {
      const addr = normalizeContactPattern(rcpt);
      if (!addr) continue;
      if (blocks.some((b) => contactEntryMatches(b.pattern, addr))) {
        throw new BlockedError(`${rcpt} is block-listed`);
      }
      if (allows.length > 0 && !allows.some((a) => contactEntryMatches(a.pattern, addr))) {
        throw new BlockedError(`${rcpt} is not on the allow list`);
      }
    }
  }

  /** Drop a believable inbound OTP reply into the thread shortly after a send. */
  private queueAutoReply(inbox: Inbox, original: Message): void {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    setTimeout(() => {
      if (!this.inboxes.has(inbox.id)) return;
      this.appendMessage(inbox.id, {
        direction: "inbound",
        fromName: "Acme Security",
        fromEmail: "no-reply@acme.example",
        to: [inbox.address],
        subject: `Your verification code`,
        text: `Hello,\n\nYour Acme verification code is: ${code}\n\nIt expires in 10 minutes. If you did not request this, ignore this email.`,
        html: `<p>Hello,</p><p>Your Acme verification code is: <b>${code}</b></p><p><a href="https://acme.example/verify?token=${code}abc&u=${encodeURIComponent(inbox.address)}">Verify your email</a></p>`,
        threadId: original.thread_id,
        ageMinutes: 0,
      });
    }, 1200).unref?.();
  }

  private seed(): void {
    const inbox = this.createInbox({
      username: "agent7",
      displayName: "Extrovert Demo Agent",
    });

    // Seed one active org-scope suppression so the recipient opt-out surface
    // (check_suppression / list_suppressions / revoke_suppression) and the
    // recipient_suppressed send-rejection path have deterministic offline data.
    const supId = nextId("sup");
    this.suppressions.set(supId, {
      id: supId,
      recipient: SEEDED_SUPPRESSED_RECIPIENT,
      recipient_raw: SEEDED_SUPPRESSED_RECIPIENT,
      scope: "org",
      source: "manual",
      reactivation_count: 0,
      created_at: new Date().toISOString(),
      revoked: false,
    });
    const seeds: SeedMessage[] = [
      {
        fromName: "Stripe",
        fromEmail: "verify@stripe.com",
        subject: "Confirm your email address",
        text: "Welcome! Your confirmation code is 481920. Or click the button below to verify.",
        html: '<p>Your confirmation code is <b>481920</b>.</p><p><a href="https://dashboard.stripe.com/verify?code=481920&id=evt_9">Confirm email</a></p>',
        ageMinutes: 3,
      },
      {
        fromName: "GitHub",
        fromEmail: "noreply@github.com",
        subject: "[GitHub] Please verify your device",
        text: "A sign-in attempt requires verification. Your authentication code is GH-204815.",
        ageMinutes: 41,
      },
      {
        fromName: "HTML Sender",
        fromEmail: "html-only@example.test",
        subject: "HTML-only verification",
        text: null,
        html: '<p>Your HTMLONLY verification code is <strong>731942</strong>.</p><p><a href="https://example.test/verify?token=htmlonly">Verify</a></p>',
        ageMinutes: 90,
      },
      {
        fromName: "Linear",
        fromEmail: "notifications@linear.app",
        subject: "You were assigned POS-128",
        text: "Keith assigned you an issue: 'Wire wait_for_email into the MCP server'. Due Friday.",
        ageMinutes: 220,
      },
    ];
    for (const s of seeds) {
      const msg = this.appendMessage(inbox.id, {
        direction: "inbound",
        fromName: s.fromName,
        fromEmail: s.fromEmail,
        to: [inbox.address],
        subject: s.subject,
        text: s.text,
        html: s.html,
        threadId: nextId("thr"),
        ageMinutes: s.ageMinutes,
      });
      msg.seen = false;
    }

    // Seed a review with one pending durable nudge so the realtime drain/ack
    // surface (list_review_events / wait_for_review_event / ack_review_event) has a
    // deterministic event to exercise offline: a human rejected a draft with
    // feedback before the agent connected, leaving work on the authoritative queue.
    const seededReview = this.createReviewRecord({
      kind: "send",
      fromAddress: inbox.address,
      subject: "Re-engage cold lead at Acme",
      text: "Let me know your thoughts.",
      to: ["vp@acme.com"],
      intent: { summary: "re-engage cold lead", meta: { goal: "book_meeting" } },
    });
    this.enqueueReviewEvent(seededReview.id, "rejected", {
      decision: "rejected",
      comment: "be more pushy, we need MRR",
    });

    // Seed a review already OPEN for review (a reviewer opened it) so the M5 chat
    // surface (post_review_chat / submit_revision / get_review_feedback) has a
    // chattable draft offline. A human comment turn gives get_review_feedback data.
    const inReviewReview = this.createReviewRecord({
      kind: "send",
      fromAddress: inbox.address,
      subject: "Pilot proposal",
      text: "Here is the Q3 pilot proposal.",
      to: ["vp@acme.com"],
      intent: { summary: "send pilot proposal", meta: { goal: "book_meeting" } },
    });
    inReviewReview.state = "in_review";
    this.commitReview(inReviewReview);
    const seededTurns = this.reviewTurns.get(inReviewReview.id) ?? [];
    seededTurns.push({
      id: nextId("turn"),
      seq: seededTurns.length + 1,
      turn_type: "human_comment",
      actor_kind: "human",
      actor_id: "user_demo",
      body: "tighten the opening line",
      created_at: new Date().toISOString(),
    });
    this.reviewTurns.set(inReviewReview.id, seededTurns);
  }
}

/** Drop the one-time signing secret from a stored webhook for read responses. */
function redactWebhookSecret(w: Webhook): Webhook {
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

/** Thrown when an inbox/thread cannot be resolved (maps to API 404). */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

/** Thrown when a send is rejected by an inbox's contact lists (maps to API 403). */
export class BlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockedError";
  }
}

/**
 * Thrown when a send is rejected because one or more recipients have opted out
 * (list-unsubscribe / suppression; maps to API 422 `recipient_suppressed`). The
 * message names exactly the suppressed addresses so the agent can drop them and
 * retry; `recipients` carries the same list machine-readably.
 */
export class SuppressedError extends Error {
  readonly recipients: string[];
  constructor(recipients: string[]) {
    super(`recipient(s) suppressed (opted out): ${recipients.join(", ")}`);
    this.name = "SuppressedError";
    this.recipients = recipients;
  }
}

/** Thrown when a project_id assertion does not match the key's bound project (maps to API 403). */
export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenError";
  }
}

/**
 * Thrown when an org-tier key issues a bare list that needs an explicit breadth
 * pick (maps to API 400 `breadth_required`; redesign §4.1). The message names the
 * next call (a project id or the org wildcard).
 */
export class BreadthRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BreadthRequiredError";
  }
}

/**
 * Thrown when a send/reply/forward is refused because the account's review policy
 * requires an intent (maps to API 422 `intent_required`; D3).
 *
 * `problemErrors` carries the SAME `{field, code, detail}` hints the live problem
 * body does - including the `retry_with` example - because the offline error is
 * useless as practice if it is less actionable than the real one.
 */
export class IntentRequiredError extends Error {
  readonly problemErrors?: ProblemField[];
  constructor(message: string, problemErrors?: ProblemField[]) {
    super(message);
    this.name = "IntentRequiredError";
    this.problemErrors = problemErrors;
  }
}

/** Thrown on a conflicting/idempotent-replay mutation (maps to API 409). */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

/**
 * Thrown when `text` and its deprecated `body` alias disagree (maps to API 400
 * `conflicting_alias`). There is no safe guess: picking a winner would relay the
 * wrong bytes from the customer's own domain to a real recipient.
 */
export class ConflictingAliasError extends Error {
  readonly problemErrors: ProblemField[];
  constructor(message: string) {
    super(message);
    this.name = "ConflictingAliasError";
    this.problemErrors = [{ field: "text", code: "conflicting_alias", detail: message }];
  }
}

/**
 * Base for the review-loop 409s that carry the RECOVERY FACTS as problem fields:
 * the current state / revision / version, plus one `allowed_action` per legal verb.
 * A stale-CAS retry therefore needs no extra `get_review`, and a wrong-state agent
 * is told what IS legal instead of retrying the same verb forever.
 */
export class ReviewConflictError extends ConflictError {
  readonly problemErrors: ProblemField[];
  constructor(message: string, review: Review) {
    super(message);
    this.problemErrors = [
      { field: "state", code: review.state, detail: "the draft's current state" },
      { field: "revision", code: String(review.revision), detail: "current revision - use as parent_revision" },
      { field: "version", code: String(review.version), detail: "current row version" },
      ...(review.sent_message_id
        ? [{ field: "sent_message_id", code: review.sent_message_id, detail: "the message that already went out" }]
        : []),
      ...allowedAgentActions(review.state).map((a) => ({
        field: "allowed_action",
        code: a,
        detail: "legal from the current state",
      })),
    ];
  }
}

/**
 * 409 `stale` - the `(revision[,version])` you named is no longer current and
 * NOTHING was mutated. The ONE 409 worth retrying: re-read, re-apply your edit on
 * top of the other party's, resubmit with the new parent_revision. Bounded (<=3).
 */
export class StaleError extends ReviewConflictError {
  constructor(message: string, review: Review) {
    super(message, review);
    this.name = "StaleError";
  }
}

/**
 * 409 `wrong_state` - this VERB is illegal from the current state, but the draft
 * is still live. NEVER retry the same verb; read the `allowed_action` hints and
 * pick a legal one.
 */
export class WrongStateError extends ReviewConflictError {
  constructor(message: string, review: Review) {
    super(message, review);
    this.name = "WrongStateError";
  }
}

/**
 * 409 `terminal` - sent / auto_sent / cancelled. Nothing will ever succeed on this
 * review. STOP; a `front_run_next` nudge is waiting in the drain.
 */
export class TerminalError extends ReviewConflictError {
  constructor(message: string, review: Review) {
    super(message, review);
    this.name = "TerminalError";
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
 * Normalize a contact pattern or recipient: lower-case/trim, pull the address
 * out of a "Name <addr>" form, and strip a leading "@" from a domain pattern.
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

function reSubject(subject: string): string {
  return /^re:/i.test(subject) ? subject : `Re: ${normalizeThreadSubject(subject)}`;
}

function fwdSubject(subject: string): string {
  return /^fwd?:/i.test(subject) ? subject : `Fwd: ${normalizeThreadSubject(subject)}`;
}

/**
 * The forwarded body: the agent's optional note, then the quoted parent. Built at
 * SUBMIT time (not at approval) so the human reviews the exact bytes that go out  -
 * re-deriving it from the live parent at approval would silently discard the
 * reviewer's edit.
 */
function forwardBody(note: string | undefined, parent: Message): string {
  return `${note ?? ""}\n\n---------- Forwarded message ----------\nFrom: ${fmtFrom(parent)}\nSubject: ${parent.subject}\n\n${parent.text}`;
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

function fmtFrom(m: Message): string {
  return m.from.name ? `${m.from.name} <${m.from.email}>` : m.from.email;
}

function dedupeAddresses(addresses: { name?: string; email: string }[]): {
  name?: string;
  email: string;
}[] {
  const seen = new Set<string>();
  const out: { name?: string; email: string }[] = [];
  for (const a of addresses) {
    const key = a.email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    t.unref?.();
  });
}

function compileFixtureRegex(pattern: string): RegExp {
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
