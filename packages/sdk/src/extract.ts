/**
 * OTP / verification-link extraction.
 *
 * Find the most likely one-time code and preferred verification link in a message body. Pure and
 * dependency-free so it runs in Node, the edge, and the browser.
 */

import type { ExtractedCredentials, Message } from "./models.js";

/**
 * Common OTP phrasings, ordered by specificity. A code adjacent to "code/OTP/verification/PIN" is a
 * far stronger signal than a bare 6-digit run (which could be a price, year, or zip).
 */
const OTP_CONTEXT_PATTERNS: RegExp[] = [
  /(?:one[-\s]?time\s*(?:code|password|pin)|verification\s*code|security\s*code|auth(?:entication)?\s*code|access\s*code|login\s*code|confirmation\s*code|your\s*code|otp|pin)\D{0,40}?(\d[\d\s-]{3,9}\d)/i,
  /(\d[\d\s-]{3,9}\d)\D{0,30}?(?:is\s*your|to\s*(?:verify|confirm|sign|log))/i,
];

/** Fallback: a standalone 4–8 digit run that isn't obviously a year or currency amount. */
const OTP_BARE_PATTERN = /(?<![\d.,$£€])\b(\d{4,8})\b(?![\d.,])/g;

/** Verification / magic links, preferring ones whose URL or anchor hints at verification. */
const VERIFY_LINK_HINTS =
  /(verify|confirm|activate|magic|auth|login|sign[-_]?in|token|otp|reset|validate)/i;

const URL_PATTERN = /https?:\/\/[^\s"'<>)\]]+/gi;

/** Normalize a captured code: strip the spaces/dashes some senders insert for readability. */
function normalizeCode(raw: string): string {
  return raw.replace(/[\s-]/g, "");
}

/** Extract the most likely OTP code from a body of text, or null. */
export function extractOtp(body: string): string | null {
  for (const pattern of OTP_CONTEXT_PATTERNS) {
    const m = pattern.exec(body);
    if (m && m[1]) {
      const code = normalizeCode(m[1]);
      if (code.length >= 4 && code.length <= 10) return code;
    }
  }
  // Fallback: first plausible standalone digit run, skipping obvious years (1900–2099).
  let match: RegExpExecArray | null;
  OTP_BARE_PATTERN.lastIndex = 0;
  while ((match = OTP_BARE_PATTERN.exec(body)) !== null) {
    const code = match[1]!;
    const n = Number(code);
    if (code.length === 4 && n >= 1900 && n <= 2099) continue;
    return code;
  }
  return null;
}

/** Extract the most likely verification link from a body, or null. */
export function extractLink(body: string): string | null {
  const urls = body.match(URL_PATTERN);
  if (!urls || urls.length === 0) return null;
  const cleaned = urls.map((u) => u.replace(/[.,;:)]+$/, ""));
  const hinted = cleaned.find((u) => VERIFY_LINK_HINTS.test(u));
  return hinted ?? cleaned[0] ?? null;
}

/**
 * Extract OTP + verification link from a message. Prefers the plain-text body; falls back to a
 * tag-stripped HTML body so codes/links rendered only in HTML are still found.
 */
export function extractCredentials(message: Message): ExtractedCredentials {
  const htmlText = message.html ? stripHtml(message.html) : "";
  const text = message.text && message.text.trim().length > 0 ? message.text : htmlText;
  const combined = `${text}\n${htmlText}`;
  return {
    otp: extractOtp(text) ?? extractOtp(htmlText),
    // Links live in href attributes, so search the raw HTML too.
    link: extractLink(message.html ?? "") ?? extractLink(combined),
  };
}

/** Minimal HTML-to-text: drop tags and decode the handful of entities that matter for codes. */
function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)))
    .replace(/\s+/g, " ")
    .trim();
}
