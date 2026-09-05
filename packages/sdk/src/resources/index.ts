/**
 * Resource namespaces: `extrovert.inboxes`, `extrovert.messages`, `extrovert.threads`,
 * `extrovert.webhooks`, `extrovert.contactLists`, `extrovert.domains`. Each is a thin,
 * typed facade over the {@link Transport}.
 */

import type { AttachmentDownload, Transport } from "../transport.js";
import { BreadthRequiredError, ValidationError } from "../errors.js";
import { waitForDomain, type DomainWaitResult } from "../domain-wait.js";
import { tierNeedsExplicitBreadth, type KeyTier } from "../key-tier.js";
import { InboxHandle, type InboxHandleOptions } from "./inbox-handle.js";
import type {
  AckReviewEventRequest,
  AckReviewEventResult,
  AddContactListRequest,
  Attachment,
  BatchUpdateMessagesRequest,
  BatchUpdateResult,
  Category,
  CommerceRequest,
  ContactListEntry,
  CreateInboxRequest,
  DeleteResult,
  Domain,
  DomainStatusEventPage,
  DomainQuote,
  DomainOffboard,
  Inbox,
  ListCategoriesParams,
  ListCommerceRequestsParams,
  ListInboxesParams,
  ListReviewEventsParams,
  ListReviewsParams,
  ListThreadsParams,
  MarkReadRequest,
  Message,
  OnboardDomainRequest,
  QuoteDomainRequest,
  RequestDomainPurchaseRequest,
  RequestPlanChangeRequest,
  ReplyRequest,
  Page,
  ProposeCategoryRequest,
  ProposeGraduationRequest,
  GetRulesParams,
  GetRuleAuditParams,
  GraduationStatus,
  RiskDial,
  Rule,
  RuleSnapshot,
  RuleAuditEntry,
  LearnReviewRuleRequest, LearnedReviewRule,
  SaveRuleRequest,
  PostReviewChatRequest,
  RegisterWebhookRequest,
  RestampReviewRequest,
  CategoryPacingState,
  Review,
  ReviewDecisionContext,
  ReviewerDecisionRequest,
  ReviewerDecisionResult,
  ReviewEventsResult,
  ReviewFeedback,
  ReviewTurn,
  ScanBacklogStatus,
  SearchMessagesParams,
  SendOutcome,
  SubmitRevisionRequest,
  SuppressionEntry,
  SuppressionPrecheck,
  ListSuppressionsParams,
  ThreadDetail,
  Submission,
  Thread,
  UpdateCategoryRequest,
  UpdateInboxRequest,
  UpdateWebhookRequest,
  WaitForReviewEventParams,
  Webhook,
} from "../models.js";

export { InboxHandle } from "./inbox-handle.js";
export { Projects, ProjectInboxes } from "./projects.js";

interface ResourceContext {
  transport: Transport;
  handleOptions: InboxHandleOptions;
  /**
   * The CEILING tier derived from the configured key prefix. Advisory client-side
   * hint ONLY (the server stays authoritative); lets the bare sugar surface fail
   * fast for an org-tier key that must pick a breadth, matching the MCP surface.
   */
  keyTier: KeyTier;
}

/** `extrovert.inboxes`: create, list, get, update, delete inboxes. */
export class Inboxes {
  constructor(private readonly ctx: ResourceContext) {}

  /**
   * Create an inbox. The default path creates an address on `extrovertmail.com`
   * for paid accounts or `free.extrovertmail.com` for free signups, so it returns
   * a live inbox in one call.
   *
   * Pass `metadata` to attach arbitrary key-value data, and `client_id` for idempotent creation
   * (re-calling with the same id returns the same inbox, with its metadata replayed verbatim).
   */
  async create(req: CreateInboxRequest = {}, signal?: AbortSignal): Promise<InboxHandle> {
    const inbox = await this.ctx.transport.createInbox(req, req.client_id, signal);
    return new InboxHandle(this.ctx.transport, inbox.address, this.ctx.handleOptions, inbox);
  }

