/**
 * Narrowing helpers for {@link SendOutcome} - the three shapes a send can answer.
 *
 * `inbox.send()` used to be typed as one struct with a REQUIRED `thread_id`, which
 * the direct-send response has never carried. The type checked; the value was
 * `undefined`. Now the return type is an honest union, and these helpers exist so
 * that reading it does not turn into a `"kind" in res` puzzle at every call site.
 *
 * The one rule worth internalizing: a `queued_for_review` outcome means **nothing
 * has been delivered**. A human has to approve it first, and the delivery outcome
 * arrives later as a `sent` / `send_failed` review event. Code that treats every
 * 2xx from `send()` as "the mail went out" is wrong under the default
 * `require_review` policy - which is every account that has not changed it.
 */

import type {
  QueuedForReviewResult,
  SendOutcome,
  SendResult,
  SentResult,
} from "./models.js";

/**
 * True when the message was PARKED for a human and nothing has been delivered.
 * Narrow with this before reading `res.review.id`, then monitor the review via
 * `extrovert.reviewEvents.wait({ review_id })`.
 */
export function isQueuedForReview(res: SendOutcome): res is QueuedForReviewResult {
  return res.kind === "queued_for_review";
}

/**
 * True when the message was delivered immediately - either the review-loop
 * `{kind:"sent"}` body or the legacy body a bare send gets under `allow_direct`.
 */
export function isSentImmediately(res: SendOutcome): res is SendResult | SentResult {
  return !isQueuedForReview(res);
}

/**
 * The delivered message id, or `undefined` when the message was queued instead.
 *
 * `undefined` here is NOT an error - it is the normal answer under
 * `require_review`. Pair it with {@link reviewIdOf} to follow the message to its
 * outcome.
 */
export function sentMessageIdOf(res: SendOutcome): string | undefined {
  if (isQueuedForReview(res)) return undefined;
  return res.kind === "sent" ? res.message.id : res.message_id;
}

/**
 * The thread id when one is known.
 *
 * Absent on a direct `send` (the server assigns the thread at delivery and the
 * legacy body does not echo it) and on a queued outcome (there is no message
 * yet). Reply and forward do return it.
 */
export function threadIdOf(res: SendOutcome): string | undefined {
  if (isQueuedForReview(res)) return undefined;
  return res.kind === "sent" ? res.message.thread_id : res.thread_id;
}

/**
 * The opaque review id (rr_…) that governed this send, on EVERY branch.
 *
 * This is the crash-recovery handle: an agent that issued a send and then died
 * can call `reviews.get(id)` and read `closed` / `send_error` / `sent_message_id`
 * rather than guessing whether the message went out. It is `undefined` only
 * against a server old enough to predate the field.
 */
export function reviewIdOf(res: SendOutcome): string | undefined {
  if (isQueuedForReview(res)) return res.review.id;
  return res.kind === "sent" ? res.review?.id : res.review_id;
}
