/**
 * Recipient-list normalization, shared by the live transport and the offline mock.
 *
 * `SendRequest.to` / `cc` / `bcc` accept `string | string[]` because passing one
 * address should not require a one-element array — and the flagship quickstart
 * does exactly that. The server, however, decodes them as `[]string` and rejects
 * a bare string with a 400. So the scalar form has to be widened somewhere, and
 * the honest place is the client: there is no deployed caller relying on a scalar
 * reaching the wire (it has always 400'd), so nothing is preserved by tolerating
 * it server-side.
 *
 * Living in its own module keeps ONE definition. The mock used to carry a private
 * copy, which is how a mock ends up quietly accepting shapes the server refuses.
 */

/** Widen `string | string[] | undefined` to `string[]` (empty for absent). */
export function toArray(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * Widen a recipient field for the WIRE, preserving "the caller did not set this".
 *
 * `toArray` collapses `undefined` to `[]`, which is right for internal fan-out
 * (union of all recipients) but wrong for a request body: emitting `cc: []` where
 * the caller sent nothing adds a key the caller never wrote. Returns `undefined`
 * for an absent field so the key is omitted from the JSON entirely.
 */
export function toWireArray(v: string | string[] | undefined): string[] | undefined {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v : [v];
}