  /**
   * List inboxes visible to the calling key (the bare curl-sugar surface: resolves
   * to the key's default project). An org-tier key has no single default project, so
   * the bare list is ambiguous: fail fast client-side with a BreadthRequiredError that
   * names the next call, matching the MCP surface, instead of round-tripping to a 400.
   * Use `extrovert.projects.inboxes.list("<project_id>")` or `"-"` (org subtree) for
   * an org key. The check is advisory: the server stays authoritative.
   */
  list(params: ListInboxesParams = {}, signal?: AbortSignal): Promise<Page<Inbox>> {
    if (tierNeedsExplicitBreadth(this.ctx.keyTier)) {
      return Promise.reject(
        new BreadthRequiredError({
          status: 400,
          code: "breadth_required",
          message:
            "An org-tier key must pick a list breadth: use extrovert.projects.inboxes.list(\"<project_id>\") " +
            "or extrovert.projects.inboxes.list(\"-\") (the org subtree).",
        }),
      );
    }
    return this.ctx.transport.listInboxes(params, signal);
  }

  /** Fetch a single inbox and return an ergonomic handle bound to it. */
  async get(address: string, signal?: AbortSignal): Promise<InboxHandle> {
    const inbox = await this.ctx.transport.getInbox(address, signal);
    return new InboxHandle(this.ctx.transport, inbox.address, this.ctx.handleOptions, inbox);
  }

  /**
   * Update an inbox's settings in place without delete+recreate: rename the sender
   * `display_name`, change the `webhook_url`, patch arbitrary `metadata` (shallow
   * merge; a key set to `null` deletes it, top-level `metadata: null` clears all),
   * or set the effective `daily_send_limit` (1–10,000 recipients per rolling 24h).
   * Updating the daily limit requires the opt-in `mailbox:quota` scope.
   * Returns a handle bound to the updated record.
   */
  async update(address: string, req: UpdateInboxRequest, signal?: AbortSignal): Promise<InboxHandle> {
    const inbox = await this.ctx.transport.updateInbox(address, req, signal);
    return new InboxHandle(this.ctx.transport, inbox.address, this.ctx.handleOptions, inbox);
  }

  /**
   * Permanently delete an inbox by address. Requires `mailbox:delete`; the inbox,
   * messages, and sender identity cannot be recovered.
   */
  delete(address: string, signal?: AbortSignal): Promise<void> {
    return this.ctx.transport.deleteInbox(address, signal);
  }
}

/**
 * `extrovert.messages`: read a message, fetch its raw bytes, mark it read.
 *
 * Reply and forward are inbox-scoped (the server resolves the parent and derives
 * recipients), so they live on the {@link InboxHandle} (`inbox.reply(...)`,
 * `inbox.forward(...)`), not here.
 */
export class Messages {
  constructor(private readonly ctx: ResourceContext) {}

  /** Fetch a single message by its opaque id; the owning inbox is resolved from the id. */
  get(messageId: string, signal?: AbortSignal): Promise<Message> {
    return this.ctx.transport.getMessage(messageId, signal);
  }

  /**
   * Download the raw RFC822 `.eml` bytes for a message. `inbox` is the owning
   * address (needed to open the inbox); the id identifies the message.
   */
  raw(inbox: string, messageId: string, signal?: AbortSignal): Promise<string> {
    return this.ctx.transport.getMessageRaw(inbox, messageId, signal);
  }

  /**
   * Mark a message read/unread via the native IMAP \Seen flag (Extrovert's
   * label-free read state). `inbox` is the owning address.
   */
  markRead(
    inbox: string,
    messageId: string,
    req: MarkReadRequest,
    signal?: AbortSignal,
  ): Promise<Message> {
    return this.ctx.transport.markRead(inbox, messageId, req, signal);
  }

  /**
   * Delete a message: move it to Trash (default, recoverable) or permanently
   * remove it when `expunge` is true. `inbox` is the owning address.
   */
  delete(
    inbox: string,
    messageId: string,
    expunge?: boolean,
    signal?: AbortSignal,
  ): Promise<DeleteResult> {
    return this.ctx.transport.deleteMessage(inbox, messageId, expunge, signal);
  }

  /**
   * Batch mark read/unread and/or move folder for a list of message ids in one
   * inbox. At least one of `read` / `folder` must be set; returns the per-id
   * `{updated, failed}` split.
   */
  batchUpdate(
    inbox: string,
    req: BatchUpdateMessagesRequest,
    signal?: AbortSignal,
  ): Promise<BatchUpdateResult> {
    return this.ctx.transport.batchUpdateMessages(inbox, req, signal);
  }

