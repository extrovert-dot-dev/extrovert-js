/**
 * ExtrovertClient - the entry point.
 *
 * ```ts
 * import { Extrovert } from "@extrovert.dev/sdk";
 * const extrovert = new Extrovert({ apiKey: process.env.EXTROVERT_API_KEY! });
 * const inbox = await extrovert.inboxes.create();        // a real inbox, in one call
 * const outcome = await inbox.send({
 *   to: "ops@acme.test",
 *   subject: "hi",
 *   text: "from an agent",
 *   intent: { summary: "send the requested status update" },
 * });
 * if (outcome.kind === "queued_for_review") console.log(outcome.review.id);
 * ```
 */

import { HttpClient, type HttpClientConfig, type RetryOptions } from "./http.js";
import { HttpTransport, MockTransport, type Transport } from "./transport.js";
import { MockBackend } from "./fixtures.js";
import { Inboxes, Messages, Threads, Submissions, Webhooks, ContactLists, Suppressions, Domains, Commerce, Reviews, Categories, Rules, Projects, InboxHandle } from "./resources/index.js";
import type { InboxHandleOptions } from "./resources/inbox-handle.js";
import { CURRENT_API_VERSION } from "./version.js";
import { parseKeyTier, type KeyTier } from "./key-tier.js";
import type {
  CreateInboxRequest,
  EnrollRequest,
  EnrollResponse,
  Job,
  SignUpRequest,
  SignUpResponse,
  StreamEvent,
  StreamOptions,
  VerifyRequest,
  VerifyResponse,
  WhoAmI,
} from "./models.js";

/** Default production API base URL. Overridable via `baseUrl` or `EXTROVERT_API_BASE_URL`. */
export const DEFAULT_BASE_URL = "https://api.extrovert.dev";

/** The sentinel that routes the client to the offline mock instead of the network. */
export const MOCK_BASE_URL = "mock";

export interface ExtrovertClientOptions {
  /**
   * Scoped agent key (`pk_agent_...`) or, for `enroll`, any bearer credential the server accepts.
   * Falls back to `EXTROVERT_API_KEY` when omitted.
   */
  apiKey?: string;
  /**
   * API base URL. Falls back to `EXTROVERT_API_BASE_URL`, then {@link DEFAULT_BASE_URL}. Set to
   * `"mock"` (or `transport: "mock"`) to run fully offline against the built-in fixtures.
   */
  baseUrl?: string;
  /** Force a transport. `"mock"` ignores `baseUrl` and never touches the network. */
  transport?: "http" | "mock";
  /** Default request timeout in ms. Default 30000. (wait_for_email manages its own, longer timeout.) */
  timeoutMs?: number;
  /** Retry policy for idempotent requests on 429/5xx/network errors. */
  retry?: Partial<RetryOptions>;
  /** Custom fetch implementation (tests, proxies, instrumentation). Defaults to global `fetch`. */
  fetch?: typeof fetch;
  /** Extra headers merged into every request. */
  defaultHeaders?: Record<string, string>;
  /**
   * Dated API version to pin (sent as the `Extrovert-Version` header on every
   * request; redesign §5.4). Defaults to {@link CURRENT_API_VERSION}. Pin an older
   * dated version to opt into the server's transform shim for that version.
   */
  apiVersion?: string;
  /** Inject a pre-built mock backend (shares state across clients in tests). */
  mockBackend?: MockBackend;
}

function readEnv(name: string): string | undefined {
  // Guarded so the SDK works in edge runtimes where `process` is undefined.
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  return env?.[name];
}

const DEFAULT_RETRY: RetryOptions = { maxRetries: 2, baseDelayMs: 250, maxDelayMs: 8000 };

export class ExtrovertClient {
  /** `extrovert.inboxes` - create / list / get / update / delete inboxes. */
  readonly inboxes: Inboxes;
  /** `extrovert.messages` - read a message, reply to it (threaded). */
  readonly messages: Messages;
  /** `extrovert.threads` - fetch a conversation thread. */
  readonly threads: Threads;
  readonly submissions: Submissions;
  /** `extrovert.webhooks` - register HMAC-signed inbound webhooks. */
  readonly webhooks: Webhooks;
  /** `extrovert.contactLists` - per-inbox allow/block lists of addresses/domains. */
  readonly contactLists: ContactLists;
  /** `extrovert.suppressions` - recipient opt-outs (list-unsubscribe); precheck/list/revoke. */
  readonly suppressions: Suppressions;
  /** `extrovert.domains` - domain readiness and setup (domain:read or domain:manage to read; domain:manage to change). */
  readonly domains: Domains;
  /** `extrovert.commerce` - quote/request/cancel/poll financial actions; no agent approval methods. */
  readonly commerce: Commerce;
  /** `extrovert.reviews` - the Review Loop (HITL) agent-plane reads. */
  readonly reviews: Reviews;
  /** `extrovert.categories` - the Review Loop category registry (browse/propose/curate). */
  readonly categories: Categories;
  /** `extrovert.rules` - the Review Loop writing-rule store + house-style + audit/undo. */
  readonly rules: Rules;
  /**
   * `extrovert.projects` - the CANONICAL project-scoped chain. The headline is
   * `extrovert.projects.inboxes.*` (create/list/get/update/delete/send/...), keyed by
   * the opaque `inbox_id` and scoped to a `{project_id}` path (or `-` for the org
   * wildcard on an org-tier key). The bare `extrovert.inboxes` surface is curl sugar
   * that resolves to the key's default project.
   */
  readonly projects: Projects;

