/**
 * Extrovert API: typed request/response models.
 *
 * These mirror the Extrovert V1 REST contract (`/v1`, §8 of the build spec). The Go API does not
 * exist yet; field shapes here are the source of truth the client codes against and are validated
 * against fixture data in `src/fixtures.ts`.
 *
 * Conventions:
 * - All identifiers (ids, addresses, domains, keys) are `string` and rendered in mono everywhere.
 * - Timestamps are RFC 3339 / ISO-8601 strings (`created_at`, `expires_at`, ...).
 * - The wire format is snake_case to match the Go/OpenAPI surface; this file documents it verbatim.
 */

import type { InboxInclude } from "./include.js";

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/** RFC 3339 / ISO-8601 timestamp, e.g. `2026-06-12T18:04:11Z`. */
export type IsoTimestamp = string;

/**
 * A capability scope. The server is the source of truth (counter + revocation); a token carries
 * its caveats but cannot exceed them (§5).
 *
 * The `mailbox:*` scope strings are the live wire contract (stored in issued keys'
 * caveats) and are NOT renamed despite the public "inbox" product naming: renaming
 * them would invalidate every key already issued. `domain:manage` gates onboarding
 * for domains the customer already controls. `commerce:request` permits quotes,
 * requests, and status reads, but never a human approval transition or direct spend.
 * `review:act` gates the BYO reviewer decision plane.
 */
export type Scope =
  | "mailbox:create"
  | "mailbox:read"
  | "mailbox:send"
  | "mailbox:quota"
  | "mailbox:credentials"
  | "mailbox:delete"
  | "webhook:write"
  | "domain:manage"
  | "domain:read"
  | "domain:purchase"
  | "commerce:request"
  | "review:act"
  | "signup:verify";

/** How a Extrovert domain was onboarded (§7). */
export type OnboardingMode = "shared" | "purchased" | "ns_delegated" | "manual";

/** Lifecycle status of an agent principal. */
export type AgentStatus = "active" | "disabled";

/** Lifecycle status of an inbox. */
export type InboxStatus = "provisioning" | "live" | "disabled" | "deleted";

/** Direction of a message relative to the inbox that owns it. */
export type MessageDirection = "inbound" | "outbound";

// ---------------------------------------------------------------------------
// Enrollment & agent identity (§5)
// ---------------------------------------------------------------------------

/**
 * Request body for `POST /v1/enroll`. An agent redeems a `pk_enroll_...` token to issue a scoped
 * agent key. Idempotent on `agent_handle` (à la AgentMail's `client_id`).
 */
export interface EnrollRequest {
  /**
   * The raw enrollment token, format `pk_enroll_<id>_<secret>`. Shown once at issue
   * time. REQUIRED: this is the wire field the server reads (`json:"token"`); the
   * request is serialized verbatim, so the field name must match the contract.
   */
  token: string;
  /**
   * Stable client-chosen handle for this agent. Redeeming twice with the same handle returns the
   * same agent rather than creating a new one.
   */
  agent_handle: string;
  /** Optional human-readable label for the created agent. */
  agent_name?: string;
  /**
   * Optional idempotency key (sent as the `Idempotency-Key` header). A retry with
   * the same key replays the original enrollment response instead of reissuing.
   */
  client_id?: string;
}

/**
 * Response from `POST /v1/enroll`. The `agent_key` is the short-lived, per-agent scoped key the
 * agent uses for all subsequent calls: never an org-wide key (§5, §14).
 */
export interface EnrollResponse {
  /** The created agent principal id, e.g. `agt_7Hq2...`. */
  agent_id: string;
  /**
   * The scoped agent key, format `pk_agent_<id>_<secret>`. Returned once. Treat as a secret and
   * pass as the `Authorization: Bearer` credential on subsequent requests.
   */
  agent_key: string;
  /** Scopes granted to this key (a subset of the enrollment token's scopes). */
  scopes: Scope[];
  /**
   * The fixed org the issued key is bound to (the token's resolved org). The agent
   * cannot change it; it is the canonical org for every subsequent call.
   */
  org_id?: string;
  /**
   * The fixed project the issued key is bound to (the token's resolved project). The
   * agent cannot change it: there is no mutable project selector for a scoped key.
   */
  project_id?: string;
}