  /**
   * List a message's attachment metadata ({id, filename, content_type, size}).
   * `inbox` is the owning address; the message id identifies the message.
   */
  listAttachments(inbox: string, messageId: string, signal?: AbortSignal): Promise<Page<Attachment>> {
    return this.ctx.transport.listAttachments(inbox, messageId, signal);
  }

  /**
   * Download one attachment's bytes (base64) plus its filename and content type.
   * The "easy attachment fetch": `inbox` is the owning address, `messageId` the
   * message, and `attachmentId` the opaque id from {@link listAttachments}.
   */
  getAttachment(
    inbox: string,
    messageId: string,
    attachmentId: string,
    signal?: AbortSignal,
  ): Promise<AttachmentDownload> {
    return this.ctx.transport.getAttachment(inbox, messageId, attachmentId, signal);
  }
}

/**
 * `extrovert.threads`: list, search, read, reply to, and delete conversations,
 * scoped to their owning inbox.
 */
export class Threads {
  constructor(private readonly ctx: ResourceContext) {}

  /** List conversations newest-active first. Pass `next_cursor` back as `cursor` for the next page. */
  list(inbox: string, params: ListThreadsParams = {}, signal?: AbortSignal): Promise<Page<Thread>> {
    return this.ctx.transport.listThreads(inbox, params, signal);
  }

  /** Search thread subjects, snippets, and participants. Cursor pagination matches {@link list}. */
  search(
    inbox: string,
    params: SearchMessagesParams,
    signal?: AbortSignal,
  ): Promise<Page<Thread>> {
    return this.ctx.transport.searchThreads(inbox, params, signal);
  }

  /** Fetch one thread (+ its messages, oldest-first) by id under its owning inbox address. */
  get(inbox: string, threadId: string, signal?: AbortSignal): Promise<ThreadDetail> {
    return this.ctx.transport.getThread(inbox, threadId, signal);
  }

  /** Reply in a thread; recipients and RFC reply headers are derived server-side. */
  reply(inbox: string, req: ReplyRequest, signal?: AbortSignal): Promise<SendOutcome> {
    return this.ctx.transport.reply(inbox, req, signal);
  }

  /**
   * Delete an entire thread (every message): move to Trash (default) or
   * permanently remove when `expunge` is true. `inbox` is the owning address.
   */
  delete(
    inbox: string,
    threadId: string,
    expunge?: boolean,
    signal?: AbortSignal,
  ): Promise<DeleteResult> {
    return this.ctx.transport.deleteThread(inbox, threadId, expunge, signal);
  }
}

/** `extrovert.submissions`: read transport status; never resubmits a message. */
export class Submissions {
  constructor(private readonly ctx: ResourceContext) {}
  get(inbox: string, submissionId: string, signal?: AbortSignal): Promise<Submission> {
    return this.ctx.transport.getSubmission(inbox, submissionId, signal);
  }
}

/** `extrovert.webhooks`: register / list / get / update / delete HMAC-signed inbound webhooks. */
export class Webhooks {
  constructor(private readonly ctx: ResourceContext) {}

  /** Register an HMAC-signed, timestamped webhook. The signing `secret` is returned once. */
  register(req: RegisterWebhookRequest, signal?: AbortSignal): Promise<Webhook> {
    return this.ctx.transport.registerWebhook(req, signal);
  }

  /** List registered webhooks (the one-time signing `secret` is omitted). */
  list(signal?: AbortSignal): Promise<Page<Webhook>> {
    return this.ctx.transport.listWebhooks(signal);
  }

  /** Fetch one webhook by id (the signing `secret` is omitted). */
  get(webhookId: string, signal?: AbortSignal): Promise<Webhook> {
    return this.ctx.transport.getWebhook(webhookId, signal);
  }

  /**
   * Update a webhook in place: change the delivery `url`, the subscribed
   * `events`, the `inbox` filter (empty string clears it), or `active` to
   * enable/disable delivery. Omitted fields are left unchanged (PATCH
   * semantics). The signing `secret` is immutable and stays redacted.
   */
  update(webhookId: string, req: UpdateWebhookRequest, signal?: AbortSignal): Promise<Webhook> {
    return this.ctx.transport.updateWebhook(webhookId, req, signal);
  }

  /** Delete a webhook by id. */
  delete(webhookId: string, signal?: AbortSignal): Promise<void> {
    return this.ctx.transport.deleteWebhook(webhookId, signal);
  }
}

