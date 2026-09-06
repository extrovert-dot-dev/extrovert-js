import { normalizeInboxPage } from "./inbox-page.js";

/**
 * Extrovert API resource types.
 *
 * These mirror the Extrovert REST contract (`/v1`: enroll, inboxes, messages,
 * threads, wait). They are the wire shapes the typed client returns. The offline
 * fixture store produces the same shapes for tests and demos.
 */

/** Onboarding mode for the domain where an inbox is created (spec §7). */
export type OnboardingMode = "shared" | "purchased" | "ns_delegated" | "manual";

/**
 * The ceiling tier an agent key encodes in its raw prefix (redesign §3.1):
 *  - `org`    : `pk_agent_org_…`   (reaches its org subtree; bare list = breadth_required)
 *  - `project`: `pk_agent_proj_…`  (DEFAULT; project is implicit)
 *  - `inbox`  : `pk_agent_inbox_…` (pinned to one inbox)
 * A legacy bare `pk_agent_…` key (no tier segment) maps to `project`.
 */
export type KeyTier = "org" | "project" | "inbox";

/** Capability strings carried by scoped agent keys. */
export type AgentScope =
  | "mailbox:create"
  | "mailbox:read"
  | "mailbox:send"
  | "mailbox:quota"
  | "mailbox:credentials"
  | "mailbox:delete"
  | "webhook:write"
  | "domain:manage"
  | "domain:read"
  | "commerce:request"
  /** Legacy keys may still report this scope; it does not approve or execute purchases. */
  | "domain:purchase"
  | "review:act"
  | "signup:verify";

/**
 * Derive the key tier from the raw agent-key prefix (redesign §3.1, Appendix A).
 * The tier is encoded in the prefix segment after `pk_agent_`; a legacy bare
 * `pk_agent_` key (or a non-agent / empty key) is treated as `project`: exactly
 * today's behavior. The MCP never parses the secret tail.
 */
export function keyTierFromRawKey(rawKey: string | undefined): KeyTier {
  const key = (rawKey ?? "").trim();
  if (key.startsWith("pk_agent_org_")) return "org";
  if (key.startsWith("pk_agent_inbox_")) return "inbox";
  // pk_agent_proj_… and legacy bare pk_agent_… both resolve to the project tier.
  return "project";
}

/** Lifecycle status of an inbox. */
export type InboxStatus = "provisioning" | "live" | "disabled" | "deleting" | "deleted" | "degraded" | "unknown";

/**
 * Arbitrary key-value metadata an agent attaches to an inbox (AgentMail parity).
 * Values are string, number, or boolean. On a read this is always an object
 * (`{}` when none is set, never null). On a create/update request a top-level
 * `null` clears all metadata and a key whose value is `null` deletes that key
 * (see {@link CreateInboxInput}/{@link UpdateInboxInput}).
 */
export type InboxMetadata = Record<string, string | number | boolean>;

/** A real, persistent inbox owned by an agent. */
export interface Inbox {
  /**
   * The resource object type: always `"inbox"` (RFC D9; every redesign resource
   * carries `object`). Optional on the wire for older servers.
   */
  object?: "inbox";
  /**
   * The canonical OPAQUE inbox id and path key (`/v1/inboxes/{inbox_id}`), live
   * value `pmbx_…`. Treat it as an opaque string: do NOT parse the prefix.
   */
  id: string;
  /**
   * The fixed org the inbox belongs to (RFC D9). Resolved from the key's scope;
   * never a selector.
   */
  org_id?: string;
  /**
   * The fixed project the inbox belongs to (RFC D9). An agent key can only read or
   * mutate inboxes in its bound project; `project_id` on a request is an ASSERTION,
   * never a selector.
   */
  project_id?: string;
  /**
   * Full address, e.g. `agent7@extrovertmail.com`. The within-project email alias :
   * also accepted as a `{inbox_id}` path segment, but `id` is canonical.
   */
  address: string;
  /** Display name attached to outbound mail, if any. */
  display_name?: string;
  /** The domain the address lives on. */
  domain: string;
  /** How the underlying domain was onboarded. */
  onboarding_mode: OnboardingMode;
  status: InboxStatus;
  /** Agent that owns this inbox. */
  agent_id: string;
  /** Effective enforced rolling-24-hour recipient cap for this inbox. */
  daily_send_limit: number;
  /**
   * Whether raw protocol SMTP is currently allowed. It defaults to false, is
   * controlled by a human per inbox, and is effective only while the inbox has a
   * paid entitlement. Exported credentials do not imply SMTP access. API, SDK,
   * and MCP sends remain governed by the Review Loop regardless of this value.
   */
  direct_smtp_enabled: boolean;
  /** ISO-8601 creation timestamp. */
  created_at: string;
  /** Whether outbound sender registration has completed: never skipped. */
  sender_verified?: boolean;
  /**
   * Optional HMAC-signed inbound webhook target, as returned by the API.
   * The read shape uses the contract's `webhook_url` (Inbox schema); the agent-
   * facing WRITE inputs name it `inbound_webhook_url` and the client remaps that
   * to `webhook_url` on create/update.
   */
  webhook_url?: string;
  /**
   * Arbitrary key-value metadata stored on the inbox (AgentMail parity). Always
   * an object on a read (`{}` when none is set, never null); project-scoped.
   */
  metadata: InboxMetadata;
  /**
   * The RESOLVED review policy governing every outbound send from THIS inbox: the
   * per-inbox override, else the account default, else the `require_review` floor.
   *
   * Read it once, before the first send, and plan accordingly: under
   * `require_review` (the default for every account that has not opted out) a send
   * with no `intent` is refused with 422 `intent_required` and NOTHING is queued.
   * Present only on the single-inbox read (`get_inbox`); the list path omits it
   * because the value is identical for every inbox in the org.
   */
  effective_review_policy?: ReviewPolicy;
}

/**
 * An account/inbox review policy (the server's closed set).
 *
 *  - `require_review`      every outbound send is queued for a human. THE DEFAULT
 *                          and the floor: a policy the server cannot read resolves
 *                          here, and a per-inbox override can only tighten toward it.
 *  - `auto_send_graduated` a send in a graduated category may auto-send; everything
 *                          else is queued.
 *  - `allow_direct`        the account has explicitly opted into unsupervised sends.
 */