/** A Extrovert agent principal (read shape). */
export interface Agent {
  id: string;
  name: string | null;
  status: AgentStatus;
  scopes: Scope[];
  created_at: IsoTimestamp;
  metadata: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Inboxes (§6)
// ---------------------------------------------------------------------------

/**
 * One arbitrary metadata value stored on an inbox. The wire allows string, number,
 * or boolean (nested objects and arrays are rejected). In a PATCH (update) body a
 * value of `null` for a key DELETES that key (the merge/null-delete semantics :
 * see {@link UpdateInboxRequest.metadata}); a read shape ({@link Inbox.metadata})
 * never contains `null`.
 */
export type InboxMetadataValue = string | number | boolean;

/**
 * The arbitrary key-value metadata object an agent attaches to an inbox (AgentMail
 * parity). Caps: ≤256 keys, ≤256 chars per key, ≤256 chars per string value. The
 * read shape is always an object (`{}` when empty, never null); the PATCH shape
 * additionally allows per-key `null` to delete a key.
 */
export type InboxMetadata = Record<string, InboxMetadataValue>;

/**
 * The metadata patch shape (create/update bodies): each value may be a
 * string/number/boolean to set it, or `null` to delete that key on a PATCH.
 */
export type InboxMetadataPatch = Record<string, InboxMetadataValue | null>;

/**
 * Request body for `POST /v1/inboxes`. All fields are optional. The default path
 * creates an address on the account's platform shared domain.
 */
export interface CreateInboxRequest {
  /**
   * Desired local part (before the `@`). Shared-domain names are normalized,
   * must be at least 5 characters, and cannot use reserved names. If omitted,
   * the server generates a random handle.
   * Example: `agent7` -> `agent7@extrovertmail.com` for paid accounts or
   * `agent7@free.extrovertmail.com` for free accounts.
   */
  username?: string;
  /**
   * Domain to create the inbox on. Must be an org domain the calling key is
   * scoped to. If omitted, the account's shared domain is used.
   */
  domain?: string;
  /** Human-readable display name used in the `From:` header on sends. */
  display_name?: string;
  /**
   * Idempotency handle. Re-creating with the same `client_id` returns the existing inbox rather
   * than creating a duplicate.
   */
  client_id?: string;
  /**
   * Optional inbound webhook to register at create time (HMAC-signed
   * `message.received`). This is the wire field the server reads (`json:"webhook_url"`);
   * the create body is serialized verbatim, so the name must match the contract.
   */
  webhook_url?: string;
  /**
   * Optional arbitrary key-value metadata to store on the inbox (AgentMail parity).
   * Values may be a string, number, or boolean; nested objects/arrays are rejected.
   * Caps: ≤256 keys, ≤256 chars per key, ≤256 chars per string value. Echoed back on
   * the create response (and replayed verbatim on an idempotent `client_id` retry).
   */
  metadata?: InboxMetadata;
  /**
   * Optional assertion that must match the key's bound project: NEVER a selector.
   * A mismatch is a 403. The inbox is always created in the key's stored project;
   * the assertion only lets a caller defend against a misrouted key.
   */
  project_id?: string;
  /**
   * Whether to return paid-inbox credentials (IMAP/SMTP password) in the response.
   * Requires the `mailbox:credentials` permission and defaults to false.
   */
  return_credentials?: boolean;
}

/**
 * Request body for `PATCH /v1/inboxes/{addr}`. Cheap, in-place inbox settings an
 * owning agent may change without delete+recreate. Every field is optional; an
 * omitted field leaves the stored value untouched (PATCH semantics).
 */
export interface UpdateInboxRequest {
  /**
   * New sender display / `From` name, propagated to the inbox and the authenticated sender.
   * An empty string falls back to the address local-part at the mail layers.
   */
  display_name?: string;
  /** Replace the inbox's inbound webhook target. An empty string clears it. */
  webhook_url?: string;
  /**
   * Set this inbox's effective rolling-24-hour recipient cap. Must be an integer
   * from 1 through 10,000. Updating this field requires the opt-in
   * `mailbox:quota` scope; the other mutable fields do not.
   */
  daily_send_limit?: number;
  /**
   * Patch the inbox's arbitrary metadata (AgentMail parity). Shallow merge:
   * - omitting `metadata` entirely leaves the stored metadata unchanged;
   * - an object MERGES into the existing metadata (set/overwrite the given keys);
   * - a key whose value is `null` DELETES that key;
   * - the top-level value `null` CLEARS all metadata (the response then carries `{}`).
   *
   * Values may be a string, number, or boolean; nested objects/arrays are rejected;
   * the same ≤256 key/length caps as create apply.
   */
  metadata?: InboxMetadataPatch | null;
  /**
   * Optional assertion that must match the key's bound project: NEVER a selector.
   * A mismatch is a 403.
   */
  project_id?: string;
}

/**
 * IMAP/SMTP connection config + login for a paid inbox. Export requires the
 * `mailbox:credentials` permission. On create it is present only when
 * `return_credentials` was requested. (The IMAP/SMTP host/port/password are mail
 * protocol internals. Exported credentials do not mean direct SMTP is enabled.
 * Check `direct_smtp_enabled` on the inbox before attempting an SMTP send.)
 */
export interface InboxCredentials {
  imap_host: string;
  imap_port: number;
  smtp_host: string;
  smtp_port: number;
  username: string;
  /** Plaintext mailbox password. Credential reads can return it again. Treat every response as a secret. */
  password: string;
}

/** A provisioned inbox (read shape). */
export interface Inbox {
  /**
   * Resource type discriminator. Always `"inbox"` on the redesigned surface (RFC D9:
   * every resource carries `object` + `org_id` + `project_id` + timestamps). Optional
   * for back-compat with legacy/mock shapes that omit it.
   */
  object?: "inbox";
  /**
   * The canonical OPAQUE inbox id and path key (`/v1/inboxes/{inbox_id}` /
   * `/v1/projects/{project_id}/inboxes/{inbox_id}`). Treat it as opaque: do not parse
   * the `pmbx_` prefix.
   */
  id: string;
  /**
   * The fixed org this inbox belongs to (RFC D9). Optional for legacy/mock shapes.
   */
  org_id?: string;
  /**
   * The project this inbox belongs to (RFC D9): the partition key. Optional for
   * legacy/mock shapes.
   */
  project_id?: string;
  /** Full address, e.g. `agent7@extrovertmail.com`. A within-project email alias for {@link Inbox.id}. */
  address: string;
  username: string;
  domain: string;
  display_name: string | null;
  status: InboxStatus;
  /** Onboarding mode of the domain this inbox lives on. */
  onboarding_mode: OnboardingMode;
  /** Agent that owns this inbox, if created by an agent key. */
  agent_id: string | null;
  /** Effective enforced rolling-24-hour recipient cap for this inbox. */
  daily_send_limit: number;
  /**
   * Whether raw protocol SMTP is currently allowed. It defaults to false, is
   * controlled by a human per inbox, and is effective only while the inbox has a
   * paid entitlement. Exported credentials do not imply this is true. API, SDK,
   * and MCP sends remain governed by the Review Loop regardless of this value.
   */
  direct_smtp_enabled: boolean;
  /**
   * Inbound webhook registered for this inbox, if any. The wire field is
   * `webhook_url` (the server returns `webhook_url`, never `inbound_webhook_url`);
   * absent/omitted when no webhook is set.
   */
  webhook_url?: string | null;
  /**
   * Arbitrary key-value metadata stored on the inbox (AgentMail parity). Always an
   * object: `{}` when none is set, never null. Values are string, number, or
   * boolean. Project-scoped: an agent key only reads/mutates metadata for inboxes in
   * its bound project.
   */
  metadata: InboxMetadata;
  created_at: IsoTimestamp;
  /**
   * The RESOLVED {@link ReviewPolicy} for THIS inbox: the per-inbox override,
   * else the account default, else the `require_review` floor.
   *
   * Present on the SINGLE-inbox read only; the list response omits it, because
   * populating it per row would be one settings read per row for a value that is
   * identical across every inbox in the org.
   */
  effective_review_policy?: ReviewPolicy;
  /** Present only on the create response when `return_credentials` was requested. */
  credentials?: InboxCredentials;
}

/** Query params for `GET /v1/inboxes`. */
export interface ListInboxesParams {
  /** Filter to a single domain. */
  domain?: string;
  status?: InboxStatus;
  /** Max items to return (server caps this). */
  limit?: number;
  /** Opaque cursor from a previous page's `next_cursor`. */
  cursor?: string;
}

/**
 * Query params for the canonical project-prefixed inbox list
 * (`GET /v1/projects/{project_id}/inboxes`, the `x.projects.inboxes.list` chain).
 * Returns the {@link List} envelope with opaque cursors. `include` expands the
 * per-resource relation allowlist (`agent`, `domain`; depth ≤ 2).
 */
export interface ProjectInboxListParams {
  /** Page size (server clamps to 1–100; default 50). */
  limit?: number;
  /** Opaque cursor from a prior page's `next_cursor`. */
  cursor?: string;
  /** Relation expansions (`["agent","domain"]`) serialized to `?include=agent,domain`. */
  include?: InboxInclude[];
}

/** Query params for the project-prefixed single-inbox read (`include=` expansion). */
export interface GetInboxParams {
  /** Relation expansions (`["agent","domain"]`). */
  include?: InboxInclude[];
}

/**
 * A page of results. This is the canonical envelope shared by Go + MCP + SDK:
 * `items` holds the page, `total` the full match count, and `next_cursor` the
 * opaque cursor (an offset) to fetch the next page (absent on the last page).
 */
export interface Page<T> {
  items: T[];
  /** Total count when the server can compute it cheaply. */
  total: number;
  /** Cursor to pass as `cursor` to fetch the next page; absent when exhausted. */
  next_cursor?: string;
}

// ---------------------------------------------------------------------------
// Messages, send, reply, threads (§6, §8)
// ---------------------------------------------------------------------------

/** An email address with an optional display name. */
export interface EmailAddress {
  email: string;
  name?: string | null;
}

/**
 * A message attachment (metadata; bytes fetched separately by id). Mirrors the
 * canonical Go wire shape (`attachmentResponse`): `id` is the opaque attachment
 * id addressing one MIME part of the message; `size` is the decoded byte length.
 */
export interface Attachment {
  id: string;
  filename: string;
  content_type: string;
  /** Decoded byte length of the attachment. */
  size: number;
}

/**
 * An outbound attachment on send / reply. `content_base64` is the standard
 * base64 encoding of the file bytes. Mirrors the Go `attachmentRequest`.
 */
export interface AttachmentInput {
  filename: string;
  content_type: string;
  /** Standard base64 of the raw file bytes. */
  content_base64: string;
}

/**
 * A stored message in an inbox (read shape). Mirrors the canonical Go wire shape
 * (`messageResponse`): `id` is the opaque, inbox-resolvable id; `inbox` is the
 * owning address; `seen` is the native IMAP \Seen read state (Extrovert has no
 * Gmail-style labels: read/unread is the \Seen flag); `folder` is the IMAP
 * mailbox; `date` is the raw `Date` header.
 */
export interface Message {
  id: string;
  thread_id: string;
  /** Owning inbox address. */
  inbox: string;
  direction: MessageDirection;
  from: EmailAddress;
  to: EmailAddress[];
  cc?: EmailAddress[];
  /** Reply-To addresses parsed from the source message. */
  reply_to?: EmailAddress[];
  subject: string;
  /** Decoded text/plain MIME alternative; null when absent and never derived from HTML. */
  text: string | null;
  /** Decoded text/html MIME alternative; null when absent and never synthesized from text. */
  html?: string | null;
  /** Best-effort derivative of text; null when unavailable and never authoritative. */
  extracted_text?: string | null;
  /** Best-effort derivative of html; null when unavailable and never authoritative. */
  extracted_html?: string | null;
  /** RFC 5322 `Message-ID` header value. */
  message_id: string;
  /** Source RFC 5322 parent Message-ID, when present. */
  in_reply_to?: string;
  /** Source RFC 5322 References chain, when present. */
  references?: string;
  /** IMAP folder the message lives in (e.g. `INBOX`, `Junk`). */
  folder?: string;
  /** Whether the message has been read (native IMAP \Seen flag). */
  seen: boolean;
  /** Raw `Date` header / received timestamp. */
  date: string;
}

/**
 * Query params for `GET /v1/inboxes/{addr}/messages`. The server applies
 * exact-field substring filters (from/to/subject) and an `unread` filter
 * (native \Seen), and pages with limit + offset (cursor is an offset).
 */
export interface ListMessagesParams {
  /** Substring match on subject. */
  subject?: string;
  /** Substring match on sender address. */
  from?: string;
  /** Substring match on a recipient address. */
  to?: string;
  /** Only return unread messages (\Seen flag clear). */
  unread?: boolean;
  limit?: number;
  /** Number of messages to skip (paging). */
  offset?: number;
  /** Opaque cursor from a previous page's `next_cursor` (an offset). */
  cursor?: string;
}

/** Query params for `GET /v1/inboxes/{addr}/messages/search`. */
export interface SearchMessagesParams {
  /** Full-text query (matched against from/subject/body via IMAP SEARCH). */
  q: string;
  limit?: number;
  offset?: number;
  cursor?: string;
}

/** Request body for `PATCH /v1/inboxes/{addr}/messages/{id}`: read-state toggle. */
export interface MarkReadRequest {
  /** true to set the \Seen flag (read), false to clear it (unread). */
  read: boolean;
}

/** A folder a batch update may move messages to. */
export type MailFolder = "INBOX" | "Sent" | "Trash" | "Junk" | "Archive";

/**
 * Request body for `PATCH /v1/inboxes/{addr}/messages/batch`: apply a read-state
 * toggle and/or a folder move to a list of message ids that all belong to the
 * inbox. At least one of `read` / `folder` must be set.
 */
export interface BatchUpdateMessagesRequest {
  /** Opaque message ids (msg_…), all owned by the inbox. Max 200. */
  ids: string[];
  /** When set, set (true) or clear (false) the \Seen flag on each id. */
  read?: boolean;
  /** When set, move each message to this folder. */
  folder?: MailFolder;
}

/** Per-id outcome of a batch update: `updated` succeeded, `failed` were skipped. */
export interface BatchUpdateResult {
  updated: string[];
  failed: string[];
}

/**
 * Outcome of a message or thread delete. `expunged` is true when removed
 * permanently, false when moved to Trash; `count` is the number of messages
 * affected (1 for a message, the thread size for a thread).
 */
export interface DeleteResult {
  id: string;
  deleted: true;
  expunged: boolean;
  count: number;
}

/** Request body for `POST /v1/inboxes/{addr}/send`. */
export interface SendRequest {
  /** A single address or a list; the SDK normalizes it to an array on the wire. */
  to: string | string[];
  subject: string;
  /**
   * The plain-text body. This is the CANONICAL wire name (matching
   * {@link ReplyRequest.text}, {@link ForwardRequest.text} and
   * {@link Message.text}); the server also accepts a deprecated `body` alias for
   * already-deployed callers, which the SDK never emits. At least one of `text` /
   * `html` is required.
   */
  text?: string;
  html?: string;
  /** A single address or a list; normalized to an array on the wire. */
  cc?: string | string[];
  /** A single address or a list; normalized to an array on the wire. */
  bcc?: string | string[];
  /** Override the `Reply-To` header. */
  reply_to?: string;
  /**
   * Idempotency key: a replay with the same key returns the first response
   * instead of sending a second message.
   *
   * Sent as the `Idempotency-Key` HEADER and STRIPPED from the JSON body: the
   * server hashes the raw body to detect a key reused with different content, so
   * a key that rode along inside the body would be part of its own replay hash.
   */
  idempotency_key?: string;
  /** Custom headers to attach (e.g. `List-Unsubscribe`). */
  headers?: Record<string, string>;
  /** Files to attach (base64). Emitted as a multipart/mixed message. */
  attachments?: AttachmentInput[];
  /**
   * Review Loop (HITL): `review` (default per policy) routes the message into the
   * human-review queue; `direct` requests an immediate send. The account/inbox
   * review policy may downgrade `direct` to `review`. Setting any of
   * mode/intent/category_id opts the send into the Review Loop.
   */
  mode?: ReviewMode;
  /** Intent for the human reviewer. Required when the resolved mode is review (D3). */
  intent?: ReviewIntent;
  /** Opaque category id (cat_…) matched from the registry; never a name. */
  category_id?: string;
  /**
   * Agent-supplied confidence (0..1) in the category match. Feeds the submit-time
   * min_confidence auto-send gate ONLY; the server never scores ($0 LLM). Below the
   * effective threshold (or omitted when a threshold is set) the would-be auto-send
   * routes to needs_review with gate_outcome `held:low_confidence`.
   */
  category_confidence?: number;
  /** Opaque token from the fresh getRules call used for this composition. */
  composition_token?: string;
}

/**
 * Request body for the canonical thread-aware reply,
 * `POST /v1/inboxes/{addr}/reply`. Exactly one of `thread_id` / `message_id`
 * selects the parent; the server derives `to` (original participants), the
 * `Re:`-prefixed subject, and the `In-Reply-To` / `References` headers: you do
 * NOT pass `to`. Set `reply_all` to reply to every thread recipient.
 */
export interface ReplyRequest {
  /** Reply to the latest message in this thread. One of thread_id / message_id. */
  thread_id?: string;
  /** Reply to this specific message. One of thread_id / message_id. */
  message_id?: string;
  /**
   * Optional optimistic stale-context guard for a thread reply. Use the
   * `last_message_id` from the thread you read; a 409 means the thread advanced.
   * This detects stale context at submission, but is not an atomic send lock.
   */
  expected_last_message_id?: string;
  /** At least one of `text` / `html` is required. */
  text?: string;
  html?: string;
  cc?: string | string[];
  bcc?: string | string[];
  /** Override the `Reply-To` header. */
  reply_to?: string;
  /** Reply to all thread recipients, not just the original sender. */
  reply_all?: boolean;
  /** See {@link SendRequest.idempotency_key}: sent as a header, never in the body. */
  idempotency_key?: string;
  headers?: Record<string, string>;
  /** Files to attach (base64). Emitted as a multipart/mixed message. */
  attachments?: AttachmentInput[];
  /** Review Loop assertion (see {@link SendRequest.mode}). */
  mode?: ReviewMode;
  /** Intent for the human reviewer. Required when the resolved mode is review (D3). */
  intent?: ReviewIntent;
  /** Opaque category id (cat_…) matched from the registry. */
  category_id?: string;
  /** Agent-supplied confidence (0..1); see {@link SendRequest.category_confidence}. */
  category_confidence?: number;
  composition_token?: string;
}

/**
 * Request body for `POST /v1/inboxes/{addr}/messages/{id}/forward`. Re-sends the
 * referenced message to new recipients, preserving the original content.
 *
 * A forward is governed by the SAME review policy as a send, and for a stronger
 * reason: it is an outbound message to arbitrary NEW recipients that quotes an
 * entire inbound thread. Leaving it outside the policy would have made forward
 * the documented bypass: and a worse one than a bare send, because it
 * exfiltrates a received conversation.
 */
export interface ForwardRequest {
  /** A single address or a list; normalized to an array on the wire. */
  to: string | string[];
  /** Additional recipients on the forward, screened by the same pre-flight as `to`. */
  cc?: string | string[];
  /** Blind recipients on the forward. Never rendered as a header. */
  bcc?: string | string[];
  /** Optional note prepended to the forwarded content. */
  text?: string;
  /**
   * Accepted and IGNORED by the server. The forwarded content is a plain-text
   * quote of the parent; emitting an HTML alternative would show HTML-capable
   * clients the note WITHOUT the forwarded thread.
   */
  html?: string;
  /** Review Loop assertion (see {@link SendRequest.mode}). */
  mode?: ReviewMode;
  /** Intent for the human reviewer. Required when the resolved mode is review (D3). */
  intent?: ReviewIntent;
  /** Opaque category id (cat_…) matched from the registry. */
  category_id?: string;
  /** Agent-supplied confidence (0..1); see {@link SendRequest.category_confidence}. */
  category_confidence?: number;
  composition_token?: string;
  /** See {@link SendRequest.idempotency_key}: sent as a header, never in the body. */
  idempotency_key?: string;
}

/**
 * The LEGACY immediate-send 202 body, returned when a caller mentioned nothing
 * about the review loop and the resolved policy permitted a direct send.
 *
 * Its shape differs per verb, which is why almost every field is optional and
 * this type is NOT the whole story (see {@link SendOutcome}):
 *
 *  - `send`          → `{status:"sent", message_id, review_id}`: **no `thread_id`**.
 *  - `reply`/`forward` → `{message_id, thread_id, review_id}`: no `status`.
 *
 * `thread_id` was declared REQUIRED here for a long time while the send path
 * never returned one, so `res.thread_id` typechecked and was `undefined` at
 * runtime. It is optional now because that is the truth.
 */
export interface SendResult {
  /**
   * Discriminant hole. This legacy body carries NO `kind` field, unlike the two
   * review-loop bodies it shares a union with; declaring it as absent is what
   * lets `if (res.kind === "queued_for_review")` narrow a {@link SendOutcome}.
   */
  kind?: undefined;
  /** Extrovert message id of the sent outbound message. */
  message_id: string;
  /** Thread id: present on reply/forward; ABSENT on the direct-send response. */
  thread_id?: string;
  /**
   * Opaque review id (rr_…) of the review row that governed this send. Every
   * agent-plane send now creates one, so an agent that crashed after issuing the
   * request can still call `reviews.get(id)` and read `closed` / `sent_message_id`
   * instead of guessing whether the message went out.
   */
  review_id?: string;
  /** RFC 5322 `Message-ID` header assigned by the sender, when known. */
  message_id_header?: string;
  status?: "queued" | "sent";
  created_at?: IsoTimestamp;
}

/**
 * Every shape `inbox.send()` / `.reply()` / `.forward()` / `.submitForReview()`
 * can return, discriminated by `kind`.
 *
 * There are three, because the resolved review policy: not the caller: decides
 * what happens to an outbound message:
 *
 *  - {@link QueuedForReviewResult} (`kind:"queued_for_review"`, 202): parked for
 *    a human. **Nothing has been delivered yet.** Monitor
 *    `reviewEvents.wait({review_id})` until a `sent` or `send_failed` event
 *    arrives.
 *  - {@link SentResult} (`kind:"sent"`, 200): delivered immediately, returned to
 *    callers that opted into the review loop by passing mode/intent/category_id.
 *  - {@link SendResult} (no `kind`, 202): the legacy immediate-send body for a
 *    caller that mentioned none of those fields.
 *
 * Under the default `require_review` policy a send WITHOUT an `intent` does not
 * return any of these: it raises `IntentRequiredError` (422) and nothing is sent
 * or queued. Use {@link isQueuedForReview} / {@link sentMessageIdOf} from
 * `send-result.js` rather than reaching for a field that may not be there.
 */
export type SendOutcome = SendResult | SentResult | QueuedForReviewResult;

// ---------------------------------------------------------------------------
// Review Loop (HITL): supervised-autonomy submit + agent-plane reads (spec §5).
// ---------------------------------------------------------------------------

/** Per-send agent assertion (D3/D6). The resolved policy may downgrade `direct`. */
export type ReviewMode = "review" | "direct";

/**
 * The account/inbox review policy: the AUTHORITY on what happens to an outbound
 * message. There is no way for a caller to opt out of it.
 *
 *  - `require_review`: the default for every account. A send WITHOUT an `intent`
 *    is rejected 422 `intent_required` (nothing sent, nothing queued); a send
 *    WITH one is queued for a human (202 `queued_for_review`).
 *  - `allow_direct`: a bare send (no mode/intent/category_id) is delivered
 *    immediately. Supplying an intent, or `mode: "review"`, still queues it.
 *  - `auto_send_graduated`: a categorized message that clears the graduation
 *    gates auto-sends; everything else is queued.
 *
 * Read {@link Inbox.effective_review_policy} once before your first send rather
 * than learning the policy by being refused.
 */
export type ReviewPolicy = "require_review" | "allow_direct" | "auto_send_graduated";

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
   * The DEFINITIVE per-review "am I done?" answer, and the poll-side companion to
   * the terminal review events. True for `sent`, `auto_sent`, `cancelled` **and
   * `failed`**.
   *
   * `failed` is included deliberately even though it is not in the formal
   * terminal set: nothing in the product can move a failed review: the console
   * cannot re-approve it: so a flag that said `false` there would invite an
   * agent to wait forever on a row nobody will ever touch.
   *
   * An agent that lost its event cursor (a crash, a fresh process) reads this
   * instead of guessing from the state string.
   */
  closed?: boolean;
  /**
   * The vendor-scrubbed delivery failure, present on a failed review. Until this
   * field existed an agent could learn THAT its message failed and never WHY.
   */
  send_error?: string;
  /**
   * How the message was released, once sent: `human_reviewed`,
   * `reviewer_approved`, `graduated_auto` or `agent_direct`: without a turns
   * fetch.
   */
  send_path?: string;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
  decided_at?: IsoTimestamp;
  sent_at?: IsoTimestamp;
}

