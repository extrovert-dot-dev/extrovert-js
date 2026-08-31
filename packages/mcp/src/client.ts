/**
 * Thin, typed Extrovert API client.
 *
 * One method per REST endpoint in spec §8 (`/v1`). The base URL and scoped
 * agent key come from config (env `EXTROVERT_API_BASE_URL` / `EXTROVERT_API_KEY`).
 * This module is the single seam between the MCP tools and the network — the
 * tools never touch `fetch` directly.
 *
 * While `config.mock` is true, each method returns deterministic fixture data
 * via `FixtureStore` instead of issuing HTTP.
 */

import type { ExtrovertConfig } from "./config.js";
import { FixtureStore, NotFoundError } from "./fixtures.js";
import { keyTierFromRawKey, listEnvelopeToPage } from "./types.js";
import type {
  Attachment,
  AttachmentDownload,
  AttachmentInput,
  BatchUpdateResult,
  Category,
  ContactListDirection,
  ContactListEntry,
  ContactListKind,
  DeleteResult,
  Domain,
  DomainOffboard,
  EnrollmentResult,
  GraduationStatus,
  Inbox,
  Job,
  KeyTier,
  List,
  MailboxCredentials,
  Message,
  Page,
  Review,
  RiskDial,
  ReviewDecisionContext,
  ReviewerAction,
  ReviewerDecisionResult,
  ReviewEventsResult,
  ReviewFeedback,
  ReviewIntent,
  ReviewMode,
  ReviewState,
  CategoryPacingState,
  ReviewTurn,
  Rule,
  RuleAuditEntry,
  ProblemField,
  ReplyEmailResult,
  ScanBacklogStatus,
  SendEmailResult,
  SignUpResult,
  SubmitForReviewResult,
  SuppressionEntry,
  SuppressionPrecheck,
  ReputationRollup,
  ReputationFinding,
  ListDeliverabilityFindingsInput,
  Thread,
  ThreadDetail,
  VerifyResult,
  WaitForEmailResult,
  Webhook,
  WebhookEvent,
  WhoAmI,
} from "./types.js";

/** Normalized error surfaced from any client call. */
export class ExtrovertApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly details?: unknown,
    /**
     * The problem's machine-readable field hints (`problem.errors[]`), verbatim.
     *
     * These are NOT decoration. A 422 `intent_required` carries the exact JSON to
     * add under `retry_with`, and a 409 carries `state` / `revision` / `version` /
     * one `allowed_action` per legal verb — the facts that let an agent recover in
     * one turn instead of guessing. They reach the model only because
     * `toErrorResult` renders them: anything left in `structuredContent` is
     * invisible to a text-only agent.
     */
    readonly problemErrors?: ProblemField[],
  ) {
    super(message);
    this.name = "ExtrovertApiError";
  }
}

export interface RedeemEnrollmentInput {
  enrollment_token: string;
  /** Idempotency handle (à la AgentMail `client_id`); rebinds the same agent. */
  agent_handle?: string;
  /**
   * Optional client-supplied idempotency key sent as the `Idempotency-Key`
   * header: a retry with the same key replays the original enrollment response.
   */
  client_id?: string;
}

/**
 * A metadata patch on create/update. Each value is string | number | boolean to
 * SET a key, or `null` to DELETE that key (merge-null-clear semantics). A
 * top-level `null` on update clears ALL metadata (see {@link UpdateInboxInput}).
 */
export type InboxMetadataPatch = Record<string, string | number | boolean | null>;

export interface CreateInboxInput {
  username?: string;
  domain?: string;
  display_name?: string;
  inbound_webhook_url?: string;
  /**
   * Optional arbitrary key-value metadata to store on the inbox (AgentMail
   * parity). Values may be string, number, or boolean; a key with a `null` value
   * is dropped. Caps: ≤256 keys, ≤256 chars per key, ≤256 chars per string value;
   * nested objects/arrays are rejected. Echoed back (and replayed on idempotent
   * retries) on the create response.
   */
  metadata?: InboxMetadataPatch;
  /**
   * Optional assertion that must match the key's bound project — NEVER a
   * selector. A mismatch is rejected server-side; the inbox is always created in
   * the key's stored project.
   */
  project_id?: string;
  /**
   * Optional client-supplied idempotency key sent as the `Idempotency-Key`
   * header: re-creating with the same key returns the existing inbox rather than
   * a duplicate (the same key with a different request is a 409).
   */
  client_id?: string;
}

export interface RegisterWebhookInput {
  url: string;
  events?: WebhookEvent[];
  inbox?: string;
  /**
   * Optional client-supplied idempotency key sent as the `Idempotency-Key`
   * header: a retry with the same key replays the original registration.
   */
  client_id?: string;
}

/** Mutable inbox settings for `PATCH /v1/inboxes/{inbox_id}`. Omitted fields are left unchanged. */
export interface UpdateInboxInput {
  /** New sender display / "From" name. Empty string falls back to the local-part. */
  display_name?: string;
  /** Replace the inbound webhook target (empty string clears it). */
  inbound_webhook_url?: string;
  /**
   * Set the effective rolling-24-hour recipient cap (integer 1–10,000).
   * Requires the opt-in `mailbox:quota` scope.
   */
  daily_send_limit?: number;
  /**
   * Patch the inbox's arbitrary metadata (AgentMail parity) with a shallow merge:
   * an object merges into the existing metadata; a key whose value is `null`
   * deletes that key; a top-level `null` clears ALL metadata (the response then
   * carries `{}`). Omit the field entirely to leave metadata unchanged. Values
   * may be string, number, or boolean; nested objects/arrays are rejected; the
   * same ≤256 key/length caps as create apply.
   */
  metadata?: InboxMetadataPatch | null;
  /**
   * Optional assertion that must match the key's bound project — NEVER a
   * selector. A mismatch is rejected server-side.
   */
  project_id?: string;
}

export interface SendEmailInput {
  inbox: string;
  to: string[];
  subject: string;
  text: string;
  html?: string;
  cc?: string[];
  bcc?: string[];
  /** Override the Reply-To header. */
  reply_to?: string;
  /** Custom headers to attach (reserved/unsafe names are dropped server-side). */
  headers?: Record<string, string>;
  /** Files to attach (base64). */
  attachments?: AttachmentInput[];
  /** Stable retry key, sent as Idempotency-Key and never in the JSON body. */
  client_id?: string;
}

export interface ReplyEmailInput {
  inbox: string;
  /** Exactly one of thread_id / message_id selects the parent. */
  thread_id?: string;
  message_id?: string;
  text?: string;
  html?: string;
  cc?: string[];
  bcc?: string[];
  reply_to?: string;
  headers?: Record<string, string>;
  /** Reply to every thread recipient, not just the original sender. */
  reply_all?: boolean;
  /** Files to attach (base64). */
  attachments?: AttachmentInput[];
  /** Stable retry key, sent as Idempotency-Key and never in the JSON body. */
  client_id?: string;
}

export interface ForwardEmailInput {
  inbox: string;
  message_id: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  text?: string;
  /** Accepted for wire compatibility but ignored; the materialized forward is plain text. */
  html?: string;
  /** Stable retry key, sent as Idempotency-Key and never in the JSON body. */
  client_id?: string;
}

/**
 * Submit a forward for human review (Review Loop). A forward is an outbound
 * message to arbitrary NEW recipients that quotes an entire received thread, so it
 * is policy-enforced exactly like send and reply — otherwise it would be the
 * documented bypass, and a worse one, because it exfiltrates a conversation.
 *
 * The subject and the quoted body are materialized server-side at SUBMIT time, so
 * the human reviews the exact bytes that go out and an approved forward delivers
 * the reviewer's edit rather than a body re-derived from the live parent.
 */
export interface SubmitForwardForReviewInput {
  inbox: string;
  message_id: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  /** Optional note to prepend; the parent quote is appended server-side. */
  text?: string;
  /** Accepted for wire compatibility but ignored; the materialized forward is plain text. */
  html?: string;
  mode?: ReviewMode;
  /** Required when the resolved mode is review (D3). */
  intent?: ReviewIntent;
  category_id?: string;
  /** See SubmitForReviewInput.category_confidence. */
  category_confidence?: number;
  /** Stable retry key, sent as Idempotency-Key and never in the JSON body. */
  client_id?: string;
}

/** Submit a new message for human review (Review Loop, spec §5.1). */
export interface SubmitForReviewInput {
  inbox: string;
  to: string[];
  subject?: string;
  text: string;
  html?: string;
  cc?: string[];
  bcc?: string[];
  reply_to?: string;
  headers?: Record<string, string>;
  /**
   * Files to attach (base64). Attachments now survive submit -> review row ->
   * approval dispatch, so the human reviews the message WITH its files and the
   * recipient receives the same ones.
   */
  attachments?: AttachmentInput[];
  /** "review" (default) routes to the human queue; "direct" requests an immediate send. */
  mode?: ReviewMode;
  /** Required when the resolved mode is review (D3). */
  intent?: ReviewIntent;
  /** Opaque category id (cat_…) matched from the registry; never a name. */
  category_id?: string;
  /**
   * Agent-supplied confidence (0..1) in the category match. Feeds the submit-time
   * min_confidence auto-send gate ONLY; the server never scores ($0 LLM). Below the
   * effective threshold (or omitted when a threshold is set) the would-be auto-send
   * routes to needs_review with gate_outcome held:low_confidence.
   */
  category_confidence?: number;
  /** Stable retry key, sent as Idempotency-Key and never in the JSON body. */
  client_id?: string;
}

/** Submit an in-thread reply for human review (Review Loop). */
export interface SubmitReplyForReviewInput {
  inbox: string;
  thread_id?: string;
  message_id?: string;
  text: string;
  html?: string;
  cc?: string[];
  bcc?: string[];
  reply_to?: string;
  headers?: Record<string, string>;
  /** Reply to every thread recipient, not just the original sender. */
  reply_all?: boolean;
  /** Files to attach (base64); they survive submit -> review row -> dispatch. */
  attachments?: AttachmentInput[];
  mode?: ReviewMode;
  intent?: ReviewIntent;
  category_id?: string;
  /** See SubmitForReviewInput.category_confidence. */
  category_confidence?: number;
  /** Stable retry key, sent as Idempotency-Key and never in the JSON body. */
  client_id?: string;
}

