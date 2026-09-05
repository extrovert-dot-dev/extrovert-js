/**
 * InboxHandle: an ergonomic, bound handle to a single inbox.
 *
 * Returned by `extrovert.inboxes.create(...)` and `extrovert.inbox(address)`, it scopes every operation
 * to one address so agent code reads naturally: `inbox.send(...)`, `inbox.waitForEmail(...)`. This
 * is the "one agent = one inbox" shape the spec's identity model encourages (§5).
 */

import type { AttachmentDownload, Transport } from "../transport.js";
import type {
  AddContactListRequest,
  Attachment,
  BatchUpdateMessagesRequest,
  BatchUpdateResult,
  ContactListEntry,
  DeleteResult,
  ForwardRequest,
  Inbox,
  InboxCredentials,
  InboxStatus,
  ListMessagesParams,
  ListThreadsParams,
  MarkReadRequest,
  Message,
  OnboardingMode,
  Page,
  RegisterWebhookRequest,
  ReplyRequest,
  SearchMessagesParams,
  SendOutcome,
  SendRequest,
  StreamEvent,
  StreamOptions,
  Thread,
  ThreadDetail,
  UpdateInboxRequest,
  WaitForEmailRequest,
  WaitForEmailResult,
  Webhook,
} from "../models.js";

export interface InboxHandleOptions {
  /** Default per-call timeout for blocking calls; resolved from the client config. */
  defaultWaitTimeoutMs: number;
}

export class InboxHandle {
  /** The canonical address, e.g. `agent7@extrovertmail.com`. */
  readonly address: string;
  /** The full inbox record this handle was created from (absent when constructed by address). */
  readonly record: Inbox | undefined;

  constructor(
    private readonly transport: Transport,
    address: string,
    private readonly options: InboxHandleOptions,
    record?: Inbox,
  ) {
    this.address = address;
    this.record = record;
  }

  /** The inbox id, when known. */
  get id(): string | undefined {
    return this.record?.id;
  }

  /**
   * The canonical key every transport op routes on. The contract canonicalizes the
   * OPAQUE inbox id (`pmbx_…`) and accepts the address only as a within-project alias
   * (both are valid in the `{inbox_id}` path slot). When this handle was built from a
   * full record we route by the canonical `id` (matching the "an inbox's canonical key
   * is its opaque id" docs); when built bare from an address (`client.inbox(addr)`),
   * the address alias is the only key we have, so we route on it.
   */
  private get ref(): string {
    return this.record?.id ?? this.address;
  }

  /**
   * Arbitrary key-value metadata on this inbox, when known (from the record this
   * handle was created from). Call {@link refresh} to re-read it after an update.
   */
  get metadata(): Inbox["metadata"] | undefined {
    return this.record?.metadata;
  }

  /** Effective rolling-24-hour recipient cap, when known. */
  get dailySendLimit(): number | undefined {
    return this.record?.daily_send_limit;
  }

  /** Provisioning status, when known. */
  get status(): InboxStatus | undefined {
    return this.record?.status;
  }

  /** Onboarding mode of the host domain, when known. */
  get onboardingMode(): OnboardingMode | undefined {
    return this.record?.onboarding_mode;
  }

  /** Credentials, present only when the inbox was created with `returnCredentials: true`. */
  get credentials(): InboxCredentials | undefined {
    return this.record?.credentials;
  }

  /** Re-fetch the live inbox record. */
  refresh(signal?: AbortSignal): Promise<Inbox> {
    return this.transport.getInbox(this.ref, signal);
  }

  /**
   * Update this inbox's settings in place without delete+recreate: rename the sender
   * `display_name`, change the `webhook_url`, patch arbitrary `metadata` (shallow
   * merge; a key set to `null` deletes it, top-level `metadata: null` clears all),
   * or set `daily_send_limit` to 1–10,000 recipients per rolling 24h. The limit
   * field requires the opt-in `mailbox:quota` scope.
   * Returns the updated inbox record.
   */
  update(req: UpdateInboxRequest, signal?: AbortSignal): Promise<Inbox> {
    return this.transport.updateInbox(this.ref, req, signal);
  }

  /**
   * Send an email from this authenticated inbox. Starts a new thread.
   *
   * Returns a three-way {@link SendOutcome}: `kind:"queued_for_review"` means a
   * human has to approve it and NOTHING has been delivered yet; anything else was
   * delivered. Under the default `require_review` policy a call WITHOUT an
   * `intent` raises `IntentRequiredError` (422) instead: nothing sent, nothing
   * queued: so pass one, or read `inbox.record.effective_review_policy` first.
   */
  send(req: SendRequest, signal?: AbortSignal): Promise<SendOutcome> {
    return this.transport.send(this.ref, req, signal);
  }