  /** The resolved API base URL (or `"mock"`). */
  readonly baseUrl: string;
  /**
   * The dated API version pinned on every request (`Extrovert-Version`). Defaults to
   * {@link CURRENT_API_VERSION}.
   */
  readonly apiVersion: string;
  /**
   * The CEILING tier derived from the configured agent key prefix (`org` | `project`
   * | `inbox` | `unknown`). Advisory client-side hint only - the server is the source
   * of truth. Lets an app branch (e.g. require a project pick for an org-tier key).
   */
  readonly keyTier: KeyTier;

  private readonly transport: Transport;
  private readonly handleOptions: InboxHandleOptions;

  constructor(options: ExtrovertClientOptions = {}) {
    const apiKey = options.apiKey ?? readEnv("EXTROVERT_API_KEY") ?? "";
    const resolvedBaseUrl =
      options.baseUrl ?? readEnv("EXTROVERT_API_BASE_URL") ?? DEFAULT_BASE_URL;
    const useMock =
      options.transport === "mock" || resolvedBaseUrl === MOCK_BASE_URL;

    this.baseUrl = useMock ? MOCK_BASE_URL : resolvedBaseUrl;
    this.apiVersion = options.apiVersion ?? CURRENT_API_VERSION;
    this.keyTier = parseKeyTier(apiKey);
    const timeoutMs = options.timeoutMs ?? 30_000;
    this.handleOptions = { defaultWaitTimeoutMs: timeoutMs };

    if (useMock) {
      this.transport = new MockTransport(options.mockBackend);
    } else {
      if (!apiKey) {
        throw new Error(
          "Extrovert: no apiKey provided. Pass { apiKey } or set EXTROVERT_API_KEY (or use transport: \"mock\").",
        );
      }
      const fetchImpl = options.fetch ?? globalThis.fetch;
      if (typeof fetchImpl !== "function") {
        throw new Error(
          "Extrovert: global fetch is unavailable. Use Node 18+, an edge runtime, or pass a custom { fetch }.",
        );
      }
      const config: HttpClientConfig = {
        baseUrl: resolvedBaseUrl,
        apiKey,
        timeoutMs,
        retry: { ...DEFAULT_RETRY, ...options.retry },
        fetch: fetchImpl,
        defaultHeaders: options.defaultHeaders ?? {},
        apiVersion: this.apiVersion,
      };
      this.transport = new HttpTransport(new HttpClient(config));
    }

    const ctx = { transport: this.transport, handleOptions: this.handleOptions, keyTier: this.keyTier };
    this.inboxes = new Inboxes(ctx);
    this.messages = new Messages(ctx);
    this.threads = new Threads(ctx);
    this.submissions = new Submissions(ctx);
    this.webhooks = new Webhooks(ctx);
    this.contactLists = new ContactLists(ctx);
    this.suppressions = new Suppressions(ctx);
    this.domains = new Domains(ctx);
    this.commerce = new Commerce(ctx);
    this.reviews = new Reviews(ctx);
    this.categories = new Categories(ctx);
    this.rules = new Rules(ctx);
    this.projects = new Projects(ctx);
  }

  /**
   * Redeem an enrollment token (`pk_enroll_...`) and issue a scoped agent key.
   *
   * Idempotent on `agent_handle`: redeeming twice with the same handle returns the same agent.
   * Returns the raw `EnrollResponse` - to immediately use the issued key, prefer
   * {@link ExtrovertClient.enrolled}.
   */
  enroll(req: EnrollRequest, signal?: AbortSignal): Promise<EnrollResponse> {
    return this.transport.enroll(req, signal);
  }