/** One immutable turn in a review's append-only thread (turn_…). */
export interface ReviewTurn {
  id: string;
  seq: number;
  turn_type: string;
  actor_kind: "agent" | "human" | "review_agent" | "system";
  actor_id?: string;
  body?: string;
  revision?: number;
  diff_json?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  created_at: IsoTimestamp;
}

/** Filters for listing review requests (spec §5.2). */
export interface ListReviewsParams {
  composer?: "me";
  state?: ReviewState | ReviewState[];
  category_id?: string;
  inbox?: string;
  limit?: number;
  page?: string;
}

/** One human/agent comment in the assembled review feedback (spec §11). */
export interface ReviewFeedbackComment {
  turn_id: string;
  actor_kind: "agent" | "human" | "review_agent" | "system";
  actor_id?: string;
  body: string;
  created_at: IsoTimestamp;
}

/**
 * The human's assembled feedback for a review (spec §11), returned by
 * `reviews.feedback(id)`: the unified + structured diff of the human edit, the human
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

/** Body for posting a chat turn on a review's thread (spec §5.2; M5). */
export interface PostReviewChatRequest {
  /** The agent's question/comment for the human reviewer. */
  text: string;
}

/**
 * Body for posting a new agent draft under a parent_revision CAS (spec §5.2; M5,
 * D17). parent_revision is the PRIMARY CAS: it must equal the draft's current
 * revision, else 409 STALE with NO mutation. version is OPTIONAL belt-and-suspenders.
 */
