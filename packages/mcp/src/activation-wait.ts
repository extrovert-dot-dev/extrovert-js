import { observeUntil, type ObserverWaitOptions } from "./observer-wait.js";
import type { InboxActivation } from "./types.js";

/** One bounded watch survives individual long-poll timeouts without a human nudge. */
export async function waitForActivation(
  check: (waitSeconds: number, signal?: AbortSignal) => Promise<InboxActivation>,
  options: ObserverWaitOptions = {},
): Promise<InboxActivation> {
  return observeUntil(check, value => value.state !== "pending", options);
}