/**
 * `extrovert.contactLists`: per-inbox allow/block lists of addresses/domains.
 * A `block` entry rejects a send to a matching recipient; once an `allow` entry
 * exists for an inbox, sends from it are restricted to matching recipients
 * (allowlist mode). Entries are addressable by their opaque id (`lst_…`).
 */
export class ContactLists {
  constructor(private readonly ctx: ResourceContext) {}

  /** Add an allow/block entry to an inbox. */
  add(inbox: string, req: AddContactListRequest, signal?: AbortSignal): Promise<ContactListEntry> {
    return this.ctx.transport.addContactListEntry(inbox, req, signal);
  }

  /** List the entries governing an inbox (inbox-specific + account-wide). */
  list(inbox: string, signal?: AbortSignal): Promise<Page<ContactListEntry>> {
    return this.ctx.transport.listContactLists(inbox, signal);
  }

  /** Delete an entry on an inbox by id. */
  delete(inbox: string, entryId: string, signal?: AbortSignal): Promise<void> {
    return this.ctx.transport.deleteContactListEntry(inbox, entryId, signal);
  }
}

/**
 * `extrovert.suppressions`: recipient opt-outs (list-unsubscribe). A recipient
 * that has unsubscribed cannot be mailed by this org: a send to them is rejected
 * with `recipient_suppressed` ({@link RecipientSuppressedError}). Use `precheck`
 * before composing to skip a would-be-rejected recipient, `list` to browse the
 * org's opt-outs, and `revoke` (reason required, audit-logged) to re-enable a
 * recipient. All reads/writes are scoped to the caller's OWN org: a
 * platform-global or shared-domain opt-out is never surfaced here.
 */
export class Suppressions {
  constructor(private readonly ctx: ResourceContext) {}

  /**
   * Pre-check whether the caller's org already suppresses a recipient, BEFORE
   * composing. `suppressed: true` means a send to them would be rejected: skip
   * that recipient. Returns the matching org rows too (never a global/shared row).
   */
  precheck(recipient: string, signal?: AbortSignal): Promise<SuppressionPrecheck> {
    return this.ctx.transport.precheckSuppression(recipient, signal);
  }

  /** List the org's suppression rows (active by default; `include_revoked` for all). */
  list(params: ListSuppressionsParams = {}, signal?: AbortSignal): Promise<Page<SuppressionEntry>> {
    return this.ctx.transport.listSuppressions(params, signal);
  }

  /**
   * Revoke one org-scope suppression row (re-enable sending to that recipient). A
   * `reason` is REQUIRED (empty/whitespace is a 400) and is audit-logged. A
   * foreign/global/shared id is an indistinguishable 404.
   */
  revoke(id: string, reason: string, signal?: AbortSignal): Promise<SuppressionEntry> {
    return this.ctx.transport.revokeSuppression(id, reason, signal);
  }
}

/**
 * `extrovert.domains`: read with domain:read or domain:manage; changes require
 * domain:manage. Add delegated inbox domains the customer
 * controls, read status + nameserver records inline, trigger/refresh
 * verification, and offboard. New registrations use `extrovert.commerce`: quote
 * first, create a request, then poll its status. Set `scope: "project"` to bind a
 * customer-controlled domain to the key's project; it defaults to `org`.
 */
export class Domains {
  constructor(private readonly ctx: ResourceContext) {}

  /** List the customer's onboarded domains and their status. */
  list(paramsOrSignal: { page?: string; limit?: number } | AbortSignal = {}, signal?: AbortSignal): Promise<Page<Domain>> {
    if ("aborted" in paramsOrSignal) return this.ctx.transport.listDomains(paramsOrSignal);
    return this.ctx.transport.listDomains(signal, paramsOrSignal);
  }

  /** Get one domain's detail, verification status, and nameserver records. */
  get(domain: string, signal?: AbortSignal): Promise<Domain> {
    return this.ctx.transport.getDomain(domain, signal);
  }

  /** Wait up to 50 seconds, then return an explicit resumable outcome. No DNS writes. */
  wait(domain: string, options: { timeout_seconds?: number; signal?: AbortSignal } = {}): Promise<DomainWaitResult> {
    return waitForDomain((signal) => this.ctx.transport.getDomain(domain, signal), options);
  }

  /** Resume durable updates for this domain using the previous next_cursor as after. */
  events(domain: string, params: { after?: string; limit?: number } = {}, signal?: AbortSignal): Promise<DomainStatusEventPage> {
    return this.ctx.transport.listDomainEvents(domain, params, signal);
  }