export interface SubmitRevisionRequest {
  parent_revision: number;
  version?: number;
  subject?: string;
  /**
   * The redrafted plain-text body. Canonical, matching `text` on send / reply /
   * forward: the same concept should not have two names in the one flow an
   * agent runs most.
   */
  text?: string;
  /**
   * @deprecated Permanent alias for {@link SubmitRevisionRequest.text}. Kept
   * forever so existing callers never break. Sending both with DIFFERENT values
   * is rejected 400 `conflicting_alias`; the server decides, so both are
   * forwarded verbatim rather than resolved client-side.
   */
  body?: string;
  html?: string;
  built_at?: IsoTimestamp;
  rules_version_seen?: number;
  /** Opaque token from the fresh getRules call used for this redraft. */
  composition_token?: string;
  /**
   * REPLACES the draft's attachments. Omit the field to leave them untouched;
   * send an empty array to clear them.
   *
   * Without this a redraft could never restore an attachment, so an agent that
   * redrafted after reviewer feedback would ship a message the human reviewed
   * WITH a file and the recipient received without one.
   */
  attachments?: AttachmentInput[];
  /** Stable retry key, sent as Idempotency-Key and never in the JSON body. */
  idempotency_key?: string;
}

/**
 * The reason a durable review nudge was enqueued (spec §4.5). The agent branches
 * on it to decide what to do (redraft, learn, re-check a category, …).
 */
