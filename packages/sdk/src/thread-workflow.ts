import { ApiError, NotFoundError, ValidationError } from "./errors.js";
import type { Inbox, Message, ThreadDetail } from "./models.js";

/** Shared read-only workflow; callers retain their original inbox/project scope. */
export async function readThreadByMessage(
  reads: {
    inbox(signal?: AbortSignal): Promise<Inbox>;
    message(id: string, signal?: AbortSignal): Promise<Message>;
    thread(id: string, signal?: AbortSignal): Promise<ThreadDetail>;
  },
  messageId: string,
  signal?: AbortSignal,
): Promise<ThreadDetail> {
  if (!messageId.trim()) {
    throw new ValidationError({ status: 400, code: "bad_request", message: "A nonempty message ID is required." });
  }
  signal?.throwIfAborted();
  const inbox = await reads.inbox(signal);
  signal?.throwIfAborted();
  const message = await reads.message(messageId, signal);
  signal?.throwIfAborted();
  if (!inbox.address || !message.inbox || inbox.address.toLowerCase() !== message.inbox.toLowerCase()) {
    throw new NotFoundError({ status: 404, code: "not_found", message: "Message not found in the selected inbox." });
  }
  if (!message.thread_id?.trim()) {
    throw new ApiError({ status: 502, code: "invalid_response", message: "Message has no available conversation reference." });
  }
  return reads.thread(message.thread_id, signal);
}