  /**
   * Add a delegated inbox domain the customer controls. Returns the nameserver
   * records to publish and never spends money.
   */
  onboard(req: OnboardDomainRequest, signal?: AbortSignal): Promise<Domain> {
    return this.ctx.transport.onboardDomain(req, signal);
  }

  /** Trigger or refresh verification for a domain; returns its (possibly advanced) status. */
  verify(domain: string, signal?: AbortSignal): Promise<Domain> {
    return this.ctx.transport.verifyDomain(domain, signal);
  }

  /**
   * Offboard (remove) a domain from the customer. Async: the API accepts the
   * request (HTTP 202) and tears the domain down as a job. Returns the accepted
   * job's id + poll URL (`status_url`); poll it with `extrovert.getJob(job_id)`
   * until the status is terminal (succeeded/failed/cancelled).
   */
  offboard(domain: string, signal?: AbortSignal): Promise<DomainOffboard> {
    return this.ctx.transport.offboardDomain(domain, signal);
  }
}

/**
 * `extrovert.commerce`: quote, request, cancel, and poll financial operations. Agents
 * can never approve a request through this resource; approval is a human console
 * action. Every create requires a stable idempotency key.
 */
export class Commerce {
  constructor(private readonly ctx: ResourceContext) {}

  private requireIdempotencyKey(value: string): void {
    if (value.trim().length < 8) {
      throw new ValidationError({
        status: 400,
        code: "bad_request",
        message:
          "idempotency_key must be a stable value of at least 8 characters; reuse it for retries of the same intent.",
      });
    }
  }

  /** Quote a domain without purchasing, reserving, or approving it. */
  quoteDomain(req: QuoteDomainRequest, signal?: AbortSignal): Promise<DomainQuote> {
    return this.ctx.transport.quoteDomain(req, signal);
  }

  /** Create a durable domain-purchase request for human approval. */
  requestDomainPurchase(
    req: RequestDomainPurchaseRequest,
    signal?: AbortSignal,
  ): Promise<CommerceRequest> {
    this.requireIdempotencyKey(req.idempotency_key);
    return this.ctx.transport.requestDomainPurchase(req, signal);
  }

  /** Create a durable plan-upgrade or downgrade request for human approval. */
  requestPlanChange(req: RequestPlanChangeRequest, signal?: AbortSignal): Promise<CommerceRequest> {
    this.requireIdempotencyKey(req.idempotency_key);
    return this.ctx.transport.requestPlanChange(req, signal);
  }

  /** Poll one request's exact blockers, approval URL, and next-action guidance. */
  get(requestId: string, signal?: AbortSignal): Promise<CommerceRequest> {
    return this.ctx.transport.getCommerceRequest(requestId, signal);
  }

  /** Withdraw this agent's request while its durable state still permits cancellation. */
  cancel(requestId: string, signal?: AbortSignal): Promise<CommerceRequest> {
    return this.ctx.transport.cancelCommerceRequest(requestId, signal);
  }

  /** List visible commerce requests using the API's opaque page token. */
  list(
    params: ListCommerceRequestsParams = {},
    signal?: AbortSignal,
  ): Promise<Page<CommerceRequest>> {
    return this.ctx.transport.listCommerceRequests(params, signal);
  }
}

/**
 * `extrovert.reviews`: the Review Loop (HITL) agent-plane reads. A sending agent
 * monitors its submissions in the human-review queue: list/get a review request and
 * read its append-only thread of turns (intent, drafts, human comments/edits/
 * decisions, captured diffs). Submitting FOR review rides `inbox.send` /
 * `inbox.reply` with `mode`/`intent`/`category_id`. Human-authority actions
 * (approve/reject/edit-send) are console-only (D17) and never exposed here.
 */
export class Reviews {
  /**
   * `extrovert.reviews.events`: the Review Loop (HITL) realtime plane: drain,
   * long-poll, and ack the durable nudge queue (the AUTHORITATIVE liveness source;
   * SSE/webhook are best-effort fast paths on top of it).
   */
  readonly events: ReviewEvents;

  constructor(private readonly ctx: ResourceContext) {
    this.events = new ReviewEvents(ctx);
  }

  /** List review requests (customer-scoped). Filter by state / category / inbox. */
  list(params: ListReviewsParams = {}, signal?: AbortSignal): Promise<Page<Review>> {
    return this.ctx.transport.listReviews(params, signal);
  }

