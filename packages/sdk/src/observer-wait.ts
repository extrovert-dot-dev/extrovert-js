/** An observer deadline never cancels the signup or review being observed. */
export interface ObserverWaitOptions {
  /** Overall watch budget, not one HTTP request. Default 1800, maximum 86400. */
  timeoutSeconds?: number;
  signal?: AbortSignal;
}

function pause(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal?.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

/** Runtime orchestration only: no model calls, implicit writes or acknowledgements. */
export async function observeUntil<T>(
  read: (seconds: number, signal?: AbortSignal) => Promise<T>,
  ready: (value: T) => boolean,
  options: ObserverWaitOptions = {},
  clock: { now: () => number; pause: (ms: number, signal?: AbortSignal) => Promise<void> } = { now: Date.now, pause },
): Promise<T> {
  const budget = options.timeoutSeconds ?? 1800;
  if (!Number.isInteger(budget) || budget < 0 || budget > 86400) throw new Error("Observer timeout must be between 0 and 86400 seconds.");
  const deadline = clock.now() + budget * 1000;
  while (true) {
    options.signal?.throwIfAborted();
    const start = clock.now();
    const value = await read(Math.min(55, Math.max(0, Math.ceil((deadline - start) / 1000))), options.signal);
    options.signal?.throwIfAborted();
    if (ready(value) || clock.now() >= deadline) return value;
    const delay = Math.min(deadline - clock.now(), Math.max(0, 1000 - (clock.now() - start)));
    if (delay > 0) await clock.pause(delay, options.signal);
  }
}
