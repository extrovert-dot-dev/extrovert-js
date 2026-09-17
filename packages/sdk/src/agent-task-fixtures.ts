import type { AgentTask, CreateAgentTaskRequest } from "./agent-tasks.js";
import type { MockBackend } from "./fixtures.js";

/** Offline behavior only; real authorization and durable storage belong to the API. */
export class AgentTaskFixtures {
  private rows = new Map<string, { task: AgentTask; input: CreateAgentTaskRequest }>();
  private nextId = 0;
  constructor(private readonly backend: MockBackend) {}
  create(input: CreateAgentTaskRequest): AgentTask {
    if (!["activation", "review"].includes(input.kind) || input.ttl_seconds !== undefined && (!Number.isInteger(input.ttl_seconds) || input.ttl_seconds < 60 || input.ttl_seconds > 86400)
      || input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100)
      || input.client_id !== undefined && input.client_id.length > 128
      || input.kind === "activation" && (input.review_id !== undefined || input.limit !== undefined)) throw new Error("Invalid observer request");
    const normalized: CreateAgentTaskRequest & { ttl_seconds: number } = {
      kind: input.kind, review_id: input.review_id || undefined,
      limit: input.kind === "review" ? input.limit ?? 100 : undefined,
      ttl_seconds: input.ttl_seconds ?? 3600, client_id: input.client_id || undefined,
    };
    for (const row of this.rows.values()) if (input.client_id && row.input.client_id === input.client_id && Date.parse(row.task.expires_at) > Date.now()) {
      if (JSON.stringify(row.input) !== JSON.stringify(normalized)) throw new Error("Observer idempotency conflict");
      return this.get(row.task.id);
    }
    for (const [id, row] of this.rows) if (Date.parse(row.task.expires_at) <= Date.now()) this.rows.delete(id);
    if (this.rows.size >= 100) throw new Error("Observer retention limit reached");
    const now = Date.now();
    const task: AgentTask = { id: `task_fixture_${++this.nextId}`, kind: input.kind, status: "working", created_at: new Date(now).toISOString(), last_updated_at: new Date(now).toISOString(), expires_at: new Date(now + normalized.ttl_seconds * 1000).toISOString(), poll_interval_ms: 2000 };
    this.rows.set(task.id, { task, input: normalized });
    return this.get(task.id);
  }
  get(id: string): AgentTask {
    const row = this.rows.get(id);
    if (!row || Date.parse(row.task.expires_at) <= Date.now()) throw new Error("Observer not found");
    if (row.task.status === "working") {
      const result = row.input.kind === "activation" ? this.backend.activationStatus()
        : this.backend.listReviewEvents({ review_id: row.input.review_id, limit: row.input.limit });
      const ready = "state" in result ? result.state !== "pending" : result.events.length > 0 || result.review?.closed === true || result.pending_reviews === 0;
      if (ready) Object.assign(row.task, { status: "completed", result: structuredClone(result), last_updated_at: new Date().toISOString() });
    }
    return structuredClone(row.task);
  }
  cancel(id: string): AgentTask {
    const row = this.rows.get(id);
    if (!row || Date.parse(row.task.expires_at) <= Date.now()) throw new Error("Observer not found");
    if (row.task.status === "working") Object.assign(row.task, { status: "cancelled", last_updated_at: new Date().toISOString() });
    return structuredClone(row.task);
  }
}

const fixtures = new WeakMap<MockBackend, AgentTaskFixtures>();
export function agentTaskFixtures(backend: MockBackend): AgentTaskFixtures {
  let fixture = fixtures.get(backend);
  if (!fixture) { fixture = new AgentTaskFixtures(backend); fixtures.set(backend, fixture); }
  return fixture;
}