  /** Get one review request by id (rr_…): current draft + intent + state. */
  get(reviewId: string, signal?: AbortSignal): Promise<Review> {
    return this.ctx.transport.getReview(reviewId, signal);
  }

  /** Get a review's append-only thread turns by id (rr_…). */
  turns(reviewId: string, signal?: AbortSignal): Promise<Page<ReviewTurn>> {
    return this.ctx.transport.getReviewTurns(reviewId, signal);
  }

  /**
   * Get the human's assembled feedback (M5): the diff + comments + decision + the
   * rules born from this review. Read it after a rejected/edited nudge to learn what
   * the human wanted. $0 LLM: pure assembly on our side.
   */
  feedback(reviewId: string, signal?: AbortSignal): Promise<ReviewFeedback> {
    return this.ctx.transport.getReviewFeedback(reviewId, signal);
  }

  /**
   * Post a chat turn on a review's thread (M5): an agent question to the human
   * reviewer; flips in_review -> chatting on the first turn. Idempotent on the
   * optional `idempotencyKey` (the `Idempotency-Key` header). $0 LLM: you compose it.
   */
  chat(
    reviewId: string,
    req: PostReviewChatRequest,
    idempotencyKey?: string,
    signal?: AbortSignal,
  ): Promise<Review> {
    return this.ctx.transport.postReviewChat(reviewId, req, idempotencyKey, signal);
  }

  /**
   * Post a new agent draft under a parent_revision CAS (M5; D17). parent_revision
   * must equal the draft's current revision, else a 409 STALE with NO mutation (the
   * human always wins: re-read, re-apply, retry). On success the draft is re-rendered
   * in place (revision++) and returns to needs_review. $0 LLM: you compose the redraft.
   */
  revise(reviewId: string, req: SubmitRevisionRequest, signal?: AbortSignal): Promise<Review> {
    return this.ctx.transport.submitRevision(reviewId, req, signal);
  }

  /**
   * Withdraw your own pending review (M5) to the terminal cancelled state. Only the
   * composing agent may cancel; a terminal (already sent) review 409s.
   */
  cancel(
    reviewId: string,
    idempotencyKeyOrSignal?: string | AbortSignal,
    signal?: AbortSignal,
  ): Promise<Review> {
    const idempotencyKey = typeof idempotencyKeyOrSignal === "string" ? idempotencyKeyOrSignal : undefined;
    const effectiveSignal = typeof idempotencyKeyOrSignal === "string" ? signal : idempotencyKeyOrSignal;
    return this.ctx.transport.cancelReview(reviewId, idempotencyKey, effectiveSignal);
  }

  /**
   * Re-stamp a draft's rules-version WITHOUT redrafting (M7; D19/§8 $0 escape valve):
   * assert "I reviewed this against rules vX and no change is needed", advancing the
   * draft's composed_* versions with no new draft, no revision bump, no nudge. A
   * born-stale draft re-stamped to the current version becomes current-enough and
   * releasable on the next reconciliation sweep: the cheap counterpart to revise().
   * against_version above the category's current rules-version is 400; a terminal draft
   * 409s. $0 LLM: you judged.
   */
  restamp(reviewId: string, req: RestampReviewRequest, signal?: AbortSignal): Promise<Review> {
    return this.ctx.transport.restampReview(reviewId, req, signal);
  }

  /**
   * Get the REVIEWER's decision context for a review (M8 Slice B; D5/§9). The reviewer
   * is an AGENT granted review:act, authorized for THIS review ONLY via a matching
   * ACTIVE review-link (per-inbox beats account-wide). The context is the intent +
   * current draft + thread + the two-circuit-breaker budget (hop_count vs max_hops, the
   * hard review_deadline). `force_to_human` is true when a reject would be FORCED to the
   * human regardless of intent (the human is the only terminal authority, D17). A
   * cross-tenant id is 404; a non-reviewer is 403. Read-only, $0 LLM.
   */
  decisionContext(reviewId: string, signal?: AbortSignal): Promise<ReviewDecisionContext> {
    return this.ctx.transport.getReviewDecisionContext(reviewId, signal);
  }