export type ReviewEventReason =
  // --- work items: the review is still live and wants something from you -----
  /** Redraft via `submit_revision` (a reviewer rejected, escalated, or swept it). */
  | "redraft_requested"
  /** A HUMAN added chat/feedback. Answer it, or redraft. (An agent's own question emits none.) */
  | "feedback_added"
  /** Re-check the draft's category assignment. */
  | "recheck_category"
  /** A rule changed. Re-read the rules, then redraft or `restamp_review`. */
  | "rule_changed"
  /** A newly general rule now applies to your drafts. */
  | "propagate_general_rule"
  /** A human rejected the draft. Learn from the feedback; redraft or stop. */
  | "rejected"
  // --- terminal-class: stop the current action --------------------------------
  //
  // `sent` and `cancelled` close the review. `send_failed` ends the delivery
  // attempt but the failed row can then be explicitly cancelled, producing a
  // later `cancelled` event. Ack every event; never assume exactly one of these.
  // `sent` covers both delivery flavors (`payload.state` distinguishes them).
  /** Delivered. `payload` carries `message_id`, `send_path`, `sent_at`. */
  | "sent"
  /**
   * Delivery failed. `payload.error` is the scrubbed reason and
   * `payload.agent_retryable` is `false`: the only edge out of `failed` is
   * cancel, so compose and submit a NEW message rather than retrying this one.
   */
  | "send_failed"
  /** Withdrawn: by you, by a human, or as the close-out of a failed send. */
  | "cancelled"
  /**
   * You were front-run: the review reached a terminal state while you were
   * trying to act on it, so your `submit_revision` / `post_review_chat` /
   * `cancel_review` answered 409 `terminal`. STOP retrying that review.
   */
  | "front_run_next"
  // --- reserved: published so the enum is never narrowed, never emitted ------
  /** RESERVED: never emitted. Terminal success is `sent`. */
  | "approved"
  /** RESERVED: no production producer (the D13 staleness detector is unbuilt). */
  | "staleness";

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
  created_at: IsoTimestamp;
}

/** The agent's per-(agent, review) ack frontier: its strict-FIFO position. */
export interface ReviewEventCursor {
  review_id: string;
  last_acked_seq: number;
}

/** Drain result for list/wait: un-acked events in FIFO seq order + cursors. */
export interface ReviewEventsResult {
  pending_reviews?: number;
  events: ReviewEvent[];
  cursors?: ReviewEventCursor[];
}

/** Filters for draining review events (spec §5.9 list_review_events). */
export interface ListReviewEventsParams {
  /** Restrict the drain to one review's events (rr_…). */
  review_id?: string;
  /** Max events to return in one drain. */
  limit?: number;
}

/**
 * A category (cat_…) in the Review Loop registry (D9/D10). `name` + `description`
 * are skill-style metadata the agent fuzzy-matches against; nothing keys on the
 * name (renames never break a reference). Categories are CUSTOMER-scoped and
 * agent-attributed: the deliberate cross-agent-404 exception. Opaque ids only.
 */
