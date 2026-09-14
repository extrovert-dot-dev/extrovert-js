const keys = new WeakMap<object, string>();

/**
 * Allocate before starting HTTP and retain the key on the request when mutable.
 * Persist this key with the request to recover across process/browser restarts.
 * Reusing a key with changed content is rejected by the server.
 */
export function ensureSendIdempotencyKey(request: { idempotency_key?: string }): string {
  const key = request.idempotency_key || keys.get(request) || globalThis.crypto.randomUUID();
  keys.set(request, key);
  if (Object.isExtensible(request) && !request.idempotency_key) request.idempotency_key = key;
  return key;
}
