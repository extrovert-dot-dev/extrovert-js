/**
 * @extrovert.dev/sdk — TypeScript SDK for the Extrovert agent-email API.
 *
 * A real, persistent inbox for your agent, in one call. Behind a scoped key that expires and
 * revokes on its own. fetch-based, dependency-light, runs in Node 18+ and at the edge.
 *
 * Quickstart:
 * ```ts
 * import { Extrovert } from "@extrovert.dev/sdk";
 *
 * const extrovert = new Extrovert({ apiKey: process.env.EXTROVERT_API_KEY! });
 * const inbox = await extrovert.inboxes.create();
 * const outcome = await inbox.send({
 *   to: "ops@acme.test",
 *   subject: "online",
 *   text: "agent reporting in",
 *   intent: { summary: "report that the agent is online" },
 * });
 * if (outcome.kind === "queued_for_review") console.log(outcome.review.id);
 *
 * const { extracted } = await inbox.waitForEmail({ from: "login@acme.test", timeout_seconds: 120 });
 * console.log("OTP:", extracted.otp);
 * ```
 *
 * Need an offline test? Run against the built-in fixtures:
 * ```ts
 * const extrovert = new Extrovert({ transport: "mock" });
 * ```
 */

export { ExtrovertClient, ExtrovertClient as Extrovert, DEFAULT_BASE_URL, MOCK_BASE_URL } from "./client.js";
export type { ExtrovertClientOptions } from "./client.js";

// Resource classes (for advanced typing / DI).
export { Inboxes, Messages, Threads, Webhooks, ContactLists, Suppressions, Domains, Reviews, ReviewEvents, Categories, Rules, Projects, ProjectInboxes, InboxHandle } from "./resources/index.js";

// Transport-level types surfaced to callers (attachment download payload).
export type { AttachmentDownload } from "./transport.js";

// Errors.
export {
  ApiError,
  AuthenticationError,
  PermissionError,
  ForbiddenScopeError,
  BreadthRequiredError,
  NotFoundError,
  ConflictError,
  ValidationError,
  RecipientSuppressedError,
  PaymentRequiredError,
  RateLimitError,
  ConnectionError,
  TimeoutError,
  // Review Loop taxonomy. IntentRequiredError extends ValidationError and the
  // 409 family extends ConflictError, so existing catch branches keep working;
  // reach for these only when you want the distinction (which you do, because
  // only StaleError/BornStaleError are worth retrying).
  IntentRequiredError,
  ReviewConflictError,
  StaleError,
  WrongStateError,
  TerminalError,
  BornStaleError,
  SendNeedsReconciliationError,
  IdempotencyConflictError,
  UnavailableError,
} from "./errors.js";
export type { ApiErrorBody } from "./errors.js";

// RFC-9457 problem+json (the typed, closed-enum error surface).
export { PROBLEM_CODES, REVIEW_PROBLEM_RETRYABLE, isProblemCode, parseProblem } from "./problem.js";
export type { Problem, ProblemCode, ProblemField } from "./problem.js";

// Narrowing helpers for the three-way send outcome (queued | sent | legacy sent).
export {
  isQueuedForReview,
  isSentImmediately,
  sentMessageIdOf,
  threadIdOf,
  reviewIdOf,
} from "./send-result.js";

// The ONE list envelope + opaque-cursor iteration helpers.
export { ListPage, listPage } from "./pagination.js";
export type { List, ListParams, Cursor, PageFetcher } from "./pagination.js";

// Dated API version pin (Extrovert-Version).
export { CURRENT_API_VERSION, API_VERSION_HEADER } from "./version.js";

// Key-tier awareness (advisory client-side hint derived from the key prefix).
export { parseKeyTier, tierAllowsOrgWildcard, tierNeedsExplicitBreadth } from "./key-tier.js";
export type { KeyTier } from "./key-tier.js";

// `?include=` relation expansion typing.
export { serializeInclude } from "./include.js";
export type { InboxInclude, ReviewInclude } from "./include.js";

// OTP / verification-link extraction (also usable standalone).
export { extractCredentials, extractOtp, extractLink } from "./extract.js";

// Inbound webhook verification + signing (HMAC, Web Crypto — Node + edge).
export {
  verifyWebhookSignature,
  parseWebhook,
  signWebhook,
  type WebhookPayload,
  type VerifyWebhookOptions,
} from "./webhook.js";

// Offline mock backend (for tests, examples, and the console/MCP dev mode).
export { MockBackend } from "./fixtures.js";

