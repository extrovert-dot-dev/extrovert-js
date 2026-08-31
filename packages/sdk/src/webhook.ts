/**
 * Inbound webhook verification.
 *
 * Extrovert signs every inbound delivery with an HMAC-SHA256 over `${timestamp}.${rawBody}` and sends
 * `X-Extrovert-Signature: t=<unix>,v1=<hex>` (§6, §14). Verify with the per-webhook `secret` returned
 * once at registration. Uses Web Crypto (`crypto.subtle`), so it works in Node 18+, Cloudflare
 * Workers, Vercel Edge, Deno, and the browser without any dependency.
 */

import type { Message, WebhookEvent } from "./models.js";

/** The decoded body of a `message.received` (and similar) webhook delivery. */
export interface WebhookPayload {
  event: WebhookEvent;
  /** Delivery id, unique per attempt. */
  id: string;
  created_at: string;
  /** The message that triggered the event (present for message.* events). */
  message?: Message;
  /** The inbox address the event concerns. */
  inbox?: string;
}

export interface VerifyWebhookOptions {
  /** Raw request body, exactly as received (do not re-serialize JSON before verifying). */
  payload: string;
  /** The `X-Extrovert-Signature` header value. */
  signature: string;
  /** The webhook signing secret (`whsec_...`). */
  secret: string;
  /** Reject deliveries whose timestamp is older than this many seconds. Default 300 (5 min). */
  toleranceSeconds?: number;
  /** Override the clock (unix seconds) for deterministic testing. */
  nowSeconds?: number;
}

function parseSignatureHeader(header: string): { t: number; v1: string[] } {
  let t = 0;
  const v1: string[] = [];
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t") t = Number(value);
    else if (key === "v1") v1.push(value);
  }
  return { t, v1 };
}

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

/** Constant-time string compare to avoid leaking the signature via timing. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error(
      "Web Crypto (crypto.subtle) is unavailable in this runtime; cannot verify webhook signatures.",
    );
  }
  const enc = new TextEncoder();
  const key = await subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await subtle.sign("HMAC", key, enc.encode(message));
  return toHex(sig);
}

/**
 * Verify an inbound webhook signature. Returns true when the signature is valid and within the
 * timestamp tolerance. Throws only if the runtime lacks Web Crypto.
 *
 * @example
 * ```ts
 * const ok = await verifyWebhookSignature({
 *   payload: rawBody,
 *   signature: req.headers["x-extrovert-signature"],
 *   secret: process.env.EXTROVERT_WEBHOOK_SECRET!,
 * });
 * if (!ok) return new Response("bad signature", { status: 400 });
 * ```
 */
export async function verifyWebhookSignature(options: VerifyWebhookOptions): Promise<boolean> {
  const { payload, signature, secret } = options;
  const tolerance = options.toleranceSeconds ?? 300;
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);

  const { t, v1 } = parseSignatureHeader(signature);
  if (!t || v1.length === 0) return false;
  if (Math.abs(now - t) > tolerance) return false;

  const expected = await hmacSha256Hex(secret, `${t}.${payload}`);
  return v1.some((candidate) => timingSafeEqual(candidate, expected));
}

/**
 * Verify a webhook and parse its JSON body in one step. Returns the typed payload on success, or
 * null when the signature is invalid (so callers can branch without a try/catch on the common path).
 */
export async function parseWebhook(options: VerifyWebhookOptions): Promise<WebhookPayload | null> {
  const ok = await verifyWebhookSignature(options);
  if (!ok) return null;
  return JSON.parse(options.payload) as WebhookPayload;
}

/**
 * Produce the canonical `X-Extrovert-Signature` header value for a body — the exact format the Go
 * delivery engine emits: `t=<unix>,v1=<hex hmac-sha256("<t>.<rawbody>")>`. Mainly useful for tests
 * and self-hosted senders; the platform signs deliveries server-side. The Go `SignWebhook` and this
 * helper are pinned to the same fixed conformance vector across languages.
 */
export async function signWebhook(
  secret: string,
  body: string,
  timestampSeconds: number,
): Promise<string> {
  const t = Math.floor(timestampSeconds);
  const v1 = await hmacSha256Hex(secret, `${t}.${body}`);
  return `t=${t},v1=${v1}`;
}
