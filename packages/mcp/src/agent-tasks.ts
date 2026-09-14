/**
 * Optional 2026-07-28 MCP Tasks extension adapter.
 *
 * SDK 2.0.0 only retains the incompatible 2025 task vocabulary and rejects
 * tasks/get before custom-handler dispatch. Keep this small adapter at the
 * transport boundary until the maintained SDK supplies the current extension.
 * All workflow state and authorization remain in the Go API.
 * Spec: modelcontextprotocol/ext-tasks, schema/2026-07-28/schema.ts.
 */
import {
  classifyInboundRequest,
  isSpecType,
  type JSONRPCMessage,
  type JSONRPCRequest,
  type JSONRPCResponse,
  type Transport,
} from "@modelcontextprotocol/server";
import { z } from "zod/v4";
import { ExtrovertApiError, type ExtrovertClient } from "./client.js";
import { profileAllowsTool, type CapabilityProfile } from "./profiles.js";
import { formatActivationResult, formatReviewEventsResult, validateToolArguments } from "./tools.js";
import { withReviewWorkflow } from "./review-workflow.js";
import type { AgentTask, InboxActivation, ReviewEventsResult } from "./types.js";

export const TASKS_EXTENSION = "io.modelcontextprotocol/tasks";
export const TASKS_PROTOCOL_VERSION = "2026-07-28";
const taskMethods = new Set(["tasks/get", "tasks/update", "tasks/cancel"]);
const observerTools = new Set(["check_activation", "wait_for_review_event"]);
const idSchema = z.string().min(1).max(256);
const metaSchema = z.record(z.string(), z.unknown()).optional();
const taskParams = z.strictObject({ taskId: idSchema, _meta: metaSchema });
const inputResponse = z.unknown().refine(value => isSpecType.ElicitResult(value)
  || isSpecType.ListRootsResult(value) || isSpecType.CreateMessageResult(value)
  || isSpecType.CreateMessageResultWithTools(value));
const updateParams = taskParams.extend({ inputResponses: z.record(z.string().max(256), inputResponse).refine(value => Object.keys(value).length <= 100) });
const callParams = z.strictObject({ name: z.string(), arguments: z.record(z.string(), z.unknown()).optional(), _meta: metaSchema });