export type ReviewPolicy = "require_review" | "auto_send_graduated" | "allow_direct";

/** A participant address on a message. */
export interface Address {
  name?: string;
  email: string;
}

/**
 * Attachment metadata (bytes fetched separately by id). Mirrors the canonical Go
 * wire shape (`attachmentResponse`): `id` is the opaque attachment id addressing
 * one MIME part; `size` is the decoded byte length.
 */
export interface Attachment {
  id: string;
  filename: string;
  content_type: string;
  size: number;
}

/**
 * An outbound attachment on send / reply. `content_base64` is the standard
 * base64 of the file bytes. Mirrors the Go `attachmentRequest`.
 */
export interface AttachmentInput {
  filename: string;
  content_type: string;
  content_base64: string;
}

/** One attachment's bytes (base64) plus the metadata to save/serve it. */
export interface AttachmentDownload {
  filename: string;
  content_type: string;
  content_base64: string;
}

/** Direction of a message relative to the owning inbox. */
export type MessageDirection = "inbound" | "outbound";

/**
 * A single email message. This mirrors the canonical Go wire shape
 * (`messageResponse`): `id` is the opaque, inbox-resolvable id; `inbox` is the
 * owning address; `seen` is the native IMAP \Seen read state (no Gmail-style
 * labels); `folder` is the IMAP mailbox the message lives in.
 */
export interface Message extends SubmissionTracking {
  id: string;
  thread_id: string;
  /** Owning inbox address (e.g. agent7@extrovertmail.com). */
  inbox: string;
  direction: MessageDirection;
  from: Address;
  to: Address[];
  cc?: Address[];
  /** Reply-To addresses parsed from the source message. */
  reply_to?: Address[];
  subject: string;
  /** Decoded text/plain MIME alternative; never derived from HTML. */
  text: string | null;
  /** Decoded text/html MIME alternative; never synthesized from text. */
  html?: string | null;
  /** Best-effort derivative of text; never replaces the source field. */
  extracted_text?: string | null;
  /** Best-effort derivative of html; never replaces the source field. */
  extracted_html?: string | null;
  /** ISO-8601 received/sent timestamp (raw Date header). */
  date: string;
  /** RFC 5322 Message-ID. */
  message_id: string;
  /** Source RFC 5322 parent Message-ID, when present. */
  in_reply_to?: string;
  /** Source RFC 5322 References chain, when present. */
  references?: string;
  /** Whether the message has been read (native IMAP \Seen flag). */
  seen: boolean;
  /** IMAP folder the message lives in (e.g. INBOX, Junk). */
  folder?: string;
}

/**
 * A conversation thread, grouped server-side by RFC 5322 References / In-Reply-To
 * chaining (subject fallback). Mirrors the canonical Go `threadResponse`: `id` is
 * stable across calls; `participants` are bare/display address strings; `snippet`
 * is a preview of the latest message.
 */
export interface Thread {
  id: string;
  /** Owning inbox address. */
  inbox_id: string;
  subject: string;
  /** Number of messages in the thread. */
  message_count: number;
  /** List/search summaries use the latest envelope; thread detail may include the full conversation set. */
  participants: string[];
  /** ISO-8601 timestamp of the most recent message. */
  last_message_at: string;
  /** Snippet of the latest message body. */
  snippet: string;
  /** Whether the latest message is unread. */
  unread?: boolean;
  /** Whether the newest message has attachments. */
  last_message_has_attachments?: boolean;
  /** Opaque id of the newest message, used for optimistic reply freshness checks. */
  last_message_id?: string;
}

/** A thread plus its messages (oldest-first): `GET /v1/inboxes/{inbox_id}/threads/{id}`. */
export interface ThreadDetail extends Thread {
  messages: Message[];
}

/**
 * Canonical reply/forward result: `{message_id, thread_id}`, plus the ADDITIVE
 * `review_id` handle.
 *
 * Every agent-plane send now passes through a review row even on the direct path,
 * so `review_id` names the row that governed this delivery. It is what an agent
 * that crashed between the request and the response uses to ask what became of the
 * message (`get_review` → `closed`); without it the direct path hands back no
 * handle at all. Absent only when talking to a server that predates it.
 */
export type SentCopyStatus = "pending" | "stored" | "unavailable";
export type SubmissionRecipientState = "queued" | "waiting_for_parent" | "transmitting" | "accepted" | "failed" | "dependency_failed" | "unknown";
export type TransportCounts = Partial<Record<SubmissionRecipientState, number>>;
export interface SubmissionTracking {
  submission_id?: string;
  sent_message_id?: string | null;
  sent_copy_status?: SentCopyStatus;
  transport?: TransportCounts;
}
export interface Submission {
  submission_id: string;
  inbox: string;
  sent_message_id: string | null;
  sent_copy_status: SentCopyStatus;
  transport: TransportCounts;
  recipients: { recipient: string; state: SubmissionRecipientState }[];
  created_at: string;
  updated_at: string;
}

export interface SendResult extends SubmissionTracking {
  message_id: string;
  thread_id: string;
  review_id?: string;
}

/**
 * The legacy direct-send body for `POST /v1/inboxes/{id}/send`:
 * `{status:"sent", message_id, review_id}` (HTTP 202).
 *
 * This is what a bare send returns ONLY when the account's policy permits a direct
 * send. It is NOT the default outcome: under `require_review` a bare send with an
 * intent answers {@link QueuedForReviewResult} instead, and one without an intent
 * is refused with 422 `intent_required`.
 */
export interface DirectSendResult extends SubmissionTracking {
  status: "sent";
  message_id: string;
  review_id?: string;
}

/**
 * The outcome of a bare (not review-overloaded) send: delivered on the policy's
 * direct path, or parked in the human queue. Narrow on `"kind" in result`: the
 * queued arm is the discriminated §5.1 envelope, the sent arm is the legacy body.
 */
export type SendEmailResult = DirectSendResult | QueuedForReviewResult;

/**
 * The outcome of a bare reply or forward: `{message_id, thread_id, review_id}` on
 * the direct path, or parked in the human queue. Narrow on `"kind" in result`.
 */
export type ReplyEmailResult = SendResult | QueuedForReviewResult;

// ---------------------------------------------------------------------------
// Review Loop (HITL): agent-plane reads + submit overload (spec §5.1–5.2).
// ---------------------------------------------------------------------------

