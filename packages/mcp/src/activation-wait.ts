import { setTimeout as sleep } from "node:timers/promises";
import type { InboxActivation } from "./types.js";

/** One bounded watch survives individual long-poll timeouts without a human nudge. */
export async function waitForActivation(
  check: (waitSeconds: number) => Promise<InboxActivation>,
  options: { timeoutSeconds?: number; now?: () => number; pause?: (ms: number) => Promise<unknown> } = {},
): Promise<InboxActivation> {
  const budget = options.timeoutSeconds ?? 300;
  if (!Number.isInteger(budget) || budget < 0 || budget > 300) throw new Error("Activation watch must be between 0 and 300 seconds.");
  const now = options.now ?? Date.now;
  const pause = options.pause ?? sleep;
  const deadline = now() + budget * 1000;
  while (true) {
    const started = now();
    const result = await check(Math.min(55, Math.max(0, Math.ceil((deadline - started) / 1000))));
    if (result.state !== "pending" || now() >= deadline) return result;
    // Avoid a hot loop if a proxy or older server ignores the long-poll budget.
    const delay = Math.min(deadline - now(), Math.max(0, 1000 - (now() - started)));
    if (delay > 0) await pause(delay);
  }
}
