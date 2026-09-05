/**
 * Transport abstraction.
 *
 * The resource methods speak a small, typed RPC surface; a transport decides whether each call hits
 * the live Extrovert API over HTTP or the offline {@link MockBackend}. This is the single mock seam:
 * flip `transport: "mock"` (or `EXTROVERT_API_BASE_URL=mock`) and the whole SDK runs without a network.
 *
 * `HttpTransport` is used for the live API; the mock stays for examples, docs, and tests.
 */

import { HttpClient, type BinaryResponse, type RequestOptions } from "./http.js";
import { MockBackend } from "./fixtures.js";
import { NotFoundError, ValidationError } from "./errors.js";
import type { List } from "./pagination.js";
import { serializeInclude } from "./include.js";
import { toWireArray } from "./recipients.js";
import type {
  AddContactListRequest,
  Attachment,
  BatchUpdateMessagesRequest,
  BatchUpdateResult,
  Category,
  CommerceRequest,
  ContactListEntry,
  AckReviewEventRequest,
  AckReviewEventResult,
  CreateInboxRequest,
  DeleteResult,
  Domain,
  DomainStatusEventPage,
  DomainQuote,
  DomainOffboard,
  EnrollRequest,
  EnrollResponse,
  ForwardRequest,
  GetInboxParams,
  Inbox,
  InboxCredentials,
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
  ListThreadsParams,
  MarkReadRequest,
  Message,
  Page,
  PostReviewChatRequest,
  RegisterWebhookRequest,
  ReplyRequest,
  CategoryPacingState,
  RestampReviewRequest,
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
  SendRequest,
  SignUpRequest,
  SignUpResponse,
  StreamEvent,
  SubmitRevisionRequest,
  SuppressionEntry,
  SuppressionPrecheck,
  ListSuppressionsParams,
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

/** Raw bytes of one attachment plus the metadata needed to save/serve it. */
export interface AttachmentDownload {
  filename: string;
  content_type: string;
  /** Standard base64 of the attachment bytes. */
  content_base64: string;
}

/** The RPC surface every transport implements. One method per spec §8 endpoint. */
export interface Transport {
  enroll(req: EnrollRequest, signal?: AbortSignal): Promise<EnrollResponse>;
  signUp(req: SignUpRequest, signal?: AbortSignal): Promise<SignUpResponse>;
  verify(req: VerifyRequest, signal?: AbortSignal): Promise<VerifyResponse>;
  whoami(signal?: AbortSignal): Promise<WhoAmI>;
  createInbox(req: CreateInboxRequest, idempotencyKey?: string, signal?: AbortSignal): Promise<Inbox>;
  listInboxes(params: ListInboxesParams, signal?: AbortSignal): Promise<Page<Inbox>>;
  getInbox(address: string, signal?: AbortSignal): Promise<Inbox>;
  updateInbox(address: string, req: UpdateInboxRequest, signal?: AbortSignal): Promise<Inbox>;
  deleteInbox(address: string, signal?: AbortSignal): Promise<void>;
  // ---- Canonical project-prefixed inbox chain (x.projects.inboxes.*) ----------
  // These map to /v1/projects/{project_id}/inboxes[/{inbox_id}], return the redesign
  // List envelope on list, and key single-row ops by the opaque inbox_id (an address
  // is accepted as a within-project alias). project_id may be "-" (org wildcard).
  createInboxInProject(
    projectId: string,
    req: CreateInboxRequest,
    idempotencyKey?: string,
    signal?: AbortSignal,
  ): Promise<Inbox>;
  listInboxesInProject(
    projectId: string,
    params: ProjectInboxListParams,
    signal?: AbortSignal,
  ): Promise<List<Inbox>>;
  getInboxInProject(
    projectId: string,
    inboxId: string,
    params: GetInboxParams,
    signal?: AbortSignal,
  ): Promise<Inbox>;
  updateInboxInProject(
    projectId: string,
    inboxId: string,
    req: UpdateInboxRequest,
    signal?: AbortSignal,
  ): Promise<Inbox>;
  deleteInboxInProject(projectId: string, inboxId: string, signal?: AbortSignal): Promise<void>;
  getInboxCredentialsInProject(
    projectId: string,
    inboxId: string,
    signal?: AbortSignal,
  ): Promise<InboxCredentials>;
  // send / reply / forward all answer the same three-way SendOutcome union: the
  // resolved review policy decides whether a message is delivered now or parked
  // for a human, and the caller does not get to opt out of that decision.
  send(address: string, req: SendRequest, signal?: AbortSignal): Promise<SendOutcome>;
  reply(address: string, req: ReplyRequest, signal?: AbortSignal): Promise<SendOutcome>;
  forward(address: string, messageId: string, req: ForwardRequest, signal?: AbortSignal): Promise<SendOutcome>;
  listMessages(address: string, params: ListMessagesParams, signal?: AbortSignal): Promise<Page<Message>>;
  getMessage(messageId: string, signal?: AbortSignal): Promise<Message>;
  getMessageRaw(address: string, messageId: string, signal?: AbortSignal): Promise<string>;
  listAttachments(address: string, messageId: string, signal?: AbortSignal): Promise<Page<Attachment>>;
  getAttachment(
    address: string,
    messageId: string,
    attachmentId: string,
    signal?: AbortSignal,
  ): Promise<AttachmentDownload>;
  markRead(address: string, messageId: string, req: MarkReadRequest, signal?: AbortSignal): Promise<Message>;
  deleteMessage(address: string, messageId: string, expunge?: boolean, signal?: AbortSignal): Promise<DeleteResult>;
  batchUpdateMessages(
    address: string,
    req: BatchUpdateMessagesRequest,
    signal?: AbortSignal,
  ): Promise<BatchUpdateResult>;
  searchMessages(address: string, params: SearchMessagesParams, signal?: AbortSignal): Promise<Page<Message>>;
  listThreads(address: string, params: ListThreadsParams, signal?: AbortSignal): Promise<Page<Thread>>;
  searchThreads(address: string, params: SearchMessagesParams, signal?: AbortSignal): Promise<Page<Thread>>;
  getThread(address: string, threadId: string, signal?: AbortSignal): Promise<ThreadDetail>;
  getSubmission(address: string, submissionId: string, signal?: AbortSignal): Promise<Submission>;
  getSubmissionInProject(projectId: string, inboxId: string, submissionId: string, signal?: AbortSignal): Promise<Submission>;
  deleteThread(address: string, threadId: string, expunge?: boolean, signal?: AbortSignal): Promise<DeleteResult>;
  waitForEmail(
    address: string,
    req: WaitForEmailRequest,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<WaitForEmailResult>;
  registerWebhook(req: RegisterWebhookRequest, signal?: AbortSignal): Promise<Webhook>;
  listWebhooks(signal?: AbortSignal): Promise<Page<Webhook>>;
  getWebhook(webhookId: string, signal?: AbortSignal): Promise<Webhook>;
  updateWebhook(webhookId: string, req: UpdateWebhookRequest, signal?: AbortSignal): Promise<Webhook>;
  deleteWebhook(webhookId: string, signal?: AbortSignal): Promise<void>;
  addContactListEntry(
    address: string,
    req: AddContactListRequest,
    signal?: AbortSignal,
  ): Promise<ContactListEntry>;
  listContactLists(address: string, signal?: AbortSignal): Promise<Page<ContactListEntry>>;
  deleteContactListEntry(address: string, entryId: string, signal?: AbortSignal): Promise<void>;
  // Suppressions (recipient opt-outs) - customer/org-scoped, not inbox-keyed.
  // precheck is the read-only "is this recipient opted out of MY org's mail?"; the
  // list pages the caller's own org rows; revoke re-enables one row (reason required).
  precheckSuppression(recipient: string, signal?: AbortSignal): Promise<SuppressionPrecheck>;
  listSuppressions(params: ListSuppressionsParams, signal?: AbortSignal): Promise<Page<SuppressionEntry>>;
  revokeSuppression(id: string, reason: string, signal?: AbortSignal): Promise<SuppressionEntry>;
  listDomains(signal?: AbortSignal, params?: { page?: string; limit?: number }): Promise<Page<Domain>>;
  listDomainEvents(domain: string, params: { after?: string; limit?: number }, signal?: AbortSignal): Promise<DomainStatusEventPage>;
  getDomain(domain: string, signal?: AbortSignal): Promise<Domain>;
  onboardDomain(req: OnboardDomainRequest, signal?: AbortSignal): Promise<Domain>;
  verifyDomain(domain: string, signal?: AbortSignal): Promise<Domain>;
  offboardDomain(domain: string, signal?: AbortSignal): Promise<DomainOffboard>;
  // Poll surface for an async job the agent enqueued (currently only the
  // domain-offboard teardown's status_url).
  getJob(jobId: string, signal?: AbortSignal): Promise<Job>;
  // Commerce request plane. These methods never expose human approval mutations.
  quoteDomain(req: QuoteDomainRequest, signal?: AbortSignal): Promise<DomainQuote>;
  requestDomainPurchase(req: RequestDomainPurchaseRequest, signal?: AbortSignal): Promise<CommerceRequest>;
  requestPlanChange(req: RequestPlanChangeRequest, signal?: AbortSignal): Promise<CommerceRequest>;
  getCommerceRequest(requestId: string, signal?: AbortSignal): Promise<CommerceRequest>;
  cancelCommerceRequest(requestId: string, signal?: AbortSignal): Promise<CommerceRequest>;
  listCommerceRequests(params: ListCommerceRequestsParams, signal?: AbortSignal): Promise<Page<CommerceRequest>>;
  // Review Loop (HITL): submit-for-review rides send/reply - literally the same
  // endpoints, so it answers the same SendOutcome union. It stays a distinct
  // method because it NAMES the intent of the call; a submit that omits `intent`
  // under require_review raises IntentRequiredError from either entry point.
  submitForReview(address: string, req: SendRequest, signal?: AbortSignal): Promise<SendOutcome>;
  submitReplyForReview(
    address: string,
    req: ReplyRequest,
    signal?: AbortSignal,
  ): Promise<SendOutcome>;
  listReviews(params: ListReviewsParams, signal?: AbortSignal): Promise<Page<Review>>;
  getReview(reviewId: string, signal?: AbortSignal): Promise<Review>;
  getReviewTurns(reviewId: string, signal?: AbortSignal): Promise<Page<ReviewTurn>>;
  // Review Loop (HITL) per-message CHAT + revision + cancel + feedback (M5). chat
  // takes an Idempotency-Key; submit_revision CASes on parent_revision (409 STALE).
  getReviewFeedback(reviewId: string, signal?: AbortSignal): Promise<ReviewFeedback>;
  postReviewChat(reviewId: string, req: PostReviewChatRequest, idempotencyKey?: string, signal?: AbortSignal): Promise<Review>;
  submitRevision(reviewId: string, req: SubmitRevisionRequest, signal?: AbortSignal): Promise<Review>;
  cancelReview(reviewId: string, idempotencyKey?: string, signal?: AbortSignal): Promise<Review>;
  // D19/§8 re-stamp-without-redraft escape valve ($0): assert "reviewed against vX, no
  // change needed" and advance composed_* WITHOUT a new draft.
  restampReview(reviewId: string, req: RestampReviewRequest, signal?: AbortSignal): Promise<Review>;
  // BYO review-agent DECISION plane (M8 Slice B; D5/§9). The reviewer (review:act + a
  // matching active link) reads its decision context, then decides approve|edit|reject|
  // escalate. On approve/edit the PLATFORM sends with the COMPOSER's creds (the
  // reviewer NEVER holds mailbox:send); the two circuit breakers force a maxed-out
  // review to the human regardless of intent.
  getReviewDecisionContext(reviewId: string, signal?: AbortSignal): Promise<ReviewDecisionContext>;
  reviewerDecide(reviewId: string, req: ReviewerDecisionRequest, signal?: AbortSignal): Promise<ReviewerDecisionResult>;
  // Review Loop (HITL) realtime: the durable nudge drain/ack/wait lifecycle. The
  // queue is the authoritative liveness source; SSE/webhook are fast paths atop it.
  listReviewEvents(params: ListReviewEventsParams, signal?: AbortSignal): Promise<ReviewEventsResult>;
  waitForReviewEvent(params: WaitForReviewEventParams, signal?: AbortSignal): Promise<ReviewEventsResult>;
  ackReviewEvent(req: AckReviewEventRequest, signal?: AbortSignal): Promise<AckReviewEventResult>;
  // Category registry (Review Loop, D9/D10): browse / propose / rename. Customer-
  // scoped + agent-attributed (the cross-agent-404 exception). match= is lexical.
  listCategories(params: ListCategoriesParams, signal?: AbortSignal): Promise<Page<Category>>;
  getCategory(categoryId: string, signal?: AbortSignal): Promise<Category>;
  proposeCategory(req: ProposeCategoryRequest, signal?: AbortSignal): Promise<Category>;
  updateCategory(categoryId: string, req: UpdateCategoryRequest, signal?: AbortSignal): Promise<Category>;
  // Graduation + risk dial (Review Loop, D16/D6/D17): agents READ the effective dial +
  // a category's graduation status, and PROPOSE graduation (records the request; never
  // flips the bit). Flipping the bit + setting the dial are console (human) actions.
  getRiskDial(signal?: AbortSignal): Promise<RiskDial>;
  getGraduationStatus(categoryId: string, signal?: AbortSignal): Promise<GraduationStatus>;
  proposeGraduation(categoryId: string, req: ProposeGraduationRequest, signal?: AbortSignal): Promise<GraduationStatus>;
  // D19/§8 backlog-reconciliation status (read-only): how many queued drafts are stale
  // vs current-enough against the current rules-version. Agents READ; humans/hooks TRIGGER.
  getScanBacklogStatus(categoryId: string, signal?: AbortSignal): Promise<ScanBacklogStatus>;
  // M7 Slice B/§8 demand-driven pacing state (read-only): the human review cursor, the
  // effective window/ceiling/interval, and each queued draft's classification.
  getCategoryPacingState(categoryId: string, signal?: AbortSignal): Promise<CategoryPacingState>;
  // Writing rules + house-style + precedence ladder + audit/undo (D2/D11). ANY
  // agent may write/edit/promote/retire/undo (the cross-agent exception); get_rules
  // returns the ORDERED list with the §7 ladder applied server-side (NO LLM).
  getRules(params: GetRulesParams, signal?: AbortSignal): Promise<RuleSnapshot>;
  learnReviewRule(reviewId: string, req: LearnReviewRuleRequest, signal?: AbortSignal): Promise<LearnedReviewRule>;
  saveRule(req: SaveRuleRequest, signal?: AbortSignal): Promise<Rule>;
  promoteRule(ruleId: string, toScope: "general" | "category", signal?: AbortSignal): Promise<Rule>;
  retireRule(ruleId: string, signal?: AbortSignal): Promise<Rule>;
  getRuleAudit(params: GetRuleAuditParams, signal?: AbortSignal): Promise<Page<RuleAuditEntry>>;
  undoRuleChange(udoId: string, signal?: AbortSignal): Promise<Rule>;
  /**
   * Open a live event stream. `address` scopes to one inbox (`GET
   * /v1/inboxes/{addr}/stream`); pass `null` for every owned inbox (`GET
   * /v1/events`). `lastEventId`, when set, resumes after that event seq. The
   * generator ends when the server closes the stream or `signal` aborts.
   */
  stream(
    address: string | null,
    lastEventId?: number,
    signal?: AbortSignal,
  ): AsyncGenerator<StreamEvent, void, unknown>;
}

// ---------------------------------------------------------------------------
// Wire-body builders for the three outbound verbs.
//
// The SDK's request types are ergonomic (`to` may be a bare string) and carry one
// field that is NOT a body field at all (`idempotency_key`, which belongs in a
// header). Shipping the caller's object verbatim - which is what these methods
// used to do - sent both problems straight to a server that decodes with
// DisallowUnknownFields and `[]string` recipients, so a documented, typechecked
// call 400'd on the wire. These builders are the one boundary where the
// ergonomic shape becomes the wire shape:
//
//   1. `idempotency_key` is REMOVED from the body and set as `Idempotency-Key`.
//      The server tolerates it in the body for already-shipped builds, but it
//      must not be there: the replay key is a hash of the raw body, so a key
//      carried inside its own hashed payload is self-referential noise.
//   2. `to` / `cc` / `bcc` are widened from `string | string[]` to `string[]`.
//      An absent field stays absent - emitting `cc: []` would add a key the
//      caller never wrote.
//   3. Nothing is RENAMED. `text` is the canonical name on both sides; that is
//      the whole reason `text` was chosen over the server's old `body`.
// ---------------------------------------------------------------------------

/** Strip the header-only `idempotency_key` from a request object. */
function withoutIdempotencyKey<T extends { idempotency_key?: string }>(req: T): Omit<T, "idempotency_key"> {
  const { idempotency_key: _headerOnly, ...rest } = req;
  return rest;
}

/**
 * Drop keys whose value is `undefined` so an omitted optional never reaches the
 * wire as an explicit `null`/`undefined` entry. `JSON.stringify` already elides
 * `undefined` values, so this is belt-and-braces for readability of the emitted
 * body in tests.
 */
function omitUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out = {} as Record<string, unknown>;
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out as T;
}

/** The JSON body for `POST /v1/inboxes/{addr}/send`. */
function sendBody(req: SendRequest): Record<string, unknown> {
  return omitUndefined({
    ...withoutIdempotencyKey(req),
    to: toWireArray(req.to),
    cc: toWireArray(req.cc),
    bcc: toWireArray(req.bcc),
  });
}

/** The JSON body for `POST /v1/inboxes/{addr}/reply` (recipients are derived server-side). */
function replyBody(req: ReplyRequest): Record<string, unknown> {
  return omitUndefined({
    ...withoutIdempotencyKey(req),
    cc: toWireArray(req.cc),
    bcc: toWireArray(req.bcc),
  });
}

/** The JSON body for `POST /v1/inboxes/{addr}/messages/{id}/forward`. */
function forwardBody(req: ForwardRequest): Record<string, unknown> {
  return omitUndefined({
    ...withoutIdempotencyKey(req),
    to: toWireArray(req.to),
    cc: toWireArray(req.cc),
    bcc: toWireArray(req.bcc),
  });
}

/** Live transport: each method maps to a `/v1` request. */
export class HttpTransport implements Transport {
  constructor(private readonly http: HttpClient) {}

  private encodeAddress(address: string): string {
    return encodeURIComponent(address);
  }

  private call<T>(opts: RequestOptions): Promise<T> {
    return this.http.request<T>(opts);
  }

  enroll(req: EnrollRequest, signal?: AbortSignal): Promise<EnrollResponse> {
    return this.call({ method: "POST", path: "/v1/enroll", body: req, idempotencyKey: req.client_id, signal });
  }

  signUp(req: SignUpRequest, signal?: AbortSignal): Promise<SignUpResponse> {
    return this.call({ method: "POST", path: "/v1/agent/sign-up", body: req, signal });
  }

  verify(req: VerifyRequest, signal?: AbortSignal): Promise<VerifyResponse> {
    return this.call({ method: "POST", path: "/v1/agent/verify", body: req, signal });
  }

  whoami(signal?: AbortSignal): Promise<WhoAmI> {
    return this.call({ method: "GET", path: "/v1/auth/me", signal });
  }

  createInbox(req: CreateInboxRequest, idempotencyKey?: string, signal?: AbortSignal): Promise<Inbox> {
    return this.call({
      method: "POST",
      path: "/v1/inboxes",
      body: req,
      idempotencyKey: idempotencyKey ?? req.client_id,
      signal,
    });
  }

  async listInboxes(params: ListInboxesParams, signal?: AbortSignal): Promise<Page<Inbox>> {
    // The bare GET /v1/inboxes returns the legacy `{inboxes, next_page}` shape (frozen
    // OpenAPI listInboxes), NOT the `{items, total, next_cursor}` Page envelope. Remap
    // it here so `page.items` / `page.next_cursor` are populated against the live API
    // (`inboxes` and `next_page` are dropped raw otherwise). Mirrors the MCP client.
    const raw = await this.call<{
      inboxes?: Inbox[];
      items?: Inbox[];
      next_page?: string;
      next_cursor?: string;
    }>({ method: "GET", path: "/v1/inboxes", query: { ...params }, signal });
    const items = raw.inboxes ?? raw.items ?? [];
    const page: Page<Inbox> = { items, total: items.length };
    const cursor = raw.next_cursor ?? raw.next_page;
    if (cursor) page.next_cursor = cursor;
    return page;
  }

  getInbox(address: string, signal?: AbortSignal): Promise<Inbox> {
    return this.call({ method: "GET", path: `/v1/inboxes/${this.encodeAddress(address)}`, signal });
  }

  updateInbox(address: string, req: UpdateInboxRequest, signal?: AbortSignal): Promise<Inbox> {
    return this.call({
      method: "PATCH",
      path: `/v1/inboxes/${this.encodeAddress(address)}`,
      body: req,
      signal,
    });
  }

  async deleteInbox(address: string, signal?: AbortSignal): Promise<void> {
    await this.call({ method: "DELETE", path: `/v1/inboxes/${this.encodeAddress(address)}`, signal });
  }

  // ---- Canonical project-prefixed inbox chain (x.projects.inboxes.*) ----------

  createInboxInProject(
    projectId: string,
    req: CreateInboxRequest,
    idempotencyKey?: string,
    signal?: AbortSignal,
  ): Promise<Inbox> {
    return this.call({
      method: "POST",
      path: `/v1/projects/${encodeURIComponent(projectId)}/inboxes`,
      body: req,
      idempotencyKey: idempotencyKey ?? req.client_id,
      signal,
    });
  }

  listInboxesInProject(
    projectId: string,
    params: ProjectInboxListParams,
    signal?: AbortSignal,
  ): Promise<List<Inbox>> {
    return this.call({
      method: "GET",
      path: `/v1/projects/${encodeURIComponent(projectId)}/inboxes`,
      query: {
        limit: params.limit,
        cursor: params.cursor,
        include: serializeInclude(params.include),
      },
      signal,
    });
  }

  getInboxInProject(
    projectId: string,
    inboxId: string,
    params: GetInboxParams,
    signal?: AbortSignal,
  ): Promise<Inbox> {
    return this.call({
      method: "GET",
      path: `/v1/projects/${encodeURIComponent(projectId)}/inboxes/${encodeURIComponent(inboxId)}`,
      query: { include: serializeInclude(params.include) },
      signal,
    });
  }

  updateInboxInProject(
    projectId: string,
    inboxId: string,
    req: UpdateInboxRequest,
    signal?: AbortSignal,
  ): Promise<Inbox> {
    return this.call({
      method: "PATCH",
      path: `/v1/projects/${encodeURIComponent(projectId)}/inboxes/${encodeURIComponent(inboxId)}`,
      body: req,
      signal,
    });
  }

  async deleteInboxInProject(projectId: string, inboxId: string, signal?: AbortSignal): Promise<void> {
    await this.call({
      method: "DELETE",
      path: `/v1/projects/${encodeURIComponent(projectId)}/inboxes/${encodeURIComponent(inboxId)}`,
      signal,
    });
  }

  getInboxCredentialsInProject(
    projectId: string,
    inboxId: string,
    signal?: AbortSignal,
  ): Promise<InboxCredentials> {
    return this.call({
      method: "GET",
      path: `/v1/projects/${encodeURIComponent(projectId)}/inboxes/${encodeURIComponent(inboxId)}/credentials`,
      signal,
    });
  }

  send(address: string, req: SendRequest, signal?: AbortSignal): Promise<SendOutcome> {
    return this.call({
      method: "POST",
      path: `/v1/inboxes/${this.encodeAddress(address)}/send`,
      body: sendBody(req),
      idempotencyKey: req.idempotency_key,
      signal,
    });
  }

  reply(address: string, req: ReplyRequest, signal?: AbortSignal): Promise<SendOutcome> {
    return this.call({
      method: "POST",
      path: `/v1/inboxes/${this.encodeAddress(address)}/reply`,
      body: replyBody(req),
      idempotencyKey: req.idempotency_key,
      signal,
    });
  }

  forward(address: string, messageId: string, req: ForwardRequest, signal?: AbortSignal): Promise<SendOutcome> {
    return this.call({
      method: "POST",
      path: `/v1/inboxes/${this.encodeAddress(address)}/messages/${encodeURIComponent(messageId)}/forward`,
      body: forwardBody(req),
      idempotencyKey: req.idempotency_key,
      signal,
    });
  }

  listMessages(address: string, params: ListMessagesParams, signal?: AbortSignal): Promise<Page<Message>> {
    return this.call({
      method: "GET",
      path: `/v1/inboxes/${this.encodeAddress(address)}/messages`,
      query: { ...params },
      signal,
    });
  }

  getMessage(messageId: string, signal?: AbortSignal): Promise<Message> {
    return this.call({ method: "GET", path: `/v1/messages/${encodeURIComponent(messageId)}`, signal });
  }

  getMessageRaw(address: string, messageId: string, signal?: AbortSignal): Promise<string> {
    return this.call({
      method: "GET",
      path: `/v1/inboxes/${this.encodeAddress(address)}/messages/${encodeURIComponent(messageId)}/raw`,
      raw: true,
      signal,
    });
  }

  listAttachments(address: string, messageId: string, signal?: AbortSignal): Promise<Page<Attachment>> {
    return this.call({
      method: "GET",
      path: `/v1/inboxes/${this.encodeAddress(address)}/messages/${encodeURIComponent(messageId)}/attachments`,
      signal,
    });
  }

  async getAttachment(
    address: string,
    messageId: string,
    attachmentId: string,
    signal?: AbortSignal,
  ): Promise<AttachmentDownload> {
    const res = await this.http.request<BinaryResponse>({
      method: "GET",
      path: `/v1/inboxes/${this.encodeAddress(address)}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
      binary: true,
      signal,
    });
    return {
      filename: filenameFromDisposition(res.contentDisposition),
      content_type: res.contentType,
      content_base64: bytesToBase64(res.bytes),
    };
  }

  markRead(address: string, messageId: string, req: MarkReadRequest, signal?: AbortSignal): Promise<Message> {
    return this.call({
      method: "PATCH",
      path: `/v1/inboxes/${this.encodeAddress(address)}/messages/${encodeURIComponent(messageId)}`,
      body: req,
      signal,
    });
  }

  deleteMessage(
    address: string,
    messageId: string,
    expunge?: boolean,
    signal?: AbortSignal,
  ): Promise<DeleteResult> {
    return this.call({
      method: "DELETE",
      path: `/v1/inboxes/${this.encodeAddress(address)}/messages/${encodeURIComponent(messageId)}`,
      query: expunge ? { expunge: true } : undefined,
      signal,
    });
  }

  batchUpdateMessages(
    address: string,
    req: BatchUpdateMessagesRequest,
    signal?: AbortSignal,
  ): Promise<BatchUpdateResult> {
    return this.call({
      method: "PATCH",
      path: `/v1/inboxes/${this.encodeAddress(address)}/messages/batch`,
      body: req,
      signal,
    });
  }

  searchMessages(address: string, params: SearchMessagesParams, signal?: AbortSignal): Promise<Page<Message>> {
    return this.call({
      method: "GET",
      path: `/v1/inboxes/${this.encodeAddress(address)}/messages/search`,
      query: { ...params },
      signal,
    });
  }

  listThreads(address: string, params: ListThreadsParams, signal?: AbortSignal): Promise<Page<Thread>> {
    return this.call({
      method: "GET",
      path: `/v1/inboxes/${this.encodeAddress(address)}/threads`,
      query: { ...params },
      signal,
    });
  }

  searchThreads(address: string, params: SearchMessagesParams, signal?: AbortSignal): Promise<Page<Thread>> {
    return this.call({
      method: "GET",
      path: `/v1/inboxes/${this.encodeAddress(address)}/threads/search`,
      query: { ...params },
      signal,
    });
  }

  getThread(address: string, threadId: string, signal?: AbortSignal): Promise<ThreadDetail> {
    return this.call({
      method: "GET",
      path: `/v1/inboxes/${this.encodeAddress(address)}/threads/${encodeURIComponent(threadId)}`,
      signal,
    });
  }

  getSubmission(address: string, submissionId: string, signal?: AbortSignal): Promise<Submission> {
    return this.call({ method: "GET", path: `/v1/inboxes/${this.encodeAddress(address)}/submissions/${encodeURIComponent(submissionId)}`, signal });
  }
  getSubmissionInProject(projectId: string, inboxId: string, submissionId: string, signal?: AbortSignal): Promise<Submission> {
    return this.call({ method: "GET", path: `/v1/projects/${encodeURIComponent(projectId)}/inboxes/${encodeURIComponent(inboxId)}/submissions/${encodeURIComponent(submissionId)}`, signal });
  }

  deleteThread(
    address: string,
    threadId: string,
    expunge?: boolean,
    signal?: AbortSignal,
  ): Promise<DeleteResult> {
    return this.call({
      method: "DELETE",
      path: `/v1/inboxes/${this.encodeAddress(address)}/threads/${encodeURIComponent(threadId)}`,
      query: expunge ? { expunge: true } : undefined,
      signal,
    });
  }

  waitForEmail(
    address: string,
    req: WaitForEmailRequest,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<WaitForEmailResult> {
    return this.call({
      method: "POST",
      path: `/v1/inboxes/${this.encodeAddress(address)}/wait`,
      body: req,
      // The server blocks up to req.timeout_seconds; give the HTTP read a small margin over it.
      timeoutMs,
      retryable: false,
      signal,
    });
  }

  registerWebhook(req: RegisterWebhookRequest, signal?: AbortSignal): Promise<Webhook> {
    return this.call({ method: "POST", path: "/v1/webhooks", body: req, idempotencyKey: req.client_id, signal });
  }

  listWebhooks(signal?: AbortSignal): Promise<Page<Webhook>> {
    return this.call({ method: "GET", path: "/v1/webhooks", signal });
  }

  getWebhook(webhookId: string, signal?: AbortSignal): Promise<Webhook> {
    return this.call({ method: "GET", path: `/v1/webhooks/${encodeURIComponent(webhookId)}`, signal });
  }

  updateWebhook(webhookId: string, req: UpdateWebhookRequest, signal?: AbortSignal): Promise<Webhook> {
    return this.call({
      method: "PATCH",
      path: `/v1/webhooks/${encodeURIComponent(webhookId)}`,
      body: req,
      signal,
    });
  }

  async deleteWebhook(webhookId: string, signal?: AbortSignal): Promise<void> {
    await this.call({ method: "DELETE", path: `/v1/webhooks/${encodeURIComponent(webhookId)}`, signal });
  }

  addContactListEntry(
    address: string,
    req: AddContactListRequest,
    signal?: AbortSignal,
  ): Promise<ContactListEntry> {
    return this.call({
      method: "POST",
      path: `/v1/inboxes/${this.encodeAddress(address)}/lists`,
      body: req,
      signal,
    });
  }

  listContactLists(address: string, signal?: AbortSignal): Promise<Page<ContactListEntry>> {
    return this.call({ method: "GET", path: `/v1/inboxes/${this.encodeAddress(address)}/lists`, signal });
  }

  async deleteContactListEntry(address: string, entryId: string, signal?: AbortSignal): Promise<void> {
    await this.call({
      method: "DELETE",
      path: `/v1/inboxes/${this.encodeAddress(address)}/lists/${encodeURIComponent(entryId)}`,
      signal,
    });
  }

  precheckSuppression(recipient: string, signal?: AbortSignal): Promise<SuppressionPrecheck> {
    // A `recipient` query param routes the server to the pre-check shape
    // ({recipient, suppressed, rows}) rather than the paged list.
    return this.call({ method: "GET", path: "/v1/suppressions", query: { recipient }, signal });
  }

  listSuppressions(params: ListSuppressionsParams, signal?: AbortSignal): Promise<Page<SuppressionEntry>> {
    // Note: no `recipient` here - that param switches the server to the pre-check.
    return this.call({
      method: "GET",
      path: "/v1/suppressions",
      query: {
        scope: params.scope,
        include_revoked: params.include_revoked ? "true" : undefined,
        limit: params.limit,
        cursor: params.cursor,
      },
      signal,
    });
  }

  revokeSuppression(id: string, reason: string, signal?: AbortSignal): Promise<SuppressionEntry> {
    return this.call({
      method: "POST",
      path: `/v1/suppressions/${encodeURIComponent(id)}/revoke`,
      body: { reason },
      signal,
    });
  }

  listDomains(signal?: AbortSignal, params: { page?: string; limit?: number } = {}): Promise<Page<Domain>> {
    return this.call({ method: "GET", path: "/v1/domains", query: params, signal });
  }

  listDomainEvents(domain: string, params: { after?: string; limit?: number }, signal?: AbortSignal): Promise<DomainStatusEventPage> {
    return this.call({ method: "GET", path: `/v1/domains/${encodeURIComponent(domain)}/events`, query: params, signal });
  }

  getDomain(domain: string, signal?: AbortSignal): Promise<Domain> {
    return this.call({ method: "GET", path: `/v1/domains/${encodeURIComponent(domain)}`, signal });
  }

  onboardDomain(req: OnboardDomainRequest, signal?: AbortSignal): Promise<Domain> {
    return this.call({ method: "POST", path: "/v1/domains", body: req, signal });
  }

  // Delegated domains perform an immediate authoritative DNS check. Inspect
  // delegation.status separately from mail readiness; 429 requests may be retried.
  verifyDomain(domain: string, signal?: AbortSignal): Promise<Domain> {
    return this.call({
      method: "POST",
      path: `/v1/domains/${encodeURIComponent(domain)}/verify`,
      signal,
    });
  }

  async offboardDomain(domain: string, signal?: AbortSignal): Promise<DomainOffboard> {
    // Async contract: the API accepts the offboard (HTTP 202) and returns the
    // teardown job to poll; the request body carries { job_id, status, status_url }.
    const res = await this.call<Partial<DomainOffboard>>({
      method: "DELETE",
      path: `/v1/domains/${encodeURIComponent(domain)}`,
      signal,
    });
    const jobId = res?.job_id ?? "";
    return {
      domain,
      job_id: jobId,
      status: res?.status ?? "queued",
      status_url: res?.status_url ?? (jobId ? `/v1/jobs/${jobId}` : ""),
    };
  }

  getJob(jobId: string, signal?: AbortSignal): Promise<Job> {
    return this.call({ method: "GET", path: `/v1/jobs/${encodeURIComponent(jobId)}`, signal });
  }

  quoteDomain(req: QuoteDomainRequest, signal?: AbortSignal): Promise<DomainQuote> {
    return this.call({ method: "POST", path: "/v1/commerce/domain-quotes", body: req, signal });
  }

  requestDomainPurchase(
    req: RequestDomainPurchaseRequest,
    signal?: AbortSignal,
  ): Promise<CommerceRequest> {
    const { idempotency_key, ...body } = req;
    return this.call({
      method: "POST",
      path: "/v1/commerce/requests/domain-purchases",
      body,
      idempotencyKey: idempotency_key,
      signal,
    });
  }

  requestPlanChange(req: RequestPlanChangeRequest, signal?: AbortSignal): Promise<CommerceRequest> {
    const { idempotency_key, ...body } = req;
    return this.call({
      method: "POST",
      path: "/v1/commerce/requests/plan-changes",
      body,
      idempotencyKey: idempotency_key,
      signal,
    });
  }

  getCommerceRequest(requestId: string, signal?: AbortSignal): Promise<CommerceRequest> {
    return this.call({
      method: "GET",
      path: `/v1/commerce/requests/${encodeURIComponent(requestId)}`,
      signal,
    });
  }

  cancelCommerceRequest(requestId: string, signal?: AbortSignal): Promise<CommerceRequest> {
    return this.call({
      method: "POST",
      path: `/v1/commerce/requests/${encodeURIComponent(requestId)}/cancel`,
      signal,
    });
  }

  listCommerceRequests(
    params: ListCommerceRequestsParams,
    signal?: AbortSignal,
  ): Promise<Page<CommerceRequest>> {
    return this.call({
      method: "GET",
      path: "/v1/commerce/requests",
      query: {
        limit: params.limit,
        page: params.page,
      },
      signal,
    });
  }

  submitForReview(address: string, req: SendRequest, signal?: AbortSignal): Promise<SendOutcome> {
    return this.call({
      method: "POST",
      path: `/v1/inboxes/${this.encodeAddress(address)}/send`,
      body: sendBody(req),
      idempotencyKey: req.idempotency_key,
      signal,
    });
  }

  submitReplyForReview(
    address: string,
    req: ReplyRequest,
    signal?: AbortSignal,
  ): Promise<SendOutcome> {
    return this.call({
      method: "POST",
      path: `/v1/inboxes/${this.encodeAddress(address)}/reply`,
      body: replyBody(req),
      idempotencyKey: req.idempotency_key,
      signal,
    });
  }

  listReviews(params: ListReviewsParams, signal?: AbortSignal): Promise<Page<Review>> {
    const query: Record<string, string | number | undefined> = {
      state: Array.isArray(params.state) ? params.state.join(",") : params.state,
      category_id: params.category_id,
      inbox: params.inbox,
      composer: params.composer,
      limit: params.limit,
      page: params.page,
    };
    return this.call({ method: "GET", path: "/v1/reviews", query, signal });
  }

  getReview(reviewId: string, signal?: AbortSignal): Promise<Review> {
    return this.call({ method: "GET", path: `/v1/reviews/${encodeURIComponent(reviewId)}`, signal });
  }

  getReviewTurns(reviewId: string, signal?: AbortSignal): Promise<Page<ReviewTurn>> {
    return this.call({
      method: "GET",
      path: `/v1/reviews/${encodeURIComponent(reviewId)}/turns`,
      signal,
    });
  }

  getReviewFeedback(reviewId: string, signal?: AbortSignal): Promise<ReviewFeedback> {
    return this.call({
      method: "GET",
      path: `/v1/reviews/${encodeURIComponent(reviewId)}/feedback`,
      signal,
    });
  }

  postReviewChat(
    reviewId: string,
    req: PostReviewChatRequest,
    idempotencyKey?: string,
    signal?: AbortSignal,
  ): Promise<Review> {
    return this.call({
      method: "POST",
      path: `/v1/reviews/${encodeURIComponent(reviewId)}/chat`,
      body: req,
      idempotencyKey,
      signal,
    });
  }

  submitRevision(reviewId: string, req: SubmitRevisionRequest, signal?: AbortSignal): Promise<Review> {
    return this.call({
      method: "POST",
      path: `/v1/reviews/${encodeURIComponent(reviewId)}/revision`,
      body: withoutIdempotencyKey(req),
      idempotencyKey: req.idempotency_key,
      signal,
    });
  }

  cancelReview(reviewId: string, idempotencyKey?: string, signal?: AbortSignal): Promise<Review> {
    return this.call({
      method: "POST",
      path: `/v1/reviews/${encodeURIComponent(reviewId)}/cancel`,
      body: {},
      idempotencyKey,
      signal,
    });
  }

  restampReview(reviewId: string, req: RestampReviewRequest, signal?: AbortSignal): Promise<Review> {
    return this.call({
      method: "POST",
      path: `/v1/reviews/${encodeURIComponent(reviewId)}/restamp`,
      body: withoutIdempotencyKey(req),
      idempotencyKey: req.idempotency_key,
      signal,
    });
  }

  getReviewDecisionContext(reviewId: string, signal?: AbortSignal): Promise<ReviewDecisionContext> {
    return this.call({
      method: "GET",
      path: `/v1/reviews/${encodeURIComponent(reviewId)}/decision-context`,
      signal,
    });
  }

  reviewerDecide(reviewId: string, req: ReviewerDecisionRequest, signal?: AbortSignal): Promise<ReviewerDecisionResult> {
    return this.call({
      method: "POST",
      path: `/v1/reviews/${encodeURIComponent(reviewId)}/decision`,
      body: req,
      signal,
    });
  }

  listReviewEvents(params: ListReviewEventsParams, signal?: AbortSignal): Promise<ReviewEventsResult> {
    return this.call({
      method: "GET",
      path: "/v1/reviews/events",
      query: { review_id: params.review_id, limit: params.limit },
      signal,
    });
  }

  waitForReviewEvent(params: WaitForReviewEventParams, signal?: AbortSignal): Promise<ReviewEventsResult> {
    const waitSeconds = Math.min(55, Math.max(1, params.wait_seconds ?? 55));
    return this.call({
      method: "GET",
      path: "/v1/reviews/events/wait",
      query: { review_id: params.review_id, limit: params.limit, wait_seconds: waitSeconds },
      timeoutMs: (waitSeconds + 10) * 1000,
      signal,
    });
  }

  ackReviewEvent(req: AckReviewEventRequest, signal?: AbortSignal): Promise<AckReviewEventResult> {
    return this.call({
      method: "POST",
      path: "/v1/reviews/events/ack",
      body: { acks: req.acks ?? [], broadcast_ids: req.broadcast_ids ?? [] },
      signal,
    });
  }

  listCategories(params: ListCategoriesParams, signal?: AbortSignal): Promise<Page<Category>> {
    return this.call({ method: "GET", path: "/v1/categories", query: { ...params }, signal });
  }

  getCategory(categoryId: string, signal?: AbortSignal): Promise<Category> {
    return this.call({ method: "GET", path: `/v1/categories/${encodeURIComponent(categoryId)}`, signal });
  }

  proposeCategory(req: ProposeCategoryRequest, signal?: AbortSignal): Promise<Category> {
    return this.call({ method: "POST", path: "/v1/categories", body: req, signal });
  }

  updateCategory(categoryId: string, req: UpdateCategoryRequest, signal?: AbortSignal): Promise<Category> {
    return this.call({
      method: "PUT",
      path: `/v1/categories/${encodeURIComponent(categoryId)}`,
      body: req,
      signal,
    });
  }

  getRiskDial(signal?: AbortSignal): Promise<RiskDial> {
    return this.call({ method: "GET", path: "/v1/risk-dial", signal });
  }

  getGraduationStatus(categoryId: string, signal?: AbortSignal): Promise<GraduationStatus> {
    return this.call({
      method: "GET",
      path: `/v1/categories/${encodeURIComponent(categoryId)}/graduation-status`,
      signal,
    });
  }

  getScanBacklogStatus(categoryId: string, signal?: AbortSignal): Promise<ScanBacklogStatus> {
    return this.call({
      method: "GET",
      path: `/v1/categories/${encodeURIComponent(categoryId)}/backlog-status`,
      signal,
    });
  }

  getCategoryPacingState(categoryId: string, signal?: AbortSignal): Promise<CategoryPacingState> {
    return this.call({
      method: "GET",
      path: `/v1/categories/${encodeURIComponent(categoryId)}/pacing-state`,
      signal,
    });
  }

  proposeGraduation(categoryId: string, req: ProposeGraduationRequest, signal?: AbortSignal): Promise<GraduationStatus> {
    return this.call({
      method: "POST",
      path: `/v1/categories/${encodeURIComponent(categoryId)}/graduation-request`,
      body: { evidence: req.evidence ?? {} },
      signal,
    });
  }

  getRules(params: GetRulesParams, signal?: AbortSignal): Promise<RuleSnapshot> {
    return this.call({
      method: "GET",
      path: "/v1/rules",
      query: { category_id: params.category_id, scope: params.scope },
      signal,
    });
  }

  learnReviewRule(reviewId: string, req: LearnReviewRuleRequest, signal?: AbortSignal): Promise<LearnedReviewRule> {
    return this.call({method: "POST", path: `/v1/reviews/${encodeURIComponent(reviewId)}/learned-rules`, body: req, signal});
  }
  saveRule(req: SaveRuleRequest, signal?: AbortSignal): Promise<Rule> {
    return this.call({
      method: "PUT",
      path: "/v1/rules",
      body: withoutIdempotencyKey(req),
      idempotencyKey: req.idempotency_key,
      signal,
    });
  }

  promoteRule(ruleId: string, toScope: "general" | "category", signal?: AbortSignal): Promise<Rule> {
    return this.call({
      method: "POST",
      path: `/v1/rules/${encodeURIComponent(ruleId)}/promote`,
      body: { to_scope: toScope },
      signal,
    });
  }

  retireRule(ruleId: string, signal?: AbortSignal): Promise<Rule> {
    return this.call({ method: "POST", path: `/v1/rules/${encodeURIComponent(ruleId)}/retire`, body: {}, signal });
  }

  getRuleAudit(params: GetRuleAuditParams, signal?: AbortSignal): Promise<Page<RuleAuditEntry>> {
    return this.call({
      method: "GET",
      path: "/v1/rules/audit",
      query: { entity_kind: params.entity_kind, entity_id: params.entity_id },
      signal,
    });
  }

  undoRuleChange(udoId: string, signal?: AbortSignal): Promise<Rule> {
    return this.call({
      method: "POST",
      path: `/v1/rules/audit/${encodeURIComponent(udoId)}/undo`,
      body: {},
      signal,
    });
  }

  async *stream(
    address: string | null,
    lastEventId?: number,
    signal?: AbortSignal,
  ): AsyncGenerator<StreamEvent, void, unknown> {
    const path =
      address === null ? "/v1/events" : `/v1/inboxes/${this.encodeAddress(address)}/stream`;
    const frames = this.http.stream({
      path,
      lastEventId: lastEventId !== undefined ? String(lastEventId) : undefined,
      signal,
    });
    for await (const frame of frames) {
      // The SSE `data:` is the canonical event envelope; the `id:` is the monotonic
      // resume token (seq). Merge them into the typed StreamEvent.
      let envelope: Record<string, unknown> = {};
      try {
        envelope = JSON.parse(frame.data) as Record<string, unknown>;
      } catch {
        continue; // skip malformed frames rather than aborting the whole stream
      }
      const seq = frame.id !== undefined ? Number(frame.id) : NaN;
      yield {
        ...(envelope as object),
        event: (envelope.event as string) ?? frame.event,
        seq: Number.isFinite(seq) ? seq : 0,
      } as StreamEvent;
    }
  }
}

/** Offline transport backed by {@link MockBackend}. Never touches the network. */
export class MockTransport implements Transport {
  readonly backend: MockBackend;
  constructor(backend?: MockBackend) {
    this.backend = backend ?? new MockBackend();
  }

  async enroll(req: EnrollRequest): Promise<EnrollResponse> {
    return this.backend.enroll(req);
  }
  async signUp(req: SignUpRequest): Promise<SignUpResponse> {
    return this.backend.signUp(req);
  }
  async verify(req: VerifyRequest): Promise<VerifyResponse> {
    return this.backend.verify(req);
  }
  async whoami(): Promise<WhoAmI> {
    return this.backend.whoami();
  }
  async createInbox(req: CreateInboxRequest): Promise<Inbox> {
    return this.backend.createInbox(req);
  }
  async listInboxes(params: ListInboxesParams): Promise<Page<Inbox>> {
    return this.backend.listInboxes(params);
  }
  async getInbox(address: string): Promise<Inbox> {
    const inbox = this.backend.getInbox(address);
    if (!inbox) throw notFound("inbox", address);
    return inbox;
  }
  async updateInbox(address: string, req: UpdateInboxRequest): Promise<Inbox> {
    const inbox = this.backend.updateInbox(address, req);
    if (!inbox) throw notFound("inbox", address);
    return inbox;
  }
  async deleteInbox(address: string): Promise<void> {
    this.backend.deleteInbox(address);
  }
  async createInboxInProject(projectId: string, req: CreateInboxRequest): Promise<Inbox> {
    return this.backend.createInboxInProject(projectId, req);
  }
  async listInboxesInProject(projectId: string, params: ProjectInboxListParams): Promise<List<Inbox>> {
    return this.backend.listInboxesInProject(projectId, params);
  }
  async getInboxInProject(projectId: string, inboxId: string): Promise<Inbox> {
    const inbox = this.backend.getInboxInProject(projectId, inboxId);
    if (!inbox) throw notFound("inbox", inboxId);
    return inbox;
  }
  async updateInboxInProject(
    projectId: string,
    inboxId: string,
    req: UpdateInboxRequest,
  ): Promise<Inbox> {
    const inbox = this.backend.updateInboxInProject(projectId, inboxId, req);
    if (!inbox) throw notFound("inbox", inboxId);
    return inbox;
  }
  async deleteInboxInProject(projectId: string, inboxId: string): Promise<void> {
    if (!this.backend.deleteInboxInProject(projectId, inboxId)) throw notFound("inbox", inboxId);
  }
  async getInboxCredentialsInProject(projectId: string, inboxId: string): Promise<InboxCredentials> {
    const creds = this.backend.getInboxCredentialsInProject(projectId, inboxId);
    if (!creds) throw notFound("inbox", inboxId);
    return creds;
  }
  async send(address: string, req: SendRequest): Promise<SendOutcome> {
    return this.backend.send(address, req);
  }
  async reply(address: string, req: ReplyRequest): Promise<SendOutcome> {
    return this.backend.reply(address, req);
  }
  async forward(address: string, messageId: string, req: ForwardRequest): Promise<SendOutcome> {
    return this.backend.forward(address, messageId, req);
  }
  async listMessages(address: string, params: ListMessagesParams): Promise<Page<Message>> {
    return this.backend.listMessages(address, params);
  }
  async getMessage(messageId: string): Promise<Message> {
    try {
      return this.backend.getMessage(messageId);
    } catch {
      throw notFound("message", messageId);
    }
  }
  async getMessageRaw(_address: string, messageId: string): Promise<string> {
    try {
      return this.backend.getMessageRaw(messageId);
    } catch {
      throw notFound("message", messageId);
    }
  }
  async listAttachments(_address: string, messageId: string): Promise<Page<Attachment>> {
    try {
      return this.backend.listAttachments(messageId);
    } catch {
      throw notFound("message", messageId);
    }
  }
  async getAttachment(
    _address: string,
    messageId: string,
    attachmentId: string,
  ): Promise<AttachmentDownload> {
    try {
      return this.backend.getAttachment(messageId, attachmentId);
    } catch {
      throw notFound("attachment", attachmentId);
    }
  }
  async markRead(_address: string, messageId: string, req: MarkReadRequest): Promise<Message> {
    try {
      return this.backend.markRead(messageId, req.read);
    } catch {
      throw notFound("message", messageId);
    }
  }
  async deleteMessage(address: string, messageId: string, expunge?: boolean): Promise<DeleteResult> {
    const res = this.backend.deleteMessage(address, messageId, expunge ?? false);
    if (!res) throw notFound("message", messageId);
    return res;
  }
  async batchUpdateMessages(
    address: string,
    req: BatchUpdateMessagesRequest,
  ): Promise<BatchUpdateResult> {
    if (req.read === undefined && req.folder === undefined) {
      throw invalid("set read and/or folder to update");
    }
    const res = this.backend.batchUpdateMessages(address, req.ids, req.read, req.folder);
    if (!res) throw notFound("inbox", address);
    return res;
  }
  async searchMessages(address: string, params: SearchMessagesParams): Promise<Page<Message>> {
    return this.backend.searchMessages(address, params);
  }
  async listThreads(address: string, params: ListThreadsParams): Promise<Page<Thread>> {
    return this.backend.listThreads(address, params);
  }
  async searchThreads(address: string, params: SearchMessagesParams): Promise<Page<Thread>> {
    return this.backend.searchThreads(address, params);
  }
  async getThread(address: string, threadId: string): Promise<ThreadDetail> {
    try {
      return this.backend.getThread(address, threadId);
    } catch {
      throw notFound("thread", threadId);
    }
  }
  async getSubmission(address: string, submissionId: string): Promise<Submission> {
    const result = this.backend.getSubmission(address, submissionId);
    if (!result) throw notFound("submission", submissionId);
    return result;
  }
  async getSubmissionInProject(projectId: string, inboxId: string, submissionId: string): Promise<Submission> {
    const inbox = await this.getInboxInProject(projectId, inboxId);
    return this.getSubmission(inbox.address, submissionId);
  }
  async deleteThread(address: string, threadId: string, expunge?: boolean): Promise<DeleteResult> {
    const res = this.backend.deleteThread(address, threadId, expunge ?? false);
    if (!res) throw notFound("thread", threadId);
    return res;
  }
  async waitForEmail(
    address: string,
    req: WaitForEmailRequest,
    _timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<WaitForEmailResult> {
    if (signal?.aborted) throw notFound("inbox", address);
    return this.backend.waitForEmail(address, req);
  }
  async registerWebhook(req: RegisterWebhookRequest): Promise<Webhook> {
    return this.backend.registerWebhook(req);
  }
  async listWebhooks(): Promise<Page<Webhook>> {
    return this.backend.listWebhooks();
  }
  async getWebhook(webhookId: string): Promise<Webhook> {
    const hook = this.backend.getWebhook(webhookId);
    if (!hook) throw notFound("webhook", webhookId);
    return hook;
  }
  async updateWebhook(webhookId: string, req: UpdateWebhookRequest): Promise<Webhook> {
    const hook = this.backend.updateWebhook(webhookId, req);
    if (!hook) throw notFound("webhook", webhookId);
    return hook;
  }
  async deleteWebhook(webhookId: string): Promise<void> {
    if (!this.backend.deleteWebhook(webhookId)) throw notFound("webhook", webhookId);
  }
  async addContactListEntry(address: string, req: AddContactListRequest): Promise<ContactListEntry> {
    const entry = this.backend.addContactListEntry(address, req);
    if (!entry) throw notFound("inbox", address);
    return entry;
  }
  async listContactLists(address: string): Promise<Page<ContactListEntry>> {
    const page = this.backend.listContactLists(address);
    if (!page) throw notFound("inbox", address);
    return page;
  }
  async deleteContactListEntry(address: string, entryId: string): Promise<void> {
    if (!this.backend.deleteContactListEntry(address, entryId)) throw notFound("contact list entry", entryId);
  }
  async precheckSuppression(recipient: string): Promise<SuppressionPrecheck> {
    return this.backend.precheckSuppression(recipient);
  }
  async listSuppressions(params: ListSuppressionsParams): Promise<Page<SuppressionEntry>> {
    return this.backend.listSuppressions(params);
  }
  async revokeSuppression(id: string, reason: string): Promise<SuppressionEntry> {
    const row = this.backend.revokeSuppression(id, reason);
    if (!row) throw notFound("suppression", id);
    return row;
  }
  async listDomains(_signal?: AbortSignal, params: { page?: string; limit?: number } = {}): Promise<Page<Domain>> {
    const page = this.backend.listDomains();
    const offset = Number(params.page ?? 0);
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Invalid page cursor");
    const items = page.items.slice(offset, offset + (params.limit ?? 50));
    return { items, total: page.total, next_cursor: offset + items.length < page.items.length ? String(offset + items.length) : undefined };
  }

  async listDomainEvents(domain: string, params: { after?: string; limit?: number }): Promise<DomainStatusEventPage> {
    if (!this.backend.getDomain(domain)) throw notFound("domain", domain);
    return { items: [], next_cursor: params.after ?? "0", has_more: false, poll_after_seconds: 30 };
  }
  async getDomain(domain: string): Promise<Domain> {
    const d = this.backend.getDomain(domain);
    if (!d) throw notFound("domain", domain);
    return d;
  }
  async onboardDomain(req: OnboardDomainRequest): Promise<Domain> {
    return this.backend.onboardDomain(req);
  }
  async verifyDomain(domain: string): Promise<Domain> {
    const d = this.backend.verifyDomain(domain);
    if (!d) throw notFound("domain", domain);
    return d;
  }
  async offboardDomain(domain: string): Promise<DomainOffboard> {
    if (!this.backend.offboardDomain(domain)) throw notFound("domain", domain);
    // No job runner in the mock backend: report a synthetic succeeded teardown job
    // (the backend recorded it, so a follow-up getJob resolves it too).
    const jobId = `job-offboard-${domain.trim().toLowerCase()}`;
    return { domain, job_id: jobId, status: "succeeded", status_url: `/v1/jobs/${jobId}` };
  }
  async getJob(jobId: string): Promise<Job> {
    const job = this.backend.getJob(jobId);
    if (!job) throw notFound("job", jobId);
    return job;
  }
  async quoteDomain(req: QuoteDomainRequest): Promise<DomainQuote> {
    return this.backend.quoteDomain(req);
  }
  async requestDomainPurchase(req: RequestDomainPurchaseRequest): Promise<CommerceRequest> {
    return this.backend.requestDomainPurchase(req);
  }
  async requestPlanChange(req: RequestPlanChangeRequest): Promise<CommerceRequest> {
    return this.backend.requestPlanChange(req);
  }
  async getCommerceRequest(requestId: string): Promise<CommerceRequest> {
    const request = this.backend.getCommerceRequest(requestId);
    if (!request) throw notFound("commerce request", requestId);
    return request;
  }
  async cancelCommerceRequest(requestId: string): Promise<CommerceRequest> {
    const request = this.backend.cancelCommerceRequest(requestId);
    if (!request) throw notFound("commerce request", requestId);
    return request;
  }
  async listCommerceRequests(params: ListCommerceRequestsParams): Promise<Page<CommerceRequest>> {
    return this.backend.listCommerceRequests(params);
  }
  async submitForReview(address: string, req: SendRequest): Promise<SendOutcome> {
    return this.backend.submitForReview(address, req);
  }
  async submitReplyForReview(address: string, req: ReplyRequest): Promise<SendOutcome> {
    return this.backend.submitReplyForReview(address, req);
  }
  async listReviews(params: ListReviewsParams): Promise<Page<Review>> {
    return this.backend.listReviews(params);
  }
  async getReview(reviewId: string): Promise<Review> {
    const r = this.backend.getReview(reviewId);
    if (!r) throw notFound("review", reviewId);
    return r;
  }
  async getReviewTurns(reviewId: string): Promise<Page<ReviewTurn>> {
    const turns = this.backend.getReviewTurns(reviewId);
    if (!turns) throw notFound("review", reviewId);
    return turns;
  }
  async getReviewFeedback(reviewId: string): Promise<ReviewFeedback> {
    const fb = this.backend.getReviewFeedback(reviewId);
    if (!fb) throw notFound("review", reviewId);
    return fb;
  }
  async postReviewChat(reviewId: string, req: PostReviewChatRequest, idempotencyKey?: string): Promise<Review> {
    const r = this.backend.postReviewChat(reviewId, req, idempotencyKey);
    if (!r) throw notFound("review", reviewId);
    return r;
  }
  async submitRevision(reviewId: string, req: SubmitRevisionRequest): Promise<Review> {
    const r = this.backend.submitRevision(reviewId, req);
    if (!r) throw notFound("review", reviewId);
    return r;
  }
  async cancelReview(reviewId: string, _idempotencyKey?: string): Promise<Review> {
    const r = this.backend.cancelReview(reviewId);
    if (!r) throw notFound("review", reviewId);
    return r;
  }
  async restampReview(reviewId: string, req: RestampReviewRequest): Promise<Review> {
    const r = this.backend.restampReview(reviewId, req);
    if (!r) throw notFound("review", reviewId);
    return r;
  }
  async getReviewDecisionContext(reviewId: string): Promise<ReviewDecisionContext> {
    const dc = this.backend.getReviewDecisionContext(reviewId);
    if (!dc) throw notFound("review", reviewId);
    return dc;
  }
  async reviewerDecide(reviewId: string, req: ReviewerDecisionRequest): Promise<ReviewerDecisionResult> {
    const res = this.backend.reviewerDecide(reviewId, req);
    if (!res) throw notFound("review", reviewId);
    return res;
  }
  async listReviewEvents(params: ListReviewEventsParams): Promise<ReviewEventsResult> {
    return this.backend.listReviewEvents(params);
  }
  async waitForReviewEvent(params: WaitForReviewEventParams): Promise<ReviewEventsResult> {
    return this.backend.waitForReviewEvent(params);
  }
  async ackReviewEvent(req: AckReviewEventRequest): Promise<AckReviewEventResult> {
    return this.backend.ackReviewEvent(req);
  }
  async listCategories(params: ListCategoriesParams): Promise<Page<Category>> {
    return this.backend.listCategories(params);
  }
  async getCategory(categoryId: string): Promise<Category> {
    const c = this.backend.getCategory(categoryId);
    if (!c) throw notFound("category", categoryId);
    return c;
  }
  async proposeCategory(req: ProposeCategoryRequest): Promise<Category> {
    return this.backend.proposeCategory(req);
  }
  async updateCategory(categoryId: string, req: UpdateCategoryRequest): Promise<Category> {
    const c = this.backend.updateCategory(categoryId, req);
    if (!c) throw notFound("category", categoryId);
    return c;
  }
  async getRiskDial(): Promise<RiskDial> {
    return this.backend.getRiskDial();
  }
  async getGraduationStatus(categoryId: string): Promise<GraduationStatus> {
    const st = this.backend.getGraduationStatus(categoryId);
    if (!st) throw notFound("category", categoryId);
    return st;
  }
  async proposeGraduation(categoryId: string, req: ProposeGraduationRequest): Promise<GraduationStatus> {
    const st = this.backend.proposeGraduation(categoryId, req);
    if (!st) throw notFound("category", categoryId);
    return st;
  }
  async getScanBacklogStatus(categoryId: string): Promise<ScanBacklogStatus> {
    const st = this.backend.getScanBacklogStatus(categoryId);
    if (!st) throw notFound("category", categoryId);
    return st;
  }
  async getCategoryPacingState(categoryId: string): Promise<CategoryPacingState> {
    const st = this.backend.getCategoryPacingState(categoryId);
    if (!st) throw notFound("category", categoryId);
    return st;
  }
  async getRules(params: GetRulesParams): Promise<RuleSnapshot> {
    return this.backend.getRules(params);
  }
  async learnReviewRule(reviewId: string, req: LearnReviewRuleRequest): Promise<LearnedReviewRule> {
    return this.backend.learnReviewRule(reviewId, req);
  }
  async saveRule(req: SaveRuleRequest): Promise<Rule> {
    return this.backend.saveRule(req);
  }
  async promoteRule(ruleId: string, toScope: "general" | "category"): Promise<Rule> {
    const r = this.backend.promoteRule(ruleId, toScope);
    if (!r) throw notFound("rule", ruleId);
    return r;
  }
  async retireRule(ruleId: string): Promise<Rule> {
    const r = this.backend.retireRule(ruleId);
    if (!r) throw notFound("rule", ruleId);
    return r;
  }
  async getRuleAudit(params: GetRuleAuditParams): Promise<Page<RuleAuditEntry>> {
    return this.backend.getRuleAudit(params);
  }
  async undoRuleChange(udoId: string): Promise<Rule> {
    return this.backend.undoRuleChange(udoId);
  }
  async *stream(
    address: string | null,
    lastEventId?: number,
    signal?: AbortSignal,
  ): AsyncGenerator<StreamEvent, void, unknown> {
    for await (const ev of this.backend.streamEvents(address, lastEventId)) {
      if (signal?.aborted) return;
      yield ev;
    }
  }
}

function notFound(kind: string, id: string): NotFoundError {
  return new NotFoundError({
    status: 404,
    code: "not_found",
    message: `No ${kind} found for "${id}" in the offline mock.`,
  });
}

function invalid(message: string): ValidationError {
  return new ValidationError({ status: 400, code: "invalid", message });
}

/** Runtime-agnostic base64 of a byte array (no Buffer dependency). */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  if (typeof btoa === "function") return btoa(binary);
  // Node fallback when btoa is unavailable.
  const g = globalThis as { Buffer?: { from(s: string, enc: string): { toString(enc: string): string } } };
  if (g.Buffer) return g.Buffer.from(binary, "binary").toString("base64");
  throw new Error("No base64 encoder available in this runtime.");
}

/** Pull a filename out of a Content-Disposition header value. */
function filenameFromDisposition(disposition: string): string {
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  return m ? decodeURIComponent(m[1]!.trim()) : "";
}