  /**
   * Reply within an existing thread. Select the parent with `thread_id` (reply to
   * the latest message) or `message_id` (reply to that message); the server
   * derives To / Subject / In-Reply-To / References. Set `reply_all` to reply to
   * every thread recipient. Returns the same three-way {@link SendOutcome} as
   * {@link send}: a reply is governed by the review policy too.
   */
  reply(req: ReplyRequest, signal?: AbortSignal): Promise<SendOutcome> {
    return this.transport.reply(this.ref, req, signal);
  }

  /**
   * Forward a message in this inbox to new recipients, preserving the original.
   *
   * A forward is an outbound message to arbitrary NEW recipients that quotes an
   * inbound thread, so it is governed by the review policy exactly like a send :
   * same {@link SendOutcome} union, same `intent` requirement.
   */
  forward(messageId: string, req: ForwardRequest, signal?: AbortSignal): Promise<SendOutcome> {
    return this.transport.forward(this.ref, messageId, req, signal);
  }

  /**
   * Submit a new message from this inbox for human review (Review Loop, HITL).
   * Pass `intent` (required when the resolved mode is review) and optionally
   * `mode`/`category_id`. The account/inbox review policy decides whether the
   * message is queued for review (`kind:"queued_for_review"`) or sent on a
   * policy-permitted direct path (`kind:"sent"`). Monitor it via
   * `extrovert.reviews`.
   */
  submitForReview(req: SendRequest, signal?: AbortSignal): Promise<SendOutcome> {
    return this.transport.submitForReview(this.ref, req, signal);
  }

  /**
   * Submit an in-thread reply from this inbox for human review (Review Loop).
   * Same routing/return contract as {@link submitForReview}.
   */
  submitReplyForReview(req: ReplyRequest, signal?: AbortSignal): Promise<SendOutcome> {
    return this.transport.submitReplyForReview(this.ref, req, signal);
  }

  /**
   * List messages in this inbox, newest first. Narrow with exact-field filters
   * (from/to/subject substring) or `unread: true` (native \Seen); page with
   * limit + offset.
   */
  messages(params: ListMessagesParams = {}, signal?: AbortSignal): Promise<Page<Message>> {
    return this.transport.listMessages(this.ref, params, signal);
  }

  /** Full-text search this inbox (IMAP SEARCH over from/subject/body). */
  search(params: SearchMessagesParams, signal?: AbortSignal): Promise<Page<Message>> {
    return this.transport.searchMessages(this.ref, params, signal);
  }

  /** Download the raw RFC822 `.eml` bytes for a message in this inbox. */
  messageRaw(messageId: string, signal?: AbortSignal): Promise<string> {
    return this.transport.getMessageRaw(this.ref, messageId, signal);
  }

  /** Mark a message in this inbox read/unread via the native \Seen flag. */
  markRead(messageId: string, req: MarkReadRequest, signal?: AbortSignal): Promise<Message> {
    return this.transport.markRead(this.ref, messageId, req, signal);
  }

  /**
   * Delete a message in this inbox: move it to Trash (default, recoverable) or
   * permanently remove it when `expunge` is true.
   */
  deleteMessage(messageId: string, expunge?: boolean, signal?: AbortSignal): Promise<DeleteResult> {
    return this.transport.deleteMessage(this.ref, messageId, expunge, signal);
  }

  /**
   * Batch mark read/unread and/or move folder for a list of message ids in this
   * inbox. At least one of `read` / `folder` must be set; returns the per-id
   * `{updated, failed}` split.
   */
  batchUpdateMessages(req: BatchUpdateMessagesRequest, signal?: AbortSignal): Promise<BatchUpdateResult> {
    return this.transport.batchUpdateMessages(this.ref, req, signal);
  }

  /** List a message's attachment metadata ({id, filename, content_type, size}). */
  attachments(messageId: string, signal?: AbortSignal): Promise<Page<Attachment>> {
    return this.transport.listAttachments(this.ref, messageId, signal);
  }

  /** Download one attachment's bytes (base64) plus filename and content type. */
  attachment(
    messageId: string,
    attachmentId: string,
    signal?: AbortSignal,
  ): Promise<AttachmentDownload> {
    return this.transport.getAttachment(this.ref, messageId, attachmentId, signal);
  }