/** Per-send agent assertion (D3/D6). The resolved policy may downgrade `direct`. */
export type ReviewMode = "review" | "direct";

/** Review-request state machine (spec §3.1). */
export type ReviewState =
  | "needs_review"
  | "in_review"
  | "chatting"
  | "stale"
  | "approved"
  | "sent"
  | "auto_sent"
  | "rejected"
  | "stalled"
  | "cancelled"
  | "failed";

/** The agent's "for the human reviewer" intent (spec §11). */
export interface ReviewIntent {
  summary: string;
  meta?: {
    goal?: string;
    recipient?: string;
    prior_touches?: number;
    urgency?: string;
  };
}

/** A review request (rr_…): the pre-send record under the Review Loop. */
export interface Review {
  id: string;
  state: ReviewState;
  mode: ReviewMode;
  effective_mode: ReviewMode;
  kind: "send" | "reply" | "forward";
  from_address: string;
  agent_id: string;
  category_id?: string;
  intent_summary: string;
  intent_meta?: Record<string, unknown>;
  revision: number;
  version: number;
  proposed_subject: string;
  proposed_body_text: string;
  proposed_body_html?: string;
  proposed_to: string[];
  proposed_cc?: string[];
  proposed_bcc?: string[];
  sent_subject?: string;
  sent_body_text?: string;
  diff_unified?: string;
  sent_message_id?: string;
  gate_outcome?: string;
  stale_reason?: string;
  decision_feedback?: string;
  /**
   * The DEFINITIVE per-review "am I done?" answer: the poll-side companion to the
   * terminal nudges (`sent` / `send_failed` / `cancelled`). True for `sent`,
   * `auto_sent`, `cancelled` AND `failed`.
   *
   * `failed` is included deliberately even though it is not formally terminal: the
   * console cannot re-approve it and the only edge out is the composer's own
   * cancel, so an agent told `closed:false` for a failed review would wait forever
   * on a row nobody is going to move. Absent on a server that predates the field.
   */
  closed?: boolean;
  /**
   * The vendor-scrubbed delivery failure, present on a `failed` review. Until this
   * field an agent could learn THAT its message failed and never WHY.
   */
  send_error?: string;
  /**
   * How the message got out: `human_reviewed` | `reviewer_approved` |
   * `graduated_auto` | `agent_direct`: without fetching the turns.
   */
  send_path?: string;
  created_at: string;
  updated_at: string;
  decided_at?: string;
  sent_at?: string;
}

/** One immutable turn in a review's append-only thread (turn_…). */
export interface ReviewTurn {
  id: string;
  seq: number;
  turn_type: string;
  actor_kind: "agent" | "human" | "review_agent" | "system" | "connection";
  actor_id?: string;
  body?: string;
  revision?: number;
  diff_json?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  created_at: string;
}

/** One human/agent comment in the assembled review feedback (spec §11). */
export interface ReviewFeedbackComment {
  turn_id: string;
  actor_kind: "agent" | "human" | "review_agent" | "system" | "connection";
  actor_id?: string;
  body: string;
  created_at: string;
}

/**
 * The human's assembled feedback for a review (spec §11) returned by
 * get_review_feedback: the unified + structured diff of the human edit, the human
 * comments / rejection feedback, the decision, and the rules born from this review
 * (rule_ ids whose source_review_id is this review). $0 LLM: pure assembly.
 */
export interface ReviewFeedback {
  review_id: string;
  decision: string;
  diff_unified?: string;
  diff_json?: Record<string, unknown>;
  comments: ReviewFeedbackComment[];
  new_rules: string[];
}

/**
 * The REVIEWER's read-only decision surface for a review (BYO review-agent plane;
 * D5/§9) returned by get_review_decision_context: the intent + current draft + the
 * append-only thread + the two-circuit-breaker budget. `force_to_human` is true when
 * EITHER breaker has tripped: the reviewer's next reject would be FORCED to the human
 * regardless of intent (the human is the only terminal authority, D17).
 */
export interface ReviewDecisionContext {
  review: Review;
  turns: ReviewTurn[];
  /** Circuit breaker (a): reviewer hand-backs so far. */
  hop_count: number;
  /** Circuit breaker (a): the ceiling; at hop_count ≥ max_hops the next action is forced to the human. */
  max_hops: number;
  /** Circuit breaker (b): the hard per-review wall-clock deadline (created_at + review_deadline_s). */
  review_deadline: string;
  /** Breaker (b) tripped. */
  deadline_passed: boolean;
  /** Breaker (a) tripped. */
  hops_exhausted: boolean;
  /** Either breaker tripped: a reject is overridden to a human escalation. */
  force_to_human: boolean;
  /** The tripped breaker (max_hops_reached | review_deadline_passed). */
  force_reason?: string;
}

/** The reviewer's decision verb (BYO review-agent plane; §9). */
export type ReviewerAction = "approve" | "edit" | "reject" | "escalate";

/**
 * The outcome of a reviewer decision (reviewer_decide; D5/§9). `kind=sent` when the
 * platform sent with the COMPOSER's creds (approve/edit: the reviewer NEVER holds
 * mailbox:send); `kind=sent_to_human` when the draft returned to the human queue
 * (reject/escalate, or a reject FORCED to the human by a circuit breaker, with
 * `forced_by_breaker` naming it).
 */
export interface ReviewerDecisionResult extends SubmissionTracking {
  kind: "sent" | "sent_to_human";
  review: Review;
  sent: boolean;
  message_id?: string;
  thread_id?: string;
  sent_to_human: boolean;
  forced_by_breaker?: string;
}

