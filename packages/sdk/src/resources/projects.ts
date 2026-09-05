/**
 * `extrovert.projects`: the CANONICAL project-scoped resource chain (redesign §4).
 *
 * Scope lives in the KEY; a broad (org-tier) key narrows to one project by PATH.
 * The headline chain is `x.projects.inboxes.*`, mirroring
 * `/v1/projects/{project_id}/inboxes[/{inbox_id}]`:
 *
 * ```ts
 * const inbox = await x.projects.inboxes.create("proj_9k", { username: "ada" });
 * const page  = await x.projects.inboxes.list("proj_9k");        // List envelope
 * for await (const i of page) console.log(i.id);                 // auto-paginates
 * await x.projects.inboxes.send("proj_9k", inbox.id, { to, subject, text });
 * ```
 *
 * Operations are keyed by the OPAQUE `inbox_id` (the inbox's email address is also
 * accepted as a within-project alias). `projectId` may be `"-"` for the org-wide
 * wildcard: only an org-tier key may use it (others get 403 `forbidden_scope`).
 *
 * The bare `x.inboxes.*` / `x.inbox(address)` surface is curl-style sugar that
 * resolves to the key's default project; this chain is the contract-canonical one.
 */

import type { Transport, AttachmentDownload } from "../transport.js";
import { ValidationError } from "../errors.js";
import { ListPage } from "../pagination.js";
import type {
  Attachment,
  BatchUpdateMessagesRequest,
  BatchUpdateResult,
  CreateInboxRequest,
  DeleteResult,
  ForwardRequest,
  GetInboxParams,
  Inbox,
  InboxCredentials,
  ListMessagesParams,
  ListThreadsParams,
  MarkReadRequest,
  Message,
  Page,
  ProjectInboxListParams,
  ReplyRequest,
  SearchMessagesParams,
  SendOutcome,
  SendRequest,
  Thread,
  ThreadDetail,
  Submission,
  UpdateInboxRequest,
  WaitForEmailRequest,
  WaitForEmailResult,
} from "../models.js";
import type { InboxHandleOptions } from "./inbox-handle.js";

/** Options forwarded into the chain (per-call wait timeout, resolved from the client). */
interface ProjectsContext {
  transport: Transport;
  handleOptions: InboxHandleOptions;
}

/**
 * `x.projects.inboxes`: create / list / get / update / delete inboxes, plus the
 * send / reply / message / thread / wait operations, all scoped to one project (or
 * the `-` org wildcard for an org-tier key). List returns a {@link ListPage} that
 * auto-paginates over the opaque-cursor {@link import("../pagination.js").List} envelope.
 */
export class ProjectInboxes {
  constructor(private readonly ctx: ProjectsContext) {}

  /** Create an inbox in `projectId`. `idempotencyKey` (or `req.client_id`) makes it exactly-once. */
  create(
    projectId: string,
    req: CreateInboxRequest = {},
    idempotencyKey?: string,
    signal?: AbortSignal,
  ): Promise<Inbox> {
    return this.ctx.transport.createInboxInProject(
      projectId,
      req,
      idempotencyKey ?? req.client_id,
      signal,
    );
  }

  /**
   * List inboxes in `projectId` (or the org subtree with `projectId="-"`). Returns a
   * {@link ListPage} that yields the {@link import("../pagination.js").List} envelope's
   * rows and auto-paginates across pages via the opaque cursor.
   */
  async list(
    projectId: string,
    params: ProjectInboxListParams = {},
    signal?: AbortSignal,
  ): Promise<ListPage<Inbox>> {
    const fetcher = (cursor: string | undefined, s?: AbortSignal) =>
      this.ctx.transport.listInboxesInProject(projectId, { ...params, cursor }, s);
    const first = await fetcher(params.cursor, signal);
    return new ListPage(first, fetcher);
  }

  /** Get an inbox by opaque `inboxId` (or address alias) in `projectId`. */
  get(
    projectId: string,
    inboxId: string,
    params: GetInboxParams = {},
    signal?: AbortSignal,
  ): Promise<Inbox> {
    return this.ctx.transport.getInboxInProject(projectId, inboxId, params, signal);
  }

