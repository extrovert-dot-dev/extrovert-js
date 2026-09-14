import { setTimeout as sleep } from "node:timers/promises";

export interface ObserverWaitOptions {
  timeoutSeconds?: number;
  signal?: AbortSignal;
  now?: () => number;
  pause?: (ms: number) => Promise<unknown>;
}

/** Renew transport waits without invoking a model; never mutate observed work. */
export async function observeUntil<T>(
  read: (seconds: number, signal?: AbortSignal) => Promise<T>,
  ready: (value: T) => boolean,
  options: ObserverWaitOptions = {},
): Promise<T> {
  const budget = options.timeoutSeconds ?? 1800;
  if (!Number.isInteger(budget) || budget < 0 || budget > 86400) throw new Error("Observer timeout must be between 0 and 86400 seconds.");
  const now = options.now ?? Date.now;
  const pause = options.pause ?? (ms => sleep(ms, undefined, { signal: options.signal }));
  const deadline = now() + budget * 1000;
  while (true) {
    options.signal?.throwIfAborted();
    const start = now();
    const value = await read(Math.min(55, Math.max(0, Math.ceil((deadline - start) / 1000))), options.signal);
    options.signal?.throwIfAborted();
    if (ready(value) || now() >= deadline) return value;
    const delay = Math.min(deadline - now(), Math.max(0, 1000 - (now() - start)));
    if (delay > 0) await pause(delay);
  }
}
