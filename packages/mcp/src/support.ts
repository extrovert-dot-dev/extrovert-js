export interface SupportRuntime {
  source: string;
  package_version?: string;
  profile?: string;
  profile_version?: string;
  build?: string;
  transport?: string;
  catalog_digest?: string;
  instance_id?: string;
  observed_ms: number;
  request_id: string;
}
/** support:submit (included in new presets) files and follows own feedback/cases.
 * Explicit support:read / support:write grants cover other records within the
 * credential's authorized project or organization and resource ceilings.
 * Custom credential scopes replace defaults; omit support scopes to opt out.
 */
/** Structured customer evidence. Never pass tool transcripts, mail bodies or credentials. */
export interface FeedbackInput {
  client_id?: string;
  submission_mode: "explicit" | "automatic";
  category:
    | "unexpected_error"
    | "incorrect_result"
    | "missing_capability"
    | "confusing_behavior"
    | "other";
  user_intent: string;
  expected_behavior?: string;
  observed_behavior: string;
  outcome: "blocked" | "completed_with_workaround" | "observation";
  attempts?: {
    operation: string;
    http_status?: number;
    error_code?: string;
    summary?: string;
  }[];
  resource_refs?: {
    type: "inbox" | "review" | "submission" | "thread" | "domain";
    id: string;
  }[];
  client_versions?: {
    mcp?: string;
    sdk?: string;
    host?: string;
    skill?: string;
    runtime?: string;
    os?: string;
  };
}
export interface Feedback {
  id: string;
  project_id: string;
  org_id?: string;
  observed_runtime?: SupportRuntime;
  linked_cases?: {
    id: string;
    project_id: string;
    status: string;
    version: number;
  }[];
  linked_cases_truncated?: boolean;
  diagnostics?: {
    type: string;
    id: string;
    state: string;
    observed_ms: number;
  }[];
  evidence: FeedbackInput;
  repeat_count: number;
  created_ms: number;
  updated_ms: number;
  api_build: string;
  redacted_fields: string[];
}
export interface SupportCaseInput {
  client_id?: string;
  title: string;
  description?: string;
  impact?: "blocked" | "workaround_available" | "recovered" | "unknown";
  feedback_id?: string;
  feedback?: FeedbackInput;
}
export interface SupportCase {
  id: string;
  number: string;
  project_id: string;
  title: string;
  status: "received" | "working" | "waiting_on_customer" | "resolved";
  impact: SupportCaseInput["impact"];
  version: number;
  created_ms: number;
  updated_ms: number;
  resolved_ms?: number;
  customer_confirmed_ms?: number;
  resolution_kind?: string;
  resolution_summary?: string;
  feedback_id: string;
  console_url?: string;
  latest_update?: SupportEvent & { truncated: boolean };
}
export interface SupportCaseReceipt extends SupportCase {
  console_url: string;
  notification_queued: boolean;
  next_action: "check_case_for_updates";
}
export interface SupportMutation {
  client_id?: string;
  expected_version?: number;
  body: string;
}
export interface SupportEvent {
  id: string;
  sequence: number;
  kind: string;
  actor_kind: "customer" | "staff";
  body: string;
  created_ms: number;
  observed_runtime?: SupportRuntime;
}
export interface SupportPage {
  limit?: number;
  cursor?: string;
  status?: string;
  search?: string;
  view?: "own_shared" | "all_accessible";
}
export interface SupportList<T> {
  object: "list";
  data: T[];
  has_more: boolean;
  next_cursor: string;
}
export interface SupportContext {
  capabilities: {
    report_and_follow: boolean;
    read_other_reports: boolean;
    manage_other_cases: boolean;
  };
  default_project: { id: string; org_id: string; name: string } | null;
  projects: SupportList<{ id: string; org_id: string; name: string }>;
}
export interface SupportSettings {
  settings: {
    automatic_feedback: boolean;
    version: number;
    updated_ms: number;
  };
  submission_policy: "explicit_only" | "explicit_or_opted_in_automatic";
  feedback_enabled: boolean;
  cases_enabled: boolean;
}
export interface SupportRequest {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  signal?: AbortSignal;
}
export type SupportRequester = <T>(request: SupportRequest) => Promise<T>;
function path(
  project: string | undefined,
  suffix: string,
  write = false,
): string {
  if (write && project === "-")
    throw new Error(
      "Choose a concrete project or omit project_id; - is not a write destination.",
    );
  return project
    ? `/v1/projects/${encodeURIComponent(project)}/${suffix}`
    : `/v1/${suffix}`;
}
/** Retain this request and its generated IDs when the outcome is uncertain. A
 * separate invocation is a new operation; check existing reports before creating again. */
export class SupportRequestError extends Error {
  constructor(
    readonly recovery_request: SupportRequest,
    override readonly cause: unknown,
  ) {
    super(
      `${cause instanceof Error ? cause.message : "Support request did not complete"}. Retain recovery_request and check existing reports before another create.`,
    );
    this.name = "SupportRequestError";
  }
}
function prepare<T extends { client_id?: string }>(
  input: T,
): T & { client_id: string } {
  return {
    ...structuredClone(input),
    client_id: input.client_id ?? crypto.randomUUID(),
  };
}
async function write<T>(
  request: SupportRequester,
  r: SupportRequest,
): Promise<T> {
  try {
    return await request<T>(r);
  } catch (error) {
    throw new SupportRequestError(r, error);
  }
}
type CreateArgs<T> =
  | [input: T, signal?: AbortSignal]
  | [project: string | undefined, input: T, signal?: AbortSignal];