  /**
   * Update an inbox in place (display name / webhook / metadata / daily send
   * limit). `daily_send_limit` requires the opt-in `mailbox:quota` scope.
   */
  update(
    projectId: string,
    inboxId: string,
    req: UpdateInboxRequest,
    signal?: AbortSignal,
  ): Promise<Inbox> {
    return this.ctx.transport.updateInboxInProject(projectId, inboxId, req, signal);
  }

  /**
   * Permanently delete an inbox by opaque id (or address alias). Requires
   * `mailbox:delete`; the inbox and its messages cannot be recovered.
   */
  delete(projectId: string, inboxId: string, signal?: AbortSignal): Promise<void> {
    return this.ctx.transport.deleteInboxInProject(projectId, inboxId, signal);
  }

  /** Fetch IMAP/SMTP connection settings + login for an inbox. */
  credentials(projectId: string, inboxId: string, signal?: AbortSignal): Promise<InboxCredentials> {
    return this.ctx.transport.getInboxCredentialsInProject(projectId, inboxId, signal);
  }

  /**
   * Send an email from an inbox in `projectId`.
   *
   * Returns a three-way {@link SendOutcome}: `kind:"queued_for_review"` means a
   * human has to approve it and NOTHING has been delivered yet; anything else was
   * delivered. Under the default `require_review` policy a call WITHOUT an
   * `intent` raises `IntentRequiredError` (422) instead: nothing sent, nothing
   * queued: so pass one, or read `inbox.record.effective_review_policy` first.
   */
  send(
    projectId: string,
    inboxId: string,
    req: SendRequest,
    signal?: AbortSignal,
  ): Promise<SendOutcome> {
    return this.ctx.transport.send(this.ref(projectId, inboxId), req, signal);
  }

  /** Reply within a thread from an inbox in `projectId`. See {@link send} on the return union. */
  reply(
    projectId: string,
    inboxId: string,
    req: ReplyRequest,
    signal?: AbortSignal,
  ): Promise<SendOutcome> {
    return this.ctx.transport.reply(this.ref(projectId, inboxId), req, signal);
  }

  /** Forward a message from an inbox in `projectId`. See {@link send} on the return union. */
  forward(
    projectId: string,
    inboxId: string,
    messageId: string,
    req: ForwardRequest,
    signal?: AbortSignal,
  ): Promise<SendOutcome> {
    return this.ctx.transport.forward(this.ref(projectId, inboxId), messageId, req, signal);
  }

  /** List messages in an inbox in `projectId`. */
  messages(
    projectId: string,
    inboxId: string,
    params: ListMessagesParams = {},
    signal?: AbortSignal,
  ): Promise<Page<Message>> {
    return this.ctx.transport.listMessages(this.ref(projectId, inboxId), params, signal);
  }

  /** Search messages in an inbox in `projectId`. */
  searchMessages(
    projectId: string,
    inboxId: string,
    params: SearchMessagesParams,
    signal?: AbortSignal,
  ): Promise<Page<Message>> {
    return this.ctx.transport.searchMessages(this.ref(projectId, inboxId), params, signal);
  }

  /** Mark a message read/unread in an inbox in `projectId`. */
  markRead(
    projectId: string,
    inboxId: string,
    messageId: string,
    req: MarkReadRequest,
    signal?: AbortSignal,
  ): Promise<Message> {
    return this.ctx.transport.markRead(this.ref(projectId, inboxId), messageId, req, signal);
  }

  /** Delete a message in an inbox in `projectId`. */
  deleteMessage(
    projectId: string,
    inboxId: string,
    messageId: string,
    expunge?: boolean,
    signal?: AbortSignal,
  ): Promise<DeleteResult> {
    return this.ctx.transport.deleteMessage(this.ref(projectId, inboxId), messageId, expunge, signal);
  }

  /** Batch mark/move messages in an inbox in `projectId`. */
  batchUpdateMessages(
    projectId: string,
    inboxId: string,
    req: BatchUpdateMessagesRequest,
    signal?: AbortSignal,
  ): Promise<BatchUpdateResult> {
    return this.ctx.transport.batchUpdateMessages(this.ref(projectId, inboxId), req, signal);
  }

  /** List a message's attachment metadata. */
  attachments(
    projectId: string,
    inboxId: string,
    messageId: string,
    signal?: AbortSignal,
  ): Promise<Page<Attachment>> {
    return this.ctx.transport.listAttachments(this.ref(projectId, inboxId), messageId, signal);
  }