/** Filters for listing review requests (Review Loop, spec §5.2). */
export interface ListReviewsInput {
  state?: ReviewState | ReviewState[];
  category_id?: string;
  inbox?: string;
  limit?: number;
  page?: string;
}

/** Post a chat turn on a review's thread (Review Loop M5, spec §5.2). */
export interface PostReviewChatInput {
  /** Review id (rr_…). */
  id: string;
  /** The agent's question/comment for the human reviewer. */
  text: string;
  /** Optional idempotency key (sent as the `Idempotency-Key` header). */
  client_id?: string;
}

/** Post a new agent draft under a parent_revision CAS (Review Loop M5, spec §5.2). */
export interface SubmitRevisionInput {
  /** Review id (rr_…). */
  id: string;
  /** The revision the agent composed against (PRIMARY CAS; 409 STALE on mismatch). */
  parent_revision: number;
  /** Optional row-version CAS (defense in depth). */
  version?: number;
  subject?: string;
  /** The canonical new plain-text body (matches `text` on send/reply/forward). */
  text?: string;
  /**
   * DEPRECATED alias for {@link text}, accepted indefinitely so already-shipped
   * callers keep working. Sending BOTH with different content is rejected 400
   * `conflicting_alias` — the server never guesses which bytes you meant.
   */
  body?: string;
  html?: string;
  /**
   * REPLACES the draft's attachments when present; omit to leave them untouched,
   * pass `[]` to clear them. Without this a redraft after reviewer feedback could
   * never restore a file the human reviewed the message WITH.
   */
  attachments?: AttachmentInput[];
  /** When the agent built this draft (informational). */
  built_at?: string;
  /** Rule high-water this draft was composed against (born-stale basis). */
  rules_version_seen?: number;
  /** Stable retry key, sent as Idempotency-Key and never in the JSON body. */
  client_id?: string;
}

/**
 * The D19/§8 re-stamp-without-redraft escape valve ($0). The agent asserts it reviewed
 * the draft against rules `against_version` and no change is needed; the server advances
 * the draft's composed_* rules-versions WITHOUT a new draft.
 */
export interface RestampReviewInput {
  /** Review id (rr_…). */
  id: string;
  /** The category rules-version the agent reviewed against (≤ the current version). */
  against_version: number;
  /** Optional: re-stamp the house-style axis to this version (≤ the current version). */
  house_style_version?: number;
  /** Stable retry key, sent as Idempotency-Key and never in the JSON body. */
  client_id?: string;
}

/**
 * A reviewer decision (BYO review-agent plane; D5/§9). `action` is approve|edit|reject|
 * escalate. `revision`/`version` are the optimistic CAS — a mismatch is a 409 STALE with
 * NO mutation (the human always wins, D17). `subject`/`body` carry the edited content for
 * the edit action; `feedback` is the reviewer's note.
 */
export interface ReviewerDecideInput {
  /** Review id (rr_…). */
  id: string;
  /** approve | edit | reject | escalate. */
  action: ReviewerAction;
  /** The revision you decided against (PRIMARY CAS; 409 STALE on mismatch). */
  revision: number;
  /** Optional row-version CAS (defense in depth). */
  version?: number;
  /** Edited subject (edit action). */
  subject?: string;
  /** Edited body text (edit action). */
  body?: string;
  /** Reviewer note (reject: the rule-birth signal; escalate: the human-facing reason). */
  feedback?: string;
}

/** Filters for draining/waiting on review events (Review Loop, spec §5.9). */
export interface ListReviewEventsInput {
  /** Restrict the drain to one review's events (rr_…). */
  review_id?: string;
  /** Max events to return in one drain. */
  limit?: number;
}

/** Long-poll input: like {@link ListReviewEventsInput} plus a wait budget. */
export interface WaitForReviewEventInput extends ListReviewEventsInput {
  /** Long-poll budget in seconds (default ~30, capped ~55). */
  wait_seconds?: number;
}

/** One per-(agent, review) cursor advance for ack_review_event. */
export interface AckReviewEventEntry {
  review_id: string;
  through_seq: number;
}

/** Propose a new category (Review Loop registry, D9). */
export interface ProposeCategoryInput {
  name: string;
  description?: string;
  /** Defaults to org_shared server-side. */
  scope?: "org_shared" | "agent_private";
}

/** Rename / re-describe a category — metadata only (D10). */
export interface UpdateCategoryInput {
  id: string;
  name?: string;
  description?: string;
}

/** Get the ordered writing-rule set (Review Loop, §7). */
export interface GetRulesInput {
  /** Category id (cat_…). Empty returns ONLY the house-style/general layer. */
  category_id?: string;
  /** Narrow to one layer (general | category). Default returns both. */
  scope?: "general" | "category";
}

/** Save / edit a writing rule (append-only by supersession, D11). */
export interface SaveRuleInput {
  /** Defaults from category_id (general iff empty). */
  scope?: "general" | "category";
  /** Category id (cat_…); empty = house-style/general (D2). */
  category_id?: string;
  rule_text: string;
  /** Defaults soft. hard = non-overridable. */
  kind?: "soft" | "hard";
  priority?: number;
  source_review_id?: string;
  source_turn_id?: string;
  /** Set to EDIT the prior version (rule_…). */
  supersedes_id?: string;
  /** Set for a per-agent override; empty = all org agents. */
  scope_agent_id?: string;
  /** D8 retro-propagation HUMAN OPT-IN (default false): propagate a NEW category rule to pending siblings. */
  propagate_to_pending?: boolean;
  /** Override the propagate batch (0 = base 3, bounded by rework_batch_max). */
  suggested_batch?: number;
}

/** Read the rule/category change audit log (D11). */
export interface GetRuleAuditInput {
  entity_kind?: "rule" | "category";
  entity_id?: string;
}

/** Ack input: advance per-review cursor(s) and/or mark broadcast nudges done. */
export interface AckReviewEventInput {
  acks?: AckReviewEventEntry[];
  broadcast_ids?: string[];
}

export interface AddContactListInput {
  inbox: string;
  kind: ContactListKind;
  /** Defaults to "send" server-side. */
  direction?: ContactListDirection;
  /** A bare email address or a bare domain. */
  pattern: string;
}

/** Filters for listing the caller's own org suppression rows (`GET /v1/suppressions`). */
export interface ListSuppressionsInput {
  /** Narrow to one scope; the agent plane only ever returns `org` rows. */
  scope?: "org" | "shared_domain" | "global";
  /** Include revoked rows too (default: active rows only). */
  include_revoked?: boolean;
  limit?: number;
  /** Opaque cursor from a previous page's next_cursor. */
  cursor?: string;
}

/** Onboarding modes the agent-facing domains API accepts. */
export type DomainOnboardMode = "shared" | "ns_delegated" | "manual" | "purchased";

export interface OnboardDomainInput {
  domain: string;
  /**
   * Onboarding path. Defaults to ns_delegated server-side when omitted. `mode:
   * "purchased"` spends money at the registrar and therefore requires BOTH the
   * `domain:manage` scope (the route gate) AND the explicit, default-off
   * `domain:purchase` scope (it is additionally bounded by the org/project
   * purchased-domain cap). `manual` and `ns_delegated` need `domain:manage` only.
   */
  mode?: DomainOnboardMode;
  /** A-record IP served at a delegated zone's apex (ns_delegated only). */
  mail_host_ip?: string;
  /**
   * Domain visibility. `org` (default) makes it usable by every project in the
   * org; `project` binds it to the key's OWN bound project (never client-selected)
   * so it is only visible/mintable from that project. A legacy/unscoped key falls
   * back to `org`.
   */
  scope?: "org" | "project";
  /**
   * Optional assertion that must match the key's bound project — NEVER a
   * selector. A mismatch is rejected server-side; the binding is always derived
   * from the key.
   */
  project_id?: string;
}

export interface WaitForEmailInput {
  inbox: string;
  from?: string;
  subject?: string;
  /** Case-sensitive Go RE2 expression over subject+body (maps to the API `match` field); use a leading `(?i)` for case-insensitive matching. */
  regex?: string;
  /** Prefer an extracted link containing this substring. */
  link_hint?: string;
  /** Only match arrivals after the wait begins (default true). */
  since_now?: boolean;
  timeout_ms: number;
}

/** The Go wait response shape (`{timed_out, message, extracted{otp,link}}`). */
interface WaitWireResult {
  timed_out: boolean;
  message: Message | null;
  extracted: { otp: string | null; link: string | null };
}

export interface DurableCredentialPersistenceStatus {
  attempted: boolean;
  persisted: boolean;
  location?: string;
  error?: string;
}

export interface ExtrovertClientOptions {
  /**
   * Local-host hook for storing a newly issued full-scope key. Hosted HTTP leaves
   * this unset because OAuth credentials belong to the MCP client, not the server.
   */
  onDurableAgentKey?: (
    agentKey: string,
    apiBaseUrl: string,
  ) => { location?: string } | void;
}

export class ExtrovertClient {
  private readonly store?: FixtureStore;
  private apiKey: string;
  private durableCredentialStatus: DurableCredentialPersistenceStatus = {
    attempted: false,
    persisted: false,
  };

  constructor(
    private readonly config: ExtrovertConfig,
    private readonly options: ExtrovertClientOptions = {},
  ) {
    this.apiKey = config.apiKey;
    // The offline store enforces the SAME key-tier ceiling assertions as the live
    // choke-point, derived from the configured key prefix (redesign §3.1).
    if (config.mock) {
      this.store = new FixtureStore({
        keyTier: keyTierFromRawKey(config.apiKey),
        reviewPolicy: config.mockReviewPolicy,
      });
    }
  }