  /**
   * Submit a reviewer decision (M8 Slice B; reviewer_decide, D5/§9). approve/edit → the
   * PLATFORM sends with the COMPOSER's credentials (the reviewer NEVER holds
   * mailbox:send on an inbox it doesn't own: the credential boundary); reject → back to
   * the composer (needs_review, hop_count++); escalate → the human queue. revision/
   * version are the CAS (409 STALE on mismatch, NO mutation: the human always wins,
   * D17). The two circuit breakers (hop_count ≥ max_hops, or the hard review_deadline)
   * FORCE a reject to the human regardless of intent: `forced_by_breaker` names it. $0
   * LLM: you judged; we route, send, and enforce the breakers.
   */
  decide(
    reviewId: string,
    req: ReviewerDecisionRequest,
    signal?: AbortSignal,
  ): Promise<ReviewerDecisionResult> {
    return this.ctx.transport.reviewerDecide(reviewId, req, signal);
  }
}

/**
 * `extrovert.reviews.events`: drain / long-poll / ack the durable review nudge
 * queue (spec §5.9). `list` is a non-blocking, side-effect-free drain of the next
 * un-acked nudges in FIFO seq order (strict per review); `wait` long-polls
 * (~25–55s) for the next one; `ack` advances the per-(agent, review) cursor
 * monotonically (idempotent: re-acking an older seq is a no-op).
 */
export class ReviewEvents {
  constructor(private readonly ctx: ResourceContext) {}

  /** Drain the next un-acked review events (non-blocking). */
  list(params: ListReviewEventsParams = {}, signal?: AbortSignal): Promise<ReviewEventsResult> {
    return this.ctx.transport.listReviewEvents(params, signal);
  }

  /** Long-poll for the next review event (empty on timeout). */
  wait(params: WaitForReviewEventParams = {}, signal?: AbortSignal): Promise<ReviewEventsResult> {
    return this.ctx.transport.waitForReviewEvent(params, signal);
  }

  /** Advance the per-review cursor(s) and/or mark broadcast nudges done. */
  ack(req: AckReviewEventRequest, signal?: AbortSignal): Promise<AckReviewEventResult> {
    return this.ctx.transport.ackReviewEvent(req, signal);
  }
}

/**
 * `extrovert.categories`: the Review Loop category registry (D9/D10). Browse and
 * MATCH an existing category before composing (like a skills registry), or propose
 * a new one. Categories are CUSTOMER-scoped and agent-attributed (the deliberate
 * cross-agent-404 exception); identity is opaque cat_ ids: nothing keys on the
 * name, so renames never break a reference. `match` is a pure lexical filter (NO
 * LLM on our side); the agent does the semantic matching. Merging / deleting a
 * category is a human (console) action, not exposed here (D17).
 */
export class Categories {
  constructor(private readonly ctx: ResourceContext) {}

  /** Browse the registry. `match` lexically filters name+description (NO LLM). */
  list(params: ListCategoriesParams = {}, signal?: AbortSignal): Promise<Page<Category>> {
    return this.ctx.transport.listCategories(params, signal);
  }

  /** Get one category by id (cat_…): name + description + scope + state. */
  get(categoryId: string, signal?: AbortSignal): Promise<Category> {
    return this.ctx.transport.getCategory(categoryId, signal);
  }

  /** Propose a new category; it stands immediately and writes a create audit row. */
  propose(req: ProposeCategoryRequest, signal?: AbortSignal): Promise<Category> {
    return this.ctx.transport.proposeCategory(req, signal);
  }

  /** Rename / re-describe a category: metadata only (D10). */
  update(categoryId: string, req: UpdateCategoryRequest, signal?: AbortSignal): Promise<Category> {
    return this.ctx.transport.updateCategory(categoryId, req, signal);
  }

  /**
   * Read the effective risk dial (D4/D12): the account default + every category's
   * overrides (each with its resolved effective value; null override = inherit).
   * Read-only: agents read but NEVER flip the dial; setting it is a human (console)
   * action (D16).
   */
  riskDial(signal?: AbortSignal): Promise<RiskDial> {
    return this.ctx.transport.getRiskDial(signal);
  }

  /**
   * Read a category's graduation gate status (D16): the gates passed / still needed
   * toward the next rung (approvals N/needed, age, maturity gate, drift vs K,
   * can_graduate). Read-only.
   */
  graduationStatus(categoryId: string, signal?: AbortSignal): Promise<GraduationStatus> {
    return this.ctx.transport.getGraduationStatus(categoryId, signal);
  }