export interface TaskProtocolOptions {
  client: Pick<ExtrovertClient, "createAgentTask" | "getAgentTask" | "cancelAgentTask">;
  profile: CapabilityProfile;
  /** HTTP-only routing headers; omitted for stdio. */
  headers?: { protocolVersion?: string; method?: string; name?: string };
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function headerName(value: string | undefined): string | undefined {
  if (value === undefined) return;
  const trimmed = value.trim();
  if (!trimmed.startsWith("=?base64?") || !trimmed.endsWith("?=")) return trimmed;
  const encoded = trimmed.slice(9, -2);
  try {
    const bytes = Buffer.from(encoded, "base64");
    if (bytes.toString("base64") !== encoded) return;
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch { return; }
}

function error(id: string | number, code: number, message: string, data?: unknown): JSONRPCResponse {
  return { jsonrpc: "2.0", id, error: { code, message, ...(data !== undefined ? { data } : {}) } };
}

function complete(id: string | number, result: Record<string, unknown>): JSONRPCResponse {
  return { jsonrpc: "2.0", id, result: { resultType: "complete", ...result } };
}

function toolForKind(kind: AgentTask["kind"]): string {
  return kind === "activation" ? "check_activation" : "wait_for_review_event";
}

function taskMetadata(task: AgentTask): Record<string, unknown> {
  const created = Date.parse(task.created_at);
  const updated = Date.parse(task.last_updated_at);
  const expires = Date.parse(task.expires_at);
  if (!idSchema.safeParse(task.id).success || !["activation", "review"].includes(task.kind)
    || !["working", "completed", "cancelled"].includes(task.status)
    || ![created, updated, expires].every(Number.isFinite) || expires < created
    || !Number.isSafeInteger(task.poll_interval_ms) || task.poll_interval_ms < 1) {
    throw new Error("Invalid task response");
  }
  return {
    taskId: task.id, status: task.status, createdAt: task.created_at,
    lastUpdatedAt: task.last_updated_at, ttlMs: expires - created,
    pollIntervalMs: task.poll_interval_ms,
    statusMessage: task.status === "working"
      ? "Watching for an external event. No model reasoning is needed between polls."
      : task.status === "cancelled" ? "Observer cancelled. The underlying account or review is unchanged."
      : "Observer finished. Inspect the result; completion does not imply an email was sent.",
  };
}

function detailedTask(task: AgentTask): Record<string, unknown> {
  const metadata = taskMetadata(task);
  if (task.status !== "completed") return metadata;
  const result = object(task.result);
  if (!result) throw new Error("Completed observer has no result");
  if (task.kind === "activation") {
    if (!["pending", "proven", "activated", "expired"].includes(String(result.state))) throw new Error("Invalid activation result");
    return { ...metadata, result: { resultType: "complete", ...formatActivationResult(task.result as InboxActivation) } };
  }
  if (!Array.isArray(result.events)) throw new Error("Invalid review events result");
  return { ...metadata, result: { resultType: "complete", ...withReviewWorkflow("wait_for_review_event", {}, formatReviewEventsResult(task.result as ReviewEventsResult, false)) } };
}

/** Returns undefined for traffic owned by the normal SDK. Never broadens tools. */
export async function handleTaskMessage(input: unknown, options: TaskProtocolOptions): Promise<JSONRPCResponse | undefined> {
  const raw = object(input);
  const params = object(raw?.params);
  const method = raw?.method;
  const isTaskMethod = typeof method === "string" && taskMethods.has(method);
  const isObserverCall = method === "tools/call" && observerTools.has(String(params?.name));
  const taskSubscription = method === "subscriptions/listen" && object(params?.notifications)?.taskIds !== undefined;
  if (!isTaskMethod && !isObserverCall && !taskSubscription) return;
  const meta = object(params?._meta);
  // A legacy handshake or cached capability is not per-request negotiation.
  if (meta?.["io.modelcontextprotocol/protocolVersion"] === undefined) return;
  const id = typeof raw?.id === "string" || typeof raw?.id === "number" ? raw.id : undefined;
  if (id === undefined) return; // SDK owns notifications and malformed envelopes.
  const classification = classifyInboundRequest({
    httpMethod: "POST", body: input,
    ...(options.headers?.protocolVersion !== undefined ? { protocolVersionHeader: options.headers.protocolVersion } : {}),
    ...(options.headers?.method !== undefined ? { mcpMethodHeader: options.headers.method } : {}),
  });
  if (classification.kind === "reject") return error(id, classification.code, classification.message, classification.data);
  if (classification.kind !== "modern" || classification.messageKind !== "request") return;
  if (meta?.["io.modelcontextprotocol/protocolVersion"] !== TASKS_PROTOCOL_VERSION) {
    return error(id, -32022, "Unsupported protocol version", { supported: [TASKS_PROTOCOL_VERSION] });
  }
  const capabilities = object(meta["io.modelcontextprotocol/clientCapabilities"]);
  const extensions = object(capabilities?.extensions);
  const extension = extensions?.[TASKS_EXTENSION];
  if (!object(extension)) {
    if (!isTaskMethod && !taskSubscription) return;
    return error(id, -32021, "Missing required client capability", { requiredCapabilities: { extensions: { [TASKS_EXTENSION]: {} } } });
  }
  // Notifications are optional. The maintained SDK acknowledges only the
  // subscriptions it actually supports; this adapter promises polling only.
  if (taskSubscription) return;
  if (options.headers) {
    if (options.headers.method?.trim() !== method) return error(id, -32602, "Mcp-Method must match the request method");
    const expectedName = isTaskMethod ? params?.taskId : params?.name;
    if (headerName(options.headers.name) !== expectedName) return error(id, -32602, "Mcp-Name must match the request target");
  }
  try {
    if (isObserverCall) {
      const parsed = callParams.parse(params);
      if (!profileAllowsTool(options.profile, parsed.name)) return error(id, -32602, "Tool unavailable in this connection");
      const args = validateToolArguments(parsed.name, parsed.arguments ?? {}, options.profile);
      const task = await options.client.createAgentTask({
        kind: parsed.name === "check_activation" ? "activation" : "review",
        ...(typeof args.review_id === "string" ? { review_id: args.review_id } : {}),
        ...(typeof args.limit === "number" ? { limit: args.limit } : {}),
        ttl_seconds: 86400,
      });
      if (toolForKind(task.kind) !== parsed.name) throw new Error("Task kind mismatch");
      return { jsonrpc: "2.0", id, result: { resultType: "task", ...taskMetadata(task) } };
    }
    const parsed = (method === "tasks/update" ? updateParams : taskParams).parse(params);
    // Authorization is repeated by the API even for terminal results and updates.
    const task = await options.client.getAgentTask(parsed.taskId);
    if (task.id !== parsed.taskId || !profileAllowsTool(options.profile, toolForKind(task.kind))) return error(id, -32602, "Task unavailable in this connection");
    if (method === "tasks/get") return complete(id, detailedTask(task));
    if (method === "tasks/cancel") await options.client.cancelAgentTask(parsed.taskId);
    // These observers never issue inputRequests. Ignore all unknown response keys.
    // In particular, a client response is NOT human proof, feedback, or approval.
    return complete(id, {});
  } catch (cause) {
    if (cause instanceof z.ZodError) return error(id, -32602, "Invalid task parameters");
    if (cause instanceof ExtrovertApiError) {
      // Retained observer capacity is optional: a refused create made no handle.
      // Let the same authenticated SDK dispatcher perform its ordinary bounded
      // wait instead. Never conceal errors on existing handles or denied access.
      if (isObserverCall && cause.status === 429) return;
      if ([401, 403, 404, 410].includes(cause.status)) return error(id, -32602, "Task unavailable or access expired");
      if ([400, 409, 422].includes(cause.status)) return error(id, -32602, "Task request could not be accepted");
    }
    // Never leak API URLs, credentials, or profile-excluded instructions.
    return error(id, -32603, "Unable to observe task state; retry with the same identity and task handle");
  }
}

/** Decorates, rather than replaces, the maintained SDK's stdio framing/lifecycle. */
export function taskAwareTransport(inner: Transport, options: TaskProtocolOptions): Transport {
  let era: "legacy" | "modern" | undefined;
  const transport: Transport = {
    async start() {
      inner.onclose = () => transport.onclose?.();
      inner.onerror = error => transport.onerror?.(error);
      inner.onmessage = (message, extra) => {
        const request = message as JSONRPCRequest;
        if (typeof request.method === "string" && request.id !== undefined) {
          const claim = request.params?._meta?.["io.modelcontextprotocol/protocolVersion"];
          era ??= claim === TASKS_PROTOCOL_VERSION ? "modern" : "legacy";
        }
        if (era !== "modern") { transport.onmessage?.(message, extra); return; }
        void handleTaskMessage(message, options).then(response => {
          if (response) return inner.send(response);
          transport.onmessage?.(message, extra);
        }).catch(error => transport.onerror?.(error instanceof Error ? error : new Error("Task transport failed")));
      };
      await inner.start();
    },
    send: (message: JSONRPCMessage, options) => inner.send(message, options),
    close: () => inner.close(),
  };
  return transport;
}