/**
 * The reason a durable review nudge was enqueued (spec §4.5). The agent branches
 * on it to decide what to do (redraft, learn, re-check a category, stop).
 *
 * EMITTED today: a drain loop must handle all of these:
 *  - `redraft_requested`      a reviewer rejected/escalated, or a sweep handed the
 *                             draft back: redraft with `submit_revision`.
 *  - `feedback_added`         a HUMAN commented (an agent's own question emits
 *                             none): answer it, or redraft.
 *  - `rejected`               learn from the rejection, then redraft or stop.
 *  - `rule_changed`           re-read `get_rules`, then redraft or `restamp_review`.
 *  - `recheck_category`       re-check the draft's category assignment.
 *  - `propagate_general_rule` a rule was generalized to house style; re-apply it.
 *  - `sent`                   TERMINAL. The message went out (`payload.state` is
 *                             `sent` or `auto_sent`, `payload.message_id` names it).
 *                             Ack and stop polling this review.
 *  - `send_failed`            TERMINAL. Delivery failed (`payload.error`). Do NOT
 *                             retry this review: compose a NEW message.
 *  - `cancelled`              TERMINAL. The review was withdrawn.
 *  - `front_run_next`         you tried to mutate an already-terminal review.
 *                             STOP RETRYING.
 *
 * RESERVED: published for forward compatibility, never emitted today:
 *  - `staleness` (no producer), `approved` (terminal success is `sent`).
 *
 * `sent` and `cancelled` close the review. `send_failed` reports the terminal
 * delivery attempt but the failed row can then be explicitly closed with
 * `cancel_review`, which emits a later `cancelled` nudge. Do not assume exactly
 * one terminal-class nudge or that `send_failed` is the last sequence number.
 * Handle unknown reasons with an ack-and-ignore default arm: the set is additive
 * across 0.x.
 */
export type ReviewEventReason =
  | "redraft_requested"
  | "feedback_added"
  | "recheck_category"
  | "staleness"
  | "approved"
  | "rejected"
  | "front_run_next"
  | "rule_changed"
  | "propagate_general_rule"
  | "sent"
  | "send_failed"
  | "cancelled";

/**
 * Nudge reasons that end the current unit of work. `send_failed` stops delivery
 * retry for that review, but may be followed by `cancelled` after explicit
 * close-out.
 */
export const TERMINAL_REVIEW_EVENT_REASONS = ["sent", "send_failed", "cancelled"] as const;

/** True when the agent must stop the current delivery/review action. */
export function isTerminalReviewEvent(reason: ReviewEventReason): boolean {
  return (TERMINAL_REVIEW_EVENT_REASONS as readonly string[]).includes(reason);
}

/**
 * One durable review nudge (ndg_…) drained from the AUTHORITATIVE liveness queue
 * (spec §11). `seq` is the per-review monotonic ordinal the ack cursor advances
 * against (0 for a broadcast nudge). Opaque typed ids only (D10).
 */
export interface ReviewEvent {
  seq: number;
  id: string;
  reason: ReviewEventReason;
  review_id?: string;
  category_id?: string;
  payload?: Record<string, unknown>;
  created_at: string;
}

/** The agent's per-(agent, review) ack frontier: its strict-FIFO position. */
export interface ReviewEventCursor {
  review_id: string;
  last_acked_seq: number;
}

/**
 * A category (cat_…) in the Review Loop registry (D9/D10). `name` + `description`
 * are skill-style metadata the agent fuzzy-matches against; nothing keys on the
 * name (renames never break a reference). Categories are CUSTOMER-scoped and
 * agent-attributed: the deliberate cross-agent-404 exception. Opaque ids only.
 */
export interface Category {
  /** Logical accepted messages in this authorized project, counted by creation time. */
  message_count_7d?: number;
  message_count_30d?: number;
  message_count_90d?: number;
  last_used_at?: string;
  pending_review_count?: number;

  id: string;
  name: string;
  description: string;
  scope: "org_shared" | "agent_private";
  state: "supervised" | "auto_notify" | "auto_silent";
  /** Survivor id when this category was merged / soft-deleted (cat_…). */
  merged_into?: string;
  created_by_agent_id?: string;
  author_kind: "agent" | "human" | "connection";
  rule_high_water: number;
  rules_version: number;
  created_at: string;
  updated_at: string;
}

/**
 * The account-wide default risk dial (Review Loop, D4/D12): the values a per-
 * category null override inherits. The single user-configurable brand-risk lever.
 */
export interface AccountRiskDial {
  min_confidence: number;
  first_contact_gate: boolean;
  drift_demote_after: number;
  canary_rate: number;
  graduate_min_approvals: number;
  graduate_min_age_hours: number;
  auto_send_cap_per_day: number;
}

/** The RESOLVED risk dial for a category: account default with per-category override applied (D12). */
export interface EffectiveRiskDial {
  min_confidence: number;
  first_contact_gate: boolean;
  drift_demote_after: number;
  canary_rate: number;
  graduate_min_approvals: number;
  graduate_min_age_hours: number;
  auto_send_cap_per_day: number;
}

/**
 * One category's risk-dial OVERRIDE columns (null = inherit the account default;
 * D12) alongside the resolved effective dial.
 */
export interface CategoryRiskDial {
  category_id: string;
  min_confidence: number | null;
  first_contact_gate: boolean | null;
  drift_demote_after: number | null;
  canary_rate: number | null;
  graduate_min_approvals: number | null;
  graduate_min_age_hours: number | null;
  effective: EffectiveRiskDial;
}

/**
 * The effective risk dial (Review Loop, agent plane; D4/D12): the account default
 * plus every category's overrides. Read-only: agents read but never flip it (D16).
 */
export interface RiskDial {
  account: AccountRiskDial;
  categories: CategoryRiskDial[];
}

/**
 * The graduation gate status toward the NEXT rung (Review Loop, D16): clean approvals
 * (N / needed), category age, the maturity gate (auto_silent precondition), drift vs
 * K, and whether a human graduate would succeed right now. Read-only.
 */
export interface GraduationStatus {
  category_id: string;
  state: "supervised" | "auto_notify" | "auto_silent";
  next_state: string;
  never_graduate: boolean;
  clean_approval_count: number;
  graduate_min_approvals: number;
  approvals_met: boolean;
  age_hours: number;
  graduate_min_age_hours: number;
  age_met: boolean;
  maturity_gate_met: boolean;
  drift_count: number;
  drift_demote_after: number;
  can_graduate: boolean;
}

/**
 * The D19/§8 backlog-reconciliation snapshot for a category (agent-readable, $0-LLM):
 * how many QUEUED drafts are stale vs current-enough against the current rules-version.
 * Read-only: agents READ the picture; the human / hooks TRIGGER the actual sweep.
 */
export interface ScanBacklogStatus {
  category_id: string;
  state: "supervised" | "auto_notify" | "auto_silent" | "probation";
  queued: number;
  current_enough: number;
  stale: number;
  current_category_rules_version: number;
  current_house_style_version: number;
  staleness_tolerance: number;
}

