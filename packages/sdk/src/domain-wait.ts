import type { Domain } from "./models.js";

export interface DomainWaitResult {
  domain: Domain;
  outcome: "ready" | "action_required" | "needs_attention" | "timed_out" | "status_unavailable";
  resume_after_seconds: number;
}

/** Bounded, cancellable status polling. Never initiates DNS or provider work. */
export async function waitForDomain(
  get: (signal: AbortSignal) => Promise<Domain>,
  options: { timeout_seconds?: number; signal?: AbortSignal } = {},
): Promise<DomainWaitResult> {
  const seconds = options.timeout_seconds ?? 45;
  if (!Number.isInteger(seconds) || seconds < 0 || seconds > 50) throw new Error("timeout_seconds must be an integer between 0 and 50");
  const deadline = AbortSignal.timeout(Math.max(1, seconds * 1000));
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  let latest: Domain | undefined;
  const result = (outcome: DomainWaitResult["outcome"]): DomainWaitResult => ({
    domain: latest!, outcome,
    resume_after_seconds: outcome === "timed_out" ? Math.max(5, Math.min(60, latest?.readiness?.poll_after_seconds ?? 30)) : 0,
  });
  try {
    // Zero means one status check, not an immediately aborted request.
    const singleCheckDeadline = seconds === 0 ? AbortSignal.timeout(10_000) : undefined;
    latest = await get(singleCheckDeadline
      ? (options.signal ? AbortSignal.any([options.signal, singleCheckDeadline]) : singleCheckDeadline)
      : signal);
    for (;;) {
      const r = latest.readiness;
      if (!r) return result("status_unavailable");
      if (r.ready_for_inboxes) return result("ready");
      if (r.action_required_by === "customer") return result("action_required");
      if (r.status === "needs_attention") return result("needs_attention");
      if (seconds === 0) return result("timed_out");
      await new Promise<void>((resolve, reject) => {
        signal.throwIfAborted();
        const abort = () => { clearTimeout(timer); reject(signal.reason); };
        const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, Math.max(5, Math.min(60, r.poll_after_seconds || 30)) * 1000);
        signal.addEventListener("abort", abort, { once: true });
      });
      latest = await get(signal);
    }
  } catch (error) {
    if (options.signal?.aborted) throw options.signal.reason;
    if (deadline.aborted && latest) return result("timed_out");
    throw error;
  }
}
