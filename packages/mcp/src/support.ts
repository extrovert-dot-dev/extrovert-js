/** support:submit (included in new presets) files and follows own feedback/cases.
 * Explicit support:read / support:write grants cover other records within the
 * credential's authorized project or organization and resource ceilings.
 * Custom credential scopes replace defaults; omit support scopes to opt out.
 */
/** Structured customer evidence. Never pass tool transcripts, mail bodies or credentials. */
export interface FeedbackInput {
  client_id: string;
  submission_mode: "explicit" | "automatic";
  category: "unexpected_error" | "incorrect_result" | "missing_capability" | "confusing_behavior" | "other";
  user_intent: string;
  expected_behavior?: string;
  observed_behavior: string;
  outcome: "blocked" | "completed_with_workaround" | "observation";
  attempts?: { operation: string; http_status?: number; error_code?: string; summary?: string }[];
  resource_refs?: { type: "inbox" | "review" | "submission" | "thread" | "domain"; id: string }[];
  client_versions?: { mcp?: string; sdk?: string; host?: string; skill?: string; runtime?: string; os?: string };
}
export interface Feedback {
  id: string; project_id: string; diagnostics?: {type: string; id: string; state: string; observed_ms: number}[]; evidence: FeedbackInput; repeat_count: number;
  created_ms: number; updated_ms: number; api_build: string; redacted_fields: string[];
}
export interface SupportCaseInput {
  client_id: string; title: string; impact: "blocked" | "workaround_available" | "recovered" | "unknown";
  feedback_id?: string; feedback?: FeedbackInput;
}
export interface SupportCase {
  id: string; number: string; project_id: string; title: string;
  status: "received" | "working" | "waiting_on_customer" | "resolved";
  impact: SupportCaseInput["impact"]; version: number; created_ms: number; updated_ms: number;
  resolved_ms?: number; customer_confirmed_ms?: number; resolution_kind?: string;
  resolution_summary?: string; feedback_id: string;
}
export interface SupportCaseReceipt extends SupportCase { console_url: string; notification_queued: boolean; next_action: "check_case_for_updates" }
export interface SupportMutation { client_id: string; expected_version: number; body: string }
export interface SupportEvent { id: string; sequence: number; kind: string; actor_kind: "customer" | "staff"; body: string; created_ms: number }
export interface SupportPage { limit?: number; cursor?: string; status?: string; search?: string }
export interface SupportList<T> { object: "list"; data: T[]; has_more: boolean; next_cursor: string }
export interface SupportSettings {
  settings: { automatic_feedback: boolean; version: number; updated_ms: number };
  submission_policy: "explicit_only" | "explicit_or_opted_in_automatic";
  feedback_enabled: boolean; cases_enabled: boolean;
}
export interface SupportRequest { method: "GET" | "POST"; path: string; body?: unknown; query?: Record<string, string | number | undefined>; signal?: AbortSignal }
export type SupportRequester = <T>(request: SupportRequest) => Promise<T>;
function path(project: string, suffix: string, write = false): string {
  if (!project || (write && project === "-")) throw new Error("Choose a concrete project for support writes.");
  return `/v1/projects/${encodeURIComponent(project)}/${suffix}`;
}
export class FeedbackResource {
  constructor(private readonly request: SupportRequester) {}
  submit(project: string, input: FeedbackInput, signal?: AbortSignal): Promise<Feedback> { return this.request({ method: "POST", path: path(project, "feedback", true), body: input, signal }); }
  list(project: string, page: SupportPage = {}, signal?: AbortSignal): Promise<SupportList<Feedback>> { return this.request({ method: "GET", path: path(project, "feedback"), query: { ...page }, signal }); }
  get(project: string, id: string, signal?: AbortSignal): Promise<Feedback> { return this.request({ method: "GET", path: path(project, `feedback/${encodeURIComponent(id)}`), signal }); }
}
export class SupportCasesResource {
  constructor(private readonly request: SupportRequester) {}
  create(project: string, input: SupportCaseInput, signal?: AbortSignal): Promise<SupportCaseReceipt> { return this.request({ method: "POST", path: path(project, "support-cases", true), body: input, signal }); }
  list(project: string, page: SupportPage = {}, signal?: AbortSignal): Promise<SupportList<SupportCase>> { return this.request({ method: "GET", path: path(project, "support-cases"), query: { ...page }, signal }); }
  get(project: string, id: string, signal?: AbortSignal): Promise<SupportCase> { return this.request({ method: "GET", path: path(project, `support-cases/${encodeURIComponent(id)}`), signal }); }
  events(project: string, id: string, page: SupportPage = {}, signal?: AbortSignal): Promise<SupportList<SupportEvent>> { return this.request({ method: "GET", path: path(project, `support-cases/${encodeURIComponent(id)}/events`), query: { ...page }, signal }); }
  reply(project: string, id: string, input: SupportMutation, signal?: AbortSignal): Promise<SupportCase> { return this.change(project, id, "replies", input, signal); }
  resolve(project: string, id: string, input: SupportMutation, signal?: AbortSignal): Promise<SupportCase> { return this.change(project, id, "resolve", input, signal); }
  reopen(project: string, id: string, input: SupportMutation, signal?: AbortSignal): Promise<SupportCase> { return this.change(project, id, "reopen", input, signal); }
  private change(project: string, id: string, operation: string, input: SupportMutation, signal?: AbortSignal): Promise<SupportCase> { return this.request({ method: "POST", path: path(project, `support-cases/${encodeURIComponent(id)}/${operation}`, true), body: input, signal }); }
}
export class SupportResource {
  readonly cases: SupportCasesResource;
  constructor(private readonly request: SupportRequester) { this.cases = new SupportCasesResource(request); }
  settings(project: string, signal?: AbortSignal): Promise<SupportSettings> { return this.request({ method: "GET", path: path(project, "support-settings"), signal }); }
}