  /**
   * Request a free account in one unauthenticated call. When free signup is
   * enabled, this provisions a tenant plus a first inbox and returns a
   * verification-only agent key. That key can only call {@link verify}; it cannot
   * read or send mail. A one-time code is emailed to `human_email`. Call
   * {@link verify} with the code to activate the account and receive full scopes.
   * Idempotent on `human_email`: re-calling rotates the key and resends the code.
   * When free signup is paused, this throws an `ApiError` with status 403 and
   * code `signup_disabled` without creating account state.
   */
  signUp(req: SignUpRequest, signal?: AbortSignal): Promise<SignUpResponse> {
    return this.transport.signUp(req, signal);
  }

  /**
   * Confirm the emailed signup code and receive a NEW full-scope agent key (shown
   * once). Must be called with the limited key from {@link signUp} as the bearer.
   * The result repeats the ready inbox address and includes MCP-first list/read/wait
   * calls; SDK callers can pass `address` directly to `inboxes` and `messages`.
   * Pending verification is also fail-closed with 403 `signup_disabled` while
   * free signup is paused.
   */
  verify(req: VerifyRequest, signal?: AbortSignal): Promise<VerifyResponse> {
    return this.transport.verify(req, signal);
  }

  /** Introspect the principal behind the current key (`GET /v1/auth/me`). */
  whoami(signal?: AbortSignal): Promise<WhoAmI> {
    return this.transport.whoami(signal);
  }

  /**
   * Poll the status of an async job (`GET /v1/jobs/{job_id}`) - currently only
   * the domain-offboard teardown started by {@link Domains.offboard} enqueues
   * one. `status` is terminal on succeeded/failed/cancelled; keep polling
   * otherwise. An unknown or foreign job id is a {@link NotFoundError}.
   */
  getJob(jobId: string, signal?: AbortSignal): Promise<Job> {
    return this.transport.getJob(jobId, signal);
  }

  /**
   * Redeem an enrollment token and return a *new* client already authenticated with the issued
   * agent key - the natural "redeem then act" flow for an agent.
   *
   * ```ts
   * const bootstrap = new Extrovert({ apiKey: enrollmentToken });
   * const { client, enrollment } = await bootstrap.enrolled({
   *   token: enrollmentToken,
   *   agent_handle: "support-bot",
   * });
   * const inbox = await client.inboxes.create();
   * ```
   */
  async enrolled(
    req: EnrollRequest,
    options?: Pick<ExtrovertClientOptions, "timeoutMs" | "retry" | "fetch" | "defaultHeaders">,
    signal?: AbortSignal,
  ): Promise<{ client: ExtrovertClient; enrollment: EnrollResponse }> {
    const enrollment = await this.enroll(req, signal);
    const client = new ExtrovertClient({
      apiKey: enrollment.agent_key,
      ...(this.baseUrl === MOCK_BASE_URL
        ? { transport: "mock", mockBackend: (this.transport as MockTransport).backend }
        : { baseUrl: this.baseUrl }),
      ...options,
    });
    return { client, enrollment };
  }

  /**
   * Get an ergonomic handle to an existing inbox by address - without an extra round-trip. Use this
   * when you already know the address (e.g. from a previous create) and want to send/wait/reply.
   * Call {@link InboxHandle.refresh} to load the full record.
   */
  inbox(address: string): InboxHandle {
    return new InboxHandle(this.transport, address, this.handleOptions);
  }

  /**
   * The headline shortcut: provision a real inbox in one call and get a handle bound to it.
   * Equivalent to `extrovert.inboxes.create(req)`, named to match the docs/marketing promise.
   */
  createInbox(req: CreateInboxRequest = {}, signal?: AbortSignal): Promise<InboxHandle> {
    return this.inboxes.create(req, signal);
  }

  /**
   * Watch events across EVERY inbox the agent owns (Server-Sent Events, `GET
   * /v1/events`). Returns an async iterator of {@link StreamEvent}; pass
   * `lastEventId` (the `seq` of the last event you saw) to resume after a reconnect
   * and a `signal` to close the stream. To watch a single inbox, use
   * {@link InboxHandle.stream} instead.
   *
   * ```ts
   * for await (const ev of extrovert.stream()) {
   *   if (ev.event === "message.received") console.log(ev.inbox, ev.message?.subject);
   * }
   * ```
   */
  stream(options: StreamOptions = {}): AsyncGenerator<StreamEvent, void, unknown> {
    return this.transport.stream(null, options.lastEventId, options.signal);
  }

  /**
   * Convenience wrapper over {@link stream}: invoke `onEvent` for every event
   * across all owned inboxes until the stream closes (or `signal` aborts).
   */
  async subscribe(
    onEvent: (event: StreamEvent) => void | Promise<void>,
    options: StreamOptions = {},
  ): Promise<void> {
    for await (const ev of this.stream(options)) {
      await onEvent(ev);
    }
  }
}
