import type { InboxActivation, ReviewEventsResult, ConnectionResourceSelection } from "./models.js";
import type { Transport } from "./transport.js";

export interface CreateAgentTaskRequest {
  kind: "activation" | "review";
  review_id?: string;
  limit?: number;
  /** Handle retention in seconds, 60..86400. Does not change review/signup expiry. */
  ttl_seconds?: number;
  client_id?: string;
}

/** A completed observer is not a verified account, handled review, or sent email. */
export interface AgentTask {
  id: string;
  kind: "activation" | "review";
  status: "working" | "completed" | "cancelled";
  created_at: string;
  last_updated_at: string;
  expires_at: string;
  poll_interval_ms: number;
  result?: InboxActivation | ReviewEventsResult;
}

export class AgentTasks {
  constructor(private readonly transport: Transport) {}
  create(input: CreateAgentTaskRequest, signal?: AbortSignal, selection?: ConnectionResourceSelection): Promise<AgentTask> {
    return this.transport.createAgentTask(input, signal, selection);
  }
  get(id: string, signal?: AbortSignal): Promise<AgentTask> { return this.transport.getAgentTask(id, signal); }
  /** Stop observing only; never withdraw a send intent or discard a reservation. */
  cancel(id: string, signal?: AbortSignal): Promise<AgentTask> { return this.transport.cancelAgentTask(id, signal); }
}