  get isMock(): boolean {
    return this.config.mock;
  }

  // ---- enrollment (POST /v1/enroll) -------------------------------------

  async redeemEnrollment(input: RedeemEnrollmentInput): Promise<EnrollmentResult> {
    if (this.store) {
      const res = this.store.redeemEnrollment(input.enrollment_token, input.agent_handle);
      this.setSessionKey(res.agent_key, true);
      return res;
    }
    const res = await this.post<EnrollmentResult>(
      "/v1/enroll",
      {
        token: input.enrollment_token,
        agent_handle: input.agent_handle,
        client_id: input.client_id,
      },
      undefined,
      idempotencyHeader(input.client_id),
    );
    this.setSessionKey(res.agent_key, true);
    return res;
  }

  // ---- self-signup + auth (Slice E) -------------------------------------

  /** Grab a free account: `POST /v1/agent/sign-up` (unauthenticated). */
  async signUp(input: { human_email: string; username?: string }): Promise<SignUpResult> {
    if (this.store) {
      const res = this.store.signUp(input);
      this.setSessionKey(res.agent_key);
      return res;
    }
    const res = await this.post<SignUpResult>("/v1/agent/sign-up", {
      human_email: input.human_email,
      username: input.username,
    });
    this.setSessionKey(res.agent_key);
    return res;
  }

  /** Confirm the signup OTP and elevate scope: `POST /v1/agent/verify`. */
  async verify(input: { otp: string }): Promise<VerifyResult> {
    if (this.store) {
      const res = this.store.verify(input.otp);
      this.setSessionKey(res.agent_key, true);
      return res;
    }
    const res = await this.post<VerifyResult>("/v1/agent/verify", { otp: input.otp });
    this.setSessionKey(res.agent_key, true);
    return res;
  }

  /** Report whether the latest full-scope key was durably stored by this host. */
  credentialPersistenceStatus(): DurableCredentialPersistenceStatus {
    return { ...this.durableCredentialStatus };
  }

  /** Introspect the principal behind the current key: `GET /v1/auth/me`. */
  async whoami(): Promise<WhoAmI> {
    if (this.store) return this.store.whoami();
    return this.get<WhoAmI>("/v1/auth/me");
  }

  // ---- inboxes ----------------------------------------------------------

  async createInbox(input: CreateInboxInput): Promise<Inbox> {
    if (this.store) {
      return this.store.createInbox({
        username: input.username,
        domain: input.domain,
        displayName: input.display_name,
        inboundWebhookUrl: input.inbound_webhook_url,
        metadata: input.metadata,
        projectId: input.project_id,
        clientId: input.client_id,
      });
    }
    const body: Record<string, unknown> = {};
    if (input.username !== undefined) body.username = input.username;
    if (input.domain !== undefined) body.domain = input.domain;
    if (input.display_name !== undefined) body.display_name = input.display_name;
    // The agent-facing `inbound_webhook_url` maps to the API's `webhook_url`.
    if (input.inbound_webhook_url !== undefined) body.webhook_url = input.inbound_webhook_url;
    if (input.metadata !== undefined) body.metadata = input.metadata;
    if (input.project_id !== undefined) body.project_id = input.project_id;
    if (input.client_id !== undefined) body.client_id = input.client_id;
    return this.post<Inbox>("/v1/inboxes", body, undefined, idempotencyHeader(input.client_id));
  }

  /**
   * List the agent's inboxes (redesign §4.1 bare-vs-wildcard semantics).
   *
   * Scope is in the KEY. By tier:
   *  - project/inbox key → that project's inboxes. Addressed via the canonical
   *    project-prefixed envelope `GET /v1/projects/{project_id}/inboxes` (the §5.2
   *    `{object:"list", data, has_more, next_cursor}` shape) when a project is
   *    resolved; otherwise the bare `/v1/inboxes` curl-sugar form (which resolves
   *    to the key's default project and returns the legacy `{inboxes, next_page}`).
   *  - org key → MUST pick a breadth: pass `project` (a concrete id) or
   *    `wildcard:true` (`/v1/projects/-/inboxes`, the org subtree). A bare org-key
   *    list is a 400 `breadth_required` (mirrors the server choke-point) — we fail
   *    fast client-side with the same code so the agent sees the next call to make.
   *
   * Either wire shape is normalized into the internal {@link Page}.
   */
  async listInboxes(
    opts: { limit?: number; project?: string; wildcard?: boolean; cursor?: string } | number = {},
  ): Promise<Page<Inbox>> {
    // Back-compat: a bare number is the page limit.
    const o = typeof opts === "number" ? { limit: opts } : opts;
    const limit = o.limit ?? 20;
    if (this.store) return this.store.listInboxes({ limit, project: o.project, wildcard: o.wildcard });

    const tier = this.keyTier();
    // Resolve the project segment for the canonical envelope form.
    const projectSegment = o.wildcard ? "-" : o.project;
    if (projectSegment) {
      // Org key on the wildcard is fine; a non-org key on the wildcard is a 403
      // (server enforces; we let the server be authoritative and just call it).
      const list = await this.get<List<Inbox>>(
        `/v1/projects/${encodeURIComponent(projectSegment)}/inboxes`,
        { limit, cursor: o.cursor },
      );
      return listEnvelopeToPage(list);
    }
    if (tier === "org") {
      // Bare list under an org key needs an explicit breadth (RFC D2 / §4.1).
      throw new ExtrovertApiError(
        "An org-tier key must pick a list breadth: pass a project id (e.g. list_inboxes project=<id>) " +
          "or wildcard=true (the org subtree).",
        400,
        "breadth_required",
      );
    }
    // project/inbox key, bare sugar → the legacy {inboxes, next_page} shape.
    const raw = await this.get<{ inboxes?: Inbox[]; items?: Inbox[]; next_page?: string; next_cursor?: string }>(
      "/v1/inboxes",
      { limit },
    );
    const items = raw.inboxes ?? raw.items ?? [];
    const page: Page<Inbox> = { items };
    const cursor = raw.next_cursor ?? raw.next_page;
    if (cursor) page.next_cursor = cursor;
    return page;
  }

  /** The ceiling tier encoded in the current session's agent key (redesign §3.1). */
  keyTier(): KeyTier {
    return keyTierFromRawKey(this.apiKey);
  }

  async getInbox(idOrAddress: string): Promise<Inbox> {
    if (this.store) {
      const inbox = this.store.getInbox(idOrAddress);
      if (!inbox) throw new ExtrovertApiError(`Inbox not found: ${idOrAddress}`, 404, "not_found");
      return inbox;
    }
    return this.get<Inbox>(`/v1/inboxes/${encodeURIComponent(idOrAddress)}`);
  }

  /**
   * Update an inbox's settings in place: `PATCH /v1/inboxes/{inbox_id}` with
   * `{display_name?, webhook_url?, daily_send_limit?, metadata?, project_id?}`. The agent-facing
   * `inbound_webhook_url` maps to the API's `webhook_url`. `metadata` is a shallow
   * merge: omit it to leave metadata unchanged; an object merges (a `null` value
   * deletes that key); a top-level `null` clears ALL metadata. Owner-scoped
   * server-side. Changing `daily_send_limit` requires the opt-in `mailbox:quota`
   * scope. Returns the updated inbox with the effective enforced cap.
   */
  async updateInbox(idOrAddress: string, input: UpdateInboxInput): Promise<Inbox> {
    if (this.store) {
      const inbox = this.store.updateInbox(idOrAddress, {
        displayName: input.display_name,
        inboundWebhookUrl: input.inbound_webhook_url,
        dailySendLimit: input.daily_send_limit,
        metadata: input.metadata,
        projectId: input.project_id,
      });
      if (!inbox) throw new ExtrovertApiError(`Inbox not found: ${idOrAddress}`, 404, "not_found");
      return inbox;
    }
    const body: Record<string, unknown> = {};
    if (input.display_name !== undefined) body.display_name = input.display_name;
    if (input.inbound_webhook_url !== undefined) body.webhook_url = input.inbound_webhook_url;
    if (input.daily_send_limit !== undefined) body.daily_send_limit = input.daily_send_limit;
    // `metadata` is forwarded verbatim — including an explicit top-level `null`
    // (clear-all) — so the merge-null-clear semantics reach the server unchanged.
    if (input.metadata !== undefined) body.metadata = input.metadata;
    if (input.project_id !== undefined) body.project_id = input.project_id;
    return this.patch<Inbox>(`/v1/inboxes/${encodeURIComponent(idOrAddress)}`, body);
  }

  // ---- credentials (GET /v1/inboxes/{inbox_id}/credentials) -------------------
  async getCredentials(idOrAddress: string): Promise<MailboxCredentials> {
    if (this.store) return this.store.getCredentials(idOrAddress);
    return this.get<MailboxCredentials>(
      `/v1/inboxes/${encodeURIComponent(idOrAddress)}/credentials`,
    );
  }

  /**
   * Permanently delete an inbox and its messages/sender identity. Requires
   * `mailbox:delete`; this cannot be undone.
   */
  async deleteInbox(idOrAddress: string): Promise<{ id: string; deleted: true }> {
    if (this.store) {
      const result = this.store.deleteInbox(idOrAddress);
      if (!result) throw new ExtrovertApiError(`Inbox not found: ${idOrAddress}`, 404, "not_found");
      return result;
    }
    return this.del<{ id: string; deleted: true }>(`/v1/inboxes/${encodeURIComponent(idOrAddress)}`);
  }

  // ---- send / reply -----------------------------------------------------