  /**
   * Propose graduating a category (D16/D6): RECORDS the request (durable evidence) and
   * returns the current gate status. It does NOT change the category state: flipping
   * the bit is a human (console) action; an agent only proposes.
   */
  proposeGraduation(
    categoryId: string,
    req: ProposeGraduationRequest = {},
    signal?: AbortSignal,
  ): Promise<GraduationStatus> {
    return this.ctx.transport.proposeGraduation(categoryId, req, signal);
  }

  /**
   * Read the D19/§8 backlog-reconciliation status: how many of the category's QUEUED
   * drafts are stale vs current-enough against the current rules-version (a pure
   * integer compare, $0 LLM). Read-only: you READ the picture; the human (console
   * scan-backlog) or the graduate/rule-change hooks TRIGGER the actual reconciliation
   * sweep that releases current-enough drafts and nudges stale ones to redraft.
   */
  backlogStatus(categoryId: string, signal?: AbortSignal): Promise<ScanBacklogStatus> {
    return this.ctx.transport.getScanBacklogStatus(categoryId, signal);
  }

  /**
   * Read the demand-driven pacing state (M7 Slice B/§8): the human review cursor, the
   * effective lookahead window (freshness is guaranteed only for the next few drafts
   * after the cursor), the HARD per-nudge fan-out ceiling (rework_batch_max), the
   * per-agent nudge interval, and each queued draft's classification (behind_cursor |
   * in_window_fresh | in_window_redrafting | ahead). Read-only; the cursor advances
   * from the human's console approve/reject/edit actions.
   */
  pacingState(categoryId: string, signal?: AbortSignal): Promise<CategoryPacingState> {
    return this.ctx.transport.getCategoryPacingState(categoryId, signal);
  }
}

/**
 * `extrovert.rules`: the Review Loop writing-rule store + house-style + the §7
 * precedence ladder + audit/undo (D2/D11). ANY agent in the customer may write,
 * edit, promote, retire, and undo rules (the deliberate cross-agent exception: the
 * shared house-style is the whole pitch). `get()` returns the ORDERED active rule
 * set with the precedence ladder applied SERVER-SIDE (NO LLM on our side); the agent
 * reconciles the list semantically. Rules are append-only by supersession; undo
 * restores the prior version as a forward 'restore' supersession. Identity is opaque
 * rule_/rln_/udo_ ids: nothing keys on a name.
 */
export class Rules {
  /** Learn category or organization house rules from verified human review feedback. */
  learnFromReview(reviewId: string, req: LearnReviewRuleRequest, signal?: AbortSignal): Promise<LearnedReviewRule> {
    return this.ctx.transport.learnReviewRule(reviewId, req, signal);
  }

  constructor(private readonly ctx: ResourceContext) {}

  /** Get the ORDERED active rule set (precedence ladder applied; NO LLM). */
  get(params: GetRulesParams = {}, signal?: AbortSignal): Promise<RuleSnapshot> {
    return this.ctx.transport.getRules(params, signal);
  }

  /**
   * Save / edit a rule (append-only by supersession; D11). An agent-plane save is
   * ALWAYS project-layer: the saved rule's `rule_layer` is `project`, bound to the
   * key's project. For all authenticated reviewer feedback use learnFromReview at the intended
   * organization, project, or category scope. This method is project maintenance only.
   */
  save(req: SaveRuleRequest, signal?: AbortSignal): Promise<Rule> {
    return this.ctx.transport.saveRule(req, signal);
  }

  /** Promote a rule between the category and general/house-style layers. */
  promote(ruleId: string, toScope: "general" | "category", signal?: AbortSignal): Promise<Rule> {
    return this.ctx.transport.promoteRule(ruleId, toScope, signal);
  }

  /** Retire a rule: soft delete; the history survives as training data. */
  retire(ruleId: string, signal?: AbortSignal): Promise<Rule> {
    return this.ctx.transport.retireRule(ruleId, signal);
  }

  /** Read the rule/category change audit log (the safety net, D11). */
  audit(params: GetRuleAuditParams = {}, signal?: AbortSignal): Promise<Page<RuleAuditEntry>> {
    return this.ctx.transport.getRuleAudit(params, signal);
  }

  /** Undo a rule change by its audit-row id (udo_…): restore the prior version. */
  undo(udoId: string, signal?: AbortSignal): Promise<Rule> {
    return this.ctx.transport.undoRuleChange(udoId, signal);
  }
}
