import type { Feedback, FeedbackInput, SupportCase, SupportCaseInput, SupportEvent, SupportMutation, SupportRequest } from "./support.js";

/** Offline single-reporter fixtures; production access rules are tested against PostgreSQL. */
export class SupportFixtures {
  private feedback = new Map<string, Feedback>();
  private cases = new Map<string, SupportCase>();
  private events = new Map<string, SupportEvent[]>();
  private receipts = new Map<string, { hash: string; result: unknown }>();
  private sequence = 0;
  private automaticFeedback = false;
  private settingsVersion = 0;
  private participants = new Map<string,string[]>();
  setAutomaticFeedback(enabled: boolean) { this.automaticFeedback=enabled; }
  async request<T>(r: SupportRequest): Promise<T> {
    if (r.signal?.aborted) throw r.signal.reason;
    if (r.path === "/v1/support-context") return {capabilities:{report_and_follow:true,read_other_reports:false,manage_other_cases:false},default_project:{id:"proj_mock",org_id:"org_mock",name:"Mock"},projects:{object:"list",data:[{id:"proj_mock",org_id:"org_mock",name:"Mock"}],has_more:false,next_cursor:""}} as T;
    const parts = (r.path.startsWith("/v1/projects/") ? r.path : r.path.replace("/v1/","/v1/projects/proj_mock/")).split("/").map(decodeURIComponent);
    const project = parts[3]!, resource = parts[4]!, id = parts[5], operation = parts[6];
    const body = structuredClone(r.body) as FeedbackInput & SupportCaseInput & SupportMutation;
    const key = `${project}:${resource}:${id ?? ""}:${operation ?? ""}:${body?.client_id}`;
    const hash = JSON.stringify(r.body);
    if (r.method === "POST" && resource !== "support-settings") {
      if (!body?.client_id || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(body.client_id)) throw new Error("invalid client_id");
      const receipt = this.receipts.get(key);
      if (receipt) { if (receipt.hash !== hash) throw new Error("idempotency_conflict"); return structuredClone(receipt.result) as T; }
    }
    let result: unknown;
    if (resource === "support-settings") {
      if(r.method==="POST") { const settings=r.body as {automatic_feedback:boolean;expected_version:number};if(settings.expected_version!==this.settingsVersion)throw new Error("conflict");this.automaticFeedback=settings.automatic_feedback;this.settingsVersion++;result={automatic_feedback:this.automaticFeedback,version:this.settingsVersion,updated_ms:Date.now()}; }
      else result={settings:{automatic_feedback:this.automaticFeedback,version:this.settingsVersion,updated_ms:0},submission_policy:"explicit_or_opted_in_automatic",feedback_enabled:true,cases_enabled:true};
    }
    else if(operation==="delete") {
      if(resource==="feedback"){this.scoped(this.feedback.get(id!),project);if([...this.cases.values()].some(c=>c.feedback_id===id))throw new Error("conflict");this.feedback.delete(id!)}
      else {const item=this.scoped(this.cases.get(id!),project);if(item.status!=="resolved")throw new Error("conflict");this.cases.delete(id!);this.events.delete(id!);this.participants.delete(id!);if(![...this.cases.values()].some(c=>c.feedback_id===item.feedback_id))this.feedback.delete(item.feedback_id)}
      result={deleted:true};
    }
    else if(operation==="participants") {
      const item=this.scoped(this.cases.get(id!),project),people=this.participants.get(id!)??["human:fixture-owner"];
      if(r.method==="GET")result=this.page(people,r,true);
      else {const input=r.body as {actor:string;add:boolean;expected_version:number};if(input.expected_version!==item.version)throw new Error("conflict");this.participants.set(id!,input.add?[...new Set([...people,input.actor])]:people.filter(p=>p!==input.actor));item.version++;result=item}
    }
    else if (resource === "feedback" && r.method === "POST") result = this.submit(project, body);
    else if (resource === "feedback" && id) result = this.scoped(this.feedback.get(id), project);
    else if (resource === "feedback") result = this.page([...this.feedback.values()].filter(v => project === "-" || v.project_id === project), r);
    else if (resource === "support-cases" && r.method === "POST" && !id) {
      if(body.description){if(body.feedback||body.feedback_id)throw new Error("invalid support case");body.feedback={client_id:body.client_id,submission_mode:"explicit",category:"other",user_intent:body.title,observed_behavior:body.description,outcome:"observation"};}
      if ((!body.feedback_id) === (!body.feedback) || !body.title) throw new Error("invalid support case");
      const feedback = body.feedback ? this.submit(project, body.feedback) : this.scoped(this.feedback.get(body.feedback_id!), project);
      const now = Date.now(), number = ++this.sequence;
      const item: SupportCase = { id: `sc_mock_${number}`, number: `SUP-${number}`, project_id: project, title: body.title, impact: body.impact, status: "received", version: 1, created_ms: now, updated_ms: now, feedback_id: feedback.id };
      this.cases.set(item.id, item); this.events.set(item.id, [{ id: `sev_mock_${number}`, sequence: 1, kind: "received", actor_kind: "customer", body: "", created_ms: now }]); result = {...item,console_url:`https://app.extrovert.dev/o/mock/p/${project}/support/${item.id}`,notification_queued:true,next_action:"check_case_for_updates"};
    } else if (resource === "support-cases" && id) {
      const item = this.scoped(this.cases.get(id), project);
      if (r.method === "GET") result = operation === "events" ? this.page(this.events.get(id)!, r, true) : item;
      else {
        if ((operation !== "replies" || body.expected_version !== undefined) && body.expected_version !== item.version) throw new Error("conflict");
        if (!body.body?.trim() || body.body.length > 4000) throw new Error("invalid body");
        if (operation === "resolve") { item.status = "resolved"; item.resolved_ms = item.customer_confirmed_ms = Date.now(); item.resolution_kind = "customer_confirmed"; item.resolution_summary = body.body; }
        else if (operation === "reopen") { if (item.status !== "resolved") throw new Error("conflict"); item.status = "working"; delete item.resolved_ms; delete item.customer_confirmed_ms; delete item.resolution_kind; delete item.resolution_summary; }
        else if (operation === "replies") { if (item.status === "waiting_on_customer") item.status = "working"; }
        else throw new Error("not_found");
        item.version++; item.updated_ms = Date.now(); this.events.get(id)!.push({ id: `sev_mock_${++this.sequence}`, sequence: item.version, kind: operation, actor_kind: "customer", body: body.body, created_ms: item.updated_ms }); result = item;
      }
    } else if (resource === "support-cases") result = this.page([...this.cases.values()].filter(v => (project === "-" || v.project_id === project) && (!r.query?.status || (r.query.status === "open" ? v.status !== "resolved" : v.status === r.query.status)) && (!r.query?.search || v.title.toLowerCase().includes(String(r.query.search).toLowerCase()))), r);
    else throw new Error("not_found");
    if (r.method === "POST") this.receipts.set(key, { hash, result: structuredClone(result) });
    return structuredClone(result) as T;
  }
  private submit(project: string, body: FeedbackInput): Feedback {
    if (body.submission_mode !== "explicit" && !this.automaticFeedback) throw new Error("automatic feedback is disabled in offline fixtures");
    if (!body.user_intent?.trim() || !body.observed_behavior?.trim()) throw new Error("invalid feedback");
    const now = Date.now(); const item: Feedback = { id: `fb_mock_${++this.sequence}`, project_id: project, evidence: structuredClone(body), repeat_count: 1, created_ms: now, updated_ms: now, api_build: "mock", redacted_fields: [] };
    this.feedback.set(item.id, item); return item;
  }
  private scoped<T extends { project_id: string }>(item: T | undefined, project: string): T { if (!item || (project !== "-" && item.project_id !== project)) throw new Error("not_found"); return item; }
  private page<T>(items: T[], r: SupportRequest, events = false) {
    const limit = Number(r.query?.limit ?? 25); if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("invalid limit");
    const scope = JSON.stringify([r.path, r.query?.status, r.query?.search]);
    let offset = 0; if (r.query?.cursor) { const c = JSON.parse(decodeURIComponent(String(r.query.cursor))); if (c.scope !== scope || !Number.isInteger(c.offset) || c.offset < 0) throw new Error("invalid cursor"); offset = c.offset; }
    if (!events) items.reverse();
    const data = items.slice(offset, offset + limit), has_more = items.length > offset + limit;
    return { object: "list", data, has_more, next_cursor: has_more ? encodeURIComponent(JSON.stringify({ scope, offset: offset + limit })) : "" };
  }
}