  /**
   * Send a new message WITHOUT the review overload.
   *
   * The return type is a union because the endpoint has two outcomes and the
   * account's policy — not the caller — picks between them. This used to be typed
   * `Promise<Message>` and rendered as a message header, which was garbage against
   * every real response: the server has never returned a Message here. It returns
   * `{status:"sent", message_id, review_id}` on the policy's direct path, and the
   * §5.1 `{kind:"queued_for_review", review}` envelope (HTTP 202) when the policy
   * queues it — which, under the `require_review` default, is the normal outcome.
   *
   * A send with no `intent` under `require_review` never reaches either arm: it is
   * refused with 422 `intent_required` and NOTHING is sent or queued.
   */
  async sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
    if (this.store) return this.store.sendEmail(input);
    const { inbox, client_id, ...body } = input;
    // `body` carries to/subject/text/html/cc/bcc/reply_to/headers and (when
    // present) attachments — the canonical send contract, mirroring reply; the
    // server emits multipart/mixed when needed and drops unsafe header names.
    return this.post<SendEmailResult>(
      `/v1/inboxes/${encodeURIComponent(inbox)}/send`,
      body,
      undefined,
      idempotencyHeader(client_id),
    );
  }

  /**
   * Thread-aware reply. Canonical contract:
   * `POST /v1/inboxes/{inbox_id}/reply` with `{thread_id|message_id, text, html?, cc?,
   * bcc?, reply_to?, reply_all?}`. The server derives To/Subject/In-Reply-To/
   * References and returns `{message_id, thread_id, review_id}`. No `to` is sent.
   *
   * Like {@link sendEmail} the outcome is policy-decided: a bare reply under
   * `require_review` is QUEUED (202 `{kind:"queued_for_review"}`), not sent, and a
   * bare reply with no intent is refused 422 `intent_required`.
   */
  async replyEmail(input: ReplyEmailInput): Promise<ReplyEmailResult> {
    if (this.store) {
      return this.store.replyEmail({
        inbox: input.inbox,
        threadId: input.thread_id,
        messageId: input.message_id,
        text: input.text,
        html: input.html,
        cc: input.cc,
        bcc: input.bcc,
        replyTo: input.reply_to,
        replyAll: input.reply_all,
        attachments: input.attachments,
      });
    }
    const { inbox, client_id, ...body } = input;
    return this.post<ReplyEmailResult>(
      `/v1/inboxes/${encodeURIComponent(inbox)}/reply`,
      body,
      undefined,
      idempotencyHeader(client_id),
    );
  }

  /**
   * Forward an existing message to new recipients, preserving the original.
   * `POST /v1/inboxes/{inbox_id}/messages/{id}/forward` `{to[], cc?, bcc?, text?, html?}`.
   * `html` is accepted but ignored: the server materializes one plain-text body
   * containing both the note and quoted parent, so HTML clients cannot hide the quote.
   *
   * Policy-decided like send and reply: a bare forward under `require_review` is
   * QUEUED, and one with no intent is refused 422 `intent_required`.
   */
  async forwardEmail(input: ForwardEmailInput): Promise<ReplyEmailResult> {
    if (this.store) {
      return this.store.forwardEmail({
        inbox: input.inbox,
        messageId: input.message_id,
        to: input.to,
        cc: input.cc,
        bcc: input.bcc,
        text: input.text,
        html: input.html,
      });
    }
    const { inbox, message_id, client_id, ...body } = input;
    return this.post<ReplyEmailResult>(
      `/v1/inboxes/${encodeURIComponent(inbox)}/messages/${encodeURIComponent(message_id)}/forward`,
      body,
      undefined,
      idempotencyHeader(client_id),
    );
  }

  /**
   * Submit a forward for human review — the SAME endpoint as {@link forwardEmail}
   * with mode/intent/category_id attached, mirroring how send and reply overload.
   * Returns the discriminated §5.1 envelope (queued OR sent).
   */
  async submitForwardForReview(input: SubmitForwardForReviewInput): Promise<SubmitForReviewResult> {
    if (this.store) return this.store.submitForwardForReview(input);
    const { inbox, message_id, client_id, ...body } = input;
    return this.post<SubmitForReviewResult>(
      `/v1/inboxes/${encodeURIComponent(inbox)}/messages/${encodeURIComponent(message_id)}/forward`,
      body,
      undefined,
      idempotencyHeader(client_id),
    );
  }

  // ---- Review Loop (HITL) -----------------------------------------------

  /**
   * Submit a new message for human review (`POST /v1/inboxes/{inbox_id}/send` with
   * mode/intent/category_id). The server routes per the account/inbox review
   * policy and returns either `{kind:"queued_for_review"}` (202) or
   * `{kind:"sent"}` (200, policy-permitted direct/graduated path).
   */
  async submitForReview(input: SubmitForReviewInput): Promise<SubmitForReviewResult> {
    if (this.store) return this.store.submitForReview(input);
    const { inbox, client_id, ...body } = input;
    return this.post<SubmitForReviewResult>(
      `/v1/inboxes/${encodeURIComponent(inbox)}/send`,
      body,
      undefined,
      idempotencyHeader(client_id),
    );
  }

  /**
   * Submit an in-thread reply for human review (`POST /v1/inboxes/{inbox_id}/reply`
   * with mode/intent/category_id). Same routing/return contract as submitForReview.
   */
  async submitReplyForReview(input: SubmitReplyForReviewInput): Promise<SubmitForReviewResult> {
    if (this.store) return this.store.submitReplyForReview(input);
    const { inbox, client_id, ...body } = input;
    return this.post<SubmitForReviewResult>(
      `/v1/inboxes/${encodeURIComponent(inbox)}/reply`,
      body,
      undefined,
      idempotencyHeader(client_id),
    );
  }

  /** List review requests (`GET /v1/reviews`). Customer-scoped; agent monitors its submissions. */
  async listReviews(input: ListReviewsInput = {}): Promise<Page<Review>> {
    if (this.store) return this.store.listReviews(input);
    const query: Record<string, unknown> = {};
    if (input.state !== undefined) {
      query.state = Array.isArray(input.state) ? input.state.join(",") : input.state;
    }
    if (input.category_id !== undefined) query.category_id = input.category_id;
    if (input.inbox !== undefined) query.inbox = input.inbox;
    if (input.limit !== undefined) query.limit = input.limit;
    if (input.page !== undefined) query.page = input.page;
    return this.get<Page<Review>>("/v1/reviews", query);
  }

  /** Get one review request (`GET /v1/reviews/{id}`) — current draft + intent + state. */
  async getReview(id: string): Promise<Review> {
    if (this.store) return this.store.getReview(id);
    return this.get<Review>(`/v1/reviews/${encodeURIComponent(id)}`);
  }

  /** Get a review's append-only thread turns (`GET /v1/reviews/{id}/turns`). */
  async getReviewTurns(id: string): Promise<Page<ReviewTurn>> {
    if (this.store) return this.store.getReviewTurns(id);
    return this.get<Page<ReviewTurn>>(`/v1/reviews/${encodeURIComponent(id)}/turns`);
  }

  /**
   * Get the human's assembled feedback for a review (`GET /v1/reviews/{id}/feedback`):
   * the unified + structured diff, the human comments, the decision, and the rules born
   * from this review (rule_ ids). Read-only; $0 LLM (pure assembly).
   */
  async getReviewFeedback(id: string): Promise<ReviewFeedback> {
    if (this.store) return this.store.getReviewFeedback(id);
    return this.get<ReviewFeedback>(`/v1/reviews/${encodeURIComponent(id)}/feedback`);
  }

  /**
   * Post a chat turn on a review's thread (`POST /v1/reviews/{id}/chat`): append an
   * agent_question turn, flip in_review -> chatting on the first turn, enqueue a
   * feedback_added nudge to the human reviewer + emit review.chat. Idempotent on the
   * client-supplied key. $0 LLM — YOU compose the question.
   */
  async postReviewChat(input: PostReviewChatInput): Promise<Review> {
    if (this.store) return this.store.postReviewChat(input);
    return this.post<Review>(
      `/v1/reviews/${encodeURIComponent(input.id)}/chat`,
      { text: input.text },
      undefined,
      idempotencyHeader(input.client_id),
    );
  }

  /**
   * Post a new agent draft under a parent_revision CAS (`POST /v1/reviews/{id}/
   * revision`). parent_revision must equal the draft's current revision, else 409
   * STALE with NO mutation (D17). On a clean CAS the draft is re-rendered in place
   * (revision++), returned to needs_review, and the reviewer is nudged. $0 LLM — YOU
   * compose the redraft.
   */
  async submitRevision(input: SubmitRevisionInput): Promise<Review> {
    if (this.store) return this.store.submitRevision(input);
    const body: Record<string, unknown> = { parent_revision: input.parent_revision };
    if (input.version !== undefined) body.version = input.version;
    if (input.subject !== undefined) body.subject = input.subject;
    // `text` is canonical; `body` is the permanent deprecated alias. BOTH are
    // forwarded verbatim when supplied so the server's own alias resolution decides
    // — including rejecting a both-but-different pair with 400 conflicting_alias.
    // Picking a winner here would silently relay the wrong bytes.
    if (input.text !== undefined) body.text = input.text;
    if (input.body !== undefined) body.body = input.body;
    if (input.html !== undefined) body.html = input.html;
    if (input.attachments !== undefined) body.attachments = input.attachments;
    if (input.built_at !== undefined) body.built_at = input.built_at;
    if (input.rules_version_seen !== undefined) body.rules_version_seen = input.rules_version_seen;
    return this.post<Review>(
      `/v1/reviews/${encodeURIComponent(input.id)}/revision`,
      body,
      undefined,
      idempotencyHeader(input.client_id),
    );
  }

  /**
   * Withdraw a pending review (`POST /v1/reviews/{id}/cancel`): the composing agent
   * cancels its own review to the terminal cancelled state. A foreign id / another
   * agent's draft 404s; a terminal review 409s.
   */
  async cancelReview(input: { id: string; client_id?: string }): Promise<Review> {
    if (this.store) return this.store.cancelReview(input.id);
    return this.post<Review>(
      `/v1/reviews/${encodeURIComponent(input.id)}/cancel`,
      {},
      undefined,
      idempotencyHeader(input.client_id),
    );
  }

  /**
   * Re-stamp a draft's rules-version WITHOUT redrafting (`POST /v1/reviews/{id}/
   * restamp`; D19/§8 $0 escape valve). Assert "reviewed against vX, no change needed"
   * and the server advances the draft's composed_* versions with no new draft, no
   * revision bump, no nudge. against_version above the category's current rules-version
   * is 400; a terminal/sent draft 409s.
   */
  async restampReview(input: RestampReviewInput): Promise<Review> {
    if (this.store) return this.store.restampReview(input);
    const body: Record<string, unknown> = { against_version: input.against_version };
    if (input.house_style_version !== undefined) body.house_style_version = input.house_style_version;
    return this.post<Review>(
      `/v1/reviews/${encodeURIComponent(input.id)}/restamp`,
      body,
      undefined,
      idempotencyHeader(input.client_id),
    );
  }

  /**
   * Get the REVIEWER's decision context for a review (`GET /v1/reviews/{id}/
   * decision-context`; BYO review-agent plane, D5/§9). The reviewer's read-only view:
   * the intent + current draft + thread + the two-circuit-breaker budget (hop_count vs
   * max_hops, the hard review_deadline). Requires review:act + a matching active link;
   * a cross-tenant id is 404, a non-reviewer is 403. `force_to_human` is true when a
   * reject would be FORCED to the human regardless of intent (D17).
   */
  async getReviewDecisionContext(id: string): Promise<ReviewDecisionContext> {
    if (this.store) return this.store.getReviewDecisionContext(id);
    return this.get<ReviewDecisionContext>(`/v1/reviews/${encodeURIComponent(id)}/decision-context`);
  }

  /**
   * Submit a reviewer decision (`POST /v1/reviews/{id}/decision`; reviewer_decide,
   * D5/§9). approve/edit → the PLATFORM ACS-sends with the COMPOSER's creds (the
   * reviewer NEVER holds mailbox:send — the credential boundary); reject → back to the
   * composer (needs_review, hop_count++); escalate → the human queue. revision/version
   * are the CAS (409 STALE on mismatch, NO mutation — the human always wins, D17). The
   * two circuit breakers (hop_count ≥ max_hops, or the hard review_deadline) FORCE a
   * reject to the human regardless of intent — `forced_by_breaker` names it. $0 LLM —
   * you judged; we route, send, and enforce the breakers.
   */
  async reviewerDecide(input: ReviewerDecideInput): Promise<ReviewerDecisionResult> {
    if (this.store) return this.store.reviewerDecide(input);
    const body: Record<string, unknown> = { action: input.action, revision: input.revision };
    if (input.version !== undefined) body.version = input.version;
    if (input.subject !== undefined) body.subject = input.subject;
    if (input.body !== undefined) body.body = input.body;
    if (input.feedback !== undefined) body.feedback = input.feedback;
    return this.post<ReviewerDecisionResult>(`/v1/reviews/${encodeURIComponent(input.id)}/decision`, body);
  }

  /**
   * Drain the next un-acked review events (`GET /v1/reviews/events`). Non-blocking;
   * returns the FIFO-ordered nudges + per-review cursors. Side-effect free.
   */
  async listReviewEvents(input: ListReviewEventsInput = {}): Promise<ReviewEventsResult> {
    if (this.store) return this.store.listReviewEvents(input);
    const query: Record<string, unknown> = {};
    if (input.review_id !== undefined) query.review_id = input.review_id;
    if (input.limit !== undefined) query.limit = input.limit;
    return this.get<ReviewEventsResult>("/v1/reviews/events", query);
  }

  /**
   * Long-poll for a review event (`GET /v1/reviews/events/wait`). Blocks ~25–55s
   * until a nudge is available OR the deadline, then returns like
   * {@link listReviewEvents} (empty on timeout).
   */
  async waitForReviewEvent(input: WaitForReviewEventInput = {}): Promise<ReviewEventsResult> {
    if (this.store) return this.store.waitForReviewEvent(input);
    const query: Record<string, unknown> = {};
    if (input.review_id !== undefined) query.review_id = input.review_id;
    if (input.limit !== undefined) query.limit = input.limit;
    if (input.wait_seconds !== undefined) query.wait_seconds = input.wait_seconds;
    return this.get<ReviewEventsResult>("/v1/reviews/events/wait", query);
  }

  /**
   * Ack review events (`POST /v1/reviews/events/ack`): advance per-(agent, review)
   * cursor(s) and/or mark broadcast nudges done. Idempotent + monotonic.
   */
  async ackReviewEvent(input: AckReviewEventInput): Promise<{ cursors: ReviewEventsResult["cursors"] }> {
    if (this.store) return this.store.ackReviewEvent(input);
    return this.post<{ cursors: ReviewEventsResult["cursors"] }>("/v1/reviews/events/ack", {
      acks: input.acks ?? [],
      broadcast_ids: input.broadcast_ids ?? [],
    });
  }

  // ---- Category registry (Review Loop, D9/D10) --------------------------

  /**
   * Browse the category registry (`GET /v1/categories?match=`). Returns id + name +
   * description + scope + state for fuzzy matching. `match` is a pure lexical filter
   * (NO LLM on our side) — the agent does the semantic match. Customer-scoped.
   */
  async listCategories(match?: string): Promise<Page<Category>> {
    if (this.store) return this.store.listCategories(match);
    const query: Record<string, unknown> = {};
    if (match !== undefined && match.trim() !== "") query.match = match;
    return this.get<Page<Category>>("/v1/categories", query);
  }

  /** Get one category (`GET /v1/categories/{id}`). A foreign id is 404. */
  async getCategory(id: string): Promise<Category> {
    if (this.store) return this.store.getCategory(id);
    return this.get<Category>(`/v1/categories/${encodeURIComponent(id)}`);
  }

  /**
   * Propose a new category (`POST /v1/categories`). It stands immediately
   * (author_kind=agent) and writes a create audit/undo row. Match the registry
   * first so you do not duplicate an existing bucket.
   */
  async proposeCategory(input: ProposeCategoryInput): Promise<Category> {
    if (this.store) return this.store.proposeCategory(input);
    return this.post<Category>("/v1/categories", {
      name: input.name,
      description: input.description,
      scope: input.scope,
    });
  }

  /**
   * Rename / re-describe a category (`PUT /v1/categories/{id}`) — metadata ONLY
   * (D10). Renaming never breaks a reference; a rename/redescribe undo row is
   * written. Any agent in the customer may edit (the shared-registry exception).
   */
  async updateCategory(input: UpdateCategoryInput): Promise<Category> {
    if (this.store) return this.store.updateCategory(input);
    const body: Record<string, unknown> = {};
    if (input.name !== undefined) body.name = input.name;
    if (input.description !== undefined) body.description = input.description;
    return this.put<Category>(`/v1/categories/${encodeURIComponent(input.id)}`, body);
  }

  // ---- Graduation + risk dial (Review Loop, D16/D6/D17) — agent READ + PROPOSE --

  /**
   * Read the effective risk dial (`GET /v1/risk-dial`): the account default + every
   * category's overrides (each with its resolved effective value; null override =
   * inherit). Read-only — agents read but NEVER flip the dial (setting it is a human
   * console action; D16).
   */
  async getRiskDial(): Promise<RiskDial> {
    if (this.store) return this.store.getRiskDial();
    return this.get<RiskDial>("/v1/risk-dial");
  }

  /**
   * Read a category's graduation gate status (`GET /v1/categories/{id}/graduation-
   * status`): the gates passed / still needed toward the next rung (approvals N/needed,
   * age, maturity gate, drift vs K, can_graduate). Read-only.
   */
  async getGraduationStatus(categoryId: string): Promise<GraduationStatus> {
    if (this.store) return this.store.getGraduationStatus(categoryId);
    return this.get<GraduationStatus>(`/v1/categories/${encodeURIComponent(categoryId)}/graduation-status`);
  }

  /**
   * Propose graduating a category (`POST /v1/categories/{id}/graduation-request`).
   * RECORDS the request (durable evidence) and returns the current gate status; it
   * does NOT change the category state — flipping the bit is a human (console) action
   * (D16/D6). A never_graduate category stays locked.
   */
  async proposeGraduation(categoryId: string, evidence?: Record<string, unknown>): Promise<GraduationStatus> {
    if (this.store) return this.store.proposeGraduation(categoryId, evidence);
    return this.post<GraduationStatus>(`/v1/categories/${encodeURIComponent(categoryId)}/graduation-request`, {
      evidence: evidence ?? {},
    });
  }

  /**
   * Read the D19/§8 backlog-reconciliation status (`GET /v1/categories/{id}/
   * backlog-status`): how many QUEUED drafts are stale vs current-enough against the
   * current rules-version (a pure $0-LLM integer compare). Read-only — agents READ the
   * picture; the human (console scan-backlog) / hooks TRIGGER the actual sweep.
   */
  async getBacklogStatus(categoryId: string): Promise<ScanBacklogStatus> {
    if (this.store) return this.store.getBacklogStatus(categoryId);
    return this.get<ScanBacklogStatus>(`/v1/categories/${encodeURIComponent(categoryId)}/backlog-status`);
  }

  /**
   * Read the demand-driven pacing state (`GET /v1/categories/{id}/pacing-state`;
   * M7 Slice B/§8): the human review cursor, the effective window/ceiling/interval, and
   * each queued draft's in-window/redrafting/behind-cursor classification. Read-only;
   * the cursor advances from the human's console approve/reject/edit actions.
   */
  async getPacingState(categoryId: string): Promise<CategoryPacingState> {
    if (this.store) return this.store.getPacingState(categoryId);
    return this.get<CategoryPacingState>(`/v1/categories/${encodeURIComponent(categoryId)}/pacing-state`);
  }

  // ---- Writing rules + house-style + precedence ladder + audit/undo ------

  /**
   * Get the ORDERED active rule set (`GET /v1/rules?category_id=&scope=`). The §7
   * precedence ladder is applied SERVER-SIDE (NO LLM): hard>soft; per-agent>category>
   * general; human>agent; newest rev/created_at; higher priority; plus a soft cap.
   * Includes the general/house-style layer (D2) IN ADDITION to the category's rules.
   */
  async getRules(input: GetRulesInput = {}): Promise<Page<Rule>> {
    if (this.store) return this.store.getRules(input);
    const query: Record<string, unknown> = {};
    if (input.category_id) query.category_id = input.category_id;
    if (input.scope) query.scope = input.scope;
    return this.get<Page<Rule>>("/v1/rules", query);
  }

  /**
   * Save / edit a writing rule (`PUT /v1/rules`) — append-only by supersession (D11).
   * scope='general' iff category_id is empty (house-style, D2). With supersedes_id
   * the write is an EDIT (rev+1, same lineage). Writes a create/supersede audit row.
   */
  async saveRule(input: SaveRuleInput): Promise<Rule> {
    if (this.store) return this.store.saveRule(input);
    const body: Record<string, unknown> = { rule_text: input.rule_text };
    if (input.scope) body.scope = input.scope;
    if (input.category_id) body.category_id = input.category_id;
    if (input.kind) body.kind = input.kind;
    if (input.priority !== undefined) body.priority = input.priority;
    if (input.source_review_id) body.source_review_id = input.source_review_id;
    if (input.source_turn_id) body.source_turn_id = input.source_turn_id;
    if (input.supersedes_id) body.supersedes_id = input.supersedes_id;
    if (input.scope_agent_id) body.scope_agent_id = input.scope_agent_id;
    if (input.propagate_to_pending !== undefined) body.propagate_to_pending = input.propagate_to_pending;
    if (input.suggested_batch !== undefined) body.suggested_batch = input.suggested_batch;
    return this.put<Rule>("/v1/rules", body);
  }

  /**
   * Promote a rule between the category and general/house-style layers
   * (`POST /v1/rules/{id}/promote`) via a supersession.
   */
  async promoteRule(id: string, toScope: "general" | "category"): Promise<Rule> {
    if (this.store) return this.store.promoteRule(id, toScope);
    return this.post<Rule>(`/v1/rules/${encodeURIComponent(id)}/promote`, { to_scope: toScope });
  }

  /** Retire a rule (`POST /v1/rules/{id}/retire`) — soft delete; history survives. */
  async retireRule(id: string): Promise<Rule> {
    if (this.store) return this.store.retireRule(id);
    return this.post<Rule>(`/v1/rules/${encodeURIComponent(id)}/retire`, {});
  }

  /**
   * Read the rule/category change audit log (`GET /v1/rules/audit`) — read-only,
   * agent-visible (the audit log is the shared safety net, D11).
   */
  async getRuleAudit(input: GetRuleAuditInput = {}): Promise<Page<RuleAuditEntry>> {
    if (this.store) return this.store.getRuleAudit(input);
    const query: Record<string, unknown> = {};
    if (input.entity_kind) query.entity_kind = input.entity_kind;
    if (input.entity_id) query.entity_id = input.entity_id;
    return this.get<Page<RuleAuditEntry>>("/v1/rules/audit", query);
  }

  /**
   * Undo a rule change (`POST /v1/rules/audit/{udo_id}/undo`) — restore the prior
   * version as a forward 'restore' supersession (D11; agents may undo too).
   * Idempotent: a re-undo of an already-undone row is a clean 409.
   */
  async undoRuleChange(udoId: string): Promise<Rule> {
    if (this.store) return this.store.undoRuleChange(udoId);
    return this.post<Rule>(`/v1/rules/audit/${encodeURIComponent(udoId)}/undo`, {});
  }

  // ---- read / list / search ---------------------------------------------

  /**
   * List messages in an inbox, newest-first. Canonical contract:
   * `GET /v1/inboxes/{inbox_id}/messages` with optional exact-field filters
   * (from/to/subject), an `unread=true` filter (native IMAP \Seen), and
   * limit/offset paging. Returns the canonical `Page<Message>` ({items,total}).
   */
  async listMessages(input: {
    inbox: string;
    limit?: number;
    offset?: number;
    unread_only?: boolean;
    from?: string;
    to?: string;
    subject?: string;
  }): Promise<Page<Message>> {
    if (this.store) {
      return this.store.listMessages({
        inbox: input.inbox,
        limit: input.limit,
        offset: input.offset,
        unreadOnly: input.unread_only,
        from: input.from,
        to: input.to,
        subject: input.subject,
      });
    }
    return this.get<Page<Message>>(`/v1/inboxes/${encodeURIComponent(input.inbox)}/messages`, {
      limit: input.limit,
      offset: input.offset,
      // The server reads the native \Seen flag; `unread=true` keeps only unread.
      unread: input.unread_only ? "true" : undefined,
      from: input.from,
      to: input.to,
      subject: input.subject,
    });
  }

  /** Fetch a single message by its opaque id (`GET /v1/messages/{id}`). */
  async getMessage(id: string): Promise<Message> {
    if (this.store) return this.store.getMessage(id);
    return this.get<Message>(`/v1/messages/${encodeURIComponent(id)}`);
  }

  /**
   * List a message's attachment metadata
   * (`GET /v1/inboxes/{inbox_id}/messages/{id}/attachments` → `Page<Attachment>`).
   */
  async listAttachments(input: { inbox: string; message_id: string }): Promise<Page<Attachment>> {
    if (this.store) return this.store.listAttachments(input.message_id);
    return this.get<Page<Attachment>>(
      `/v1/inboxes/${encodeURIComponent(input.inbox)}/messages/${encodeURIComponent(input.message_id)}/attachments`,
    );
  }

  /**
   * Download one attachment's bytes (base64) + metadata
   * (`GET /v1/inboxes/{inbox_id}/messages/{id}/attachments/{attId}` → raw bytes with
   * Content-Type + Content-Disposition). The "easy attachment fetch."
   */
  async getAttachment(input: {
    inbox: string;
    message_id: string;
    attachment_id: string;
  }): Promise<AttachmentDownload> {
    if (this.store) return this.store.getAttachment(input.message_id, input.attachment_id);
    return this.getBinary(
      `/v1/inboxes/${encodeURIComponent(input.inbox)}/messages/${encodeURIComponent(input.message_id)}/attachments/${encodeURIComponent(input.attachment_id)}`,
    );
  }

  /**
   * Mark a message read/unread via the native IMAP \Seen flag
   * (`PATCH /v1/inboxes/{inbox_id}/messages/{id}` {read}). The inbox is resolved
   * from the message id. Returns the updated message.
   */
  async markRead(input: { inbox: string; id: string; read: boolean }): Promise<Message> {
    if (this.store) return this.store.markRead(input.id, input.read);
    return this.request<Message>(
      "PATCH",
      `/v1/inboxes/${encodeURIComponent(input.inbox)}/messages/${encodeURIComponent(input.id)}`,
      { read: input.read },
    );
  }

  async listThreads(input: { inbox: string; limit?: number }): Promise<Page<Thread>> {
    if (this.store) return this.store.listThreads(input);
    return this.get<Page<Thread>>(`/v1/inboxes/${encodeURIComponent(input.inbox)}/threads`, {
      limit: input.limit,
    });
  }

  /**
   * Fetch one thread (with its messages, oldest-first) by stable id, scoped to
   * the owning inbox: `GET /v1/inboxes/{inbox_id}/threads/{id}`.
   */
  async getThread(input: { inbox: string; thread_id: string }): Promise<ThreadDetail> {
    if (this.store) return this.store.getThread(input.inbox, input.thread_id);
    return this.get<ThreadDetail>(
      `/v1/inboxes/${encodeURIComponent(input.inbox)}/threads/${encodeURIComponent(input.thread_id)}`,
    );
  }

  /**
   * Delete a message: move it to Trash, or permanently expunge it when
   * `expunge` is set (`DELETE /v1/inboxes/{inbox_id}/messages/{id}?expunge=`). A
   * message already in Trash is always expunged.
   */
  async deleteMessage(input: { inbox: string; id: string; expunge?: boolean }): Promise<DeleteResult> {
    if (this.store) return this.store.deleteMessage(input.inbox, input.id, input.expunge ?? false);
    const q = input.expunge ? "?expunge=true" : "";
    return this.del<DeleteResult>(
      `/v1/inboxes/${encodeURIComponent(input.inbox)}/messages/${encodeURIComponent(input.id)}${q}`,
    );
  }

  /**
   * Delete an entire thread (every message): move to Trash, or expunge when
   * `expunge` is set (`DELETE /v1/inboxes/{inbox_id}/threads/{id}?expunge=`).
   */
  async deleteThread(input: { inbox: string; thread_id: string; expunge?: boolean }): Promise<DeleteResult> {
    if (this.store) return this.store.deleteThread(input.inbox, input.thread_id, input.expunge ?? false);
    const q = input.expunge ? "?expunge=true" : "";
    return this.del<DeleteResult>(
      `/v1/inboxes/${encodeURIComponent(input.inbox)}/threads/${encodeURIComponent(input.thread_id)}${q}`,
    );
  }

  /**
   * Batch mark read/unread and/or move folder for a list of message ids in one
   * inbox (`PATCH /v1/inboxes/{inbox_id}/messages/batch`). At least one of
   * `read` / `folder` must be set; returns the per-id `{updated, failed}` split.
   */
  async batchUpdateMessages(input: {
    inbox: string;
    ids: string[];
    read?: boolean;
    folder?: string;
  }): Promise<BatchUpdateResult> {
    if (this.store) return this.store.batchUpdateMessages(input.inbox, input.ids, input.read, input.folder);
    const body: Record<string, unknown> = { ids: input.ids };
    if (input.read !== undefined) body.read = input.read;
    if (input.folder !== undefined) body.folder = input.folder;
    return this.request<BatchUpdateResult>(
      "PATCH",
      `/v1/inboxes/${encodeURIComponent(input.inbox)}/messages/batch`,
      body,
    );
  }

  /**
   * Full-text search backed by IMAP SEARCH, scoped to one inbox
   * (`GET /v1/inboxes/{inbox_id}/messages/search?q=...`). When `inbox` is omitted,
   * iterate every inbox the agent owns and merge the results (newest-first).
   */
  async search(input: { query: string; inbox?: string; limit?: number }): Promise<Page<Message>> {
    if (this.store) return this.store.search(input);
    const limit = input.limit ?? 20;
    if (input.inbox) {
      return this.get<Page<Message>>(
        `/v1/inboxes/${encodeURIComponent(input.inbox)}/messages/search`,
        { q: input.query, limit },
      );
    }
    // No inbox specified: fan out across the agent's inboxes and merge.
    const inboxes = await this.listInboxes(100);
    const merged: Message[] = [];
    for (const ibx of inboxes.items) {
      const page = await this.get<Page<Message>>(
        `/v1/inboxes/${encodeURIComponent(ibx.address)}/messages/search`,
        { q: input.query, limit },
      );
      merged.push(...page.items);
    }
    merged.sort((a, b) => b.date.localeCompare(a.date));
    const items = merged.slice(0, limit);
    return { items, total: merged.length };
  }

  // ---- wait_for_email (POST /v1/wait) -----------------------------------

  async waitForEmail(input: WaitForEmailInput): Promise<WaitForEmailResult> {
    if (this.store) {
      return this.store.waitForEmail({
        inbox: input.inbox,
        from: input.from,
        subject: input.subject,
        regex: input.regex,
        linkHint: input.link_hint,
        timeoutMs: input.timeout_ms,
      });
    }
    // The server blocks (IMAP poll) up to timeout_seconds; give the HTTP read a
    // margin over it so the server, not the client, decides the no-match timeout.
    // Field names are the canonical API ones: `match` (regex), `since_now`,
    // `timeout_seconds`.
    const started = Date.now();
    const timeoutSeconds = Math.ceil(input.timeout_ms / 1000);
    const wire = await this.post<WaitWireResult>(
      `/v1/inboxes/${encodeURIComponent(input.inbox)}/wait`,
      {
        from: input.from,
        subject: input.subject,
        match: input.regex,
        link_hint: input.link_hint,
        since_now: input.since_now,
        timeout_seconds: timeoutSeconds,
      },
      input.timeout_ms + 5_000,
    );
    // Translate the canonical wire shape into the MCP tool's result shape.
    const result: WaitForEmailResult = {
      matched: !wire.timed_out,
      waited_ms: Date.now() - started,
    };
    if (wire.message) result.message = wire.message;
    if (wire.extracted?.otp) result.otp_code = wire.extracted.otp;
    if (wire.extracted?.link) result.verification_link = wire.extracted.link;
    return result;
  }

  // ---- webhooks (CRUD; spec §6/§14) -------------------------------------

  /**
   * Register an inbound webhook (`POST /v1/webhooks`). The signing `secret` is
   * returned ONCE here; deliveries are HMAC-signed in the canonical
   * `X-Extrovert-Signature: t=<unix>,v1=<hex>` format.
   */
  async registerWebhook(input: RegisterWebhookInput): Promise<Webhook> {
    if (this.store) {
      return this.store.registerWebhook({
        url: input.url,
        events: input.events,
        inbox: input.inbox,
        clientId: input.client_id,
      });
    }
    return this.post<Webhook>(
      "/v1/webhooks",
      {
        url: input.url,
        events: input.events,
        inbox: input.inbox,
        client_id: input.client_id,
      },
      undefined,
      idempotencyHeader(input.client_id),
    );
  }

  /** List registered webhooks (`GET /v1/webhooks`); secrets are redacted. */
  async listWebhooks(): Promise<Page<Webhook>> {
    if (this.store) return this.store.listWebhooks();
    return this.get<Page<Webhook>>("/v1/webhooks");
  }

  /** Get one webhook by id (`GET /v1/webhooks/{id}`); secret redacted. */
  async getWebhook(id: string): Promise<Webhook> {
    if (this.store) return this.store.getWebhook(id);
    return this.get<Webhook>(`/v1/webhooks/${encodeURIComponent(id)}`);
  }

  /**
   * Update a webhook in place (`PATCH /v1/webhooks/{id}`). Every field is
   * optional; an omitted field is left unchanged (PATCH semantics). The signing
   * secret is immutable and stays redacted in the response.
   */
  async updateWebhook(
    id: string,
    input: { url?: string; events?: WebhookEvent[]; inbox?: string; active?: boolean },
  ): Promise<Webhook> {
    if (this.store) return this.store.updateWebhook(id, input);
    const body: { url?: string; events?: WebhookEvent[]; inbox?: string; active?: boolean } = {};
    if (input.url !== undefined) body.url = input.url;
    if (input.events !== undefined) body.events = input.events;
    if (input.inbox !== undefined) body.inbox = input.inbox;
    if (input.active !== undefined) body.active = input.active;
    return this.patch<Webhook>(`/v1/webhooks/${encodeURIComponent(id)}`, body);
  }

  /** Delete a webhook by id (`DELETE /v1/webhooks/{id}`). */
  async deleteWebhook(id: string): Promise<{ id: string; deleted: true }> {
    if (this.store) return this.store.deleteWebhook(id);
    await this.del<unknown>(`/v1/webhooks/${encodeURIComponent(id)}`);
    return { id, deleted: true };
  }

  // ---- contact allow/block lists (Slice 3) ------------------------------

  /**
   * Add an allow/block entry to an inbox's contact lists
   * (`POST /v1/inboxes/{inbox_id}/lists`). A `block` entry rejects a matching
   * recipient on send; when an `allow` entry exists, sends from this inbox are
   * restricted to recipients that match one (allowlist mode).
   */
  async addContactListEntry(input: AddContactListInput): Promise<ContactListEntry> {
    if (this.store) {
      return this.store.addContactListEntry(input.inbox, {
        kind: input.kind,
        direction: input.direction,
        pattern: input.pattern,
      });
    }
    return this.post<ContactListEntry>(`/v1/inboxes/${encodeURIComponent(input.inbox)}/lists`, {
      kind: input.kind,
      direction: input.direction,
      pattern: input.pattern,
    });
  }

  /** List the contact-list entries governing an inbox (`GET /v1/inboxes/{inbox_id}/lists`). */
  async listContactListEntries(inbox: string): Promise<Page<ContactListEntry>> {
    if (this.store) return this.store.listContactListEntries(inbox);
    return this.get<Page<ContactListEntry>>(`/v1/inboxes/${encodeURIComponent(inbox)}/lists`);
  }

  /** Delete a contact-list entry by id (`DELETE /v1/inboxes/{inbox_id}/lists/{id}`). */
  async deleteContactListEntry(inbox: string, id: string): Promise<{ id: string; deleted: true }> {
    if (this.store) return this.store.deleteContactListEntry(inbox, id);
    await this.del<unknown>(
      `/v1/inboxes/${encodeURIComponent(inbox)}/lists/${encodeURIComponent(id)}`,
    );
    return { id, deleted: true };
  }

  // ---- domains (Slice 5; privileged, domain:manage scope) ---------------

  /** List the customer's onboarded domains (`GET /v1/domains`). Canonical page envelope. */
  async listDomains(): Promise<Page<Domain>> {
    if (this.store) return this.store.listDomains();
    return this.get<Page<Domain>>("/v1/domains");
  }

  /** Get one domain's detail + verification status + the DNS records to set (`GET /v1/domains/{domain}`). */
  async getDomain(domain: string): Promise<Domain> {
    if (this.store) return this.store.getDomain(domain);
    return this.get<Domain>(`/v1/domains/${encodeURIComponent(domain)}`);
  }

  /** Onboard/add a domain for the customer (`POST /v1/domains`). */
  async onboardDomain(input: OnboardDomainInput): Promise<Domain> {
    if (this.store) return this.store.onboardDomain(input);
    const body: Record<string, unknown> = { domain: input.domain };
    if (input.mode !== undefined) body.mode = input.mode;
    if (input.mail_host_ip !== undefined) body.mail_host_ip = input.mail_host_ip;
    if (input.scope !== undefined) body.scope = input.scope;
    if (input.project_id !== undefined) body.project_id = input.project_id;
    return this.post<Domain>("/v1/domains", body);
  }

  /** Trigger/refresh verification for a domain (`POST /v1/domains/{domain}/verify`). */
  async verifyDomain(domain: string): Promise<Domain> {
    if (this.store) return this.store.verifyDomain(domain);
    return this.post<Domain>(`/v1/domains/${encodeURIComponent(domain)}/verify`);
  }

  /**
   * Offboard (remove) a domain from the customer (`DELETE /v1/domains/{domain}`).
   * The API accepts the request (HTTP 202) and runs the teardown — reaping the
   * outbound provider sender identities + routing rows, then scrubbing the DNS
   * zone/records and the domain row — as an async job. This returns the job id and
   * a poll URL (`status_url`, i.e. `GET /v1/jobs/{job_id}`); offboarding is
   * ACCEPTED, not yet complete. Poll with `getJob(job_id)` (the `get_job` tool)
   * until the status is terminal.
   */
  async offboardDomain(domain: string): Promise<DomainOffboard> {
    if (this.store) return this.store.offboardDomain(domain);
    const res = await this.del<{ job_id?: string; status?: string; status_url?: string }>(
      `/v1/domains/${encodeURIComponent(domain)}`,
    );
    const jobId = res?.job_id ?? "";
    return {
      domain,
      job_id: jobId,
      status: res?.status ?? "queued",
      status_url: res?.status_url ?? (jobId ? `/v1/jobs/${jobId}` : ""),
    };
  }

  /**
   * Poll the status of an async job (`GET /v1/jobs/{job_id}`) — currently only
   * the domain-offboard teardown enqueues one. `status` is terminal on
   * succeeded/failed/cancelled; keep polling otherwise.
   */
  async getJob(jobId: string): Promise<Job> {
    if (this.store) return this.store.getJob(jobId);
    return this.get<Job>(`/v1/jobs/${encodeURIComponent(jobId)}`);
  }

  // ---- suppressions (recipient opt-outs / list-unsubscribe) -------------

  /**
   * Pre-check whether the caller's org suppresses a recipient
   * (`GET /v1/suppressions?recipient=…`). Returns `{recipient, suppressed, rows}`
   * over the caller's OWN active org rows — never a global/shared/cross-tenant
   * opt-out. Use it BEFORE composing to skip a would-be-rejected recipient.
   */
  async precheckSuppression(recipient: string): Promise<SuppressionPrecheck> {
    if (this.store) return this.store.precheckSuppression(recipient);
    // The `recipient` query param routes the server to the pre-check shape.
    return this.get<SuppressionPrecheck>("/v1/suppressions", { recipient });
  }

  /**
   * List the caller's own org suppression rows (`GET /v1/suppressions`). No
   * `recipient` is sent here — that param switches the server to the pre-check.
   */
  async listSuppressions(input: ListSuppressionsInput = {}): Promise<Page<SuppressionEntry>> {
    if (this.store) return this.store.listSuppressions(input);
    const query: Record<string, unknown> = {};
    if (input.scope) query.scope = input.scope;
    if (input.include_revoked) query.include_revoked = "true";
    if (input.limit !== undefined) query.limit = input.limit;
    if (input.cursor !== undefined) query.cursor = input.cursor;
    return this.get<Page<SuppressionEntry>>("/v1/suppressions", query);
  }

  /**
   * Revoke one org-scope suppression row (`POST /v1/suppressions/{id}/revoke`),
   * re-enabling sending to that recipient. A `reason` is REQUIRED (empty is a 400)
   * and is audit-logged. A foreign/global/shared id is an indistinguishable 404.
   */
  async revokeSuppression(id: string, reason: string): Promise<SuppressionEntry> {
    if (this.store) return this.store.revokeSuppression(id, reason);
    return this.post<SuppressionEntry>(`/v1/suppressions/${encodeURIComponent(id)}/revoke`, {
      reason,
    });
  }

  // ---- reputation / deliverability (diverse-smtp M7) --------------------

  /**
   * The caller's org deliverability rollup (`GET /v1/reputation`): derived status
   * badge, per-provider/tenant sending status, latest Sends/Bounces/Complaints
   * window, and open-finding count. Read-only; strictly org-scoped. Advisor
   * findings show `unavailable_vdm_disabled` when VDM is off.
   */
  async getReputation(): Promise<ReputationRollup> {
    if (this.store) return this.store.getReputation();
    return this.get<ReputationRollup>("/v1/reputation");
  }

  /**
   * List the caller's org deliverability findings (`GET /v1/reputation/findings`),
   * newest-first, with optional status/severity/domain/sender filters. Read-only.
   */
  async listDeliverabilityFindings(
    input: ListDeliverabilityFindingsInput = {},
  ): Promise<Page<ReputationFinding>> {
    if (this.store) return this.store.listDeliverabilityFindings(input);
    const query: Record<string, unknown> = {};
    if (input.status) query.status = input.status;
    if (input.severity) query.severity = input.severity;
    if (input.domain) query.domain = input.domain;
    if (input.sender) query.sender = input.sender;
    if (input.limit !== undefined) query.limit = input.limit;
    if (input.cursor !== undefined) query.cursor = input.cursor;
    return this.get<Page<ReputationFinding>>("/v1/reputation/findings", query);
  }

  // ---- low-level HTTP ---------------------------------------------------

  private async get<T>(path: string, query?: Record<string, unknown>): Promise<T> {
    return this.request<T>("GET", path, undefined, query);
  }

  /**
   * Fetch a binary endpoint (the attachment download) and return its bytes as
   * base64 plus the filename + content type pulled from the response headers.
   * Bypasses the JSON `request` path so arbitrary bytes survive intact.
   */
  private async getBinary(path: string): Promise<AttachmentDownload> {
    const url = new URL(this.config.apiBaseUrl + path);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
    const headers: Record<string, string> = { "User-Agent": "extrovert-mcp/0.1.0" };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    let res: Response;
    try {
      res = await fetch(url, { method: "GET", headers, signal: controller.signal });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new ExtrovertApiError(`Request to GET ${path} failed: ${reason}`, 0, "network_error");
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const raw = await res.text();
      const parsed = raw ? safeJsonParse(raw) : undefined;
      throw errorFromBody(res.status, res.statusText, parsed);
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    return {
      filename: filenameFromDisposition(res.headers.get("content-disposition") ?? ""),
      content_type: res.headers.get("content-type") ?? "application/octet-stream",
      content_base64: bytesToBase64(bytes),
    };
  }

  private async post<T>(
    path: string,
    body?: unknown,
    timeoutMs?: number,
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    return this.request<T>("POST", path, body, undefined, timeoutMs, extraHeaders);
  }

  private async del<T>(path: string): Promise<T> {
    return this.request<T>("DELETE", path);
  }

  private async patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("PATCH", path, body);
  }

  private async put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("PUT", path, body);
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, unknown>,
    timeoutMs?: number,
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    const url = new URL(this.config.apiBaseUrl + path);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      timeoutMs ?? this.config.requestTimeoutMs,
    );

    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": "extrovert-mcp/0.1.0",
    };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (extraHeaders) {
      for (const [k, v] of Object.entries(extraHeaders)) {
        if (v) headers[k] = v;
      }
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new ExtrovertApiError(
        `Request to ${method} ${path} failed: ${reason}`,
        0,
        "network_error",
      );
    } finally {
      clearTimeout(timer);
    }

    const raw = await res.text();
    const parsed = raw ? safeJsonParse(raw) : undefined;

    if (!res.ok) {
      throw errorFromBody(res.status, res.statusText, parsed);
    }

    return parsed as T;
  }

  private setSessionKey(key?: string, durable = false): void {
    const trimmed = key?.trim();
    if (!trimmed) return;
    this.apiKey = trimmed;
    if (!durable) return;

    const sink = this.options.onDurableAgentKey;
    if (!sink) {
      this.durableCredentialStatus = { attempted: false, persisted: false };
      return;
    }
    try {
      const saved = sink(trimmed, this.config.apiBaseUrl);
      this.durableCredentialStatus = {
        attempted: true,
        persisted: true,
        location: saved?.location,
      };
    } catch (error) {
      this.durableCredentialStatus = {
        attempted: true,
        persisted: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Build an {@link ExtrovertApiError} from a non-2xx response body, supporting BOTH
 * error shapes the redesigned API can return:
 *  - RFC-9457 problem+json (the END STATE, served as application/problem+json):
 *    `{type, title, status, detail, code, request_id, errors[]}`. `code` is the
 *    closed machine enum clients switch on (e.g. `forbidden_scope`,
 *    `breadth_required`, `idempotency_conflict`); the message prefers `detail`,
 *    then `title`.
 *  - the legacy `{error, message}` envelope (back-compat during migration): `error`
 *    is the machine code, `message` the human detail.
 * The opaque `request_id` (when present) is appended so an agent can quote it for
 * support. `code` always reaches {@link ExtrovertApiError.code} so the MCP tool
 * error text surfaces the machine code.
 *
 * `errors[]` is carried through VERBATIM onto the error. The server puts the full
 * human remediation in `detail` precisely because this surface renders `err.message`
 * — but the machine duplicate in `errors[]` is what makes a 422 `intent_required`
 * or a 409 `stale` recoverable in ONE turn (the exact JSON to add; the current
 * revision to re-CAS against; the verbs that ARE legal). Dropping it on the floor
 * here is why the remediation never reached the model.
 */
function errorFromBody(status: number, statusText: string, parsed: unknown): ExtrovertApiError {
  const body = (parsed && typeof parsed === "object" ? parsed : undefined) as
    | {
        title?: string;
        detail?: string;
        code?: string;
        request_id?: string;
        message?: string;
        error?: string;
        errors?: unknown;
      }
    | undefined;
  // problem+json carries detail/title; the legacy envelope carries message/error.
  const message =
    body?.detail ??
    body?.message ??
    body?.title ??
    body?.error ??
    `${status} ${statusText}`;
  // The machine code: problem+json `code`, else the legacy `error` code.
  const code = body?.code ?? body?.error;
  const withReqId = body?.request_id ? `${message} (request_id: ${body.request_id})` : message;
  return new ExtrovertApiError(withReqId, status, code, parsed, problemFieldsOf(body?.errors));
}

/**
 * Narrow an untrusted `problem.errors` value to the `{field, code, detail}` hints.
 * Anything that is not an array of objects with string `field` + `code` is dropped
 * rather than rendered: a malformed hint must never turn a useful error message
 * into `[object Object]`.
 */
function problemFieldsOf(raw: unknown): ProblemField[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const fields: ProblemField[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as { field?: unknown; code?: unknown; detail?: unknown };
    if (typeof e.field !== "string" || typeof e.code !== "string") continue;
    fields.push({
      field: e.field,
      code: e.code,
      detail: typeof e.detail === "string" ? e.detail : undefined,
    });
  }
  return fields.length ? fields : undefined;
}

/**
 * Build the `Idempotency-Key` header map for a client-supplied key, or undefined
 * when none was provided. The same key name is used across Go + MCP + SDK; a
 * mismatch silently breaks server-side dedup.
 */
function idempotencyHeader(clientId?: string): Record<string, string> | undefined {
  const key = clientId?.trim();
  return key ? { "Idempotency-Key": key } : undefined;
}

/** Runtime-agnostic base64 of a byte array (no Buffer dependency). */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  if (typeof btoa === "function") return btoa(binary);
  const g = globalThis as { Buffer?: { from(s: string, enc: string): { toString(enc: string): string } } };
  if (g.Buffer) return g.Buffer.from(binary, "binary").toString("base64");
  throw new Error("No base64 encoder available in this runtime.");
}

/** Pull a filename out of a Content-Disposition header value. */
function filenameFromDisposition(disposition: string): string {
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  return m ? decodeURIComponent(m[1]!.trim()) : "";
}

export { NotFoundError };