export interface Category {
  id: string;
  name: string;
  description: string;
  scope: "org_shared" | "agent_private";
  state: "supervised" | "auto_notify" | "auto_silent";
  /** Survivor id when this category was merged / soft-deleted (cat_…). */
  merged_into?: string;
  created_by_agent_id?: string;
  author_kind: "agent" | "human";
  rule_high_water: number;
  rules_version: number;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

/** Browse filter for the category registry (spec §5.5). */
export interface ListCategoriesParams {
  /** Pure lexical substring filter over name+description (every token must match; NO LLM). */
  match?: string;
}

/** Propose a new category (spec §5.5; D9). */
export interface ProposeCategoryRequest {
  name: string;
  description?: string;
  /** Defaults to org_shared server-side. */
  scope?: "org_shared" | "agent_private";
}

/** Rename / re-describe a category: metadata only (spec §5.5; D10). */
export interface UpdateCategoryRequest {
  name?: string;
  description?: string;
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
 * plus every category's overrides. Read-only for agents: flipping the dial is a
 * console (human) action (D16).
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
  /** The rung a graduate would move to (empty if none). */
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

/** Record a graduation request (spec §5.6; D16/D6). evidence is opaque agent context. */
export interface ProposeGraduationRequest {
  evidence?: Record<string, unknown>;
}

/**
 * The D19/§8 re-stamp-without-redraft escape valve ($0). The agent asserts it reviewed
 * the draft against rules `against_version` and no change is needed; the server
 * advances the draft's composed_* rules-versions WITHOUT a new draft. against_version
 * must not exceed the category's current rules-version.
 */
export interface RestampReviewRequest {
  /** The category rules-version the agent reviewed against (≤ the current version). */
  against_version: number;
  /** Optional: re-stamp the house-style axis to this version (≤ the current version). */
  house_style_version?: number;
  /** Stable retry key, sent as Idempotency-Key and never in the JSON body. */
  idempotency_key?: string;
}

/** The reviewer's decision verb (BYO review-agent plane; D5/§9). */
export type ReviewerAction = "approve" | "edit" | "reject" | "escalate";

/**
 * The REVIEWER's read-only decision surface for a review (BYO review-agent plane;
 * D5/§9), returned by `reviews.decisionContext(id)`: the intent + current draft + the
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
  review_deadline: IsoTimestamp;
  /** Breaker (b) tripped. */
  deadline_passed: boolean;
  /** Breaker (a) tripped. */
  hops_exhausted: boolean;
  /** Either breaker tripped: a reject is overridden to a human escalation. */
  force_to_human: boolean;
  /** The tripped breaker (max_hops_reached | review_deadline_passed). */
  force_reason?: string;
}

/**
 * Body for a reviewer decision (`reviews.decide(id, req)`; reviewer_decide, D5/§9).
 * `action` is approve|edit|reject|escalate. `revision`/`version` are the optimistic CAS
 *: a mismatch is a 409 STALE with NO mutation (the human always wins, D17). subject/
 * body carry the edited content for the edit action; feedback is the reviewer's note.
 */
export interface ReviewerDecisionRequest {
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

/**
 * The outcome of a reviewer decision (D5/§9). `kind=sent` when the platform sent
 * with the COMPOSER's creds (approve/edit: the reviewer NEVER holds mailbox:send);
 * `kind=sent_to_human` when the draft returned to the human queue (reject/escalate, or
 * a reject FORCED to the human by a circuit breaker, with `forced_by_breaker` naming it).
 */
export interface ReviewerDecisionResult {
  kind: "sent" | "sent_to_human";
  review: Review;
  sent: boolean;
  message_id?: string;
  thread_id?: string;
  sent_to_human: boolean;
  forced_by_breaker?: string;
}

/**
 * The D19/§8 backlog-reconciliation snapshot for a category (agent-readable, $0-LLM).
 * Counts the QUEUED drafts that are stale vs current-enough against the current
 * category rules-version + house-style version (a pure integer compare). Read-only :
 * the agent READS the picture; the human / hooks TRIGGER the actual sweep.
 */
export interface ScanBacklogStatus {
  category_id: string;
  state: "supervised" | "auto_notify" | "auto_silent" | "probation";
  /** Drafts in the human queue (needs_review|in_review|chatting). */
  queued: number;
  /** Of the queued, how many are within tolerance of the current rules-version. */
  current_enough: number;
  /** Of the queued, how many were composed under older rules and need a redraft. */
  stale: number;
  current_category_rules_version: number;
  current_house_style_version: number;
  /** How many versions behind current a draft may be and still count current-enough. */
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
  /** The last queued draft the human acted on (the cursor); omitted when nothing reviewed yet. */
  cursor_review_id?: string;
  /** Monotonic count of cursor advances. */
  cursor_advanced_count: number;
  /** Effective freshness window (default org_settings.lookahead_window=3). */
  lookahead_window: number;
  /** HARD per-nudge fan-out ceiling (default 10): one nudge can never fan to 500. */
  rework_batch_max: number;
  /** Per-agent token-bucket interval that coalesces feedback storms (default 5000). */
  nudge_min_interval_ms: number;
  /** Drafts in the human queue (needs_review|in_review|chatting). */
  queued: number;
  /** Of the queued, how many sit in the freshness-guaranteed window. */
  in_window: number;
  /** Of the in-window, how many are stale and being redrafted (the console shimmer set). */
  redrafting: number;
  items: PacingItem[];
}

/** Long-poll params: like {@link ListReviewEventsParams} plus a wait budget. */
export interface WaitForReviewEventParams extends ListReviewEventsParams {
  /** Long-poll budget in seconds (default ~30, capped ~55). */
  wait_seconds?: number;
}

/**
 * The ownership layer of a writing rule (org/project model). `org` = house-style
 * inherited by every project in the org; `project` = layered on top of the org rules
 * (the agent-plane default). Project/per-agent rules outrank broader org rules in the
 * ordered get_rules precedence ladder.
 */
export type RuleLayer = "org" | "project";

/**
 * A learned writing rule (rule_…) in the Review Loop (D2/D11). House-style/general
 * (scope='general', applies across all categories) or category-scoped. Append-only
 * by supersession: an edit is a new rev (same lineage_id) with the prior superseded.
 * Read by the agent at compose/redraft time via the ORDERED get_rules ladder; we
 * never apply it (NO LLM on our side). Opaque ids only (D10).
 *
 * Layering (org/project): `rule_layer` says whether the rule is an org-wide
 * house-style rule (`org`) or a project-layer rule (`project`). `org_id` is always
 * set; `project_id` is set for a project-layer rule and empty for an org-layer rule.
 */
export interface Rule {
  id: string;
  lineage_id: string;
  rev: number;
  /**
   * Ownership layer (org/project). `org` = house-style inherited by every project;
   * `project` = layered on top (the agent-plane default). Optional/additive so older
   * servers that don't set it still parse.
   */
  rule_layer?: RuleLayer;
  /** The org this rule belongs to. */
  org_id?: string;
  /** The project this rule belongs to; empty for an org-layer rule. */
  project_id?: string;
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
  author_kind: "agent" | "human";
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
  source_review_id?: string;
  source_turn_id?: string;
}

/** Filter for the ordered get_rules read (spec §5.4; §7). */
export interface GetRulesParams {
  /** Category id (cat_…). Empty returns ONLY the house-style/general layer. */
  category_id?: string;
  /** Narrow to one layer (general | category). Default returns both. */
  scope?: "general" | "category";
}

/** Stable effective rule stack plus an opaque proof for the next composition. */
export interface RuleSnapshot extends Page<Rule> {
  house_style_version: number;
  category_rules_version: number;
  rule_high_water: number;
  composition_token?: string;
  composition_token_expires_at?: IsoTimestamp;
}

/**
 * Save / edit a writing rule (append-only by supersession; spec §5.4; D11).
 *
 * Layering (org/project): an agent-plane save is ALWAYS project-layer: the saved
 * rule's `rule_layer` is `project`, bound to the calling key's project. There is no
 * settable `rule_layer` here: an agent cannot create org-layer / house-style
 * (`rule_layer="org"`) rules in v1; authoring org rules is a console/admin action.
 * (`scope: "general"` still means a house-style rule WITHIN the project layer :
 * `scope` is the category axis, `rule_layer` is the ownership axis.)
 */
export interface SaveRuleRequest {
  /** Stable retry key, sent as Idempotency-Key and omitted from the JSON body. */
  idempotency_key?: string;
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
  /**
   * D8 retro-propagation HUMAN OPT-IN (default false). When true, a NEW category rule
   * that could apply to pending siblings enqueues ONE propagate_general_rule nudge
   * (siblings + suggested_batch) so the agent redrafts a FEW at a time: never the
   * whole queue. Set only after the human said "apply to N pending?".
   */
  propagate_to_pending?: boolean;
  /** Override the propagate batch (0 = base 3, bounded by rework_batch_max). */
  suggested_batch?: number;
}

/** One append-only rule/category change & undo audit row (udo_…). */
export interface RuleAuditEntry {
  id: string;
  entity_kind: "rule" | "category";
  entity_id: string;
  action: "create" | "supersede" | "retire" | "rename" | "redescribe" | "merge" | "restore";
  actor_kind: "agent" | "human" | "system";
  actor_id?: string;
  before_json?: string;
  after_json?: string;
  undone: boolean;
  created_at: IsoTimestamp;
}

/** Filter for the rule/category change audit read (spec §5.4; D11). */
export interface GetRuleAuditParams {
  entity_kind?: "rule" | "category";
  entity_id?: string;
}

/** One per-(agent, review) cursor advance for ack_review_event. */
export interface AckReviewEventEntry {
  review_id: string;
  through_seq: number;
}

/** Ack request: advance per-review cursor(s) and/or mark broadcast nudges done. */
export interface AckReviewEventRequest {
  acks?: AckReviewEventEntry[];
  broadcast_ids?: string[];
}

/** Ack result: the resulting per-review cursors. */
export interface AckReviewEventResult {
  cursors?: ReviewEventCursor[];
}

/** A Review Loop submit parked for human review (202). */
export interface QueuedForReviewResult {
  kind: "queued_for_review";
  review: { id: string; state: ReviewState; effective_mode?: ReviewMode };
}

/** A Review Loop submit sent immediately (200). */
export interface SentResult {
  kind: "sent";
  message: { id: string; thread_id?: string };
  /**
   * The review row that governed this send (ADDITIVE). Present on every send the
   * service routed, i.e. all of them: it is the handle that makes a post-crash
   * `reviews.get(id)` possible on the direct path too.
   */
  review?: { id: string; state: ReviewState };
}

/** The discriminated outcome of a review-mode submit (queued OR sent). */
export type SubmitForReviewResult = QueuedForReviewResult | SentResult;

/**
 * A conversation thread (read shape). Grouped server-side by RFC 5322
 * References / In-Reply-To chaining (subject fallback); `id` is stable across
 * calls. `participants` are display address strings (`Name <email>` or bare).
 */
export interface Thread {
  id: string;
  /** Owning inbox address. */
  inbox_id: string;
  subject: string;
  /** List/search summaries use the latest envelope; thread detail may include the full conversation set. */
  participants: string[];
  message_count: number;
  last_message_at: IsoTimestamp;
  /** Most-recent-message preview snippet. */
  snippet: string;
  /** Whether the latest message is unread. */
  unread?: boolean;
  /** Whether the newest message has one or more attachments. */
  last_message_has_attachments?: boolean;
  /** Opaque message id for optimistic reply freshness checks. */
  last_message_id?: string;
}

/** A thread plus its messages (oldest-first): `GET /v1/inboxes/{addr}/threads/{id}`. */
export interface ThreadDetail extends Thread {
  messages: Message[];
}

/** Query params for `GET /v1/inboxes/{addr}/threads`. */
export interface ListThreadsParams {
  limit?: number;
  offset?: number;
  cursor?: string;
}

// ---------------------------------------------------------------------------
// wait_for_email: the killer primitive (§6)
// ---------------------------------------------------------------------------

/**
 * Request for `POST /v1/inboxes/{addr}/wait`. Polls server-side until a matching message arrives
 * or the timeout elapses, then returns it with an extracted OTP / verification link.
 */
export interface WaitForEmailRequest {
  /** Only match messages from this sender address or domain. */
  from?: string;
  /** Only match messages whose subject contains this substring (case-insensitive). */
  subject?: string;
  /** Case-sensitive Go RE2 expression over subject/readable body. Prefix `(?i)` for case-insensitive matching. */
  match?: string;
  /** Prefer an extracted link containing this substring; this does not filter message matches. */
  link_hint?: string;
  /** Max seconds to block before returning a timeout. Server caps this (default 300, cap 600). */
  timeout_seconds?: number;
  /**
   * If true (default), only consider messages that arrive after the request is made, ignoring the
   * existing inbox contents. Set false to also match an already-delivered message.
   */
  since_now?: boolean;
}

/** Structured extraction returned alongside the matched message. */
export interface ExtractedCredentials {
  /** The first OTP-looking code found in the body (e.g. `492013`), or null. */
  otp: string | null;
  /** The first verification/magic link found in the body, or null. */
  link: string | null;
}

/** Result of `wait_for_email`. `timed_out` distinguishes "no match in time" from a real match. */
export interface WaitForEmailResult {
  /** True when the timeout elapsed before a match; in that case `message` is null. */
  timed_out: boolean;
  /** The matched message, or null on timeout. */
  message: Message | null;
  /** Structured OTP/link extraction from the matched message body. */
  extracted: ExtractedCredentials;
}

// ---------------------------------------------------------------------------
// Webhooks (§6, §14)
// ---------------------------------------------------------------------------

/** Webhook event types Extrovert emits. */
export type WebhookEvent = "message.received";

/** Request body for `POST /v1/webhooks`. Registers an HMAC-signed, timestamped endpoint. */
export interface RegisterWebhookRequest {
  url: string;
  /** Events to subscribe to. Defaults to `["message.received"]`. */
  events?: WebhookEvent[];
  /** Scope the webhook to a single inbox address; omit for all inboxes the key can read. */
  inbox?: string;
  /**
   * Optional idempotency key (sent as the `Idempotency-Key` header). A retry with
   * the same key replays the original webhook registration instead of duplicating.
   */
  client_id?: string;
}

/**
 * PATCH body for `PATCH /v1/webhooks/{id}`. Every field is optional; an omitted
 * field leaves the stored value unchanged (PATCH semantics). The signing secret
 * and id are immutable.
 */
export interface UpdateWebhookRequest {
  /** Replace the HTTPS delivery endpoint. */
  url?: string;
  /** Replace the subscribed event set. */
  events?: WebhookEvent[];
  /** Replace the inbox filter; an empty string clears it (covers all owned inboxes). */
  inbox?: string;
  /** Enable or disable delivery without deleting the webhook. */
  active?: boolean;
}

/** A registered webhook (read shape). The `secret` is returned once at registration. */
export interface Webhook {
  id: string;
  url: string;
  events: WebhookEvent[];
  inbox: string | null;
  /** Agent that owns this webhook. */
  agent_id?: string;
  /**
   * HMAC signing secret, returned once at registration. Used to verify the `X-Extrovert-Signature`
   * header on inbound deliveries (see {@link verifyWebhookSignature}). Absent on list/get reads.
   */
  secret?: string;
  /** Display prefix of the secret (safe to store), e.g. `whsec_a1b2`. */
  secret_prefix: string;
  /** Whether the webhook is active (deliveries are sent). */
  active: boolean;
  created_at: IsoTimestamp;
}

// ---------------------------------------------------------------------------
// Contact allow/block lists (Slice 3)
// ---------------------------------------------------------------------------

/** Whether a contact-list entry permits (allow) or rejects (block) a match. */
export type ContactListKind = "allow" | "block";

/** Traffic direction a contact-list entry governs. Only `send` is enforced today. */
export type ContactListDirection = "send" | "receive";

/**
 * Request body for `POST /v1/inboxes/{addr}/lists`. Adds one allow/block entry.
 * `pattern` is a bare email address (matched in full) or a bare domain (matches
 * any address in that domain).
 */
export interface AddContactListRequest {
  kind: ContactListKind;
  /** Defaults to `send` server-side (the only enforced direction today). */
  direction?: ContactListDirection;
  pattern: string;
}

/**
 * A contact allow/block-list entry (read shape). `inbox` is null when the entry
 * is account-wide (covers every inbox the agent owns).
 */
export interface ContactListEntry {
  id: string;
  inbox: string | null;
  kind: ContactListKind;
  direction: ContactListDirection;
  pattern: string;
  created_at: IsoTimestamp;
}

// ---------------------------------------------------------------------------
// Suppressions (recipient opt-outs / list-unsubscribe): customer/org-scoped
// ---------------------------------------------------------------------------

/**
 * The scope a suppression row applies at. The agent plane only ever sees `org`
 * rows (the caller's OWN org): the reads never surface a platform-`global` or
 * shared-domain opt-out (non-leakage). The wider values are part of the shape for
 * forward-compatibility with the admin/operator plane.
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
 * mail; a send to them is rejected with `recipient_suppressed`
 * ({@link RecipientSuppressedError}). Revoke a row (with a reason) to re-enable
 * sending to that recipient.
 */
export interface SuppressionEntry {
  id: string;
  /** The canonicalized (lower-cased, normalized) recipient the row suppresses. */
  recipient: string;
  /** The recipient exactly as it was originally addressed, when it differs. */
  recipient_raw?: string;
  scope: SuppressionScope;
  source: SuppressionSource;
  /** Set when the row is narrowed to one agent (recipient-chosen narrow row). */
  narrow_agent_id?: string;
  /** Set when the row is narrowed to one mailbox (recipient-chosen narrow row). */
  narrow_mailbox?: string;
  /** The mailbox the opt-out originated from, when known. */
  origin_mailbox?: string;
  /** The agent whose send produced the opt-out, when known. */
  origin_agent_id?: string;
  /** The message that carried the unsubscribe link/header, when known. */
  origin_message_id?: string;
  /** How many times this recipient re-suppressed after a revoke (abuse signal). */
  reactivation_count: number;
  created_at: IsoTimestamp;
  /** Present once the row is revoked. */
  revoked_at?: IsoTimestamp;
  /** Who revoked the row (e.g. `agent:<id>`), when revoked. */
  revoked_by?: string;
  /** The required, audit-logged reason the row was revoked. */
  revoke_reason?: string;
  /** True when the row has been revoked (no longer enforced). */
  revoked: boolean;
}

/**
 * The result of a pre-check (`GET /v1/suppressions?recipient=…`): whether the
 * caller's OWN org suppresses the recipient, plus the matching org rows. Reflects
 * only the caller's org state: never a global/shared/cross-tenant opt-out.
 */
export interface SuppressionPrecheck {
  recipient: string;
  /** True when the caller's org has an active (non-revoked) row for the recipient. */
  suppressed: boolean;
  rows: SuppressionEntry[];
}

/** Filters + paging for `GET /v1/suppressions` (the caller's own org rows). */
export interface ListSuppressionsParams {
  /** Narrow to one scope; the agent plane only ever returns `org` rows. */
  scope?: SuppressionScope;
  /** Include revoked rows too (default: active rows only). */
  include_revoked?: boolean;
  /** Max rows to return. */
  limit?: number;
  /** Opaque cursor from a previous page's `next_cursor`. */
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

/** Domain visibility for an onboarded domain (org/project model). */
export type DomainScope = "org" | "project";

/**
 * Request body for `POST /v1/domains`. Onboards/adds a domain for the customer.
 *
 * Requires the `domain:manage` scope. This request only adds a delegated inbox
 * domain the customer controls; it cannot register one.
 * New registrations use the separate commerce quote/request workflow.
 */
export interface OnboardDomainRequest {
  domain: string;
  /**
   * Onboarding path. Defaults to `ns_delegated` server-side when omitted.
   */
  mode?: "ns_delegated";
  /**
   * Domain visibility. Defaults to `org` (org-shared, usable by every project in the
   * org). `project` binds the domain to the key's OWN bound project (never
   * client-selected) so it is only visible/creatable from that project. A
   * legacy/unscoped key (no bound project) falls back to `org`.
   */
  scope?: DomainScope;
  /**
   * Optional assertion that must match the key's bound project: NEVER a selector.
   * A mismatch is a 403. The binding is always derived from the key.
   */
  project_id?: string;
}

/**
 * The agent-facing view of one onboarded domain (mirrors the Go `domainResponse`).
 * `delegation_ns` is present on get / onboard / verify for delegated domains and
 * empty on list reads. `records` remains for legacy response compatibility.
 */
export interface Domain {
	/** Authoritative outcome. Absent only when talking to an older server; never infer readiness from DKIM. */
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
  created_at: IsoTimestamp;
  records?: DomainRecord[];
  delegation_ns?: DomainRecord[];
  /** Human-facing copy for what the customer must do next. */
  instruction?: string;
}

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
  /** Domain configuration only; creating an inbox still requires permission and available plan capacity. */
  ready_for_inboxes: boolean;
  checked_at?: IsoTimestamp;
  next_check_at?: IsoTimestamp;
  poll_after_seconds: number;
  /** Omitted without inbox-read permission. Counts never imply organization-wide visibility for an agent. */
  inboxes?: { scope: "agent" | "project" | "organization"; total: number; ready: number; setting_up: number; needs_attention: number };
}

/**
 * Result of an ACCEPTED domain offboard (`DELETE /v1/domains/{domain}` → HTTP 202).
 * Teardown: reaping the outbound provider senders + routing rows, then scrubbing
 * the DNS zone/records and the domain row: runs as an async job. Poll `status_url`
 * (`GET /v1/jobs/{job_id}`, via {@link Job} / `client.getJob(job_id)`) until
 * `status` is terminal (succeeded/failed/cancelled); the domain is ACCEPTED for
 * offboard, not yet fully torn down when this returns.
 */
export interface DomainOffboard {
  domain: string;
  job_id: string;
  status: string;
  status_url: string;
}

/**
 * Poll-loop status for one async job (currently only the domain-offboard
 * teardown started by `domains.offboard`). Mirrors `GET /v1/jobs/{job_id}`.
 * `status` is terminal on succeeded/failed/cancelled; keep polling otherwise.
 */
export interface Job {
  object: "job";
  id: string;
  type: string;
  status: string;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
  finished_at?: IsoTimestamp;
}

// ---------------------------------------------------------------------------
// Agent-facing commerce: quote/request/status only; approval is human-only
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
  reset_at?: IsoTimestamp;
  manage_url?: string;
}

/** Request body for the non-spending domain quote endpoint. */
export interface QuoteDomainRequest {
  domain: string;
}

/** Current, expiring domain registration quote. Quoting never purchases. */
export interface DomainQuote {
  object: "domain_quote";
  domain: string;
  available: boolean;
  currency: string;
  quote_cents: number;
  renewal_cents: number;
  premium: boolean;
  quote_expires_at: IsoTimestamp;
  required_plan?: string;
  required_plan_price_cents?: number;
  blockers: CommerceBlocker[];
}

export type CommerceRequestKind = "domain_purchase" | "plan_change";

export interface RequestDomainPurchaseRequest {
  domain: string;
  /** Stable retry identity; sent as the `Idempotency-Key` header, not in the JSON body. */
  idempotency_key: string;
  scope?: DomainScope;
  rationale?: string;
  auto_renew?: boolean;
}

export interface RequestPlanChangeRequest {
  target_plan: "free" | "developer" | "startup";
  /** Stable retry identity; sent as the `Idempotency-Key` header, not in the JSON body. */
  idempotency_key: string;
  rationale?: string;
}

export interface ListCommerceRequestsParams {
  limit?: number;
  page?: string;
}

/** Durable poll shape for an agent-initiated financial request. */
export interface CommerceRequest {
  object: "commerce_request";
  id: string;
  project_id?: string;
  agent_id?: string;
  kind: CommerceRequestKind;
  state: string;
  domain?: string;
  domain_scope?: DomainScope;
  target_plan?: string;
  current_plan?: string;
  rationale?: string;
  currency: string;
  quote_cents: number;
  renewal_cents: number;
  approved_max_cents?: number;
  quote_expires_at?: IsoTimestamp;
  auto_renew: boolean;
  required_plan?: string;
  required_plan_price_cents?: number;
  blocker_code?: string;
  blockers: CommerceBlocker[];
  approval_url?: string;
  payment_action_url?: string;
  external_job_id?: string;
  effective_at?: IsoTimestamp;
  notification_state?: string;
  notification_last_error?: string;
  agent_next_action: string;
  retry_safe: boolean;
  poll_after_seconds: number;
  version: number;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

// ---------------------------------------------------------------------------
// Real-time event stream (Server-Sent Events)
// ---------------------------------------------------------------------------

/**
 * One event from the SSE stream (`GET /v1/inboxes/{addr}/stream` or `GET
 * /v1/events`). It is the SAME envelope a webhook delivers, so a stream consumer
 * and a webhook consumer see identical data. `seq` is the monotonic resume token
 * (the SSE frame's `id:` field): pass the last `seq` you saw as `lastEventId` on
 * reconnect to replay only events after it. The envelope is intentionally generic
 * so it can also carry future event types (e.g. HITL).
 */
export interface StreamEvent {
  /** Event type, e.g. `message.received`. Mirrors the SSE `event:` field. */
  event: string;
  /** Monotonic resume token (the SSE `id:` field). Pass back as `lastEventId`. */
  seq: number;
  /** Opaque event id (`evt_...`). */
  id: string;
  created_at: IsoTimestamp;
  /** The inbox this event concerns. */
  inbox: string;
  /** The message the event is about (present for message.* events). */
  message?: Message;
}

/** Options for the SSE stream / subscribe helpers. */
export interface StreamOptions {
  /**
   * Resume token from a prior run: the `seq` of the last event you processed. The
   * server replays every event after it (Last-Event-ID semantics), so a reconnect
   * never misses or double-delivers. Omit to start from now.
   */
  lastEventId?: number;
  /** Abort the stream (close the connection) when this signal fires. */
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Self-signup + auth introspection (Slice E)
// ---------------------------------------------------------------------------

/** Request body for the unauthenticated `POST /v1/agent/sign-up`. */
export interface SignUpRequest {
  /** Human email that receives the one-time verification code. */
  human_email: string;
  /** Desired local part on `free.extrovertmail.com`. It must normalize to at least 5 characters and cannot use a reserved name. */
  username?: string;
}

/**
 * Response from `POST /v1/agent/sign-up`. The `agent_key` is a LIMITED-scope key
 * (verification-only, with no inbox read or send permission) that expires with the emailed code. Successful verification revokes
 * it and returns a replacement full-scope key. The OTP itself is never returned.
 */
export interface SignUpResponse {
  customer_id: string;
  agent_id: string;
  /** Limited-scope bootstrap key, shown once and bounded by `otp_expires_at`. */
  agent_key: string;
  key_prefix: string;
  scopes: Scope[];
  /** The first inbox created for the agent. */
  address: string;
  verified: boolean;
  /** Where the verification code was sent. */
  otp_sent_to: string;
  otp_expires_at: IsoTimestamp;
  message: string;
}

/** Request body for `POST /v1/agent/verify`. */
export interface VerifyRequest {
  /** The one-time code delivered to the signup human email. */
  otp: string;
}

/** One copy-ready MCP operation in the post-verification mailbox handoff. */
export interface MailboxQuickstartCall {
  tool: "read_messages" | "get_message" | "wait_for_email";
  arguments: Record<string, unknown>;
}

/**
 * Safe, MCP-first next calls for the inbox returned by signup verification.
 * SDK callers can use `address` with the typed inbox/message resources instead;
 * these calls keep agent runtimes from inventing raw HTTP routes or parsers.
 */
export interface MailboxQuickstart {
  inbox: string;
  list_mail: MailboxQuickstartCall;
  read_message: MailboxQuickstartCall;
  wait_for_mail: MailboxQuickstartCall;
}

/**
 * Response from `POST /v1/agent/verify`. On success the bootstrap key is revoked
 * and a NEW full-scope `agent_key` is returned; switch to it for subsequent calls.
 * `address` repeats the ready inbox so the handoff remains self-contained after
 * a process restart or context compaction.
 */
export interface VerifyResponse {
  agent_id: string;
  agent_key: string;
  key_prefix: string;
  scopes: Scope[];
  /** The signup inbox, ready for immediate list/read/wait/send operations. */
  address: string;
  verified: boolean;
  message: string;
  mailbox_quickstart: MailboxQuickstart;
  /** One-time email-bound owner claim for the human console, when freshly seeded. */
  org_claim_token?: string;
}

/**
 * Response from `GET /v1/auth/me`: the verified principal behind the key.
 *
 * `org_id`/`project_id` are the FIXED org/project the key is bound to (resolved from
 * the stored key, never client input). There is NO mutable project selector for a
 * scoped key: `whoami` is the canonical project-visibility surface; project
 * selection happens when the human/admin issues the enrollment token or agent key.
 */
export interface WhoAmI {
  connection_status?: "connected";
  summary?: string;
  agent_name?: string;
  organization_name?: string;
  project_name?: string;
  /** Granted permissions, not a guarantee of plan capacity or review approval. */
  capabilities?: { read_domain_status: boolean; connect_owned_domains: boolean; create_inboxes: boolean; read_inboxes: boolean; submit_mail_for_review: boolean; request_purchases: boolean };
  customer_id: string;
  /**
   * The fixed org the key is bound to. Optional to match the OpenAPI contract: a
   * legacy/unscoped server (or any deploy predating org/project binding) may omit it.
   */
  org_id?: string;
  /**
   * The fixed project the key is bound to. Optional to match the OpenAPI contract: a
   * legacy/unscoped server (or any deploy predating org/project binding) may omit it.
   */
  project_id?: string;
  agent_id: string;
  key_id: string;
  scopes: Scope[];
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