  /** Download one attachment's bytes + filename + content type. */
  attachment(
    projectId: string,
    inboxId: string,
    messageId: string,
    attachmentId: string,
    signal?: AbortSignal,
  ): Promise<AttachmentDownload> {
    return this.ctx.transport.getAttachment(this.ref(projectId, inboxId), messageId, attachmentId, signal);
  }

  /** List conversation threads in an inbox in `projectId`. */
  threads(
    projectId: string,
    inboxId: string,
    params: ListThreadsParams = {},
    signal?: AbortSignal,
  ): Promise<Page<Thread>> {
    return this.ctx.transport.listThreads(this.ref(projectId, inboxId), params, signal);
  }

  /** Fetch one thread (+ its messages) in an inbox in `projectId`. */
  thread(
    projectId: string,
    inboxId: string,
    threadId: string,
    signal?: AbortSignal,
  ): Promise<ThreadDetail> {
    return this.ctx.transport.getThread(this.ref(projectId, inboxId), threadId, signal);
  }

  /** Read recipient transport and Sent-copy status for an accepted submission. */
  getSubmission(projectId: string, inboxId: string, submissionId: string, signal?: AbortSignal): Promise<Submission> {
    return this.ctx.transport.getSubmissionInProject(projectId, inboxId, submissionId, signal);
  }

  /**
   * Block until a matching message arrives in an inbox in `projectId` and return it
   * with an extracted OTP / verification link.
   */
  waitForEmail(
    projectId: string,
    inboxId: string,
    req: WaitForEmailRequest = {},
    signal?: AbortSignal,
  ): Promise<WaitForEmailResult> {
    const serverTimeoutSeconds = req.timeout_seconds ?? 300;
    const readTimeoutMs = Math.max(
      serverTimeoutSeconds * 1000 + 5000,
      this.ctx.handleOptions.defaultWaitTimeoutMs,
    );
    return this.ctx.transport.waitForEmail(this.ref(projectId, inboxId), req, readTimeoutMs, signal);
  }

  /**
   * The inbox reference the message/send/thread transport methods key on.
   *
   * The frozen contract project-prefixes ONLY the inbox collection/item/credentials
   * routes (`/v1/projects/{project_id}/inboxes[/{inbox_id}][/credentials]`); the
   * send/reply/forward/message/thread/wait sub-ops have NO project-prefixed path :
   * they address the inbox by its opaque id directly (`/v1/inboxes/{inbox_id}/…`),
   * where the project is implicit in (and enforced by) the inbox id server-side.
   *
   * So for these sub-ops `projectId` cannot be carried on the URL and is NOT a URL
   * selector. The adversarial review flagged that silently discarding it makes the
   * signature misleading. CHOICE: keep the arg (dropping it would break the chain's
   * symmetry with create/list/get/update/delete: the more disruptive option) but
   * VALIDATE it rather than ignore it. We reject the two client mistakes we can catch
   * without a round-trip:
   *   - a blank / whitespace-only `projectId` (a required selector everywhere else in
   *     the chain), and
   *   - the org wildcard `-`, which is meaningless for a single-inbox op (there is no
   *     breadth to pick).
   * The inbox-id ↔ project binding itself is enforced server-side by the opaque id.
   */
  private ref(projectId: string, inboxId: string): string {
    if (projectId.trim() === "") {
      throw new ValidationError({
        status: 400,
        code: "bad_request",
        message:
          "projectId is required for the x.projects.inboxes sub-operations. Pass the concrete " +
          "project id (or use the bare x.inboxes / x.inbox(id) surface for the key's default project).",
      });
    }
    if (projectId === "-") {
      throw new ValidationError({
        status: 400,
        code: "bad_request",
        message:
          "The org wildcard \"-\" is only valid for list/create breadth, not a single-inbox " +
          "operation. Pass the concrete project id (or use the bare x.inboxes / x.inbox(id) surface).",
      });
    }
    return inboxId;
  }
}

/**
 * `extrovert.projects`: the canonical project-scoped resource namespace. Today it
 * exposes the `inboxes` chain (`x.projects.inboxes.*`); future project-scoped
 * resources (domains, agents) hang off the same namespace.
 */
export class Projects {
  /** `x.projects.inboxes.*`: the canonical inbox chain. */
  readonly inboxes: ProjectInboxes;

  constructor(ctx: ProjectsContext) {
    this.inboxes = new ProjectInboxes(ctx);
  }
}