// All request/response models.
export type {
  // primitives
  IsoTimestamp,
  Scope,
  OnboardingMode,
  AgentStatus,
  InboxStatus,
  MessageDirection,
  // enrollment & agents
  EnrollRequest,
  EnrollResponse,
  Agent,
  // inboxes
  CreateInboxRequest,
  UpdateInboxRequest,
  InboxCredentials,
  Inbox,
  InboxMetadata,
  InboxMetadataValue,
  InboxMetadataPatch,
  ListInboxesParams,
  ProjectInboxListParams,
  GetInboxParams,
  Page,
  // messages / send / reply / threads
  EmailAddress,
  Attachment,
  AttachmentInput,
  Message,
  ListMessagesParams,
  SearchMessagesParams,
  MarkReadRequest,
  MailFolder,
  BatchUpdateMessagesRequest,
  BatchUpdateResult,
  DeleteResult,
  SendRequest,
  ReplyRequest,
  ForwardRequest,
  SendResult,
  SendOutcome,
  // review loop (HITL)
  ReviewMode,
  ReviewPolicy,
  ReviewState,
  ReviewIntent,
  Review,
  ReviewTurn,
  ListReviewsParams,
  QueuedForReviewResult,
  SentResult,
  SubmitForReviewResult,
  // review loop per-message chat + revision + cancel + feedback (HITL, M5)
  ReviewFeedback,
  ReviewFeedbackComment,
  PostReviewChatRequest,
  SubmitRevisionRequest,
  // review loop D19 reconciliation: re-stamp escape valve + backlog status (HITL, M7)
  RestampReviewRequest,
  ScanBacklogStatus,
  // BYO review-agent decision plane: decision-context + reviewer decision (HITL, M8 Slice B)
  ReviewerAction,
  ReviewDecisionContext,
  ReviewerDecisionRequest,
  ReviewerDecisionResult,
  // review loop demand-driven pacing: cursor + window + classification (HITL, M7 Slice B)
  CategoryPacingState,
  PacingItem,
  // review loop realtime (HITL, M3)
  ReviewEventReason,
  ReviewEvent,
  ReviewEventCursor,
  ReviewEventsResult,
  ListReviewEventsParams,
  WaitForReviewEventParams,
  AckReviewEventEntry,
  AckReviewEventRequest,
  AckReviewEventResult,
  // review loop category registry (HITL, M4)
  Category,
  ListCategoriesParams,
  ProposeCategoryRequest,
  UpdateCategoryRequest,
  // review loop graduation + risk dial (HITL, M6)
  AccountRiskDial,
  EffectiveRiskDial,
  CategoryRiskDial,
  RiskDial,
  GraduationStatus,
  ProposeGraduationRequest,
  // review loop writing rules + house-style + audit/undo (HITL, M4)
  Rule,
  RuleLayer,
  GetRulesParams,
  SaveRuleRequest,
  RuleAuditEntry,
  GetRuleAuditParams,
  Thread,
  ThreadDetail,
  ListThreadsParams,
  // wait_for_email
  WaitForEmailRequest,
  ExtractedCredentials,
  WaitForEmailResult,
  // webhooks
  WebhookEvent,
  RegisterWebhookRequest,
  UpdateWebhookRequest,
  Webhook,
  // contact allow/block lists
  ContactListKind,
  ContactListDirection,
  AddContactListRequest,
  ContactListEntry,
  // suppressions (recipient opt-outs / list-unsubscribe)
  SuppressionScope,
  SuppressionSource,
  SuppressionEntry,
  SuppressionPrecheck,
  ListSuppressionsParams,
  // domains (privileged; domain:manage scope, + domain:purchase for mode: purchased)
  DomainRecord,
  DomainScope,
  OnboardDomainRequest,
  Domain,
  DomainOffboard,
  // async job poll surface (currently only domain-offboard teardown)
  Job,
  // real-time event stream (SSE)
  StreamEvent,
  StreamOptions,
  // self-signup + auth introspection
  SignUpRequest,
  SignUpResponse,
  VerifyRequest,
  MailboxQuickstartCall,
  MailboxQuickstart,
  VerifyResponse,
  WhoAmI,
} from "./models.js";

export { SDK_VERSION } from "./http.js";

// ---------------------------------------------------------------------------
// Open contract (HITL D14) — the published, VERSIONED Review-Loop surface.
//
// The stable agent-facing JSON shapes (spec §11 + the full M1–M8 surface) are
// published here as a documented, versioned contract that agents and third-party
// harnesses code against — explicitly an SDK + skill contract, NOT a wire
// protocol (D14). `CONTRACT_VERSION` is a PROVISIONAL 0.x version aligned to the
// SDK package version + the openapi info.version; `CONTRACT_MANIFEST` is the
// machine-readable list of shapes a harness can pin. See `./contract`.
// ---------------------------------------------------------------------------
export { CONTRACT_VERSION, CONTRACT_MANIFEST } from "./contract.js";
export type { ContractManifest, ContractStability, DiffJson, DiffHunk } from "./contract.js";