function creation<T>(
  args: CreateArgs<T>,
): [string | undefined, T, AbortSignal | undefined] {
  return typeof args[0] === "string" || args[0] === undefined
    ? (args as [string | undefined, T, AbortSignal | undefined])
    : [undefined, args[0] as T, args[1] as AbortSignal | undefined];
}
type ReadArgs =
  | [id: string, signal?: AbortSignal]
  | [project: string | undefined, id: string, signal?: AbortSignal];
function reading(
  args: ReadArgs,
): [string | undefined, string, AbortSignal | undefined] {
  return typeof args[1] === "string"
    ? (args as [string | undefined, string, AbortSignal | undefined])
    : [undefined, args[0]!, args[1] as AbortSignal | undefined];
}
type ListArgs =
  | [page?: SupportPage, signal?: AbortSignal]
  | [project: string | undefined, page?: SupportPage, signal?: AbortSignal];
function listing(
  args: ListArgs,
): [string | undefined, SupportPage, AbortSignal | undefined] {
  return typeof args[0] === "string" ||
    (args[0] === undefined &&
      args.length > 1 &&
      !(args[1] instanceof AbortSignal))
    ? [args[0] as string | undefined, (args[1] as SupportPage) ?? {}, args[2]]
    : [
        undefined,
        (args[0] as SupportPage) ?? {},
        args[1] as AbortSignal | undefined,
      ];
}
export class FeedbackResource {
  constructor(private readonly request: SupportRequester) {}
  submit(...args: CreateArgs<FeedbackInput>): Promise<Feedback> {
    const [project, input, signal] = creation(args);
    return write(this.request, {
      method: "POST",
      path: path(project, "feedback", true),
      body: prepare(input),
      signal,
    });
  }
  list(...args: ListArgs): Promise<SupportList<Feedback>> {
    const [project, page, signal] = listing(args);
    return this.request({
      method: "GET",
      path: path(project, "feedback"),
      query: { ...page },
      signal,
    });
  }
  get(...args: ReadArgs): Promise<Feedback> {
    const [project, id, signal] = reading(args);
    return this.request({
      method: "GET",
      path: path(project, `feedback/${encodeURIComponent(id)}`),
      signal,
    });
  }
}
type MutationArgs =
  | [id: string, input: SupportMutation, signal?: AbortSignal]
  | [
      project: string | undefined,
      id: string,
      input: SupportMutation,
      signal?: AbortSignal,
    ];
export class SupportCasesResource {
  constructor(private readonly request: SupportRequester) {}
  create(...args: CreateArgs<SupportCaseInput>): Promise<SupportCaseReceipt> {
    const [project, input, signal] = creation(args);
    const body = prepare(input);
    if (body.feedback) body.feedback = prepare(body.feedback);
    return write(this.request, {
      method: "POST",
      path: path(project, "support-cases", true),
      body,
      signal,
    });
  }
  list(...args: ListArgs): Promise<SupportList<SupportCase>> {
    const [project, page, signal] = listing(args);
    return this.request({
      method: "GET",
      path: path(project, "support-cases"),
      query: { ...page },
      signal,
    });
  }
  get(...args: ReadArgs): Promise<SupportCase> {
    const [project, id, signal] = reading(args);
    return this.request({
      method: "GET",
      path: path(project, `support-cases/${encodeURIComponent(id)}`),
      signal,
    });
  }
  events(
    ...args:
      | [id: string, page?: SupportPage, signal?: AbortSignal]
      | [
          project: string | undefined,
          id: string,
          page?: SupportPage,
          signal?: AbortSignal,
        ]
  ): Promise<SupportList<SupportEvent>> {
    const [project, id, page, signal] =
      typeof args[1] === "string"
        ? (args as [
            string | undefined,
            string,
            SupportPage | undefined,
            AbortSignal | undefined,
          ])
        : [
            undefined,
            args[0]!,
            args[1] as SupportPage | undefined,
            args[2] as AbortSignal | undefined,
          ];
    return this.request({
      method: "GET",
      path: path(project, `support-cases/${encodeURIComponent(id)}/events`),
      query: { ...page },
      signal,
    });
  }
  reply(...args: MutationArgs): Promise<SupportCase> {
    return this.change("replies", args);
  }
  resolve(...args: MutationArgs): Promise<SupportCase> {
    return this.change("resolve", args);
  }
  reopen(...args: MutationArgs): Promise<SupportCase> {
    return this.change("reopen", args);
  }
  private change(operation: string, args: MutationArgs): Promise<SupportCase> {
    const [project, id, input, signal] =
      typeof args[1] === "string"
        ? (args as [
            string | undefined,
            string,
            SupportMutation,
            AbortSignal | undefined,
          ])
        : [
            undefined,
            args[0]!,
            args[1] as SupportMutation,
            args[2] as AbortSignal | undefined,
          ];
    if (
      operation !== "replies" &&
      (!input.expected_version || input.expected_version < 1)
    )
      throw new Error(
        "expected_version from the current case is required to resolve or reopen.",
      );
    return write(this.request, {
      method: "POST",
      path: path(
        project,
        `support-cases/${encodeURIComponent(id)}/${operation}`,
        true,
      ),
      body: prepare(input),
      signal,
    });
  }
}
export class SupportResource {
  readonly cases: SupportCasesResource;
  constructor(private readonly request: SupportRequester) {
    this.cases = new SupportCasesResource(request);
  }
  context(
    page: SupportPage = {},
    signal?: AbortSignal,
  ): Promise<SupportContext> {
    return this.request({
      method: "GET",
      path: "/v1/support-context",
      query: { ...page },
      signal,
    });
  }
  settings(project?: string, signal?: AbortSignal): Promise<SupportSettings> {
    return this.request({
      method: "GET",
      path: path(project, "support-settings"),
      signal,
    });
  }
}