/** One queued draft's pacing classification relative to the cursor + window (§8). */
export interface PacingItem {
  review_id: string;
  state: "behind_cursor" | "in_window_fresh" | "in_window_redrafting" | "ahead";
}

/**
 * The demand-driven pacing snapshot for a category (agent-readable, $0-LLM: M7 Slice
 * B/§8): the human review cursor, the effective window/ceiling/interval, the queued
 * count, and each queued draft's in-window/redrafting/behind-cursor classification.
 * Read-only; the cursor advances from the human's console approve/reject/edit actions.
 */
export interface CategoryPacingState {
  category_id: string;
  cursor_review_id?: string;
  cursor_advanced_count: number;
  lookahead_window: number;
  rework_batch_max: number;
  nudge_min_interval_ms: number;
  queued: number;
  in_window: number;
  redrafting: number;
  items: PacingItem[];
}

/** Drain result for list/wait: un-acked events in FIFO seq order + cursors. */
export interface ReviewEventsResult {
  pending_reviews?: number;
  events: ReviewEvent[];
  cursors?: ReviewEventCursor[];
}

/**
 * A learned writing rule (rule_…) in the Review Loop (D2/D11). House-style/general
 * (scope='general', applies across all categories) or category-scoped. Append-only
 * by supersession: an edit is a new rev (same lineage_id) with the prior flipped to
 * superseded. Read by the agent at compose/redraft time via the ORDERED get_rules
 * ladder; we never apply it (NO LLM on our side). Opaque ids only (D10).
 */
export interface Rule {
  id: string;
  /**
   * Ownership layer (org/project model). `org` = house-style inherited by every
   * project in the org; `project` = layered on top (the agent-plane default).
   * Hard house rules take precedence; softer rules allow narrower refinements.
   * Ordinary agent saves are project-scoped; authenticated reviewer learning can
   * create org house rules through learn_review_rule.
   */
  rule_layer?: "org" | "project";
  /** The org this rule belongs to. */
  org_id?: string;
  /** The project this rule belongs to; empty for an org-layer rule. */
  project_id?: string;
  lineage_id: string;
  rev: number;
  scope: "general" | "category";
  /** Set iff scope=category (cat_…). */
  category_id?: string;
  /** Set for a per-agent override; empty = all org agents. */
  scope_agent_id?: string;
  rule_text: string;
  kind: "soft" | "hard";
  priority: number;
  status: "proposed" | "active" | "superseded" | "retired";
  supersedes_id?: string;
  source_review_id?: string;
  source_turn_id?: string;
  author_kind: "agent" | "human" | "connection";
  created_at: string;
  updated_at: string;
}

/** Stable effective rule stack plus an opaque proof for the next composition. */
export interface RuleSnapshot extends Page<Rule> {
  house_style_version: number;
  category_rules_version: number;
  rule_high_water: number;
  composition_token?: string;
  composition_token_expires_at?: string;
}

/** One append-only rule/category change & undo audit row (udo_…). */
export interface RuleAuditEntry {
  id: string;
  entity_kind: "rule" | "category";
  entity_id: string;
  action: "create" | "supersede" | "retire" | "rename" | "redescribe" | "merge" | "restore";
  actor_kind: "agent" | "human" | "system" | "connection";
  actor_id?: string;
  before_json?: string;
  after_json?: string;
  undone: boolean;
  created_at: string;
}

/** A Review Loop submit that was parked for human review (202). */
export interface QueuedForReviewResult {
  kind: "queued_for_review";
  review: { id: string; state: ReviewState; effective_mode?: ReviewMode };
}

/**
 * A Review Loop submit that was sent immediately (200): the policy permitted a
 * direct or graduated auto-send.
 *
 * `review` is the handle for the row that governed the send. It is present even
 * here, on the path that never queued, so an agent that crashed between the
 * request and the response can still ask what became of the message.
 */
export interface SentResult extends SubmissionTracking {
  kind: "sent";
  message: { id: string; thread_id?: string } & SubmissionTracking;
  review?: { id: string; state?: ReviewState };
}

/** The discriminated outcome of a review-mode submit (queued OR sent). */
export type SubmitForReviewResult = QueuedForReviewResult | SentResult;

/**
 * Outcome of a message or thread delete (DELETE .../messages/{id} or
 * .../threads/{id}). `expunged` is true when removed permanently, false when
 * moved to Trash. `count` is the number of messages affected.
 */
export interface DeleteResult {
  id: string;
  deleted: true;
  expunged: boolean;
  count: number;
}

/**
 * Per-id outcome of a batch message update (PATCH .../messages/batch):
 * `updated` ids succeeded; `failed` ids were skipped (not found / not owned).
 */
export interface BatchUpdateResult {
  updated: string[];
  failed: string[];
}

/** Result of redeeming an enrollment token for a scoped agent key (spec §5). */
export interface EnrollmentResult {
  /** The created agent identity. */
  agent_id: string;
  /** The scoped agent key: shown once. Format `pk_agent_<id>_<secret>`. */
  agent_key: string;
  /** Capability scopes granted to this key. */
  scopes: AgentScope[];
  /**
   * The FIXED org the issued key is bound to (the token's resolved org). The
   * agent cannot change it.
   */
  org_id?: string;
  /**
   * The FIXED project the issued key is bound to (the token's resolved project).
   * The agent cannot change it: there is no mutable project selector.
   */
  project_id?: string;
}

/**
 * Structured result of a `wait_for_email` call. Returns the matched message
 * plus the extracted OTP code / verification link when present (spec §6).
 */
export interface WaitForEmailResult {
  /** True if a message matched before the timeout elapsed. */
  matched: boolean;
  /** The matched message, when `matched` is true. */
  message?: Message;
  /** Extracted one-time code (digits/alnum), when found. */
  otp_code?: string;
  /** Extracted verification/click-through link, when found. */
  verification_link?: string;
  /** Milliseconds spent waiting. */
  waited_ms: number;
}

/** Result of a self-signup (Slice E). The key is LIMITED until verified. */
export interface InboxActivation {
  agent_id: string;
  address: string;
  human_email: string;
  created_ms: number;
  expires_ms: number;
  revision: number;
  state: "pending" | "proven" | "activated" | "expired";
}

