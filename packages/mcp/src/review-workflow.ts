/** Continuation guidance is repeated in tool text because some hosts discard
 * MCP initialization instructions or structuredContent. This holds no sessions. */
export interface ReviewWorkflow {
  status: "awaiting_review" | "action_required" | "sent" | "failed" | "cancelled";
  goal_complete: boolean;
  review_id?: string;
  revision?: number;
}

interface Result {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  [key: string]: unknown;
}

const covered = new Set(["send_email", "reply_email", "reply_to_email", "forward_email", "submit_for_review", "submit_revision", "get_review", "get_review_feedback", "post_review_chat", "restamp_review", "ack_review_event", "list_review_events", "wait_for_review_event", "learn_review_rule", "cancel_review"]);
export function withReviewWorkflow(name: string, args: Record<string, unknown>, result: Result): Result {
  if (!covered.has(name) || result.isError || !result.structuredContent) return result;
  const data = result.structuredContent;
  const review = (data.review && typeof data.review === "object" ? data.review : data) as Record<string, unknown>;
  const reviewID = String(review.id ?? data.review_id ?? args.id ?? "");
  const state = String(review.state ?? "");
  const events = Array.isArray(data.events) ? data.events as Record<string, unknown>[] : [];
  const sent = state === "sent" || state === "auto_sent" || data.kind === "sent" || (typeof data.message_id === "string" && data.message_id.length > 0 && !state);
  const workflow: ReviewWorkflow = {
    status: sent ? "sent" : state === "failed" ? "failed" : state === "cancelled" ? "cancelled" : "awaiting_review",
    goal_complete: sent,
    ...(reviewID.startsWith("rr_") ? { review_id: reviewID } : {}),
    ...(typeof review.revision === "number" ? { revision: review.revision } : {}),
  };
  let next: { tool: string; arguments: Record<string, unknown>; reason: string } | null = {
    tool: "wait_for_review_event", arguments: { wait_seconds: 55, limit: 100 },
    reason: "The send task is still in progress. Continue now with one wait across your pending reviews. Handle human feedback, learn reusable rules, revise the same review, and wait again until sent. Do not end the task after submission, revision, or an empty timeout.",
  };
  if (events.length) {
    workflow.status = "action_required";
    const ev = events[0]!;
    next = { tool: ev.review_id ? "get_review" : "get_rules", arguments: ev.review_id ? { id: ev.review_id } : ev.category_id ? { category_id: ev.category_id } : {}, reason: "Read the current review, then its feedback. Process each review's events in sequence; acknowledge only after the required action succeeds. For a broadcast without a review_id, reconcile affected editable drafts in bounded batches, then acknowledge its broadcast ID. A sent event completes that review, not other pending reviews." };
  } else if (name === "get_review_feedback") {
    workflow.status = "action_required";
    next = { tool: "get_rules", arguments: {}, reason: "Compare authenticated human feedback with existing rules. Use learn_review_rule for reusable guidance: universal style belongs in org_house, category-specific guidance in category. One-off corrections need no rule. Then get the current review, fetch its category's full rules, revise or answer, acknowledge handled events, and keep waiting." };
  } else if (name === "learn_review_rule") {
    workflow.status = "action_required";
    next = { tool: "get_review", arguments: { id: data.source_review_id ?? args.id }, reason: "Learning is saved and propagation is queued. Read the latest draft and get_rules for its category, apply the new rule without overwriting human edits, submit_revision, acknowledge handled feedback, then wait again." };
  } else if (state === "chatting" || state === "rejected" || state === "stale") {
    workflow.status = "action_required";
    next = { tool: "get_review_feedback", arguments: { id: reviewID }, reason: "Process the human feedback, save reusable writing rules, then revise this same review or answer the reviewer. A rejected draft is not authorization to abandon or resend the message." };
  } else if (sent || state === "cancelled" || state === "failed") {
    next = { tool: "list_review_events", arguments: {}, reason: sent ? "Sending succeeded for this review. Process any final human edits for learning, acknowledge its outcome, and continue other pending reviews." : "This message did not send successfully. Reconcile its outcome, acknowledge the event, and report the failure or cancellation. Do not create a replacement send automatically." };
  } else if (data.pending_reviews === 0) {
    next = { tool: "list_reviews", arguments: { composer: "me" }, reason: "No pending composer reviews remain. Reconcile your tracked review outcomes; do not claim sent without a confirmed sent state or message ID." };
  }
  const guidance = `\n\nSending task: ${workflow.goal_complete ? "sent" : "not complete"}.\nNext: ${next.tool} ${JSON.stringify(next.arguments)}. ${next.reason}`;
  return { ...result, structuredContent: { ...data, workflow, next_action: next }, content: [...result.content, { type: "text", text: guidance }] };
}
