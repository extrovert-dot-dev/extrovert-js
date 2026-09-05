/**
 * Inbox in one call - then queue a message for a human.
 *
 * Run offline against the built-in fixtures (no API key needed):
 *   EXTROVERT_API_BASE_URL=mock npx tsx examples/mailbox-in-one-call.ts
 *
 * Against the live API:
 *   EXTROVERT_API_KEY=pk_agent_... npx tsx examples/mailbox-in-one-call.ts
 *
 * The shape to learn from this file: an Extrovert agent does not send mail, it
 * QUEUES mail. Under the default `require_review` policy a send without an
 * `intent` is refused 422 (nothing sent, nothing queued), and a send with one
 * comes back `queued_for_review` carrying a review id. Delivery happens after a
 * human approves; the agent watches for that with wait_for_review_event /
 * list_review_events. See https://docs.extrovert.dev/review-loop/agent-contract/
 * for the other half of the loop.
 */

import { Extrovert, isQueuedForReview, sentMessageIdOf } from "@extrovert.dev/sdk";

async function main() {
  // `transport: "mock"` (or EXTROVERT_API_BASE_URL=mock) runs entirely offline.
  const extrovert = new Extrovert({ transport: process.env.EXTROVERT_API_KEY ? "http" : "mock" });

  // One call. A real, send-and-receive-capable inbox on a pre-verified subdomain.
  const inbox = await extrovert.inboxes.create({ display_name: "Support Bot" });
  console.log(`inbox live: ${inbox.address} (${inbox.onboardingMode})`);

  // Worth reading once, rather than learning the policy by being refused.
  // `effective_review_policy` rides the SINGLE-inbox read only, not the list.
  const policy = (await extrovert.inboxes.get(inbox.address)).record?.effective_review_policy;
  console.log(`review policy: ${policy}`);

  // `intent.summary` is what the human reviewer reads first, so it carries the
  // why - not a restatement of the subject. It is REQUIRED once review resolves.
  const outcome = await inbox.send({
    to: "ops@acme.test",
    subject: "agent online",
    text: "Reporting in. Reply here and I'll thread it.",
    intent: {
      summary: "Tell ops the support agent is live and invite a reply to open a thread.",
    },
  });

  if (isQueuedForReview(outcome)) {
    // The normal outcome. Nothing has been delivered yet.
    console.log(`queued for review: ${outcome.review.id} (state: ${outcome.review.state})`);
    console.log("a human approves, edits, or rejects it next - watch the review");
    console.log("with wait_for_review_event / list_review_events until it closes.");
  } else {
    // Only reachable on an `allow_direct` inbox, or a graduated category that
    // cleared its auto-send gates.
    console.log(`sent immediately: ${sentMessageIdOf(outcome)} (policy: ${policy})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