export interface SignUpResult {
  activation_method?: "incoming_email";
  human_email?: string;
  activation_expires_at?: string;
  customer_id: string;
  agent_id: string;
  /** Limited-scope agent key, shown once. */
  agent_key: string;
  key_prefix: string;
  scopes: AgentScope[];
  /** The first inbox created for the agent. */
  address: string;
  verified: boolean;
  /** Where the verification code was sent. */
  otp_sent_to?: string;
  otp_expires_at?: string;
  message: string;
}

/** One copy-ready MCP operation in the post-verification mailbox handoff. */
export interface MailboxQuickstartCall {
  tool: "read_messages" | "get_message" | "wait_for_email";
  arguments: Record<string, unknown>;
}

/** Safe first mailbox operations returned by signup verification. */
export interface MailboxQuickstart {
  inbox: string;
  list_mail: MailboxQuickstartCall;
  read_message: MailboxQuickstartCall;
  wait_for_mail: MailboxQuickstartCall;
}

/** Result of confirming a signup OTP: a new full-scope key and ready inbox. */
export interface VerifyResult {
  agent_id: string;
  agent_key: string;
  key_prefix: string;
  scopes: AgentScope[];
  /** The signup inbox, repeated so the verified handoff is self-contained. */
  address: string;
  verified: boolean;
  message: string;
  mailbox_quickstart: MailboxQuickstart;
  /** One-time email-bound owner claim for the human console, when freshly seeded. */
  org_claim_token?: string;
}

/**
 * The verified principal behind an agent key (GET /v1/auth/me). `org_id` /
 * `project_id` are the FIXED org/project the key is bound to (resolved from the
 * stored key, never client input). There is NO mutable project selector for a
 * scoped key: whoami is the canonical project-visibility surface; project
 * selection happens when the human/admin issues the enrollment token or agent key.
 */
/** An immutable consent grant; token refresh never changes its expiry. */
export interface ConnectionGrant {
  id: string;
  authorizer_id: string;
  client_id: string;
  name: string;
  identity: "personal_assistant" | "dedicated_agent";
  agent_id?: string;
  agent_org_id?: string;
  reach: "inboxes" | "project" | "organization" | "full_account";
  org_id?: string;
  project_id?: string;
  inbox_ids: string[];
  scopes: string[];
  created_by_connection_id?: string;
  consent_version: string;
  created_at_ms: number;
  /** Zero explicitly means until revoked. */
  expires_at_ms: number;
  revoked_at_ms: number;
  last_used_at_ms: number;
}

export interface WhoAmI {
  connection?: ConnectionGrant;
  auth_method?: "oauth" | "agent_key" | "connection";
  key_tier?: "org" | "project" | "inbox";
  inbox_scope?: "agent_owned" | "organization_subtree" | "single_inbox" | ConnectionGrant["reach"];
  inbox_id?: string;
  connection_status?: "connected";
  summary?: string;
  agent_name?: string;
  organization_name?: string;
  project_name?: string;
  /** Granted permissions, not a guarantee of plan capacity or review approval. */
  capabilities?: { read_domain_status: boolean; connect_owned_domains: boolean; create_inboxes: boolean; read_inboxes: boolean; submit_mail_for_review: boolean; request_purchases: boolean; administer_account?: boolean; approve_requests?: boolean; create_credentials?: boolean };
  customer_id: string;
  /** The fixed org the key is bound to. */
  org_id?: string;
  /** The fixed project the key is bound to. */
  project_id?: string;
  agent_id: string;
  key_id: string;
  scopes: Array<AgentScope | "account:admin">;
}

/** Webhook event types Extrovert emits. */
/**
 * A webhook event type the server accepts. `unsubscribe.received` fires when a
 * recipient opts out (one-click List-Unsubscribe or a STOP reply): the signal an
 * agent needs to drop them from its own lists BEFORE the next send is refused
 * with `recipient_suppressed`.
 */
export type WebhookEvent = "message.received" | "unsubscribe.received";

/**
 * A registered inbound webhook (mirrors the Go `webhookResponse`). `secret` is
 * present only on the registration response (returned once); list/get reads omit
 * it. `inbox` is null when the webhook covers every inbox the agent owns.
 */
export interface Webhook {
  resource_scope?: "agent" | "inboxes" | "project" | "organization";
  inbox_ids?: string[];
  created_by_connection_id?: string;
  id: string;
  url: string;
  events: WebhookEvent[];
  inbox: string | null;
  /** Agent identity recorded when this webhook was created. */
  agent_id?: string;
  /** HMAC signing secret: returned ONCE at registration, omitted on reads. */
  secret?: string;
  /** Display prefix of the secret, safe to store/show. */
  secret_prefix: string;
  active: boolean;
  created_at: string;
}

/** Whether a contact-list entry permits (allow) or rejects (block) a match. */
export type ContactListKind = "allow" | "block";

/** Traffic direction a contact-list entry governs. Only `send` is enforced today. */
export type ContactListDirection = "send" | "receive";

/**
 * A contact allow/block-list entry (mirrors the Go `contactListEntryResponse`).
 * `inbox` is null when the entry is account-wide (covers every inbox the agent
 * owns). `pattern` is a bare email address or a bare domain.
 */
export interface ContactListEntry {
  id: string;
  inbox: string | null;
  kind: ContactListKind;
  direction: ContactListDirection;
  pattern: string;
  created_at: string;
}

/**
 * A page of results from a list endpoint, in the MCP's normalized internal shape.
 *
 * The canonical agent surface returns two wire shapes that the client normalizes
 * INTO this one before handing it to the tools:
 *  - the §5.2 ONE envelope `{object:"list", data, has_more, next_cursor}` (the
 *    project-prefixed inbox list `/v1/projects/{id}/inboxes`), and
 *  - the legacy `{items, total, next_cursor}` page (messages/threads/attachments,
 *    webhooks, domains, contact-lists, reviews, rules: these KEEP `items`).
 * Either way the tools read `.items` / `.next_cursor`.
 */
export interface Page<T> {
  items: T[];
  /** Opaque cursor for the next page, when more results exist. Pass back as `?cursor`. */
  next_cursor?: string;
  has_more?: boolean;
  /** Total count when cheaply known. */
  total?: number;
}