  /** List conversation threads in this inbox, newest-active first. */
  threads(params: ListThreadsParams = {}, signal?: AbortSignal): Promise<Page<Thread>> {
    return this.transport.listThreads(this.ref, params, signal);
  }

  /** Thread-level search in this inbox (subject / snippet / participants). */
  searchThreads(params: SearchMessagesParams, signal?: AbortSignal): Promise<Page<Thread>> {
    return this.transport.searchThreads(this.ref, params, signal);
  }

  /** Fetch one thread (with its messages) in this inbox by stable id. */
  thread(threadId: string, signal?: AbortSignal): Promise<ThreadDetail> {
    return this.transport.getThread(this.ref, threadId, signal);
  }

  /**
   * Delete an entire thread in this inbox (every message): move to Trash
   * (default) or permanently remove when `expunge` is true.
   */
  deleteThread(threadId: string, expunge?: boolean, signal?: AbortSignal): Promise<DeleteResult> {
    return this.transport.deleteThread(this.ref, threadId, expunge, signal);
  }

  /**
   * Poll server-side until a matching message arrives and return it with an extracted
   * OTP / verification link. The HTTP read timeout is set a hair above the server-side
   * `timeoutSeconds` so the request doesn't abort before the server returns its own timeout result.
   */
  waitForEmail(req: WaitForEmailRequest = {}, signal?: AbortSignal): Promise<WaitForEmailResult> {
    const serverTimeoutSeconds = req.timeout_seconds ?? 300;
    // Give the HTTP read a 5s margin over the server's blocking window, and never read for less
    // than the client's configured default timeout.
    const readTimeoutMs = Math.max(
      serverTimeoutSeconds * 1000 + 5000,
      this.options.defaultWaitTimeoutMs,
    );
    return this.transport.waitForEmail(this.ref, req, readTimeoutMs, signal);
  }

  /** Register an HMAC-signed inbound webhook scoped to this inbox. */
  registerWebhook(
    req: Omit<RegisterWebhookRequest, "inbox">,
    signal?: AbortSignal,
  ): Promise<Webhook> {
    return this.transport.registerWebhook({ ...req, inbox: this.address }, signal);
  }

  /**
   * Add an allow/block contact-list entry to this inbox. A `block` entry rejects a
   * send to a matching recipient; once any `allow` entry exists, sends from this
   * inbox are restricted to recipients that match one (allowlist mode).
   */
  addContactListEntry(req: AddContactListRequest, signal?: AbortSignal): Promise<ContactListEntry> {
    return this.transport.addContactListEntry(this.ref, req, signal);
  }

  /** List the allow/block contact-list entries governing this inbox. */
  listContactLists(signal?: AbortSignal): Promise<Page<ContactListEntry>> {
    return this.transport.listContactLists(this.ref, signal);
  }

  /** Delete a contact-list entry on this inbox by id. */
  deleteContactListEntry(entryId: string, signal?: AbortSignal): Promise<void> {
    return this.transport.deleteContactListEntry(this.ref, entryId, signal);
  }

  /**
   * Watch this inbox live (Server-Sent Events). Returns an async iterator of
   * {@link StreamEvent}; each `message.received` event arrives as it lands instead
   * of polling {@link waitForEmail}. Pass `lastEventId` (the `seq` of the last
   * event you saw) to resume without gaps after a reconnect, and a `signal` to
   * close the stream.
   *
   * ```ts
   * for await (const ev of inbox.stream()) {
   *   if (ev.event === "message.received") console.log("new mail:", ev.message?.subject);
   * }
   * ```
   */
  stream(options: StreamOptions = {}): AsyncGenerator<StreamEvent, void, unknown> {
    return this.transport.stream(this.ref, options.lastEventId, options.signal);
  }

  /**
   * Convenience wrapper over {@link stream}: invoke `onEvent` for every event until
   * the stream closes (or `signal` aborts). Returns when the stream ends.
   */
  async subscribe(
    onEvent: (event: StreamEvent) => void | Promise<void>,
    options: StreamOptions = {},
  ): Promise<void> {
    for await (const ev of this.stream(options)) {
      await onEvent(ev);
    }
  }

  /**
   * Permanently tear down this inbox and its messages/sender identity. Requires
   * `mailbox:delete`; this operation cannot be undone.
   */
  delete(signal?: AbortSignal): Promise<void> {
    return this.transport.deleteInbox(this.ref, signal);
  }
}