/**
 * The ONE canonical list envelope (redesign §5.2) for the cursor-paginated agent
 * surface. `next_cursor` is an opaque pagination token (pass it back verbatim as
 * `?cursor`); it is null when there are no more rows. The MCP client normalizes
 * this into {@link Page} via {@link listEnvelopeToPage}.
 */
export interface List<T> {
  object: "list";
  data: T[];
  has_more: boolean;
  next_cursor: string | null;
}

/** Normalize the §5.2 `List` envelope into the MCP's internal {@link Page} shape. */
export function listEnvelopeToPage<T>(list: List<T>): Page<T> {
  return normalizeInboxPage<T>(list);
}

// ---------------------------------------------------------------------------
// Suppressions (recipient opt-outs / list-unsubscribe): customer/org-scoped
// ---------------------------------------------------------------------------

/**
 * The scope a suppression row applies at. The agent plane only ever sees `org`
 * rows (the caller's OWN org): a platform-`global` or `shared_domain` opt-out is
 * never surfaced (non-leakage). The wider values exist for forward-compatibility.
 */
export type SuppressionScope = "org" | "shared_domain" | "global";

/** How a suppression came to exist (which signal created the opt-out row). */
export type SuppressionSource =
  | "one_click"
  | "page"
  | "mailto"
  | "reply_stop"
  | "manual"
  | "complaint"
  | "escalation";

/**
 * One recipient opt-out row (mirrors the Go `suppressionResponse`). A recipient
 * with an active (non-`revoked`) row for the sender's org is blocked from receiving
 * mail; a send to them is rejected with `recipient_suppressed`. Revoke a row (with
 * a reason) to re-enable sending to that recipient.
 */
export interface SuppressionEntry {
  id: string;
  recipient: string;
  recipient_raw?: string;
  scope: SuppressionScope;
  source: SuppressionSource;
  narrow_agent_id?: string;
  narrow_mailbox?: string;
  origin_mailbox?: string;
  origin_agent_id?: string;
  origin_message_id?: string;
  reactivation_count: number;
  created_at: string;
  revoked_at?: string;
  revoked_by?: string;
  revoke_reason?: string;
  revoked: boolean;
}

/**
 * The result of a pre-check (`GET /v1/suppressions?recipient=…`): whether the
 * caller's OWN org suppresses the recipient, plus the matching org rows. Reflects
 * only the caller's org state: never a global/shared/cross-tenant opt-out.
 */
export interface SuppressionPrecheck {
  recipient: string;
  suppressed: boolean;
  rows: SuppressionEntry[];
}

// ---------------------------------------------------------------------------
// Reputation / deliverability (diverse-smtp M7): read-only, org-scoped.
// ---------------------------------------------------------------------------

/** The latest window's Sends/Bounces/Complaints rollup for the org. */
export interface ReputationMetrics {
  window_start?: string;
  window_end?: string;
  sends: number;
  bounces: number;
  complaints: number;
  bounce_rate: number;
  complaint_rate: number;
}

/** The org's deliverability rollup (`GET /v1/reputation`). Read-only. */
export interface ReputationRollup {
  object: "reputation";
  org_id: string;
  /** UI badge: healthy/at_risk/paused/enforced/unknown. */
  status: string;
  sending_status: string;
  configured: boolean;
  last_checked_at?: string;
  metrics: ReputationMetrics;
  open_findings: number;
}

/** One deliverability finding (`GET /v1/reputation/findings`). */
export interface ReputationFinding {
  id: string;
  type: string;
  severity: string;
  status: string;
  domain?: string;
  sender?: string;
  title: string;
  detail: string;
  first_seen_at: string;
  last_seen_at: string;
  resolved_at?: string;
}

/** Filters for `GET /v1/reputation/findings`. */
export interface ListDeliverabilityFindingsInput {
  status?: "open" | "resolved";
  severity?: "low" | "high" | "unknown";
  domain?: string;
  sender?: string;
  limit?: number;
  cursor?: string;
}

// ---------------------------------------------------------------------------
// Agent-facing domains (Slice 5): privileged (domain:manage scope)
// ---------------------------------------------------------------------------

/** One nameserver record the customer must publish for delegated setup. */
export interface DomainRecord {
  name: string;
  type: string;
  value: string;
  /** MX priority, when applicable. */
  priority?: number | null;
  ttl: number;
}

/**
 * The agent-facing view of one onboarded domain (mirrors the Go `domainResponse`).
 * `delegation_ns` is present on get / onboard / verify for delegated domains and
 * empty on list reads. `records` remains for legacy response compatibility.
 */
export interface DomainStatusEvent {
  id: string;
  type: string;
  domain: string;
  summary: string;
  data: { domain: string; readiness: DomainReadiness };
  created_at: string;
}
export interface DomainStatusEventPage {
  items: DomainStatusEvent[];
  next_cursor: string;
  has_more: boolean;
  poll_after_seconds: number;
}

export interface DomainReadiness {
  status: "waiting_for_dns" | "checking" | "setting_up" | "ready" | "action_required" | "needs_attention";
  label: string;
  summary: string;
  reason: string;
  action_required_by: "customer" | "extrovert" | "none";
  next_action: "check_dns_entries" | "restore_dns" | "wait" | "create_inbox" | "use_inbox" | "ask_owner_to_create_inbox";
  ready_for_inboxes: boolean;
  checked_at?: string;
  next_check_at?: string;
  poll_after_seconds: number;
  inboxes?: { scope: "agent" | "inbox" | "selected_inboxes" | "project" | "organization"; total: number; ready: number; setting_up: number; needs_attention: number };
}

export interface Domain {
  /** Server-derived outcome; old servers may omit it. Never infer it from signing or verification flags. */
  readiness?: DomainReadiness;
  /** Customer DNS health, independent of mail provisioning readiness. */
  delegation?: {
    status: "pending" | "confirmed" | "rechecking" | "check_delayed" | "action_required";
    checked_at?: string;
    confirmed_at?: string;
  };
  id: string;
  domain: string;
  mode: OnboardingMode;
  verification_status: string;
  dkim_status: string;
  shared: boolean;
  provisioning_phase?: string;
  provisioning_error?: string;
  created_at: string;
  records?: DomainRecord[];
  delegation_ns?: DomainRecord[];
  /** Human-facing copy for what the customer must do next. */
  instruction?: string;
}

/**
 * Result of an ACCEPTED domain offboard (`DELETE /v1/domains/{domain}` → 202).
 * Teardown runs as an async job; poll `status_url` (`GET /v1/jobs/{job_id}`) until
 * `status` is terminal (succeeded/failed/cancelled).
 */
export interface DomainOffboard {
  domain: string;
  job_id: string;
  status: string;
  status_url: string;
}

/**
 * Poll-loop status for one async job (currently only the domain-offboard
 * teardown's `status_url`). Mirrors `GET /v1/jobs/{job_id}`. `status` is
 * terminal on succeeded/failed/cancelled; keep polling otherwise.
 */
export interface Job {
  object: "job";
  id: string;
  type: string;
  status: string;
  created_at: string;
  updated_at: string;
  finished_at?: string;
}

// ---------------------------------------------------------------------------
// Agent-facing commerce: quote/request/status only; human approval is console-only
// ---------------------------------------------------------------------------

/** One exact reason a commerce request cannot advance automatically. */
export interface CommerceBlocker {
  code: string;
  message: string;
  scope?: "org" | "project" | "agent" | string;
  limit_id?: string;
  used_cents?: number;
  reserved_cents?: number;
  limit_cents?: number;
  requested_cents?: number;
  used_count?: number;
  reserved_count?: number;
  limit_count?: number;
  reset_at?: string;
  manage_url?: string;
}

/** A current, non-binding domain registration quote. Quoting never purchases. */
export interface DomainQuote {
  object: "domain_quote";
  domain: string;
  available: boolean;
  currency: string;
  quote_cents: number;
  renewal_cents: number;
  premium: boolean;
  quote_expires_at: string;
  required_plan?: string;
  required_plan_price_cents?: number;
  blockers: CommerceBlocker[];
}

export type CommerceRequestKind = "domain_purchase" | "plan_change";

/** Durable poll shape for an agent-initiated financial request. */
export interface CommerceRequest {
  object: "commerce_request";
  id: string;
  project_id?: string;
  agent_id?: string;
  kind: CommerceRequestKind;
  state: string;
  domain?: string;
  domain_scope?: "org" | "project";
  target_plan?: string;
  current_plan?: string;
  rationale?: string;
  currency: string;
  quote_cents: number;
  renewal_cents: number;
  approved_max_cents?: number;
  quote_expires_at?: string;
  auto_renew: boolean;
  required_plan?: string;
  required_plan_price_cents?: number;
  blocker_code?: string;
  blockers: CommerceBlocker[];
  /** Authenticated human page for reviewing or completing this request. */
  approval_url?: string;
  payment_action_url?: string;
  external_job_id?: string;
  effective_at?: string;
  notification_state?: string;
  notification_last_error?: string;
  agent_next_action: string;
  retry_safe: boolean;
  poll_after_seconds: number;
  version: number;
  created_at: string;
  updated_at: string;
}

/** One IMAP/SMTP endpoint for a mailbox. */
export interface MailboxEndpoint {
  host: string;
  port: number;
  /** "tls" = implicit TLS (IMAP 993); "starttls" = upgrade (SMTP 587). */
  security: "tls" | "starttls";
}

/** Full connection config + login for a mailbox: enough to configure any mail
 *  client (Himalaya, mbsync, Thunderbird, …). */
export interface MailboxCredentials {
  address: string;
  username: string;
  password: string;
  imap: MailboxEndpoint;
  smtp: MailboxEndpoint;
}

// ---------------------------------------------------------------------------
// RFC-9457 problem+json: the single error wire shape on the agent plane.
// ---------------------------------------------------------------------------

/**
 * One machine-readable field hint on a problem response (`problem.errors[]`).
 *
 * The shape is deliberately narrow: `{field, code, detail}` only: and is reused
 * for more than validation: a remediation carries `{field:"retry_with",
 * code:"example", detail:"<the JSON to add>"}`, and a 409 carries the recovery
 * facts (`state`, `revision`, `version`, one `allowed_action` per legal verb) so a
 * retry needs no extra round trip.
 */
export interface ProblemField {
  field: string;
  code: string;
  detail?: string;
}

/**
 * The CLOSED machine-code enum an agent switches on. Kept set-equal to the Go
 * `ProblemCode` constants and the openapi `Problem.code` enum; drift here is the
 * exact class of bug that let clients see `http_409` and no server message.
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

/** The same closed enum as a runtime array (for membership checks + tests). */
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
 * The 409 codes an agent MAY retry, and only a bounded number of times: the CAS
 * lost a race (`stale`) or the draft was built against an older rule high-water
 * (`born_stale`). Re-read, re-apply on top of the other party's change, resubmit.
 *
 * Every OTHER 409: `wrong_state`, `terminal`, `send_needs_reconciliation`,
 * `idempotency_conflict`, bare `conflict`: must NEVER be retried with the same
 * verb. That distinction is the whole point of splitting the taxonomy: a single
 * "409 → retry" handler loops forever on a review that is already sent.
 */
export const RETRYABLE_PROBLEM_CODES: readonly ProblemCode[] = ["stale", "born_stale"] as const;

/** True when this problem code is worth a bounded retry after re-reading state. */
export function isRetryableProblemCode(code: string | undefined): boolean {
  return (RETRYABLE_PROBLEM_CODES as readonly string[]).includes(code ?? "");
}


/** Learn writing guidance from an authenticated human turn on your review. */
export interface LearnReviewRuleRequest {
  client_id: string;
  source_turn_id: string;
  rule_text: string;
  target: "org_house" | "project_general" | "category";
  category_id?: string;
  kind?: "soft" | "hard";
  supersedes_id?: string;
}
export interface LearnedReviewRule {
  rule: Rule;
  source_review_id: string;
  source_turn_id: string;
  human_id: string;
  audit_id: string;
  propagation: "queued";
}

export interface ListCategoriesParams { match?: string;
  sort?: "popular" | "messages_7d" | "messages_90d" | "last_used" | "pending_reviews" | "name";
  limit?: number;
  page?: string;
}

/** Explicitly narrow a broader connection; legacy keys retain their fixed ceiling. */
export interface ConnectionResourceSelection { org_id?: string; project_id?: string }
export interface ListWebhooksParams extends ConnectionResourceSelection { limit?: number; cursor?: string }
